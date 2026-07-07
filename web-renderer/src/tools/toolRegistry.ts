import type { Tool } from './tool'

export interface ToolRegistration<TTool extends Tool = Tool> {
  readonly id: string
  create(): TTool
}

export class ToolRegistry {
  private readonly registrations = new Map<string, ToolRegistration>()

  register<TTool extends Tool>(registration: ToolRegistration<TTool>): void {
    if (this.registrations.has(registration.id)) {
      throw new Error(`Tool already registered: ${registration.id}`)
    }
    this.registrations.set(registration.id, registration)
  }

  create(toolId: string): Tool {
    const registration = this.registrations.get(toolId)
    if (!registration) {
      throw new Error(`Tool not registered: ${toolId}`)
    }
    const tool = registration.create()
    if (tool.id !== toolId) {
      throw new Error(`Tool registration ${toolId} created tool ${tool.id}.`)
    }
    return tool
  }

  has(toolId: string): boolean {
    return this.registrations.has(toolId)
  }

  unregister(toolId: string): void {
    this.registrations.delete(toolId)
  }
}
