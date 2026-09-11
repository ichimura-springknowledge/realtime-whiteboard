import { useState } from 'react'

const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']

const TOOLS = [
  { id: 'pen', label: 'ペン', hint: 'ドラッグで描画' },
  { id: 'eraser', label: '消しゴム', hint: 'なぞった部分を消す' },
  { id: 'text', label: '文字', hint: 'クリックで入力 / 既存の文字はドラッグで移動' },
]

const STATUS_LABEL = {
  connecting: '接続中…',
  connected: '接続済み',
  disconnected: '切断',
  offline: 'サーバー未接続',
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
}) {
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
            style={{ '--swatch': value }}
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
        <span className={`status status--${status}`}>{STATUS_LABEL[status] ?? status}</span>
        <span className="toolbar__room-name">room: {room}</span>
        <span className="toolbar__peers">{peers}人</span>
        <button type="button" className="button" onClick={copyLink}>
          {copied ? 'コピーしました' : '招待リンク'}
        </button>
      </div>
    </header>
  )
}
