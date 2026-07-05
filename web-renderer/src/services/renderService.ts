import { PreparedScene } from '../mpr/mprRenderer'
import type { MprRenderer } from '../mpr/mprRenderer'
import type { SceneChangeSet } from '../scene'
import type { SceneService } from './sceneService'
import type { ViewportService } from './viewportService'

export class RenderService {
  readonly renderer: MprRenderer
  preparedScene: PreparedScene | null = null
  private readonly pendingViewportIds = new Set<string>()
  private frameRequested = false
  private readonly sceneService: SceneService
  private readonly viewportService: ViewportService

  constructor(renderer: MprRenderer, sceneService: SceneService, viewportService: ViewportService) {
    this.renderer = renderer
    this.sceneService = sceneService
    this.viewportService = viewportService
  }

  destroyViewport(viewportId: string): void {
    this.pendingViewportIds.delete(viewportId)
  }

  applySceneChangeSet(changeSet: SceneChangeSet): void {
    const scene = this.sceneService.scene
    if (!scene || changeSet.sceneId !== scene.id) {
      throw new Error(`Cannot apply change set for inactive scene ${changeSet.sceneId}.`)
    }

    if (!this.preparedScene) {
      this.preparedScene = new PreparedScene(scene.id, scene.version)
    }

    for (const change of changeSet.changes) {
      if (change.type === 'volume.added' || change.type === 'volume.removed') {
        this.preparedScene.pendingInvalidations.push({ type: 'preparedSceneStructureDirty' })
      } else if (change.type === 'volume.changed') {
        this.preparedScene.pendingInvalidations.push({
          type: 'volumeTextureDirty',
          volumeId: change.volumeId,
          regions: change.regions,
        })
      } else if (change.type === 'segmentation.added' || change.type === 'segmentation.removed') {
        this.preparedScene.pendingInvalidations.push({ type: 'preparedSceneStructureDirty' })
      } else if (change.type === 'segmentation.changed') {
        this.preparedScene.pendingInvalidations.push({
          type: 'segmentationTextureDirty',
          segmentationId: change.segmentationId,
          regions: change.regions,
        })
      }
    }

    this.requestAllViewports()
  }

  requestRender(viewportId: string): void {
    if (!this.viewportService.hasViewport(viewportId)) {
      return
    }
    this.pendingViewportIds.add(viewportId)
    if (!this.frameRequested) {
      this.frameRequested = true
      requestAnimationFrame(() => this.flushRenders())
    }
  }

  requestAllViewports(): void {
    for (const viewportId of this.viewportService.viewports.keys()) {
      this.requestRender(viewportId)
    }
  }

  render(viewportId: string): void {
    const scene = this.sceneService.scene
    if (!scene) {
      return
    }
    const viewport = this.viewportService.getViewport(viewportId)
    const state = this.viewportService.getRenderState(viewportId)
    if (!viewport || !state) {
      return
    }
    this.preparedScene = this.renderer.prepareScene(scene, this.preparedScene ?? undefined)
    this.renderer.render(this.preparedScene, viewport, state)
  }

  releasePreparedScene(): void {
    if (this.preparedScene) {
      this.renderer.releasePreparedScene(this.preparedScene)
      this.preparedScene = null
    }
  }

  clearPendingRenders(): void {
    this.pendingViewportIds.clear()
  }

  destroy(): void {
    this.releasePreparedScene()
    this.clearPendingRenders()
  }

  private flushRenders(): void {
    this.frameRequested = false
    const viewportIds = [...this.pendingViewportIds]
    this.pendingViewportIds.clear()
    for (const viewportId of viewportIds) {
      this.render(viewportId)
    }
  }
}
