import type { Command } from '../commands/commandDispatcher'
import type { ToolRegistration } from '../tools/toolRegistry'
import type { Disposable } from './eventBus'
import type {
  ExtensionContext,
  ExtensionPanelContribution,
  ExtensionToolPanelContribution,
  ExtensionToolPanelEntry,
  SegmentActionContribution,
  SegmentActionEntry,
  SegmentContextItem,
  SceneActionContribution,
  SceneContextItem,
  WebRendererExtension,
} from './types'

type ActivatedExtension = {
  id: string
  context: ExtensionContext
  disposables: Disposable[]
}

export class ExtensionHost {
  private readonly activated: ActivatedExtension[] = []
  private readonly extensionIds = new Set<string>()
  private readonly panelContributions: { extensionId: string; panel: ExtensionPanelContribution }[] = []
  private readonly toolPanelContributions: { extensionId: string; panel: ExtensionToolPanelContribution }[] = []
  private readonly sceneActionContributions: { extensionId: string; action: SceneActionContribution }[] = []
  private readonly segmentActionContributions: { extensionId: string; action: SegmentActionContribution }[] = []

  async activate(extension: WebRendererExtension, context: ExtensionContext): Promise<void> {
    if (this.extensionIds.has(extension.id)) {
      throw new Error(`Extension already activated: ${extension.id}`)
    }
    this.extensionIds.add(extension.id)
    const disposables: Disposable[] = []

    for (const service of extension.services ?? []) {
      disposables.push(context.services.register(service.id, service.create(context)))
    }
    for (const tool of extension.tools ?? []) {
      context.toolRegistry.register(tool as ToolRegistration)
      disposables.push({ dispose: () => context.toolRegistry.unregister(tool.id) })
    }
    for (const command of extension.commands?.(context) ?? []) {
      context.commands.register(command as Command)
      disposables.push({ dispose: () => context.commands.unregister(command.id) })
    }
    for (const panel of extension.panels ?? []) {
      this.panelContributions.push({ extensionId: extension.id, panel })
      disposables.push({ dispose: () => removeContribution(this.panelContributions, extension.id, panel.id) })
    }
    for (const panel of extension.toolPanels ?? []) {
      this.toolPanelContributions.push({ extensionId: extension.id, panel })
      disposables.push({ dispose: () => removeContribution(this.toolPanelContributions, extension.id, panel.id) })
    }
    for (const action of extension.sceneActions ?? []) {
      this.sceneActionContributions.push({ extensionId: extension.id, action })
      disposables.push({ dispose: () => removeContribution(this.sceneActionContributions, extension.id, action.id) })
    }
    for (const action of extension.segmentActions ?? []) {
      this.segmentActionContributions.push({ extensionId: extension.id, action })
      disposables.push({ dispose: () => removeContribution(this.segmentActionContributions, extension.id, action.id) })
    }

    const activatedDisposable = await extension.activate?.(context)
    if (Array.isArray(activatedDisposable)) {
      disposables.push(...activatedDisposable)
    } else if (activatedDisposable) {
      disposables.push(activatedDisposable)
    }

    this.activated.push({ id: extension.id, context, disposables })
  }

  get panels(): ExtensionPanelContribution[] {
    return this.panelContributions
      .map(entry => entry.panel)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  get panelEntries(): { panel: ExtensionPanelContribution; context: ExtensionContext }[] {
    const byExtension = new Map(this.activated.map(extension => [extension.id, extension.context]))
    return this.panelContributions
      .map(entry => ({ panel: entry.panel, context: byExtension.get(entry.extensionId) }))
      .filter((entry): entry is { panel: ExtensionPanelContribution; context: ExtensionContext } => Boolean(entry.context))
      .sort((a, b) => (a.panel.order ?? 0) - (b.panel.order ?? 0))
  }

  get toolPanelEntries(): ExtensionToolPanelEntry[] {
    const byExtension = new Map(this.activated.map(extension => [extension.id, extension.context]))
    return this.toolPanelContributions
      .map(entry => ({ panel: entry.panel, context: byExtension.get(entry.extensionId) }))
      .filter((entry): entry is ExtensionToolPanelEntry => Boolean(entry.context))
      .sort((a, b) => (a.panel.order ?? 0) - (b.panel.order ?? 0))
  }

  sceneActionsFor(item: SceneContextItem): { action: SceneActionContribution; context: ExtensionContext }[] {
    const byExtension = new Map(this.activated.map(extension => [extension.id, extension.context]))
    return this.sceneActionContributions
      .map(entry => ({ action: entry.action, context: byExtension.get(entry.extensionId) }))
      .filter((entry): entry is { action: SceneActionContribution; context: ExtensionContext } => Boolean(entry.context))
      .filter(entry => entry.action.isVisible?.(item, { extension: entry.context }) ?? true)
      .sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0))
  }

  segmentActionsFor(item: SegmentContextItem): SegmentActionEntry[] {
    const byExtension = new Map(this.activated.map(extension => [extension.id, extension.context]))
    return this.segmentActionContributions
      .map(entry => ({ action: entry.action, context: byExtension.get(entry.extensionId) }))
      .filter((entry): entry is SegmentActionEntry => Boolean(entry.context))
      .filter(entry => entry.action.isVisible?.(item, { extension: entry.context }) ?? true)
      .sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0))
  }

  dispose(): void {
    for (const extension of [...this.activated].reverse()) {
      for (const disposable of [...extension.disposables].reverse()) {
        disposable.dispose()
      }
    }
    this.activated.length = 0
    this.extensionIds.clear()
    this.panelContributions.length = 0
    this.toolPanelContributions.length = 0
    this.sceneActionContributions.length = 0
    this.segmentActionContributions.length = 0
  }
}

function removeContribution(
  contributions: {
    extensionId: string
    panel?: ExtensionPanelContribution | ExtensionToolPanelContribution
    action?: SceneActionContribution | SegmentActionContribution
  }[],
  extensionId: string,
  contributionId: string,
): void {
  const index = contributions.findIndex(entry => {
    const id = entry.panel?.id ?? entry.action?.id
    return entry.extensionId === extensionId && id === contributionId
  })
  if (index >= 0) {
    contributions.splice(index, 1)
  }
}
