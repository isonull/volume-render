import type { Disposable } from './eventBus'

export class ExtensionServiceRegistry {
  private readonly services = new Map<string, unknown>()

  register<TService>(id: string, service: TService): Disposable {
    if (this.services.has(id)) {
      throw new Error(`Extension service already registered: ${id}`)
    }
    this.services.set(id, service)
    return {
      dispose: () => {
        if (this.services.get(id) === service) {
          this.services.delete(id)
        }
      },
    }
  }

  get<TService>(id: string): TService {
    const service = this.services.get(id)
    if (!service) {
      throw new Error(`Extension service not registered: ${id}`)
    }
    return service as TService
  }

  maybeGet<TService>(id: string): TService | null {
    return (this.services.get(id) as TService | undefined) ?? null
  }

  has(id: string): boolean {
    return this.services.has(id)
  }
}
