import { getStroke } from 'perfect-freehand'

const BASE_OPTIONS = {
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t) => Math.sin((t * Math.PI) / 2),
  start: { taper: 0, cap: true },
  end: { taper: 0, cap: true },
}

// `last: false` keeps the tail of an in-progress stroke from being capped early.
export function strokeOptions(stroke, { last = true } = {}) {
  return {
    ...BASE_OPTIONS,
    size: stroke.size,
    simulatePressure: stroke.simulatePressure !== false,
    last,
  }
}

const average = (a, b) => (a + b) / 2

// Turns the outline points from perfect-freehand into a smooth SVG path.
function getSvgPathFromStroke(points, closed = true) {
  const len = points.length
  if (len < 4) return ''

  let a = points[0]
  let b = points[1]
  const c = points[2]

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(
    2,
  )} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`

  for (let i = 2; i < len - 1; i++) {
    a = points[i]
    b = points[i + 1]
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `
  }

  if (closed) result += 'Z'
  return result
}

export function drawStroke(ctx, stroke, { last = true } = {}) {
  if (!stroke || !stroke.points || stroke.points.length === 0) return
  const outline = getStroke(stroke.points, strokeOptions(stroke, { last }))
  const d = getSvgPathFromStroke(outline)
  if (!d) return
  ctx.fillStyle = stroke.color
  ctx.fill(new Path2D(d))
}
