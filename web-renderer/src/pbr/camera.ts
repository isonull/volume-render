import { mat4, vec3, type Mat4 } from 'wgpu-matrix'
import type { Vec3 } from '../volume'

export type Vec2 = [number, number]

export interface Ray {
  origin: Vec3
  direction: Vec3
}

export interface RayDifferential extends Ray {
  rxOrigin: Vec3
  ryOrigin: Vec3
  rxDirection: Vec3
  ryDirection: Vec3
  hasDifferentials: boolean
}

export interface CameraSample {
  pFilm: Vec2
  time?: number
}

export interface ScreenWindow {
  pMin: Vec2
  pMax: Vec2
}

export interface PerspectiveCameraOptions {
  resolution: Vec2
  position: Vec3
  target: Vec3
  up?: Vec3
  fovYDegrees?: number
  near?: number
  far?: number
  screenWindow?: ScreenWindow
  shutterOpen?: number
  shutterClose?: number
}

export type OrthographicCameraOptions = Omit<PerspectiveCameraOptions, 'fovYDegrees'>

export interface CameraUniformData {
  invViewProj: Mat4
  positionAndFrame: [number, number, number, number]
  viewportAndTime: [number, number, number, number]
}

const DEFAULT_UP: Vec3 = [0, 1, 0]

export class CameraTransform {
  readonly worldFromCamera: Mat4
  readonly cameraFromWorld: Mat4

  private constructor(worldFromCamera: Mat4) {
    this.worldFromCamera = worldFromCamera
    this.cameraFromWorld = mat4.inverse(worldFromCamera)
  }

  static lookAt(position: Vec3, target: Vec3, up: Vec3 = DEFAULT_UP): CameraTransform {
    return new CameraTransform(mat4.cameraAim(position, target, up))
  }

  renderFromCameraPoint(point: Vec3): Vec3 {
    return toVec3(vec3.transformMat4(point, this.worldFromCamera))
  }

  renderFromCameraVector(vector: Vec3): Vec3 {
    return toVec3(vec3.transformMat4Upper3x3(vector, this.worldFromCamera))
  }
}

export class PerspectiveCamera {
  readonly transform: CameraTransform
  readonly resolution: Vec2
  readonly position: Vec3
  readonly target: Vec3
  readonly up: Vec3
  readonly fovYDegrees: number
  readonly near: number
  readonly far: number
  readonly screenWindow: ScreenWindow
  readonly shutterOpen: number
  readonly shutterClose: number
  readonly view: Mat4
  readonly projection: Mat4
  readonly viewProjection: Mat4
  readonly invViewProjection: Mat4
  readonly cameraFromRaster: Mat4

  constructor(options: PerspectiveCameraOptions) {
    this.resolution = options.resolution
    this.position = options.position
    this.target = options.target
    this.up = options.up ?? DEFAULT_UP
    this.fovYDegrees = options.fovYDegrees ?? 45
    this.near = options.near ?? 0.01
    this.far = options.far ?? 20
    this.screenWindow = options.screenWindow ?? defaultScreenWindow(options.resolution)
    this.shutterOpen = options.shutterOpen ?? 0
    this.shutterClose = options.shutterClose ?? 1

    this.transform = CameraTransform.lookAt(this.position, this.target, this.up)
    this.view = mat4.lookAt(this.position, this.target, this.up)
    this.projection = mat4.perspective(degreesToRadians(this.fovYDegrees), aspect(this.resolution), this.near, this.far)
    this.viewProjection = mat4.multiply(this.projection, this.view)
    this.invViewProjection = mat4.inverse(this.viewProjection)
    this.cameraFromRaster = makeCameraFromRaster(this.projection, this.screenWindow, this.resolution)
  }

  sampleTime(u = 0.5): number {
    return this.shutterOpen + (this.shutterClose - this.shutterOpen) * u
  }

  generateRay(sample: CameraSample): Ray {
    const pCamera = vec3.transformMat4([sample.pFilm[0], sample.pFilm[1], 0], this.cameraFromRaster)
    return {
      origin: this.position,
      direction: toVec3(vec3.normalize(this.transform.renderFromCameraVector(toVec3(pCamera)))),
    }
  }

  generateRayDifferential(sample: CameraSample): RayDifferential {
    const ray = this.generateRay(sample)
    const rx = this.generateRay({ ...sample, pFilm: [sample.pFilm[0] + 1, sample.pFilm[1]] })
    const ry = this.generateRay({ ...sample, pFilm: [sample.pFilm[0], sample.pFilm[1] + 1] })
    return {
      ...ray,
      rxOrigin: rx.origin,
      ryOrigin: ry.origin,
      rxDirection: rx.direction,
      ryDirection: ry.direction,
      hasDifferentials: true,
    }
  }

