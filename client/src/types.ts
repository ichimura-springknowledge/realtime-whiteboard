/** The shapes a board holds, and the events that move them between clients. */

/** `[x, y, pressure]`, matching what perfect-freehand expects. */
export type Point = [number, number, number]

export interface StrokeItem {
  id: string
  type: 'stroke'
  color: string
  size: number
  simulatePressure: boolean
  erase: boolean
  points: Point[]
}

export interface TextItem {
  id: string
  type: 'text'
  color: string
  size: number
  x: number
  y: number
  text: string
}

export type ShapeKind = 'rect' | 'ellipse' | 'arrow'

/** Drawn by dragging from one corner (or tail) to the other. */
export interface ShapeItem {
  id: string
  type: 'shape'
  shape: ShapeKind
  color: string
  size: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A pasted or dropped picture. `src` is a path this server handed out. */
export interface ImageItem {
  id: string
  type: 'image'
  src: string
  x: number
  y: number
  width: number
  height: number
}

export type BoardItem = StrokeItem | TextItem | ShapeItem | ImageItem

/** Items that are shown while someone is still drawing them. */
export type LiveItem = StrokeItem | ShapeItem

export type Tool = 'pen' | 'eraser' | 'text' | ShapeKind

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'offline'

export interface Position {
  x: number
  y: number
}

/** An in-progress text item: it lives in the editor overlay until committed. */
export interface TextDraft extends Position {
  color: string
  size: number
  text: string
}

/** Undo walks these: what I added, and what I moved. */
export type BoardAction =
  | { type: 'add'; id: string }
  | { type: 'move'; id: string; from: Position; to: Position }

/** A redone add needs the item itself, since it is no longer on the board. */
export type RedoAction =
  | { type: 'add'; id: string; item: BoardItem }
  | { type: 'move'; id: string; from: Position; to: Position }

/** Another participant's pointer. Never stored: it goes when they do. */
export interface PeerCursor {
  id: string
  x: number
  y: number
  color: string
}

export interface ServerToClientEvents {
  'board:init': (payload: { room: string; items: BoardItem[] }) => void
  'room:peers': (count: number) => void
  'stroke:start': (stroke: StrokeItem) => void
  'stroke:points': (payload: { id: string; points: Point[] }) => void
  'stroke:cancel': (payload: { id: string }) => void
  'shape:preview': (shape: ShapeItem) => void
  'item:add': (item: BoardItem) => void
  'item:move': (payload: { id: string; x: number; y: number }) => void
  'item:remove': (payload: { id: string }) => void
  'board:clear': () => void
  'cursor:move': (cursor: PeerCursor) => void
  'cursor:leave': (payload: { id: string }) => void
}

export interface ClientToServerEvents {
  'stroke:start': (stroke: StrokeItem) => void
  'stroke:points': (payload: { id: string; points: Point[] }) => void
  'stroke:end': (stroke: StrokeItem) => void
  'shape:preview': (shape: ShapeItem) => void
  'item:add': (item: BoardItem) => void
  'item:move': (payload: { id: string; x: number; y: number }) => void
  'item:remove': (payload: { id: string }) => void
  'board:clear': () => void
  'cursor:move': (payload: { x: number; y: number }) => void
  'cursor:leave': () => void
}
