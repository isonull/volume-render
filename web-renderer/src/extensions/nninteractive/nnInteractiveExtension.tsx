import { useEffect, useState } from 'react'
import type { Vec2n, Vec3n } from 'wgpu-matrix'
import { cloneMprState } from '../../mpr/mprState'
import { isVoxelInBounds, worldToIndex } from '../../mpr/mprMath'
import { LabelmapSegmentationData } from '../../segmentation'
import type { Box3i } from '../../scene'
import type { Command, CommandContext } from '../../commands/commandDispatcher'
import type { DragTool, PointTool, ToolContext } from '../../tools/tool'
import type { ToolInputEvent } from '../../tools/toolInput'
import type { ActiveToolPanel, ExtensionContext, SegmentContextItem, WebRendererExtension } from '../types'
import { MPR_TOOL_GROUP_ID } from '../core/coreExtension'
import {
  NNINTERACTIVE_SERVICE_ID,
  NnInteractiveService,
} from './nnInteractiveService'
import type { NnInteractiveState } from './nnInteractiveService'
import type { InitialSegmentationMask, NnInteractiveBbox, PredictionPatch, ScribbleMask } from './nnInteractiveClient'

const START_SESSION_COMMAND = 'nninteractive.startSession'
const RELEASE_SESSION_COMMAND = 'nninteractive.releaseSession'
const ADD_POSITIVE_POINT_COMMAND = 'nninteractive.addPositivePoint'
const ADD_NEGATIVE_POINT_COMMAND = 'nninteractive.addNegativePoint'
const ADD_POSITIVE_SCRIBBLE_COMMAND = 'nninteractive.addPositiveScribble'
const ADD_NEGATIVE_SCRIBBLE_COMMAND = 'nninteractive.addNegativeScribble'
const RESET_INTERACTIONS_COMMAND = 'nninteractive.resetInteractions'
const UNDO_COMMAND = 'nninteractive.undo'
const TEST_CONNECTION_COMMAND = 'nninteractive.testConnection'

const NNINTERACTIVE_TOOL_PANEL_ID = 'nninteractive.panel'
const POSITIVE_POINT_TOOL = 'nninteractive.positivePoint'
const NEGATIVE_POINT_TOOL = 'nninteractive.negativePoint'
const POSITIVE_SCRIBBLE_TOOL = 'nninteractive.positiveScribble'
const NEGATIVE_SCRIBBLE_TOOL = 'nninteractive.negativeScribble'

