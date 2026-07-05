import { mat4, vec3 } from 'wgpu-matrix'
import type { Vec2n, Vec3, Vec3n } from 'wgpu-matrix'
import type { MprRenderState } from './mprState'
import type { ScalarVolume } from '../volume'

export function canvasToWorld(point: Vec2n, width: number, height: number, state: MprRenderState): Vec3 {
  const dx = point[0] - 0.5 * width
  const dy = point[1] - 0.5 * height
  return vec3.add(
    vec3.addScaled(state.plane.origin, state.plane.right, dx * state.plane.pixelSize),
    vec3.scale(state.plane.up, -dy * state.plane.pixelSize),
  )
}

export function worldToIndex(world: Vec3, volume: ScalarVolume): Vec3 {
  const worldToIndexMatrix = mat4.inverse(volume.indexToWorld)
  return vec3.create(
    worldToIndexMatrix[0] * world[0] + worldToIndexMatrix[4] * world[1] + worldToIndexMatrix[8] * world[2] + worldToIndexMatrix[12],
    worldToIndexMatrix[1] * world[0] + worldToIndexMatrix[5] * world[1] + worldToIndexMatrix[9] * world[2] + worldToIndexMatrix[13],
    worldToIndexMatrix[2] * world[0] + worldToIndexMatrix[6] * world[1] + worldToIndexMatrix[10] * world[2] + worldToIndexMatrix[14],
  )
}

export function sliceStepSize(worldNormal: Vec3, volume: ScalarVolume): number {
  const worldToIndexMatrix = mat4.inverse(volume.indexToWorld)
  const indexDirection = vec3.create(
    worldToIndexMatrix[0] * worldNormal[0] + worldToIndexMatrix[4] * worldNormal[1] + worldToIndexMatrix[8] * worldNormal[2],
    worldToIndexMatrix[1] * worldNormal[0] + worldToIndexMatrix[5] * worldNormal[1] + worldToIndexMatrix[9] * worldNormal[2],
    worldToIndexMatrix[2] * worldNormal[0] + worldToIndexMatrix[6] * worldNormal[1] + worldToIndexMatrix[10] * worldNormal[2],
  )
  const indexUnitsPerWorldUnit = vec3.length(indexDirection)
  return indexUnitsPerWorldUnit > 0 ? 1 / indexUnitsPerWorldUnit : 1
}

export function isVoxelInBounds(voxel: Vec3n, volume: ScalarVolume): boolean {
  return voxel.every((value, axis) => value >= 0 && value < volume.shape[axis])
}

