import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import { useBoard } from './hooks/useBoard'
import {
  canvasToPngBlob,
  downloadBlob,
  exportFilename,
  renderToCanvas,
  renderToSvg,
} from './lib/export'
import { resolveRoomFromUrl } from './lib/room'
import type { Tool } from './types'
import './App.css'

/** Tools that share one slider value: every shape uses the same line width. */
type SizeKey = 'pen' | 'eraser' | 'text' | 'shape'

const SIZE_KEY: Record<Tool, SizeKey> = {
  pen: 'pen',
  eraser: 'eraser',
  text: 'text',
  rect: 'shape',
  ellipse: 'shape',
  arrow: 'shape',
}

// The single size slider means a different thing for each tool.
const SIZE_RANGE: Record<SizeKey, { label: string; min: number; max: number }> = {
  pen: { label: '太さ', min: 1, max: 48 },
  eraser: { label: '消しゴム', min: 4, max: 96 },
  text: { label: '文字サイズ', min: 12, max: 96 },
  shape: { label: '線の太さ', min: 1, max: 24 },
}

export default function App() {
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#111827')
  const [sizes, setSizes] = useState<Record<SizeKey, number>>({
    pen: 8,
    eraser: 24,
    text: 24,
    shape: 4,
  })
  const room = useMemo(() => resolveRoomFromUrl(), [])
  const board = useBoard(room)
  const [exporting, setExporting] = useState(false)
  const boardSizeRef = useRef({ width: 0, height: 0 })

  const { undo, redo } = board

  const handleExport = useCallback(
    async (format: 'png' | 'svg') => {
      setExporting(true)
      try {
        const size = boardSizeRef.current
        if (format === 'svg') {
          const svg = renderToSvg(board.items, size)
          downloadBlob(
            new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
            exportFilename(room, 'svg'),
          )
        } else {
          const blob = await canvasToPngBlob(renderToCanvas(board.items, size))
          downloadBlob(blob, exportFilename(room, 'png'))
        }
      } catch (error) {
        window.alert(`書き出しに失敗しました: ${error instanceof Error ? error.message : error}`)
      } finally {
        setExporting(false)
      }
    },
    [board.items, room],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isUndoKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'
      if (!isUndoKey) return
      // Let the browser handle undo while text is being typed.
      if (event.target instanceof HTMLInputElement) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const sizeKey = SIZE_KEY[tool]
  const sizeControl = { ...SIZE_RANGE[sizeKey], value: sizes[sizeKey] }
  const handleSizeChange = (value: number) => setSizes((prev) => ({ ...prev, [sizeKey]: value }))

  return (
    <div className="app">
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        sizeControl={sizeControl}
        onSizeChange={handleSizeChange}
        canUndo={board.canUndo}
        canRedo={board.canRedo}
        onUndo={board.undo}
        onRedo={board.redo}
        onClear={board.clearBoard}
        onExport={handleExport}
        exporting={exporting}
        room={room}
        status={board.status}
        peers={board.peers}
      />
      <main className="stage">
        <Canvas
          tool={tool}
          color={color}
          size={sizes[sizeKey]}
          fontSize={sizes.text}
          items={board.items}
          liveItems={board.liveItems}
          cursors={board.cursors}
          onStrokeStart={board.startStroke}
          onStrokePoints={board.appendPoints}
          onStrokeComplete={board.completeStroke}
          onShapePreview={board.previewShape}
          onCursorMove={board.moveCursor}
          onCursorLeave={board.leaveCursor}
          onSizeChange={(size) => {
            boardSizeRef.current = size
          }}
          onAddItem={board.addItem}
          onMoveText={board.moveItem}
          onCommitMove={board.commitMove}
        />
      </main>
    </div>
  )
}
