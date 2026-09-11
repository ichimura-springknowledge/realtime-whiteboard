const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const express = require('express')
const cors = require('cors')
const { Server } = require('socket.io')
const { createAccessGuard } = require('./access')
const { createStore } = require('./store')

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'
const ORIGIN = process.env.CLIENT_ORIGIN || '*'
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'boards.json')

const MAX_POINTS_PER_MESSAGE = 10000
const MAX_ITEMS_PER_ROOM = 3000
const MAX_TEXT_LENGTH = 500

// Only machines on the local network may reach the board. Set ALLOWED_CIDRS to
// narrow it further, e.g. ALLOWED_CIDRS=192.168.1.0/24
const isAllowed = createAccessGuard({ allowedCidrs: process.env.ALLOWED_CIDRS })
const store = createStore({ file: DATA_FILE })

// Refusals are logged once per address, so a colleague who cannot get in can be
// told straight away whether their request even reached this machine.
const refused = new Set()
const logRefusal = (address, kind) => {
  const key = `${kind}:${address}`
  if (refused.has(key)) return
  refused.add(key)
  console.warn(`拒否: ${address} (${kind}) — 許可範囲: ${isAllowed.describe()}`)
}

const app = express()
app.use(cors({ origin: ORIGIN }))

// Refuse anything from outside the network before it reaches a route.
app.use((req, res, next) => {
  if (isAllowed(req.socket.remoteAddress)) return next()
  logRefusal(req.socket.remoteAddress, 'HTTP')
  res.status(403).type('text/plain; charset=utf-8').send('このホワイトボードは社内ネットワーク内からのみ利用できます。')
})

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGIN } })

io.use((socket, next) => {
  if (isAllowed(socket.handshake.address)) return next()
  logRefusal(socket.handshake.address, 'WebSocket')
  next(new Error('outside the allowed network'))
})

/** roomId -> { items: Item[], live: Map<socketId, string> } */
const rooms = store.load()

const persist = () => store.save(rooms)

const getRoom = (roomId) => {
  let room = rooms.get(roomId)
  if (!room) {
    room = { items: [], live: new Map() }
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

const clamp = (value, min, max, fallback) =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback

const sanitizeId = (value) =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : null

const sanitizeColor = (value) => (typeof value === 'string' ? value.slice(0, 32) : '#111827')

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
  const id = sanitizeId(raw.id)
  const points = sanitizePoints(raw.points)
  if (!id || !points) return null

  return {
    id,
    type: 'stroke',
    color: sanitizeColor(raw.color),
    size: clamp(raw.size, 1, 200, 8),
    simulatePressure: raw.simulatePressure !== false,
    erase: raw.erase === true,
    points,
  }
}

const sanitizeText = (raw) => {
  const id = sanitizeId(raw.id)
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT_LENGTH) : ''
  if (!id || text.trim().length === 0) return null
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null

  return {
    id,
    type: 'text',
    color: sanitizeColor(raw.color),
    size: clamp(raw.size, 8, 200, 24),
    x: raw.x,
    y: raw.y,
    text,
  }
}

const sanitizeItem = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  return raw.type === 'text' ? sanitizeText(raw) : sanitizeStroke(raw)
}

const appendItem = (room, item) => {
  room.items.push(item)
  // Oldest items drop out once a room gets very long, to bound memory.
  if (room.items.length > MAX_ITEMS_PER_ROOM) room.items.shift()
}

const peerCount = (roomId) => io.sockets.adapter.rooms.get(roomId)?.size ?? 0

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    storage: DATA_FILE,
    allowedFrom: isAllowed.describe(),
    rooms: [...rooms.entries()].map(([id, room]) => ({
      id,
      items: room.items.length,
      peers: peerCount(id),
    })),
  })
})

// Serve the built client when it exists, so the whole board is one address.
const clientDist = path.resolve(__dirname, '..', 'client', 'dist')
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist))
  app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

io.on('connection', (socket) => {
  const roomId = normalizeRoomId(socket.handshake.query.room)
  const room = getRoom(roomId)
  socket.join(roomId)

  socket.emit('board:init', { room: roomId, items: room.items })
  io.to(roomId).emit('room:peers', peerCount(roomId))

  socket.on('stroke:start', (raw) => {
    const stroke = sanitizeItem(raw)
    if (!stroke || stroke.type !== 'stroke') return
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
    const stroke = sanitizeItem(raw)
    if (!stroke || stroke.type !== 'stroke') return
    room.live.delete(socket.id)
    appendItem(room, stroke)
    socket.to(roomId).emit('item:add', stroke)
    persist()
  })

  // Text, and anything re-added by redo.
  socket.on('item:add', (raw) => {
    const item = sanitizeItem(raw)
    if (!item) return
    if (room.items.some((existing) => existing.id === item.id)) return
    appendItem(room, item)
    socket.to(roomId).emit('item:add', item)
    persist()
  })

  // Only text carries a position; strokes are fixed where they were drawn.
  socket.on('item:move', (payload) => {
    const id = sanitizeId(payload?.id)
    if (!id || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return
    const item = room.items.find((candidate) => candidate.id === id)
    if (!item || item.type !== 'text') return
    item.x = payload.x
    item.y = payload.y
    socket.to(roomId).emit('item:move', { id, x: item.x, y: item.y })
    persist()
  })

  socket.on('item:remove', (payload) => {
    const id = sanitizeId(payload?.id)
    if (!id) return
    const index = room.items.findIndex((item) => item.id === id)
    if (index === -1) return
    room.items.splice(index, 1)
    socket.to(roomId).emit('item:remove', { id })
    persist()
  })

  socket.on('board:clear', () => {
    room.items = []
    room.live.clear()
    io.to(roomId).emit('board:clear')
    persist()
  })

  socket.on('disconnect', () => {
    const liveId = room.live.get(socket.id)
    if (liveId) {
      room.live.delete(socket.id)
      socket.to(roomId).emit('stroke:cancel', { id: liveId })
    }
    io.to(roomId).emit('room:peers', peerCount(roomId))
    // An empty board with nobody in it is worth forgetting; a drawn one is not.
    if (peerCount(roomId) === 0 && room.items.length === 0) {
      rooms.delete(roomId)
      persist()
    }
  })
})

const shutdown = () => {
  store.flush()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

/** The addresses colleagues should actually type, rather than localhost. */
const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)

server.listen(PORT, HOST, () => {
  const boards = [...rooms.values()].reduce((total, room) => total + room.items.length, 0)
  const serving = fs.existsSync(path.join(clientDist, 'index.html'))

  console.log(`whiteboard server listening on port ${PORT} (bound to ${HOST})`)
  console.log(`  接続を許可する範囲: ${isAllowed.describe()}`)
  console.log(`  保存先: ${DATA_FILE} (${rooms.size} ルーム / ${boards} 要素を復元)`)
  if (!serving) {
    console.log('  クライアント: 未ビルド (client で npm run build すると同じポートで配信します)')
  }
  console.log('  同僚に共有する URL:')
  for (const address of lanAddresses()) {
    console.log(`    http://${address}:${PORT}/`)
  }
  console.log('  つながらない場合は Windows ファイアウォールの受信許可を確認してください:')
  console.log(
    `    New-NetFirewallRule -DisplayName "Realtime Whiteboard" -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow -Profile Any -RemoteAddress LocalSubnet`,
  )
})