export function createNnInteractiveExtension(): WebRendererExtension {
  return {
    id: 'nninteractive',
    displayName: 'nnInteractive',
    services: [{
      id: NNINTERACTIVE_SERVICE_ID,
      create: () => new NnInteractiveService(),
    }],
    commands: () => [
      new TestConnectionCommand(),
      new StartSessionCommand(),
      new ReleaseSessionCommand(),
      new AddPointCommand(ADD_POSITIVE_POINT_COMMAND, true),
      new AddPointCommand(ADD_NEGATIVE_POINT_COMMAND, false),
      new AddScribbleCommand(ADD_POSITIVE_SCRIBBLE_COMMAND, true),
      new AddScribbleCommand(ADD_NEGATIVE_SCRIBBLE_COMMAND, false),
      new ResetInteractionsCommand(),
      new UndoCommand(),
    ],
    tools: [
      { id: POSITIVE_POINT_TOOL, create: () => new NnInteractivePointTool(POSITIVE_POINT_TOOL, ADD_POSITIVE_POINT_COMMAND) },
      { id: NEGATIVE_POINT_TOOL, create: () => new NnInteractivePointTool(NEGATIVE_POINT_TOOL, ADD_NEGATIVE_POINT_COMMAND) },
      { id: POSITIVE_SCRIBBLE_TOOL, create: () => new NnInteractiveScribbleTool(POSITIVE_SCRIBBLE_TOOL, ADD_POSITIVE_SCRIBBLE_COMMAND) },
      { id: NEGATIVE_SCRIBBLE_TOOL, create: () => new NnInteractiveScribbleTool(NEGATIVE_SCRIBBLE_TOOL, ADD_NEGATIVE_SCRIBBLE_COMMAND) },
    ],
    toolPanels: [{
      id: NNINTERACTIVE_TOOL_PANEL_ID,
      title: 'nnInteractive',
      order: 20,
      render: ({ extension, activePanel }) => <NnInteractivePanel activePanel={activePanel} context={extension} />,
    }],
    segmentActions: [{
      id: 'nninteractive.segment.open',
      label: 'nnInteractive',
      order: 20,
      run: async (item, { extension }) => {
        await openNnInteractiveToolPanel(extension, item)
      },
    }],
    activate: context => {
      const service = nnService(context)
      context.toolGroups.addTool(MPR_TOOL_GROUP_ID, POSITIVE_POINT_TOOL, {
        mode: 'disabled',
        bindings: [{ kind: 'point', button: 0 }],
      })
      context.toolGroups.addTool(MPR_TOOL_GROUP_ID, NEGATIVE_POINT_TOOL, {
        mode: 'disabled',
        bindings: [{ kind: 'point', button: 0 }],
      })
      context.toolGroups.addTool(MPR_TOOL_GROUP_ID, POSITIVE_SCRIBBLE_TOOL, {
        mode: 'disabled',
        bindings: [{ kind: 'drag', button: 0, modifiers: noModifiers() }],
      })
      context.toolGroups.addTool(MPR_TOOL_GROUP_ID, NEGATIVE_SCRIBBLE_TOOL, {
        mode: 'disabled',
        bindings: [{ kind: 'drag', button: 0, modifiers: noModifiers() }],
      })
      return [
        context.interactionModes.register({
          id: 'nninteractive.positivePoint',
          label: 'AI+ Point',
          order: 100,
          canActivate: () => canActivatePromptMode(context, service),
          activate: () => activatePromptMode(context, service, POSITIVE_POINT_TOOL, 'nninteractive.positivePoint'),
        }),
        context.interactionModes.register({
          id: 'nninteractive.negativePoint',
          label: 'AI- Point',
          order: 110,
          canActivate: () => canActivatePromptMode(context, service),
          activate: () => activatePromptMode(context, service, NEGATIVE_POINT_TOOL, 'nninteractive.negativePoint'),
        }),
        context.interactionModes.register({
          id: 'nninteractive.positiveScribble',
          label: 'AI+ Scribble',
          order: 120,
          canActivate: () => canActivateScribbleMode(context, service),
          activate: () => activatePromptMode(context, service, POSITIVE_SCRIBBLE_TOOL, 'nninteractive.positiveScribble'),
        }),
        context.interactionModes.register({
          id: 'nninteractive.negativeScribble',
          label: 'AI- Scribble',
          order: 130,
          canActivate: () => canActivateScribbleMode(context, service),
          activate: () => activatePromptMode(context, service, NEGATIVE_SCRIBBLE_TOOL, 'nninteractive.negativeScribble'),
        }),
        service.subscribe(() => {
          syncPromptToolModes(context, service)
          context.app.invalidateUi()
        }),
        context.events.on('interactionMode.changed', () => {
          syncPromptToolModes(context, service)
        }),
        context.events.on('volume.removed', ({ volumeId }) => {
          if (service.getState().activeVolumeId === volumeId) {
            void service.release()
          }
        }),
        context.events.on('app.dispose', () => {
          void service.release()
        }),
        { dispose: () => context.toolGroups.removeTool(MPR_TOOL_GROUP_ID, POSITIVE_POINT_TOOL) },
        { dispose: () => context.toolGroups.removeTool(MPR_TOOL_GROUP_ID, NEGATIVE_POINT_TOOL) },
        { dispose: () => context.toolGroups.removeTool(MPR_TOOL_GROUP_ID, POSITIVE_SCRIBBLE_TOOL) },
        { dispose: () => context.toolGroups.removeTool(MPR_TOOL_GROUP_ID, NEGATIVE_SCRIBBLE_TOOL) },
      ]
    },
  }
}

class TestConnectionCommand implements Command<void, Promise<void>> {
  readonly id = TEST_CONNECTION_COMMAND

  async execute(_options: void, context: CommandContext): Promise<void> {
    const service = nnServiceFromCommand(context)
    const ok = await service.testConnection()
    context.events.emit('scene.changed', { reason: ok ? 'nninteractive.testConnection.ok' : 'nninteractive.testConnection.failed' })
  }
}

type StartSessionOptions = {
  volumeId: string
  targetSegmentationId?: string
  targetSegmentLabel?: number
}

type NnInteractiveSessionTarget = {
  segmentationId: string
  segmentLabel: number
  initialSegmentation?: InitialSegmentationMask | null
}

class StartSessionCommand implements Command<StartSessionOptions, Promise<void>> {
  readonly id = START_SESSION_COMMAND

