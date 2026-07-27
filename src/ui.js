import { appState } from "./app_state";

// Handles action bar toggle for map padding
export function setupActionBarToggle(mainView) {
  document.addEventListener("calciteActionBarToggle", event => {
    appState.actionBarExpanded = !appState.actionBarExpanded;
    if (mainView) {
      mainView.padding = { left: appState.actionBarExpanded ? 135 : 49 };
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