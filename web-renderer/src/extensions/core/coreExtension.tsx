import { useEffect, useState } from 'react'
import { SET_OVERLAY_SEGMENTATION_COMMAND, createMprCommands } from '../../commands/mprCommands'
import { CREATE_SEGMENTATION_COMMAND, createSceneCommands } from '../../commands/sceneCommands'
import {
  DELETE_SEGMENT_COMMAND,
  UPSERT_SEGMENT_COMMAND,
  createSegmentationCommands,
} from '../../commands/segmentationCommands'
import type { DeleteSegmentCommandOptions, UpsertSegmentCommandOptions } from '../../commands/segmentationCommands'
import type { LabelmapSegmentationData, Segment } from '../../segmentation'
import { PanTool, ProbeTool, SegmentationBrushTool, StackScrollTool, WindowLevelTool, ZoomTool } from '../../mpr/mprTools'
import type { ToolBinding } from '../../tools/tool'
import type {
  ActiveToolPanel,
  ExtensionContext,
  ExtensionToolPanelEntry,
  SceneContextItem,
  SegmentActionEntry,
  SegmentContextItem,
  WebRendererExtension,
} from '../types'

export const MPR_TOOL_GROUP_ID = 'mpr'
const CORE_BRUSH_TOOL_PANEL_ID = 'core.brushPanel'

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false }

export function createCoreExtension(): WebRendererExtension {
  return {
    id: 'core',
    displayName: 'Core MPR',
    commands: () => [...createSceneCommands(), ...createMprCommands(), ...createSegmentationCommands()],
    tools: [
      { id: 'mpr.pan', create: () => new PanTool() },
      { id: 'mpr.windowLevel', create: () => new WindowLevelTool() },
      { id: 'mpr.stackScroll', create: () => new StackScrollTool() },
      { id: 'mpr.zoom', create: () => new ZoomTool() },
      { id: 'mpr.probe', create: () => new ProbeTool() },
      { id: 'seg.brush', create: () => new SegmentationBrushTool() },
    ],
    panels: [{
      id: 'core.segmentation',
      title: 'Segmentation',
      order: 10,
      render: ({ extension, segmentActionsFor, toolPanels, uiVersion }) => (
        <CoreSegmentationPanel
          context={extension}
          segmentActionsFor={segmentActionsFor}
          toolPanels={toolPanels}
          uiVersion={uiVersion}
        />
      ),
    }],
    toolPanels: [{
      id: CORE_BRUSH_TOOL_PANEL_ID,
      title: 'Brush',
      order: 10,
      render: ({ extension, activePanel }) => <BrushToolPanel activePanel={activePanel} context={extension} />,
    }],
    segmentActions: [
      {
        id: 'core.segment.brush',
        label: 'Brush',
        order: 10,
        run: (item, { extension }) => {
          openBrushToolPanel(extension, item)
        },
      },
      {
        id: 'core.segment.delete',
        label: 'Delete',
        order: 90,
        run: (item, { extension }) => {
          deleteSegment(extension, item)
        },
      },
    ],
    sceneActions: [
      {
        id: 'core.center',
        label: 'Center',
        order: 10,
        run: (item, { extension }) => {
          if (item.kind === 'volume') {
            extension.app.centerVolume(item.id)
            return
          }
          const segmentation = extension.core.sceneService.scene?.segmentations.get(item.id)
          if (segmentation) {
            extension.app.setActiveSegmentationId(segmentation.id)
            extension.app.centerVolume(segmentation.sourceVolumeId)
          }
        },
      },
      {
        id: 'core.openSegmentation',
        label: 'Open Segmentation',
        order: 30,
        isVisible: item => item.kind === 'volume',
        run: (item, { extension }) => {
          extension.app.openSegmentationForVolume(item.id)
        },
      },
      {
        id: 'core.newSegmentation',
        label: 'New Segmentation',
        order: 20,
        isVisible: item => item.kind === 'volume',
        run: (item, { extension }) => {
          createNewSegmentation(extension, item.id)
        },
      },
      {
        id: 'core.save',
        label: 'Save',
        order: 80,
        run: async (item, { extension }) => {
          await saveSceneItem(extension, item)
        },
      },
      {
        id: 'core.close',
        label: 'Close',
        order: 90,
        run: (item, { extension }) => {
          extension.app.closeSceneItem(item)
        },
      },
    ],
    activate: context => {
      if (!context.toolGroups.hasToolGroup(MPR_TOOL_GROUP_ID)) {
        context.toolGroups.createToolGroup(MPR_TOOL_GROUP_ID)
      }

      const toolDisposables = addCoreTools(context)
      const modeDisposables = [
        context.interactionModes.register({
          id: 'core.navigate',
          label: 'Navigate',
          order: 10,
          activate: () => {
            context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'mpr.pan', 'active')
            context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'seg.brush', 'disabled')
            context.toolGroups.setToolModeByBindingKind(MPR_TOOL_GROUP_ID, 'point', 'disabled')
            context.app.setInteractionMode('core.navigate')
          },
        }),
        context.interactionModes.register({
          id: 'core.brush',
          label: 'Brush',
          order: 20,
          canActivate: () => context.core.segmentationService.getActiveSegmentationId()
            ? null
            : 'Open a segmentation before using brush tools.',
          activate: () => {
            context.core.segmentationService.setBrushMode('paint')
            context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'mpr.pan', 'disabled')
            context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'seg.brush', 'active')
            context.toolGroups.setToolModeByBindingKind(MPR_TOOL_GROUP_ID, 'point', 'disabled')
            context.app.setInteractionMode('core.brush')
          },
        }),
        context.interactionModes.register({
          id: 'core.erase',
          label: 'Erase',
          order: 30,
          canActivate: () => context.core.segmentationService.getActiveSegmentationId()
            ? null
            : 'Open a segmentation before using erase tools.',
          activate: () => {
            context.core.segmentationService.setBrushMode('erase')
            context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'mpr.pan', 'disabled')
            context.toolGroups.setToolModeIfPresent(MPR_TOOL_GROUP_ID, 'seg.brush', 'active')
            context.toolGroups.setToolModeByBindingKind(MPR_TOOL_GROUP_ID, 'point', 'disabled')
            context.app.setInteractionMode('core.erase')
          },
        }),
      ]

      return [
        ...toolDisposables,
        ...modeDisposables,
        { dispose: () => context.toolGroups.removeToolGroup(MPR_TOOL_GROUP_ID) },
      ]
    },
  }
}

