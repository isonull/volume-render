# Section 5. Engine And Core Services

## Section 5.1 Engine

For the MVP, use one explicit `Engine` instead of a collection of managers.

```ts
class Engine {
  readonly scene: Scene
  readonly renderer: MprRenderer
  readonly preparedScene: PreparedScene

  readonly viewports: Map<string, Viewport>
  readonly renderStates: Map<string, MprRenderState>

  createViewport(canvas: HTMLCanvasElement, options?: ViewportOptions): Viewport
  destroyViewport(viewportId: string): void

  setRenderState(viewportId: string, state: MprRenderState): void

  applySceneChangeSet(changeSet: SceneChangeSet): void
  requestRender(viewportId: string): void
  render(viewportId: string): void

  destroyScene(): void
  destroy(): void
}
```

The engine owns lifecycle and coordination:

```text
Scene
Viewport objects
complete MprRenderState per viewport
PreparedScene GPU cache
MprRenderer
pending render requests
```

It should not contain shader-specific drawing logic; that belongs to
`MprRenderer`.

## Section 5.2 Applying Scene Changes

`Engine.applySceneChangeSet` maps scene changes to prepared-scene
invalidations:

```text
volume.added / volume.removed
  -> preparedSceneStructureDirty

volume.changed
  -> volumeTextureDirty
```

After invalidation, the engine requests renders for affected viewports. For the
MVP it is acceptable to conservatively rerender all three MPR viewports for
scene changes.

## Section 5.3 Render Scheduling

The MVP can implement scheduling directly inside `Engine`.

```ts
class Engine {
  private pendingViewportIds: Set<string>
  private frameRequested: boolean

  requestRender(viewportId: string): void
  private flushRenders(): void
}
```

Rules:

- Multiple render requests before the next animation frame are merged.
- Scene edits may rerender all viewports.
- Render-state replacement rerenders only the edited viewport.

## Section 5.4 Picking

Picking converts a viewport point into scene coordinates. It can be a small
helper before becoming a standalone service.

```ts
function pickMpr(
  scene: Scene,
  viewport: Viewport,
  state: MprRenderState,
  canvasPoint: Vec2,
): PickResult
```

Possible result:

```text
world point
volume index point
```

Picking may use `Scene.volumeIndexToWorld`, `Scene.worldToVolumeIndex`,
renderer coordinate helpers, and `Viewport.clientToCanvas` / `canvasToClient`
directly. It should not duplicate coordinate math.

## Section 5.5 Lifecycle

The MVP engine owns the GPU resources derived from the active NIfTI-backed
scene. Resource lifetime is:

```text
load NIfTI
  -> create Scene
  -> create Viewports and MprRenderStates
  -> first render creates PreparedScene resources
destroy Scene
  -> release PreparedScene resources
  -> clear viewport render states that referenced that Scene
```

If WebGPU initialization or preparation fails because required capabilities are
missing, the engine should surface an explicit fatal error for the MVP.

## Section 5.6 Future Service Extraction

These services are useful later but should not block the MVP:

```text
SceneManager
ViewportManager
RendererRegistry
PreparedSceneCache
RenderStateStore
SceneViewportIndex
RenderScheduler
CacheManager
PickingService
```

Extract them only after the single-engine implementation becomes too large or
the project needs multiple scenes, multiple renderer types, or shared GPU
resource caches.
