# Index

This is the entry point for the Medical Rendering Framework v0.03
implementation notes.

v0.03 builds on v0.02 by turning the tool/command/service architecture into a
compile-time extension runtime, then using that runtime to integrate the first
external workflow: nnInteractive positive/negative point and scribble
segmentation.

v0.03 currently includes:

```text
compile-time ExtensionHost
WebRendererExtension manifest
ExtensionContext with commands, tools, services, events, interaction modes, and app callbacks
ExtensionServiceRegistry for extension-owned runtime services
RuntimeEventBus for app, scene, active volume, active segmentation, and interaction mode events
core extension containing built-in MPR, scene, and segmentation capabilities
nnInteractive extension with service, commands, tools, segment action, and tool panel
same-origin Python raw proxy for NNIA + blosc2 conversion
point prompts and scribble prompts
dirty bbox patch application into labelmap regions
segment-scoped workflow entry from the segmentation panel
segment list, add segment, delete segment, brush workflow panel
viewport-local flip horizontal and flip vertical buttons
ctrl+wheel browser zoom prevention inside MPR canvases
large WebGPU buffer limit negotiation
MPR-specific tools moved under the MPR module
ToolMode semantics documented
extension UI contribution surface formalized
```

Deferred beyond v0.03:

```text
multi-session nnInteractive pool
remote/dynamic plugin runtime
formal VS Code-style workbench UI implementation
command history and undo/redo
multi-segmentation overlay rendering in one viewport
renderer, shader, IO format, and persistent data model extension points
full annotation framework
```

## Table of Contents

| File | Section | Topic |
| ---- | ------- | ----- |
| [01-summary.md](01-summary.md) | 1 | v0.03 scope and implementation summary |
| [02-extension-runtime.md](02-extension-runtime.md) | 2 | extension host, context, services, events, and contribution types |
| [03-nninteractive.md](03-nninteractive.md) | 3 | nnInteractive plugin, proxy, prompts, sessions, and labelmap patches |
| [04-experience-improvements.md](04-experience-improvements.md) | 4 | UI and interaction improvements after v0.02 |
| [05-current-implementation.md](05-current-implementation.md) | 5 | current v0.03 code structure and status |

