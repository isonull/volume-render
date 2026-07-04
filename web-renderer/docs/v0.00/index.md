# Index

This is the entry point for the Medical Rendering Framework architecture
documentation. The full content is split across the files listed below.

## Overview

The MVP is centered on one complete scalar-volume viewing loop: load one NIfTI
volume, create one `Scene`, and render the volume in three orthogonal MPR
viewports. Broader rendering-framework and editing concepts should stay out of
the first implementation until they are needed.

The MVP supports:

```text
NIfTI scalar volume input
3D scalar volumes
axial, sagittal, and coronal MPR viewports
MPR viewport interaction
direct `MprRenderState` updates
explicit engine-managed GPU resource lifetime
```

## Table of Contents

| File | Section | Topic |
|---|---|---|
| [01-overview.md](01-overview.md) | 1 | MVP goal; core concepts; implementation flow; future extensions |
| [02-scene.md](02-scene.md) | 2 | long-lived `Scene`; NIfTI-derived scalar volumes; `SceneChangeSet`; lifetime |
| [03-viewport.md](03-viewport.md) | 3 | `Viewport`; canvas-backed render target |
| [04-renderer.md](04-renderer.md) | 4 | `MprRenderer`; `MprRenderState`; `PreparedScene`; WebGPU render flow |
| [05-services-core.md](05-services-core.md) | 5 | MVP `Engine`; render scheduling; picking |
| [06-interaction.md](06-interaction.md) | 6 | user input; MPR viewport interaction; direct render-state updates |

## Section Quick Reference

| Reference | File |
|---|---|
| Section 1 | [01-overview.md](01-overview.md) |
| Section 2 | [02-scene.md](02-scene.md) |
| Section 3 | [03-viewport.md](03-viewport.md) |
| Section 4 | [04-renderer.md](04-renderer.md) |
| Section 5 | [05-services-core.md](05-services-core.md) |
| Section 6 | [06-interaction.md](06-interaction.md) |
