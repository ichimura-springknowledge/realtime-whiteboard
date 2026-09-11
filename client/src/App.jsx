import { useMemo, useState } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import { useBoard } from './hooks/useBoard'
import { resolveRoomFromUrl } from './lib/room'
import './App.css'

export default function App() {
  const [color, setColor] = useState('#111827')
  const [size, setSize] = useState(8)
  const room = useMemo(() => resolveRoomFromUrl(), [])
  const board = useBoard(room)

  return (
    <div className="app">
      <Toolbar
        color={color}
        onColorChange={setColor}
        size={size}
        onSizeChange={setSize}
        onClear={board.clearBoard}
        room={room}
        status={board.status}
        peers={board.peers}
      />
      <main className="stage">
        <Canvas
          color={color}
          size={size}
          strokes={board.strokes}
          liveStrokes={board.liveStrokes}
          onStrokeStart={board.startStroke}
          onStrokePoints={board.appendPoints}
          onStrokeComplete={board.completeStroke}
        />
      </main>
    </div>
  )
}
