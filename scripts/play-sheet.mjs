/**
 * play-sheet.mjs — the compact play view (Stufe 3).
 *
 * WHY AN ApplicationV2 AND NOT AN OVERLAY ON THE EXISTING SHEET
 * ------------------------------------------------------------
 * Two options were on the table:
 *
 *   (a) Overlay the existing sheet: hide most of `actor-sheet.hbs` with CSS and re-label
 *       what is left.
 *   (b) A separate ApplicationV2 with its own PARTS, the way swse itself ported the
 *       ActiveEffect config (swse/module/active-effect/active-effect-config.mjs).
 *
 * (b) was chosen, and the reason is the size of the coupling surface, not taste:
 *
 *   - An overlay depends on the *DOM* of actor-sheet.hbs — every `div.flex.flex-row`
 *     nesting level, every partial name, every class.  Nine partials deep, that DOM is the
 *     least stable thing in the system, and the module would break on any template edit.
 *     A separate application depends only on the actor's *public API*
 *     (`actor.health`, `actor.defense`, `actor.condition`, `actor.attack.attacks`,
 *     `game.swse.rollVariable`, `game.swse.makeAttack`) — a far smaller and far more stable
 *     contract, and one the system already exposes deliberately (`game.swse`, swse.mjs:36).
 *   - An overlay inherits every ApplicationV1 problem we measured: the fixed `width: 1000,
 *     height: 900` (actor-sheet.mjs:120), the 377 px of horizontal overflow inside a 374 px
 *     form, and `.window-content { overflow-x: hidden }` clipping content with no way to
 *     scroll to it.  ApplicationV2 gets core's own `@media (max-height: 850px) {
 *     .application { max-height: 100vh } }` (foundry2.css:7390) and pointer-event based
 *     drag/resize for free.
 *   - Hiding is not reducing.  Every hidden field is still rendered, still submitted by
 *     `submitOnChange`, and still costs the layout pass — on the sheet we measured that is
 *     2664 px of content per tab.
 *
 * NO HANDLER IS DUPLICATED.  Every action here calls the system's own exported function:
 * rolls go through `game.swse.rollVariable`, attacks through `game.swse.makeAttack`
 * (swse/module/actor/attack/attackDelegate.mjs:575), the condition track through the
 * `actor.condition` setter (actor.mjs:456), hit points and shields through
 * `actor.update()`.  The module contributes presentation and nothing else.
 */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** The SWSE condition track, read from the system so the two can never drift. */
function conditionTrack() {
  return globalThis.SWSE?.conditionTrack ?? CONFIG.SWSE?.conditionTrack ?? ["0", "-1", "-2", "-5", "-10", "OUT"];
}

