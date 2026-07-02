import './style.css'
import { mat4, vec3, type Mat4 } from 'wgpu-matrix'
import { MprRenderer, type MprPlane } from './mpr/mprRenderer'
import { ScalarVolume } from './volume'
import type { Vec3 } from './volume'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <section class="viewport">
      <canvas id="mpr-canvas" aria-label="WebGPU MPR canvas"></canvas>
      <div class="hud"><span id="status">Initializing...</span></div>
    </section>
    <aside class="controls">
      <div class="title-block">
        <h1>MPR</h1>
        <p>W/S move along plane up/down, A/D along plane left/right, E/C along plane normal, I/K pitch, J/L yaw, U/O roll.</p>
      </div>
      <label class="file-picker">
        <span>NIfTI</span>
        <input id="file" type="file" accept=".nii,.gz,.nii.gz" />
      </label>
      <dl id="volume-info" class="info">
        <div><dt>Volume</dt><dd>Test sphere</dd></div>
      </dl>
    </aside>
  </main>
`

const canvas = byId<HTMLCanvasElement>('mpr-canvas')
const statusEl = byId<HTMLElement>('status')
const fileInput = byId<HTMLInputElement>('file')
const infoEl = byId<HTMLElement>('volume-info')
const pressed = new Set<string>()

let renderer: MprRenderer | null = null
let volume: ScalarVolume | null = null
let plane: MprPlane | null = null

async function init(): Promise<void> {
  try {
    renderer = await MprRenderer.create(canvas)
    setVolume(createTestVolume())
    bindControls()
    statusEl.textContent = 'Ready'
    requestAnimationFrame(frame)
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error)
  }
}

function bindControls(): void {
  window.addEventListener('keydown', event => {
    pressed.add(event.key.toLowerCase())
  })
  window.addEventListener('keyup', event => {
    pressed.delete(event.key.toLowerCase())
  })
  window.addEventListener('resize', () => {
    if (volume && plane) {
      plane.pixelSize = initialPixelSize(volume)
    }
  })
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) {
      return
    }
    try {
      statusEl.textContent = `Loading ${file.name}...`
      const { loadNiftiFile, scalarVolumeFromNiftiFile } = await import('./io/nifti')
      setVolume(scalarVolumeFromNiftiFile(await loadNiftiFile(file)))
      statusEl.textContent = `${file.name} loaded`
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : String(error)
    }
  })
}

function setVolume(nextVolume: ScalarVolume): void {
  volume = nextVolume
  renderer?.setVolume(nextVolume)
  plane = initialPlane(nextVolume)
  renderInfo(nextVolume)
}

function frame(): void {
  if (renderer && volume && plane) {
    updatePlane(plane)
    renderer.render(plane)
  }
  requestAnimationFrame(frame)
}

function updatePlane(nextPlane: MprPlane): void {
  const moveStep = nextPlane.pixelSize * 8
  const rotateStep = 0.035
  const normal = normalize(cross(nextPlane.right, nextPlane.up))

  if (pressed.has('w')) {
    nextPlane.origin = addScaled(nextPlane.origin, nextPlane.up, moveStep)
  }
  if (pressed.has('s')) {
    nextPlane.origin = addScaled(nextPlane.origin, nextPlane.up, -moveStep)
  }
  if (pressed.has('d')) {
    nextPlane.origin = addScaled(nextPlane.origin, nextPlane.right, moveStep)
  }
  if (pressed.has('a')) {
    nextPlane.origin = addScaled(nextPlane.origin, nextPlane.right, -moveStep)
  }
  if (pressed.has('e')) {
    nextPlane.origin = addScaled(nextPlane.origin, normal, moveStep)
  }
  if (pressed.has('c')) {
    nextPlane.origin = addScaled(nextPlane.origin, normal, -moveStep)
  }

  if (pressed.has('i')) {
    rotatePlane(nextPlane, nextPlane.right, rotateStep)
  }
  if (pressed.has('k')) {
    rotatePlane(nextPlane, nextPlane.right, -rotateStep)
  }
  if (pressed.has('j')) {
    rotatePlane(nextPlane, nextPlane.up, rotateStep)
  }
  if (pressed.has('l')) {
    rotatePlane(nextPlane, nextPlane.up, -rotateStep)
  }
  if (pressed.has('u')) {
    rotatePlane(nextPlane, normal, rotateStep)
  }
  if (pressed.has('o')) {
    rotatePlane(nextPlane, normal, -rotateStep)
  }
}

function initialPlane(source: ScalarVolume): MprPlane {
  const dims = source.shape
  const centerIndex: Vec3 = [
    (dims[0] - 1) * 0.5,
    (dims[1] - 1) * 0.5,
    (dims[2] - 1) * 0.5,
  ]
  const origin = toVec3(vec3.transformMat4(centerIndex, source.indexToWorld))
  const right = normalize(axisFromMat4(source.indexToWorld, 0))
  const up = normalize(axisFromMat4(source.indexToWorld, 1))
  const [windowMin, windowMax] = valueRange(source)
  return {
    origin,
    right,
    up,
    pixelSize: initialPixelSize(source),
    windowMin,
    windowMax,
  }
}

function initialPixelSize(source: ScalarVolume): number {
  const dims = source.shape
  const sx = length(axisFromMat4(source.indexToWorld, 0)) * dims[0]
  const sy = length(axisFromMat4(source.indexToWorld, 1)) * dims[1]
  const sz = length(axisFromMat4(source.indexToWorld, 2)) * dims[2]
  const canvasPixels = Math.max(1, Math.min(canvas.clientWidth || 512, canvas.clientHeight || 512))
  return Math.max(sx, sy, sz) / canvasPixels
}

function createTestVolume(): ScalarVolume {
  const dims: Vec3 = [160, 160, 120]
  const data = new Float32Array(dims[0] * dims[1] * dims[2])
  for (let z = 0; z < dims[2]; z += 1) {
    const nz = (z / (dims[2] - 1)) * 2 - 1
    for (let y = 0; y < dims[1]; y += 1) {
      const ny = (y / (dims[1] - 1)) * 2 - 1
      for (let x = 0; x < dims[0]; x += 1) {
        const nx = (x / (dims[0] - 1)) * 2 - 1
        const sphere = Math.max(0, 1 - Math.hypot(nx, ny, nz * 1.25))
        const stripe = Math.sin((nx + ny * 0.7 + nz * 0.4) * 22) * 0.08
        data[x + dims[0] * (y + dims[1] * z)] = Math.max(0, sphere + stripe)
      }
    }
  }
  return new ScalarVolume(
    dims,
    data,
    mat4.set(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -0.5 * (dims[0] - 1), -0.5 * (dims[1] - 1), -0.5 * (dims[2] - 1), 1,
    ),
  )
}

function rotatePlane(nextPlane: MprPlane, axis: Vec3, radians: number): void {
  nextPlane.right = normalize(rotateVector(nextPlane.right, axis, radians))
  nextPlane.up = normalize(rotateVector(nextPlane.up, axis, radians))
}

function rotateVector(vector: Vec3, axis: Vec3, radians: number): Vec3 {
  const rotation = mat4.axisRotation(normalize(axis), radians)
  return normalize(toVec3(vec3.transformMat4Upper3x3(vector, rotation)))
}

function renderInfo(source: ScalarVolume): void {
  const [min, max] = valueRange(source)
  const center = initialPlane(source).origin
  infoEl.innerHTML = `
    <div><dt>Volume</dt><dd>${source.shape.join(' x ')}</dd></div>
    <div><dt>Center</dt><dd>${center.map(formatNumber).join(', ')}</dd></div>
    <div><dt>Range</dt><dd>${formatNumber(min)} to ${formatNumber(max)}</dd></div>
  `
}

function valueRange(source: ScalarVolume): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < source.data.length; i += 1) {
    const value = source.data[i]
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return [min, max]
}

function axisFromMat4(matrix: Mat4, axis: 0 | 1 | 2): Vec3 {
  const offset = axis * 4
  return [matrix[offset], matrix[offset + 1], matrix[offset + 2]]
}

function addScaled(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(v: Vec3): Vec3 {
  const len = length(v)
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0]
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function toVec3(value: ArrayLike<number>): Vec3 {
  return [value[0], value[1], value[2]]
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'n/a'
}

void init()
