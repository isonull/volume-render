import { mat4, vec3 } from 'wgpu-matrix'
import type { Mat4, Vec3, Vec3n } from 'wgpu-matrix'
import type { LabelmapSegmentationData } from './segmentation'
import type { ScalarVolume } from './volume'

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
  | { type: 'segmentation.added' | 'segmentation.removed'; segmentationId: string }
  | { type: 'segmentation.changed'; segmentationId: string; regions?: Box3i[] }

export type Box3i = {
  min: Vec3n
  max: Vec3n
}

export class Scene {
  readonly id: string
  version = 0
  private readonly volumeMap = new Map<string, ScalarVolume>()
  private readonly segmentationMap = new Map<string, LabelmapSegmentationData>()
  private readonly inverseIndexToWorld = new Map<string, Mat4>()
  private readonly inverseSegmentationIndexToWorld = new Map<string, Mat4>()

  constructor(id: string) {
    this.id = id
  }

  get volumes(): ReadonlyMap<string, ScalarVolume> {
    return this.volumeMap
  }

  get segmentations(): ReadonlyMap<string, LabelmapSegmentationData> {
    return this.segmentationMap
  }

  transaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T> {
    const changes: SceneChange[] = []
    const tx = new SceneTransaction({
      addVolume: volume => this.addVolumeInternal(volume),
      removeVolume: volumeId => this.removeVolumeInternal(volumeId),
      updateVolume: volumeId => this.requireVolume(volumeId),
      addSegmentation: segmentation => this.addSegmentationInternal(segmentation),
      updateSegmentation: segmentationId => this.requireSegmentation(segmentationId),
      removeSegmentation: segmentationId => this.removeSegmentationInternal(segmentationId),
    }, changes)
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
    return vec3.transformMat4(index, volume.indexToWorld)
  }

  worldToVolumeIndex(volumeId: string, world: Vec3): Vec3 {
    this.requireVolume(volumeId)
    return vec3.transformMat4(world, this.inverseIndexToWorld.get(volumeId)!)
  }

  segmentationIndexToWorld(segmentationId: string, index: Vec3): Vec3 {
    const segmentation = this.requireSegmentation(segmentationId)
    return vec3.transformMat4(index, segmentation.indexToWorld)
  }

  worldToSegmentationIndex(segmentationId: string, world: Vec3): Vec3 {
    this.requireSegmentation(segmentationId)
    return vec3.transformMat4(world, this.inverseSegmentationIndexToWorld.get(segmentationId)!)
  }

  requireVolume(volumeId: string): ScalarVolume {
    const volume = this.volumeMap.get(volumeId)
    if (!volume) {
      throw new Error(`Scene volume not found: ${volumeId}`)
    }
    return volume
  }

  requireSegmentation(segmentationId: string): LabelmapSegmentationData {
    const segmentation = this.segmentationMap.get(segmentationId)
    if (!segmentation) {
      throw new Error(`Scene segmentation not found: ${segmentationId}`)
    }
    return segmentation
  }

  private addVolumeInternal(volume: ScalarVolume): void {
    if (this.volumeMap.has(volume.id)) {
      throw new Error(`Scene volume already exists: ${volume.id}`)
    }
    this.volumeMap.set(volume.id, volume)
    this.inverseIndexToWorld.set(volume.id, mat4.inverse(volume.indexToWorld))
  }

  private removeVolumeInternal(volumeId: string): void {
    this.requireVolume(volumeId)
    for (const segmentation of this.segmentationMap.values()) {
      if (segmentation.sourceVolumeId === volumeId) {
        throw new Error(`Cannot remove volume ${volumeId} while segmentation ${segmentation.id} references it.`)
      }
    }
    this.volumeMap.delete(volumeId)
    this.inverseIndexToWorld.delete(volumeId)
  }

  private addSegmentationInternal(segmentation: LabelmapSegmentationData): void {
    if (this.segmentationMap.has(segmentation.id)) {
      throw new Error(`Scene segmentation already exists: ${segmentation.id}`)
    }

    const sourceVolume = this.requireVolume(segmentation.sourceVolumeId)
    if (!sameShape(segmentation.shape, sourceVolume.shape)) {
      throw new Error(
        `Segmentation ${segmentation.id} shape ${segmentation.shape.join(' x ')} does not match source volume ${sourceVolume.id} shape ${sourceVolume.shape.join(' x ')}.`,
      )
    }
    if (!sameMat4(segmentation.indexToWorld, sourceVolume.indexToWorld)) {
      throw new Error(`Segmentation ${segmentation.id} indexToWorld does not exactly match source volume ${sourceVolume.id}.`)
    }

    this.segmentationMap.set(segmentation.id, segmentation)
    this.inverseSegmentationIndexToWorld.set(segmentation.id, mat4.inverse(segmentation.indexToWorld))
  }

  private removeSegmentationInternal(segmentationId: string): void {
    this.requireSegmentation(segmentationId)
    this.segmentationMap.delete(segmentationId)
    this.inverseSegmentationIndexToWorld.delete(segmentationId)
  }
}

type SceneTransactionOps = {
  addVolume(volume: ScalarVolume): void
  removeVolume(volumeId: string): void
  updateVolume(volumeId: string): void
  addSegmentation(segmentation: LabelmapSegmentationData): void
  updateSegmentation(segmentationId: string): void
  removeSegmentation(segmentationId: string): void
}

export class SceneTransaction {
  private readonly ops: SceneTransactionOps
  private readonly changes: SceneChange[]

  constructor(ops: SceneTransactionOps, changes: SceneChange[]) {
    this.ops = ops
    this.changes = changes
  }

  addVolume(volume: ScalarVolume): void {
    this.ops.addVolume(volume)
    this.changes.push({ type: 'volume.added', volumeId: volume.id })
  }

  removeVolume(volumeId: string): void {
    this.ops.removeVolume(volumeId)
    this.changes.push({ type: 'volume.removed', volumeId })
  }

  updateVolume(volumeId: string, regions?: Box3i[]): void {
    this.ops.updateVolume(volumeId)
    this.changes.push({ type: 'volume.changed', volumeId, regions })
  }

  addSegmentation(segmentation: LabelmapSegmentationData): void {
    this.ops.addSegmentation(segmentation)
    this.changes.push({ type: 'segmentation.added', segmentationId: segmentation.id })
  }

  updateSegmentation(segmentationId: string, regions?: Box3i[]): void {
    this.ops.updateSegmentation(segmentationId)
    this.changes.push({ type: 'segmentation.changed', segmentationId, regions })
  }

  removeSegmentation(segmentationId: string): void {
    this.ops.removeSegmentation(segmentationId)
    this.changes.push({ type: 'segmentation.removed', segmentationId })
  }
}

function sameShape(a: Vec3n, b: Vec3n): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

function sameMat4(a: Mat4, b: Mat4): boolean {
  return a.every((value, index) => value === b[index])
}
