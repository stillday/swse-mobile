/**
 * window-fit.mjs — keep SWSE sheet windows inside the screen.
 *
 * WHAT CORE ALREADY DOES (measured, so we do not rebuild it)
 * ---------------------------------------------------------
 * `foundry.appv1.api.Application#setPosition`
 * (fvtt14/resources/app/client/appv1/api/application-v1.mjs:943) already clamps an
 * ApplicationV1 window to the viewport:
 *
 *     const maxW = el.style.maxWidth || (window.innerWidth / scale);
 *     currentPosition.width = width = Math.clamp(tarW, minW, maxW);
 *     ...
 *     const maxL = Math.max(window.innerWidth - scaledWidth, 0);
 *     currentPosition.left = left = Math.clamp(tarL, 0, maxL);
 *
 * and the same for height/top.  Measured on this world: the SWSE character sheet declares
 * `width: 1000, height: 900` (swse/module/actor/actor-sheet.mjs:120) and still came up as
 * 390x844 at (0,0) on a 390x844 viewport and 820x900 at (0,140) on 820x1180.  So there is
 * nothing to fix at first render.
 *
 * WHAT CORE DOES NOT DO — and this is the gap worth closing
 * --------------------------------------------------------
 * The clamps sit behind `if ( !el.style.width || width )` and `if ( !el.style.height ||
 * height )`.  Once the element carries an inline width, a later `setPosition()` with no
 * arguments re-clamps nothing.  Core calls `setPosition(this.position)` on re-render
 * (application-v1.mjs:452) but registers no `resize` listener for V1 windows at all, so:
 *
 *   - rotating a tablet from 1180x820 to 820x1180 leaves a 1000px-wide sheet on an 820px
 *     screen — 180px of it unreachable, because `.window-content` is `overflow-x: hidden`;
 *   - the same happens when a phone's browser chrome collapses and `innerHeight` grows.
 *
 * So this module listens for `resize` (which covers `orientationchange`, since Chromium and
 * Safari both fire `resize` after a rotation) and re-clamps every open SWSE sheet.  It
 * passes explicit `width`/`height` so core's own clamp branches actually run — the work is
 * still done by core's arithmetic, this only re-triggers it.
 */

const NARROW = 700;
const COMPACT = 1023;

/** Every open ApplicationV1 whose root element carries the `swse` class. */
function openSwseV1Sheets() {
  const out = [];
  /* ui.windows is the V1 registry; ApplicationV2 instances live in foundry.applications.instances */
  for (const app of Object.values(ui.windows ?? {})) {
    if (!app?.rendered || !app.popOut) continue;
    const el = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    if (!el?.isConnected) continue;
    if (!el.classList.contains("swse")) continue;
    out.push({ app, el });
  }
  return out;
}

/**
 * Re-run core's clamp for one window.
 *
 * `width`/`height` are passed as the *current* rendered size, which is what makes core take
 * the `Math.clamp(tarW, minW, maxW)` branch.  If the viewport shrank, the clamp brings the
 * window down; if it grew, the window keeps its size (we never grow it past what the sheet
 * asked for, so a rotation back to landscape does not silently maximise the sheet).
 */
function refit({ app, el }, { fill }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wanted = app.options?.width;
  const wantedH = app.options?.height;

  let width = el.offsetWidth;
  let height = el.offsetHeight;

  if (fill) {
    /* On a phone a floating window is pointless: it can only ever be the whole screen. */
    width = vw;
    height = vh;
  } else {
    width = Math.min(Number.isFinite(wanted) ? Math.max(width, wanted) : width, vw);
    height = Math.min(Number.isFinite(wantedH) ? Math.max(height, wantedH) : height, vh);
  }

  const before = { w: el.offsetWidth, h: el.offsetHeight, l: el.offsetLeft, t: el.offsetTop };
  /* clear the inline values so core's `!el.style.width` branch is taken unconditionally */
  el.style.width = "";
  el.style.height = "";
  app.setPosition({ width, height, left: fill ? 0 : null, top: fill ? 0 : null });
  return { before, after: { w: el.offsetWidth, h: el.offsetHeight, l: el.offsetLeft, t: el.offsetTop } };
}

/** Public: refit everything now. Returns a report, which is what the test harness reads. */
export function refitAll() {
  const vw = window.innerWidth;
  const fill = vw <= NARROW;
  const report = [];
  for (const rec of openSwseV1Sheets()) {
    try { report.push({ id: rec.el.id, fill, ...refit(rec, { fill }) }); }
    catch (e) { report.push({ id: rec.el.id, error: e.message }); }
  }
  return report;
}

/**
 * Bring the active tab into view inside the scrolling strip.
 *
 * The stylesheet turns `nav.sheet-tabs` into a horizontal scroller, which is what makes all
 * ten tabs of the character sheet reachable at 390px (measured: the strip needs 888px).  The
 * side effect is that the strip can be scrolled away from whichever tab is actually active —
 * on re-render it resets to scrollLeft 0 while the active tab may be the eighth one.  Without
 * this, tapping "Settings" and having the sheet re-render leaves the user looking at
 * "Summary…Feats" with no indication of where they are.
 */
export function revealActiveTab(el) {
  const nav = el?.querySelector?.("nav.sheet-tabs");
  if (!nav || nav.scrollWidth <= nav.clientWidth + 2) return null;
  const active = nav.querySelector("a.item.active") ?? nav.querySelector("a[data-tab].active");
  if (!active) return null;
  const nr = nav.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  if (ar.left >= nr.left - 1 && ar.right <= nr.right + 1) return { alreadyVisible: true };
  /* `scrollIntoView` on the anchor would also scroll the sheet body; move the strip itself */
  const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  nav.scrollLeft = Math.max(0, target);
  return { scrolledTo: nav.scrollLeft, tab: active.dataset.tab };
}

export function registerWindowFit() {
  /*
   * `_callHooks` walks the whole inheritance chain (application-v1.mjs:_callHooks), so
   * `renderApplication` fires for every V1 window including SWSEActorSheet — no need to
   * enumerate the system's sheet class names.
   */
  Hooks.on("renderApplication", (app, html) => {
    const el = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    if (!el?.classList?.contains("swse")) return;
    /* let the render settle: core calls setPosition itself at the end of _render */
    setTimeout(() => {
      try {
        if (window.innerWidth <= NARROW) refit({ app, el }, { fill: true });
        revealActiveTab(el);
      } catch { /* window closed while we waited */ }
    }, 0);
    /* and whenever the user switches tab, keep the new one in view */
    el.querySelector("nav.sheet-tabs")?.addEventListener("click", ev => {
      if (!ev.target?.closest?.("a[data-tab]")) return;
      setTimeout(() => { try { revealActiveTab(el); } catch { } }, 60);
    });
  });

  /*
   * One debounced listener for the whole module.  `orientationchange` is deliberately not
   * used: it fires *before* the new viewport metrics are readable on some browsers, whereas
   * `resize` always follows with the final numbers.
   */
  window.addEventListener("resize", foundry.utils.debounce(() => refitAll(), 150), { passive: true });
}
