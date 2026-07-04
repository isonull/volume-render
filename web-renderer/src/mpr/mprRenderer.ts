import mprShader from './shaders/mpr.wgsl?raw'
import { mat4 } from 'wgpu-matrix'
import { createGPUTexture } from '../volume'
import { createLabelmapGPUTexture, writeLabelmapTexture } from '../segmentation'
import type { Mat4 } from 'wgpu-matrix'
import type { Box3i } from '../scene'
import type { Scene } from '../scene'
import type { Vec3n } from 'wgpu-matrix'
import type { LabelmapSegmentationData } from '../segmentation'
import type { ScalarVolume } from '../volume'
import type { Viewport } from '../viewport'
import type { MprRenderState } from './mprState'

const UNIFORM_BYTES = 256
const EMPTY_LABEL_COLORS = new Float32Array([0, 0, 0, 0])

export class PreparedScene {
  readonly sourceSceneId: string
  sourceVersion: number
  readonly preparedVolumes = new Map<string, PreparedScalarVolume>()
  readonly preparedSegmentations = new Map<string, PreparedLabelmapSegmentation>()
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
    for (const segmentation of this.preparedSegmentations.values()) {
      segmentation.release()
    }
    this.preparedSegmentations.clear()
    this.pendingInvalidations.length = 0
  }
}

export class PreparedScalarVolume {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly shape: Vec3n
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

export class PreparedLabelmapSegmentation {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly colorBuffer: GPUBuffer
  readonly shape: Vec3n
  readonly indexToWorld: Mat4

  constructor(device: GPUDevice, texture: GPUTexture, segmentation: LabelmapSegmentationData) {
    this.texture = texture
    this.textureView = texture.createView()
    this.colorBuffer = createLabelColorBuffer(device, segmentation)
    this.shape = segmentation.shape
    this.indexToWorld = segmentation.indexToWorld
  }

  release(): void {
    this.texture.destroy()
    this.colorBuffer.destroy()
  }
}

export type PreparedInvalidation =
  | { type: 'volumeTextureDirty'; volumeId: string; regions?: Box3i[] }
  | { type: 'segmentationTextureDirty'; segmentationId: string; regions?: Box3i[] }
  | { type: 'preparedSceneStructureDirty' }

export class MprRenderer {
  readonly device: GPUDevice
  readonly format: GPUTextureFormat
  private readonly pipeline: GPURenderPipeline
  private readonly uniformBuffer: GPUBuffer
  private readonly emptyLabelmapTexture: GPUTexture
  private readonly emptyLabelmapTextureView: GPUTextureView
  private readonly emptyLabelColorBuffer: GPUBuffer

