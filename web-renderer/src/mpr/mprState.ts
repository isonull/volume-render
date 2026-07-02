import { vec3 } from 'wgpu-matrix'
import type { ScalarVolume, Vec3 } from '../volume'

export interface MprRenderState {
  rendererKind: 'mpr'
  plane: {
    origin: Vec3
    right: Vec3
    up: Vec3
    pixelSize: number
  }
  image: {
    volumeId: string
    windowMin: number
    windowMax: number
    interpolation: 'nearest' | 'linear'
    slab?: {
      thickness: number
      mode: 'mean' | 'max' | 'min'
    }
  }
}

export type MprOrientation = 'axial' | 'coronal' | 'sagittal'

export function createInitialMprState(
  volume: ScalarVolume,
  orientation: MprOrientation,
  canvasPixels: number,
): MprRenderState {
  const [windowMin, windowMax] = valueRange(volume)
  const centerIndex: Vec3 = [
    (volume.shape[0] - 1) * 0.5,
    (volume.shape[1] - 1) * 0.5,
    (volume.shape[2] - 1) * 0.5,
  ]
  const origin = toVec3(vec3.transformMat4(centerIndex, volume.indexToWorld))
  const axisI = axisFromIndexToWorld(volume, 0)
  const axisJ = axisFromIndexToWorld(volume, 1)
  const axisK = axisFromIndexToWorld(volume, 2)

  const [right, up] =
    orientation === 'axial' ? [normalize(axisI), normalize(axisJ)] :
      orientation === 'coronal' ? [normalize(axisI), negate(normalize(axisK))] :
        [normalize(axisJ), normalize(axisK)]

  return {
    rendererKind: 'mpr',
    plane: {
      origin,
      right,
      up,
      pixelSize: initialPixelSize(volume, canvasPixels),
    },
    image: {
      volumeId: volume.id,
      windowMin,
      windowMax,
      interpolation: 'linear',
    },
  }
}

export function valueRange(volume: ScalarVolume): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < volume.data.length; i += 1) {
    const value = volume.data[i]
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return [min, max]
}

export function cloneMprState(state: MprRenderState): MprRenderState {
  return {
    rendererKind: 'mpr',
    plane: {
      origin: [...state.plane.origin],
      right: [...state.plane.right],
      up: [...state.plane.up],
      pixelSize: state.plane.pixelSize,
    },
    image: {
      ...state.image,
      slab: state.image.slab ? { ...state.image.slab } : undefined,
    },
  }
}

function initialPixelSize(volume: ScalarVolume, canvasPixels: number): number {
  const sx = length(axisFromIndexToWorld(volume, 0)) * volume.shape[0]
  const sy = length(axisFromIndexToWorld(volume, 1)) * volume.shape[1]
  const sz = length(axisFromIndexToWorld(volume, 2)) * volume.shape[2]
  return Math.max(sx, sy, sz) / Math.max(1, canvasPixels)
}

function axisFromIndexToWorld(volume: ScalarVolume, axis: 0 | 1 | 2): Vec3 {
  const offset = axis * 4
  return [
    volume.indexToWorld[offset],
    volume.indexToWorld[offset + 1],
    volume.indexToWorld[offset + 2],
  ]
}

function normalize(v: Vec3): Vec3 {
  const len = length(v)
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0]
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]]
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function toVec3(value: ArrayLike<number>): Vec3 {
  return [value[0], value[1], value[2]]
}
