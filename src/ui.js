import { appState } from "./app_state";

// Handles the action bar click logic
export function handleActionBarClick({ target }) {
  if (target.tagName !== "CALCITE-ACTION") return;
  if (target.id === "info-action") return;

  document.querySelectorAll('calcite-shell-panel[slot="panel-start"] calcite-panel').forEach(panelEl => {
    panelEl.closed = panelEl.dataset.panelId !== target.dataset.actionId;
  });
  document.querySelectorAll("calcite-action").forEach(actionEl => {
    actionEl.active = false;
  });

  const nextWidget = target.dataset.actionId;
  if (nextWidget !== appState.activeWidget) {
    document.querySelector(`[data-action-id=${nextWidget}]`).active = true;
    const panel = document.querySelector(`[data-panel-id=${nextWidget}]`);
    if (panel) {
      panel.closed = false;
      panel.setFocus();
    }
    appState.activeWidget = nextWidget;
  } else {
    appState.activeWidget = null;
  }
}

// Handles panel close events
export function setupPanelCloseHandlers() {
  document.querySelectorAll('calcite-shell-panel[slot="panel-start"] calcite-panel').forEach(panelEl => {
    panelEl.addEventListener("calcitePanelClose", () => {
      const actionEl = document.querySelector(`[data-action-id=${appState.activeWidget}]`);
      if (actionEl) {
        actionEl.active = false;
        actionEl.setFocus();
      }
      appState.activeWidget = null;
    });
  });
}

// Handles action bar toggle for map padding
export function setupActionBarToggle(mainMap) {
  document.addEventListener("calciteActionBarToggle", event => {
    appState.actionBarExpanded = !appState.actionBarExpanded;
    if (mainMap && mainMap.view) {
      mainMap.view.padding = { left: appState.actionBarExpanded ? 135 : 49 };
    }
  });
}

// Show/hide shell and loader
export function showShellAndHideLoader() {
  document.querySelector("calcite-shell").hidden = false;
  document.querySelector("calcite-loader").hidden = true;
}

// Slider setup
export function setupSlider(drawLines) {
  const slider = document.getElementById("migration-slider");
  if (slider) {
    slider.addEventListener("calciteSliderInput", (event) => {
      appState.minValue = event.target.valueAsNumber || event.target.value;
      if (appState.allRelatedFeatures.length > 0) {
        drawLines(appState.allRelatedFeatures, appState.minValue, appState.selectedStateName, appState.selectedCountyAbbr);
      }
    });

    slider.labelFormatter = function (value, type) {
      if (type === "value") {
        if (value === slider.min) return "<100 people>";
        if (value === slider.max) return ">10,000 people";
      }
      return undefined;
    };
  }
}

// Clear lines button
export function setupClearLinesBtn() {
  const clearLinesBtn = document.getElementById("clear-lines-btn");
  if (clearLinesBtn) {
    clearLinesBtn.addEventListener("click", () => {
      appState.linesLayer.removeAll();
      appState.pointsLayer.removeAll();
    });
  }
}

// Reset slider button
export function setupResetSliderBtn() {
  const resetSliderBtn = document.getElementById("reset-btn");
  const slider = document.getElementById("migration-slider");
  if (resetSliderBtn && slider) {
    resetSliderBtn.addEventListener("click", () => {
      const defaultStateValue = 2500;
      const defaultCountyValue = 100;
      const newValue = appState.geoLevel === "state" ? defaultStateValue : defaultCountyValue;
      slider.value = newValue;
      appState.minValue = newValue;
      slider.dispatchEvent(new CustomEvent("calciteSliderInput"));
    });
  }
}

// About dialog setup
export function setupAboutDialog() {
  const infoAction = document.getElementById("info-action");
  const aboutDialog = document.getElementById("about-dialog");
  const closeBtn = document.getElementById("about-dialog-close");
  if (infoAction && aboutDialog) {
    infoAction.addEventListener("click", () => {
      aboutDialog.open = true;
    });
  }
  if (closeBtn && aboutDialog) {
    closeBtn.addEventListener("click", () => {
      aboutDialog.open = false;
    });
  }
}

