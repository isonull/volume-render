# Section 4. Experience Improvements

v0.03 includes several usability and workflow improvements that are not limited
to nnInteractive.

## Section 4.1 Segment List Workflow

The segmentation panel is no longer only a brush settings panel.

It now shows the active segmentation's segment list:

```text
active segmentation id
segment count
add segment control
segment rows with color, name, and label value
```

Segment row interactions:

```text
click
  -> set active segment label

right click
  -> Brush
  -> nnInteractive
  -> Delete
```

Add segment:

```text
click +
  -> input label value
  -> validate positive integer
  -> validate label does not already exist
  -> validate label fits labelmap dtype
  -> add segment metadata
```

Delete segment:

```text
delete segment metadata
clear voxels with that label to 0
emit dirty bbox regions
return to Navigate if the active workflow target was deleted
```

## Section 4.2 New Segmentation

Volume context menu now includes:

```text
New Segmentation
```

This creates a new empty labelmap segmentation for the selected volume with a
default segment:

```text
Label 1
```

The created segmentation becomes active and visible as the overlay.

The previous `Start nnInteractive` volume action was removed so nnInteractive
entry is consistently segment-scoped.

## Section 4.3 Workflow Tool Panels

Brush and nnInteractive workflow controls are no longer treated as unrelated
global controls.

Workflow entry:

```text
segment right click -> Brush
segment right click -> nnInteractive
```

Each workflow panel has an Exit path:

```text
Exit Tool -> core.navigate
```

For nnInteractive, Exit Tool only leaves the workflow UI and interaction mode.
It does not release the server session. Release Session is explicit.

## Section 4.4 Viewport Flip Buttons

Each MPR viewport has toolbar buttons for:

```text
flip horizontal
flip vertical
```

Implementation behavior:

```text
flip horizontal -> plane.right = -plane.right
flip vertical   -> plane.up = -plane.up
normal          -> derived by cross(right, up)
wheel slice direction follows the derived normal
```

This provides a practical way to correct orientation display issues without
modifying volume data, affine data, or segmentation data.

## Section 4.5 Browser Zoom Prevention

`ctrl + wheel` inside MPR canvas is used for MPR zoom.

v0.03 prevents the browser page zoom from also firing when `ctrl + wheel` occurs
inside MPR viewports.

Behavior:

```text
ctrl + wheel over MPR canvas
  -> prevent browser page zoom
  -> route event to ZoomTool
```

## Section 4.6 Large Volume WebGPU Limits

The WebGPU device request now negotiates a higher `maxBufferSize` when the
adapter supports it.

This addresses cases where dynamic upload staging buffers exceeded the default
256 MiB limit even though the adapter reported a larger supported limit.

Behavior:

```text
check adapter.limits.maxBufferSize
request higher maxBufferSize when available
keep within adapter-reported limit
```

## Section 4.7 MPR Tool Module Ownership

MPR-specific tools moved from:

```text
src/tools/mprTools.ts
```

to:

```text
src/mpr/mprTools.ts
```

Reason:

```text
generic tool framework owns input lifecycle and mode semantics
MPR module owns concrete MPR viewport tools and MPR math
```

## Section 4.8 ToolMode Semantics

Tool mode meanings are now documented:

| Mode | Meaning |
| ---- | ------- |
| `active` | Can create or execute the primary operation, edit existing objects, and render. |
| `passive` | Can edit existing objects and render, but cannot create new objects. |
| `enabled` | Can render only, without interaction. |
| `disabled` | Cannot render or interact. |

Current MPR tools mostly use modes for input routing, but the vocabulary is now
aligned with future annotation, measurement, overlay, and workflow tools.