  uniform(frameIndex: number, elapsedSeconds: number): CameraUniformData {
    return {
      invViewProj: this.invViewProjection,
      positionAndFrame: [this.position[0], this.position[1], this.position[2], frameIndex],
      viewportAndTime: [this.resolution[0], this.resolution[1], elapsedSeconds, this.sampleTime()],
    }
  }
}

export class OrthographicCamera {
  readonly transform: CameraTransform
  readonly resolution: Vec2
  readonly position: Vec3
  readonly target: Vec3
  readonly up: Vec3
  readonly near: number
  readonly far: number
  readonly screenWindow: ScreenWindow
  readonly shutterOpen: number
  readonly shutterClose: number
  readonly view: Mat4
  readonly projection: Mat4
  readonly viewProjection: Mat4
  readonly invViewProjection: Mat4
  readonly cameraFromRaster: Mat4

  constructor(options: OrthographicCameraOptions) {
    this.resolution = options.resolution
    this.position = options.position
    this.target = options.target
    this.up = options.up ?? DEFAULT_UP
    this.near = options.near ?? 0
    this.far = options.far ?? 20
    this.screenWindow = options.screenWindow ?? defaultScreenWindow(options.resolution)
    this.shutterOpen = options.shutterOpen ?? 0
    this.shutterClose = options.shutterClose ?? 1

    this.transform = CameraTransform.lookAt(this.position, this.target, this.up)
    this.view = mat4.lookAt(this.position, this.target, this.up)
    this.projection = mat4.ortho(
      this.screenWindow.pMin[0],
      this.screenWindow.pMax[0],
      this.screenWindow.pMin[1],
      this.screenWindow.pMax[1],
      this.near,
      this.far,
    )
    this.viewProjection = mat4.multiply(this.projection, this.view)
    this.invViewProjection = mat4.inverse(this.viewProjection)
    this.cameraFromRaster = makeCameraFromRaster(this.projection, this.screenWindow, this.resolution)
  }

  sampleTime(u = 0.5): number {
    return this.shutterOpen + (this.shutterClose - this.shutterOpen) * u
  }

  generateRay(sample: CameraSample): Ray {
    const pCamera = vec3.transformMat4([sample.pFilm[0], sample.pFilm[1], 0], this.cameraFromRaster)
    return {
      origin: this.transform.renderFromCameraPoint(toVec3(pCamera)),
      direction: toVec3(vec3.normalize(this.transform.renderFromCameraVector([0, 0, -1]))),
    }
  }

  generateRayDifferential(sample: CameraSample): RayDifferential {
    const ray = this.generateRay(sample)
    const rx = this.generateRay({ ...sample, pFilm: [sample.pFilm[0] + 1, sample.pFilm[1]] })
    const ry = this.generateRay({ ...sample, pFilm: [sample.pFilm[0], sample.pFilm[1] + 1] })
    return {
      ...ray,
      rxOrigin: rx.origin,
      ryOrigin: ry.origin,
      rxDirection: rx.direction,
      ryDirection: ry.direction,
      hasDifferentials: true,
    }
  }

  uniform(frameIndex: number, elapsedSeconds: number): CameraUniformData {
    return {
      invViewProj: this.invViewProjection,
      positionAndFrame: [this.position[0], this.position[1], this.position[2], frameIndex],
      viewportAndTime: [this.resolution[0], this.resolution[1], elapsedSeconds, this.sampleTime()],
    }
  }
}

export function packCameraUniform(uniform: CameraUniformData): Float32Array {
  const data = new Float32Array(24)
  data.set(uniform.invViewProj, 0)
  data.set(uniform.positionAndFrame, 16)
  data.set(uniform.viewportAndTime, 20)
  return data
}

export function defaultScreenWindow(resolution: Vec2): ScreenWindow {
  const frame = aspect(resolution)
  if (frame > 1) {
    return { pMin: [-frame, -1], pMax: [frame, 1] }
  }
  return { pMin: [-1, -1 / frame], pMax: [1, 1 / frame] }
}

function makeCameraFromRaster(projection: Mat4, screenWindow: ScreenWindow, resolution: Vec2): Mat4 {
  const ndcFromScreen = mat4.multiply(
    mat4.scaling([
      1 / (screenWindow.pMax[0] - screenWindow.pMin[0]),
      1 / (screenWindow.pMax[1] - screenWindow.pMin[1]),
      1,
    ]),
    mat4.translation([-screenWindow.pMin[0], -screenWindow.pMax[1], 0]),
  )
  const rasterFromNdc = mat4.scaling([resolution[0], -resolution[1], 1])
  const rasterFromScreen = mat4.multiply(rasterFromNdc, ndcFromScreen)
  const screenFromRaster = mat4.inverse(rasterFromScreen)
  return mat4.multiply(mat4.inverse(projection), screenFromRaster)
}

function aspect(resolution: Vec2): number {
  return resolution[0] / Math.max(1, resolution[1])
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function toVec3(value: ArrayLike<number>): Vec3 {
  return [value[0], value[1], value[2]]
}
