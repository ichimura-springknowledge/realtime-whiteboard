import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { drawStroke } from '../lib/draw'

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const pointFromEvent = (event, rect) => [
  event.clientX - rect.left,
  event.clientY - rect.top,
  event.pressure > 0 ? event.pressure : 0.5,
]

export default function Canvas({ color, size, strokes, onStrokeComplete }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const currentRef = useRef(null)
  const frameRef = useRef(0)
  const strokesRef = useRef(strokes)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

    for (const stroke of strokesRef.current) drawStroke(ctx, stroke)
    if (currentRef.current) drawStroke(ctx, currentRef.current, { last: false })
  }, [])

  const scheduleRedraw = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      redraw()
    })
  }, [redraw])

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
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [redraw])

  useEffect(() => {
    strokesRef.current = strokes
    scheduleRedraw()
  }, [strokes, scheduleRedraw])

  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const canvas = canvasRef.current
    canvas.setPointerCapture(event.pointerId)

    currentRef.current = {
      id: createId(),
      color,
      size,
      simulatePressure: event.pointerType !== 'pen',
      points: [pointFromEvent(event, canvas.getBoundingClientRect())],
    }
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

    currentRef.current = null
    onStrokeComplete(stroke)
    scheduleRedraw()
  }

  return (
    <canvas
      ref={canvasRef}
      className="board"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  )
}
