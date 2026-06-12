export type Vec3 = [number, number, number]

export interface Bounds3 {
  pMin: Vec3
  pMax: Vec3
}

export interface NiftiVolume {
  dims: Vec3
  spacing: Vec3
  data: Float32Array
  intensityMin: number
  intensityMax: number
}

export interface DensityVolume {
  dims: Vec3
  spacing: Vec3
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
