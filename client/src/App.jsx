import { useEffect, useMemo, useState } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import { useBoard } from './hooks/useBoard'
import { resolveRoomFromUrl } from './lib/room'
import './App.css'

// The single size slider means a different thing for each tool.
const SIZE_RANGE = {
  pen: { label: '太さ', min: 1, max: 48 },
  eraser: { label: '消しゴム', min: 4, max: 96 },
  text: { label: '文字サイズ', min: 12, max: 96 },
}

export default function App() {
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#111827')
  const [sizes, setSizes] = useState({ pen: 8, eraser: 24, text: 24 })
  const room = useMemo(() => resolveRoomFromUrl(), [])
  const board = useBoard(room)

  const { undo, redo } = board

  useEffect(() => {
    const onKeyDown = (event) => {
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

  const sizeControl = { ...SIZE_RANGE[tool], value: sizes[tool] }
  const handleSizeChange = (value) => setSizes((prev) => ({ ...prev, [tool]: value }))

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
        room={room}
        status={board.status}
        peers={board.peers}
      />
      <main className="stage">
        <Canvas
          tool={tool}
          color={color}
          size={tool === 'eraser' ? sizes.eraser : sizes.pen}
          fontSize={sizes.text}
          items={board.items}
          liveStrokes={board.liveStrokes}
          onStrokeStart={board.startStroke}
          onStrokePoints={board.appendPoints}
          onStrokeComplete={board.completeStroke}
          onAddText={board.addItem}
          onMoveText={board.moveItem}
          onCommitMove={board.commitMove}
        />
      </main>
    </div>
  )
}
