# Section 5. Current Implementation

This section summarizes the current v0.03 code state.

## Section 5.1 Runtime Construction

The React entry still creates core runtime services:

```text
MprRenderer
SceneService
ViewportService
RenderService
SegmentationService
ToolRegistry
ToolGroupService
InteractionModeService
ExtensionServiceRegistry
RuntimeEventBus
CommandDispatcher
ExtensionHost
ToolController
InputRouter
```

Feature registration is delegated to extensions:

```text
createCoreExtension()
createNnInteractiveExtension()
```

## Section 5.2 Extension Contributions

Core extension:

```text
commands:
  scene commands
  MPR commands
  segmentation commands

tools:
  mpr.pan
  mpr.windowLevel
  mpr.stackScroll
  mpr.zoom
  mpr.probe
  seg.brush

interaction modes:
  core.navigate
  core.brush
  core.erase

panels:
  core.segmentation

tool panels:
  core.brushPanel

scene actions:
  Center
  New Segmentation
  Open Segmentation
  Close

segment actions:
  Brush
  Delete
```

nnInteractive extension:

```text
service:
  nninteractive.service

commands:
  nninteractive.testConnection
  nninteractive.startSession
  nninteractive.releaseSession
  nninteractive.addPositivePoint
  nninteractive.addNegativePoint
  nninteractive.addPositiveScribble
  nninteractive.addNegativeScribble
  nninteractive.resetInteractions
  nninteractive.undo

tools:
  nninteractive.positivePoint
  nninteractive.negativePoint
  nninteractive.positiveScribble
  nninteractive.negativeScribble

interaction modes:
  nninteractive.positivePoint
  nninteractive.negativePoint
  nninteractive.positiveScribble
  nninteractive.negativeScribble

tool panels:
  nninteractive.panel

segment actions:
  nnInteractive
```

## Section 5.3 Commands Added After v0.02

New or expanded command ids include:

```text
scene.createSegmentation
mpr.flipPlaneAxis
segmentation.replaceLabelmapRegion
segmentation.clearLabelmap
segmentation.upsertSegment
segmentation.deleteSegment
nninteractive.*
```

`Command.execute` supports synchronous and asynchronous results.

## Section 5.4 SegmentationService Additions

Segmentation service now supports:

```text
upsert segment metadata
delete segment metadata
clear one segment label from labelmap voxels
replace labelmap region
apply binary segment region with target label mapping
clear whole labelmap
```

These APIs support both local brush workflows and server prediction patch
application.

## Section 5.5 MPR Renderer State

MPR rendering still draws one volume and at most one segmentation overlay per
viewport.

`MprRenderState` has:

```text
image.volumeId
overlay.segmentationId
```

The `PreparedScene` may cache GPU resources for multiple volumes and multiple
segmentations, but each viewport render binds:

```text
one volume texture
zero or one labelmap texture
one label color buffer for the active overlay
```

## Section 5.6 Current UI Surface

Current UI surface after v0.03:

```text
Open Volume button
Open Segmentation file path
Scene browser
volume context menu:
  Center
  New Segmentation
  Open Segmentation
  Close
segmentation context menu:
  Center
  Close
Segmentation panel:
  active segmentation metadata
  segment list
  add segment
  segment context menu
Brush workflow panel
nnInteractive workflow panel
viewport labels
viewport flip buttons
viewport-local probe overlay
viewport-local brush preview overlay
status text
```

## Section 5.7 nnInteractive Session Semantics

Current nnInteractive session model:

```text
global singleton service
one active client/session
one target segmentation id
one target segment label
Exit Tool keeps session alive
Release Session closes server session
target change releases old session when necessary
app dispose releases session
volume removal releases session
```

## Section 5.8 Verification

Known verification performed during v0.03 work:

```text
npm run build
Standalone Python proxy sidecar and smoke path added
manual server smoke path documented
```

The dev server is intentionally not started by the agent in this workflow; the
developer starts it manually when needed.