  async execute(options: StartSessionOptions, context: CommandContext): Promise<void> {
    const scene = context.sceneService.scene
    if (!scene) {
      throw new Error('Load a volume before starting nnInteractive.')
    }
    const volume = scene.requireVolume(options.volumeId)
    const service = nnServiceFromCommand(context)
    let target: NnInteractiveSessionTarget | undefined = options.targetSegmentationId && options.targetSegmentLabel
      ? { segmentationId: options.targetSegmentationId, segmentLabel: options.targetSegmentLabel }
      : undefined
    if (target) {
      const targetSegmentation = scene.requireSegmentation(target.segmentationId)
      if (targetSegmentation.sourceVolumeId !== volume.id) {
        throw new Error('nnInteractive target segmentation must belong to the active volume.')
      }
      if (!targetSegmentation.segments.has(target.segmentLabel)) {
        throw new Error(`Segment label ${target.segmentLabel} does not exist in ${target.segmentationId}.`)
      }
      target = {
        ...target,
        initialSegmentation: createInitialSegmentationMask(targetSegmentation, target.segmentLabel),
      }
    }
    const segmentationId = await service.startSession(volume, target)

    const existing = scene.segmentations.get(segmentationId)
    const changeSet = context.sceneService.applyTransaction(tx => {
      if (existing && !target) {
        const regions = context.segmentationService.clearLabelmap(segmentationId)
        if (regions.length > 0) {
          tx.updateSegmentation(segmentationId, regions)
        }
        return
      }
      if (existing) {
        return
      }
      tx.addSegmentation(LabelmapSegmentationData.createFromVolume(volume, {
        id: segmentationId,
        data: new Uint8Array(volume.shape[0] * volume.shape[1] * volume.shape[2]),
        segments: [{
          label: 1,
          name: 'nnInteractive foreground',
          color: [0.12, 0.76, 0.9],
          opacity: 0.55,
          visible: true,
          locked: false,
        }],
      }))
    })
    if (changeSet.changes.length > 0) {
      context.renderService.applySceneChangeSet(changeSet)
    }
    context.segmentationService.setActiveSegmentation(segmentationId)
    context.segmentationService.setActiveSegmentLabel(target?.segmentLabel ?? 1)
    setOverlay(context, segmentationId, volume.id)
    context.events.emit('scene.changed', { reason: 'nninteractive.startSession' })
    context.events.emit('activeSegmentation.changed', {
      segmentation: context.sceneService.scene?.segmentations.get(segmentationId) ?? null,
    })
  }
}

class ReleaseSessionCommand implements Command<void, Promise<void>> {
  readonly id = RELEASE_SESSION_COMMAND

  async execute(_options: void, context: CommandContext): Promise<void> {
    await nnServiceFromCommand(context).release()
    context.events.emit('scene.changed', { reason: 'nninteractive.releaseSession' })
  }
}

class AddPointCommand implements Command<{ volumeId: string; voxel: Vec3n }, Promise<void>> {
  readonly id: string
  private readonly includeInteraction: boolean

  constructor(id: string, includeInteraction: boolean) {
    this.id = id
    this.includeInteraction = includeInteraction
  }

  async execute(options: { volumeId: string; voxel: Vec3n }, context: CommandContext): Promise<void> {
    const scene = context.sceneService.scene
    if (!scene) {
      throw new Error('Load a volume before adding nnInteractive points.')
    }
    scene.requireVolume(options.volumeId)
    const service = nnServiceFromCommand(context)
    const serviceState = service.getState()
    const segmentationId = serviceState.segmentationId
    const targetLabel = serviceState.targetSegmentLabel
    if (!segmentationId || !targetLabel || serviceState.activeVolumeId !== options.volumeId) {
      throw new Error('Start an nnInteractive session for the active volume before adding points.')
    }
    if (service.isBusy()) {
      throw new Error('nnInteractive is busy. Wait for the current operation to finish.')
    }
    const patch = await service.addPoint(options.voxel, this.includeInteraction)
    applyPatchToSegmentation(context, segmentationId, targetLabel, patch, 'nninteractive.addPoint')
  }
}

class AddScribbleCommand implements Command<{ volumeId: string; viewportId: string; points: Vec3n[] }, Promise<void>> {
  readonly id: string
  private readonly includeInteraction: boolean

  constructor(id: string, includeInteraction: boolean) {
    this.id = id
    this.includeInteraction = includeInteraction
  }

