import type { PeerCursor } from '../types'

/**
 * Other participants' pointers, drawn as DOM nodes over the canvas rather than
 * painted into it — they move constantly, and the board should not be redrawn
 * just because someone waved their mouse.
 */
export default function PeerCursors({ cursors }: { cursors: PeerCursor[] }) {
  return (
    <div className="cursors" aria-hidden="true">
      {cursors.map((cursor) => (
        <svg
          key={cursor.id}
          className="cursor"
          style={{ left: `${cursor.x}px`, top: `${cursor.y}px` }}
          width="20"
          height="20"
          viewBox="0 0 20 20"
        >
          <path
            d="M2 2 L2 15 L6 11.5 L8.5 17 L11 16 L8.5 10.8 L13.5 10.5 Z"
            fill={cursor.color}
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </div>
  )
}
