/**
 * Copies text to the clipboard, in a secure context or not.
 *
 * `navigator.clipboard` only exists on HTTPS and localhost. The board is served
 * over plain HTTP on the office LAN, where the property is simply missing — so
 * the invite button has to fall back to the old selection-based copy.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied or unavailable; the fallback below still tends to work.
    }
  }

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off-screen but still focusable, and fixed so selecting it cannot scroll the page.
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  document.body.append(area)

  const previous = document.activeElement
  try {
    area.focus()
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    if (previous instanceof HTMLElement) previous.focus()
  }
}
