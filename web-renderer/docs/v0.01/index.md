# Index

This is the entry point for the Medical Rendering Framework v0.01 architecture
plan. The full content is split across the files listed below.

## Overview

v0.01 keeps the v0.00 scalar-volume MPR viewer intact and adds the first
Scene-owned segmentation model. The goal is to make labelmap segmentation a
first-class CPU-side scene object, display it as an MPR overlay, and keep brush
editing, export, and undo/redo out of this step.

v0.01 plans for:

```text
NIfTI scalar volume input
3D scalar volumes
multiple volumes in one Scene
axial, sagittal, and coronal MPR viewports
MPR viewport interaction
direct `MprRenderState` updates
explicit engine-managed GPU resource lifetime
Scene-owned labelmap segmentation objects
source-volume-owned segmentation creation
strict segmentation shape/affine validation
segmentation dirty-region change events
renderer preparation invalidation for segmentation data
labelmap MPR overlay rendering
Scene browser with volume-level segmentation loading
```

## Table of Contents

| File | Section | Topic |
|---|---|---|
| [01-overview.md](01-overview.md) | 1 | v0.01 goal; segmentation scope; implementation flow; future extensions |
| [02-scene.md](02-scene.md) | 2 | long-lived `Scene`; scalar volumes; labelmap segmentations; `SceneChangeSet`; lifetime |
| [03-viewport.md](03-viewport.md) | 3 | `Viewport`; canvas-backed render target |
| [04-renderer.md](04-renderer.md) | 4 | `MprRenderer`; `MprRenderState`; segmentation preparation boundary; WebGPU render flow |
| [05-services-core.md](05-services-core.md) | 5 | `Engine`; render scheduling; picking; segmentation invalidation |
| [06-interaction.md](06-interaction.md) | 6 | user input; MPR viewport interaction; future segmentation tools |

## Section Quick Reference

| Reference | File |
|---|---|
| Section 1 | [01-overview.md](01-overview.md) |
| Section 2 | [02-scene.md](02-scene.md) |
| Section 3 | [03-viewport.md](03-viewport.md) |
| Section 4 | [04-renderer.md](04-renderer.md) |
| Section 5 | [05-services-core.md](05-services-core.md) |
| Section 6 | [06-interaction.md](06-interaction.md) |
