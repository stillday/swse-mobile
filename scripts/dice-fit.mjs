/**
 * dice-fit.mjs — keep Dice So Nice's rolling area on the visible screen.
 *
 * Dice So Nice reserves room for the sidebar: it subtracts the sidebar's width from the right
 * side of the rolling area (`_computeDimensions`, margin.right = sidebar width).  On a phone the
 * sidebar is a full-width panel, so the area collapses to a sliver at the left edge and the dice
 * are thrown half off screen.  There is no sidebar column to avoid on the phone, so the right
 * margin is dropped.  The rolling area is then pulled in from every side (a fifth left and right,
 * a fifth top and bottom, plus the bottom bar) so the dice settle in the middle of the visible
 * screen instead of piling up against an edge.
 */
import { isMobileUI, BAR_ID } from "./mobile-ui.mjs";

/** Share of the screen kept free on each side so the dice land centered (measured on a Pixel 8 Pro). */
const INSET_X = 0.2;
const INSET_Y = 0.22;
const PATCHED = Symbol.for("swse-mobile.diceFit");

function patch(dice3d) {
  if (!dice3d || dice3d[PATCHED] || typeof dice3d._computeDimensions !== "function") return;
  const original = dice3d._computeDimensions.bind(dice3d);
  dice3d._computeDimensions = function (rollingArea) {
    const dims = original(rollingArea);
    // A rolling area the player chose explicitly in Dice So Nice's own settings wins.
    if (rollingArea || !isMobileUI()) return dims;
    const bar = document.getElementById(BAR_ID)?.offsetHeight ?? 0;
    const { width, height } = dims;
    dims.margin = {
      top: Math.round(height * INSET_Y),
      right: Math.round(width * INSET_X),
      bottom: bar + Math.round(height * INSET_Y),
      left: Math.round(width * INSET_X)
    };
    return dims;
  };
  dice3d[PATCHED] = true;
  // The box was already built with the sidebar margin; rebuild its play area with ours.
  try { dice3d.resizePlayArea?.(); } catch (err) { console.warn("swse-mobile | Dice So Nice resize failed", err); }
}

export function registerDiceFit() {
  // Dice So Nice may finish initialising before or after our own "ready" hook.
  Hooks.on("diceSoNiceReady", patch);
  Hooks.once("ready", () => patch(game.dice3d));
}
