import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { TEXT_FONT, TEXT_LINE_HEIGHT } from '../lib/draw'
import type { TextDraft } from '../types'

interface TextEditorProps {
  draft: TextDraft
  onChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
}

/**
 * A single-line input laid over the canvas at the click position, styled to
 * match how the committed text will be painted. Enter commits, Escape cancels,
 * and moving focus elsewhere (the toolbar, say) commits whatever was typed.
 */
export default function TextEditor({ draft, onChange, onCommit, onCancel }: TextEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      className="text-editor"
      value={draft.text}
      placeholder="文字を入力"
      style={{
        left: `${draft.x}px`,
        top: `${draft.y}px`,
        color: draft.color,
        font: `${draft.size}px ${TEXT_FONT}`,
        lineHeight: TEXT_LINE_HEIGHT,
      }}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCommit}
    />
  )
}
