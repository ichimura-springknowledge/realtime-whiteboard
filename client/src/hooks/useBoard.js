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
 * Owns the board state for one room: the items everyone has committed, the
 * strokes other participants are drawing right now, and the socket that ties it
 * all together.
 *
 * Undo is per participant: it takes back the last item *you* added, never
 * someone else's, which is what people expect on a shared board.
 */
export function useBoard(room) {
  const socketRef = useRef(null)
  const [items, setItems] = useState([])
  const [liveStrokeMap, setLiveStrokeMap] = useState({})
  const [myItemIds, setMyItemIds] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [status, setStatus] = useState('connecting')
  const [peers, setPeers] = useState(1)

  // Mirrors of the state above, so the undo/redo callbacks can read the current
  // history without being re-created on every change.
  const itemsRef = useRef(items)
  const myItemIdsRef = useRef(myItemIds)
  const redoStackRef = useRef(redoStack)

  useEffect(() => {
    itemsRef.current = items
    myItemIdsRef.current = myItemIds
    redoStackRef.current = redoStack
  }, [items, myItemIds, redoStack])

  useEffect(() => {
    const socket = io(SERVER_URL, { query: { room } })
    socketRef.current = socket

    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('connect_error', () => setStatus('offline'))

    socket.on('board:init', (payload) => {
      setItems(payload?.items ?? [])
      setLiveStrokeMap({})
      setMyItemIds([])
      setRedoStack([])
    })
    socket.on('room:peers', (count) => setPeers(count || 1))

    socket.on('stroke:start', (stroke) => {
      setLiveStrokeMap((prev) => ({ ...prev, [stroke.id]: stroke }))
    })
    socket.on('stroke:points', ({ id, points }) => {
      setLiveStrokeMap((prev) => {
        const stroke = prev[id]
        if (!stroke) return prev
        return { ...prev, [id]: { ...stroke, points: [...stroke.points, ...points] } }
      })
    })
    socket.on('stroke:cancel', ({ id }) => {
      setLiveStrokeMap((prev) => withoutStroke(prev, id))
    })

    socket.on('item:add', (item) => {
      setLiveStrokeMap((prev) => withoutStroke(prev, item.id))
      setItems((prev) => (prev.some((it) => it.id === item.id) ? prev : [...prev, item]))
    })
    socket.on('item:remove', ({ id }) => {
      setItems((prev) => prev.filter((item) => item.id !== id))
    })
    socket.on('board:clear', () => {
      setItems([])
      setLiveStrokeMap({})
      setMyItemIds([])
      setRedoStack([])
    })

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [room])

  const trackMine = useCallback((id) => {
    myItemIdsRef.current = [...myItemIdsRef.current, id]
    setMyItemIds(myItemIdsRef.current)
    redoStackRef.current = []
    setRedoStack(redoStackRef.current)
  }, [])

  const addItem = useCallback(
    (item) => {
      setItems((prev) => [...prev, item])
      trackMine(item.id)
      socketRef.current?.emit('item:add', item)
    },
    [trackMine],
  )

  const startStroke = useCallback((stroke) => {
    socketRef.current?.emit('stroke:start', stroke)
  }, [])

  const appendPoints = useCallback((id, points) => {
    socketRef.current?.emit('stroke:points', { id, points })
  }, [])

  const completeStroke = useCallback(
    (stroke) => {
      setItems((prev) => [...prev, stroke])
      trackMine(stroke.id)
      socketRef.current?.emit('stroke:end', stroke)
    },
    [trackMine],
  )

  const undo = useCallback(() => {
    const ids = myItemIdsRef.current
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]
      const item = itemsRef.current.find((candidate) => candidate.id === id)
      // Skip ids that are already gone (someone cleared the board, say).
      if (!item) continue

      myItemIdsRef.current = [...ids.slice(0, i), ...ids.slice(i + 1)]
      setMyItemIds(myItemIdsRef.current)
      redoStackRef.current = [...redoStackRef.current, item]
      setRedoStack(redoStackRef.current)
      itemsRef.current = itemsRef.current.filter((candidate) => candidate.id !== id)
      setItems(itemsRef.current)
      socketRef.current?.emit('item:remove', { id })
      return
    }
  }, [])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const item = stack[stack.length - 1]

    redoStackRef.current = stack.slice(0, -1)
    setRedoStack(redoStackRef.current)
    myItemIdsRef.current = [...myItemIdsRef.current, item.id]
    setMyItemIds(myItemIdsRef.current)
    itemsRef.current = itemsRef.current.some((candidate) => candidate.id === item.id)
      ? itemsRef.current
      : [...itemsRef.current, item]
    setItems(itemsRef.current)
    socketRef.current?.emit('item:add', item)
  }, [])

  const clearBoard = useCallback(() => {
    itemsRef.current = []
    myItemIdsRef.current = []
    redoStackRef.current = []
    setItems([])
    setLiveStrokeMap({})
    setMyItemIds([])
    setRedoStack([])
    socketRef.current?.emit('board:clear')
  }, [])

  const liveStrokes = useMemo(() => Object.values(liveStrokeMap), [liveStrokeMap])
  const canUndo = useMemo(() => {
    const present = new Set(items.map((item) => item.id))
    return myItemIds.some((id) => present.has(id))
  }, [items, myItemIds])

  return {
    items,
    liveStrokes,
    status,
    peers,
    canUndo,
    canRedo: redoStack.length > 0,
    startStroke,
    appendPoints,
    completeStroke,
    addItem,
    undo,
    redo,
    clearBoard,
  }
}
