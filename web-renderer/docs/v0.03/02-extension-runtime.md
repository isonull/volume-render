# Section 2. Extension Runtime

v0.03 introduces a compile-time extension runtime.

The extension runtime is not a remote plugin system. Extensions are imported at
build time, activated in a deterministic order, and cleaned up when the app
unmounts.

## Section 2.1 Files

Implemented extension runtime files:

```text
src/extensions/types.ts
src/extensions/extensionHost.ts
src/extensions/serviceRegistry.ts
src/extensions/eventBus.ts
src/extensions/interactionModeService.ts
src/extensions/core/coreExtension.tsx
src/extensions/nninteractive/*
```

## Section 2.2 WebRendererExtension

`WebRendererExtension` is the compile-time extension manifest.

Supported contribution surfaces:

```text
commands
tools
services
panels
toolPanels
sceneActions
segmentActions
activate lifecycle hook
```

These contribution surfaces are first-party architecture. They are stable enough
for built-in compile-time extensions, but they are not a remote third-party
plugin API.

## Section 2.3 ExtensionHost

`ExtensionHost` owns extension activation and contribution collection.

Activation flow:

```text
register extension services
register extension tools
register extension commands
collect app panels
collect workflow tool panels
collect scene actions
collect segment actions
run activate hook
store disposables
```

Disposal flow:

```text
dispose activated extensions in reverse order
dispose contribution registrations
clear panels, tool panels, actions, and extension ids
```

## Section 2.4 ExtensionContext

`ExtensionContext` exposes controlled access to the runtime:

```text
core services
command dispatcher
tool registry
tool groups
extension service registry
runtime event bus
interaction mode service
app callbacks
```

App callbacks include:

```text
get/set active volume
get/set active segmentation
get/set active tool panel
get/set interaction mode
set status
invalidate UI
center volume
open segmentation for volume
close scene item
```

The context gives extensions enough power to contribute workflows without
letting them bypass the command and service boundaries.

## Section 2.5 Core Extension

The core extension now owns built-in contributions that were previously
registered directly by the entry point.

Core extension contributions:

```text
scene commands
MPR commands
segmentation commands
pan, window/level, stack scroll, zoom, probe, brush tools
Navigate, Brush, Erase interaction modes
Segmentation panel
Brush workflow tool panel
Scene actions: Center, New Segmentation, Open Segmentation, Close
Segment actions: Brush, Delete
```

The React entry still creates runtime services and viewports, but feature
registration moves into the extension runtime.

## Section 2.6 Runtime Event Bus

`RuntimeEventBus` provides lifecycle and synchronization events:

```text
app.dispose
scene.changed
volume.removed
segmentation.removed
activeVolume.changed
activeSegmentation.changed
interactionMode.changed
```

Extensions use these events to:

```text
release sessions on app dispose
release sessions when active volume is removed
update prompt tool modes when interaction mode changes
invalidate UI when extension service state changes
clear workflow panels when their target segmentation is removed
```

## Section 2.7 UI Contributions

v0.03 formalizes UI contribution surfaces:

```text
ExtensionPanelContribution
  Right-side app-level panel.

ExtensionToolPanelContribution
  Segment-scoped workflow panel.

SceneActionContribution
  Context menu action for a volume or whole segmentation.

SegmentActionContribution
  Context menu action for one segment label inside one segmentation.
```

This keeps the entry point and shell responsible for composition while keeping
workflow-specific logic inside extensions.

