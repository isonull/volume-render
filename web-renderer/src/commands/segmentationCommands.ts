import type { Box3i } from '../scene'
import type { Segment } from '../segmentation'
import type {
  DeleteSegmentOptions,
  EditLabelmapOptions,
  ReplaceLabelmapRegionOptions,
  UpsertSegmentOptions,
} from '../services/segmentationService'
import type { Command, CommandContext } from './commandDispatcher'

export const EDIT_LABELMAP_COMMAND = 'segmentation.editLabelmap'
export const REPLACE_LABELMAP_REGION_COMMAND = 'segmentation.replaceLabelmapRegion'
export const CLEAR_LABELMAP_COMMAND = 'segmentation.clearLabelmap'
export const UPSERT_SEGMENT_COMMAND = 'segmentation.upsertSegment'
export const DELETE_SEGMENT_COMMAND = 'segmentation.deleteSegment'

export type UpsertSegmentCommandOptions = UpsertSegmentOptions
export type DeleteSegmentCommandOptions = DeleteSegmentOptions

export class EditLabelmapCommand implements Command<EditLabelmapOptions, Box3i[]> {
  readonly id = EDIT_LABELMAP_COMMAND

  execute(options: EditLabelmapOptions, context: CommandContext): Box3i[] {
    const changeSet = context.sceneService.applyTransaction(tx => {
      const regions = context.segmentationService.editLabelmap(options)
      if (regions.length > 0) {
        tx.updateSegmentation(options.segmentationId, regions)
      }
      return regions
    })
    const regions = changeSet.result
    if (regions.length === 0) {
      return regions
    }
    context.renderService.applySceneChangeSet(changeSet)
    return regions
  }
}

export class ReplaceLabelmapRegionCommand implements Command<ReplaceLabelmapRegionOptions, Box3i[]> {
  readonly id = REPLACE_LABELMAP_REGION_COMMAND

  execute(options: ReplaceLabelmapRegionOptions, context: CommandContext): Box3i[] {
    const changeSet = context.sceneService.applyTransaction(tx => {
      const regions = context.segmentationService.replaceLabelmapRegion(options)
      if (regions.length > 0) {
        tx.updateSegmentation(options.segmentationId, regions)
      }
      return regions
    })
    const regions = changeSet.result
    if (regions.length > 0) {
      context.renderService.applySceneChangeSet(changeSet)
      context.events.emit('scene.changed', { reason: 'segmentation.replaceLabelmapRegion' })
    }
    return regions
  }
}

export class ClearLabelmapCommand implements Command<{ segmentationId: string }, Box3i[]> {
  readonly id = CLEAR_LABELMAP_COMMAND

  execute(options: { segmentationId: string }, context: CommandContext): Box3i[] {
    const changeSet = context.sceneService.applyTransaction(tx => {
      const regions = context.segmentationService.clearLabelmap(options.segmentationId)
      if (regions.length > 0) {
        tx.updateSegmentation(options.segmentationId, regions)
      }
      return regions
    })
    const regions = changeSet.result
    if (regions.length > 0) {
      context.renderService.applySceneChangeSet(changeSet)
      context.events.emit('scene.changed', { reason: 'segmentation.clearLabelmap' })
    }
    return regions
  }
}

export class UpsertSegmentCommand implements Command<UpsertSegmentCommandOptions, Segment> {
  readonly id = UPSERT_SEGMENT_COMMAND

  execute(options: UpsertSegmentCommandOptions, context: CommandContext): Segment {
    const changeSet = context.sceneService.applyTransaction(tx => {
      context.segmentationService.upsertSegment(options)
      tx.updateSegmentation(options.segmentationId)
      return options.segment
    })
    context.renderService.applySceneChangeSet(changeSet)
    context.events.emit('scene.changed', { reason: 'segmentation.upsertSegment' })
    return changeSet.result
  }
}

export class DeleteSegmentCommand implements Command<DeleteSegmentCommandOptions, Box3i[]> {
  readonly id = DELETE_SEGMENT_COMMAND

  execute(options: DeleteSegmentCommandOptions, context: CommandContext): Box3i[] {
    const scene = context.sceneService.scene
    const segmentation = scene?.segmentations.get(options.segmentationId)
    const hadSegment = segmentation?.segments.has(options.label) ?? false
    const changeSet = context.sceneService.applyTransaction(tx => {
      const regions = context.segmentationService.deleteSegment(options)
      if (hadSegment || regions.length > 0) {
        tx.updateSegmentation(options.segmentationId, regions.length > 0 ? regions : undefined)
      }
      return regions
    })
    if (changeSet.changes.length > 0) {
      context.renderService.applySceneChangeSet(changeSet)
      context.events.emit('scene.changed', { reason: 'segmentation.deleteSegment' })
    }
    return changeSet.result
  }
}

export function createSegmentationCommands(): Command[] {
  return [
    new EditLabelmapCommand(),
    new ReplaceLabelmapRegionCommand(),
    new ClearLabelmapCommand(),
    new UpsertSegmentCommand(),
    new DeleteSegmentCommand(),
  ]
}
