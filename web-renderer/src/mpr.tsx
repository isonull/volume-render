import './style.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandDispatcher } from './commands/commandDispatcher'
import {
  CENTER_VOLUME_COMMAND,
  SET_MPR_RENDER_STATE_COMMAND,
  SET_OVERLAY_SEGMENTATION_COMMAND,
  createMprCommands,
} from './commands/mprCommands'
import {
  CLOSE_SEGMENTATION_COMMAND,
  CLOSE_VOLUME_COMMAND,
  OPEN_SEGMENTATION_COMMAND,
  OPEN_VOLUME_COMMAND,
  createSceneCommands,
} from './commands/sceneCommands'
import { createSegmentationCommands } from './commands/segmentationCommands'
import { MprRenderer } from './mpr/mprRenderer'
import { createInitialMprState, valueRange } from './mpr/mprState'
import { canvasToWorld, isVoxelInBounds, worldToIndex } from './mpr/mprMath'
import { RenderService } from './services/renderService'
import { SceneService } from './services/sceneService'
import { SegmentationService } from './services/segmentationService'
import { ViewportService } from './services/viewportService'
import { InputRouter } from './tools/inputRouter'
import { PanTool, ProbeTool, SegmentationBrushTool, StackScrollTool, WindowLevelTool, ZoomTool } from './tools/mprTools'
import { ToolController } from './tools/toolController'
import { ToolGroupService } from './tools/toolGroupService'
import { ToolRegistry } from './tools/toolRegistry'
import type { Scene } from './scene'
import type { MprOrientation, MprRenderState } from './mpr/mprState'
import type { Vec2n, Vec3, Vec3n } from 'wgpu-matrix'
import type { ScalarVolume } from './volume'
import type { MouseEvent } from 'react'
import type { LabelmapSegmentationData } from './segmentation'

const VIEWPORTS: { id: MprOrientation; label: string }[] = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
]

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false }
const MPR_TOOL_GROUP_ID = 'mpr'

type InteractionMode = 'navigate' | 'brush' | 'erase'

type SceneBrowserItem =
  | { kind: 'volume'; id: string; label: string; shape: string; source?: string; segmentations: SceneBrowserItem[] }
  | { kind: 'segmentation'; id: string; label: string; sourceVolumeId: string; labels: string; dtype: string }

type ContextMenuState = {
  x: number
  y: number
  item: { kind: 'volume' | 'segmentation'; id: string }
}

type ProbeInfo = {
  viewportId: MprOrientation
  voxel: Vec3n
  world: string
  intensity: string
  inBounds: boolean
}

type BrushPreviewInfo = {
  viewportId: MprOrientation
  point: Vec2n
  radiusPx: number
  mode: 'paint' | 'erase'
  valid: boolean
}

