import type { ToolInputEvent } from './toolInput'
import type { DragTool, HoverTool, KeyTool, Tool, ToolBinding, ToolMode, WheelTool } from './tool'
import type { ToolRegistry } from './toolRegistry'

export interface ToolGroupToolState {
  readonly tool: Tool
  mode: ToolMode
  bindings: ToolBinding[]
}

export interface ToolGroup {
  readonly id: string
  readonly viewportIds: Set<string>
  readonly tools: Map<string, ToolGroupToolState>
}

export class ToolGroupService {
  private readonly registry: ToolRegistry
  private readonly groups = new Map<string, ToolGroup>()
  private readonly viewportToGroupId = new Map<string, string>()

  constructor(registry: ToolRegistry) {
    this.registry = registry
  }

  createToolGroup(groupId: string): ToolGroup {
    if (this.groups.has(groupId)) {
      throw new Error(`Tool group already exists: ${groupId}`)
    }
    const group: ToolGroup = {
      id: groupId,
      viewportIds: new Set(),
      tools: new Map(),
    }
    this.groups.set(groupId, group)
    return group
  }

  addViewport(groupId: string, viewportId: string): void {
    const group = this.requireGroup(groupId)
    const existingGroupId = this.viewportToGroupId.get(viewportId)
    if (existingGroupId && existingGroupId !== groupId) {
      throw new Error(`Viewport ${viewportId} is already assigned to tool group ${existingGroupId}.`)
    }
    group.viewportIds.add(viewportId)
    this.viewportToGroupId.set(viewportId, groupId)
  }

  addTool(
    groupId: string,
    toolId: string,
    options: {
      mode: ToolMode
      bindings?: ToolBinding[]
    },
  ): void {
    const group = this.requireGroup(groupId)
    if (group.tools.has(toolId)) {
      throw new Error(`Tool ${toolId} already exists in tool group ${groupId}.`)
    }
    group.tools.set(toolId, {
      tool: this.registry.create(toolId),
      mode: options.mode,
      bindings: options.bindings ?? [],
    })
  }

  setToolMode(groupId: string, toolId: string, mode: ToolMode): void {
    this.requireToolState(groupId, toolId).mode = mode
  }

  setToolBindings(groupId: string, toolId: string, bindings: ToolBinding[]): void {
    this.requireToolState(groupId, toolId).bindings = bindings
  }

  findDragTool(viewportId: string, event: ToolInputEvent): DragTool | null {
    const group = this.groupForViewport(viewportId)
    if (!group) {
      return null
    }
    for (const state of group.tools.values()) {
      if (state.mode !== 'active' || !isDragTool(state.tool)) {
        continue
      }
      if (state.bindings.some(binding => binding.kind === 'drag' && dragBindingMatches(binding, event))) {
        return state.tool
      }
    }
    return null
  }

  findWheelTool(viewportId: string, event: ToolInputEvent): WheelTool | null {
    const group = this.groupForViewport(viewportId)
    if (!group) {
      return null
    }
    for (const state of group.tools.values()) {
      if (state.mode !== 'active' || !isWheelTool(state.tool)) {
        continue
      }
      if (state.bindings.some(binding => binding.kind === 'wheel' && modifiersMatch(binding.modifiers, event))) {
        return state.tool
      }
    }
    return null
  }

  findHoverTool(viewportId: string): HoverTool | null {
    const group = this.groupForViewport(viewportId)
    if (!group) {
      return null
    }
    for (const state of group.tools.values()) {
      if (state.mode === 'disabled' || !isHoverTool(state.tool)) {
        continue
      }
      if (state.bindings.some(binding => binding.kind === 'hover')) {
        return state.tool
      }
    }
    return null
  }

  findKeyTool(viewportId: string, event: ToolInputEvent): KeyTool | null {
    const group = this.groupForViewport(viewportId)
    if (!group) {
      return null
    }
    for (const state of group.tools.values()) {
      if (state.mode === 'disabled' || !isKeyTool(state.tool)) {
        continue
      }
      if (state.bindings.some(binding => binding.kind === 'key' && keyBindingMatches(binding, event))) {
        return state.tool
      }
    }
    return null
  }

  private groupForViewport(viewportId: string): ToolGroup | null {
    const groupId = this.viewportToGroupId.get(viewportId)
    return groupId ? this.groups.get(groupId) ?? null : null
  }

  private requireGroup(groupId: string): ToolGroup {
    const group = this.groups.get(groupId)
    if (!group) {
      throw new Error(`Tool group not found: ${groupId}`)
    }
    return group
  }

  private requireToolState(groupId: string, toolId: string): ToolGroupToolState {
    const state = this.requireGroup(groupId).tools.get(toolId)
    if (!state) {
      throw new Error(`Tool ${toolId} not found in tool group ${groupId}.`)
    }
    return state
  }
}

function dragBindingMatches(binding: Extract<ToolBinding, { kind: 'drag' }>, event: ToolInputEvent): boolean {
  return (binding.button === undefined || binding.button === event.button) && modifiersMatch(binding.modifiers, event)
}

function keyBindingMatches(binding: Extract<ToolBinding, { kind: 'key' }>, event: ToolInputEvent): boolean {
  const keyMatches = binding.key === undefined || binding.key.toLowerCase() === event.key?.toLowerCase()
  const codeMatches = binding.code === undefined || binding.code === event.code
  return keyMatches && codeMatches && modifiersMatch(binding.modifiers, event)
}

function modifiersMatch(modifiers: Partial<ToolInputEvent['modifiers']> | undefined, event: ToolInputEvent): boolean {
  if (!modifiers) {
    return true
  }
  for (const key of Object.keys(modifiers) as (keyof ToolInputEvent['modifiers'])[]) {
    if (event.modifiers[key] !== modifiers[key]) {
      return false
    }
  }
  return true
}

function isDragTool(tool: Tool): tool is DragTool {
  return typeof (tool as DragTool).onDrag === 'function'
}

function isWheelTool(tool: Tool): tool is WheelTool {
  return typeof (tool as WheelTool).onWheel === 'function'
}

function isHoverTool(tool: Tool): tool is HoverTool {
  return typeof (tool as HoverTool).onMove === 'function'
}

function isKeyTool(tool: Tool): tool is KeyTool {
  return typeof (tool as KeyTool).onKeyDown === 'function' || typeof (tool as KeyTool).onKeyUp === 'function'
}
