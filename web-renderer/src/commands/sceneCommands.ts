import type { Command, CommandContext } from './commandDispatcher'
import { LabelmapSegmentationData } from '../segmentation'
import type { ScalarVolume } from '../volume'

export const OPEN_VOLUME_COMMAND = 'scene.openVolume'
export const OPEN_SEGMENTATION_COMMAND = 'scene.openSegmentation'
export const CREATE_SEGMENTATION_COMMAND = 'scene.createSegmentation'
export const CLOSE_VOLUME_COMMAND = 'scene.closeVolume'
export const CLOSE_SEGMENTATION_COMMAND = 'scene.closeSegmentation'

export class OpenVolumeCommand implements Command<{ volume: ScalarVolume }, void> {
  readonly id = OPEN_VOLUME_COMMAND

  execute(options: { volume: ScalarVolume }, context: CommandContext): void {
    const changeSet = context.sceneService.loadVolume(options.volume)
    context.renderService.applySceneChangeSet(changeSet)
    context.events.emit('scene.changed', { reason: 'scene.openVolume' })
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
    context.events.emit('scene.changed', { reason: 'scene.openSegmentation' })
    context.events.emit('activeSegmentation.changed', { segmentation: options.segmentation })
  }
}

export class CreateSegmentationCommand implements Command<{ volumeId: string }, LabelmapSegmentationData> {
  readonly id = CREATE_SEGMENTATION_COMMAND

  execute(options: { volumeId: string }, context: CommandContext): LabelmapSegmentationData {
    const scene = context.sceneService.scene
    if (!scene) {
      throw new Error('Cannot create a segmentation before a scene is loaded.')
    }
    const volume = scene.requireVolume(options.volumeId)
    const segmentation = LabelmapSegmentationData.createFromVolume(volume, {
      id: nextSegmentationId(scene.segmentations, volume.id),
      segments: [{
        label: 1,
        name: 'Label 1',
        color: [0.92, 0.34, 0.24],
        opacity: 0.55,
        visible: true,
        locked: false,
      }],
    })
    const changeSet = context.sceneService.applyTransaction(tx => {
      tx.addSegmentation(segmentation)
    })
    context.renderService.applySceneChangeSet(changeSet)
    context.segmentationService.setActiveSegmentation(segmentation.id)
    context.segmentationService.setActiveSegmentLabel(1)
    context.events.emit('scene.changed', { reason: 'scene.createSegmentation' })
    context.events.emit('activeSegmentation.changed', { segmentation })
    return segmentation
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
      context.events.emit('activeSegmentation.changed', { segmentation: null })
    }
    for (const segmentationId of removedSegmentationIds) {
      context.events.emit('segmentation.removed', { segmentationId })
    }
    context.events.emit('volume.removed', { volumeId: options.volumeId })
    context.events.emit('scene.changed', { reason: 'scene.closeVolume' })
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
      context.events.emit('activeSegmentation.changed', { segmentation: null })
    }
    context.events.emit('segmentation.removed', { segmentationId: options.segmentationId })
    context.events.emit('scene.changed', { reason: 'scene.closeSegmentation' })
  }
}

export function createSceneCommands(): Command[] {
  return [
    new OpenVolumeCommand(),
    new OpenSegmentationCommand(),
    new CreateSegmentationCommand(),
    new CloseVolumeCommand(),
    new CloseSegmentationCommand(),
  ]
}

function nextSegmentationId(segmentations: ReadonlyMap<string, LabelmapSegmentationData>, volumeId: string): string {
  const baseId = `${volumeId}-segmentation`
  if (!segmentations.has(baseId)) {
    return baseId
  }
  for (let index = 2; ; index += 1) {
    const id = `${baseId}-${index}`
    if (!segmentations.has(id)) {
      return id
    }
  }
}