function addCoreTools(context: ExtensionContext) {
  const addTool = (toolId: string, mode: 'active' | 'passive' | 'disabled', bindings: ToolBinding[]) => {
    context.toolGroups.addTool(MPR_TOOL_GROUP_ID, toolId, { mode, bindings })
    return { dispose: () => context.toolGroups.removeTool(MPR_TOOL_GROUP_ID, toolId) }
  }

  return [
    addTool('mpr.pan', 'active', [{ kind: 'drag', button: 0, modifiers: NO_MODIFIERS }]),
    addTool('mpr.windowLevel', 'active', [
      { kind: 'drag', button: 0, modifiers: { ...NO_MODIFIERS, shift: true } },
      { kind: 'drag', button: 2, modifiers: NO_MODIFIERS },
    ]),
    addTool('mpr.stackScroll', 'active', [{ kind: 'wheel', modifiers: NO_MODIFIERS }]),
    addTool('mpr.zoom', 'active', [{ kind: 'wheel', modifiers: { ...NO_MODIFIERS, ctrl: true } }]),
    addTool('mpr.probe', 'passive', [{ kind: 'hover' }]),
    addTool('seg.brush', 'disabled', [
      { kind: 'drag', button: 0, modifiers: NO_MODIFIERS },
      { kind: 'hover' },
    ]),
  ]
}

type SegmentMenuState = {
  x: number
  y: number
  item: SegmentContextItem
}

