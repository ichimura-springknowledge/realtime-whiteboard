import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { drawItem, hitTestText, pointFromEvent } from '../lib/draw'
import type {
  BoardItem,
  LiveItem,
  Point,
  Position,
  ShapeItem,
  ShapeKind,
  StrokeItem,
  TextDraft,
  Tool,
} from '../types'
import TextEditor from './TextEditor'

const createId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const isShapeTool = (tool: Tool): tool is ShapeKind =>
  tool === 'rect' || tool === 'ellipse' || tool === 'arrow'

interface DragState {
  id: string
  grabX: number
  grabY: number
  from: Position
  last: Position
  pending: Position | null
}

interface CanvasProps {
  tool: Tool
  color: string
  size: number
  fontSize: number
  items: BoardItem[]
  liveItems: LiveItem[]
  movingIds: string[]
  onStrokeStart: (stroke: StrokeItem) => void
  onStrokePoints: (id: string, points: Point[]) => void
  onStrokeComplete: (stroke: StrokeItem) => void
  onShapePreview: (shape: ShapeItem) => void
  onCursorMove: (x: number, y: number) => void
  onCursorLeave: () => void
  onSizeChange: (size: { width: number; height: number }) => void
  onAddItem: (item: BoardItem) => void
  onMoveText: (id: string, x: number, y: number) => void
  onCommitMove: (id: string, from: Position, to: Position) => void
}

