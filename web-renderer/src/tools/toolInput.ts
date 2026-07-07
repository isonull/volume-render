import type { Vec2n } from 'wgpu-matrix'

export type ToolInputType =
  | 'pointerDown'
  | 'pointerMove'
  | 'pointerUp'
  | 'pointerCancel'
  | 'wheel'
  | 'keyDown'
  | 'keyUp'
  | 'point'

export interface KeyModifiers {
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export interface ToolInputEvent {
  type: ToolInputType
  viewportId: string
  clientPoint: Vec2n
  button: number
  buttons: number
  deltaY: number
  key?: string
  code?: string
  repeat?: boolean
  pointerId?: number
  modifiers: KeyModifiers
}

export function modifiersFromEvent(event: MouseEvent | PointerEvent | WheelEvent | KeyboardEvent): KeyModifiers {
  return {
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  }
}
