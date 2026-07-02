# Index

This is the entry point for the Medical Rendering Framework architecture
documentation. The full content is split across the files listed below.

## Overview

The framework is intentionally not centered on any single renderer such as MPR.
For the first implementation, however, the scene model is deliberately narrow:
scalar volumes plus labelmap segmentations only.

The framework supports:

```text
3D scalar volumes
labelmap segmentations
labelmap overlays
multiple synchronized viewports
multiple rendering pipelines
explicit engine-managed resource lifetime
```

## Table of Contents

| File | Section | Topic |
|---|---|---|
| [01-overview.md](01-overview.md) | 1 | design goals; high-level model; core concepts |
| [02-scene.md](02-scene.md) | 2 | long-lived `Scene`; scalar volumes; labelmap segmentations; `SceneChangeSet`; fixed render order |
| [03-viewport.md](03-viewport.md) | 3 | `Viewport`; canvas-backed render target |
| [04-renderer.md](04-renderer.md) | 4 | `Renderer`; `RenderState`; `PreparedScene`; `PreparedResource`; `Pipeline`; render flow |
| [05-services-core.md](05-services-core.md) | 5 | `MedicalRenderingEngine`; core managers; `PreparedSceneCache`; picking |
| [06-interaction.md](06-interaction.md) | 6 | user input; tools; commands; render-state synchronization |

## Section Quick Reference

| Reference | File |
|---|---|
| Section 1 | [01-overview.md](01-overview.md) |
| Section 2 | [02-scene.md](02-scene.md) |
| Section 3 | [03-viewport.md](03-viewport.md) |
| Section 4 | [04-renderer.md](04-renderer.md) |
| Section 5 | [05-services-core.md](05-services-core.md) |
| Section 6 | [06-interaction.md](06-interaction.md) |