function Canvas({
  tool,
  color,
  size,
  fontSize,
  items,
  liveItems,
  movingIds,
  onStrokeStart,
  onStrokePoints,
  onStrokeComplete,
  onShapePreview,
  onCursorMove,
  onCursorLeave,
  onSizeChange,
  onAddItem,
  onMoveText,
  onCommitMove,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const currentRef = useRef<StrokeItem | null>(null)
  const shapeRef = useRef<ShapeItem | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const sentPointsRef = useRef(0)
  const cursorRef = useRef<Position | null>(null)
  const frameRef = useRef(0)
  const cursorFrameRef = useRef(0)
  const itemsRef = useRef(items)
  const liveItemsRef = useRef(liveItems)
  const staticItemsRef = useRef<BoardItem[]>(items)
  const movingItemsRef = useRef<BoardItem[]>([])
  const staticRef = useRef<HTMLCanvasElement | null>(null)
  // How many committed items the offscreen layer already holds, and where the
  // next sync should start from (0 means "rebuild the whole thing").
  const staticDrawnRef = useRef(0)
  const staticFromRef = useRef(0)
  const [draft, setDraft] = useState<TextDraft | null>(null)
  const onSizeChangeRef = useRef(onSizeChange)

  useEffect(() => {
    onSizeChangeRef.current = onSizeChange
  }, [onSizeChange])

  /**
   * Committed items live on an offscreen layer that is only redrawn when they
   * change — and when they merely grew, only the new ones are added.
   *
   * Re-running perfect-freehand over every stroke on every frame is what makes
   * a busy board stutter; this keeps the per-frame cost to whatever is still
   * being drawn, however much is already on the board.
   */
  const syncStaticLayer = useCallback((canvas: HTMLCanvasElement, dpr: number) => {
    let layer = staticRef.current
    if (!layer) {
      layer = document.createElement('canvas')
      staticRef.current = layer
    }
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width
      layer.height = canvas.height
      // Resizing a canvas clears it, so everything has to go back on.
      staticFromRef.current = 0
      staticDrawnRef.current = 0
    }

    const items = staticItemsRef.current
    const from = staticFromRef.current
    if (from === staticDrawnRef.current && staticDrawnRef.current === items.length) return layer

    const ctx = layer.getContext('2d')
    if (!ctx) return layer
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (from === 0) ctx.clearRect(0, 0, layer.width / dpr, layer.height / dpr)
    for (let i = from; i < items.length; i++) drawItem(ctx, items[i]!)

    staticDrawnRef.current = items.length
    staticFromRef.current = items.length
    return layer
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const layer = syncStaticLayer(canvas, dpr)

    // Blitting happens in device pixels; everything else is drawn in CSS pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(layer, 0, 0)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const moving of movingItemsRef.current) drawItem(ctx, moving)
    for (const live of liveItemsRef.current) drawItem(ctx, live, { last: false })
    if (currentRef.current) drawItem(ctx, currentRef.current, { last: false })
    if (shapeRef.current) drawItem(ctx, shapeRef.current)
  }, [syncStaticLayer])

  // Sends the points captured since the previous frame, so remote participants
  // see the line grow instead of appearing only once it is finished.
  const flushPoints = useCallback(() => {
    const stroke = currentRef.current
    if (!stroke) return
    const pending = stroke.points.slice(sentPointsRef.current)
    if (pending.length === 0) return
    sentPointsRef.current = stroke.points.length
    onStrokePoints(stroke.id, pending)
  }, [onStrokePoints])

  // A drag produces far more pointer events than frames, so the dragged position
  // is published once per frame rather than once per event.
  const flushDrag = useCallback(() => {
    const drag = dragRef.current
    if (!drag?.pending) return
    const { x, y } = drag.pending
    drag.pending = null
    drag.last = { x, y }
    onMoveText(drag.id, x, y)
  }, [onMoveText])

  // Pointer moves arrive far faster than frames; one position per frame is
  // plenty for a cursor and keeps the traffic bounded.
  const flushCursor = useCallback(() => {
    const cursor = cursorRef.current
    if (!cursor) return
    cursorRef.current = null
    onCursorMove(cursor.x, cursor.y)
  }, [onCursorMove])

  // The whole shape is small, so the current corners go out once per frame.
  const flushShape = useCallback(() => {
    if (shapeRef.current) onShapePreview(shapeRef.current)
  }, [onShapePreview])

  const scheduleRedraw = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      redraw()
      flushPoints()
      flushDrag()
      flushShape()
    })
  }, [redraw, flushPoints, flushDrag, flushShape])

  // Kept apart from the redraw frame: moving the pointer without drawing should
  // publish a cursor position, not repaint every item on the board.
  const scheduleCursor = useCallback(() => {
    if (cursorFrameRef.current) return
    cursorFrameRef.current = requestAnimationFrame(() => {
      cursorFrameRef.current = 0
      flushCursor()
    })
  }, [flushCursor])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    ctxRef.current = canvas.getContext('2d')

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      // Exporting needs the board's size in CSS pixels, which only the canvas knows.
      onSizeChangeRef.current({ width, height })
      redraw()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      // These must be cleared, not just cancelled: a stale id makes the
      // schedulers think a frame is already pending and skip every later one.
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
      if (cursorFrameRef.current) {
        cancelAnimationFrame(cursorFrameRef.current)
        cursorFrameRef.current = 0
      }
    }
  }, [redraw])

  useEffect(() => {
    // Whatever is being dragged is drawn fresh each frame instead of going into
    // the cached layer, so a drag never rebuilds the rest of the board.
    const moving = movingIds.length > 0 ? new Set(movingIds) : null
    const nextStatic = moving ? items.filter((item) => !moving.has(item.id)) : items

    const previous = staticItemsRef.current
    // The cached items are only ever appended to in the common case, and the
    // objects themselves are reused, so a reference scan tells us whether the
    // layer can be topped up instead of redrawn. Anything else (undo, a
    // finished move, a clear) changes an existing entry and forces a rebuild.
    let appendOnly = nextStatic.length >= previous.length
    if (appendOnly) {
      for (let i = 0; i < previous.length; i++) {
        if (previous[i] !== nextStatic[i]) {
          appendOnly = false
          break
        }
      }
    }
    staticFromRef.current = appendOnly ? Math.min(previous.length, staticDrawnRef.current) : 0

    staticItemsRef.current = nextStatic
    movingItemsRef.current = moving ? items.filter((item) => moving.has(item.id)) : []
    itemsRef.current = items
    liveItemsRef.current = liveItems
    scheduleRedraw()
  }, [items, liveItems, movingIds, scheduleRedraw])

  const commitDraft = (pending: TextDraft | null) => {
    const value = pending?.text.trim()
    if (!pending || !value) return
    onAddItem({
      id: createId(),
      type: 'text',
      x: pending.x,
      y: pending.y,
      text: value,
      color: pending.color,
      size: pending.size,
    })
  }

  const closeDraft = (pending: TextDraft | null) => {
    commitDraft(pending)
    setDraft(null)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return

    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    if (tool === 'text') {
      // Without this the browser's own focus handling for the click lands on the
      // canvas right after the editor mounts, blurring it away instantly.
      event.preventDefault()

      const hit = hitTestText(ctx, itemsRef.current, x, y)
      if (hit) {
        // Grabbing existing text moves it instead of starting a new one.
        closeDraft(draft)
        canvas.setPointerCapture(event.pointerId)
        dragRef.current = {
          id: hit.id,
          grabX: x - hit.x,
          grabY: y - hit.y,
          from: { x: hit.x, y: hit.y },
          last: { x: hit.x, y: hit.y },
          pending: null,
        }
        return
      }

      commitDraft(draft)
      setDraft({ x, y, color, size: fontSize, text: '' })
      return
    }

    if (isShapeTool(tool)) {
      canvas.setPointerCapture(event.pointerId)
      shapeRef.current = {
        id: createId(),
        type: 'shape',
        shape: tool,
        color,
        size,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
      }
      scheduleRedraw()
      return
    }

    canvas.setPointerCapture(event.pointerId)
    const stroke: StrokeItem = {
      id: createId(),
      type: 'stroke',
      color,
      size,
      simulatePressure: event.pointerType !== 'pen',
      erase: tool === 'eraser',
      points: [pointFromEvent(event, rect)],
    }
    currentRef.current = stroke
    sentPointsRef.current = stroke.points.length
    onStrokeStart(stroke)
    scheduleRedraw()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return

    const rect = canvas.getBoundingClientRect()
    cursorRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    scheduleCursor()

    const drag = dragRef.current

    if (drag) {
      drag.pending = {
        x: event.clientX - rect.left - drag.grabX,
        y: event.clientY - rect.top - drag.grabY,
      }
      scheduleRedraw()
      return
    }

    const shape = shapeRef.current
    if (shape) {
      shape.x2 = event.clientX - rect.left
      shape.y2 = event.clientY - rect.top
      scheduleRedraw()
      return
    }

    const stroke = currentRef.current
    if (!stroke) {
      if (tool === 'text') {
        // Hint that the text under the pointer can be picked up. Set straight on
        // the element, so hovering never re-renders the canvas.
        const over = hitTestText(
          ctx,
          itemsRef.current,
          event.clientX - rect.left,
          event.clientY - rect.top,
        )
        canvas.style.cursor = over ? 'move' : ''
      }
      return
    }

    const native = event.nativeEvent
    // Coalesced events give us every sample the device reported between frames.
    const samples = native.getCoalescedEvents ? native.getCoalescedEvents() : [native]
    for (const sample of samples.length ? samples : [native]) {
      stroke.points.push(pointFromEvent(sample, rect))
    }
    scheduleRedraw()
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const release = () => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }

    const drag = dragRef.current
    if (drag) {
      flushDrag()
      dragRef.current = null
      release()
      onCommitMove(drag.id, drag.from, drag.last)
      return
    }

    const shape = shapeRef.current
    if (shape) {
      shapeRef.current = null
      release()
      // A click with no drag leaves nothing to draw.
      if (shape.x1 !== shape.x2 || shape.y1 !== shape.y2) onAddItem(shape)
      scheduleRedraw()
      return
    }

    const stroke = currentRef.current
    if (!stroke) return
    release()

    flushPoints()
    currentRef.current = null
    sentPointsRef.current = 0
    onStrokeComplete(stroke)
    scheduleRedraw()
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`board board--${tool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={onCursorLeave}
      />
      {draft && (
        <TextEditor
          draft={draft}
          onChange={(text) => setDraft((prev) => (prev ? { ...prev, text } : prev))}
          onCommit={() => closeDraft(draft)}
          onCancel={() => setDraft(null)}
        />
      )}
    </>
  )
}

/**
 * Memoised: participant cursors change many times a second, and the board has
 * no reason to re-render because someone else moved their mouse.
 */
export default memo(Canvas)
