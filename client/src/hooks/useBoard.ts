import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  BoardAction,
  BoardItem,
  ClientToServerEvents,
  ConnectionStatus,
  LiveItem,
  PeerCursor,
  Position,
  RedoAction,
  ServerToClientEvents,
  ShapeItem,
  StrokeItem,
} from '../types'

type BoardSocket = Socket<ServerToClientEvents, ClientToServerEvents>

// Only used by `npm run dev`, where the client is served by Vite and the
// whiteboard server is a separate process.
const DEV_SERVER_PORT = import.meta.env.VITE_SERVER_PORT || '5000'

/**
 * Where the whiteboard server lives.
 *
 * A production build is served by the whiteboard server itself, so it talks to
 * the same origin whatever port that happens to be - which matters, because the
 * port is chosen to suit the office firewall rather than being fixed.
 */
function resolveServerUrl(): string | undefined {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL
  if (!import.meta.env.DEV) return undefined
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:${DEV_SERVER_PORT}`
}

const SERVER_URL = resolveServerUrl()

const withoutItem = (
  items: Record<string, LiveItem>,
  id: string,
): Record<string, LiveItem> => {
  if (!(id in items)) return items
  const next = { ...items }
  delete next[id]
  return next
}

const moveIn = (items: BoardItem[], id: string, position: Position): BoardItem[] =>
  items.map((item) =>
    item.id === id && item.type === 'text' ? { ...item, x: position.x, y: position.y } : item,
  )

export interface Board {
  items: BoardItem[]
  liveItems: LiveItem[]
  /** Items being dragged right now, by anyone. */
  movingIds: string[]
  cursors: PeerCursor[]
  status: ConnectionStatus
  peers: number
  canUndo: boolean
  canRedo: boolean
  startStroke: (stroke: StrokeItem) => void
  appendPoints: (id: string, points: StrokeItem['points']) => void
  completeStroke: (stroke: StrokeItem) => void
  previewShape: (shape: ShapeItem) => void
  moveCursor: (x: number, y: number) => void
  leaveCursor: () => void
  addItem: (item: BoardItem) => void
  moveItem: (id: string, x: number, y: number) => void
  commitMove: (id: string, from: Position, to: Position) => void
  undo: () => void
  redo: () => void
  clearBoard: () => void
}

/**
 * Owns the board state for one room: the items everyone has committed, the
 * strokes other participants are drawing right now, and the socket that ties it
 * all together.
 *
 * Undo walks a per-participant action log (what I added, what I moved), so it
 * only ever takes back your own work and never someone else's, which is what
 * people expect on a shared board.
 */
export function useBoard(room: string): Board {
  const socketRef = useRef<BoardSocket | null>(null)
  const [items, setItems] = useState<BoardItem[]>([])
  const [liveItemMap, setLiveItemMap] = useState<Record<string, LiveItem>>({})
  const [cursorMap, setCursorMap] = useState<Record<string, PeerCursor>>({})
  const [movingIds, setMovingIds] = useState<string[]>([])
  const movingTimersRef = useRef(new Map<string, number>())
  const [history, setHistory] = useState<BoardAction[]>([])
  const [redoStack, setRedoStack] = useState<RedoAction[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [peers, setPeers] = useState(1)

  // Mirrors of the state above, so the callbacks below can read the current
  // board without being re-created on every change.
  const itemsRef = useRef(items)
  const historyRef = useRef(history)
  const redoStackRef = useRef(redoStack)

  useEffect(() => {
    itemsRef.current = items
    historyRef.current = history
    redoStackRef.current = redoStack
  }, [items, history, redoStack])

  /**
   * Flags an item as "being dragged" until the moves stop. Renderers use this to
   * keep it out of their cached layer, which would otherwise be rebuilt on every
   * frame of the drag.
   */
  const markMoving = useCallback((id: string) => {
    const timers = movingTimersRef.current
    const pending = timers.get(id)
    if (pending !== undefined) window.clearTimeout(pending)
    else setMovingIds((prev) => (prev.includes(id) ? prev : [...prev, id]))

    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id)
        setMovingIds((prev) => prev.filter((candidate) => candidate !== id))
      }, 250),
    )
  }, [])

  useEffect(() => {
    const timers = movingTimersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const resetHistory = useCallback(() => {
    historyRef.current = []
    redoStackRef.current = []
    setHistory([])
    setRedoStack([])
  }, [])

  useEffect(() => {
    const socket: BoardSocket = io(SERVER_URL, { query: { room } })
    socketRef.current = socket

    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('connect_error', () => setStatus('offline'))

    socket.on('board:init', (payload) => {
      setItems(payload?.items ?? [])
      setLiveItemMap({})
      setCursorMap({})
      resetHistory()
    })
    socket.on('room:peers', (count) => setPeers(count || 1))

    socket.on('stroke:start', (stroke) => {
      setLiveItemMap((prev) => ({ ...prev, [stroke.id]: stroke }))
    })
    socket.on('stroke:points', ({ id, points }) => {
      setLiveItemMap((prev) => {
        const stroke = prev[id]
        if (!stroke || stroke.type !== 'stroke') return prev
        return { ...prev, [id]: { ...stroke, points: [...stroke.points, ...points] } }
      })
    })
    socket.on('stroke:cancel', ({ id }) => {
      setLiveItemMap((prev) => withoutItem(prev, id))
    })
    socket.on('shape:preview', (shape) => {
      setLiveItemMap((prev) => ({ ...prev, [shape.id]: shape }))
    })

    socket.on('item:add', (item) => {
      setLiveItemMap((prev) => withoutItem(prev, item.id))
      setItems((prev) => (prev.some((it) => it.id === item.id) ? prev : [...prev, item]))
    })
    socket.on('item:remove', ({ id }) => {
      setItems((prev) => prev.filter((item) => item.id !== id))
    })
    socket.on('item:move', ({ id, x, y }) => {
      setItems((prev) => moveIn(prev, id, { x, y }))
      markMoving(id)
    })
    socket.on('board:clear', () => {
      setItems([])
      setLiveItemMap({})
      resetHistory()
    })
    socket.on('cursor:move', (cursor) => {
      setCursorMap((prev) => ({ ...prev, [cursor.id]: cursor }))
    })
    socket.on('cursor:leave', ({ id }) => {
      setCursorMap((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    })

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [room, resetHistory, markMoving])

  const pushAction = useCallback((action: BoardAction) => {
    historyRef.current = [...historyRef.current, action]
    setHistory(historyRef.current)
    redoStackRef.current = []
    setRedoStack(redoStackRef.current)
  }, [])

  const addItem = useCallback(
    (item: BoardItem) => {
      setItems((prev) => [...prev, item])
      pushAction({ type: 'add', id: item.id })
      socketRef.current?.emit('item:add', item)
    },
    [pushAction],
  )

  const startStroke = useCallback((stroke: StrokeItem) => {
    socketRef.current?.emit('stroke:start', stroke)
  }, [])

  const moveCursor = useCallback((x: number, y: number) => {
    socketRef.current?.emit('cursor:move', { x, y })
  }, [])

  const leaveCursor = useCallback(() => {
    socketRef.current?.emit('cursor:leave')
  }, [])

  /** A shape is small enough to resend whole on every frame of the drag. */
  const previewShape = useCallback((shape: ShapeItem) => {
    socketRef.current?.emit('shape:preview', shape)
  }, [])

  const appendPoints = useCallback((id: string, points: StrokeItem['points']) => {
    socketRef.current?.emit('stroke:points', { id, points })
  }, [])

  const completeStroke = useCallback(
    (stroke: StrokeItem) => {
      setItems((prev) => [...prev, stroke])
      pushAction({ type: 'add', id: stroke.id })
      socketRef.current?.emit('stroke:end', stroke)
    },
    [pushAction],
  )

  const applyMove = useCallback(
    (id: string, position: Position) => {
      itemsRef.current = moveIn(itemsRef.current, id, position)
      setItems(itemsRef.current)
      markMoving(id)
      socketRef.current?.emit('item:move', { id, x: position.x, y: position.y })
    },
    [markMoving],
  )

  /** Live position update while an item is being dragged; not a history entry. */
  const moveItem = useCallback(
    (id: string, x: number, y: number) => {
      applyMove(id, { x, y })
    },
    [applyMove],
  )

  /** Records a finished drag so it can be undone. */
  const commitMove = useCallback(
    (id: string, from: Position, to: Position) => {
      if (from.x === to.x && from.y === to.y) return
      pushAction({ type: 'move', id, from, to })
    },
    [pushAction],
  )

  const undo = useCallback(() => {
    const actions = historyRef.current
    for (let i = actions.length - 1; i >= 0; i--) {
      const action = actions[i]!
      const item = itemsRef.current.find((candidate) => candidate.id === action.id)
      // Skip actions whose item is already gone (someone cleared the board, say).
      if (!item) continue

      historyRef.current = [...actions.slice(0, i), ...actions.slice(i + 1)]
      setHistory(historyRef.current)

      if (action.type === 'move') {
        redoStackRef.current = [...redoStackRef.current, action]
        applyMove(action.id, action.from)
      } else {
        // Snapshot the item as it stands now, so redo brings back any later move.
        redoStackRef.current = [...redoStackRef.current, { type: 'add', id: action.id, item }]
        itemsRef.current = itemsRef.current.filter((candidate) => candidate.id !== action.id)
        setItems(itemsRef.current)
        socketRef.current?.emit('item:remove', { id: action.id })
      }
      setRedoStack(redoStackRef.current)
      return
    }
  }, [applyMove])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    const action = stack[stack.length - 1]
    if (!action) return

    redoStackRef.current = stack.slice(0, -1)
    setRedoStack(redoStackRef.current)

    if (action.type === 'move') {
      historyRef.current = [...historyRef.current, action]
      applyMove(action.id, action.to)
    } else {
      historyRef.current = [...historyRef.current, { type: 'add', id: action.id }]
      if (!itemsRef.current.some((candidate) => candidate.id === action.id)) {
        itemsRef.current = [...itemsRef.current, action.item]
        setItems(itemsRef.current)
      }
      socketRef.current?.emit('item:add', action.item)
    }
    setHistory(historyRef.current)
  }, [applyMove])

  const clearBoard = useCallback(() => {
    itemsRef.current = []
    setItems([])
    setLiveItemMap({})
    resetHistory()
    socketRef.current?.emit('board:clear')
  }, [resetHistory])

  const liveItems = useMemo(() => Object.values(liveItemMap), [liveItemMap])
  const cursors = useMemo(() => Object.values(cursorMap), [cursorMap])
  const canUndo = useMemo(() => {
    const present = new Set(items.map((item) => item.id))
    return history.some((action) => present.has(action.id))
  }, [items, history])

  return {
    items,
    liveItems,
    movingIds,
    cursors,
    status,
    peers,
    canUndo,
    canRedo: redoStack.length > 0,
    startStroke,
    appendPoints,
    completeStroke,
    previewShape,
    moveCursor,
    leaveCursor,
    addItem,
    moveItem,
    commitMove,
    undo,
    redo,
    clearBoard,
  }
}
