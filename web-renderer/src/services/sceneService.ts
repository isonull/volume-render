import { Scene } from '../scene'
import type { SceneChangeSet, SceneTransaction } from '../scene'
import type { ScalarVolume } from '../volume'

export class SceneService {
  scene: Scene | null = null

  loadVolume(volume: ScalarVolume): SceneChangeSet {
    if (!this.scene) {
      this.scene = new Scene(`scene-${Date.now()}`)
    }
    return this.scene.transaction(tx => {
      tx.addVolume(volume)
    })
  }

  applyTransaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T> {
    if (!this.scene) {
      throw new Error('Cannot apply scene transaction before a scene is loaded.')
    }
    return this.scene.transaction(fn)
  }

  destroyScene(): void {
    this.scene = null
  }
}

