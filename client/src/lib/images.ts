import type { ImageItem } from '../types'

/** Pasted screenshots are often far larger than a board needs. */
const MAX_UPLOAD_EDGE = 1600
/** How big a picture appears when it lands on the board, in CSS pixels. */
const MAX_PLACED_EDGE = 420
const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export const isSupportedImage = (file: File | null | undefined): boolean =>
  Boolean(file && UPLOAD_TYPES.has(file.type))

/** Where the pictures live. In dev the client is served by Vite, not the board server. */
export function imageUrl(src: string, serverUrl: string | undefined): string {
  return serverUrl ? `${serverUrl.replace(/\/$/, '')}${src}` : src
}

interface Decoded {
  blob: Blob
  width: number
  height: number
}

/**
 * Decodes the file and, if it is bigger than the board will ever need, re-encodes
 * it smaller. A phone photo is several thousand pixels wide and megabytes large;
 * sending that as-is would hold up everyone else in the room.
 */
async function prepare(file: File): Promise<Decoded> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1) {
    const decoded = { blob: file, width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return decoded
  }

  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像を縮小できませんでした')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // PNG keeps screenshots and line art crisp; JPEG would smear the text in them.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('画像を縮小できませんでした')
  return { blob, width, height }
}

export interface UploadTarget {
  /** Server origin, or undefined when the page is served by the board server. */
  serverUrl: string | undefined
}

/** Uploads the picture and returns the item to place on the board. */
export async function uploadImage(
  file: File,
  id: string,
  centre: { x: number; y: number },
  { serverUrl }: UploadTarget,
): Promise<ImageItem> {
  const { blob, width, height } = await prepare(file)

  const endpoint = serverUrl ? `${serverUrl.replace(/\/$/, '')}/images` : '/images'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.error ?? `画像を送れませんでした (HTTP ${response.status})`)
  }
  const { src } = (await response.json()) as { src: string }

  const scale = Math.min(1, MAX_PLACED_EDGE / Math.max(width, height))
  const placedWidth = Math.round(width * scale)
  const placedHeight = Math.round(height * scale)

  return {
    id,
    type: 'image',
    src,
    x: Math.round(centre.x - placedWidth / 2),
    y: Math.round(centre.y - placedHeight / 2),
    width: placedWidth,
    height: placedHeight,
  }
}
