# Section 1. Reference Notes

This section records the local reference points used for the v0.02 design.

The user-provided reference paths were interpreted as the local repositories
that exist in this workspace:

```text
C:\Users\rjuser\Documents\projects\segtool\cornerstone3D
C:\Users\rjuser\Documents\projects\segtool\Viewers
```

## Section 1.1 Cornerstone3D Tool Model

Cornerstone separates interaction into these concepts:

```text
registered tool classes
tool groups
viewports attached to tool groups
tool modes
mouse/touch/wheel event dispatchers
tool callbacks
tool-specific strategies
```

Important local files:

```text
cornerstone3D/packages/tools/src/store/ToolGroupManager/ToolGroup.ts
cornerstone3D/packages/tools/src/enums/ToolModes.ts
cornerstone3D/packages/tools/src/tools/base/BaseTool.ts
cornerstone3D/packages/tools/src/eventDispatchers/mouseToolEventDispatcher.ts
cornerstone3D/packages/tools/src/eventDispatchers/shared/getActiveToolForMouseEvent.ts
cornerstone3D/packages/tools/src/eventDispatchers/shared/customCallbackHandler.ts
```

The key design ideas to reuse are:

```text
ToolGroup
  -> owns tool instances/config for a set of viewports
  -> sets tools to Active, Passive, Enabled, or Disabled
  -> stores input bindings for active tools

ToolMode
  -> Active tools can react to matching input bindings
  -> Passive tools can observe or render without being the active manipulator
  -> Enabled tools are available without full event activation
  -> Disabled tools do not participate

Event dispatcher
  -> receives normalized framework events
  -> finds the active tool for this event
  -> calls the matching callback
```

Cornerstone tools also use strategy objects. This is useful for segmentation:
a brush tool can stay stable while the actual operation changes between circle,
sphere, threshold circle, threshold sphere, erase, or preview.

## Section 1.2 Cornerstone3D Segmentation Editing

Important local files:

```text
cornerstone3D/packages/tools/src/tools/segmentation/BrushTool.ts
cornerstone3D/packages/tools/src/tools/segmentation/LabelmapBaseTool.ts
cornerstone3D/packages/tools/src/tools/segmentation/strategies/BrushStrategy.ts
cornerstone3D/packages/tools/src/stateManagement/segmentation/labelmapModel/labelmapEditTransaction.ts
```

Relevant ideas:

```text
operation data is assembled before a brush strategy runs
preview state is separate from committed labelmap edits
brush operations can return modified data
labelmap edits are tracked as transactions/memos
modified slices or regions are used to update rendering efficiently
```

v0.02 should not copy this entire system, but it should preserve the same
separation:

```text
tool gesture
  -> operation data
  -> segmentation edit command
  -> labelmap mutation transaction
  -> dirty region
  -> renderer invalidation
```

## Section 1.3 OHIF Tool And Command Model

OHIF builds application UX above Cornerstone tools. It keeps toolbar selection,
commands, services, and viewport tool groups separate.

Important local files:

```text
Viewers/extensions/cornerstone/src/services/ToolGroupService/ToolGroupService.ts
Viewers/platform/core/src/classes/CommandsManager.ts
Viewers/platform/core/src/services/ToolBarService/ToolbarService.ts
Viewers/modes/segmentation/src/initToolGroups.ts
Viewers/modes/segmentation/src/toolbarButtons.ts
Viewers/extensions/cornerstone/src/commandsModule.ts
```

The key design ideas to reuse are:

```text
Toolbar
  -> declares UI buttons and their command payloads
  -> does not directly process pointer events

CommandsManager
  -> runs named commands in a context
  -> decouples UI components from implementation objects

ToolGroupService
  -> creates tool groups
  -> adds viewports to tool groups
  -> sets tool modes and active bindings
```

For this MVP renderer, a smaller version is enough. We need typed local
commands and a tool group service, not a full extension/mode/plugin runtime.

