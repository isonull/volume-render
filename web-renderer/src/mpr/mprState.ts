import { vec3 } from 'wgpu-matrix'
import type { Vec3 } from 'wgpu-matrix'
import type { ScalarVolume } from '../volume'

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
  overlay?: {
    segmentationId: string
    visible: boolean
  }
}

export type MprOrientation = 'axial' | 'coronal' | 'sagittal'

export function createInitialMprState(
  volume: ScalarVolume,
  orientation: MprOrientation,
  canvasPixels: number,
): MprRenderState {
  const [windowMin, windowMax] = valueRange(volume)
  const centerIndex = vec3.create(
    (volume.shape[0] - 1) * 0.5,
    (volume.shape[1] - 1) * 0.5,
    (volume.shape[2] - 1) * 0.5,
  )
  const origin = vec3.transformMat4(centerIndex, volume.indexToWorld)
  const axisI = axisFromIndexToWorld(volume, 0)
  const axisJ = axisFromIndexToWorld(volume, 1)
  const axisK = axisFromIndexToWorld(volume, 2)

  const [right, up] =
    orientation === 'axial' ? [vec3.normalize(axisI), vec3.normalize(axisJ)] :
      orientation === 'coronal' ? [vec3.normalize(axisI), vec3.negate(vec3.normalize(axisK))] :
        [vec3.normalize(axisJ), vec3.normalize(axisK)]

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
      origin: vec3.clone(state.plane.origin),
      right: vec3.clone(state.plane.right),
      up: vec3.clone(state.plane.up),
      pixelSize: state.plane.pixelSize,
    },
    image: {
      ...state.image,
      slab: state.image.slab ? { ...state.image.slab } : undefined,
    },
    overlay: state.overlay ? { ...state.overlay } : undefined,
  }
}

function initialPixelSize(volume: ScalarVolume, canvasPixels: number): number {
  const sx = vec3.length(axisFromIndexToWorld(volume, 0)) * volume.shape[0]
  const sy = vec3.length(axisFromIndexToWorld(volume, 1)) * volume.shape[1]
  const sz = vec3.length(axisFromIndexToWorld(volume, 2)) * volume.shape[2]
  return Math.max(sx, sy, sz) / Math.max(1, canvasPixels)
}

function axisFromIndexToWorld(volume: ScalarVolume, axis: 0 | 1 | 2): Vec3 {
  const offset = axis * 4
  return vec3.create(
    volume.indexToWorld[offset],
    volume.indexToWorld[offset + 1],
    volume.indexToWorld[offset + 2],
  )
}
