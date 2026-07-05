import { vec3 } from 'wgpu-matrix'
import { cloneMprState, createInitialMprState, valueRange } from '../mpr/mprState'
import { sliceStepSize } from '../mpr/mprMath'
import type { Vec2n } from 'wgpu-matrix'
import type { Command, CommandContext } from './commandDispatcher'
import type { MprOrientation, MprRenderState } from '../mpr/mprState'
import type { ScalarVolume } from '../volume'

export const SET_MPR_RENDER_STATE_COMMAND = 'mpr.setRenderState'
export const CENTER_VOLUME_COMMAND = 'mpr.centerVolume'
export const PAN_MPR_PLANE_COMMAND = 'mpr.panPlane'
export const MOVE_MPR_SLICE_COMMAND = 'mpr.moveSlice'
export const ZOOM_MPR_PLANE_COMMAND = 'mpr.zoomPlane'
export const WINDOW_LEVEL_COMMAND = 'mpr.windowLevel'
export const SYNC_WINDOW_LEVEL_COMMAND = 'mpr.syncWindowLevel'
export const SET_OVERLAY_SEGMENTATION_COMMAND = 'mpr.setOverlaySegmentation'

export class SetMprRenderStateCommand implements Command<{ viewportId: string; state: MprRenderState }, void> {
  readonly id = SET_MPR_RENDER_STATE_COMMAND

  execute(options: { viewportId: string; state: MprRenderState }, context: CommandContext): void {
    context.viewportService.setRenderState(options.viewportId, options.state)
    context.renderService.requestRender(options.viewportId)
  }
}

export class CenterVolumeCommand implements Command<{
  volume: ScalarVolume
  viewportIds: MprOrientation[]
  activeSegmentationId?: string | null
  windowMin?: number
  windowMax?: number
}, void> {
  readonly id = CENTER_VOLUME_COMMAND

  execute(options: {
    volume: ScalarVolume
    viewportIds: MprOrientation[]
    activeSegmentationId?: string | null
    windowMin?: number
    windowMax?: number
  }, context: CommandContext): void {
    const [min, max] = valueRange(options.volume)
    for (const viewportId of options.viewportIds) {
      const viewport = context.viewportService.getViewport(viewportId)
      if (!viewport) {
        continue
      }
      viewport.resizeFromClient()
      const canvasPixels = Math.min(viewport.width, viewport.height)
      const state = createInitialMprState(options.volume, viewportId, canvasPixels)
      state.image.windowMin = options.windowMin ?? min
      state.image.windowMax = options.windowMax ?? max
      if (
        options.activeSegmentationId &&
        context.sceneService.scene?.segmentations.get(options.activeSegmentationId)?.sourceVolumeId === options.volume.id
      ) {
        state.overlay = {
          segmentationId: options.activeSegmentationId,
          visible: true,
        }
      }
      context.viewportService.setRenderState(viewportId, state)
      context.renderService.requestRender(viewportId)
    }
  }
}

export class PanMprPlaneCommand implements Command<{ viewportId: string; delta: Vec2n }, void> {
  readonly id = PAN_MPR_PLANE_COMMAND

  execute(options: { viewportId: string; delta: Vec2n }, context: CommandContext): void {
    const state = context.viewportService.getRenderState(options.viewportId)
    if (!state) {
      return
    }
    const next = cloneMprState(state)
    next.plane.origin = vec3.addScaled(
      next.plane.origin,
      next.plane.right,
      -options.delta[0] * next.plane.pixelSize,
    )
    next.plane.origin = vec3.addScaled(
      next.plane.origin,
      next.plane.up,
      options.delta[1] * next.plane.pixelSize,
    )
    context.viewportService.setRenderState(options.viewportId, next)
    context.renderService.requestRender(options.viewportId)
  }
}

export class MoveMprSliceCommand implements Command<{ viewportId: string; deltaY: number; volume: ScalarVolume }, void> {
  readonly id = MOVE_MPR_SLICE_COMMAND

