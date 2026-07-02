import mprShader from './shaders/mpr.wgsl?raw'
import { mat4 } from 'wgpu-matrix'
import { createGPUTexture } from '../volume'
import type { Mat4 } from 'wgpu-matrix'
import type { ScalarVolume, Vec3 } from '../volume'

export interface MprPlane {
  origin: Vec3
  right: Vec3
  up: Vec3
  pixelSize: number
  windowMin: number
  windowMax: number
}

const UNIFORM_BYTES = 160
type UploadedScalarVolume = {
  texture: GPUTexture
  shape: Vec3
  indexToWorld: Mat4
}

export class MprRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly format: GPUTextureFormat
  private readonly pipeline: GPURenderPipeline
  private readonly uniformBuffer: GPUBuffer
  private readonly emptyTexture: GPUTexture
  private bindGroup: GPUBindGroup | null = null
  private volume: UploadedScalarVolume | null = null
  private width = 1
  private height = 1

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipeline: GPURenderPipeline,
  ) {
    this.canvas = canvas
    this.device = device
    this.context = context
    this.format = format
    this.pipeline = pipeline
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.emptyTexture = device.createTexture({
      size: [1, 1, 1],
      dimension: '3d',
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.device.queue.writeTexture(
      { texture: this.emptyTexture },
      new Float32Array([0]),
      { bytesPerRow: 256, rowsPerImage: 1 },
      [1, 1, 1],
    )
    this.configureCanvas()
  }

  static async create(canvas: HTMLCanvasElement): Promise<MprRenderer> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available in this browser.')
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('No WebGPU adapter was found.')
    }
    const device = await adapter.requestDevice()
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      throw new Error('Could not create a WebGPU canvas context.')
    }
    const format = navigator.gpu.getPreferredCanvasFormat()
    const module = device.createShaderModule({ label: 'mpr.wgsl', code: mprShader })
    const pipeline = await device.createRenderPipelineAsync({
      label: 'mpr render pipeline',
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
    return new MprRenderer(canvas, device, context, format, pipeline)
  }

  setVolume(volume: ScalarVolume): void {
    this.volume?.texture.destroy()
    const texture = createGPUTexture(this.device, volume)
    this.volume = {
      texture,
      shape: volume.shape,
      indexToWorld: volume.indexToWorld,
    }
    this.bindGroup = this.createBindGroup()
  }

  render(plane: MprPlane): void {
    this.resize()
    this.writeUniforms(plane)

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup ?? this.createBindGroup())
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  private configureCanvas(): void {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.floor(rect.width * dpr))
    const height = Math.max(1, Math.floor(rect.height * dpr))
    if (width === this.width && height === this.height) {
      return
    }
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    this.configureCanvas()
  }

  private createBindGroup(): GPUBindGroup {
    const volume = this.volume
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: (volume?.texture ?? this.emptyTexture).createView() },
      ],
    })
  }

  private writeUniforms(plane: MprPlane): void {
    const volume = this.volume
    const dims = volume?.shape ?? [1, 1, 1]
    const worldToIndex = volume ? mat4.inverse(volume.indexToWorld) : mat4.identity()
    const data = new ArrayBuffer(UNIFORM_BYTES)
    const f32 = new Float32Array(data)
    const u32 = new Uint32Array(data)

    f32.set([...plane.origin, 0], 0)
    f32.set([...plane.right, 0], 4)
    f32.set([...plane.up, 0], 8)
    f32.set([worldToIndex[0], worldToIndex[4], worldToIndex[8], worldToIndex[12]], 12)
    f32.set([worldToIndex[1], worldToIndex[5], worldToIndex[9], worldToIndex[13]], 16)
    f32.set([worldToIndex[2], worldToIndex[6], worldToIndex[10], worldToIndex[14]], 20)
    f32.set([worldToIndex[3], worldToIndex[7], worldToIndex[11], worldToIndex[15]], 24)
    u32.set([dims[0], dims[1], dims[2], 0], 28)
    f32.set([this.width, this.height, 0, 0], 32)
    f32.set([plane.windowMin, plane.windowMax, plane.pixelSize, 0], 36)

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data)
  }
}
