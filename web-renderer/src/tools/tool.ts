import type { Vec2n, Vec3 } from 'wgpu-matrix'
import type { CommandDispatcher } from '../commands/commandDispatcher'
import type { MprRenderState } from '../mpr/mprState'
import type { ScalarVolume } from '../volume'
import type { BrushMode } from '../services/segmentationService'
import type { KeyModifiers, ToolInputEvent } from './toolInput'

export type ToolMode = 'active' | 'passive' | 'enabled' | 'disabled'

export type ToolBinding =
  | {
    readonly kind: 'drag'
    readonly button?: number
    readonly modifiers?: Partial<KeyModifiers>
  }
  | {
    readonly kind: 'wheel'
    readonly modifiers?: Partial<KeyModifiers>
  }
  | {
    readonly kind: 'hover'
  }
  | {
    readonly kind: 'key'
    readonly key?: string
    readonly code?: string
    readonly modifiers?: Partial<KeyModifiers>
  }

export interface ToolContext {
  commands: CommandDispatcher
  getActiveVolume(): ScalarVolume | null
  getBrushState(): {
    segmentationId: string
    label: number
    mode: BrushMode
    radiusMm: number
  } | null
  getWorldPoint(viewportId: string, clientPoint: Vec2n): Vec3 | null
  getBrushPreviewRadiusPx(viewportId: string, radiusMm: number): number | null
  onBrushPreviewChanged(preview: {
    viewportId: string
    clientPoint: Vec2n
    radiusPx: number
    mode: BrushMode
    valid: boolean
  } | null): void
  onCursorMove(viewportId: string, clientPoint: Vec2n): void
  onCursorLeave(): void
  onWindowLevelChanged(state: MprRenderState): void
}

export interface Tool {
  readonly id: string
}

export interface DragTool extends Tool {
  onDragStart?(event: ToolInputEvent, context: ToolContext): void
  onDrag(delta: Vec2n, event: ToolInputEvent, context: ToolContext): void
  onDragEnd?(event: ToolInputEvent, context: ToolContext): void
  onDragCancel?(event: ToolInputEvent, context: ToolContext): void
}

export interface WheelTool extends Tool {
  onWheel(event: ToolInputEvent, context: ToolContext): void
}

export interface HoverTool extends Tool {
  onMove(event: ToolInputEvent, context: ToolContext): void
}

export interface KeyTool extends Tool {
  onKeyDown?(event: ToolInputEvent, context: ToolContext): void
  onKeyUp?(event: ToolInputEvent, context: ToolContext): void
}
