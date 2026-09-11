import { useCallback, useState } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import './App.css'

export default function App() {
  const [color, setColor] = useState('#111827')
  const [size, setSize] = useState(8)
  const [strokes, setStrokes] = useState([])

  const handleStrokeComplete = useCallback((stroke) => {
    setStrokes((prev) => [...prev, stroke])
  }, [])

  const handleClear = useCallback(() => setStrokes([]), [])

  return (
    <div className="app">
      <Toolbar
        color={color}
        onColorChange={setColor}
        size={size}
        onSizeChange={setSize}
        onClear={handleClear}
      />
      <main className="stage">
        <Canvas color={color} size={size} strokes={strokes} onStrokeComplete={handleStrokeComplete} />
      </main>
    </div>
  )
}
