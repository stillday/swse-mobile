# SWSE Mobile

Mobile and tablet support for the [Star Wars: Saga Edition](https://github.com/stillday/Foundry-VTT-StarWars-SagaEdition) system on Foundry VTT v14.

## Install

Paste into Foundry's *Install Module* dialog:

```
https://raw.githubusercontent.com/stillday/swse-mobile/main/module.json
```

## What it does

Foundry v14 ships essentially nothing for small screens. Its resolution check raises a permanent notification and gates nothing; there is no device detection anywhere in the client, and the one media query in the game view targets ApplicationV2, which the SWSE sheet is not.

This module makes the SWSE sheets usable by finger:

| measured, off → on | phone 390×844 | tablet 820×1180 | tablet 1180×820 |
|---|---|---|---|
| touch targets under 44 px | 201 → 0 of 386 | 210 → 0 | 210 → 0 |
| horizontal overflow | 377 px → 0 | 0 | 0 |
| clipped elements | 27 → 0 | 1 → 0 | 0 |
| tabs switchable by finger | 5 reachable → 10/10 | 10/10 | 10/10 |

It also suppresses the unclosable resolution banner, which occupied the upper half of a phone screen and whose text about zoom factors is wrong on every device with a pixel ratio above 1.

There is a compact play view for the table — hit points, defenses, condition track, attacks, skills. Reachable from the actor list context menu, and optionally as a window header button (default: touch devices only).

## Desktop is untouched

Every rule sits behind `(pointer: coarse)` or a `max-width`, and the stylesheet contains no `!important` — module styles land in `@layer modules`, which outranks the system's layer on precedence alone.

Verified rather than asserted: 16 300 elements × 37 computed properties compared at 1920×1080 with and without the module. Zero differences.

## Limitations

- **Drag and drop does not work by finger.** Proven, not assumed: `draggable` set, eight `touchmove` events, no `dragstart`. Deliberately not shimmed — a faulty shim has to fake a `DataTransfer`, and when it goes wrong it silently moves the wrong items. Equipping, reordering and dropping from a compendium stay desktop work.
- **Canvas panning and pinch zoom** remain mouse-only. Pinch is disabled in the core, panning is right-drag.
- **The core interface** is not fixable from a module. At 390 px the chat sits off-screen and the hotbar at x=−70, because Foundry computes those positions in JavaScript with fixed pixel offsets.
- **Tooltips** that exist only as a `title` attribute are unreachable without hover.
- Everything was measured with emulated touch in Chromium. No real iOS or Android device, and the on-screen keyboard could not be tested.
