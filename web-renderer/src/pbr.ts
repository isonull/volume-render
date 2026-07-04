import './style.css'
import { mat4, vec3 } from 'wgpu-matrix'
import type { Vec3n } from 'wgpu-matrix'
import { ScalarVolume } from './volume'
import type { VolumeRenderer, RendererParams } from './pbr/renderer'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('Missing #app root.')
}

app.innerHTML = `
  <main class="shell">
    <section class="viewport">
      <canvas id="render-canvas" aria-label="WebGPU volume render canvas"></canvas>
      <div class="hud">
        <span id="sample-count">0 samples</span>
        <button id="reset" type="button" title="Reset accumulation">Reset</button>
      </div>
    </section>
    <aside class="controls">
      <div class="title-block">
        <h1>NIfTI WebGPU MVP</h1>
        <p id="status">Initializing WebGPU...</p>
      </div>
      <label class="file-picker">
        <span>NIfTI volume</span>
        <input id="file" type="file" accept=".nii,.nii.gz" />
      </label>
      <div class="control-grid">
        <label>Window min<input id="window-min" type="number" step="1" value="0"></label>
        <label>Window max<input id="window-max" type="number" step="1" value="1"></label>
        <label>Scale<input id="scale" type="number" min="0.01" step="0.05" value="6"></label>
        <label>g<input id="g" type="number" min="-0.95" max="0.95" step="0.05" value="0"></label>
        <label>Max depth<input id="max-depth" type="number" min="1" max="16" step="1" value="6"></label>
      </div>
      <fieldset>
        <legend>Sigma A</legend>
        <div class="triple">
          <input id="sigma-a-r" type="number" min="0" step="0.05" value="0.1">
          <input id="sigma-a-g" type="number" min="0" step="0.05" value="0.12">
          <input id="sigma-a-b" type="number" min="0" step="0.05" value="0.16">
        </div>
      </fieldset>
      <fieldset>
        <legend>Sigma S</legend>
        <div class="triple">
          <input id="sigma-s-r" type="number" min="0" step="0.05" value="0.7">
          <input id="sigma-s-g" type="number" min="0" step="0.05" value="0.58">
          <input id="sigma-s-b" type="number" min="0" step="0.05" value="0.44">
        </div>
      </fieldset>
      <dl id="volume-info" class="info">
        <div><dt>Volume</dt><dd>No file loaded</dd></div>
        <div><dt>Density</dt><dd>Using built-in test sphere</dd></div>
      </dl>
    </aside>
  </main>
`

const canvas = byId<HTMLCanvasElement>('render-canvas')
const statusEl = byId<HTMLElement>('status')
const sampleCountEl = byId<HTMLElement>('sample-count')
const volumeInfoEl = byId<HTMLElement>('volume-info')
const fileInput = byId<HTMLInputElement>('file')
const resetButton = byId<HTMLButtonElement>('reset')

let renderer: VolumeRenderer | null = null
let sourceVolume: ScalarVolume | null = null
let volumeModules: {
  createDensityVolume: typeof import('./pbr/density').createDensityVolume
  buildMajorantGrid: typeof import('./pbr/majorantGrid').buildMajorantGrid
} | null = null

const controls = [
  'window-min',
  'window-max',
  'scale',
  'g',
  'max-depth',
  'sigma-a-r',
  'sigma-a-g',
  'sigma-a-b',
  'sigma-s-r',
  'sigma-s-g',
  'sigma-s-b',
].map((id) => byId<HTMLInputElement>(id))

void boot()

async function boot(): Promise<void> {
  try {
    const { VolumeRenderer } = await import('./pbr/renderer')
    renderer = await VolumeRenderer.create(canvas)
    renderer.onError((message) => {
      statusEl.textContent = `WebGPU error: ${message}`
    })
    statusEl.textContent = 'WebGPU ready. Load a NIfTI file or inspect the test sphere.'
    await loadTestSphere()
    bindUi()
    requestAnimationFrame(frame)
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error)
  }
}

