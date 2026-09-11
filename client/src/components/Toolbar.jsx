const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']

export default function Toolbar({ color, onColorChange, size, onSizeChange, onClear }) {
  return (
    <header className="toolbar">
      <span className="toolbar__title">Whiteboard</span>

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
        太さ
        <input
          type="range"
          min="1"
          max="48"
          value={size}
          onChange={(event) => onSizeChange(Number(event.target.value))}
        />
        <span className="toolbar__size-value">{size}</span>
      </label>

      <button type="button" className="button" onClick={onClear}>
        全消去
      </button>
    </header>
  )
}