function MprApp() {
  const canvasRefs = useRef(new Map<MprOrientation, HTMLCanvasElement>())
  const sceneServiceRef = useRef<SceneService | null>(null)
  const viewportServiceRef = useRef<ViewportService | null>(null)
  const renderServiceRef = useRef<RenderService | null>(null)
  const segmentationServiceRef = useRef<SegmentationService | null>(null)
  const toolGroupsRef = useRef<ToolGroupService | null>(null)
  const commandDispatcherRef = useRef<CommandDispatcher | null>(null)
  const inputRouterRef = useRef<InputRouter | null>(null)
  const activeVolumeRef = useRef<ScalarVolume | null>(null)
  const activeSegmentationIdRef = useRef<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const segmentationInputRef = useRef<HTMLInputElement | null>(null)
  const segmentationTargetVolumeIdRef = useRef<string | null>(null)
  const keyboardViewportIdRef = useRef<MprOrientation | null>(null)
  const windowMinRef = useRef('0')
  const windowMaxRef = useRef('0')

  const [status, setStatus] = useState('Initializing WebGPU...')
  const [sceneBrowserVersion, setSceneBrowserVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [probeInfo, setProbeInfo] = useState<ProbeInfo | null>(null)
  const [brushPreview, setBrushPreview] = useState<BrushPreviewInfo | null>(null)
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('navigate')
  const [brushRadiusMm, setBrushRadiusMmState] = useState(3)
  const [activeSegmentLabel, setActiveSegmentLabelState] = useState(1)

  const setWindowMin = useCallback((value: string) => {
    windowMinRef.current = value
  }, [])

  const setWindowMax = useCallback((value: string) => {
    windowMaxRef.current = value
  }, [])

  const setCanvasRef = useCallback((id: MprOrientation) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      canvasRefs.current.set(id, canvas)
    } else {
      canvasRefs.current.delete(id)
    }
  }, [])

  const currentState = useCallback((viewportId: MprOrientation): MprRenderState | null => {
    return viewportServiceRef.current?.renderStates.get(viewportId) ?? null
  }, [])

  const setToolInteractionMode = useCallback((mode: InteractionMode) => {
    const segmentationService = segmentationServiceRef.current
    const toolGroups = toolGroupsRef.current
    if (mode !== 'navigate' && !segmentationService?.getActiveSegmentationId()) {
      setStatus('Open a segmentation before using brush tools.')
      return
    }
    setInteractionMode(mode)
    setBrushPreview(null)
    if (mode === 'navigate') {
      toolGroups?.setToolMode(MPR_TOOL_GROUP_ID, 'mpr.pan', 'active')
      toolGroups?.setToolMode(MPR_TOOL_GROUP_ID, 'seg.brush', 'disabled')
      return
    }
    segmentationService?.setBrushMode(mode === 'erase' ? 'erase' : 'paint')
    toolGroups?.setToolMode(MPR_TOOL_GROUP_ID, 'mpr.pan', 'disabled')
    toolGroups?.setToolMode(MPR_TOOL_GROUP_ID, 'seg.brush', 'active')
  }, [])

  const setBrushRadiusMm = useCallback((radiusMm: number) => {
    const next = Math.max(0.25, Number(radiusMm.toFixed(2)))
    segmentationServiceRef.current?.setBrushRadiusMm(next)
    setBrushRadiusMmState(next)
  }, [])

  const setActiveSegmentLabel = useCallback((label: number) => {
    segmentationServiceRef.current?.setActiveSegmentLabel(label)
    setActiveSegmentLabelState(label)
  }, [])

  const resetView = useCallback((viewportId: MprOrientation) => {
    const viewportService = viewportServiceRef.current
    const commands = commandDispatcherRef.current
    const activeVolume = activeVolumeRef.current
    if (!viewportService || !commands || !activeVolume) {
      return
    }
    const viewport = viewportService.viewports.get(viewportId)
    if (!viewport) {
      return
    }
    viewport.resizeFromClient()
    const canvasPixels = Math.min(viewport.width, viewport.height)
    const state = createInitialMprState(activeVolume, viewportId, canvasPixels)
    const min = Number.parseFloat(windowMinRef.current)
    const max = Number.parseFloat(windowMaxRef.current)
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      state.image.windowMin = min
      state.image.windowMax = max
    }
    if (activeSegmentationIdRef.current) {
      state.overlay = {
        segmentationId: activeSegmentationIdRef.current,
        visible: true,
      }
    }
    commands.execute(SET_MPR_RENDER_STATE_COMMAND, { viewportId, state })
  }, [])

  const centerVolume = useCallback((volumeId: string) => {
    const sceneService = sceneServiceRef.current
    const commands = commandDispatcherRef.current
    const volume = sceneService?.scene?.volumes.get(volumeId)
    if (!sceneService || !commands || !volume) {
      return
    }
    activeVolumeRef.current = volume
    const [min, max] = valueRange(volume)
    const range = max - min
    setWindowMin(formatInput(min + range * 0.05))
    setWindowMax(formatInput(max))
    commands.execute(CENTER_VOLUME_COMMAND, {
      volume,
      viewportIds: VIEWPORTS.map(viewport => viewport.id),
      activeSegmentationId: activeSegmentationIdRef.current,
      windowMin: min + range * 0.05,
      windowMax: max,
    })
    setStatus(`Centered ${volume.source?.uri ?? volume.id}.`)
  }, [setWindowMax, setWindowMin])

  const centerSceneItem = useCallback((item: ContextMenuState['item']) => {
    const scene = sceneServiceRef.current?.scene
    if (!scene) {
      return
    }
    if (item.kind === 'volume') {
      centerVolume(item.id)
      return
    }
    const segmentation = scene.segmentations.get(item.id)
    if (segmentation) {
      activeSegmentationIdRef.current = segmentation.id
      centerVolume(segmentation.sourceVolumeId)
    }
  }, [centerVolume])

  const openSegmentationForVolume = useCallback((volumeId: string) => {
    if (!sceneServiceRef.current?.scene?.volumes.has(volumeId)) {
      return
    }
    segmentationTargetVolumeIdRef.current = volumeId
    const input = segmentationInputRef.current
    if (input) {
      input.value = ''
      input.click()
    }
  }, [])

  const closeSceneItem = useCallback((item: ContextMenuState['item']) => {
    const commands = commandDispatcherRef.current
    if (!sceneServiceRef.current?.scene || !commands) {
      return
    }
    if (item.kind === 'volume') {
      const result = commands.execute<{ volumeId: string }, {
        volume: ScalarVolume
        removedSegmentationIds: string[]
        nextVolume: ScalarVolume | null
        sceneDestroyed: boolean
      }>(CLOSE_VOLUME_COMMAND, { volumeId: item.id })
      if (activeSegmentationIdRef.current && result.removedSegmentationIds.includes(activeSegmentationIdRef.current)) {
        activeSegmentationIdRef.current = null
        setToolInteractionMode('navigate')
      }
      if (result.nextVolume) {
        centerVolume(result.nextVolume.id)
      } else {
        activeVolumeRef.current = null
        activeSegmentationIdRef.current = null
        setProbeInfo(null)
        setBrushPreview(null)
        setToolInteractionMode('navigate')
      }
      setStatus(`Volume ${result.volume.source?.uri ?? result.volume.id} closed.`)
    } else {
      commands.execute(CLOSE_SEGMENTATION_COMMAND, { segmentationId: item.id })
      if (activeSegmentationIdRef.current === item.id) {
        activeSegmentationIdRef.current = null
        setToolInteractionMode('navigate')
        commands.execute(SET_OVERLAY_SEGMENTATION_COMMAND, { visible: false })
      }
      setStatus('Segmentation closed.')
    }
    setSceneBrowserVersion(version => version + 1)
  }, [centerVolume, setToolInteractionMode])

  const getWorldPoint = useCallback((viewportId: string, clientPoint: Vec2n): Vec3 | null => {
    const typedViewportId = viewportId as MprOrientation
    const viewportService = viewportServiceRef.current
    const state = currentState(typedViewportId)
    const viewport = viewportService?.viewports.get(typedViewportId)
    if (!viewportService || !state || !viewport) {
      return null
    }
    viewport.resizeFromClient()
    const canvasPoint = viewport.clientToCanvas(clientPoint)
    return canvasToWorld(canvasPoint, viewport.width, viewport.height, state)
  }, [currentState])

  const getBrushPreviewRadiusPx = useCallback((viewportId: string, radiusMm: number): number | null => {
    const state = currentState(viewportId as MprOrientation)
    const viewport = viewportServiceRef.current?.viewports.get(viewportId)
    if (!state || !viewport || !Number.isFinite(radiusMm) || radiusMm <= 0) {
      return null
    }
    return radiusMm / (state.plane.pixelSize * viewport.pixelRatio)
  }, [currentState])

  const updateBrushPreview = useCallback((preview: {
    viewportId: string
    clientPoint: Vec2n
    radiusPx: number
    mode: 'paint' | 'erase'
    valid: boolean
  } | null) => {
    if (!preview) {
      setBrushPreview(null)
      return
    }
    const viewportId = preview.viewportId as MprOrientation
    const viewport = viewportServiceRef.current?.viewports.get(viewportId)
    if (!viewport) {
      setBrushPreview(null)
      return
    }
    const rect = viewport.canvas.getBoundingClientRect()
    setBrushPreview({
      viewportId,
      point: [
        preview.clientPoint[0] - rect.left,
        preview.clientPoint[1] - rect.top,
      ],
      radiusPx: preview.radiusPx,
      mode: preview.mode,
      valid: preview.valid,
    })
  }, [])

  const updateProbeInfo = useCallback((viewportId: string, clientPoint: Vec2n) => {
    const typedViewportId = viewportId as MprOrientation
    const viewportService = viewportServiceRef.current
    const activeVolume = activeVolumeRef.current
    const world = getWorldPoint(viewportId, clientPoint)
    if (!viewportService || !activeVolume || !world) {
      setProbeInfo(null)
      return
    }

    const index = worldToIndex(world, activeVolume)
    const voxel: Vec3n = [
      Math.round(index[0]),
      Math.round(index[1]),
      Math.round(index[2]),
    ]
    const inBounds = isVoxelInBounds(voxel, activeVolume)
    setProbeInfo({
      viewportId: typedViewportId,
      voxel,
      world: Array.from(world, formatCoordinate).join(', '),
      intensity: inBounds ? formatIntensity(readVolumeVoxel(activeVolume, voxel)) : 'n/a',
      inBounds,
    })
  }, [getWorldPoint])

  const loadImageFile = useCallback(async (file: File | undefined) => {
    const commands = commandDispatcherRef.current
    if (!file || !commands) {
      return
    }

    try {
      setStatus(`Loading ${file.name}...`)
      const { loadNiftiFile, scalarVolumeFromNiftiFile } = await import('./io/nifti')
      const niftiFile = await loadNiftiFile(file)
      const volume = scalarVolumeFromNiftiFile(niftiFile, file.name)
      activeVolumeRef.current = volume
      activeSegmentationIdRef.current = null
      setProbeInfo(null)
      setBrushPreview(null)
      setToolInteractionMode('navigate')
      commands.execute(OPEN_VOLUME_COMMAND, { volume })
      setSceneBrowserVersion(version => version + 1)
      const [min, max] = valueRange(volume)
      const range = max - min
      setWindowMin(formatInput(min + range * 0.05))
      setWindowMax(formatInput(max))
      for (const viewport of VIEWPORTS) {
        resetView(viewport.id)
      }
      setStatus(`${file.name} loaded.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }, [resetView, setToolInteractionMode, setWindowMax, setWindowMin])

  const loadSegmentationFile = useCallback(async (file: File | undefined, sourceVolumeId?: string | null) => {
    const sceneService = sceneServiceRef.current
    const commands = commandDispatcherRef.current
    if (!file || !sceneService || !commands) {
      return
    }
    const activeVolume = sourceVolumeId
      ? sceneService.scene?.volumes.get(sourceVolumeId) ?? null
      : activeVolumeRef.current
    if (!activeVolume) {
      setStatus('Choose a source volume before loading a segmentation.')
      return
    }

    try {
      setStatus(`Loading segmentation ${file.name}...`)
      const { labelmapSegmentationFromNiftiFile, loadNiftiFile } = await import('./io/nifti')
      const niftiFile = await loadNiftiFile(file)
      const segmentation = labelmapSegmentationFromNiftiFile(niftiFile, activeVolume, file.name)
      commands.execute<{ segmentation: LabelmapSegmentationData }, void>(OPEN_SEGMENTATION_COMMAND, { segmentation })
      setSceneBrowserVersion(version => version + 1)
      activeSegmentationIdRef.current = segmentation.id
      activeVolumeRef.current = activeVolume
      setActiveSegmentLabel(firstEditableLabel(segmentation))
      commands.execute(SET_OVERLAY_SEGMENTATION_COMMAND, {
        segmentationId: segmentation.id,
        sourceVolumeId: activeVolume.id,
        visible: true,
      })
      setStatus(`Segmentation ${file.name} loaded for ${activeVolume.source?.uri ?? activeVolume.id}.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let renderer: MprRenderer | null = null
    let sceneService: SceneService | null = null
    let viewportService: ViewportService | null = null
    let renderService: RenderService | null = null
    let segmentationService: SegmentationService | null = null

    async function boot(): Promise<void> {
      try {
        renderer = await MprRenderer.create()
        if (cancelled) {
          renderer.destroy()
          return
        }
        sceneService = new SceneService()
        viewportService = new ViewportService(renderer.device, renderer.format)
        renderService = new RenderService(renderer, sceneService, viewportService)
        segmentationService = new SegmentationService(sceneService)
        sceneServiceRef.current = sceneService
        viewportServiceRef.current = viewportService
        renderServiceRef.current = renderService
        segmentationServiceRef.current = segmentationService
        segmentationService.setBrushRadiusMm(3)
        const commandDispatcher = new CommandDispatcher({
          sceneService,
          viewportService,
          renderService,
          segmentationService,
        })
        for (const command of [...createSceneCommands(), ...createMprCommands(), ...createSegmentationCommands()]) {
          commandDispatcher.register(command)
        }
        commandDispatcherRef.current = commandDispatcher
        const toolRegistry = createToolRegistry()
        const toolGroups = createDefaultToolGroups(toolRegistry)
        toolGroupsRef.current = toolGroups
        inputRouterRef.current = new InputRouter(new ToolController({
          commands: commandDispatcher,
          getActiveVolume: () => activeVolumeRef.current,
          getBrushState: () => {
            const service = segmentationServiceRef.current
            const segmentationId = service?.getActiveSegmentationId()
            if (!service || !segmentationId) {
              return null
            }
            return {
              segmentationId,
              label: service.getActiveSegmentLabel(),
              mode: service.getBrushMode(),
              radiusMm: service.getBrushRadiusMm(),
            }
          },
          getWorldPoint,
          getBrushPreviewRadiusPx,
          onBrushPreviewChanged: updateBrushPreview,
          onCursorMove: updateProbeInfo,
          onCursorLeave: () => setProbeInfo(null),
          onWindowLevelChanged: state => {
            setWindowMin(formatInput(state.image.windowMin))
            setWindowMax(formatInput(state.image.windowMax))
          },
        }, toolGroups))
        for (const viewport of VIEWPORTS) {
          const canvas = canvasRefs.current.get(viewport.id)
          if (!canvas) {
            throw new Error(`Missing ${viewport.label} canvas.`)
          }
          viewportService.createViewport(canvas, viewport.id)
          toolGroups.addViewport('mpr', viewport.id)
        }
        setStatus('WebGPU ready. Load a NIfTI scalar volume.')
      } catch (error) {
        setStatus(errorMessage(error))
      }
    }

    void boot()

    return () => {
      cancelled = true
      renderServiceRef.current = null
      viewportServiceRef.current = null
      sceneServiceRef.current = null
      segmentationServiceRef.current = null
      toolGroupsRef.current = null
      commandDispatcherRef.current = null
      inputRouterRef.current = null
      renderService?.destroy()
      viewportService?.destroy()
      sceneService?.destroyScene()
      renderer?.destroy()
    }
  }, [getBrushPreviewRadiusPx, getWorldPoint, setWindowMax, setWindowMin, updateBrushPreview, updateProbeInfo])

  useEffect(() => {
    function handleResize(): void {
      const viewportService = viewportServiceRef.current
      const renderService = renderServiceRef.current
      if (!viewportService || !renderService) {
        return
      }
      for (const viewportId of viewportService.renderStates.keys()) {
        renderService.requestRender(viewportId)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const viewportId = keyboardViewportIdRef.current
      if (!viewportId || shouldIgnoreKeyboardEvent(event)) {
        return
      }
      inputRouterRef.current?.handleKeyDown(event, viewportId)
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const viewportId = keyboardViewportIdRef.current
      if (!viewportId || shouldIgnoreKeyboardEvent(event)) {
        return
      }
      inputRouterRef.current?.handleKeyUp(event, viewportId)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    function closeMenu(): void {
      setContextMenu(null)
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [contextMenu])

  const scene = sceneServiceRef.current?.scene ?? null
  const activeSegmentation = activeSegmentationIdRef.current
    ? scene?.segmentations.get(activeSegmentationIdRef.current) ?? null
    : null
  const editableLabels = activeSegmentation ? segmentLabelOptions(activeSegmentation, activeSegmentLabel) : []
  const sceneItems = createSceneBrowserItems(scene, sceneBrowserVersion)

  return (
    <main className="mpr-shell">
      <section className="mpr-grid" aria-label="Three direction MPR viewports">
        {VIEWPORTS.map(viewport => (
          <section className="mpr-viewport" data-viewport={viewport.id} key={viewport.id}>
            <canvas
              ref={setCanvasRef(viewport.id)}
              aria-label={`${viewport.label} MPR viewport`}
              onContextMenu={event => event.preventDefault()}
              onDoubleClick={() => resetView(viewport.id)}
              onPointerCancel={event => {
                keyboardViewportIdRef.current = viewport.id
                inputRouterRef.current?.handlePointerCancel(event.nativeEvent, viewport.id)
              }}
              onPointerDown={event => {
                if (!activeVolumeRef.current) {
                  return
                }
                keyboardViewportIdRef.current = viewport.id
                event.currentTarget.setPointerCapture(event.pointerId)
                inputRouterRef.current?.handlePointerDown(event.nativeEvent, viewport.id)
              }}
              onPointerMove={event => {
                keyboardViewportIdRef.current = viewport.id
                inputRouterRef.current?.handlePointerMove(event.nativeEvent, viewport.id)
              }}
              onPointerUp={event => {
                keyboardViewportIdRef.current = viewport.id
                inputRouterRef.current?.handlePointerUp(event.nativeEvent, viewport.id)
              }}
              onPointerLeave={() => {
                inputRouterRef.current?.clearHover()
                setBrushPreview(null)
              }}
              onWheel={event => {
                if (!activeVolumeRef.current) {
                  return
                }
                keyboardViewportIdRef.current = viewport.id
                event.preventDefault()
                inputRouterRef.current?.handleWheel(event.nativeEvent, viewport.id)
              }}
            />
            <div className="viewport-label">{viewport.label}</div>
            {brushPreview?.viewportId === viewport.id ? <BrushPreviewOverlay brushPreview={brushPreview} /> : null}
            {probeInfo?.viewportId === viewport.id ? <ProbeOverlay probeInfo={probeInfo} /> : null}
          </section>
        ))}
        <section className="mpr-empty" aria-label="Empty viewport slot" />
      </section>
      <aside className="controls">
        <div className="title-block">
          <h1>NIfTI MPR</h1>
          <p>{status}</p>
        </div>
        <div className="file-actions">
          <button
            type="button"
            onClick={() => {
              const input = imageInputRef.current
              if (input) {
                input.value = ''
                input.click()
              }
            }}
          >
            Open Volume
          </button>
          <input
            ref={imageInputRef}
            className="hidden-file-input"
            type="file"
            accept=".nii,.nii.gz"
            onChange={event => {
              void loadImageFile(event.currentTarget.files?.[0])
            }}
          />
          <input
            ref={segmentationInputRef}
            className="hidden-file-input"
            type="file"
            accept=".nii,.nii.gz"
            onChange={event => {
              void loadSegmentationFile(event.currentTarget.files?.[0], segmentationTargetVolumeIdRef.current)
              segmentationTargetVolumeIdRef.current = null
            }}
          />
        </div>
        {activeSegmentation ? (
          <section className="segmentation-tools" aria-label="Segmentation tools">
            <h2>Segmentation</h2>
            <div className="segmented-control" role="group" aria-label="Interaction mode">
              <button
                type="button"
                className={interactionMode === 'navigate' ? 'active' : ''}
                onClick={() => setToolInteractionMode('navigate')}
              >
                Navigate
              </button>
              <button
                type="button"
                className={interactionMode === 'brush' ? 'active' : ''}
                onClick={() => setToolInteractionMode('brush')}
              >
                Brush
              </button>
              <button
                type="button"
                className={interactionMode === 'erase' ? 'active' : ''}
                onClick={() => setToolInteractionMode('erase')}
              >
                Erase
              </button>
            </div>
            <label className="tool-field">
              Label
              <select
                value={activeSegmentLabel}
                onChange={event => setActiveSegmentLabel(Number(event.currentTarget.value))}
              >
                {editableLabels.map(label => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </label>
            <div className="tool-field">
              <span>Radius</span>
              <div className="stepper">
                <button type="button" onClick={() => setBrushRadiusMm(brushRadiusMm - 0.5)}>-</button>
                <output>{`${brushRadiusMm.toFixed(1)} mm`}</output>
                <button type="button" onClick={() => setBrushRadiusMm(brushRadiusMm + 0.5)}>+</button>
              </div>
            </div>
          </section>
        ) : null}
        <section className="scene-browser" aria-label="Scene browser">
          <h2>Scene</h2>
          {sceneItems.length === 0 ? (
            <p>No volumes loaded</p>
          ) : (
            <ul>
              {sceneItems.map(item => (
                <SceneBrowserNode
                  item={item}
                  key={item.id}
                  onContextMenu={(event, menuItem) => {
                    event.preventDefault()
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      item: menuItem,
                    })
                  }}
                />
              ))}
            </ul>
          )}
        </section>
        {contextMenu ? (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                centerSceneItem(contextMenu.item)
                setContextMenu(null)
              }}
            >
              Center
            </button>
            {contextMenu.item.kind === 'volume' ? (
              <button
                type="button"
                onClick={() => {
                  openSegmentationForVolume(contextMenu.item.id)
                  setContextMenu(null)
                }}
              >
                Open Segmentation
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                closeSceneItem(contextMenu.item)
                setContextMenu(null)
              }}
            >
              Close
            </button>
          </div>
        ) : null}
      </aside>
    </main>
  )
}

function SceneBrowserNode({
  item,
  onContextMenu,
}: {
  item: SceneBrowserItem
  onContextMenu: (event: MouseEvent, item: ContextMenuState['item']) => void
}) {
  if (item.kind === 'segmentation') {
    return (
      <li>
        <button
          type="button"
          className="scene-item scene-item-segmentation"
          onContextMenu={event => onContextMenu(event, { kind: 'segmentation', id: item.id })}
        >
          <span>{item.label}</span>
          <small>{`${item.labels} · ${item.dtype}`}</small>
        </button>
      </li>
    )
  }

  return (
    <li>
      <details open>
        <summary
          className="scene-item scene-item-volume"
          onContextMenu={event => onContextMenu(event, { kind: 'volume', id: item.id })}
        >
          <span>{item.label}</span>
          <small>{item.shape}</small>
        </summary>
        {item.segmentations.length > 0 ? (
          <ul>
            {item.segmentations.map(segmentation => (
              <SceneBrowserNode item={segmentation} key={segmentation.id} onContextMenu={onContextMenu} />
            ))}
          </ul>
        ) : null}
      </details>
    </li>
  )
}

function ProbeOverlay({ probeInfo }: { probeInfo: ProbeInfo }) {
  return (
    <dl className="probe-overlay">
      <div>
        <dt>IJK</dt>
        <dd>{probeInfo.voxel.map(value => String(value)).join(', ')}</dd>
      </div>
      <div>
        <dt>XYZ</dt>
        <dd>{`${probeInfo.world}${probeInfo.inBounds ? '' : ' outside'}`}</dd>
      </div>
      <div>
        <dt>I</dt>
        <dd>{probeInfo.intensity}</dd>
      </div>
    </dl>
  )
}

function BrushPreviewOverlay({ brushPreview }: { brushPreview: BrushPreviewInfo }) {
  const diameter = Math.max(2, brushPreview.radiusPx * 2)
  const className = [
    'brush-preview',
    brushPreview.mode === 'erase' ? 'erase' : 'paint',
    brushPreview.valid ? '' : 'invalid',
  ].filter(Boolean).join(' ')
  return (
    <div
      className={className}
      style={{
        width: diameter,
        height: diameter,
        left: brushPreview.point[0] - brushPreview.radiusPx,
        top: brushPreview.point[1] - brushPreview.radiusPx,
      }}
    />
  )
}

function firstEditableLabel(segmentation: LabelmapSegmentationData): number {
  const labels = [...segmentation.segments.keys()].filter(label => label > 0).sort((a, b) => a - b)
  return labels[0] ?? 1
}

function segmentLabelOptions(segmentation: LabelmapSegmentationData, activeLabel: number): number[] {
  const labels = new Set<number>([activeLabel])
  for (const label of segmentation.segments.keys()) {
    if (label > 0) {
      labels.add(label)
    }
  }
  return [...labels].sort((a, b) => a - b)
}

function createSceneBrowserItems(scene: Scene | null, _version: number): SceneBrowserItem[] {
  if (!scene) {
    return []
  }
  return [...scene.volumes.values()].map(volume => {
    const segmentations: SceneBrowserItem[] = [...scene.segmentations.values()]
      .filter(segmentation => segmentation.sourceVolumeId === volume.id)
      .map(segmentation => ({
        kind: 'segmentation',
        id: segmentation.id,
        label: segmentation.id,
        sourceVolumeId: segmentation.sourceVolumeId,
        labels: segmentation.segments.size === 0 ? 'background only' : `${segmentation.segments.size} labels`,
        dtype: segmentation.data.constructor.name,
      }))

    return {
      kind: 'volume',
      id: volume.id,
      label: volume.source?.uri ?? volume.id,
      source: volume.source?.uri,
      shape: volume.shape.join(' x '),
      segmentations,
    }
  })
}

function formatInput(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '0'
}

function shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a'
}

function formatIntensity(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'n/a'
}

function readVolumeVoxel(volume: ScalarVolume, voxel: Vec3n): number {
  const [x, y, z] = voxel
  return volume.data[x + volume.shape[0] * (y + volume.shape[1] * z)]
}

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({ id: 'mpr.pan', create: () => new PanTool() })
  registry.register({ id: 'mpr.windowLevel', create: () => new WindowLevelTool() })
  registry.register({ id: 'mpr.stackScroll', create: () => new StackScrollTool() })
  registry.register({ id: 'mpr.zoom', create: () => new ZoomTool() })
  registry.register({ id: 'mpr.probe', create: () => new ProbeTool() })
  registry.register({ id: 'seg.brush', create: () => new SegmentationBrushTool() })
  return registry
}

function createDefaultToolGroups(registry: ToolRegistry): ToolGroupService {
  const toolGroups = new ToolGroupService(registry)
  toolGroups.createToolGroup(MPR_TOOL_GROUP_ID)
  toolGroups.addTool(MPR_TOOL_GROUP_ID, 'mpr.pan', {
    mode: 'active',
    bindings: [{ kind: 'drag', button: 0, modifiers: NO_MODIFIERS }],
  })
  toolGroups.addTool(MPR_TOOL_GROUP_ID, 'mpr.windowLevel', {
    mode: 'active',
    bindings: [
      { kind: 'drag', button: 0, modifiers: { ...NO_MODIFIERS, shift: true } },
      { kind: 'drag', button: 2, modifiers: NO_MODIFIERS },
    ],
  })
  toolGroups.addTool(MPR_TOOL_GROUP_ID, 'mpr.stackScroll', {
    mode: 'active',
    bindings: [{ kind: 'wheel', modifiers: NO_MODIFIERS }],
  })
  toolGroups.addTool(MPR_TOOL_GROUP_ID, 'mpr.zoom', {
    mode: 'active',
    bindings: [{ kind: 'wheel', modifiers: { ...NO_MODIFIERS, ctrl: true } }],
  })
  toolGroups.addTool(MPR_TOOL_GROUP_ID, 'mpr.probe', {
    mode: 'passive',
    bindings: [{ kind: 'hover' }],
  })
  toolGroups.addTool(MPR_TOOL_GROUP_ID, 'seg.brush', {
    mode: 'disabled',
    bindings: [
      { kind: 'drag', button: 0, modifiers: NO_MODIFIERS },
      { kind: 'hover' },
    ],
  })
  return toolGroups
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('Missing #app root.')
}

createRoot(app).render(<MprApp />)
