import { vec3 } from 'wgpu-matrix'
import type { Vec3, Vec3n } from 'wgpu-matrix'

export interface Bounds3 {
  pMin: Vec3
  pMax: Vec3
}

export interface DensityVolume {
  dims: Vec3n
  density: Float32Array
}

export interface GridMediumParams {
  bounds: Bounds3
  sigmaA: Vec3
  sigmaS: Vec3
  scale: number
  g: number
}

export interface MajorantGrid {
  bounds: Bounds3
  res: Vec3n
  voxels: Float32Array
  globalMaxDensity: number
}

export const DEFAULT_VOLUME_BOUNDS: Bounds3 = {
  pMin: vec3.create(-0.5, -0.5, -0.5),
  pMax: vec3.create(0.5, 0.5, 0.5),
}