  private constructor(device: GPUDevice, format: GPUTextureFormat, pipeline: GPURenderPipeline) {
    this.device = device
    this.format = format
    this.pipeline = pipeline
    this.uniformBuffer = device.createBuffer({
      label: 'MPR uniforms',
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.emptyLabelmapTexture = device.createTexture({
      label: 'Empty labelmap texture',
      size: [1, 1, 1],
      dimension: '3d',
      format: 'r8uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.emptyLabelmapTextureView = this.emptyLabelmapTexture.createView()
    device.queue.writeTexture(
      { texture: this.emptyLabelmapTexture },
      new Uint8Array(256),
      { bytesPerRow: 256, rowsPerImage: 1 },
      [1, 1, 1],
    )
    this.emptyLabelColorBuffer = device.createBuffer({
      label: 'Empty label colors',
      size: EMPTY_LABEL_COLORS.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.emptyLabelColorBuffer, 0, EMPTY_LABEL_COLORS)
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

    for (const [segmentationId, segmentation] of scene.segmentations) {
      if (!prepared.preparedSegmentations.has(segmentationId)) {
        prepared.preparedSegmentations.set(
          segmentationId,
          new PreparedLabelmapSegmentation(this.device, createLabelmapGPUTexture(this.device, segmentation), segmentation),
        )
      }
    }

    for (const volumeId of [...prepared.preparedVolumes.keys()]) {
      if (!scene.volumes.has(volumeId)) {
        prepared.preparedVolumes.get(volumeId)?.release()
        prepared.preparedVolumes.delete(volumeId)
      }
    }

    for (const segmentationId of [...prepared.preparedSegmentations.keys()]) {
      if (!scene.segmentations.has(segmentationId)) {
        prepared.preparedSegmentations.get(segmentationId)?.release()
        prepared.preparedSegmentations.delete(segmentationId)
      }
    }

    for (const invalidation of prepared.pendingInvalidations) {
      if (invalidation.type === 'segmentationTextureDirty') {
        const segmentation = scene.segmentations.get(invalidation.segmentationId)
        const preparedSegmentation = prepared.preparedSegmentations.get(invalidation.segmentationId)
        if (segmentation && preparedSegmentation) {
          writeLabelmapTexture(this.device, preparedSegmentation.texture, segmentation, invalidation.regions)
        }
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
    const overlay = state.overlay?.visible && state.overlay.segmentationId
      ? preparedScene.preparedSegmentations.get(state.overlay.segmentationId)
      : undefined

    viewport.resizeFromClient()
    this.writeUniforms(volume, overlay, viewport, state)
    const bindGroup = this.device.createBindGroup({
      label: `MPR bind group ${viewport.id}`,
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: volume.textureView },
        { binding: 2, resource: overlay?.textureView ?? this.emptyLabelmapTextureView },
        { binding: 3, resource: { buffer: overlay?.colorBuffer ?? this.emptyLabelColorBuffer } },
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
    this.emptyLabelmapTexture.destroy()
    this.emptyLabelColorBuffer.destroy()
  }

  private writeUniforms(
    volume: PreparedScalarVolume,
    overlay: PreparedLabelmapSegmentation | undefined,
    viewport: Viewport,
    state: MprRenderState,
  ): void {
    const worldToIndex = mat4.inverse(volume.indexToWorld)
    const labelWorldToIndex = overlay ? mat4.inverse(overlay.indexToWorld) : mat4.identity()
    const labelShape = overlay?.shape ?? [1, 1, 1]
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
    f32.set([labelWorldToIndex[0], labelWorldToIndex[4], labelWorldToIndex[8], labelWorldToIndex[12]], 32)
    f32.set([labelWorldToIndex[1], labelWorldToIndex[5], labelWorldToIndex[9], labelWorldToIndex[13]], 36)
    f32.set([labelWorldToIndex[2], labelWorldToIndex[6], labelWorldToIndex[10], labelWorldToIndex[14]], 40)
    f32.set([labelWorldToIndex[3], labelWorldToIndex[7], labelWorldToIndex[11], labelWorldToIndex[15]], 44)
    u32.set([labelShape[0], labelShape[1], labelShape[2], 0], 48)
    f32.set([viewport.width, viewport.height, 0, 0], 52)
    f32.set([state.image.windowMin, state.image.windowMax, state.plane.pixelSize, 0], 56)
    u32.set([state.image.interpolation === 'linear' ? 1 : 0, overlay ? 1 : 0, 0, 0], 60)

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data)
  }
}

function createLabelColorBuffer(device: GPUDevice, segmentation: LabelmapSegmentationData): GPUBuffer {
  let maxLabel = 0
  for (const label of segmentation.segments.keys()) {
    maxLabel = Math.max(maxLabel, label)
  }
  for (const label of segmentation.data) {
    maxLabel = Math.max(maxLabel, label)
  }

  const colors = new Float32Array(Math.max(1, maxLabel + 1) * 4)
  for (const segment of segmentation.segments.values()) {
    const offset = segment.label * 4
    colors[offset] = segment.color[0]
    colors[offset + 1] = segment.color[1]
    colors[offset + 2] = segment.color[2]
    colors[offset + 3] = segment.visible ? segment.opacity : 0
  }

  const buffer = device.createBuffer({
    label: `Label colors ${segmentation.id}`,
    size: colors.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, colors)
  return buffer
}
