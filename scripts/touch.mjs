/**
 * touch.mjs — the touch interactions the SWSE sheets do not get for free.
 *
 * WHAT ALREADY WORKS ON TOUCH (verified, therefore not reimplemented)
 * ------------------------------------------------------------------
 * - Plain `click` handlers.  The SWSE sheet binds almost everything with jQuery `.on("click")`
 *   (swse/module/actor/actor-sheet.mjs:171-280) and a tap synthesises a `click` in every
 *   browser.  `span.text-box` click-to-edit, `.rollable`, `.item-control`, the tab strip and
 *   the condition radios are all in this category.
 * - The historical 300 ms tap delay.  Chromium and WebKit both drop it when the page declares
 *   a viewport, and Foundry's game view does:
 *   `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0,
 *   user-scalable=no">` (fvtt14/resources/app/templates/views/layouts/main.hbs:6).
 * - ApplicationV1 window dragging.  `foundry.applications.ux.Draggable` uses pointer events
 *   (client/applications/ux/draggable.mjs:108-138), which touch delivers.
 *
 * WHAT DOES NOT WORK, AND WHAT THIS FILE DOES ABOUT IT
 * ---------------------------------------------------
 * 1. Context menus.  The sheet builds two of them —
 *      new ContextMenu(html[0], ".numeric-override", numericOverrideOptions(...))
 *      new ContextMenu(html[0], ".attack-button", attackOptions(...))
 *    (actor-sheet.mjs:177,182) — and `foundry.applications.ux.ContextMenu` listens for the
 *    `contextmenu` event (client/applications/ux/context-menu.mjs:75,108).  A finger never
 *    produces one on iOS, and core additionally calls `preventDefault()` on every
 *    `contextmenu` at the document level (client/game.mjs:2137).  Result: on a touch device
 *    the numeric overrides and the "Attack or Add Macro with options" menu are unreachable.
 *    Fixed here by recognising a long press and *dispatching the very same
 *    `contextmenu` event* the system's own menu is already listening for.  No handler is
 *    duplicated — the module only produces the event.
 *
 * 2. Hover-only affordances.  Handled in CSS (`:active` rules); nothing to do here.
 *
 * 3. HTML5 drag & drop.  `foundry.applications.ux.DragDrop` sets `draggable="true"` and binds
 *    `dragstart`/`drop` (client/applications/ux/drag-drop.mjs:81-91); touch fires none of
 *    those.  Deliberately NOT shimmed — see README/report: a faithful shim has to fabricate a
 *    `DataTransfer`, and getting that wrong silently corrupts item moves.  The compact play
 *    view exists precisely so nothing at the table needs a drag.
 */

/** How long a finger must rest before it counts as a long press. Core uses 500 ms for canvas
 *  pings (client/canvas/interaction/mouse-handler.mjs:199), so the two agree. */
const LONG_PRESS_MS = 500;
/** Movement beyond this cancels the press — the user is scrolling, not holding. */
const SLOP_PX = 10;

/** Selectors that actually have a context menu on an SWSE sheet. */
const CONTEXT_TARGETS = ".numeric-override, .attack-button";

/** Diagnostics the test harness reads back; also useful in a real bug report. */
export const touchStats = {
  longPressStarted: 0,
  longPressCancelled: 0,
  contextMenuSynthesised: 0,
  suppressedClicks: 0,
  lastTarget: null
};

export function registerTouchSupport() {
  let timer = null;
  let origin = null;
  let target = null;
  let fired = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null; origin = null; target = null;
  };

  /**
   * Only ever act inside an SWSE application window.  The canvas has its own long-press
   * meaning (a ping, controls.mjs:252) and the sidebar has its own context menus which core
   * may one day handle itself; hijacking either would be a regression, not a fix.
   */
  const swseRoot = node => (node instanceof Element)
    ? node.closest(".app.swse, .application.swse, .swse.sheet")
    : null;

  document.addEventListener("touchstart", ev => {
    fired = false;
    clear();
    if (ev.touches.length !== 1) return;                       /* multi-touch is not a press */
    const t = ev.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!swseRoot(el)) return;
    const ctx = el?.closest?.(CONTEXT_TARGETS);
    if (!ctx) return;

    origin = { x: t.clientX, y: t.clientY };
    target = ctx;
    touchStats.longPressStarted++;
    timer = setTimeout(() => {
      if (!target || !origin) return;
      /*
       * Dispatch the real thing.  `PointerEvent` (not `MouseEvent`) because
       * ContextMenu##onActivate reads `event.clientX/clientY` and core's own handlers treat
       * it as a pointer event; `bubbles: true` because the menu is bound to the application
       * root by delegation, not to this element.
       */
      const evt = new PointerEvent("contextmenu", {
        bubbles: true, cancelable: true, composed: true,
        clientX: origin.x, clientY: origin.y,
        button: 2, buttons: 2, pointerType: "touch", isPrimary: true
      });
      const delivered = target.dispatchEvent(evt);
      touchStats.contextMenuSynthesised++;
      touchStats.lastTarget = target.className?.slice?.(0, 60) ?? null;
      fired = true;
      /* a long press must not also count as a tap */
      ev.preventDefault?.();
      clear();
      return delivered;
    }, LONG_PRESS_MS);
  }, { capture: true, passive: false });

  document.addEventListener("touchmove", ev => {
    if (!origin || !ev.touches.length) return;
    const t = ev.touches[0];
    if (Math.abs(t.clientX - origin.x) > SLOP_PX || Math.abs(t.clientY - origin.y) > SLOP_PX) {
      touchStats.longPressCancelled++;
      clear();
    }
  }, { capture: true, passive: true });

  document.addEventListener("touchend", () => clear(), { capture: true, passive: true });
  document.addEventListener("touchcancel", () => { touchStats.longPressCancelled++; clear(); },
    { capture: true, passive: true });

  /* Swallow the tap that the browser generates after a long press, so opening the context
   * menu does not simultaneously trigger the element's click handler. */
  document.addEventListener("click", ev => {
    if (!fired) return;
    fired = false;
    touchStats.suppressedClicks++;
    ev.stopPropagation();
    ev.preventDefault();
  }, { capture: true });
}
