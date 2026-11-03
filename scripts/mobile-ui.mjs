/**
 * mobile-ui.mjs — compact bottom navigation bar for narrow touch screens.
 *
 * Hides Foundry's standard chrome (scene controls, sidebar tabs, hotbar, players,
 * pause banner, scene navigation) and replaces them with a 56-px bottom nav bar
 * containing the five most-used actions.  Everything else lives in the "Menü" panel.
 *
 * Gate: window.innerWidth <= 700 && (pointer: coarse).
 * Desktop is completely unaffected — the class is never added, no elements are created.
 */

const BAR_ID = "swse-mob-bar";
const MENU_ID = "swse-mob-menu";
const BACKDROP_ID = "swse-mob-backdrop";
const BODY_CLASS = "swse-mob-ui-active";

let activePanel = null;
let activeSidebarTab = null;

function isMobileUI() {
  return window.innerWidth <= 700 && matchMedia("(pointer: coarse)").matches;
}

function panelEl(name) {
  if (name === "controls") return document.getElementById("scene-controls");
  if (name === "sidebar")  return document.getElementById("sidebar-content");
  if (name === "hotbar")   return document.getElementById("hotbar");
  if (name === "menu")     return document.getElementById(MENU_ID);
  return null;
}

function buttonEl(id) {
  return document.getElementById(`swse-mob-btn-${id}`);
}

function setPressed(id, pressed) {
  buttonEl(id)?.setAttribute("aria-pressed", String(pressed));
}

function openPanel(name) {
  if (activePanel && activePanel !== name) closePanel(activePanel, false);
  panelEl(name)?.classList.add("swse-mob-panel-open");
  activePanel = name;
  document.getElementById(BACKDROP_ID)?.classList.add("swse-mob-panel-open");
  for (const id of ["controls", "chat", "actors", "hotbar", "menu"]) {
    const panelForBtn = id === "chat" || id === "actors" ? "sidebar" : id;
    const tabForBtn = id === "chat" ? "chat" : id === "actors" ? "actors" : null;
    setPressed(id, panelForBtn === name && (tabForBtn === null || tabForBtn === activeSidebarTab));
  }
}

function closePanel(name, clearBackdrop = true) {
  panelEl(name)?.classList.remove("swse-mob-panel-open");
  if (activePanel === name) { activePanel = null; activeSidebarTab = null; }
  if (clearBackdrop) {
    document.getElementById(BACKDROP_ID)?.classList.remove("swse-mob-panel-open");
  }
  for (const id of ["controls", "chat", "actors", "hotbar", "menu"]) {
    setPressed(id, false);
  }
}

function togglePanel(name, sidebarTab) {
  if (activePanel === name) {
    if (sidebarTab && activeSidebarTab !== sidebarTab) {
      ui.sidebar?.activateTab(sidebarTab);
      activeSidebarTab = sidebarTab;
      for (const id of ["controls", "chat", "actors", "hotbar", "menu"]) {
        const panelForBtn = id === "chat" || id === "actors" ? "sidebar" : id;
        const tabForBtn = id === "chat" ? "chat" : id === "actors" ? "actors" : null;
        setPressed(id, panelForBtn === name && tabForBtn === sidebarTab);
      }
    } else {
      closePanel(name);
    }
  } else {
    if (sidebarTab) {
      ui.sidebar?.activateTab(sidebarTab);
      activeSidebarTab = sidebarTab;
    }
    openPanel(name);
  }
}

function ensureBackdrop() {
  if (document.getElementById(BACKDROP_ID)) return;
  const bd = document.createElement("div");
  bd.id = BACKDROP_ID;
  bd.setAttribute("aria-hidden", "true");
  bd.addEventListener("click", () => closePanel(activePanel ?? "sidebar"));
  document.body.appendChild(bd);
}

