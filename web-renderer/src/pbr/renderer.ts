import renderSampleShader from './shaders/renderSample.wgsl?raw'
import presentShader from './shaders/present.wgsl?raw'
import { PerspectiveCamera, packCameraUniform } from './camera'
import { packDensityR8 } from './density'
import type { Vec3 } from '../volume'
import type { DensityVolume, MajorantGrid } from './types'

export interface RendererParams {
  sigmaA: Vec3
  sigmaS: Vec3
  scale: number
  g: number
  maxDepth: number
  environmentL: Vec3
}

export type RendererErrorHandler = (message: string) => void

interface GpuVolume {
  densityTexture: GPUTexture
  majorantBuffer: GPUBuffer
  dims: Vec3
  majorantDims: Vec3
  globalMaxDensity: number
}

const CAMERA_UNIFORM_BYTES = 96
const PARAM_UNIFORM_BYTES = 96
export class VolumeRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly format: GPUTextureFormat
  private readonly renderPipeline: GPUComputePipeline
  private readonly presentPipeline: GPURenderPipeline
  private readonly pendingErrors: string[]
  private readonly cameraBuffer: GPUBuffer
  private readonly paramsBuffer: GPUBuffer
  private readonly emptyMajorantBuffer: GPUBuffer
  private readonly emptyDensityTexture: GPUTexture
  private readonly densitySampler: GPUSampler
  private accumBuffer: GPUBuffer
  private bindGroup: GPUBindGroup | null = null
  private presentBindGroup: GPUBindGroup | null = null
  private volume: GpuVolume | null = null
  private width = 1
  private height = 1
  private frameIndex = 0
  private needsClear = true
  private orbitYaw = 0.75
  private orbitPitch = 0.25
  private orbitDistance = 1.9
  private pointer: { x: number; y: number } | null = null
  private errorHandler: RendererErrorHandler | null = null

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    renderPipeline: GPUComputePipeline,
    presentPipeline: GPURenderPipeline,
    pendingErrors: string[],
  ) {
    this.canvas = canvas
    this.device = device
    this.context = context
    this.format = format
    this.renderPipeline = renderPipeline
    this.presentPipeline = presentPipeline
    this.pendingErrors = pendingErrors
    this.cameraBuffer = device.createBuffer({
      size: CAMERA_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.paramsBuffer = device.createBuffer({
      size: PARAM_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.emptyMajorantBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.emptyDensityTexture = device.createTexture({
      size: [1, 1, 1],
      dimension: '3d',
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.densitySampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    })
    this.accumBuffer = this.createAccumBuffer()
    this.device.queue.writeBuffer(this.emptyMajorantBuffer, 0, new Float32Array([1]))
    this.device.queue.writeTexture(
      { texture: this.emptyDensityTexture },
      new Uint8Array([64]),
      { bytesPerRow: 256, rowsPerImage: 1 },
      [1, 1, 1],
    )
    this.configureCanvas()
    this.device.addEventListener('uncapturederror', (event) => {
      this.errorHandler?.(event.error.message)
    })
    this.attachControls()
  }

  static async create(canvas: HTMLCanvasElement): Promise<VolumeRenderer> {
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
    const { renderPipeline, presentPipeline, diagnostics } = await createPipelines(device, format)
    return new VolumeRenderer(canvas, device, context, format, renderPipeline, presentPipeline, diagnostics)
  }

  onError(handler: RendererErrorHandler): void {
    this.errorHandler = handler
    for (const error of this.pendingErrors) {
      handler(error)
    }
    this.pendingErrors.length = 0
  }

  setVolume(volume: DensityVolume, majorant: MajorantGrid): void {
    this.volume?.densityTexture.destroy()
    this.volume?.majorantBuffer.destroy()

    const densityTexture = this.device.createTexture({
      size: volume.dims,
      dimension: '3d',
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.writeDensityTexture(densityTexture, volume)

    const majorantBuffer = this.device.createBuffer({
      size: Math.max(4, majorant.voxels.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(majorantBuffer, 0, majorant.voxels)

    this.volume = {
      densityTexture,
      majorantBuffer,
      dims: volume.dims,
      majorantDims: majorant.res,
      globalMaxDensity: majorant.globalMaxDensity,
    }
    this.rebuildBindGroups()
    this.resetAccumulation()
  }

  resize(): void {
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
    this.accumBuffer.destroy()
    this.accumBuffer = this.createAccumBuffer()
    this.rebuildBindGroups()
    this.resetAccumulation()
  }

  render(params: RendererParams): number {
    this.resize()
    this.writeCameraUniform()
    this.writeParamsUniform(params)

    this.device.pushErrorScope('validation')
    const encoder = this.device.createCommandEncoder()
    if (this.needsClear) {
      encoder.clearBuffer(this.accumBuffer)
      this.needsClear = false
    }

    const renderPass = encoder.beginComputePass()
    renderPass.setPipeline(this.renderPipeline)
    renderPass.setBindGroup(0, this.bindGroup ?? this.createRenderBindGroup())
    renderPass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8))
    renderPass.end()

    const presentPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    presentPass.setPipeline(this.presentPipeline)
    presentPass.setBindGroup(0, this.presentBindGroup ?? this.createPresentBindGroup())
    presentPass.draw(3)
    presentPass.end()

    this.device.queue.submit([encoder.finish()])
    void this.device.popErrorScope().then((error) => {
      if (error) {
        this.errorHandler?.(error.message)
      }
    })
    this.frameIndex += 1
    return this.frameIndex
  }

  resetAccumulation(): void {
    this.frameIndex = 0
    this.needsClear = true
  }

  private configureCanvas(): void {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  private createAccumBuffer(): GPUBuffer {
    return this.device.createBuffer({
      size: Math.max(16, this.width * this.height * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }

  private createRenderBindGroup(): GPUBindGroup {
    const volume = this.volume
    return this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
        { binding: 2, resource: { buffer: this.accumBuffer } },
        { binding: 3, resource: (volume?.densityTexture ?? this.emptyDensityTexture).createView() },
        { binding: 4, resource: this.densitySampler },
        { binding: 5, resource: { buffer: volume?.majorantBuffer ?? this.emptyMajorantBuffer } },
      ],
    })
  }

  private createPresentBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.accumBuffer } },
      ],
    })
  }

  private rebuildBindGroups(): void {
    this.bindGroup = this.createRenderBindGroup()
    this.presentBindGroup = this.createPresentBindGroup()
  }

  private writeDensityTexture(texture: GPUTexture, volume: DensityVolume): void {
    const packed = packDensityR8(volume)
    const bytesPerRow = alignTo(volume.dims[0], 256)
    const padded = new Uint8Array(bytesPerRow * volume.dims[1] * volume.dims[2])

    for (let z = 0; z < volume.dims[2]; z += 1) {
      for (let y = 0; y < volume.dims[1]; y += 1) {
        const sourceOffset = volume.dims[0] * (y + volume.dims[1] * z)
        const targetOffset = bytesPerRow * (y + volume.dims[1] * z)
        padded.set(packed.subarray(sourceOffset, sourceOffset + volume.dims[0]), targetOffset)
      }
    }

    this.device.queue.writeTexture(
      { texture },
      padded,
      { bytesPerRow, rowsPerImage: volume.dims[1] },
      volume.dims,
    )
  }

  private writeCameraUniform(): void {
    const camera = new PerspectiveCamera({
      resolution: [this.width, this.height],
      position: this.cameraPosition(),
      target: [0, 0, 0],
      fovYDegrees: 45,
      near: 0.01,
      far: 20,
    })
    const data = packCameraUniform(camera.uniform(this.frameIndex, performance.now() * 0.001))
    this.device.queue.writeBuffer(this.cameraBuffer, 0, data)
  }

  private writeParamsUniform(params: RendererParams): void {
    const volume = this.volume
    const data = new ArrayBuffer(PARAM_UNIFORM_BYTES)
    const f32 = new Float32Array(data)
    const u32 = new Uint32Array(data)
    const volumeDims = volume?.dims ?? [1, 1, 1]
    const majorantDims = volume?.majorantDims ?? [1, 1, 1]

    u32.set([volumeDims[0], volumeDims[1], volumeDims[2], 0], 0)
    u32.set([majorantDims[0], majorantDims[1], majorantDims[2], 0], 4)
    f32.set([...params.sigmaA, 0], 8)
    f32.set([...params.sigmaS, 0], 12)
    f32.set([params.scale, params.g, params.maxDepth, volume?.globalMaxDensity ?? 1], 16)
    f32.set([...params.environmentL, 0], 20)
    this.device.queue.writeBuffer(this.paramsBuffer, 0, data)
  }

  private attachControls(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.pointer = { x: event.clientX, y: event.clientY }
      this.canvas.setPointerCapture(event.pointerId)
    })
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.pointer) {
        return
      }
      const dx = event.clientX - this.pointer.x
      const dy = event.clientY - this.pointer.y
      this.pointer = { x: event.clientX, y: event.clientY }
      this.orbitYaw -= dx * 0.006
      this.orbitPitch = Math.max(-1.25, Math.min(1.25, this.orbitPitch - dy * 0.006))
      this.resetAccumulation()
    })
    this.canvas.addEventListener('pointerup', (event) => {
      this.pointer = null
      this.canvas.releasePointerCapture(event.pointerId)
    })
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        this.orbitDistance = Math.max(0.8, Math.min(5, this.orbitDistance * (1 + event.deltaY * 0.001)))
        this.resetAccumulation()
      },
      { passive: false },
    )
  }

  private cameraPosition(): Vec3 {
    const cp = Math.cos(this.orbitPitch)
    return [
      this.orbitDistance * Math.sin(this.orbitYaw) * cp,
      this.orbitDistance * Math.sin(this.orbitPitch),
      this.orbitDistance * Math.cos(this.orbitYaw) * cp,
    ]
  }
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