  execute(options: { viewportId: string; deltaY: number; volume: ScalarVolume }, context: CommandContext): void {
    const state = context.viewportService.getRenderState(options.viewportId)
    const direction = Math.sign(options.deltaY)
    if (!state || direction === 0) {
      return
    }
    const next = cloneMprState(state)
    const normal = vec3.normalize(vec3.cross(next.plane.right, next.plane.up))
    next.plane.origin = vec3.addScaled(next.plane.origin, normal, direction * sliceStepSize(normal, options.volume))
    context.viewportService.setRenderState(options.viewportId, next)
    context.renderService.requestRender(options.viewportId)
  }
}

export class ZoomMprPlaneCommand implements Command<{ viewportId: string; deltaY: number }, void> {
  readonly id = ZOOM_MPR_PLANE_COMMAND

  execute(options: { viewportId: string; deltaY: number }, context: CommandContext): void {
    const state = context.viewportService.getRenderState(options.viewportId)
    if (!state) {
      return
    }
    const next = cloneMprState(state)
    next.plane.pixelSize = Math.max(1e-6, next.plane.pixelSize * Math.exp(options.deltaY * 0.001))
    context.viewportService.setRenderState(options.viewportId, next)
    context.renderService.requestRender(options.viewportId)
  }
}

export class WindowLevelCommand implements Command<{ viewportId: string; delta: Vec2n }, MprRenderState | null> {
  readonly id = WINDOW_LEVEL_COMMAND

  execute(options: { viewportId: string; delta: Vec2n }, context: CommandContext): MprRenderState | null {
    const state = context.viewportService.getRenderState(options.viewportId)
    if (!state) {
      return null
    }
    const next = cloneMprState(state)
    const width = Math.max(1e-6, next.image.windowMax - next.image.windowMin)
    const center = (next.image.windowMax + next.image.windowMin) * 0.5
    const nextCenter = center + options.delta[0] * width * 0.005
    const nextWidth = Math.max(1e-6, width * Math.exp(options.delta[1] * 0.005))
    next.image.windowMin = nextCenter - nextWidth * 0.5
    next.image.windowMax = nextCenter + nextWidth * 0.5
    context.viewportService.setRenderState(options.viewportId, next)
    context.renderService.requestRender(options.viewportId)
    return next
  }
}

export class SyncWindowLevelCommand implements Command<{ sourceViewportId: string }, MprRenderState | null> {
  readonly id = SYNC_WINDOW_LEVEL_COMMAND

  execute(options: { sourceViewportId: string }, context: CommandContext): MprRenderState | null {
    const source = context.viewportService.getRenderState(options.sourceViewportId)
    if (!source) {
      return null
    }

    for (const [viewportId, state] of context.viewportService.renderStates) {
      if (viewportId === options.sourceViewportId || state.image.volumeId !== source.image.volumeId) {
        continue
      }
      const next = cloneMprState(state)
      next.image.windowMin = source.image.windowMin
      next.image.windowMax = source.image.windowMax
      context.viewportService.setRenderState(viewportId, next)
      context.renderService.requestRender(viewportId)
    }

    return source
  }
}

export class SetOverlaySegmentationCommand implements Command<{
  segmentationId?: string
  sourceVolumeId?: string
  visible: boolean
}, void> {
  readonly id = SET_OVERLAY_SEGMENTATION_COMMAND

  execute(options: { segmentationId?: string; sourceVolumeId?: string; visible: boolean }, context: CommandContext): void {
    for (const [viewportId, state] of context.viewportService.renderStates) {
      if (options.sourceVolumeId && state.image.volumeId !== options.sourceVolumeId) {
        continue
      }
      const next = cloneMprState(state)
      next.overlay = options.segmentationId && options.visible
        ? { segmentationId: options.segmentationId, visible: true }
        : undefined
      context.viewportService.setRenderState(viewportId, next)
      context.renderService.requestRender(viewportId)
    }
  }
}

export function createMprCommands(): Command[] {
  return [
    new SetMprRenderStateCommand(),
    new CenterVolumeCommand(),
    new PanMprPlaneCommand(),
    new MoveMprSliceCommand(),
    new ZoomMprPlaneCommand(),
    new WindowLevelCommand(),
    new SyncWindowLevelCommand(),
    new SetOverlaySegmentationCommand(),
  ]
}
