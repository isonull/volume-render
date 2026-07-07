import type { RenderService } from '../services/renderService'
import type { SceneService } from '../services/sceneService'
import type { SegmentationService } from '../services/segmentationService'
import type { ViewportService } from '../services/viewportService'
import type { RuntimeEventBus } from '../extensions/eventBus'
import type { ExtensionServiceRegistry } from '../extensions/serviceRegistry'

export interface CommandContext {
  sceneService: SceneService
  viewportService: ViewportService
  renderService: RenderService
  segmentationService: SegmentationService
  extensions: ExtensionServiceRegistry
  events: RuntimeEventBus
}

export interface Command<TOptions = unknown, TResult = unknown> {
  readonly id: string
  execute(options: TOptions, context: CommandContext): TResult | Promise<TResult>
}

export class CommandDispatcher {
  private readonly commands = new Map<string, Command<unknown, unknown>>()
  readonly context: CommandContext

  constructor(context: CommandContext) {
    this.context = context
  }

  register<TOptions, TResult>(command: Command<TOptions, TResult>): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`)
    }
    this.commands.set(command.id, command as Command<unknown, unknown>)
  }

  unregister(commandId: string): void {
    this.commands.delete(commandId)
  }

  execute<TOptions, TResult>(commandId: string, options: TOptions): TResult {
    const command = this.commands.get(commandId)
    if (!command) {
      throw new Error(`Command not registered: ${commandId}`)
    }
    return command.execute(options, this.context) as TResult
  }
}