  async execute(options: { volumeId: string; viewportId: string; points: Vec3n[] }, context: CommandContext): Promise<void> {
    const scene = context.sceneService.scene
    if (!scene) {
      throw new Error('Load a volume before adding nnInteractive scribbles.')
    }
    const volume = scene.requireVolume(options.volumeId)
    const service = nnServiceFromCommand(context)
    const serviceState = service.getState()
    const segmentationId = serviceState.segmentationId
    const targetLabel = serviceState.targetSegmentLabel
    if (!segmentationId || !targetLabel || serviceState.activeVolumeId !== options.volumeId) {
      throw new Error('Start an nnInteractive session for the active volume before adding scribbles.')
    }
    if (!serviceState.supportsScribble) {
      throw new Error('The current nnInteractive server/model does not advertise scribble support.')
    }
    if (service.isBusy()) {
      throw new Error('nnInteractive is busy. Wait for the current operation to finish.')
    }
    const mask = createScribbleMask({
      points: options.points,
      viewportId: options.viewportId,
      volumeShape: volume.shape,
      thickness: serviceState.preferredScribbleThickness,
    })
    if (!mask) {
      return
    }
    const patch = await service.addScribble(mask, this.includeInteraction)
    applyPatchToSegmentation(context, segmentationId, targetLabel, patch, 'nninteractive.addScribble')
  }
}

class ResetInteractionsCommand implements Command<void, Promise<void>> {
  readonly id = RESET_INTERACTIONS_COMMAND

  async execute(_options: void, context: CommandContext): Promise<void> {
    const service = nnServiceFromCommand(context)
    const serviceState = service.getState()
    const segmentationId = serviceState.segmentationId
    const targetLabel = serviceState.targetSegmentLabel
    if (!segmentationId || !targetLabel) {
      throw new Error('Start an nnInteractive session before resetting interactions.')
    }
    await service.resetInteractions()
    const changeSet = context.sceneService.applyTransaction(tx => {
      const regions = context.segmentationService.clearSegmentLabel(segmentationId, targetLabel)
      if (regions.length > 0) {
        tx.updateSegmentation(segmentationId, regions)
      }
      return regions
    })
    if (changeSet.result.length > 0) {
      context.renderService.applySceneChangeSet(changeSet)
    }
    context.events.emit('scene.changed', { reason: 'nninteractive.resetInteractions' })
  }
}

class UndoCommand implements Command<void, Promise<void>> {
  readonly id = UNDO_COMMAND

  async execute(_options: void, context: CommandContext): Promise<void> {
    const service = nnServiceFromCommand(context)
    const serviceState = service.getState()
    const segmentationId = serviceState.segmentationId
    const targetLabel = serviceState.targetSegmentLabel
    if (!segmentationId || !targetLabel) {
      throw new Error('Start an nnInteractive session before undo.')
    }
    const patch = await service.undo()
    applyPatchToSegmentation(context, segmentationId, targetLabel, patch, 'nninteractive.undo')
  }
}

class NnInteractivePointTool implements PointTool {
  readonly id: string
  private readonly commandId: string

  constructor(id: string, commandId: string) {
    this.id = id
    this.commandId = commandId
  }

  onPoint(event: ToolInputEvent, context: ToolContext): void {
    const volume = context.getActiveVolume()
    const world = context.getWorldPoint(event.viewportId, event.clientPoint)
    if (!volume || !world) {
      return
    }
    const index = worldToIndex(world, volume)
    const voxel: Vec3n = [
      Math.round(index[0]),
      Math.round(index[1]),
      Math.round(index[2]),
    ]
    if (!isVoxelInBounds(voxel, volume)) {
      return
    }
    void context.commands.execute<{ volumeId: string; voxel: Vec3n }, Promise<void>>(this.commandId, {
      volumeId: volume.id,
      voxel,
    })
  }
}

type ScribbleStroke = {
  volumeId: string
  viewportId: string
  points: Vec3n[]
}

class NnInteractiveScribbleTool implements DragTool {
  readonly id: string
  private readonly commandId: string
  private stroke: ScribbleStroke | null = null

  constructor(id: string, commandId: string) {
    this.id = id
    this.commandId = commandId
  }

  onDragStart(event: ToolInputEvent, context: ToolContext): void {
    const volume = context.getActiveVolume()
    if (!volume) {
      this.stroke = null
      return
    }
    this.stroke = {
      volumeId: volume.id,
      viewportId: event.viewportId,
      points: [],
    }
    this.addPoint(event, context)
  }

  onDrag(_delta: Vec2n, event: ToolInputEvent, context: ToolContext): void {
    this.addPoint(event, context)
  }

  onDragEnd(event: ToolInputEvent, context: ToolContext): void {
    this.addPoint(event, context)
    const stroke = this.stroke
    this.stroke = null
    if (!stroke || stroke.points.length === 0) {
      return
    }
    void context.commands.execute<{ volumeId: string; viewportId: string; points: Vec3n[] }, Promise<void>>(this.commandId, {
      volumeId: stroke.volumeId,
      viewportId: stroke.viewportId,
      points: stroke.points,
    })
  }