export class SWSEMobilePlaySheet extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {Actor} actor */
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
  }

  #actor;

  get actor() { return this.#actor; }

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    /* `swse` puts the sheet inside the system's own CSS scope so it inherits the palette;
     * `swse-mobile-play` is this module's hook. */
    classes: ["swse", "swse-mobile-play", "sheet"],
    tag: "div",
    window: { title: "SWSEMOBILE.Play.Title", icon: "fa-solid fa-dice-d20", resizable: true },
    position: { width: 420, height: 700 },
    actions: {
      roll: SWSEMobilePlaySheet.#onRoll,
      attack: SWSEMobilePlaySheet.#onAttack,
      condition: SWSEMobilePlaySheet.#onCondition,
      "hp-delta": SWSEMobilePlaySheet.#onHpDelta,
      "shield-delta": SWSEMobilePlaySheet.#onShieldDelta,
      "open-full": SWSEMobilePlaySheet.#onOpenFull,
      "toggle-trained": SWSEMobilePlaySheet.#onToggleTrained
    }
  };

  /**
   * @override
   * Deliberately NOT `root: true`.  With `root` the part's own first element becomes the
   * application element, which put `.play-scroll` *on* the root — so the CSS that makes
   * `.window-content` a flex column with a single scrolling child had nothing to lay out, and
   * `element.querySelector('.play-scroll')` could not find it either (an element never matches
   * its own querySelector).  Without `root`, the structure is the ordinary
   * `.window-content > [data-application-part] > .play-scroll`.
   */
  static PARTS = {
    body: { template: "modules/swse-mobile/templates/play.hbs", scrollable: [".play-scroll"] }
  };

  /** One instance per actor, keyed so a second tap re-focuses instead of stacking windows. */
  get id() { return `swse-mobile-play-${this.#actor?.id}`; }

  get title() {
    return game.i18n.format("SWSEMOBILE.Play.TitleFor", { name: this.#actor?.name ?? "" });
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const a = this.#actor;
    const ctx = await super._prepareContext(options);
    ctx.actor = a;
    ctx.missing = [];                       /* what the actor did not provide — surfaced, not hidden */

    const need = (label, fn) => {
      try {
        const v = fn();
        if (v === undefined || v === null) ctx.missing.push(label);
        return v;
      } catch (e) { ctx.missing.push(`${label}: ${e.message}`); return null; }
    };

    /* ---- hit points, shields, damage threshold ---- */
    const health = need("health", () => a.health) ?? {};
    const shields = need("shields", () => a.shields) ?? {};
    const defense = need("defense", () => a.defense) ?? {};

    ctx.hp = { value: health.value ?? 0, max: health.max ?? 0 };
    ctx.shields = { value: shields.value ?? 0, max: shields.max ?? 0, active: !!shields.active };
    ctx.hasShields = (shields.max ?? 0) > 0;

    /* ---- defences: the four numbers a player is asked for constantly ---- */
    const dv = k => defense?.[k]?.total ?? defense?.[k] ?? null;
    ctx.defenses = [
      { key: "reflex", label: "SWSEMOBILE.Play.Reflex", value: dv("reflex") },
      { key: "fortitude", label: "SWSEMOBILE.Play.Fortitude", value: dv("fortitude") },
      { key: "will", label: "SWSEMOBILE.Play.Will", value: dv("will") },
      { key: "damageThreshold", label: "SWSEMOBILE.Play.DamageThreshold", value: dv("damageThreshold") }
    ].filter(d => d.value !== null && d.value !== undefined);

    /* ---- condition track ---- */
    const cur = String(need("condition", () => a.condition) ?? "0");
    ctx.conditionTrack = conditionTrack().map(v => ({ value: v, active: String(v) === cur }));
    ctx.condition = cur;
    ctx.recovery = { actions: a.recoveryActions ?? null, total: a.totalRecoveryActions ?? null };

    /* ---- attacks ----
     * `attackRoll.formattedFormula` is markup meant for a wide panel: measured on this actor
     * it read `4 [Attribute Modifier] + 1 [Point-Blank Shot]* / 3d6 + 1 [Point-Blank Shot]`,
     * which at 390px pushed the weapon's own name out of its row entirely.  Strip the markup
     * and shorten it — at the table you need to recognise the attack, not audit its terms.
     * The full breakdown is in the chat card the roll produces. */
    const plain = s => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    let attacks = [];
    try {
      attacks = (a.attack?.attacks ?? []).filter(x => x && !x.hide).map(x => ({
        key: x.attackKey,
        name: x.name ?? "?",
        toHit: shorten(plain(x.attackRoll?.formattedFormula ?? x.attackRoll?.formula), 16) || null,
        damage: shorten(plain(x.damageRoll?.formattedFormula ?? x.damageRoll?.formula), 16) || null,
        range: x.rangeDisplay ?? null
      }));
    } catch (e) { ctx.missing.push("attacks: " + e.message); }
    ctx.attacks = attacks;

    /* ---- skills: value + roll variable, sorted by name, untrained ones collapsible ---- */
    let skills = [];
    try {
      skills = (a.skills ?? []).filter(s => s && !s.hide).map(s => ({
        label: s.label ?? "?",
        variable: s.variable ?? null,
        value: s.value ?? 0,
        attribute: (s.attribute ?? "").toUpperCase(),
        trained: !!(s.trained || s.isClass)
      })).sort((x, y) => x.label.localeCompare(y.label));
    } catch (e) { ctx.missing.push("skills: " + e.message); }
    /* Filter here rather than in the template: core registers `eq/ne/lt/gt/lte/gte/not` but
     * no `and` helper (client/applications/handlebars.mjs:139-145), so a
     * `{{#unless (and trainedOnly (not trained))}}` guard would silently render nothing. */
    ctx.trainedOnly = this.#trainedOnly;
    ctx.skills = this.#trainedOnly ? skills.filter(s => s.trained) : skills;
    ctx.skillCount = skills.length;

    /* ---- misc counters worth having at the table ----
     * Built as a list here rather than as a chain of `{{#if}}` in the template, because a
     * Base Attack Bonus of 0 is a real and useful answer and `{{#if 0}}` hides it.  Only
     * null/undefined means "this actor does not have that". */
    const glance = [
      { key: "initiative", label: "SWSEMOBILE.Play.Initiative", value: a.system?.skills?.initiative?.value,
        variable: a.system?.skills?.initiative?.variable ?? "@Initiative" },
      { key: "bab", label: "SWSEMOBILE.Play.BAB", value: a.baseAttackBonus },
      { key: "grapple", label: "SWSEMOBILE.Play.Grapple", value: a.grapple },
      { key: "speed", label: "SWSEMOBILE.Play.Speed", value: a.speed },
      { key: "forcePoints", label: "SWSEMOBILE.Play.ForcePoints", value: need("forcePoints", () => a.forcePoints)?.quantity },
      { key: "destinyPoints", label: "SWSEMOBILE.Play.DestinyPoints", value: a.system?.destinyPoints }
    ];
    ctx.glance = glance
      .filter(g => g.value !== null && g.value !== undefined && g.value !== "")
      .map(g => ({ ...g, value: shorten(plain(g.value), 14) }));

    ctx.editable = a.isOwner;
    return ctx;
  }

  #trainedOnly = false;

  /* -------------------------------------------- */
  /*  Actions — each one delegates to the system                                           */
  /* -------------------------------------------- */

  /** Skill / ability / defence roll via the system's own `game.swse.rollVariable`. */
  static async #onRoll(event, target) {
    const variable = target.dataset.variable;
    if (!variable) return ui.notifications.warn(game.i18n.localize("SWSEMOBILE.Play.NoVariable"));
    return game.swse.rollVariable(this.actor.id, variable);
  }

  /** Attack via the system's own `game.swse.makeAttack`. */
  static async #onAttack(event, target) {
    const key = target.dataset.attackKey;
    if (!key) return;
    return game.swse.makeAttack({
      actorUUID: this.actor.uuid,
      type: "singleAttack",
      attackKeys: [key],
      changes: []
    });
  }

  /** Condition track via the `actor.condition` setter (which builds the grouped effect). */
  static async #onCondition(event, target) {
    const value = target.dataset.value;
    this.actor.condition = value;
    /* the setter is async internally; re-render once the effect has landed */
    setTimeout(() => this.render(), 300);
  }

  static async #onHpDelta(event, target) {
    const d = Number(target.dataset.delta ?? 0);
    if (!d) return;
    const cur = this.actor.health?.value ?? 0;
    const max = this.actor.health?.max ?? 0;
    const next = Math.clamp(cur + d, -999, max || 999);
    await this.actor.update({ "system.health.value": next });
    this.render();
  }

  static async #onShieldDelta(event, target) {
    const d = Number(target.dataset.delta ?? 0);
    if (!d) return;
    /* `changeShields` is the system's own method (actor.mjs) and applies its own rules */
    if (typeof this.actor.changeShields === "function") await this.actor.changeShields(d);
    else await this.actor.update({ "system.shields.value": (this.actor.shields?.value ?? 0) + d });
    this.render();
  }

  static async #onOpenFull() {
    await this.actor.sheet.render(true);
  }

  static async #onToggleTrained() {
    this.#trainedOnly = !this.#trainedOnly;
    this.render();
  }

  /* -------------------------------------------- */

  /** @override — the hit-point field is a plain input, so commit it on change. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const hp = this.element.querySelector('input[name="hp"]');
    if (hp) {
      hp.addEventListener("change", async () => {
        const v = Number(hp.value);
        if (!Number.isFinite(v)) return;
        await this.actor.update({ "system.health.value": v });
      });
    }
    const sh = this.element.querySelector('input[name="shields"]');
    if (sh) {
      sh.addEventListener("change", async () => {
        const v = Number(sh.value);
        if (!Number.isFinite(v)) return;
        await this.actor.update({ "system.shields.value": v });
      });
    }
  }
}

/* ================================================================= registration ===== */