function bindUi(): void {
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file || !renderer) {
      return
    }

    try {
      statusEl.textContent = `Loading ${file.name}...`
      const { loadNiftiFile, scalarVolumeFromNiftiFile } = await import('./io/nifti')
      sourceVolume = scalarVolumeFromNiftiFile(await loadNiftiFile(file))
      setWindowInputs(...valueRange(sourceVolume))
      await rebuildDensity()
      statusEl.textContent = `${file.name} loaded.`
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : String(error)
    }
  })

  for (const control of controls) {
    control.addEventListener('input', () => {
      if (control.id === 'window-min' || control.id === 'window-max') {
        void rebuildDensity()
      }
      renderer?.resetAccumulation()
    })
  }

  resetButton.addEventListener('click', () => renderer?.resetAccumulation())
  window.addEventListener('resize', () => renderer?.resetAccumulation())
}

function frame(): void {
  if (renderer) {
    sampleCountEl.textContent = `${renderer.render(readParams())} samples`
  }
  requestAnimationFrame(frame)
}

async function loadTestSphere(): Promise<void> {
  const dims: Vec3n = [96, 96, 96]
  const data = new Float32Array(dims[0] * dims[1] * dims[2])
  for (let z = 0; z < dims[2]; z += 1) {
    const nz = (z / (dims[2] - 1)) * 2 - 1
    for (let y = 0; y < dims[1]; y += 1) {
      const ny = (y / (dims[1] - 1)) * 2 - 1
      for (let x = 0; x < dims[0]; x += 1) {
        const nx = (x / (dims[0] - 1)) * 2 - 1
        const r = Math.hypot(nx * 1.1, ny, nz * 0.85)
        const shell = Math.max(0, 1 - Math.abs(r - 0.55) * 8)
        const core = Math.max(0, 1 - r * 1.5)
        data[x + dims[0] * (y + dims[1] * z)] = Math.max(shell * 0.85, core)
      }
    }
  }
  const indexToWorld = mat4.identity()
  sourceVolume = new ScalarVolume(dims, data, indexToWorld)
  await rebuildDensity()
}

async function rebuildDensity(): Promise<void> {
  if (!sourceVolume || !renderer) {
    return
  }

  const modules = await getVolumeModules()
  const density = modules.createDensityVolume(sourceVolume, {
    windowMin: readNumber('window-min'),
    windowMax: readNumber('window-max'),
    maxDim: 128,
  })
  const majorant = modules.buildMajorantGrid(density)
  renderer.setVolume(density, majorant)
  renderVolumeInfo(sourceVolume, density.dims, majorant.globalMaxDensity)
}

async function getVolumeModules(): Promise<NonNullable<typeof volumeModules>> {
  if (!volumeModules) {
    const [density, majorant] = await Promise.all([
      import('./pbr/density'),
      import('./pbr/majorantGrid'),
    ])
    volumeModules = {
      createDensityVolume: density.createDensityVolume,
      buildMajorantGrid: majorant.buildMajorantGrid,
    }
  }
  return volumeModules
}

function readParams(): RendererParams {
  return {
    sigmaA: vec3.create(readNumber('sigma-a-r'), readNumber('sigma-a-g'), readNumber('sigma-a-b')),
    sigmaS: vec3.create(readNumber('sigma-s-r'), readNumber('sigma-s-g'), readNumber('sigma-s-b')),
    scale: readNumber('scale'),
    g: readNumber('g'),
    maxDepth: Math.max(1, Math.floor(readNumber('max-depth'))),
    environmentL: vec3.create(0.04, 0.05, 0.07),
  }
}

function renderVolumeInfo(volume: ScalarVolume, densityDims: Vec3n, majorantMax: number): void {
  const [min, max] = valueRange(volume)
  volumeInfoEl.innerHTML = `
    <div><dt>Volume</dt><dd>${volume.shape.join(' x ')}</dd></div>
    <div><dt>Intensity</dt><dd>${formatNumber(min)} to ${formatNumber(max)}</dd></div>
    <div><dt>Density</dt><dd>${densityDims.join(' x ')} / max ${formatNumber(majorantMax)}</dd></div>
  `
}

function valueRange(volume: ScalarVolume): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < volume.data.length; i += 1) {
    const value = volume.data[i]
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return [min, max]
}

function setWindowInputs(min: number, max: number): void {
  const range = max - min
  byId<HTMLInputElement>('window-min').value = formatInput(min + range * 0.1)
  byId<HTMLInputElement>('window-max').value = formatInput(max)
}

function readNumber(id: string): number {
  return Number.parseFloat(byId<HTMLInputElement>(id).value)
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'n/a'
}

function formatInput(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '0'
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing #${id}`)
  }
  return element as T
}