  onDragCancel(): void {
    this.stroke = null
  }

  private addPoint(event: ToolInputEvent, context: ToolContext): void {
    const stroke = this.stroke
    const volume = context.getActiveVolume()
    if (!stroke || !volume || volume.id !== stroke.volumeId) {
      return
    }
    const world = context.getWorldPoint(event.viewportId, event.clientPoint)
    if (!world) {
      return
    }
    const index = worldToIndex(world, volume)
    const voxel: Vec3n = [
      Math.round(index[0]),
      Math.round(index[1]),
      Math.round(index[2]),
    ]
    if (!isVoxelInBounds(voxel, volume)) {
      return
    }
    const last = stroke.points.at(-1)
    if (last && last[0] === voxel[0] && last[1] === voxel[1] && last[2] === voxel[2]) {
      return
    }
    stroke.points.push(voxel)
  }
}

function NnInteractivePanel({
  activePanel,
  context,
}: {
  activePanel: NonNullable<ActiveToolPanel>
  context: ExtensionContext
}) {
  const service = nnService(context)
  const [state, setState] = useState<NnInteractiveState>(service.getState())

  useEffect(() => {
    const disposable = service.subscribe(() => {
      setState(service.getState())
      context.app.invalidateUi()
    })
    return () => disposable.dispose()
  }, [context, service])

  const scene = context.core.sceneService.scene
  const targetSegmentation = scene?.segmentations.get(activePanel.segmentationId) ?? null
  const targetSegment = targetSegmentation?.segments.get(activePanel.segmentLabel) ?? null
  const targetVolume = targetSegmentation ? scene?.volumes.get(targetSegmentation.sourceVolumeId) ?? null : context.app.getActiveVolume()
  const busy = service.isBusy()
  const activeMode = context.app.getInteractionMode()

  return (
    <section className="extension-panel nninteractive-panel" aria-label="nnInteractive">
      <div className="panel-header-row">
        <h2>nnInteractive</h2>
        <button type="button" onClick={() => exitNnInteractivePanel(context)}>Exit</button>
      </div>
      <dl className="extension-status">
        <div>
          <dt>Target</dt>
          <dd>{targetSegment ? `${targetSegment.label} / ${targetSegment.name}` : 'missing'}</dd>
        </div>
      </dl>
      <label className="tool-field">
        Server
        <input
          type="text"
          value={state.serverUrl}
          onChange={event => service.setConfig({ serverUrl: event.currentTarget.value })}
        />
      </label>
      <label className="tool-field">
        API key
        <input
          type="password"
          value={state.apiKey}
          onChange={event => service.setConfig({ apiKey: event.currentTarget.value })}
        />
      </label>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void context.commands.execute(TEST_CONNECTION_COMMAND, undefined)}>
          Test
        </button>
        <button
          type="button"
          disabled={busy || !targetVolume || !targetSegment || !state.codecAvailable}
          onClick={() => {
            if (targetVolume && targetSegment) {
              void context.commands.execute<StartSessionOptions, Promise<void>>(START_SESSION_COMMAND, {
                volumeId: targetVolume.id,
                targetSegmentationId: activePanel.segmentationId,
                targetSegmentLabel: targetSegment.label,
              })
            }
          }}
        >
          Start
        </button>
        <button type="button" disabled={busy || !state.segmentationId} onClick={() => void context.commands.execute(RELEASE_SESSION_COMMAND, undefined)}>
          Release
        </button>
      </div>
      <div className="segmented-control nninteractive-modes" role="group" aria-label="nnInteractive prompt mode">
        <button
          type="button"
          className={activeMode === 'nninteractive.positivePoint' ? 'active' : ''}
          disabled={busy || state.status !== 'ready'}
          onClick={() => activateMode(context, 'nninteractive.positivePoint')}
        >
          AI+ Point
        </button>
        <button
          type="button"
          className={activeMode === 'nninteractive.negativePoint' ? 'active' : ''}
          disabled={busy || state.status !== 'ready'}
          onClick={() => activateMode(context, 'nninteractive.negativePoint')}
        >
          AI- Point
        </button>
        <button
          type="button"
          className={activeMode === 'nninteractive.positiveScribble' ? 'active' : ''}
          disabled={busy || state.status !== 'ready' || !state.supportsScribble}
          onClick={() => activateMode(context, 'nninteractive.positiveScribble')}
        >
          AI+ Scribble
        </button>
        <button
          type="button"
          className={activeMode === 'nninteractive.negativeScribble' ? 'active' : ''}
          disabled={busy || state.status !== 'ready' || !state.supportsScribble}
          onClick={() => activateMode(context, 'nninteractive.negativeScribble')}
        >
          AI- Scribble
        </button>
      </div>
      <div className="button-row">
        <button type="button" disabled={busy || !state.segmentationId} onClick={() => void context.commands.execute(RESET_INTERACTIONS_COMMAND, undefined)}>
          Reset
        </button>
        <button type="button" disabled={busy || !state.supportsUndo} onClick={() => void context.commands.execute(UNDO_COMMAND, undefined)}>
          Undo
        </button>
      </div>
      <dl className="extension-status">
        <div>
          <dt>Status</dt>
          <dd>{state.status}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{`+${state.positivePoints} / -${state.negativePoints}`}</dd>
        </div>
        <div>
          <dt>Scribbles</dt>
          <dd>{`+${state.positiveScribbles} / -${state.negativeScribbles}`}</dd>
        </div>
        <div>
          <dt>Stroke</dt>
          <dd>{state.supportsScribble ? state.preferredScribbleThickness.map(value => value.toFixed(1)).join(' x ') : 'unsupported'}</dd>
        </div>
        <div>
          <dt>Codec</dt>
          <dd>{state.codecAvailable ? 'ready' : 'missing'}</dd>
        </div>
      </dl>
      <p className="extension-message">{state.message}</p>
    </section>
  )
}

