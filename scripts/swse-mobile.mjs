/**
 * swse-mobile — mobile and tablet support for the Star Wars: Saga Edition system.
 *
 * Scope of this module, and why it is a module at all:
 *
 *   - The responsive layout and the touch sizing are pure CSS (styles/swse-mobile.css).
 *     Foundry imports a module's styles into `@layer modules`, which outranks the `@layer
 *     system` that swse.css lands in, so nothing has to be patched or monkey-patched to make
 *     the sheet reflow.  Every rule is behind `(pointer: coarse)` or a `max-width` query, so
 *     with the module enabled on a desktop the sheet is byte-for-byte the sheet it was.
 *   - The two things CSS cannot reach are done in JS: re-clamping window geometry after a
 *     rotation (scripts/window-fit.mjs — core clamps on render but registers no resize
 *     listener for ApplicationV1) and producing the `contextmenu` event a finger never
 *     generates (scripts/touch.mjs).
 *   - The compact play view (scripts/play-sheet.mjs) is an ApplicationV2 of its own.
 *
 * Nothing in the swse system is modified, wrapped or overridden.  Everything here is either a
 * stylesheet in a later cascade layer, a Foundry hook, or a call into `game.swse`.
 */

import { registerWindowFit, refitAll } from "./window-fit.mjs";
import { registerTouchSupport, touchStats } from "./touch.mjs";
import { registerPlaySheet, openPlaySheet, SWSEMobilePlaySheet } from "./play-sheet.mjs";
import { registerMobileUI } from "./mobile-ui.mjs";

export const MODULE_ID = "swse-mobile";

/**
 * Viewport / input classification.
 *
 * The CSS does not need this — media queries re-evaluate themselves.  It exists because
 * Foundry adds no device class of its own (`Game#configureUI`, client/game.mjs:1824-1890,
 * adds only `theme-*`, `performance-*` and `noblur`), so a world or another module that wants
 * to key off "this is a phone" has nowhere to look, and because the acceptance tests read it
 * to confirm which gate is active.
 */
export function describeViewport() {
  const w = window.innerWidth, h = window.innerHeight;
  return {
    width: w, height: h,
    coarse: matchMedia("(pointer: coarse)").matches,
    hover: matchMedia("(hover: hover)").matches,
    narrow: w <= 700,
    compact: w <= 1023,
    /* Foundry's own thresholds, for reference in a bug report:
     * MIN_SCREEN_RESOLUTION 1366x768 / MIN_VIEWPORT_DIMENSIONS 1024x768
     * (client/helpers/client-issues.mjs:38-47) */
    belowFoundryViewportMinimum: w < 1024 || h < 768,
    orientation: w >= h ? "landscape" : "portrait"
  };
}

function applyBodyClasses() {
  const v = describeViewport();
  const b = document.body.classList;
  b.toggle("swse-mob", true);
  b.toggle("swse-mob-touch", v.coarse);
  b.toggle("swse-mob-narrow", v.narrow);
  b.toggle("swse-mob-compact", v.compact);
  b.toggle("swse-mob-portrait", v.orientation === "portrait");
  return v;
}