async function createPipelines(device: GPUDevice, format: GPUTextureFormat) {
  const diagnostics: string[] = []
  const renderModule = device.createShaderModule({ label: 'renderSample.wgsl', code: renderSampleShader })
  const presentModule = device.createShaderModule({ label: 'present.wgsl', code: presentShader })

  diagnostics.push(...(await shaderDiagnostics(renderModule, 'renderSample.wgsl')))
  diagnostics.push(...(await shaderDiagnostics(presentModule, 'present.wgsl')))

  const renderPipeline = await device.createComputePipelineAsync({
    label: 'volume render sample pipeline',
    layout: 'auto',
    compute: {
      module: renderModule,
      entryPoint: 'main',
    },
  })
  const presentPipeline = await device.createRenderPipelineAsync({
    label: 'volume present pipeline',
    layout: 'auto',
    vertex: {
      module: presentModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: presentModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })

  return { renderPipeline, presentPipeline, diagnostics }
}

async function shaderDiagnostics(module: GPUShaderModule, label: string): Promise<string[]> {
  const getCompilationInfo = (module as GPUShaderModule & {
    getCompilationInfo?: () => Promise<GPUCompilationInfo>
  }).getCompilationInfo
  if (!getCompilationInfo) {
    return []
  }

  const info = await getCompilationInfo.call(module)
  return info.messages
    .filter((message) => message.type === 'error')
    .map((message) => `${label}:${message.lineNum}:${message.linePos} ${message.message}`)
}