function activateMode(context: ExtensionContext, modeId: string): void {
  const reason = context.interactionModes.activate(modeId)
  if (reason) {
    context.app.setStatus(reason)
  }
  context.app.invalidateUi()
}

async function openNnInteractiveToolPanel(context: ExtensionContext, item: SegmentContextItem): Promise<void> {
  const service = nnService(context)
  const state = service.getState()
  const targetChanged = state.segmentationId !== item.segmentationId
    || state.targetSegmentLabel !== item.segmentLabel
    || (state.activeVolumeId !== null && state.activeVolumeId !== item.sourceVolumeId)
  if (targetChanged && state.status !== 'idle') {
    await service.release()
  }
  service.setTarget({
    segmentationId: item.segmentationId,
    segmentLabel: item.segmentLabel,
  })
  context.app.setActiveSegmentationId(item.segmentationId)
  context.core.segmentationService.setActiveSegmentLabel(item.segmentLabel)
  if (context.app.getActiveVolume()?.id !== item.sourceVolumeId) {
    context.app.centerVolume(item.sourceVolumeId)
  }
  context.app.setActiveToolPanel({
    id: NNINTERACTIVE_TOOL_PANEL_ID,
    segmentationId: item.segmentationId,
    segmentLabel: item.segmentLabel,
  })
  if (service.getState().status === 'ready' && service.getState().activeVolumeId === item.sourceVolumeId) {
    activateMode(context, 'nninteractive.positivePoint')
  } else {
    context.app.setStatus('nnInteractive target selected. Start a session to add prompts.')
    context.app.invalidateUi()
  }
}

function exitNnInteractivePanel(context: ExtensionContext): void {
  context.app.setActiveToolPanel(null)
  activateMode(context, 'core.navigate')
}

function canActivatePromptMode(context: ExtensionContext, service: NnInteractiveService): string | null {
  if (!context.app.getActiveVolume()) {
    return 'Load a volume before using nnInteractive tools.'
  }
  const state = service.getState()
  if (!state.segmentationId || !state.targetSegmentLabel) {
    return 'Choose a target segment before using nnInteractive tools.'
  }
  if (state.status !== 'ready') {
    return 'Start an nnInteractive session before adding prompts.'
  }
  return null
}

function canActivateScribbleMode(context: ExtensionContext, service: NnInteractiveService): string | null {
  const baseReason = canActivatePromptMode(context, service)
  if (baseReason) {
    return baseReason
  }
  if (!service.getState().supportsScribble) {
    return 'The current nnInteractive server/model does not advertise scribble support.'
  }
  return null
}

function activatePromptMode(context: ExtensionContext, service: NnInteractiveService, toolId: string, modeId: string): void {
  context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'mpr.pan', 'disabled')
  context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'seg.brush', 'disabled')
  context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, toolId, 'active')
  context.app.setInteractionMode(modeId)
  syncPromptToolModes(context, service)
}

