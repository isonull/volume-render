import { mat4, vec3 } from 'wgpu-matrix'
import type { Mat4 } from 'wgpu-matrix'
import type { ScalarVolume, Vec3 } from './volume'

export interface SceneChangeSet<T = unknown> {
  readonly sceneId: string
  readonly versionBefore: number
  readonly versionAfter: number
  readonly result: T
  readonly changes: SceneChange[]
}

export type SceneChange =
  | { type: 'volume.added' | 'volume.removed'; volumeId: string }
  | { type: 'volume.changed'; volumeId: string; regions?: Box3i[] }

export type Box3i = {
  min: Vec3
  max: Vec3
}

export class Scene {
  readonly id: string
  version = 0
  readonly volumes = new Map<string, ScalarVolume>()
  private readonly inverseIndexToWorld = new Map<string, Mat4>()

  constructor(id: string) {
    this.id = id
  }

  transaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T> {
    const changes: SceneChange[] = []
    const tx = new SceneTransaction(this, changes)
    const versionBefore = this.version
    const result = fn(tx)

    if (changes.length > 0) {
      this.version += 1
    }

    return {
      sceneId: this.id,
      versionBefore,
      versionAfter: this.version,
      result,
      changes,
    }
  }

  volumeIndexToWorld(volumeId: string, index: Vec3): Vec3 {
    const volume = this.requireVolume(volumeId)
    return toVec3(vec3.transformMat4(index, volume.indexToWorld))
  }

  worldToVolumeIndex(volumeId: string, world: Vec3): Vec3 {
    this.requireVolume(volumeId)
    return toVec3(vec3.transformMat4(world, this.inverseIndexToWorld.get(volumeId)!))
  }

  requireVolume(volumeId: string): ScalarVolume {
    const volume = this.volumes.get(volumeId)
    if (!volume) {
      throw new Error(`Scene volume not found: ${volumeId}`)
    }
    return volume
  }

  addVolumeInternal(volume: ScalarVolume): void {
    if (this.volumes.has(volume.id)) {
      throw new Error(`Scene volume already exists: ${volume.id}`)
    }
    this.volumes.set(volume.id, volume)
    this.inverseIndexToWorld.set(volume.id, mat4.inverse(volume.indexToWorld))
  }

  removeVolumeInternal(volumeId: string): void {
    this.requireVolume(volumeId)
    this.volumes.delete(volumeId)
    this.inverseIndexToWorld.delete(volumeId)
  }
}

export class SceneTransaction {
  private readonly scene: Scene
  private readonly changes: SceneChange[]

  constructor(scene: Scene, changes: SceneChange[]) {
    this.scene = scene
    this.changes = changes
  }

  addVolume(volume: ScalarVolume): void {
    this.scene.addVolumeInternal(volume)
    this.changes.push({ type: 'volume.added', volumeId: volume.id })
  }

  updateVolume(volumeId: string, regions?: Box3i[]): void {
    this.scene.requireVolume(volumeId)
    this.changes.push({ type: 'volume.changed', volumeId, regions })
  }
}

function toVec3(value: ArrayLike<number>): Vec3 {
  return [value[0], value[1], value[2]]
}
