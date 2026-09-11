import { getStroke } from 'perfect-freehand'
import {
  TEXT_FONT,
  TEXT_LINE_HEIGHT,
  arrowSegments,
  drawItem,
  getSvgPathFromStroke,
  strokeOptions,
} from './draw'
import type { BoardItem, ShapeItem, StrokeItem, TextItem } from '../types'

export const EXPORT_BACKGROUND = '#ffffff'

export interface ExportSize {
  width: number
  height: number
}

function createLayer(size: ExportSize, scale: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(size.width * scale))
  canvas.height = Math.max(1, Math.round(size.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas の描画コンテキストを取得できませんでした')
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  return { canvas, ctx }
}

/**
 * Renders the board onto a fresh canvas with a solid background, rather than
 * reusing the on-screen one — that is transparent (the white comes from CSS)
 * and is sized for the current device pixel ratio.
 *
 * The items go on a transparent layer first and the background goes underneath
 * afterwards. Drawing them straight onto the background would let the eraser,
 * which works by clearing pixels, punch holes through the background as well.
 */
export function renderToCanvas(items: readonly BoardItem[], size: ExportSize, scale = 2) {
  const layer = createLayer(size, scale)
  for (const item of items) drawItem(layer.ctx, item)

  const output = createLayer(size, scale)
  output.ctx.fillStyle = EXPORT_BACKGROUND
  output.ctx.fillRect(0, 0, size.width, size.height)
  output.ctx.drawImage(layer.canvas, 0, 0, size.width, size.height)

  return output.canvas
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG を生成できませんでした'))
    }, 'image/png')
  })
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function strokeToSvg(stroke: StrokeItem, fill: string): string {
  const outline = getStroke(stroke.points as unknown as number[][], strokeOptions(stroke))
  const d = getSvgPathFromStroke(outline)
  return d ? `<path d="${d}" fill="${fill}"/>` : ''
}

function textToSvg(item: TextItem): string {
  const lines = item.text.split('\n')
  const spans = lines
    .map((line, index) => {
      const y = item.y + index * item.size * TEXT_LINE_HEIGHT
      return `<tspan x="${item.x}" y="${y}">${escapeXml(line)}</tspan>`
    })
    .join('')
  return `<text font-family="${escapeXml(TEXT_FONT)}" font-size="${item.size}" fill="${item.color}" dominant-baseline="text-before-edge">${spans}</text>`
}

function shapeToSvg(shape: ShapeItem): string {
  const common = `fill="none" stroke="${shape.color}" stroke-width="${shape.size}" stroke-linecap="round" stroke-linejoin="round"`
  const { x1, y1, x2, y2 } = shape

  if (shape.shape === 'rect') {
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    return `<rect x="${x}" y="${y}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" ${common}/>`
  }
  if (shape.shape === 'ellipse') {
    return `<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${Math.abs(x2 - x1) / 2}" ry="${Math.abs(y2 - y1) / 2}" ${common}/>`
  }
  const d = arrowSegments(shape)
    .map(([ax, ay, bx, by]) => `M${ax} ${ay}L${bx} ${by}`)
    .join('')
  return `<path d="${d}" ${common}/>`
}

/**
 * SVG has no equivalent of the canvas `destination-out` the eraser relies on,
 * so each eraser stroke becomes a mask: everything drawn *before* it is wrapped
 * in a group that the eraser's own shape punches a hole in. Content added after
 * the eraser sits outside that group and is left alone, which is exactly how
 * the eraser behaves on screen.
 */
export function renderToSvg(items: readonly BoardItem[], size: ExportSize): string {
  let content: string[] = []
  const masks: string[] = []

  for (const item of items) {
    if (item.type === 'stroke' && item.erase) {
      if (content.length === 0) continue
      const maskId = `erase-${masks.length}`
      const hole = strokeToSvg(item, '#000000')
      masks.push(
        `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${size.width}" height="${size.height}">` +
          `<rect x="0" y="0" width="${size.width}" height="${size.height}" fill="#ffffff"/>${hole}</mask>`,
      )
      content = [`<g mask="url(#${maskId})">${content.join('')}</g>`]
      continue
    }

    if (item.type === 'text') content.push(textToSvg(item))
    else if (item.type === 'shape') content.push(shapeToSvg(item))
    else content.push(strokeToSvg(item, item.color))
  }

  const defs = masks.length ? `<defs>${masks.join('')}</defs>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" ` +
    `viewBox="0 0 ${size.width} ${size.height}">` +
    `${defs}<rect width="100%" height="100%" fill="${EXPORT_BACKGROUND}"/>${content.join('')}</svg>`
  )
}

/** Hands the file to the browser's downloader. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function exportFilename(room: string, extension: string): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `whiteboard-${room}-${stamp}.${extension}`
}
