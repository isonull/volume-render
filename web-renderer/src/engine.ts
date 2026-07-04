import { Scene } from './scene'
import { Viewport } from './viewport'
import { MprRenderer, PreparedScene } from './mpr/mprRenderer'
import type { SceneChangeSet } from './scene'
import type { SceneTransaction } from './scene'
import type { ScalarVolume } from './volume'
import type { MprRenderState } from './mpr/mprState'

export class Engine {
  readonly renderer: MprRenderer
  scene: Scene | null = null
  preparedScene: PreparedScene | null = null
  readonly viewports = new Map<string, Viewport>()
  readonly renderStates = new Map<string, MprRenderState>()
  private readonly pendingViewportIds = new Set<string>()
  private frameRequested = false

  private constructor(renderer: MprRenderer) {
    this.renderer = renderer
  }

  static async create(): Promise<Engine> {
    return new Engine(await MprRenderer.create())
  }

  loadVolume(volume: ScalarVolume): SceneChangeSet {
    if (!this.scene) {
      this.scene = new Scene(`scene-${Date.now()}`)
    }
    const changeSet = this.scene.transaction(tx => {
      tx.addVolume(volume)
    })
    this.applySceneChangeSet(changeSet)
    return changeSet
  }

  createViewport(canvas: HTMLCanvasElement, id: string): Viewport {
    if (this.viewports.has(id)) {
      throw new Error(`Viewport already exists: ${id}`)
    }
    const viewport = new Viewport(id, canvas, this.renderer.device, this.renderer.format)
    this.viewports.set(id, viewport)
    return viewport
  }

  destroyViewport(viewportId: string): void {
    this.viewports.delete(viewportId)
    this.renderStates.delete(viewportId)
    this.pendingViewportIds.delete(viewportId)
  }

  setRenderState(viewportId: string, state: MprRenderState): void {
    if (!this.viewports.has(viewportId)) {
      throw new Error(`Viewport not found: ${viewportId}`)
    }
    this.renderStates.set(viewportId, state)
    this.requestRender(viewportId)
  }

  applySceneTransaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T> {
    if (!this.scene) {
      throw new Error('Cannot apply scene transaction before a scene is loaded.')
    }

    const changeSet = this.scene.transaction(fn)
    this.applySceneChangeSet(changeSet)
    return changeSet
  }

  applySceneChangeSet(changeSet: SceneChangeSet): void {
    if (!this.scene || changeSet.sceneId !== this.scene.id) {
      throw new Error(`Cannot apply change set for inactive scene ${changeSet.sceneId}.`)
    }

    if (!this.preparedScene) {
      this.preparedScene = new PreparedScene(this.scene.id, this.scene.version)
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

    for (const viewportId of this.viewports.keys()) {
      this.requestRender(viewportId)
    }
  }

  requestRender(viewportId: string): void {
    if (!this.viewports.has(viewportId)) {
      return
    }
    this.pendingViewportIds.add(viewportId)
    if (!this.frameRequested) {
      this.frameRequested = true
      requestAnimationFrame(() => this.flushRenders())
    }
  }

  render(viewportId: string): void {
    if (!this.scene) {
      return
    }
    const viewport = this.viewports.get(viewportId)
    const state = this.renderStates.get(viewportId)
    if (!viewport || !state) {
      return
    }
    this.preparedScene = this.renderer.prepareScene(this.scene, this.preparedScene ?? undefined)
    this.renderer.render(this.preparedScene, viewport, state)
  }

  destroyScene(): void {
    if (this.preparedScene) {
      this.renderer.releasePreparedScene(this.preparedScene)
      this.preparedScene = null
    }
    this.renderStates.clear()
    this.pendingViewportIds.clear()
    this.scene = null
    for (const viewport of this.viewports.values()) {
      viewport.clear()
    }
  }

  clearViewports(): void {
    this.renderStates.clear()
    this.pendingViewportIds.clear()
    for (const viewport of this.viewports.values()) {
      viewport.clear()
    }
  }

  destroy(): void {
    this.destroyScene()
    this.viewports.clear()
    this.renderer.destroy()
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
