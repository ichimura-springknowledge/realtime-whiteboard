const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

const randomRoomId = () => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .replace(/[^\w-]/g, '')
    .slice(0, 64)

/**
 * Reads ?room=xxx from the URL. When it is missing a room is generated and
 * written back with replaceState so the URL is always shareable.
 */
export function resolveRoomFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = normalize(params.get('room'))
  if (fromUrl) return fromUrl

  const room = randomRoomId()
  params.set('room', room)
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  return room
}
