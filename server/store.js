'use strict'

const fs = require('node:fs')
const path = require('node:path')

const FORMAT_VERSION = 1

/**
 * Keeps the boards on disk so nothing is lost when everyone closes their
 * browser, or when the server itself is restarted.
 *
 * Writes are debounced and atomic (temp file + rename), so a crash mid-save
 * cannot leave a half-written board behind.
 */
function createStore({ file, debounceMs = 1000 }) {
  const directory = path.dirname(file)
  let timer = null
  let source = null

  const load = () => {
    if (!fs.existsSync(file)) return new Map()
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const rooms = parsed?.rooms
      if (!rooms || typeof rooms !== 'object') return new Map()

      const restored = new Map()
      for (const [roomId, items] of Object.entries(rooms)) {
        if (!Array.isArray(items)) continue
        restored.set(roomId, { items, live: new Map() })
      }
      return restored
    } catch (error) {
      // A corrupt file must not stop the server; keep it aside and start clean.
      const backup = `${file}.broken-${Date.now()}`
      console.error(`保存ファイルを読めませんでした (${error.message})。${backup} に退避します`)
      try {
        fs.renameSync(file, backup)
      } catch {
        /* best effort */
      }
      return new Map()
    }
  }

  const writeNow = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!source) return

    const rooms = {}
    for (const [roomId, room] of source) {
      if (room.items.length > 0) rooms[roomId] = room.items
    }

    const payload = JSON.stringify({ version: FORMAT_VERSION, savedAt: Date.now(), rooms })
    const temp = `${file}.tmp`
    try {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(temp, payload)
      fs.renameSync(temp, file)
    } catch (error) {
      console.error(`保存に失敗しました: ${error.message}`)
    }
  }

  /** Call after any change; the actual write is coalesced. */
  const save = (rooms) => {
    source = rooms
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      writeNow()
    }, debounceMs)
    // Never hold the process open just for a pending save.
    if (typeof timer.unref === 'function') timer.unref()
  }

  return { file, load, save, flush: writeNow }
}

module.exports = { createStore }
