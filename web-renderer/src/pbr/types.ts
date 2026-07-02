import type { Vec3 } from '../volume'

export interface Bounds3 {
  pMin: Vec3
  pMax: Vec3
}

export interface DensityVolume {
  dims: Vec3
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
  res: Vec3
  voxels: Float32Array
  globalMaxDensity: number
}

export const DEFAULT_VOLUME_BOUNDS: Bounds3 = {
  pMin: [-0.5, -0.5, -0.5],
  pMax: [0.5, 0.5, 0.5],
}
