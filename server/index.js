const http = require('node:http')
const express = require('express')
const cors = require('cors')
const { Server } = require('socket.io')

const PORT = Number(process.env.PORT) || 3001
const ORIGIN = process.env.CLIENT_ORIGIN || '*'

const MAX_POINTS_PER_MESSAGE = 10000
const MAX_STROKES_PER_ROOM = 3000

const app = express()
app.use(cors({ origin: ORIGIN }))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGIN } })

/** roomId -> { strokes: Stroke[], live: Map<socketId, string> } */
const rooms = new Map()

const getRoom = (roomId) => {
  let room = rooms.get(roomId)
  if (!room) {
    room = { strokes: [], live: new Map() }
    rooms.set(roomId, room)
  }
  return room
}

const normalizeRoomId = (value) => {
  const raw = Array.isArray(value) ? value[0] : value
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^\w-]/g, '')
    .slice(0, 64)
  return cleaned || 'lobby'
}

const sanitizePoints = (raw) => {
  if (!Array.isArray(raw)) return null
  const points = []
  for (const point of raw.slice(0, MAX_POINTS_PER_MESSAGE)) {
    if (!Array.isArray(point) || point.length < 2) continue
    const [x, y, pressure] = point
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push([x, y, Number.isFinite(pressure) ? pressure : 0.5])
  }
  return points
}

const sanitizeStroke = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const points = sanitizePoints(raw.points)
  if (!points) return null

  return {
    id: raw.id.slice(0, 64),
    color: typeof raw.color === 'string' ? raw.color.slice(0, 32) : '#111827',
    size: Number.isFinite(raw.size) ? Math.min(Math.max(raw.size, 1), 200) : 8,
    simulatePressure: raw.simulatePressure !== false,
    points,
  }
}

const peerCount = (roomId) => io.sockets.adapter.rooms.get(roomId)?.size ?? 0

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: [...rooms.entries()].map(([id, room]) => ({
      id,
      strokes: room.strokes.length,
      peers: peerCount(id),
    })),
  })
})

io.on('connection', (socket) => {
  const roomId = normalizeRoomId(socket.handshake.query.room)
  const room = getRoom(roomId)
  socket.join(roomId)

  socket.emit('board:init', { room: roomId, strokes: room.strokes })
  io.to(roomId).emit('room:peers', peerCount(roomId))

  socket.on('stroke:start', (raw) => {
    const stroke = sanitizeStroke(raw)
    if (!stroke) return
    room.live.set(socket.id, stroke.id)
    socket.to(roomId).emit('stroke:start', stroke)
  })

  socket.on('stroke:points', (payload) => {
    if (!payload || typeof payload.id !== 'string') return
    const points = sanitizePoints(payload.points)
    if (!points || points.length === 0) return
    socket.to(roomId).emit('stroke:points', { id: payload.id.slice(0, 64), points })
  })

  socket.on('stroke:end', (raw) => {
    const stroke = sanitizeStroke(raw)
    if (!stroke) return
    room.live.delete(socket.id)
    room.strokes.push(stroke)
    // Oldest strokes drop out once a room gets very long, to bound memory.
    if (room.strokes.length > MAX_STROKES_PER_ROOM) room.strokes.shift()
    socket.to(roomId).emit('stroke:end', stroke)
  })

  socket.on('board:clear', () => {
    room.strokes = []
    room.live.clear()
    io.to(roomId).emit('board:clear')
  })

  socket.on('disconnect', () => {
    const liveId = room.live.get(socket.id)
    if (liveId) {
      room.live.delete(socket.id)
      socket.to(roomId).emit('stroke:cancel', { id: liveId })
    }
    io.to(roomId).emit('room:peers', peerCount(roomId))
    if (peerCount(roomId) === 0 && room.strokes.length === 0) rooms.delete(roomId)
  })
})

server.listen(PORT, () => {
  console.log(`whiteboard server listening on http://localhost:${PORT}`)
})
