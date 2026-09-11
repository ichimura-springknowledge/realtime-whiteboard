import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawItem, drawStroke } from '../lib/draw'
import TextEditor from './TextEditor'

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const pointFromEvent = (event, rect) => [
  event.clientX - rect.left,
  event.clientY - rect.top,
  event.pressure > 0 ? event.pressure : 0.5,
]

export default function Canvas({
  tool,
  color,
  size,
  fontSize,
  items,
  liveStrokes,
  onStrokeStart,
  onStrokePoints,
  onStrokeComplete,
  onAddText,
}) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const currentRef = useRef(null)
  const sentPointsRef = useRef(0)
  const frameRef = useRef(0)
  const itemsRef = useRef(items)
  const liveStrokesRef = useRef(liveStrokes)
  const [draft, setDraft] = useState(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

    for (const item of itemsRef.current) drawItem(ctx, item)
    for (const stroke of liveStrokesRef.current) drawStroke(ctx, stroke, { last: false })
    if (currentRef.current) drawStroke(ctx, currentRef.current, { last: false })
  }, [])

  // Sends the points captured since the previous frame, so remote participants
  // see the line grow instead of appearing only once it is finished.
  const flushPoints = useCallback(() => {
    const stroke = currentRef.current
    if (!stroke) return
    const pending = stroke.points.slice(sentPointsRef.current)
    if (pending.length === 0) return
    sentPointsRef.current = stroke.points.length
    onStrokePoints?.(stroke.id, pending)
  }, [onStrokePoints])

  const scheduleRedraw = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      redraw()
      flushPoints()
    })
  }, [redraw, flushPoints])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    ctxRef.current = canvas.getContext('2d')

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      redraw()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        // Must be cleared: a stale id here makes scheduleRedraw think a frame is
        // already pending and silently skip every later redraw.
        frameRef.current = 0
      }
    }
  }, [redraw])

  useEffect(() => {
    itemsRef.current = items
    liveStrokesRef.current = liveStrokes
    scheduleRedraw()
  }, [items, liveStrokes, scheduleRedraw])

  const commitDraft = (pending) => {
    const value = pending?.text.trim()
    if (!value) return
    onAddText({
      id: createId(),
      type: 'text',
      x: pending.x,
      y: pending.y,
      text: value,
      color: pending.color,
      size: pending.size,
    })
  }

  const closeDraft = (pending) => {
    commitDraft(pending)
    setDraft(null)
  }

  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()

    if (tool === 'text') {
      // Without this the browser's own focus handling for the click lands on the
      // canvas right after the editor mounts, blurring it away instantly.
      event.preventDefault()
      commitDraft(draft)
      setDraft({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        color,
        size: fontSize,
        text: '',
      })
      return
    }

    canvas.setPointerCapture(event.pointerId)
    const stroke = {
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
    onStrokeStart?.(stroke)
    scheduleRedraw()
  }

  const handlePointerMove = (event) => {
    const stroke = currentRef.current
    if (!stroke) return

    const rect = canvasRef.current.getBoundingClientRect()
    const native = event.nativeEvent
    // Coalesced events give us every sample the device reported between frames.
    const samples = native.getCoalescedEvents ? native.getCoalescedEvents() : [native]
    for (const sample of samples.length ? samples : [native]) {
      stroke.points.push(pointFromEvent(sample, rect))
    }
    scheduleRedraw()
  }

  const handlePointerUp = (event) => {
    const stroke = currentRef.current
    if (!stroke) return

    const canvas = canvasRef.current
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

    flushPoints()
    currentRef.current = null
    sentPointsRef.current = 0
    onStrokeComplete(stroke)
    scheduleRedraw()
  }

  return (
    <div className="board-wrap">
      <canvas
        ref={canvasRef}
        className={`board board--${tool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {draft && (
        <TextEditor
          draft={draft}
          onChange={(text) => setDraft((prev) => ({ ...prev, text }))}
          onCommit={() => closeDraft(draft)}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  )
}
