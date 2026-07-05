import type { Command, CommandContext } from './commandDispatcher'
import type { LabelmapSegmentationData } from '../segmentation'
import type { ScalarVolume } from '../volume'

export const OPEN_VOLUME_COMMAND = 'scene.openVolume'
export const OPEN_SEGMENTATION_COMMAND = 'scene.openSegmentation'
export const CLOSE_VOLUME_COMMAND = 'scene.closeVolume'
export const CLOSE_SEGMENTATION_COMMAND = 'scene.closeSegmentation'

export class OpenVolumeCommand implements Command<{ volume: ScalarVolume }, void> {
  readonly id = OPEN_VOLUME_COMMAND

  execute(options: { volume: ScalarVolume }, context: CommandContext): void {
    const changeSet = context.sceneService.loadVolume(options.volume)
    context.renderService.applySceneChangeSet(changeSet)
  }
}

export class OpenSegmentationCommand implements Command<{ segmentation: LabelmapSegmentationData }, void> {
  readonly id = OPEN_SEGMENTATION_COMMAND

  execute(options: { segmentation: LabelmapSegmentationData }, context: CommandContext): void {
    const changeSet = context.sceneService.applyTransaction(tx => {
      for (const [segmentationId, existing] of context.sceneService.scene!.segmentations) {
        if (existing.sourceVolumeId === options.segmentation.sourceVolumeId) {
          tx.removeSegmentation(segmentationId)
        }
      }
      tx.addSegmentation(options.segmentation)
    })
    context.renderService.applySceneChangeSet(changeSet)
    context.segmentationService.setActiveSegmentation(options.segmentation.id)
  }
}

export class CloseVolumeCommand implements Command<{ volumeId: string }, {
  volume: ScalarVolume
  removedSegmentationIds: string[]
  nextVolume: ScalarVolume | null
  sceneDestroyed: boolean
}> {
  readonly id = CLOSE_VOLUME_COMMAND

  execute(options: { volumeId: string }, context: CommandContext): {
    volume: ScalarVolume
    removedSegmentationIds: string[]
    nextVolume: ScalarVolume | null
    sceneDestroyed: boolean
  } {
    const scene = context.sceneService.scene
    if (!scene) {
      throw new Error('Cannot close volume before a scene is loaded.')
    }
    const volume = scene.requireVolume(options.volumeId)
    const removedSegmentationIds = [...scene.segmentations.values()]
      .filter(segmentation => segmentation.sourceVolumeId === options.volumeId)
      .map(segmentation => segmentation.id)
    const changeSet = context.sceneService.applyTransaction(tx => {
      for (const segmentationId of removedSegmentationIds) {
        tx.removeSegmentation(segmentationId)
      }
      tx.removeVolume(options.volumeId)
    })
    context.renderService.applySceneChangeSet(changeSet)
    if (
      context.segmentationService.getActiveSegmentationId()
      && removedSegmentationIds.includes(context.segmentationService.getActiveSegmentationId()!)
    ) {
      context.segmentationService.setActiveSegmentation(null)
    }
    const nextVolume = [...scene.volumes.values()][0] ?? null
    if (!nextVolume) {
      context.renderService.releasePreparedScene()
      context.viewportService.clearRenderStates()
      context.renderService.clearPendingRenders()
      context.sceneService.destroyScene()
      context.viewportService.clearViewports()
    }
    return { volume, removedSegmentationIds, nextVolume, sceneDestroyed: !nextVolume }
  }
}

export class CloseSegmentationCommand implements Command<{ segmentationId: string }, void> {
  readonly id = CLOSE_SEGMENTATION_COMMAND

  execute(options: { segmentationId: string }, context: CommandContext): void {
    const changeSet = context.sceneService.applyTransaction(tx => tx.removeSegmentation(options.segmentationId))
    context.renderService.applySceneChangeSet(changeSet)
    if (context.segmentationService.getActiveSegmentationId() === options.segmentationId) {
      context.segmentationService.setActiveSegmentation(null)
    }
  }
}

export function createSceneCommands(): Command[] {
  return [
    new OpenVolumeCommand(),
    new OpenSegmentationCommand(),
    new CloseVolumeCommand(),
    new CloseSegmentationCommand(),
  ]
}
