# Section 5. Core Services

The framework groups infrastructure into services owned by
`MedicalRenderingEngine`. This file covers the core services that manage
lifecycle, scenes, viewports, prepared scenes, render scheduling, cache, and
picking. User input, tools, and synchronization live in a
dedicated interaction file:

- [Section 6 User Input and Interaction](06-interaction.md)

## Section 5.1 MedicalRenderingEngine

`MedicalRenderingEngine` is the top-level explicit lifecycle owner.

```ts
class MedicalRenderingEngine {
  readonly scenes: SceneManager
  readonly viewports: ViewportManager
  readonly renderers: RendererRegistry
  readonly renderStates: RenderStateStore
  readonly preparedScenes: PreparedSceneCache
  readonly sceneViewportIndex: SceneViewportIndex
  readonly renderScheduler: RenderScheduler
  createScene(options: CreateSceneOptions): Scene
  destroyScene(sceneId: string): void

  createViewport(canvas: HTMLCanvasElement, options?: ViewportOptions): Viewport
  destroyViewport(viewportId: string): void

  applySceneChangeSet(changeSet: SceneChangeSet): void
  updateRenderState(viewportId: string, patch: Partial<RenderState>): void
  render(sceneId: string, viewportId: string): void

  releaseSceneResources(sceneId: string): void
  releaseRendererResources(rendererId: string): void
  destroy(): void
}
```

The engine coordinates managers. It should not contain shader-specific drawing
logic. Scene changes and render-state changes should enter through the engine
so cache invalidation and render scheduling stay centralized.

## Section 5.2 SceneManager

Creates and owns authoritative scenes.

```ts
class SceneManager {
  createScene(options: CreateSceneOptions): Scene
  getScene(sceneId: string): Scene | undefined
  destroyScene(sceneId: string): void
  applyChangeSet(changeSet: SceneChangeSet): void
}
```

Destroying a scene must notify `PreparedSceneCache` so renderer-specific caches
can be released.

## Section 5.3 ViewportManager

Creates and owns viewports.

```ts
class ViewportManager {
  createViewport(canvas: HTMLCanvasElement, options?: ViewportOptions): Viewport
  getViewport(viewportId: string): Viewport | undefined
  destroyViewport(viewportId: string): void
}
```

## Section 5.4 PreparedSceneCache

Owns renderer-specific prepared scene caches and consumes typed scene changes.
This is the explicit replacement for a hidden `WeakMap<Scene, PreparedScene>`.

```ts
class PreparedSceneCache {
  get(rendererId: string, sceneId: string): PreparedScene | undefined
  prepare(renderer: Renderer, scene: Scene): PreparedScene
  invalidate(changeSet: SceneChangeSet): void
  release(rendererId: string, sceneId: string): void
  releaseScene(sceneId: string): void
  releaseRenderer(rendererId: string): void
  clear(): void
}
```

Rules:

- `Scene` is authoritative.
- `PreparedScene` is renderer-specific cache.
- Tools and editors mutate `Scene` or data managers, not `PreparedScene`.
- `PreparedSceneCache` maps `SceneChange` entries to prepared invalidations.
- `PreparedSceneCache` incrementally updates dirty prepared scenes during render or explicit prepare.
- Renderers create and update `PreparedResource` objects during `prepareScene`.
- `PreparedSceneCache` owns prepared-resource lifetime through `releaseScene`,
  `releaseRenderer`, and `clear`.

## Section 5.5 RenderStateStore

Stores renderer-specific state per viewport. Render-state changes usually do
not invalidate `Scene` or `PreparedScene`; they request a render and may update
uniforms.

```ts
class RenderStateStore {
  get(viewportId: string): RenderState | undefined
  set(viewportId: string, state: RenderState): void
  patch(viewportId: string, patch: Partial<RenderState>): RenderState
  remove(viewportId: string): void
}
```

Rules:

- MPR pan/slice/orientation lives in `MprRenderState`.
- Window/level, colormap, LUT, and segment visibility live in `RenderState`.
- Renderers may define incompatible render-state shapes.

## Section 5.6 SceneViewportIndex

Tracks which viewports are affected by a scene, scalar volume, or labelmap
change.

```ts
class SceneViewportIndex {
  bind(viewportId: string, sceneId: string): void
  unbind(viewportId: string): void
  getViewportsForScene(sceneId: string): string[]
  getViewportsForVolume(volumeId: string): string[]
  getViewportsForLabelmap(labelmapId: string): string[]
}
```

The first implementation can conservatively return all viewports for the scene.
Later implementations can use render-state visibility to narrow the affected
set.

## Section 5.7 RenderScheduler

Coalesces render requests onto animation frames.

```ts
class RenderScheduler {
  requestRender(viewportIds: string[]): void
  requestOverlayRender(viewportIds: string[]): void
  flush(): void
}
```

Rules:

- Multiple requests before the next animation frame are merged.
- Scene edits schedule affected viewports through `SceneViewportIndex`.
- Render-state edits usually schedule only the edited viewport.
- Labelmap edits may schedule only viewports that display the edited labelmap.

## Section 5.8 CacheManager

Caches source data and optional prepared renderer resources.

```text
DataObject cache
PreparedResource cache
histogram/cache statistics
```

`CacheManager` is optional. It should not become the semantic owner of
`PreparedScene`; prepared-scene lifetime remains explicit in
`PreparedSceneCache`.

## Section 5.9 PickingService

Performs hit testing.

```ts
class PickingService {
  pick(scene: Scene, viewport: Viewport, state: RenderState, point: Vec2): PickResult
}
```

Possible result:

```text
world point
volume index point
labelmap index point
hit label
```

Picking may use `Scene.volumeIndexToWorld`, `Scene.worldToVolumeIndex`,
`Scene.labelmapIndexToWorld`, `Scene.worldToLabelmapIndex`, renderer coordinate
helpers, and `Viewport.clientToCanvas` / `canvasToClient` directly, or through a
thin coordinate facade. It should not duplicate coordinate math.
