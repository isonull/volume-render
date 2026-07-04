import type { Vec2n } from 'wgpu-matrix'

export class Viewport {
  readonly id: string
  readonly canvas: HTMLCanvasElement
  readonly context: GPUCanvasContext
  readonly format: GPUTextureFormat
  width = 1
  height = 1
  pixelRatio = 1
  private readonly device: GPUDevice

  constructor(id: string, canvas: HTMLCanvasElement, device: GPUDevice, format: GPUTextureFormat) {
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      throw new Error(`Could not create WebGPU context for viewport ${id}.`)
    }

    this.id = id
    this.canvas = canvas
    this.context = context
    this.format = format
    this.device = device
    this.configure()
    this.resizeFromClient()
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const nextWidth = Math.max(1, Math.floor(width * pixelRatio))
    const nextHeight = Math.max(1, Math.floor(height * pixelRatio))
    if (this.width === nextWidth && this.height === nextHeight && this.pixelRatio === pixelRatio) {
      return
    }

    this.width = nextWidth
    this.height = nextHeight
    this.pixelRatio = pixelRatio
    this.canvas.width = nextWidth
    this.canvas.height = nextHeight
    this.configure()
  }

  resizeFromClient(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.resize(rect.width || 1, rect.height || 1, Math.min(window.devicePixelRatio || 1, 2))
  }

  getCurrentTextureView(): GPUTextureView {
    return this.context.getCurrentTexture().createView()
  }

  clear(color: GPUColor = { r: 0, g: 0, b: 0, a: 1 }): void {
    this.resizeFromClient()
    const encoder = this.device.createCommandEncoder({ label: `Clear viewport ${this.id}` })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.getCurrentTextureView(),
          clearValue: color,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  clientToCanvas(point: Vec2n): Vec2n {
    const rect = this.canvas.getBoundingClientRect()
    return [
      (point[0] - rect.left) * this.pixelRatio,
      (point[1] - rect.top) * this.pixelRatio,
    ]
  }

  canvasToClient(point: Vec2n): Vec2n {
    const rect = this.canvas.getBoundingClientRect()
    return [
      point[0] / this.pixelRatio + rect.left,
      point[1] / this.pixelRatio + rect.top,
    ]
  }

  private configure(): void {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }
}
