import type { Vec2n } from 'wgpu-matrix'
import type { DragTool, PointTool, ToolContext } from './tool'
import type { ToolInputEvent } from './toolInput'
import type { ToolGroupService } from './toolGroupService'

type ActiveDrag = {
  viewportId: string
  previous: Vec2n
  tool: DragTool
}

type PendingPoint = {
  viewportId: string
  start: Vec2n
  tool: PointTool
}

export class ToolController {
  private activeDrag: ActiveDrag | null = null
  private pendingPoint: PendingPoint | null = null
  private readonly context: ToolContext
  private readonly toolGroups: ToolGroupService

  constructor(context: ToolContext, toolGroups: ToolGroupService) {
    this.context = context
    this.toolGroups = toolGroups
  }

  handleInput(event: ToolInputEvent): void {
    if (event.type === 'pointerDown') {
      const pointTool = this.toolGroups.findPointTool(event.viewportId, event)
      if (pointTool) {
        this.pendingPoint = {
          viewportId: event.viewportId,
          start: event.clientPoint,
          tool: pointTool,
        }
        return
      }
      const tool = this.toolGroups.findDragTool(event.viewportId, event)
      if (!tool) {
        return
      }
      this.activeDrag = {
        viewportId: event.viewportId,
        previous: event.clientPoint,
        tool,
      }
      tool.onDragStart?.(event, this.context)
      return
    }

    if (event.type === 'pointerMove') {
      if (this.activeDrag && this.activeDrag.viewportId === event.viewportId) {
        const delta: Vec2n = [
          event.clientPoint[0] - this.activeDrag.previous[0],
          event.clientPoint[1] - this.activeDrag.previous[1],
        ]
        this.activeDrag.previous = event.clientPoint
        this.activeDrag.tool.onDrag(delta, event, this.context)
      } else {
        if (this.pendingPoint && pointDistance(this.pendingPoint.start, event.clientPoint) > 4) {
          this.pendingPoint = null
        }
        this.toolGroups.findHoverTool(event.viewportId)?.onMove(event, this.context)
      }
      return
    }

    if (event.type === 'pointerUp') {
      if (this.pendingPoint && this.pendingPoint.viewportId === event.viewportId) {
        const pointEvent = { ...event, type: 'point' as const }
        const tool = this.pendingPoint.tool
        this.pendingPoint = null
        tool.onPoint(pointEvent, this.context)
        return
      }
      this.finishDrag(event, 'end')
      return
    }

    if (event.type === 'pointerCancel') {
      this.finishDrag(event, 'cancel')
      return
    }

    if (event.type === 'wheel') {
      this.toolGroups.findWheelTool(event.viewportId, event)?.onWheel(event, this.context)
      return
    }

    if (event.type === 'keyDown') {
      this.toolGroups.findKeyTool(event.viewportId, event)?.onKeyDown?.(event, this.context)
      return
    }

    if (event.type === 'keyUp') {
      this.toolGroups.findKeyTool(event.viewportId, event)?.onKeyUp?.(event, this.context)
    }
  }

  clearHover(): void {
    this.context.onCursorLeave()
  }

  cancelDrag(): void {
    this.activeDrag = null
    this.pendingPoint = null
  }

  private finishDrag(event: ToolInputEvent, reason: 'end' | 'cancel'): void {
    if (this.activeDrag) {
      const dragEvent = { ...event, viewportId: this.activeDrag.viewportId }
      if (reason === 'end') {
        this.activeDrag.tool.onDragEnd?.(dragEvent, this.context)
      } else {
        this.activeDrag.tool.onDragCancel?.(dragEvent, this.context)
      }
      this.activeDrag = null
    }
  }
}

function pointDistance(a: Vec2n, b: Vec2n): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