function syncPromptToolModes(context: ExtensionContext, service: NnInteractiveService): void {
  context.toolGroups.setToolModeByBindingKind(MPR_TOOL_GROUP_ID, 'point', 'disabled')
  context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, POSITIVE_SCRIBBLE_TOOL, 'disabled')
  context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, NEGATIVE_SCRIBBLE_TOOL, 'disabled')
  if (service.getState().status !== 'ready') {
    return
  }
  const activeMode = context.app.getInteractionMode()
  if (activeMode === 'nninteractive.positivePoint') {
    context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, POSITIVE_POINT_TOOL, 'active')
  } else if (activeMode === 'nninteractive.negativePoint') {
    context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, NEGATIVE_POINT_TOOL, 'active')
  } else if (service.getState().supportsScribble && activeMode === 'nninteractive.positiveScribble') {
    context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, POSITIVE_SCRIBBLE_TOOL, 'active')
  } else if (service.getState().supportsScribble && activeMode === 'nninteractive.negativeScribble') {
    context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, NEGATIVE_SCRIBBLE_TOOL, 'active')
  }
}

type Axis = 0 | 1 | 2

type ScribbleAxes = {
  u: Axis
  v: Axis
  slice: Axis
}

function createScribbleMask(options: {
  points: Vec3n[]
  viewportId: string
  volumeShape: Vec3n
  thickness: Vec3n
}): ScribbleMask | null {
  const axes = scribbleAxesForViewport(options.viewportId)
  if (!axes || options.points.length === 0) {
    return null
  }

  const points = options.points.map(point => clampVoxel(point, options.volumeShape))
  const slice = medianSlice(points, axes.slice, options.volumeShape)
  const radiusU = Math.max(0.5, options.thickness[axes.u] / 2)
  const radiusV = Math.max(0.5, options.thickness[axes.v] / 2)
  const marginU = Math.ceil(radiusU)
  const marginV = Math.ceil(radiusV)

  let minU = options.volumeShape[axes.u]
  let maxU = -1
  let minV = options.volumeShape[axes.v]
  let maxV = -1
  for (const point of points) {
    minU = Math.min(minU, point[axes.u])
    maxU = Math.max(maxU, point[axes.u])
    minV = Math.min(minV, point[axes.v])
    maxV = Math.max(maxV, point[axes.v])
  }

  minU = clampInteger(minU - marginU, 0, options.volumeShape[axes.u] - 1)
  maxU = clampInteger(maxU + marginU, 0, options.volumeShape[axes.u] - 1)
  minV = clampInteger(minV - marginV, 0, options.volumeShape[axes.v] - 1)
  maxV = clampInteger(maxV + marginV, 0, options.volumeShape[axes.v] - 1)

  const min: Vec3n = [0, 0, 0]
  const max: Vec3n = [0, 0, 0]
  min[axes.u] = minU
  max[axes.u] = maxU + 1
  min[axes.v] = minV
  max[axes.v] = maxV + 1
  min[axes.slice] = slice
  max[axes.slice] = slice + 1

  const bbox: NnInteractiveBbox = [
    [min[0], max[0]],
    [min[1], max[1]],
    [min[2], max[2]],
  ]
  const shape: [number, number, number] = [
    bbox[0][1] - bbox[0][0],
    bbox[1][1] - bbox[1][0],
    bbox[2][1] - bbox[2][0],
  ]
  const data = new Uint8Array(shape[0] * shape[1] * shape[2])
  let hasInk = false

  if (points.length === 1) {
    hasInk = drawScribbleSegment(data, bbox, shape, axes, slice, points[0], points[0], radiusU, radiusV) || hasInk
  } else {
    for (let index = 1; index < points.length; index += 1) {
      hasInk = drawScribbleSegment(
        data,
        bbox,
        shape,
        axes,
        slice,
        points[index - 1],
        points[index],
        radiusU,
        radiusV,
      ) || hasInk
    }
  }

  return hasInk ? { bbox, shape, data } : null
}

function drawScribbleSegment(
  data: Uint8Array,
  bbox: NnInteractiveBbox,
  shape: [number, number, number],
  axes: ScribbleAxes,
  slice: number,
  start: Vec3n,
  end: Vec3n,
  radiusU: number,
  radiusV: number,
): boolean {
  const minU = Math.max(bbox[axes.u][0], Math.floor(Math.min(start[axes.u], end[axes.u]) - radiusU))
  const maxU = Math.min(bbox[axes.u][1] - 1, Math.ceil(Math.max(start[axes.u], end[axes.u]) + radiusU))
  const minV = Math.max(bbox[axes.v][0], Math.floor(Math.min(start[axes.v], end[axes.v]) - radiusV))
  const maxV = Math.min(bbox[axes.v][1] - 1, Math.ceil(Math.max(start[axes.v], end[axes.v]) + radiusV))
  let changed = false

  for (let v = minV; v <= maxV; v += 1) {
    for (let u = minU; u <= maxU; u += 1) {
      if (normalizedDistanceToSegment(u, v, start[axes.u], start[axes.v], end[axes.u], end[axes.v], radiusU, radiusV) > 1) {
        continue
      }
      const voxel: Vec3n = [0, 0, 0]
      voxel[axes.u] = u
      voxel[axes.v] = v
      voxel[axes.slice] = slice
      const offset = ((voxel[0] - bbox[0][0]) * shape[1] + (voxel[1] - bbox[1][0])) * shape[2] + (voxel[2] - bbox[2][0])
      if (data[offset] === 0) {
        data[offset] = 1
        changed = true
      }
    }
  }
  return changed
}

