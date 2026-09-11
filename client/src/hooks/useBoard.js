import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

const withoutStroke = (strokes, id) => {
  if (!(id in strokes)) return strokes
  const next = { ...strokes }
  delete next[id]
  return next
}

/**
 * Owns the board state for one room: strokes committed by anyone, the strokes
 * other participants are drawing right now, and the socket that ties it all
 * together.
 */
export function useBoard(room) {
  const socketRef = useRef(null)
  const [strokes, setStrokes] = useState([])
  const [remoteStrokes, setRemoteStrokes] = useState({})
  const [status, setStatus] = useState('connecting')
  const [peers, setPeers] = useState(1)

  useEffect(() => {
    const socket = io(SERVER_URL, { query: { room } })
    socketRef.current = socket

    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('connect_error', () => setStatus('offline'))

    socket.on('board:init', (payload) => {
      setStrokes(payload?.strokes ?? [])
      setRemoteStrokes({})
    })
    socket.on('room:peers', (count) => setPeers(count || 1))

    socket.on('stroke:start', (stroke) => {
      setRemoteStrokes((prev) => ({ ...prev, [stroke.id]: stroke }))
    })
    socket.on('stroke:points', ({ id, points }) => {
      setRemoteStrokes((prev) => {
        const stroke = prev[id]
        if (!stroke) return prev
        return { ...prev, [id]: { ...stroke, points: [...stroke.points, ...points] } }
      })
    })
    socket.on('stroke:end', (stroke) => {
      setRemoteStrokes((prev) => withoutStroke(prev, stroke.id))
      setStrokes((prev) => [...prev, stroke])
    })
    socket.on('stroke:cancel', ({ id }) => {
      setRemoteStrokes((prev) => withoutStroke(prev, id))
    })
    socket.on('board:clear', () => {
      setStrokes([])
      setRemoteStrokes({})
    })

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [room])

  const startStroke = useCallback((stroke) => {
    socketRef.current?.emit('stroke:start', stroke)
  }, [])

  const appendPoints = useCallback((id, points) => {
    socketRef.current?.emit('stroke:points', { id, points })
  }, [])

  const completeStroke = useCallback((stroke) => {
    setStrokes((prev) => [...prev, stroke])
    socketRef.current?.emit('stroke:end', stroke)
  }, [])

  const clearBoard = useCallback(() => {
    setStrokes([])
    setRemoteStrokes({})
    socketRef.current?.emit('board:clear')
  }, [])

  const liveStrokes = useMemo(() => Object.values(remoteStrokes), [remoteStrokes])

  return { strokes, liveStrokes, status, peers, startStroke, appendPoints, completeStroke, clearBoard }
}
