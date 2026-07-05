import type { Box3i } from '../scene'
import type { EditLabelmapOptions } from '../services/segmentationService'
import type { Command, CommandContext } from './commandDispatcher'

export const EDIT_LABELMAP_COMMAND = 'segmentation.editLabelmap'

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

export function createSegmentationCommands(): Command[] {
  return [
    new EditLabelmapCommand(),
  ]
}
