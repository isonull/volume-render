import {
  MOVE_MPR_SLICE_COMMAND,
  PAN_MPR_PLANE_COMMAND,
  SYNC_WINDOW_LEVEL_COMMAND,
  WINDOW_LEVEL_COMMAND,
  ZOOM_MPR_PLANE_COMMAND,
} from '../commands/mprCommands'
import { EDIT_LABELMAP_COMMAND } from '../commands/segmentationCommands'
import { worldToIndex } from '../mpr/mprMath'
import type { Vec2n, Vec3, Vec3n } from 'wgpu-matrix'
import type { MprRenderState } from '../mpr/mprState'
import type { LabelmapVoxelEdit } from '../services/segmentationService'
import type { ScalarVolume } from '../volume'
import type { DragTool, HoverTool, ToolContext, WheelTool } from './tool'
import type { ToolInputEvent } from './toolInput'

export class PanTool implements DragTool {
  readonly id = 'mpr.pan'

  onDrag(delta: Vec2n, event: ToolInputEvent, context: ToolContext): void {
    context.commands.execute(PAN_MPR_PLANE_COMMAND, { viewportId: event.viewportId, delta })
  }
}

export class WindowLevelTool implements DragTool {
  readonly id = 'mpr.windowLevel'

  onDrag(delta: Vec2n, event: ToolInputEvent, context: ToolContext): void {
    const next = context.commands.execute<{ viewportId: string; delta: Vec2n }, MprRenderState | null>(
      WINDOW_LEVEL_COMMAND,
      { viewportId: event.viewportId, delta },
    )
    if (next) {
      context.onWindowLevelChanged(next)
    }
  }

  onDragEnd(event: ToolInputEvent, context: ToolContext): void {
    const source = context.commands.execute<{ sourceViewportId: string }, MprRenderState | null>(
      SYNC_WINDOW_LEVEL_COMMAND,
      { sourceViewportId: event.viewportId },
    )
    if (source) {
      context.onWindowLevelChanged(source)
    }
  }
}

export class StackScrollTool implements WheelTool {
  readonly id = 'mpr.stackScroll'

  onWheel(event: ToolInputEvent, context: ToolContext): void {
    const volume = context.getActiveVolume()
    if (!volume) {
      return
    }
    context.commands.execute(MOVE_MPR_SLICE_COMMAND, {
      viewportId: event.viewportId,
      deltaY: event.deltaY,
      volume,
    })
  }
}

export class ZoomTool implements WheelTool {
  readonly id = 'mpr.zoom'

  onWheel(event: ToolInputEvent, context: ToolContext): void {
    context.commands.execute(ZOOM_MPR_PLANE_COMMAND, {
      viewportId: event.viewportId,
      deltaY: event.deltaY,
    })
  }
}

export class ProbeTool implements HoverTool {
  readonly id = 'mpr.probe'

  onMove(event: ToolInputEvent, context: ToolContext): void {
    context.onCursorMove(event.viewportId, event.clientPoint)
  }
}

type BrushStroke = {
  segmentationId: string
  label: number
  volume: ScalarVolume
  radiusMm: number
  editsByOffset: Map<number, LabelmapVoxelEdit>
}

export class SegmentationBrushTool implements DragTool, HoverTool {
  readonly id = 'seg.brush'
  private stroke: BrushStroke | null = null

  onMove(event: ToolInputEvent, context: ToolContext): void {
    this.updatePreview(event, context)
    context.onCursorMove(event.viewportId, event.clientPoint)
  }

  onDragStart(event: ToolInputEvent, context: ToolContext): void {
    const brushState = context.getBrushState()
    const volume = context.getActiveVolume()
    if (!brushState || !volume) {
      this.stroke = null
      this.updatePreview(event, context)
      return
    }
    this.stroke = {
      segmentationId: brushState.segmentationId,
      label: brushState.mode === 'erase' ? 0 : brushState.label,
      volume,
      radiusMm: brushState.radiusMm,
      editsByOffset: new Map(),
    }
    this.updatePreview(event, context)
    this.stamp(event, context)
  }

  onDrag(_delta: Vec2n, event: ToolInputEvent, context: ToolContext): void {
    this.updatePreview(event, context)
    this.stamp(event, context)
  }

