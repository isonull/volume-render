import type { ReactNode } from 'react'
import type { Command, CommandDispatcher } from '../commands/commandDispatcher'
import type { RenderService } from '../services/renderService'
import type { SceneService } from '../services/sceneService'
import type { SegmentationService } from '../services/segmentationService'
import type { ViewportService } from '../services/viewportService'
import type { ToolRegistration } from '../tools/toolRegistry'
import type { ToolGroupService } from '../tools/toolGroupService'
import type { ToolRegistry } from '../tools/toolRegistry'
import type { LabelmapSegmentationData } from '../segmentation'
import type { ScalarVolume } from '../volume'
import type { Disposable, RuntimeEventBus } from './eventBus'
import type { InteractionModeService } from './interactionModeService'
import type { ExtensionServiceRegistry } from './serviceRegistry'

export interface CoreRuntimeServices {
  readonly sceneService: SceneService
  readonly viewportService: ViewportService
  readonly renderService: RenderService
  readonly segmentationService: SegmentationService
}

export type SceneContextItem = {
  readonly kind: 'volume' | 'segmentation'
  readonly id: string
}

export type SegmentContextItem = {
  readonly segmentationId: string
  readonly sourceVolumeId: string
  readonly segmentLabel: number
}

/**
 * App-level singleton pointing at the currently open workflow panel.
 * The panel target is segment-scoped even when the panel itself is contributed
 * by a workflow extension such as nnInteractive.
 */
export type ActiveToolPanel = {
  readonly id: string
  readonly segmentationId: string
  readonly segmentLabel: number
} | null

export interface ExtensionAppApi {
  getActiveVolume(): ScalarVolume | null
  setActiveVolume(volume: ScalarVolume | null): void
  getActiveSegmentation(): LabelmapSegmentationData | null
  getActiveSegmentationId(): string | null
  setActiveSegmentationId(segmentationId: string | null): void
  getActiveToolPanel(): ActiveToolPanel
  setActiveToolPanel(panel: ActiveToolPanel): void
  getInteractionMode(): string
  setInteractionMode(modeId: string): void
  setStatus(message: string): void
  invalidateUi(): void
  centerVolume(volumeId: string): void
  openSegmentationForVolume(volumeId: string): void
  closeSceneItem(item: SceneContextItem): void
}

export interface ExtensionContext {
  readonly extensionId: string
  readonly core: CoreRuntimeServices
  readonly commands: CommandDispatcher
  readonly toolRegistry: ToolRegistry
  readonly toolGroups: ToolGroupService
  readonly services: ExtensionServiceRegistry
  readonly events: RuntimeEventBus
  readonly interactionModes: InteractionModeService
  readonly app: ExtensionAppApi
}

export interface ExtensionPanelRenderContext {
  readonly uiVersion: number
  readonly extension: ExtensionContext
  segmentActionsFor(item: SegmentContextItem): SegmentActionEntry[]
  readonly toolPanels: ExtensionToolPanelEntry[]
}

/**
 * Right-side app-level panel contribution.
 * Use this for persistent UI such as the Segmentation panel, not for a
 * segment-scoped transient workflow.
 */
export interface ExtensionPanelContribution {
  readonly id: string
  readonly title: string
  readonly order?: number
  render(context: ExtensionPanelRenderContext): ReactNode
}

export interface SceneActionRenderContext {
  readonly extension: ExtensionContext
}

/**
 * Context-menu contribution for a volume or whole segmentation in the Scene
 * browser.
 */
export interface SceneActionContribution {
  readonly id: string
  readonly label: string
  readonly order?: number
  isVisible?(item: SceneContextItem, context: SceneActionRenderContext): boolean
  run(item: SceneContextItem, context: SceneActionRenderContext): void | Promise<void>
}

export interface SegmentActionRenderContext {
  readonly extension: ExtensionContext
}

/**
 * Context-menu contribution for one segment label inside one segmentation.
 * Segment actions are the entry point for label-scoped workflows.
 */
export interface SegmentActionContribution {
  readonly id: string
  readonly label: string
  readonly order?: number
  isVisible?(item: SegmentContextItem, context: SegmentActionRenderContext): boolean
  run(item: SegmentContextItem, context: SegmentActionRenderContext): void | Promise<void>
}

export type SegmentActionEntry = {
  readonly action: SegmentActionContribution
  readonly context: ExtensionContext
}

export interface ExtensionToolPanelRenderContext {
  readonly uiVersion: number
  readonly extension: ExtensionContext
  readonly activePanel: NonNullable<ActiveToolPanel>
}

/**
 * Segment-scoped workflow panel contribution rendered in the active
 * tool-panel slot. Tool panels should provide an exit path back to a neutral
 * interaction mode.
 */
export interface ExtensionToolPanelContribution {
  readonly id: string
  readonly title: string
  readonly order?: number
  render(context: ExtensionToolPanelRenderContext): ReactNode
}

export type ExtensionToolPanelEntry = {
  readonly panel: ExtensionToolPanelContribution
  readonly context: ExtensionContext
}

export interface ExtensionServiceContribution<TService = unknown> {
  readonly id: string
  create(context: ExtensionContext): TService
}

/**
 * Compile-time extension manifest. This is the first-party contribution
 * contract for commands, tools, services, UI slots, context actions, and
 * lifecycle hooks.
 */
export interface WebRendererExtension {
  readonly id: string
  readonly displayName?: string
  commands?(context: ExtensionContext): Command[]
  tools?: ToolRegistration[]
  services?: ExtensionServiceContribution[]
  panels?: ExtensionPanelContribution[]
  toolPanels?: ExtensionToolPanelContribution[]
  sceneActions?: SceneActionContribution[]
  segmentActions?: SegmentActionContribution[]
  activate?(context: ExtensionContext): void | Disposable | Disposable[] | Promise<void | Disposable | Disposable[]>
}