Hooks.once("init", () => {
  /*
   * One setting, and it only controls the *notification*, not the layout.  The layout is
   * gated on media queries and needs no opt-in: if the screen is a phone, the phone layout is
   * the correct layout.
   */
  game.settings.register(MODULE_ID, "silenceResolutionWarning", {
    name: "SWSEMOBILE.Settings.SilenceResolutionWarning.Name",
    hint: "SWSEMOBILE.Settings.SilenceResolutionWarning.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  /*
   * The Play View header button is the only thing in this module that can change a *desktop*
   * sheet, so it defaults to "auto" = touch devices only.  See the note in play-sheet.mjs:
   * with the button present at 1920x1080 the window title measured 547.5px instead of 637px,
   * because `h4.window-title` is `flex: 1` and the new control takes 89px.  Everything else
   * on the sheet — all 16300 elements — was byte-identical either way.
   */
  game.settings.register(MODULE_ID, "playViewHeaderButton", {
    name: "SWSEMOBILE.Settings.PlayViewHeaderButton.Name",
    hint: "SWSEMOBILE.Settings.PlayViewHeaderButton.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      auto: "SWSEMOBILE.Settings.PlayViewHeaderButton.Auto",
      always: "SWSEMOBILE.Settings.PlayViewHeaderButton.Always",
      never: "SWSEMOBILE.Settings.PlayViewHeaderButton.Never"
    },
    default: "auto"
  });

  game.settings.register(MODULE_ID, "playSheetOnSmallScreens", {
    name: "SWSEMOBILE.Settings.PlaySheetOnSmallScreens.Name",
    hint: "SWSEMOBILE.Settings.PlaySheetOnSmallScreens.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  registerWindowFit();
  registerPlaySheet();
  registerMobileUI();

  /* The public surface, also what the acceptance tests drive. */
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      describeViewport,
      refitAll,
      openPlaySheet,
      SWSEMobilePlaySheet,
      touchStats,
      resolutionStats
    };
  }
});

Hooks.once("ready", () => {
  applyBodyClasses();
  window.addEventListener("resize", foundry.utils.debounce(applyBodyClasses, 150), { passive: true });

  const v = describeViewport();
  if (v.coarse) registerTouchSupport();

  /*
   * Foundry raises `ui.notifications.error("ERROR.RESOLUTION.*", {permanent: true})` below
   * 1024x768 (client/helpers/client-issues.mjs:186-191).  Nothing is disabled by it — the
   * only consumers of `usabilityIssues` are the Support Details dialog and a warning badge —
   * but `permanent: true` means it never clears itself, and on a 390px screen it covers the
   * top half of the interface (measured: `#notifications` 390x408 at y=84).  On a phone the
   * message is also simply wrong: the check reaches `ERROR.RESOLUTION.Scale` ("you have a
   * zoom factor applied") because `devicePixelRatio > 1` on every modern handset.
   *
   * So it is dismissed rather than suppressed: the issue stays in `game.issues` for the
   * support dialog, only the banner goes away.
   */
  if (game.settings.get(MODULE_ID, "silenceResolutionWarning")) watchResolutionNotification();

  /*
   * On a phone, opening the full sheet by default means landing on a 2664 px-tall build sheet
   * when what the player wanted was their hit points.  With this on, opening an owned actor
   * raises the compact view alongside and minimises the full one; the full sheet is one tap
   * away from the compact view's footer, and the system's sheet class is never unregistered,
   * so turning the setting off restores the stock behaviour with no migration.
   */
  if (v.narrow && game.settings.get(MODULE_ID, "playSheetOnSmallScreens")) {
    Hooks.on("renderActorSheet", app => {
      const actor = app.actor ?? app.object;
      if (!actor?.isOwner || app.__swseMobileRedirected) return;
      const el = app.element instanceof HTMLElement ? app.element : app.element?.[0];
      if (!el?.classList?.contains("swse")) return;
      app.__swseMobileRedirected = true;
      openPlaySheet(actor);
      app.minimize?.();
    });
  }

  console.log(`${MODULE_ID} | ready — ${JSON.stringify(v)}`);
});

/** How the resolution banner is recognised — see `resolutionMatchers()`. */
export const resolutionStats = { removed: 0, lastText: null };

/**
 * Two independent ways to recognise the banner, because either one alone is fragile:
 *
 *  (a) the localised prefix of the three `ERROR.RESOLUTION.*` strings.  Exact, but depends on
 *      `game.i18n` resolving the same way the notification did.
 *  (b) the interpolated numbers.  `ClientIssues` formats the message with its own thresholds
 *      — `MIN_SCREEN_RESOLUTION {width: 1366, height: 768}` and `MIN_VIEWPORT_DIMENSIONS
 *      {width: 1024, height: 768}` (client/helpers/client-issues.mjs:38-47) — so
 *      "1024px" / "1366px" plus "768px" appear in every translation.
 */
function resolutionMatchers() {
  const prefixes = ["ERROR.RESOLUTION.Screen", "ERROR.RESOLUTION.Scale", "ERROR.RESOLUTION.Window"]
    .map(k => game.i18n.localize(k))
    .map(s => s.split("{")[0].trim())
    .filter(s => s.length > 12 && !s.startsWith("ERROR."));
  const numeric = /(?:1024|1366)\s*px.{0,12}768\s*px/i;
  return { prefixes, numeric };
}

function isResolutionNotification(text) {
  const t = String(text ?? "");
  if (!t) return false;
  const { prefixes, numeric } = resolutionMatchers();
  return prefixes.some(p => t.includes(p)) || numeric.test(t);
}

/** Remove it from the DOM and from the manager's own list, so it cannot come back. */
function sweepResolutionNotification() {
  let n = 0;
  for (const el of document.querySelectorAll("#notifications .notification")) {
    if (!isResolutionNotification(el.textContent)) continue;
    resolutionStats.lastText = String(el.textContent).slice(0, 120);
    el.remove();
    n++;
  }
  /* Also out of the manager. `active` / `queue` are not public API, so every access is
   * guarded — the DOM removal above is the part that has to work. */
  try {
    for (const key of ["active", "queue"]) {
      const list = ui.notifications?.[key];
      if (!Array.isArray(list)) continue;
      for (const note of [...list]) {
        if (!isResolutionNotification(note?.message)) continue;
        if (typeof ui.notifications.remove === "function") ui.notifications.remove(note);
        else list.splice(list.indexOf(note), 1);
        n++;
      }
    }
  } catch { /* ignored on purpose: see above */ }
  resolutionStats.removed += n;
  return n;
}

/**
 * Why a watcher and not a single sweep at `ready`:
 *
 * `ClientIssues#_detectUsabilityIssues` runs inside `Game#initialize` (client/game.mjs:675),
 * before the `ready` hook, but `ui.notifications` renders its queue asynchronously — a sweep
 * at `ready` measured zero elements to remove and the banner appeared a moment later.  On top
 * of that, `#validateResolution` is re-run on every `resize`
 * (client/helpers/client-issues.mjs:250), so a rotation puts the banner back.
 *
 * A MutationObserver on `#notifications` handles both without polling.  It stays installed for
 * the session: it is one observer over one small subtree and it is the only thing that keeps
 * the banner from returning after a rotation.
 */
function watchResolutionNotification() {
  const removed = sweepResolutionNotification();
  const host = document.getElementById("notifications");
  if (!host) {
    console.warn(`${MODULE_ID} | #notifications not found; the resolution banner cannot be dismissed`);
    return;
  }
  new MutationObserver(() => sweepResolutionNotification()).observe(host, { childList: true, subtree: true });
  console.log(`${MODULE_ID} | resolution-banner watcher installed (removed ${removed} on install); ` +
    "the underlying issue stays in game.issues for Support Details");
}