// Left panel action bar - exact pattern from example
export function setupActionBar() {
  const shellPanel = document.getElementById("shell-panel-start");
  const actions = shellPanel?.querySelectorAll("calcite-action");

  shellPanel?.querySelectorAll("calcite-panel").forEach((panel) => {
    panel.addEventListener("calcitePanelClose", () => {
      actions?.forEach((a) => (a.active = false));
      shellPanel.collapsed = true;
    });
  });

  actions?.forEach((el) => {
    if (el.id === "info-action") return;

    el.addEventListener("click", function (event) {
      const panelId = el.dataset.actionId;
      const targetPanel = shellPanel.querySelector(`[data-panel-id="${panelId}"]`);
      const isOpen = !targetPanel?.closed;

      actions.forEach((a) => (a.active = false));
      shellPanel.querySelectorAll("calcite-panel").forEach((p) => (p.closed = true));

      if (isOpen) {
        shellPanel.collapsed = true;
      } else {
        el.active = true;
        shellPanel.collapsed = false;
        if (targetPanel) targetPanel.closed = false;
      }
    });
  });
}

// Handles right action bar icon click to toggle the info-tools panel
export function setupRightActionBar() {
  const infoAction = document.getElementById("right-info-action");
  const infoToolsPanel = document.getElementById("right-info-tools-panel");
  if (infoAction && infoToolsPanel) {
    infoAction.addEventListener("click", () => {
      infoToolsPanel.hidden = !infoToolsPanel.hidden;
    });
  }
}

// export function setupPanel(shellPanelId) {

//   const shell = document.getElementById(shellPanelId);
//   const actions = shell.querySelectorAll("calcite-action");
//   const panels = shell.querySelectorAll("calcite-panel");

//   actions.forEach(action => {
//     action.addEventListener("click", () => {
//       const panelId = action.dataset.panelId;
//       shell.collapsed = false;
//       panels.forEach(panel => {
//         const isTarget = panel.dataset.panelId === panelId;
//         if (isTarget) {
//           panel.closed = false;
//           panel.hidden = false;
//         } else {
//           panel.hidden = true;
//         }
//       });
//     });
//   });
// }

export function setupPanelController(shellPanelId) {
  const shell = document.getElementById(shellPanelId);
  if (!shell) return;

  const actions = shell.querySelectorAll("calcite-action");
  const panels = shell.querySelectorAll("calcite-panel");

  if (shell.dataset.panelControllerInitialized === "true") return;
  shell.dataset.panelControllerInitialized = "true";

  const hideAllPanels = () => {
    panels.forEach((panel) => {
      panel.hidden = true;
      panel.setAttribute("hidden", "");
      panel.closed = true;
    });

    actions.forEach((action) => {
      action.active = false;
    });
  };

  actions.forEach((action) => {
    if (action.id === "info-action") return;

    action.addEventListener("click", () => {
      const panelId = action.dataset.panelId;
      const targetPanel = shell.querySelector(`calcite-panel[data-panel-id="${panelId}"]`);
      const isOpening = Boolean(targetPanel?.hidden);

      hideAllPanels();

      if (!targetPanel || !isOpening) {
        if ("collapsed" in shell) shell.collapsed = true;
        return;
      }

      if ("collapsed" in shell) shell.collapsed = false;
      action.active = true;
      targetPanel.hidden = false;
      targetPanel.removeAttribute("hidden");
      targetPanel.closed = false;
      targetPanel.setFocus?.();
    });
  });

  panels.forEach((panel) => {
    panel.addEventListener("calcitePanelClose", () => {
      panel.hidden = true;
      panel.setAttribute("hidden", "");
      panel.closed = true;

      actions.forEach((action) => {
        if (action.dataset.panelId === panel.dataset.panelId) {
          action.active = false;
        }
      });

      const allHidden = Array.from(panels).every((p) => p.hidden);
      if (allHidden) {
        if ("collapsed" in shell) shell.collapsed = true;
      }
    });
  });
}