  onDragEnd(_event: ToolInputEvent, context: ToolContext): void {
    const stroke = this.stroke
    this.stroke = null
    context.onBrushPreviewChanged(null)
    if (!stroke || stroke.editsByOffset.size === 0) {
      return
    }
    context.commands.execute(EDIT_LABELMAP_COMMAND, {
      segmentationId: stroke.segmentationId,
      edits: [...stroke.editsByOffset.values()],
    })
  }

  onDragCancel(_event: ToolInputEvent, context: ToolContext): void {
    this.stroke = null
    context.onBrushPreviewChanged(null)
  }

  private stamp(event: ToolInputEvent, context: ToolContext): void {
    const stroke = this.stroke
    if (!stroke) {
      return
    }
    const centerWorld = context.getWorldPoint(event.viewportId, event.clientPoint)
    if (!centerWorld) {
      return
    }
    addSphereBrushEdits(stroke, centerWorld)
  }

  private updatePreview(event: ToolInputEvent, context: ToolContext): void {
    const brushState = context.getBrushState()
    if (!brushState) {
      context.onBrushPreviewChanged(null)
      return
    }
    const radiusPx = context.getBrushPreviewRadiusPx(event.viewportId, brushState.radiusMm)
    context.onBrushPreviewChanged({
      viewportId: event.viewportId,
      clientPoint: event.clientPoint,
      radiusPx: radiusPx ?? 0,
      mode: brushState.mode,
      valid: radiusPx !== null && context.getWorldPoint(event.viewportId, event.clientPoint) !== null,
    })
  }
}

function addSphereBrushEdits(stroke: BrushStroke, centerWorld: Vec3): void {
  const { volume, radiusMm } = stroke
  const centerIndex = worldToIndex(centerWorld, volume)
  const spacing = indexAxisSpacing(volume)
  const radiusIndex: Vec3n = [
    Math.ceil(radiusMm / spacing[0]),
    Math.ceil(radiusMm / spacing[1]),
    Math.ceil(radiusMm / spacing[2]),
  ]
  const min: Vec3n = [
    Math.max(0, Math.floor(centerIndex[0] - radiusIndex[0])),
    Math.max(0, Math.floor(centerIndex[1] - radiusIndex[1])),
    Math.max(0, Math.floor(centerIndex[2] - radiusIndex[2])),
  ]
  const max: Vec3n = [
    Math.min(volume.shape[0] - 1, Math.ceil(centerIndex[0] + radiusIndex[0])),
    Math.min(volume.shape[1] - 1, Math.ceil(centerIndex[1] + radiusIndex[1])),
    Math.min(volume.shape[2] - 1, Math.ceil(centerIndex[2] + radiusIndex[2])),
  ]

  for (let z = min[2]; z <= max[2]; z += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let x = min[0]; x <= max[0]; x += 1) {
        const voxelCenterWorld = indexToWorld([x, y, z], volume)
        if (distance3(voxelCenterWorld, centerWorld) > radiusMm) {
          continue
        }
        stroke.editsByOffset.set(voxelOffset(volume.shape, x, y, z), {
          index: [x, y, z],
          label: stroke.label,
        })
      }
    }
  }
}

function indexAxisSpacing(volume: ScalarVolume): Vec3n {
  const m = volume.indexToWorld
  return [
    Math.max(1e-6, Math.hypot(m[0], m[1], m[2])),
    Math.max(1e-6, Math.hypot(m[4], m[5], m[6])),
    Math.max(1e-6, Math.hypot(m[8], m[9], m[10])),
  ]
}

function indexToWorld(index: Vec3n, volume: ScalarVolume): Vec3n {
  const m = volume.indexToWorld
  return [
    m[0] * index[0] + m[4] * index[1] + m[8] * index[2] + m[12],
    m[1] * index[0] + m[5] * index[1] + m[9] * index[2] + m[13],
    m[2] * index[0] + m[6] * index[1] + m[10] * index[2] + m[14],
  ]
}

function voxelOffset(shape: Vec3n, x: number, y: number, z: number): number {
  return x + shape[0] * (y + shape[1] * z)
}

function distance3(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
