'use strict'

/**
 * Restricts the whiteboard to machines on the local network.
 *
 * This is a network boundary, not authentication: anyone who can join the same
 * Wi-Fi can reach the board. It keeps the internet out, nothing more.
 */

// RFC1918 private ranges, plus loopback and link-local.
const DEFAULT_IPV4_CIDRS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
]

/** Strips the IPv4-mapped IPv6 prefix and any zone id. */
function normalizeAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return null
  let value = address.trim()
  const zone = value.indexOf('%')
  if (zone !== -1) value = value.slice(0, zone)
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length)
  return value.toLowerCase()
}

function parseIPv4(value) {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const byte = Number(part)
    if (byte > 255) return null
    result = (result << 8) | byte
  }
  return result >>> 0
}

function parseCidr(text) {
  const [network, bitsText] = String(text).trim().split('/')
  const base = parseIPv4(network)
  if (base === null) return null
  const bits = bitsText === undefined ? 32 : Number(bitsText)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return { base: (base & mask) >>> 0, mask }
}

function parseCidrList(text) {
  return String(text)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const cidr = parseCidr(entry)
      if (!cidr) throw new Error(`ALLOWED_CIDRS に不正な指定があります: "${entry}"`)
      return cidr
    })
}

/** Loopback and the private/link-local IPv6 ranges that mirror the IPv4 list. */
function isPrivateIPv6(value) {
  if (value === '::1' || value === '::') return true
  const prefix = value.slice(0, 2)
  // fc00::/7 (unique local) and fe80::/10 (link local).
  return prefix === 'fc' || prefix === 'fd' || prefix === 'fe'
}

/**
 * Builds the guard. `allowedCidrs` (comma separated, IPv4) replaces the default
 * private ranges; loopback stays allowed either way so the host machine and its
 * own health checks keep working.
 */
function createAccessGuard({ allowedCidrs } = {}) {
  const configured = allowedCidrs ? parseCidrList(allowedCidrs) : null
  const ranges = configured
    ? [parseCidr('127.0.0.0/8'), ...configured]
    : DEFAULT_IPV4_CIDRS.map(parseCidr)

  const isAllowed = (address) => {
    const value = normalizeAddress(address)
    if (!value) return false

    const ipv4 = parseIPv4(value)
    if (ipv4 === null) {
      // Custom ranges are IPv4 only, so IPv6 clients are held to loopback/ULA.
      return isPrivateIPv6(value)
    }
    return ranges.some(({ base, mask }) => ((ipv4 & mask) >>> 0) === base)
  }

  isAllowed.describe = () =>
    configured ? allowedCidrs : `プライベートアドレス全体 (${DEFAULT_IPV4_CIDRS.join(', ')})`

  return isAllowed
}

module.exports = { createAccessGuard, normalizeAddress, parseCidr, parseIPv4 }
