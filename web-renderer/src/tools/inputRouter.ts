import { modifiersFromEvent } from './toolInput'
import type { ToolController } from './toolController'
import type { ToolInputEvent } from './toolInput'

export class InputRouter {
  private readonly controller: ToolController

  constructor(controller: ToolController) {
    this.controller = controller
  }

  handlePointerDown(event: PointerEvent, viewportId: string): void {
    this.controller.handleInput(this.pointerEvent('pointerDown', event, viewportId))
  }

  handlePointerMove(event: PointerEvent, viewportId: string): void {
    this.controller.handleInput(this.pointerEvent('pointerMove', event, viewportId))
  }

  handlePointerUp(event: PointerEvent, viewportId: string): void {
    this.controller.handleInput(this.pointerEvent('pointerUp', event, viewportId))
  }

  handlePointerCancel(event: PointerEvent, viewportId: string): void {
    this.controller.handleInput(this.pointerEvent('pointerCancel', event, viewportId))
  }

  handleWheel(event: WheelEvent, viewportId: string): void {
    this.controller.handleInput({
      type: 'wheel',
      viewportId,
      clientPoint: [event.clientX, event.clientY],
      button: 0,
      buttons: event.buttons,
      deltaY: event.deltaY,
      modifiers: modifiersFromEvent(event),
    })
  }

  handleKeyDown(event: KeyboardEvent, viewportId: string): void {
    this.controller.handleInput(this.keyboardEvent('keyDown', event, viewportId))
  }

  handleKeyUp(event: KeyboardEvent, viewportId: string): void {
    this.controller.handleInput(this.keyboardEvent('keyUp', event, viewportId))
  }

  clearHover(): void {
    this.controller.clearHover()
  }

  cancelDrag(): void {
    this.controller.cancelDrag()
  }

  private pointerEvent(type: ToolInputEvent['type'], event: PointerEvent, viewportId: string): ToolInputEvent {
    return {
      type,
      viewportId,
      clientPoint: [event.clientX, event.clientY],
      button: event.button,
      buttons: event.buttons,
      deltaY: 0,
      pointerId: event.pointerId,
      modifiers: modifiersFromEvent(event),
    }
  }

  private keyboardEvent(type: ToolInputEvent['type'], event: KeyboardEvent, viewportId: string): ToolInputEvent {
    return {
      type,
      viewportId,
      clientPoint: [0, 0],
      button: 0,
      buttons: 0,
      deltaY: 0,
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      modifiers: modifiersFromEvent(event),
    }
  }
}