function CoreSegmentationPanel({
  context,
  segmentActionsFor,
  toolPanels,
  uiVersion,
}: {
  context: ExtensionContext
  segmentActionsFor(item: SegmentContextItem): SegmentActionEntry[]
  toolPanels: ExtensionToolPanelEntry[]
  uiVersion: number
}) {
  const activeSegmentation = context.app.getActiveSegmentation()
  const [isAdding, setIsAdding] = useState(false)
  const [labelInput, setLabelInput] = useState('')
  const [segmentMenu, setSegmentMenu] = useState<SegmentMenuState | null>(null)

  useEffect(() => {
    if (!segmentMenu) {
      return
    }
    const closeMenu = () => setSegmentMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [segmentMenu])

  if (!activeSegmentation) {
    return null
  }

  const segmentationService = context.core.segmentationService
  const activeLabel = segmentationService.getActiveSegmentLabel()
  const segments = sortedSegments(activeSegmentation)
  const activeToolPanel = context.app.getActiveToolPanel()
  const activeToolPanelEntry = activeToolPanel
    ? toolPanels.find(entry => entry.panel.id === activeToolPanel.id) ?? null
    : null

  return (
    <section className="segmentation-tools" aria-label="Segmentation tools">
      <div className="panel-header-row">
        <h2>Segmentation</h2>
        <button
          type="button"
          className="icon-button"
          title="Add segment"
          aria-label="Add segment"
          onClick={() => {
            setIsAdding(value => !value)
            setLabelInput(nextAvailableLabel(activeSegmentation).toString())
          }}
        >
          +
        </button>
      </div>
      <dl className="extension-status">
        <div>
          <dt>Active</dt>
          <dd>{activeSegmentation.id}</dd>
        </div>
        <div>
          <dt>Labels</dt>
          <dd>{segments.length}</dd>
        </div>
      </dl>
      {isAdding ? (
        <form
          className="add-segment-form"
          onSubmit={event => {
            event.preventDefault()
            addSegment(context, activeSegmentation, labelInput, () => {
              setIsAdding(false)
              setLabelInput('')
            })
          }}
        >
          <input
            aria-label="New segment label"
            inputMode="numeric"
            value={labelInput}
            onChange={event => setLabelInput(event.currentTarget.value)}
          />
          <button type="submit">Add</button>
        </form>
      ) : null}
      <ul className="segment-list" aria-label="Segments">
        {segments.length === 0 ? (
          <li className="segment-empty">No segments</li>
        ) : segments.map(segment => {
          const item: SegmentContextItem = {
            segmentationId: activeSegmentation.id,
            sourceVolumeId: activeSegmentation.sourceVolumeId,
            segmentLabel: segment.label,
          }
          return (
            <li key={segment.label}>
              <button
                type="button"
                className={`segment-row${activeLabel === segment.label ? ' active' : ''}`}
                onClick={() => {
                  segmentationService.setActiveSegmentLabel(segment.label)
                  context.app.invalidateUi()
                }}
                onContextMenu={event => {
                  event.preventDefault()
                  setSegmentMenu({ x: event.clientX, y: event.clientY, item })
                }}
              >
                <span className="segment-color" style={{ background: cssRgb(segment.color) }} />
                <span className="segment-main">
                  <span>{segment.name}</span>
                  <small>{`Label ${segment.label}${segment.locked ? ' / locked' : ''}`}</small>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {activeToolPanel && activeToolPanelEntry ? (
        activeToolPanelEntry.panel.render({
          uiVersion,
          extension: activeToolPanelEntry.context,
          activePanel: activeToolPanel,
        })
      ) : null}
      {segmentMenu ? (
        <SegmentContextMenu
          actions={segmentActionsFor(segmentMenu.item)}
          item={segmentMenu.item}
          onClose={() => setSegmentMenu(null)}
          x={segmentMenu.x}
          y={segmentMenu.y}
        />
      ) : null}
    </section>
  )
}

function SegmentContextMenu({
  actions,
  item,
  onClose,
  x,
  y,
}: {
  actions: SegmentActionEntry[]
  item: SegmentContextItem
  onClose(): void
  x: number
  y: number
}) {
  return (
    <div className="context-menu segment-context-menu" style={{ left: x, top: y }} onClick={event => event.stopPropagation()}>
      {actions.length === 0 ? (
        <button type="button" disabled>No actions</button>
      ) : actions.map(({ action, context }) => (
        <button
          key={`${context.extensionId}:${action.id}`}
          type="button"
          onClick={() => {
            void action.run(item, { extension: context })
            onClose()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

function BrushToolPanel({ activePanel, context }: { activePanel: NonNullable<ActiveToolPanel>; context: ExtensionContext }) {
  const segmentation = context.core.sceneService.scene?.segmentations.get(activePanel.segmentationId) ?? null
  const segment = segmentation?.segments.get(activePanel.segmentLabel) ?? null
  if (!segmentation || !segment) {
    return null
  }

  const radiusMm = context.core.segmentationService.getBrushRadiusMm()
  const activeMode = context.app.getInteractionMode()

  return (
    <section className="extension-panel brush-tool-panel" aria-label="Brush tool">
      <div className="panel-header-row">
        <h2>Brush</h2>
        <button type="button" onClick={() => exitToolPanel(context)}>Exit</button>
      </div>
      <dl className="extension-status">
        <div>
          <dt>Label</dt>
          <dd>{`${segment.label} / ${segment.name}`}</dd>
        </div>
      </dl>
      <div className="segmented-control" role="group" aria-label="Brush mode">
        <button
          type="button"
          className={activeMode === 'core.brush' ? 'active' : ''}
          onClick={() => activateMode(context, 'core.brush')}
        >
          Brush
        </button>
        <button
          type="button"
          className={activeMode === 'core.erase' ? 'active' : ''}
          onClick={() => activateMode(context, 'core.erase')}
        >
          Erase
        </button>
      </div>
      <div className="tool-field">
        <span>Radius</span>
        <div className="stepper">
          <button type="button" onClick={() => setBrushRadiusMm(context, radiusMm - 0.5)}>-</button>
          <output>{`${radiusMm.toFixed(1)} mm`}</output>
          <button type="button" onClick={() => setBrushRadiusMm(context, radiusMm + 0.5)}>+</button>
        </div>
      </div>
    </section>
  )
}

function activateMode(context: ExtensionContext, modeId: string): void {
  const reason = context.interactionModes.activate(modeId)
  if (reason) {
    context.app.setStatus(reason)
  }
  if (modeId === 'core.navigate') {
    context.app.setActiveToolPanel(null)
  }
  context.app.invalidateUi()
}

function exitToolPanel(context: ExtensionContext): void {
  context.app.setActiveToolPanel(null)
  activateMode(context, 'core.navigate')
}

function setBrushRadiusMm(context: ExtensionContext, radiusMm: number): void {
  const next = Math.max(0.25, Number(radiusMm.toFixed(2)))
  context.core.segmentationService.setBrushRadiusMm(next)
  context.app.invalidateUi()
}

function openBrushToolPanel(context: ExtensionContext, item: SegmentContextItem): void {
  context.app.setActiveSegmentationId(item.segmentationId)
  context.core.segmentationService.setActiveSegmentLabel(item.segmentLabel)
  context.app.setActiveToolPanel({
    id: CORE_BRUSH_TOOL_PANEL_ID,
    segmentationId: item.segmentationId,
    segmentLabel: item.segmentLabel,
  })
  activateMode(context, 'core.brush')
}

function createNewSegmentation(context: ExtensionContext, volumeId: string): void {
  const segmentation = context.commands.execute<{ volumeId: string }, LabelmapSegmentationData>(
    CREATE_SEGMENTATION_COMMAND,
    { volumeId },
  )
  context.commands.execute<{
    segmentationId?: string
    sourceVolumeId?: string
    visible: boolean
  }, void>(SET_OVERLAY_SEGMENTATION_COMMAND, {
    segmentationId: segmentation.id,
    sourceVolumeId: segmentation.sourceVolumeId,
    visible: true,
  })
  context.app.setActiveSegmentationId(segmentation.id)
  context.core.segmentationService.setActiveSegmentLabel(1)
  context.app.setActiveToolPanel(null)
  context.app.setStatus(`Created segmentation ${segmentation.id}.`)
  context.app.invalidateUi()
}

async function saveSceneItem(context: ExtensionContext, item: SceneContextItem): Promise<void> {
  const scene = context.core.sceneService.scene
  if (!scene) {
    return
  }
  try {
    if (item.kind === 'volume') {
      const volume = scene.volumes.get(item.id)
      if (!volume) {
        context.app.setStatus(`Volume ${item.id} no longer exists.`)
        return
      }
      context.app.setStatus(`Saving ${volume.source?.uri ?? volume.id}...`)
      const { niftiFileFromScalarVolume } = await import('../../io/nifti')
      const file = niftiFileFromScalarVolume(volume)
      downloadArrayBuffer(file.data, file.fileName)
      context.app.setStatus(`Saved ${file.fileName}.`)
      return
    }

    const segmentation = scene.segmentations.get(item.id)
    if (!segmentation) {
      context.app.setStatus(`Segmentation ${item.id} no longer exists.`)
      return
    }
    context.app.setStatus(`Saving ${segmentation.id}...`)
    const { niftiFileFromLabelmapSegmentation } = await import('../../io/nifti')
    const file = niftiFileFromLabelmapSegmentation(segmentation)
    downloadArrayBuffer(file.data, file.fileName)
    context.app.setStatus(`Saved ${file.fileName}.`)
  } catch (error) {
    context.app.setStatus(errorMessage(error))
  }
}

function downloadArrayBuffer(data: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function addSegment(
  context: ExtensionContext,
  segmentation: LabelmapSegmentationData,
  labelText: string,
  onComplete: () => void,
): void {
  const label = Number.parseInt(labelText.trim(), 10)
  if (!Number.isInteger(label) || label <= 0) {
    context.app.setStatus('Segment label must be a positive integer.')
    return
  }
  if (label > maxLabel(segmentation)) {
    context.app.setStatus(`Segment label ${label} exceeds ${segmentation.data.constructor.name}.`)
    return
  }
  if (segmentation.segments.has(label)) {
    context.app.setStatus(`Segment label ${label} already exists.`)
    return
  }

  const segment: Segment = {
    label,
    name: `Label ${label}`,
    color: defaultSegmentColor(label),
    opacity: 0.55,
    visible: true,
    locked: false,
  }
  context.commands.execute<UpsertSegmentCommandOptions, Segment>(UPSERT_SEGMENT_COMMAND, {
    segmentationId: segmentation.id,
    segment,
  })
  context.core.segmentationService.setActiveSegmentLabel(label)
  context.app.setStatus(`Added segment label ${label}.`)
  context.app.invalidateUi()
  onComplete()
}

function deleteSegment(context: ExtensionContext, item: SegmentContextItem): void {
  const segmentation = context.core.sceneService.scene?.segmentations.get(item.segmentationId)
  const segment = segmentation?.segments.get(item.segmentLabel)
  if (!segmentation || !segment) {
    return
  }
  if (segment.locked) {
    context.app.setStatus(`Segment label ${segment.label} is locked.`)
    return
  }

  context.commands.execute<DeleteSegmentCommandOptions, unknown>(DELETE_SEGMENT_COMMAND, {
    segmentationId: item.segmentationId,
    label: item.segmentLabel,
  })

  const activePanel = context.app.getActiveToolPanel()
  if (
    activePanel?.segmentationId === item.segmentationId &&
    activePanel.segmentLabel === item.segmentLabel
  ) {
    context.app.setActiveToolPanel(null)
  }

  const nextLabel = firstSegmentLabel(segmentation) ?? 1
  if (context.app.getActiveSegmentationId() === item.segmentationId) {
    context.core.segmentationService.setActiveSegmentLabel(nextLabel)
  }
  if (segmentation.segments.size === 0) {
    activateMode(context, 'core.navigate')
  }
  context.app.setStatus(`Deleted segment label ${item.segmentLabel}.`)
  context.app.invalidateUi()
}

function sortedSegments(segmentation: LabelmapSegmentationData): Segment[] {
  return [...segmentation.segments.values()]
    .filter(segment => segment.label > 0)
    .sort((a, b) => a.label - b.label)
}

function firstSegmentLabel(segmentation: LabelmapSegmentationData): number | null {
  return sortedSegments(segmentation)[0]?.label ?? null
}

function nextAvailableLabel(segmentation: LabelmapSegmentationData): number {
  for (let label = 1; label <= maxLabel(segmentation); label += 1) {
    if (!segmentation.segments.has(label)) {
      return label
    }
  }
  return maxLabel(segmentation)
}

function maxLabel(segmentation: LabelmapSegmentationData): number {
  if (segmentation.data instanceof Uint8Array) {
    return 0xff
  }
  if (segmentation.data instanceof Uint16Array) {
    return 0xffff
  }
  return 0xffffffff
}

function defaultSegmentColor(label: number): [number, number, number] {
  const hue = (label * 137.508) % 360
  return hslToRgb(hue / 360, 0.72, 0.56)
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  return [
    hueToRgb(p, q, hue + 1 / 3),
    hueToRgb(p, q, hue),
    hueToRgb(p, q, hue - 1 / 3),
  ]
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t
  if (value < 0) {
    value += 1
  }
  if (value > 1) {
    value -= 1
  }
  if (value < 1 / 6) {
    return p + (q - p) * 6 * value
  }
  if (value < 1 / 2) {
    return q
  }
  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6
  }
  return p
}

function cssRgb(color: Segment['color']): string {
  return `rgb(${color.map(channel => Math.round(channel * 255)).join(' ')})`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