function ensureNavBar() {
  if (document.getElementById(BAR_ID)) return;

  const bar = document.createElement("nav");
  bar.id = BAR_ID;
  bar.setAttribute("aria-label", "Mobile Navigation");
  bar.innerHTML = [
    { id: "controls", icon: "fa-tools",    label: "Karte",   panel: "controls"  },
    { id: "chat",     icon: "fa-comments", label: "Chat",    panel: "sidebar",  sidebar: "chat"   },
    { id: "actors",   icon: "fa-users",    label: "Chars",   panel: "sidebar",  sidebar: "actors" },
    { id: "hotbar",   icon: "fa-th",       label: "Makros",  panel: "hotbar"    },
    { id: "menu",     icon: "fa-bars",     label: "Menü",    panel: "menu"      },
  ].map(b => `<button id="swse-mob-btn-${b.id}" class="swse-mob-btn"
    aria-label="${b.label}" aria-pressed="false"
    data-panel="${b.panel}" data-sidebar="${b.sidebar ?? ""}">
    <i class="fas ${b.icon}" aria-hidden="true"></i>
    <span>${b.label}</span>
  </button>`).join("");

  bar.addEventListener("click", e => {
    const btn = e.target.closest(".swse-mob-btn");
    if (!btn) return;
    togglePanel(btn.dataset.panel, btn.dataset.sidebar || undefined);
  });

  document.body.appendChild(bar);
}

function ensureMenuPanel() {
  if (document.getElementById(MENU_ID)) return;

  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Weitere Optionen");
  menu.innerHTML = `<div class="swse-mob-menu-grid">${[
    { action: "compendium", icon: "fa-atlas",      label: "Kompendien" },
    { action: "combat",     icon: "fa-fist-raised",label: "Kampf"      },
    { action: "journal",    icon: "fa-book-open",  label: "Journal"    },
    { action: "settings",   icon: "fa-cog",        label: "Einstellungen" },
    { action: "fullscreen", icon: "fa-expand",     label: "Vollbild"   },
    { action: "roll",       icon: "fa-dice-d20",   label: "Würfeln"    },
  ].map(i => `<button class="swse-mob-menu-item" data-action="${i.action}"
    aria-label="${i.label}">
    <i class="fas ${i.icon}" aria-hidden="true"></i>
    <span>${i.label}</span>
  </button>`).join("")}</div>`;

  menu.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    closePanel("menu");
    switch (btn.dataset.action) {
      case "compendium":
        ui.sidebar?.activateTab("compendium");
        openPanel("sidebar");
        setPressed("menu", false);
        break;
      case "combat":
        ui.sidebar?.activateTab("combat");
        openPanel("sidebar");
        break;
      case "journal":
        ui.sidebar?.activateTab("journal");
        openPanel("sidebar");
        break;
      case "settings":
        ui.sidebar?.activateTab("settings");
        openPanel("sidebar");
        break;
      case "fullscreen":
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
        break;
      case "roll": {
        const content = `<div style="padding:4px"><label for="mob-roll">Formel</label>
          <input id="mob-roll" type="text" value="1d20" placeholder="1d20+5"
            aria-label="Würfelformel" style="width:100%;margin-top:4px;font-size:1.1rem"></div>`;
        new Dialog({
          title: "Würfeln",
          content,
          buttons: {
            roll: {
              icon: `<i class="fas fa-dice-d20"></i>`,
              label: "Würfeln",
              callback: html => {
                const formula = html.find("#mob-roll").val().trim();
                if (formula) new Roll(formula).toMessage({ flavor: "Schnellwurf" });
              }
            }
          },
          default: "roll"
        }).render(true);
        break;
      }
    }
  });

  document.body.appendChild(menu);
}

export function registerMobileUI() {
  Hooks.once("ready", () => {
    if (!isMobileUI()) return;
    document.body.classList.add(BODY_CLASS);
    ensureBackdrop();
    ensureNavBar();
    ensureMenuPanel();
    console.log("swse-mobile | mobile UI bar registered");
  });

  window.addEventListener("resize", foundry.utils.debounce(() => {
    if (isMobileUI()) {
      if (!document.body.classList.contains(BODY_CLASS)) {
        document.body.classList.add(BODY_CLASS);
        ensureBackdrop();
        ensureNavBar();
        ensureMenuPanel();
      }
    } else {
      document.body.classList.remove(BODY_CLASS);
      document.getElementById(BAR_ID)?.remove();
      document.getElementById(MENU_ID)?.remove();
      document.getElementById(BACKDROP_ID)?.remove();
      activePanel = null;
    }
  }, 200), { passive: true });
}
