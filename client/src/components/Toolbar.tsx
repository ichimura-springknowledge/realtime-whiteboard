import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ConnectionStatus, Tool } from '../types'

const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'pen', label: 'ペン', hint: 'ドラッグで描画' },
  { id: 'eraser', label: '消しゴム', hint: 'なぞった部分を消す' },
  { id: 'text', label: '文字', hint: 'クリックで入力 / 既存の文字はドラッグで移動' },
  { id: 'rect', label: '□', hint: '四角: ドラッグで対角を決める' },
  { id: 'ellipse', label: '○', hint: '丸: ドラッグで外接する四角を決める' },
  { id: 'arrow', label: '↗', hint: '矢印: 始点から終点へドラッグ' },
]

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: '接続中…',
  connected: '接続済み',
  disconnected: '切断',
  offline: 'サーバー未接続',
}

export interface SizeControl {
  label: string
  min: number
  max: number
  value: number
}

interface ToolbarProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
  color: string
  onColorChange: (color: string) => void
  sizeControl: SizeControl
  onSizeChange: (size: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  room: string
  status: ConnectionStatus
  peers: number
}

export default function Toolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  sizeControl,
  onSizeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  room,
  status,
  peers,
}: ToolbarProps) {
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('この URL を共有してください', window.location.href)
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar__group" role="group" aria-label="ツール">
        {TOOLS.map(({ id, label, hint }) => (
          <button
            key={id}
            type="button"
            className={`tool${id === tool ? ' tool--active' : ''}`}
            aria-pressed={id === tool}
            title={hint}
            onClick={() => onToolChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar__group" role="group" aria-label="色">
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            className={`swatch${value === color ? ' swatch--active' : ''}`}
            style={{ '--swatch': value } as CSSProperties}
            aria-label={`色 ${value}`}
            aria-pressed={value === color}
            onClick={() => onColorChange(value)}
          />
        ))}
        <label className="swatch swatch--custom" aria-label="任意の色">
          <input
            type="color"
            value={color}
            onChange={(event) => onColorChange(event.target.value)}
          />
        </label>
      </div>

      <label className="toolbar__group toolbar__size">
        {sizeControl.label}
        <input
          type="range"
          min={sizeControl.min}
          max={sizeControl.max}
          value={sizeControl.value}
          onChange={(event) => onSizeChange(Number(event.target.value))}
        />
        <span className="toolbar__size-value">{sizeControl.value}</span>
      </label>

      <div className="toolbar__group">
        <button
          type="button"
          className="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="一手戻る (Ctrl+Z)"
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          className="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="やり直す (Ctrl+Shift+Z)"
        >
          ↷ やり直す
        </button>
        <button type="button" className="button" onClick={onClear}>
          全消去
        </button>
      </div>

      <div className="toolbar__room">
        <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
        <span className="toolbar__room-name">room: {room}</span>
        <span className="toolbar__peers">{peers}人</span>
        <button type="button" className="button" onClick={copyLink}>
          {copied ? 'コピーしました' : '招待リンク'}
        </button>
      </div>
    </header>
  )
}
