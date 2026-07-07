# Section 3. nnInteractive Extension

v0.03 adds nnInteractive as the first server-backed workflow extension.

The integration is intentionally built on the extension runtime. It does not
directly modify MPR viewports, the renderer, or Scene data outside the existing
command/service/transaction path.

## Section 3.1 Files

Main nnInteractive files:

```text
src/extensions/nninteractive/nnInteractiveExtension.tsx
src/extensions/nninteractive/nnInteractiveService.ts
src/extensions/nninteractive/nnInteractiveClient.ts
src/extensions/nninteractive/nniaSerialization.ts
../nninteractive-proxy/nninteractive_proxy.py
../nninteractive-proxy/nninteractive_proxy_smoke.mjs
../nninteractive-proxy/requirements.txt
../nninteractive-proxy/scripts/*
docs/nninteractive_proxy.md
```

## Section 3.2 Service

`NnInteractiveService` owns long-lived nnInteractive state:

```text
server URL
API key
client
capabilities
active volume id
target segmentation id
target segment label
status
message
positive/negative point counts
positive/negative scribble counts
scribble support
preferred scribble thickness
undo support
codec availability
```

The service is a singleton for v0.03:

```text
one global nnInteractive client/session at a time
one active target segmentation/label at a time
```

Switching to another target segment releases the existing session when needed.
Exit from the panel does not release the session; Release Session does.

## Section 3.3 Commands

nnInteractive commands:

```text
nninteractive.testConnection
nninteractive.startSession
nninteractive.releaseSession
nninteractive.addPositivePoint
nninteractive.addNegativePoint
nninteractive.addPositiveScribble
nninteractive.addNegativeScribble
nninteractive.resetInteractions
nninteractive.undo
```

Command responsibilities:

```text
validate scene and target volume
validate active nnInteractive session
call NnInteractiveService
apply prediction patches through SegmentationService
emit scene changed events
request render invalidation through SceneChangeSet
```

## Section 3.4 Tools

nnInteractive tools:

```text
nninteractive.positivePoint
nninteractive.negativePoint
nninteractive.positiveScribble
nninteractive.negativeScribble
```

Point tool flow:

```text
click MPR viewport
  -> canvas/client point
  -> world point
  -> volume index
  -> rounded voxel IJK
  -> nnInteractive add point command
```

Scribble tool flow:

```text
drag MPR viewport
  -> collect voxel path
  -> create sparse mask on the relevant plane
  -> nnInteractive add scribble command
```

Tool activation is controlled through `InteractionModeService`, not by direct
DOM event wiring.

## Section 3.5 Segment-Scoped Entry

v0.03 moves nnInteractive entry to the segment context menu:

```text
Segmentation panel
  -> right click segment
  -> nnInteractive
  -> open nnInteractive tool panel for that segment
```

The target context is:

```text
segmentationId
sourceVolumeId
segmentLabel
```

This is important because nnInteractive server output is binary foreground and
background, while the local labelmap may contain many segment labels. v0.03 maps
server foreground to the selected target label.

## Section 3.6 Labelmap Patch Strategy

Prediction output is applied as dirty bbox patches.

Patch flow:

```text
server returns bbox + patch data
  -> command receives PredictionPatch
  -> SegmentationService.applyBinarySegmentRegion
  -> foreground values become target label
  -> background values clear only the target label
  -> SceneTransaction updateSegmentation(regions)
  -> RenderService invalidates dirty labelmap texture region
```

This avoids full labelmap rewrites and prevents nnInteractive from clearing
other labels in the same segmentation.

## Section 3.7 Same-Origin Raw Proxy

The browser does not directly depend on a JavaScript blosc2 implementation in
the fastest usable v0.03 path.

Instead, v0.03 provides a standalone sidecar:

```text
../nninteractive-proxy/nninteractive_proxy.py
```

The browser talks to the proxy using raw or easier-to-handle binary payloads.
The proxy talks to `nninteractive-server` using the NNIA + blosc2 format.

Proxy features:

```text
raw_set_image
raw_mask_interactions
raw_prediction_patches
```

Development scripts:

```text
npm run nninteractive:proxy
npm run nninteractive:proxy:build
npm run nninteractive:proxy:smoke
```

Vite proxy:

```text
/nninteractive -> http://127.0.0.1:1528
```

The raw proxy prevents CORS issues and centralizes NNIA/blosc2 compatibility in
Python, where the required codec is already available.

## Section 3.8 Supported Prompts

v0.03 supports:

```text
positive point
negative point
positive scribble
negative scribble
```

Not implemented in v0.03:

```text
bbox prompt
lasso prompt
multi-session prompt history
per-segment server session pool
```

## Section 3.9 Error Behavior

Expected error states:

```text
server unreachable
codec/proxy unavailable
server lacks scribble support
server busy or prediction in progress
target volume removed
target segmentation removed
session expired or released
```

The extension should show an unavailable or error state rather than silently
half-enabling prompt tools.
