# Section 6. User Input and Interaction

This chapter describes how external user input becomes scene changes, render
state changes, synchronized viewport updates, and render scheduling.

The interaction system should follow this direction:

```text
DOM input
  -> InputRouter
  -> ToolController
  -> Tool
  -> CommandDispatcher
  -> SceneTransaction or RenderStateStore patch
  -> RenderStateLink propagation
  -> RenderScheduler
```

The important rule is that input handling should not bypass the engine. Tools
interpret input. Commands express intent. The engine commits state changes.

## Section 6.1 InputRouter

`InputRouter` normalizes browser events into viewport-local interaction events.

```ts
class InputRouter {
  handlePointerDown(evt: PointerEvent): void
  handlePointerMove(evt: PointerEvent): void
  handlePointerUp(evt: PointerEvent): void
  handleWheel(evt: WheelEvent): void
  handleKeyDown(evt: KeyboardEvent): void
  handleKeyUp(evt: KeyboardEvent): void
}

interface InteractionEvent {
  viewportId: string
  canvasPoint?: Vec2
  clientPoint?: Vec2
  buttons?: number
  key?: string
  modifiers: KeyModifiers
  originalEvent: Event
}
```

`InputRouter` should not know medical tools, scene mutation rules, or renderer
internals.

## Section 6.2 Tools

Tools interpret interaction events and produce commands. They should not
directly own render pipelines or GPU resources.

```ts
interface Tool<TConfig = unknown> {
  readonly name: string
  readonly configuration: TConfig
  onInteraction(evt: InteractionEvent, context: ToolContext): ToolCommand | ToolCommand[] | void
}

interface ToolContext {
  sceneId: string
  viewportId: string
  renderState: RenderState
  picking: PickingService
}
```

Examples:

```text
PanTool
ZoomTool
WindowLevelTool
CrosshairsTool
BrushTool
RegionSegmentTool
```

## Section 6.3 ToolController

`ToolController` selects which tool receives an interaction event.

```ts
type ToolMode = 'Active' | 'Passive' | 'Enabled' | 'Disabled'

interface ToolBinding {
  toolName: string
  bindings: { mouseButton?: MouseButton; key?: string; modifier?: KeyModifier }[]
}

class ToolController {
  readonly toolGroupId: string
  readonly viewportIds: string[]

  setToolMode(toolName: string, mode: ToolMode): void
  setPrimaryActiveTool(toolName: string): void
  setToolBindings(toolName: string, bindings: ToolBinding[]): void
  dispatch(evt: InteractionEvent): boolean
}
```

Dispatch order:

```text
1. primary active tool
2. other active tools
3. passive tools
4. enabled tools
```

`ToolRegistry` may still exist as a registry of tool classes, but it is not the
state owner. `ToolController` owns active tool state for a viewport group.

## Section 6.4 Commands

Tools should return semantic commands instead of mutating every subsystem
directly.

```ts
type ToolCommand =
  | { type: 'renderState.patch'; viewportId: string; patch: RenderStatePatch }
  | { type: 'scene.transaction'; sceneId: string; apply(tx: SceneTransaction): void }
  | { type: 'labelmap.paint'; sceneId: string; input: PaintInput }

class CommandDispatcher {
  dispatch(command: ToolCommand): void
}
```

Command handlers commit changes through the engine:

```text
scene.transaction(...)
engine.applySceneChangeSet(changeSet)

engine.updateRenderState(viewportId, patch)
```

This keeps undo/redo, testing, synchronization, and render scheduling in one
predictable path.

## Section 6.5 RenderState Synchronization

Synchronization should propagate committed render-state patches, not raw DOM
events.

```ts
class RenderStateLink {
  readonly id: string
  readonly sourceViewportId: string
  readonly targetViewportIds: string[]
  readonly selector: RenderStateSelector

  transform(input: {
    patch: RenderStatePatch
    source: RenderState
    target: RenderState
  }): RenderStatePatch | null
}

interface RenderStateSelector {
  camera?: Partial<CameraSyncFields>
  transfer?: Partial<TransferSyncFields>
  labelmap?: Partial<LabelmapSyncFields>
}
```

Common synchronizable fields:

```text
slice position
camera orientation
zoom and pan
window/level
colormap
slab thickness
labelmap visibility
segment visibility
```

Flow:

```text
source RenderState patch committed
  -> RenderStateLink computes target patches
  -> engine.updateRenderState(targetViewportId, targetPatch)
  -> RenderScheduler requests target viewport renders
```

This replaces event-driven synchronizers as the primary synchronization model.