function normalizedDistanceToSegment(
  u: number,
  v: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  radiusU: number,
  radiusV: number,
): number {
  const px = u / radiusU
  const py = v / radiusV
  const ax = u0 / radiusU
  const ay = v0 / radiusV
  const bx = u1 / radiusU
  const by = v1 / radiusV
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-12) {
    return Math.hypot(px - ax, py - ay)
  }
  const t = clampNumber(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1)
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

function scribbleAxesForViewport(viewportId: string): ScribbleAxes | null {
  if (viewportId === 'axial') {
    return { u: 0, v: 1, slice: 2 }
  }
  if (viewportId === 'coronal') {
    return { u: 0, v: 2, slice: 1 }
  }
  if (viewportId === 'sagittal') {
    return { u: 1, v: 2, slice: 0 }
  }
  return null
}

function medianSlice(points: Vec3n[], axis: Axis, shape: Vec3n): number {
  const values = points.map(point => point[axis]).sort((a, b) => a - b)
  return clampInteger(values[Math.floor(values.length / 2)] ?? 0, 0, shape[axis] - 1)
}

function clampVoxel(point: Vec3n, shape: Vec3n): Vec3n {
  return [
    clampInteger(Math.round(point[0]), 0, shape[0] - 1),
    clampInteger(Math.round(point[1]), 0, shape[1] - 1),
    clampInteger(Math.round(point[2]), 0, shape[2] - 1),
  ]
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function noModifiers(): { shift: false; ctrl: false; alt: false; meta: false } {
  return { shift: false, ctrl: false, alt: false, meta: false }
}

function applyPatchToSegmentation(
  context: CommandContext,
  segmentationId: string,
  label: number,
  patch: PredictionPatch | null,
  reason: string,
): Box3i[] {
  if (!patch) {
    return []
  }
  const changeSet = context.sceneService.applyTransaction(tx => {
    const regions = context.segmentationService.applyBinarySegmentRegion({
      segmentationId,
      label,
      min: [patch.bbox[0][0], patch.bbox[1][0], patch.bbox[2][0]],
      shape: patch.shape,
      data: patch.data,
      layout: 'c-order-xyz',
      preserveOtherLabels: true,
    })
    if (regions.length > 0) {
      tx.updateSegmentation(segmentationId, regions)
    }
    return regions
  })
  if (changeSet.result.length > 0) {
    context.renderService.applySceneChangeSet(changeSet)
    context.events.emit('scene.changed', { reason })
  }
  return changeSet.result
}

function createInitialSegmentationMask(
  segmentation: LabelmapSegmentationData,
  label: number,
): InitialSegmentationMask | null {
  const [nx, ny, nz] = segmentation.shape
  let data: Uint8Array | null = null

  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const sourceOffset = x + nx * (y + ny * z)
        if (segmentation.data[sourceOffset] !== label) {
          continue
        }
        if (!data) {
          data = new Uint8Array(nx * ny * nz)
        }
        data[(x * ny + y) * nz + z] = 1
      }
    }
  }

  return data ? { shape: [nx, ny, nz], data } : null
}

function setOverlay(context: CommandContext, segmentationId: string, sourceVolumeId: string): void {
  for (const [viewportId, state] of context.viewportService.renderStates) {
    if (state.image.volumeId !== sourceVolumeId) {
      continue
    }
    const next = cloneMprState(state)
    next.overlay = { segmentationId, visible: true }
    context.viewportService.setRenderState(viewportId, next)
    context.renderService.requestRender(viewportId)
  }
}

function nnService(context: ExtensionContext): NnInteractiveService {
  return context.services.get<NnInteractiveService>(NNINTERACTIVE_SERVICE_ID)
}

function nnServiceFromCommand(context: CommandContext): NnInteractiveService {
  return context.extensions.get<NnInteractiveService>(NNINTERACTIVE_SERVICE_ID)
}
