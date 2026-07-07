import type { Disposable } from './eventBus'

export interface InteractionModeContribution {
  readonly id: string
  readonly label: string
  readonly order?: number
  canActivate?(): string | null
  activate(): void
}

export class InteractionModeService {
  private readonly modes = new Map<string, InteractionModeContribution>()
  private activeModeId = 'core.navigate'

  register(mode: InteractionModeContribution): Disposable {
    if (this.modes.has(mode.id)) {
      throw new Error(`Interaction mode already registered: ${mode.id}`)
    }
    this.modes.set(mode.id, mode)
    return {
      dispose: () => {
        this.modes.delete(mode.id)
      },
    }
  }

  activate(modeId: string): string | null {
    const mode = this.modes.get(modeId)
    if (!mode) {
      return `Interaction mode not registered: ${modeId}`
    }
    const reason = mode.canActivate?.() ?? null
    if (reason) {
      return reason
    }
    mode.activate()
    this.activeModeId = modeId
    return null
  }

  getActiveModeId(): string {
    return this.activeModeId
  }

  list(): InteractionModeContribution[] {
    return [...this.modes.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }
}
