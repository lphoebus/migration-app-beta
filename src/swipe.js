import { createRendererForField, getFieldName, allFields, cacheOriginalRenderersForLayers, resetRenderersForLayers } from "./mapping.js";

const migrationYears = [
  { label: "2020-2021", value: "2021" },
  { label: "2021-2022", value: "2122" },
  { label: "2022-2023", value: "2223" }
];

export function setupSwipeCompareComponent({
  mapView,
  getStateLayer,
  getCountyLayer,
  getStateLayerCompare,
  getCountyLayerCompare
}) {
  let visibilitySnapshot = null;

  const getAllRendererLayers = () => {
    const layers = [
      getStateLayer?.(),
      getCountyLayer?.(),
      getStateLayerCompare?.(),
      getCountyLayerCompare?.()
    ].filter(Boolean);
    return [...new Set(layers)];
  };

  const resetSwipeCompareState = () => {
    const swipeWidget = document.getElementById("swipe-widget");
    const closeBtn = document.getElementById("close-swipe-btn");

    if (swipeWidget) {
      swipeWidget.hidden = true;
      if (swipeWidget.startLayers && swipeWidget.endLayers) {
        swipeWidget.startLayers.removeAll();
        swipeWidget.endLayers.removeAll();
      } else {
        swipeWidget.removeAttribute("leading-layer-ids");
        swipeWidget.removeAttribute("trailing-layer-ids");
      }
    }

    resetRenderersForLayers(getAllRendererLayers());

    if (visibilitySnapshot?.length) {
      const visibilityById = new Map(visibilitySnapshot.map((entry) => [entry.id, entry.visible]));
      mapView.map.layers.forEach((layer) => {
        if (visibilityById.has(layer.id)) {
          layer.visible = visibilityById.get(layer.id);
        }
      });
    } else {
      const countyCompare = getCountyLayerCompare?.();
      const stateCompare = getStateLayerCompare?.();
      if (countyCompare) countyCompare.visible = false;
      if (stateCompare) stateCompare.visible = false;
    }

    visibilitySnapshot = null;
    if (closeBtn) closeBtn.style.display = "none";
  };

  window.__resetSwipeCompareState = resetSwipeCompareState;

  // Get selectors for both sides
  const leftMetric = document.getElementById("swipe-left-metric");
  const leftYear = document.getElementById("swipe-left-year");
  const rightMetric = document.getElementById("swipe-right-metric");
  const rightYear = document.getElementById("swipe-right-year");
  const activateSwipeBtn = document.getElementById("activate-swipe-btn");

  if (!leftMetric || !leftYear || !rightMetric || !rightYear) return;

  // Helper to populate metric dropdowns
  function populateMetricDropdown(dropdown) {
    dropdown.innerHTML = "";
    allFields.forEach((field, idx) => {
      const opt = document.createElement("calcite-option");
      opt.value = idx;
      opt.textContent = field.label;
      dropdown.appendChild(opt);
    });
    if (dropdown.firstElementChild) dropdown.value = dropdown.firstElementChild.value;
  }
  // Helper to populate year dropdowns
  function populateYearDropdown(dropdown) {
    dropdown.innerHTML = "";
    migrationYears.forEach(year => {
      const opt = document.createElement("calcite-option");
      opt.value = year.value;
      opt.textContent = year.label;
      dropdown.appendChild(opt);
    });
    if (dropdown.firstElementChild) dropdown.value = dropdown.firstElementChild.value;
  }

  // Populate all dropdowns
  [leftMetric, rightMetric].forEach(populateMetricDropdown);
  [leftYear, rightYear].forEach(populateYearDropdown);

  if (activateSwipeBtn) {
    activateSwipeBtn.onclick = async () => {
      const leftFieldObj = allFields[parseInt(leftMetric.value, 10)];
      const rightFieldObj = allFields[parseInt(rightMetric.value, 10)];
      const leftYearVal = leftYear.value;
      const rightYearVal = rightYear.value;

      if (!leftFieldObj || !rightFieldObj || !leftYearVal || !rightYearVal) {
        alert("Please select both fields and years to compare.");
        return;
      }

      const leftField = getFieldName(leftFieldObj, leftYearVal);
      const rightField = getFieldName(rightFieldObj, rightYearVal);

      // Determine which geo level is active
      const isState = getStateLayer().visible;
      const mainLayer = isState ? getStateLayer() : getCountyLayer();
      const compareLayer = isState ? getStateLayerCompare() : getCountyLayerCompare();

      visibilitySnapshot = mapView.map.layers.map((layer) => ({
        id: layer.id,
        visible: layer.visible
      }));

      // Hide all other layers except these two
      mapView.map.layers.forEach(l => {
        if (l !== mainLayer && l !== compareLayer) l.visible = false;
      });

      // Set renderers
      await Promise.all([mainLayer.load(), compareLayer.load()]);
      cacheOriginalRenderersForLayers(getAllRendererLayers());
      compareLayer.renderer = await createRendererForField(rightField, mapView, compareLayer);
      mainLayer.renderer = await createRendererForField(leftField, mapView, mainLayer);
      compareLayer.visible = true;
      mainLayer.visible = true;

      // Assign to swipe using startLayers and endLayers
      const swipeWidget = document.getElementById("swipe-widget");
      swipeWidget.hidden = false;

      // Wait for the swipe widget to be ready (important for Map Components)
      // Use setTimeout to ensure the DOM is updated
      setTimeout(() => {
        if (swipeWidget.startLayers && swipeWidget.endLayers) {
          swipeWidget.startLayers.removeAll();
          swipeWidget.endLayers.removeAll();
          swipeWidget.startLayers.add(mainLayer);
          swipeWidget.endLayers.add(compareLayer);
        } else {
          // Fallback for older versions
          swipeWidget.setAttribute("leading-layer-ids", mainLayer.id);
          swipeWidget.setAttribute("trailing-layer-ids", compareLayer.id);
        }
      }, 0);

      // Show the close button
      const closeBtn = document.getElementById("close-swipe-btn");
      if (!closeBtn) return;

      closeBtn.style.display = "block";
      closeBtn.onclick = () => {
        resetSwipeCompareState();
      };
    };
  }
}