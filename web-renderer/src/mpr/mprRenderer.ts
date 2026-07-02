import mprShader from './shaders/mpr.wgsl?raw'
import { mat4 } from 'wgpu-matrix'
import { createGPUTexture } from '../volume'
import type { Mat4 } from 'wgpu-matrix'
import type { Scene } from '../scene'
import type { ScalarVolume, Vec3 } from '../volume'
import type { Viewport } from '../viewport'
import type { MprRenderState } from './mprState'

const UNIFORM_BYTES = 176

export class PreparedScene {
  readonly sourceSceneId: string
  sourceVersion: number
  readonly preparedVolumes = new Map<string, PreparedScalarVolume>()
  readonly pendingInvalidations: PreparedInvalidation[] = []

  constructor(sourceSceneId: string, sourceVersion: number) {
    this.sourceSceneId = sourceSceneId
    this.sourceVersion = sourceVersion
  }

  release(): void {
    for (const volume of this.preparedVolumes.values()) {
      volume.release()
    }
    this.preparedVolumes.clear()
    this.pendingInvalidations.length = 0
  }
}

export class PreparedScalarVolume {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly shape: Vec3
  readonly indexToWorld: Mat4

  constructor(texture: GPUTexture, volume: ScalarVolume) {
    this.texture = texture
    this.textureView = texture.createView()
    this.shape = volume.shape
    this.indexToWorld = volume.indexToWorld
  }

  release(): void {
    this.texture.destroy()
  }
}

export type PreparedInvalidation =
  | { type: 'volumeTextureDirty'; volumeId: string; regions?: unknown[] }
  | { type: 'preparedSceneStructureDirty' }

export class MprRenderer {
  readonly device: GPUDevice
  readonly format: GPUTextureFormat
  private readonly pipeline: GPURenderPipeline
  private readonly uniformBuffer: GPUBuffer

  private constructor(device: GPUDevice, format: GPUTextureFormat, pipeline: GPURenderPipeline) {
    this.device = device
    this.format = format
    this.pipeline = pipeline
    this.uniformBuffer = device.createBuffer({
      label: 'MPR uniforms',
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  static async create(): Promise<MprRenderer> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available in this browser.')
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('No WebGPU adapter was found.')
    }
    const device = await adapter.requestDevice()
    const format = navigator.gpu.getPreferredCanvasFormat()
    const module = device.createShaderModule({ label: 'mpr.wgsl', code: mprShader })
    const pipeline = await device.createRenderPipelineAsync({
      label: 'MPR render pipeline',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })

    return new MprRenderer(device, format, pipeline)
  }

  prepareScene(scene: Scene, previous?: PreparedScene): PreparedScene {
    const prepared = previous && previous.sourceSceneId === scene.id
      ? previous
      : new PreparedScene(scene.id, scene.version)

    if (previous && prepared !== previous) {
      previous.release()
    }

    for (const [volumeId, volume] of scene.volumes) {
      if (!prepared.preparedVolumes.has(volumeId)) {
        prepared.preparedVolumes.set(volumeId, new PreparedScalarVolume(createGPUTexture(this.device, volume), volume))
      }
    }

    for (const volumeId of [...prepared.preparedVolumes.keys()]) {
      if (!scene.volumes.has(volumeId)) {
        prepared.preparedVolumes.get(volumeId)?.release()
        prepared.preparedVolumes.delete(volumeId)
      }
    }

    prepared.sourceVersion = scene.version
    prepared.pendingInvalidations.length = 0
    return prepared
  }

  render(preparedScene: PreparedScene, viewport: Viewport, state: MprRenderState): void {
    const volume = preparedScene.preparedVolumes.get(state.image.volumeId)
    if (!volume) {
      throw new Error(`Prepared volume not found: ${state.image.volumeId}`)
    }

    viewport.resizeFromClient()
    this.writeUniforms(volume, viewport, state)
    const bindGroup = this.device.createBindGroup({
      label: `MPR bind group ${viewport.id}`,
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: volume.textureView },
      ],
    })

    const encoder = this.device.createCommandEncoder({ label: `MPR render ${viewport.id}` })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: viewport.getCurrentTextureView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  releasePreparedScene(preparedScene: PreparedScene): void {
    preparedScene.release()
  }

  destroy(): void {
    this.uniformBuffer.destroy()
  }

  private writeUniforms(volume: PreparedScalarVolume, viewport: Viewport, state: MprRenderState): void {
    const worldToIndex = mat4.inverse(volume.indexToWorld)
    const data = new ArrayBuffer(UNIFORM_BYTES)
    const f32 = new Float32Array(data)
    const u32 = new Uint32Array(data)

    f32.set([...state.plane.origin, 0], 0)
    f32.set([...state.plane.right, 0], 4)
    f32.set([...state.plane.up, 0], 8)
    f32.set([worldToIndex[0], worldToIndex[4], worldToIndex[8], worldToIndex[12]], 12)
    f32.set([worldToIndex[1], worldToIndex[5], worldToIndex[9], worldToIndex[13]], 16)
    f32.set([worldToIndex[2], worldToIndex[6], worldToIndex[10], worldToIndex[14]], 20)
    f32.set([worldToIndex[3], worldToIndex[7], worldToIndex[11], worldToIndex[15]], 24)
    u32.set([volume.shape[0], volume.shape[1], volume.shape[2], 0], 28)
    f32.set([viewport.width, viewport.height, 0, 0], 32)
    f32.set([state.image.windowMin, state.image.windowMax, state.plane.pixelSize, 0], 36)
    u32.set([state.image.interpolation === 'linear' ? 1 : 0, 0, 0, 0], 40)

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data)
  }
}
