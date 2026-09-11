import { getStroke } from 'perfect-freehand'
import type { BoardItem, Point, ShapeItem, StrokeItem, TextItem } from '../types'

export const TEXT_FONT = "system-ui, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif"
export const TEXT_LINE_HEIGHT = 1.3

interface DrawOptions {
  /** `false` keeps the tail of an in-progress stroke from being capped early. */
  last?: boolean
}

const BASE_OPTIONS = {
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  start: { taper: 0, cap: true },
  end: { taper: 0, cap: true },
}

export function strokeOptions(stroke: StrokeItem, { last = true }: DrawOptions = {}) {
  const erasing = stroke.erase
  return {
    ...BASE_OPTIONS,
    size: stroke.size,
    // The eraser keeps a constant width so its edge is predictable.
    thinning: erasing ? 0 : 0.6,
    simulatePressure: erasing ? false : stroke.simulatePressure,
    last,
  }
}

const average = (a: number, b: number) => (a + b) / 2

/** Turns the outline points from perfect-freehand into a smooth SVG path. */
export function getSvgPathFromStroke(points: number[][], closed = true): string {
  const len = points.length
  if (len < 4) return ''

  let a = points[0]!
  let b = points[1]!
  const c = points[2]!

  let result = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(
    2,
  )} ${average(b[0]!, c[0]!).toFixed(2)},${average(b[1]!, c[1]!).toFixed(2)} T`

  for (let i = 2; i < len - 1; i++) {
    a = points[i]!
    b = points[i + 1]!
    result += `${average(a[0]!, b[0]!).toFixed(2)},${average(a[1]!, b[1]!).toFixed(2)} `
  }

  if (closed) result += 'Z'
  return result
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeItem,
  { last = true }: DrawOptions = {},
): void {
  if (stroke.points.length === 0) return
  const outline = getStroke(stroke.points as unknown as number[][], strokeOptions(stroke, { last }))
  const d = getSvgPathFromStroke(outline)
  if (!d) return

  ctx.save()
  if (stroke.erase) {
    // Erasing clears whatever is already on the canvas instead of painting.
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000000'
  } else {
    ctx.fillStyle = stroke.color
  }
  ctx.fill(new Path2D(d))
  ctx.restore()
}

export function drawText(ctx: CanvasRenderingContext2D, item: TextItem): void {
  if (!item.text) return
  ctx.save()
  ctx.fillStyle = item.color
  ctx.font = `${item.size}px ${TEXT_FONT}`
  ctx.textBaseline = 'top'
  item.text.split('\n').forEach((line, index) => {
    ctx.fillText(line, item.x, item.y + index * item.size * TEXT_LINE_HEIGHT)
  })
  ctx.restore()
}

export function drawItem(
  ctx: CanvasRenderingContext2D,
  item: BoardItem,
  options?: DrawOptions,
): void {
  if (item.type === 'text') drawText(ctx, item)
  else if (item.type === 'shape') drawShape(ctx, item)
  else drawStroke(ctx, item, options)
}

const HIT_PADDING = 4

export interface TextBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Bounding box of a committed text item, in canvas coordinates. */
export function textBounds(ctx: CanvasRenderingContext2D, item: TextItem): TextBounds {
  ctx.save()
  ctx.font = `${item.size}px ${TEXT_FONT}`
  const lines = item.text.split('\n')
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width))
  ctx.restore()
  return {
    x: item.x,
    y: item.y,
    width,
    height: lines.length * item.size * TEXT_LINE_HEIGHT,
  }
}

/** Topmost text item under the given point, or null. Strokes are not movable. */
export function hitTestText(
  ctx: CanvasRenderingContext2D,
  items: readonly BoardItem[],
  x: number,
  y: number,
): TextItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.type !== 'text') continue
    const box = textBounds(ctx, item)
    if (
      x >= box.x - HIT_PADDING &&
      x <= box.x + box.width + HIT_PADDING &&
      y >= box.y - HIT_PADDING &&
      y <= box.y + box.height + HIT_PADDING
    ) {
      return item
    }
  }
  return null
}

// A hundredth of a pixel is far below anything a screen shows, but the raw
// values from a pointer device serialise to 18 characters each - paid for on
// every point, on the wire and again on disk.
const round2 = (value: number): number => Math.round(value * 100) / 100

export function pointFromEvent(
  event: { clientX: number; clientY: number; pressure?: number },
  rect: DOMRect,
): Point {
  return [
    round2(event.clientX - rect.left),
    round2(event.clientY - rect.top),
    event.pressure && event.pressure > 0 ? round2(event.pressure) : 0.5,
  ]
}

const ARROW_HEAD_RATIO = 3.5
const ARROW_HEAD_MIN = 10

function strokeShapeStyle(ctx: CanvasRenderingContext2D, shape: ShapeItem): void {
  ctx.strokeStyle = shape.color
  ctx.lineWidth = shape.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeItem): void {
  const { x1, y1, x2, y2 } = shape
  ctx.save()
  strokeShapeStyle(ctx, shape)

  if (shape.shape === 'rect') {
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
  } else if (shape.shape === 'ellipse') {
    const rx = Math.abs(x2 - x1) / 2
    const ry = Math.abs(y2 - y1) / 2
    ctx.beginPath()
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    for (const segment of arrowSegments(shape)) {
      ctx.beginPath()
      ctx.moveTo(segment[0], segment[1])
      ctx.lineTo(segment[2], segment[3])
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Shaft plus the two head barbs, as `[x1, y1, x2, y2]` lines. */
export function arrowSegments(shape: ShapeItem): [number, number, number, number][] {
  const { x1, y1, x2, y2 } = shape
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const length = Math.hypot(x2 - x1, y2 - y1)
  const head = Math.min(Math.max(shape.size * ARROW_HEAD_RATIO, ARROW_HEAD_MIN), length)
  const spread = Math.PI / 7

  return [
    [x1, y1, x2, y2],
    [x2, y2, x2 - head * Math.cos(angle - spread), y2 - head * Math.sin(angle - spread)],
    [x2, y2, x2 - head * Math.cos(angle + spread), y2 - head * Math.sin(angle + spread)],
  ]
}