/**
 * Open (or focus) the compact view for an actor.
 *
 * The position is chosen here rather than in DEFAULT_OPTIONS because it depends on the screen:
 * on a phone a floating 420x700 window wastes the only screen there is, so it fills it; on a
 * tablet or desktop it stays a window you can put next to the map.  ApplicationV2 clamps
 * position to the viewport itself (`ApplicationV2#setPosition`), and core's own
 * `@media (max-height: 850px) { .application { max-height: 100vh } }` (foundry2.css:7390)
 * already covers the short-screen case — so this only has to choose, not to clamp.
 */
export function openPlaySheet(actor) {
  const id = `swse-mobile-play-${actor.id}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.bringToFront?.() ?? existing.render({ force: true });

  const narrow = window.innerWidth <= 700;
  const position = narrow
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : { width: 420, height: Math.min(760, window.innerHeight - 40) };
  return new SWSEMobilePlaySheet({ actor, position }).render({ force: true });
}

/**
 * Should the sheet header carry a Play View button?
 *
 * This is a setting rather than an unconditional `true` for a specific measured reason.  The
 * button is the only thing in this whole module that changes the sheet on a *desktop*: adding it
 * shifts the other header controls and, because `h4.window-title` is `flex: 1`, shortens the
 * title by the button's width — measured at 1920x1080, 637px of title became 547.5px.  Every
 * other one of the 16300 elements in the sheet was byte-identical.  A module for phones has no
 * business narrowing a desktop window title, so by default the button appears only where a finger
 * needs it.  The Actors-directory context-menu entry below is unconditional: it adds nothing to
 * any sheet, so it costs nothing.
 */
function wantHeaderButton() {
  const mode = game.settings.get(MODULE_ID_FOR_SETTINGS, "playViewHeaderButton");
  if (mode === "always") return true;
  if (mode === "never") return false;
  return matchMedia("(pointer: coarse)").matches;      /* "auto" */
}

/* play-sheet.mjs must not import from swse-mobile.mjs (that would be a cycle), so the id is
 * repeated here rather than imported.  It is the module's own directory name. */
const MODULE_ID_FOR_SETTINGS = "swse-mobile";

/**
 * Put the entry point where a phone user can actually reach it: a header control on the
 * actor sheet itself, and a context-menu entry in the Actors directory.
 *
 * `getApplicationHeaderControls` does not exist for ApplicationV1, so the V1 hook
 * `getActorSheetHeaderButtons` is used — it fires through `_callHooks` for the whole
 * inheritance chain, so it covers SWSEActorSheet without naming it.
 */
export function registerPlaySheet() {
  Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    const el = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    if (el && !el.classList.contains("swse")) return;
    const actor = app.actor ?? app.object;
    if (!actor) return;
    if (!wantHeaderButton()) return;
    buttons.unshift({
      label: game.i18n.localize("SWSEMOBILE.Play.Button"),
      class: "swse-mobile-play-open",
      icon: "fa-solid fa-dice-d20",
      onclick: () => openPlaySheet(actor)
    });
  });

  Hooks.on("getActorContextOptions", (directory, options) => {
    options.unshift({
      name: "SWSEMOBILE.Play.Button",
      icon: '<i class="fa-solid fa-dice-d20"></i>',
      condition: li => {
        const id = li?.dataset?.entryId ?? li?.dataset?.documentId;
        return !!game.actors.get(id);
      },
      callback: li => {
        const id = li?.dataset?.entryId ?? li?.dataset?.documentId;
        const actor = game.actors.get(id);
        if (actor) openPlaySheet(actor);
      }
    });
  });
}
