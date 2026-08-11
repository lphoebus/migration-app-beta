import './style.css'
import { defineCustomElements } from "@esri/calcite-components/dist/loader";
defineCustomElements(window);

import "@arcgis/map-components/dist/components/arcgis-map";
import "@arcgis/map-components/dist/components/arcgis-layer-list";
import "@arcgis/map-components/dist/components/arcgis-legend";
import "@arcgis/map-components/dist/components/arcgis-home";
import "@arcgis/map-components/dist/components/arcgis-zoom";
import "@arcgis/map-components/dist/components/arcgis-bookmarks";
import "@arcgis/map-components/dist/components/arcgis-swipe";
import esriConfig from "@arcgis/core/config";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import Extent from "@arcgis/core/geometry/Extent";

import { appState } from "./app_state";

esriConfig.log.interceptors.push((level, module, ...args) => {
  if (level !== "error") return false;
  if (!String(module || "").includes("FeatureSourceEventLog")) return false;

  const details = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  const isTileAbort = details.includes("Failed to load tile") && details.includes("Aborted");
  return isTileAbort;
});

let setupPanelController = () => {};
let updateHighlightFlow = async () => ({
  highlightedCount: 0,
  representedPct: 0,
  topContributors: []
});
let isSpecialFlowCode = () => false;

let uiModulePromise;
const loadUiModule = () => {
  if (!uiModulePromise) {
    uiModulePromise = import("./ui");
  }
  return uiModulePromise;
};

const featureInfoDiv = document.getElementById("feature-info");

let stateLayer, countyLayer; // Declare variables to hold references to the layers

document.addEventListener("DOMContentLoaded", async () => {
  const uiModule = await loadUiModule();
  setupPanelController = uiModule.setupPanelController;
  setupPanelController("shell-panel-start");
  setupPanelController("shell-panel-end");
  addYearSelectListener();
});


let lastSelectedStateFips = null; // Track the last selected state FIPS code for flow highlighting
let lastSelectedObjectId = null; // Track the last selected feature's OBJECTID for related queries
let selectedYear = "2122"; // default to 2021-2022 for stable data availability
let selectedPolygonHighlightHandles = [];

const yearLabel = {
  "2021": "2020-2021",
  "2122": "2021-2022",
  "2223": "2022-2023"
};

function addYearSelectListener() {
  const yearSelect = document.getElementById("analysis-year-select");
  const highlightYearSelect = document.getElementById("highlight-year-select");
  const yearChip = document.getElementById("chip-year");
  if (yearSelect) {
    selectedYear = yearSelect.value || "2122";
    if (highlightYearSelect) highlightYearSelect.value = selectedYear;
    if (yearChip) yearChip.textContent = yearLabel[selectedYear] || "2021-2022";
  }
  if (yearSelect && !yearSelect._listenerAdded) {
    yearSelect.addEventListener("calciteSelectChange", (e) => {
      selectedYear = e.target.value;
      if (yearChip) yearChip.textContent = yearLabel[selectedYear] || "2020-2021";
      if (highlightYearSelect) highlightYearSelect.value = selectedYear;
      if (appState.highlightEnabled && lastSelectedStateFips && lastSelectedObjectId) {
        const flowType = document.getElementById("highlight-flow-toggle").value;
        const geoLevel = stateLayer.visible ? "state" : "county";
        const threshold = geoLevel === "state" ? appState.stateThreshold : appState.countyThreshold;
        updateHighlightFlow(
          flowType,
          lastSelectedStateFips,
          lastSelectedObjectId,
          stateLayer,
          countyLayer,
          geoLevel,
          0,
          threshold,
          selectedYear
        );
      }

      if (appState.lastPolygonGraphic) {
        const tool = document.getElementById("analysis-tool-tabs")?.value || "summary";
        if (typeof window.__refreshAnalysisForSelection === "function") {
          window.__refreshAnalysisForSelection(tool);
        }
      }
    });
    yearSelect._listenerAdded = true;
  }
}

const mainMap = document.getElementById("mainMap");
mainMap.addEventListener("arcgisViewReadyChange", async () => {
  const [
    uiModule,
    drawModule,
    migrationModule,
    interactionsModule,
    mappingModule,
    flowDirectionChartModule,
    swipeModule
  ] = await Promise.all([
    loadUiModule(),
    import("./draw"),
    import("./migration"),
    import("./interactions"),
    import("./mapping"),
    import("./flow_direction_chart_svg.js"),
    import("./swipe")
  ]);

  const {
    setupActionBarToggle,
    showShellAndHideLoader,
    setupSlider,
    setupAboutDialog
  } = uiModule;
  const { drawLines, stopFlowLineAnimation } = drawModule;
  const { handleOutflow, handleInflow } = migrationModule;
  updateHighlightFlow = migrationModule.updateHighlightFlow;
  isSpecialFlowCode = migrationModule.isSpecialFlowCode;
  const { setupFeatureInfoClick, setupLineHoverPopup } = interactionsModule;
  const { setupMigrationMappingUI } = mappingModule;
  const { createFlowDirectionChart } = flowDirectionChartModule;
  const { setupSwipeCompareComponent } = swipeModule;

  const mainView = mainMap.view;
  const map = mainMap.map;
  mainMap.spatialReference = { wkid: 5070 }; // NAD_1983_Contiguous_USA_Albers

  mainView.extent = {
    spatialReference: { wkid: 5070 },
    xmax: 2509023.707827233,
    xmin: -2653731.9709321214,
    ymax: 3559175.355988472,
    ymin: -508240.95013321936
  }

  mainView.constraints = {
    rotationEnabled: false,
    minScale: 18000000,
    maxScale: 2000000,
    geometry: mainView.extent
  };

  // --- Create Alaska and Hawaii inset views ---
  const alaskaView = new MapView({
    container: "alaskaMap",
    map: map,
    spatialReference: { wkid: 5936 },
    extent: new Extent({
      spatialReference: { wkid: 5936 },
      xmin: -280000,
      ymin: -2500000,
      xmax: 3600000,
      ymax: 350000
    }),
    constraints: {
      rotationEnabled: false,
      minScale: 50000000,
      maxScale: 5000000,
      geometry: new Extent({
        spatialReference: { wkid: 5936 },
        xmin: -280000,
        ymin: -2500000,
        xmax: 3600000,
        ymax: 350000
      })
    },
    ui: { components: [] },
    popupEnabled: false
  });

  const hawaiiView = new MapView({
    container: "hawaiiMap",
    map: map,
    spatialReference: { wkid: 102007 },
    extent: new Extent({
      spatialReference: { wkid: 102007 },
      xmin: -470000,
      ymin: 440000,
      xmax: 400000,
      ymax: 1200000
    }),
    constraints: {
      rotationEnabled: false,
      minScale: 45000000,
      maxScale: 500000,
      geometry: new Extent({
        spatialReference: { wkid: 102007 },
        xmin: -470000,
        ymin: 440000,
        xmax: 400000,
        ymax: 1200000
      })
    },
    ui: { components: [] },
    popupEnabled: false
  });

  // --- Add custom layers (lines, points) to the map ---
  appState.linesLayer = new GraphicsLayer({ listMode: "hide" });
  appState.pointsLayer = new GraphicsLayer({ listMode: "hide" });
  map.addMany([appState.linesLayer, appState.pointsLayer]);

  function syncFlowAndRendererStyling() {
    const activeTool = document.getElementById("analysis-tool-tabs")?.value || "summary";
    const isFlowActive = activeTool === "flow" && Boolean(appState.lastPolygonGraphic);
    const shouldEnhance = isFlowActive && Boolean(appState.rendererModeActive);

    const polygonOpacity = shouldEnhance ? 0.70 : 1;
    if (stateLayer) stateLayer.opacity = polygonOpacity;
    if (countyLayer) countyLayer.opacity = polygonOpacity;

    if (appState.linesLayer) {
      appState.linesLayer.effect = shouldEnhance
        ? "drop-shadow(0px 1px 2px rgba(15, 23, 42, 0.35))"
        : null;
    }
  }

  const migrationToggle = document.getElementById("migration-toggle");
  const migrationToolsPanel = document.getElementById("migration-tools-panel");

  if (migrationToggle && migrationToolsPanel) {
    migrationToggle.addEventListener("calciteSwitchChange", (event) => {
      const enabled = event.target.checked;
      migrationToolsPanel.style.display = enabled ? "block" : "none";
      if (!enabled) {
        if (appState.linesLayer) appState.linesLayer.removeAll();
        if (appState.pointsLayer) appState.pointsLayer.removeAll();
      }

      syncFlowAndRendererStyling();

      syncFlowDirectionChartVisibility();
    });
  }

  // access state/county layers by title
  stateLayer = map.layers.find(layer => layer.title === "State Migration Data");
  countyLayer = map.layers.find(layer => layer.title === "County Migration Data");
  stateLayer.outFields = ["*"];
  countyLayer.outFields = ["*"];

  // create layers for comparison (hide in legend)
  const stateLayerCompare = new FeatureLayer({
    url: stateLayer.url,
    id: "stateLayerCompare",
    title: "State Migration Data Comparison",
    visible: false,
    listMode: "hide"
  });
  const countyLayerCompare = new FeatureLayer({
    url: countyLayer.url,
    id: "countyLayerCompare",
    title: "County Migration Data Comparison",
    visible: false,
    listMode: "hide"
  });
  map.addMany([stateLayerCompare, countyLayerCompare]);

  // references
  appState.mainView = mainView;
  appState.alaskaView = alaskaView;
  appState.hawaiiView = hawaiiView;
  appState.stateLayerMain = stateLayer;
  appState.countyLayerMain = countyLayer;

  setupActionBarToggle(mainView);
  showShellAndHideLoader();
  setupSlider(drawLines);
  setupAboutDialog();
  setupMigrationMappingUI({
    mapId: "mainMap",
    getTargetLayers: () => [stateLayer, countyLayer].filter(Boolean),
    onRendererModeChange: (active) => {
      appState.rendererModeActive = Boolean(active);
      syncFlowAndRendererStyling();
    }
  });
  setupSwipeCompareComponent({
    mapView: mainView,
    getStateLayer: () => stateLayer,
    getCountyLayer: () => countyLayer,
    getStateLayerCompare: () => stateLayerCompare,
    getCountyLayerCompare: () => countyLayerCompare
  });

  const analysisToolTabs = document.getElementById("analysis-tool-tabs");
  const mapSurface = document.getElementById("map-surface");
  const mapRenderControls = document.getElementById("map-render-controls");
  const analysisEmptyState = document.getElementById("analysis-empty-state");
  const analysisContent = document.getElementById("analysis-content");
  const analysisSummarySection = document.getElementById("analysis-summary-block");
  const analysisFlowSection = document.getElementById("analysis-flow-section");
  const analysisContributorsSection = document.getElementById("analysis-contributors-section");
  const analysisSwipeSection = document.getElementById("analysis-swipe-section");
  const flowMinSlider = document.getElementById("migration-slider");
  const flowHoverPopupToggle = document.getElementById("flow-hover-popup-toggle");
  const flowLineAnimationToggle = document.getElementById("flow-line-animation-toggle");
  const contributorsThresholdInput = document.getElementById("contributors-threshold");

  const analysisGeography = document.getElementById("analysis-geography");
  const chipGeo = document.getElementById("chip-geo");
  const chipYear = document.getElementById("chip-year");
  const chipTool = document.getElementById("chip-tool");
  const analysisTopSources = document.getElementById("analysis-top-sources");
  const analysisTopDestinations = document.getElementById("analysis-top-destinations");
  const analysisTopSourcesTitle = document.getElementById("analysis-top-sources-title");
  const analysisTopDestinationsTitle = document.getElementById("analysis-top-destinations-title");
  const analysisContributorsTitle = document.getElementById("analysis-contributors-title");
  const contributorsCountLabel = document.getElementById("contributors-count-label");
  const contributorsTopTitle = document.getElementById("contributors-top-title");
  const analysisNonMigrants = document.getElementById("analysis-non-migrants");
  const analysisChartInflow = document.getElementById("analysis-chart-inflow");
  const analysisChartOutflow = document.getElementById("analysis-chart-outflow");
  const analysisChartNet = document.getElementById("analysis-chart-net");
  const analysisChartInflowValue = document.getElementById("analysis-chart-inflow-value");
  const analysisChartOutflowValue = document.getElementById("analysis-chart-outflow-value");
  const analysisChartNetValue = document.getElementById("analysis-chart-net-value");
  const analysisTopFlows = document.getElementById("analysis-top-flows");
  const contributorsCount = document.getElementById("contributors-count");
  const contributorsRepresented = document.getElementById("contributors-represented");
  const contributorsTopList = document.getElementById("contributors-top-list");
  const flowDirectionAggregationToggle = document.getElementById("flow-direction-aggregation-toggle");
  const flowDirectionChart = createFlowDirectionChart();

  const syncRightOverlayOffsets = () => {
    if (!mapSurface || !mapRenderControls) return;
    const height = mapRenderControls.offsetHeight || 0;
    mapSurface.style.setProperty("--map-render-controls-height", `${height}px`);
  };

  syncRightOverlayOffsets();
  if (typeof ResizeObserver !== "undefined" && mapRenderControls) {
    const overlayObserver = new ResizeObserver(() => {
      syncRightOverlayOffsets();
    });
    overlayObserver.observe(mapRenderControls);
  }

  const isMigrationToolEnabled = () => {
    const toggle = document.getElementById("migration-toggle");
    return toggle ? toggle.checked : true;
  };

  const syncFlowDirectionChartVisibility = () => {
    const shouldShow = isMigrationToolEnabled() && (analysisToolTabs?.value === "flow");
    if (!shouldShow) {
      flowDirectionChart.clear({ hideCard: true });
      return;
    }

    flowDirectionChart.setVisible(true);
    if (!appState.lastPolygonGraphic) {
      flowDirectionChart.clear({
        message: "Select a geography in Flow mode to summarize movement direction."
      });
    }
  };

  const getDefaultContributorsThreshold = (geoLevel) =>
    geoLevel === "state" ? appState.stateThreshold : appState.countyThreshold;

  const syncContributorsThresholdInput = (geoLevel) => {
    if (!contributorsThresholdInput) return;
    contributorsThresholdInput.value = String(getDefaultContributorsThreshold(geoLevel));
  };

  const yearSelect = document.getElementById("analysis-year-select");
  const highlightYearSelect = document.getElementById("highlight-year-select");
  if (yearSelect) {
    selectedYear = yearSelect.value || "2223";
    if (highlightYearSelect) highlightYearSelect.value = selectedYear;
    if (chipYear) chipYear.textContent = yearLabel[selectedYear] || "2022-2023";
  }

  const getFieldValue = (attributes, fieldName) => {
    if (!attributes || !fieldName) return null;
    if (fieldName in attributes) return attributes[fieldName];
    const key = Object.keys(attributes).find((k) => k.toLowerCase() === fieldName.toLowerCase());
    return key ? attributes[key] : null;
  };

  const getMetricValue = (attributes, prefix) => {
    const yearFallbackOrder = [selectedYear, "2021", "2122", "2223"];
    for (const year of yearFallbackOrder) {
      const value = getFieldValue(attributes, `${prefix}${year}`);
      if (value != null) return value;
    }
    return 0;
  };

  const formatNumber = (value) => Number(value || 0).toLocaleString();

  const formatSigned = (value) => {
    const numberValue = Number(value || 0);
    return `${numberValue >= 0 ? "+" : "-"}${Math.abs(numberValue).toLocaleString()}`;
  };

  const renderRankedList = (container, items) => {
    if (!container) return;
    container.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      container.appendChild(li);
    });
  };

  const syncAnalysisContextChips = () => {
    const geoLabel = appState.geoLevel === "county" ? "County" : "State";
    const activeTool = analysisToolTabs?.value || "summary";
    const toolLabel = activeTool === "flow"
      ? "Flow"
      : activeTool === "contributors"
        ? "Contributors"
        : activeTool === "swipe"
          ? "Swipe"
          : "Summary";

    if (chipGeo) chipGeo.textContent = geoLabel;
    if (chipYear) chipYear.textContent = yearLabel[selectedYear] || "2022-2023";
    if (chipTool) chipTool.textContent = toolLabel;
  };

  const setAnalysisSelectionState = (hasSelection) => {
    if (analysisEmptyState) analysisEmptyState.hidden = hasSelection;
    if (analysisContent) analysisContent.hidden = !hasSelection;
  };

  const updateGeographyTextLabels = (geoLevel) => {
    const placeLabel = geoLevel === "county" ? "Counties" : "States";
    const placeLabelSingular = geoLevel === "county" ? "County" : "State";

    if (analysisTopSourcesTitle) analysisTopSourcesTitle.textContent = `Top Source ${placeLabel}`;
    if (analysisTopDestinationsTitle) analysisTopDestinationsTitle.textContent = `Top Destination ${placeLabel}`;
    if (analysisContributorsTitle) analysisContributorsTitle.textContent = `${placeLabelSingular} Contributor Analysis`;
    if (contributorsCountLabel) contributorsCountLabel.textContent = `Highlighted ${placeLabel}`;
    if (contributorsTopTitle) contributorsTopTitle.textContent = `Top Contributing ${placeLabel}`;
    if (chipGeo) chipGeo.textContent = placeLabelSingular;
  };

  const normalizeValue = (value) => String(value ?? "").trim().toLowerCase();

  const isSelfMigrationFeature = (attributes = {}) => {
    const fieldPairs = [
      ["y1_state_fips", "y2_state_fips"],
      ["y1_county_fips", "y2_county_fips"],
      ["originfips", "destinationfips"],
      ["origin_fips", "destination_fips"]
    ];

    for (const [originField, destinationField] of fieldPairs) {
      const originValue = getFieldValue(attributes, originField);
      const destinationValue = getFieldValue(attributes, destinationField);
      if (originValue != null && destinationValue != null && normalizeValue(originValue) === normalizeValue(destinationValue)) {
        return true;
      }
    }

    const originName = getFieldValue(attributes, "originName") ?? getFieldValue(attributes, "y1_state_name") ?? getFieldValue(attributes, "y1_countyname");
    const destinationName = getFieldValue(attributes, "destinationName") ?? getFieldValue(attributes, "y2_state_name") ?? getFieldValue(attributes, "y2_countyname");

    return Boolean(originName && destinationName && normalizeValue(originName) === normalizeValue(destinationName));
  };

  const renderSummaryChart = (inflow, outflow, net) => {
    const maxValue = Math.max(1, inflow, outflow, Math.abs(net));
    const inflowPct = Math.max(6, Math.round((inflow / maxValue) * 100));
    const outflowPct = Math.max(6, Math.round((outflow / maxValue) * 100));
    const netPct = Math.max(6, Math.round((Math.abs(net) / maxValue) * 100));

    if (analysisChartInflow) analysisChartInflow.style.width = `${inflowPct}%`;
    if (analysisChartOutflow) analysisChartOutflow.style.width = `${outflowPct}%`;

    if (analysisChartNet) {
      analysisChartNet.style.width = `${netPct}%`;
      analysisChartNet.classList.remove("analysis-chart-bar-net-positive", "analysis-chart-bar-net-negative");
      analysisChartNet.classList.add(net >= 0 ? "analysis-chart-bar-net-positive" : "analysis-chart-bar-net-negative");
    }

    if (analysisChartInflowValue) analysisChartInflowValue.textContent = formatNumber(inflow);
    if (analysisChartOutflowValue) analysisChartOutflowValue.textContent = formatNumber(outflow);
    if (analysisChartNetValue) analysisChartNetValue.textContent = formatSigned(net);
  };

  const normalizeFipsForGeo = (value, geoLevel) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return geoLevel === "state" ? text.padStart(2, "0") : text.padStart(5, "0");
  };

  const looksLikeFipsLabel = (value, geoLevel) => {
    const text = String(value ?? "").trim();
    if (!text) return false;
    if (!/^\d+$/.test(text)) return false;
    return geoLevel === "state" ? text.length <= 2 : text.length <= 5;
  };

  const getFieldCaseInsensitive = (attributes, fieldName) => {
    if (!attributes || !fieldName) return undefined;
    if (fieldName in attributes) return attributes[fieldName];
    const key = Object.keys(attributes).find((candidate) => candidate.toLowerCase() === fieldName.toLowerCase());
    return key ? attributes[key] : undefined;
  };

  const getFirstFieldValue = (attributes, fieldCandidates = []) => {
    for (const fieldName of fieldCandidates) {
      const value = getFieldCaseInsensitive(attributes, fieldName);
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
    return undefined;
  };

  const getRelatedFieldYearTokens = (year = "") => {
    return [String(year)];
  };

  const addYearFieldVariants = (fieldNames = [], year = "2223") => {
    const tokens = getRelatedFieldYearTokens(year);
    const yearVariants = fieldNames.flatMap((fieldName) => tokens.map((token) => `${fieldName}_${token}`));
    return [...new Set([...fieldNames, ...yearVariants])];
  };

  const getFeaturePartnerFips = (attributes = {}, geoLevel, flowDirection, year = "2223") => {
    const directionalPartnerFipsCandidates = geoLevel === "state"
      ? (flowDirection === "inflow"
        ? ["y1_state_fips", "y1_statefips", "origin_state_fips"]
        : ["y2_state_fips", "y2_statefips", "destination_state_fips"])
      : (flowDirection === "inflow"
        ? ["y1_county_fips", "y1_countyfips", "origin_county_fips"]
        : ["y2_county_fips", "y2_countyfips", "destination_county_fips"]);

    const directionalPartnerFipsCandidatesWithYear = addYearFieldVariants(directionalPartnerFipsCandidates, year);
    const partnerFipsCandidates = geoLevel === "state"
      ? [...addYearFieldVariants(["partner_statefips", "partner_fips", "partnerStateFips"], year), ...directionalPartnerFipsCandidatesWithYear]
      : [...addYearFieldVariants(["partner_countyfips", "partner_fips", "partnerCountyFips"], year), ...directionalPartnerFipsCandidatesWithYear];

    return normalizeFipsForGeo(getFirstFieldValue(attributes, partnerFipsCandidates), geoLevel);
  };

  const getFeaturePartnerName = (attributes = {}, geoLevel, flowDirection, year = "2223") => {
    const partnerNameCandidates = geoLevel === "state"
      ? (flowDirection === "inflow"
        ? ["y1_state_name", "partner_state_name", "originName", "NAME", "name"]
        : ["y2_state_name", "partner_state_name", "destinationName", "NAME", "name"])
      : (flowDirection === "inflow"
        ? ["y1_countyname", "y1_county_name", "partner_county_name", "partner_countyname", "originName", "NAME", "name"]
        : ["y2_countyname", "y2_county_name", "partner_county_name", "partner_countyname", "destinationName", "NAME", "name"]);

    return String(getFirstFieldValue(attributes, addYearFieldVariants(partnerNameCandidates, year)) ?? "").trim();
  };

  const getNonMigrantsValue = (attributes = {}, year = "2223") => {
    const inCandidates = addYearFieldVariants([
      "in_nonmigrants_n2",
      "in_nonmigrants"
    ], year);
    const outCandidates = addYearFieldVariants([
      "out_nonmigrants_n2",
      "out_nonmigrants"
    ], year);

    const inValue = Number(getFirstFieldValue(attributes, inCandidates));
    if (Number.isFinite(inValue) && inValue >= 0) {
      return inValue;
    }

    const outValue = Number(getFirstFieldValue(attributes, outCandidates));
    if (Number.isFinite(outValue) && outValue >= 0) {
      return outValue;
    }

    return null;
  };

  const queryTopPartnersByYear = async ({
    geoLevel,
    layer,
    objectId,
    selectedFips,
    direction,
    year = "2223",
    relationshipId = 0
  }) => {
    if (!layer || typeof layer.queryRelatedFeatures !== "function") {
      return { topNames: [], nonMigrants: 0 };
    }

    const relatedResults = await layer.queryRelatedFeatures({
      relationshipId,
      objectIds: [objectId],
      outFields: ["*"]
    });

    const records = relatedResults?.[objectId]?.features || [];
    if (!records.length) return { topNames: [], nonMigrants: 0 };

    const directionalPartnerFipsCandidates = geoLevel === "state"
      ? (direction === "inflow"
        ? ["y1_state_fips", "y1_statefips", "origin_state_fips"]
        : ["y2_state_fips", "y2_statefips", "destination_state_fips"])
      : (direction === "inflow"
        ? ["y1_county_fips", "y1_countyfips", "origin_county_fips"]
        : ["y2_county_fips", "y2_countyfips", "destination_county_fips"]);
    const directionalPartnerFipsCandidatesWithYear = addYearFieldVariants(directionalPartnerFipsCandidates, year);

    const partnerFipsCandidates = geoLevel === "state"
      ? [...addYearFieldVariants(["partner_statefips", "partner_fips", "partnerStateFips"], year), ...directionalPartnerFipsCandidatesWithYear]
      : [...addYearFieldVariants(["partner_countyfips", "partner_fips", "partnerCountyFips"], year), ...directionalPartnerFipsCandidatesWithYear];

    const partnerNameCandidates = geoLevel === "state"
      ? (direction === "inflow"
        ? ["y1_state_name", "partner_state_name", "originName", "NAME", "name"]
        : ["y2_state_name", "partner_state_name", "destinationName", "NAME", "name"])
      : (direction === "inflow"
        ? ["y1_countyname", "y1_county_name", "partner_county_name", "partner_countyname", "originName", "NAME", "name"]
        : ["y2_countyname", "y2_county_name", "partner_county_name", "partner_countyname", "destinationName", "NAME", "name"]);
    const partnerNameCandidatesWithYear = addYearFieldVariants(partnerNameCandidates, year);

    const valueCandidates = direction === "inflow"
      ? addYearFieldVariants(["IN_n2", "in_n2"], year)
      : addYearFieldVariants(["OUT_n2", "out_n2"], year);

    let nonMigrants = 0;
    const partnerTotals = new Map();

    records.forEach((feature) => {
      const attrs = feature.attributes || {};
      const rawPartnerFips = getFirstFieldValue(attrs, partnerFipsCandidates);
      const partnerFips = normalizeFipsForGeo(rawPartnerFips, geoLevel);
      const partnerName = String(getFirstFieldValue(attrs, partnerNameCandidatesWithYear) ?? "").trim();
      const value = Number(getFirstFieldValue(attrs, valueCandidates) ?? 0);
      if (!Number.isFinite(value) || value <= 0) return;

      if (geoLevel === "county" && !partnerFips) {
        nonMigrants += value;
        return;
      }

      const isSelf = Boolean(partnerFips && partnerFips === selectedFips);
      const isSpecial = isSpecialFlowCode(partnerFips, geoLevel);
      const isNonMigrantLabel = partnerName.toLowerCase().includes("non-migrant");

      if (isSelf || isSpecial || isNonMigrantLabel) {
        nonMigrants += value;
        return;
      }

      const mapKey = partnerFips || partnerName;
      if (!mapKey) return;

      const existing = partnerTotals.get(mapKey) || { fips: partnerFips, name: partnerName || "", value: 0 };
      existing.value += value;
      if (!existing.name && partnerName) existing.name = partnerName;
      if (!existing.fips && partnerFips) existing.fips = partnerFips;
      partnerTotals.set(mapKey, existing);
    });

    const unresolvedFips = [...new Set(
      [...partnerTotals.values()]
        .filter((item) => item.fips && (!item.name || looksLikeFipsLabel(item.name, geoLevel)))
        .map((item) => item.fips)
    )];

    if (unresolvedFips.length) {
      const fipsField = geoLevel === "state" ? "statefips" : "countyfips";
      const whereClause = `${fipsField} IN ('${unresolvedFips.join("','")}')`;
      const nameResult = await layer.queryFeatures({
        where: whereClause,
        outFields: [fipsField, "NAME"],
        returnGeometry: false
      });

      const namesByFips = {};
      nameResult.features.forEach((feature) => {
        const featureFips = normalizeFipsForGeo(feature.attributes?.[fipsField], geoLevel);
        const featureName = String(feature.attributes?.NAME ?? "").trim();
        if (!featureFips || !featureName) return;
        namesByFips[featureFips] = featureName;
      });

      partnerTotals.forEach((item) => {
        if ((!item.name || looksLikeFipsLabel(item.name, geoLevel)) && item.fips && namesByFips[item.fips]) {
          item.name = namesByFips[item.fips];
        }
      });
    }

    const topNames = [...partnerTotals.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((item) => item.name || item.fips)
      .filter(Boolean);

    return { topNames, nonMigrants };
  };

  const updateAnalysisSummary = async (polygonGraphic) => {
    const attrs = polygonGraphic?.attributes || {};
    const geoLevel = stateLayer.visible ? "state" : "county";
    const selectedFips = geoLevel === "state"
      ? String(attrs.statefips || "").padStart(2, "0")
      : String(attrs.countyfips || "").padStart(5, "0");
    const selectedObjectId = attrs.OBJECTID;
    const selectedLayer = geoLevel === "state" ? stateLayer : countyLayer;

    const inflowValue = Number(getMetricValue(attrs, "in_n2_"));
    const outflowValue = Number(getMetricValue(attrs, "out_n2_"));
    const netValue = Number(getMetricValue(attrs, "net_migration_"));

    if (analysisGeography) analysisGeography.textContent = attrs.NAME || "Selected geography";
    updateGeographyTextLabels(geoLevel);
    syncAnalysisContextChips();
    renderSummaryChart(inflowValue, outflowValue, netValue);

    let topSourcesResult = { topNames: [], nonMigrants: 0 };
    let topDestinationsResult = { topNames: [], nonMigrants: 0 };
    try {
      [topSourcesResult, topDestinationsResult] = await Promise.all([
        queryTopPartnersByYear({
          geoLevel,
          layer: selectedLayer,
          objectId: selectedObjectId,
          selectedFips,
          direction: "inflow",
          year: selectedYear
        }),
        queryTopPartnersByYear({
          geoLevel,
          layer: selectedLayer,
          objectId: selectedObjectId,
          selectedFips,
          direction: "outflow",
          year: selectedYear
        })
      ]);
    } catch {
      topSourcesResult = { topNames: [], nonMigrants: 0 };
      topDestinationsResult = { topNames: [], nonMigrants: 0 };
    }

    renderRankedList(analysisTopSources, topSourcesResult.topNames || []);
    renderRankedList(analysisTopDestinations, topDestinationsResult.topNames || []);

    const nonMigrantsFieldValue = getNonMigrantsValue(attrs, selectedYear);
    const nonMigrants = Number.isFinite(nonMigrantsFieldValue)
      ? nonMigrantsFieldValue
      : Number(topSourcesResult.nonMigrants || topDestinationsResult.nonMigrants || 0);
    if (analysisNonMigrants) {
      analysisNonMigrants.textContent = `${formatNumber(nonMigrants)} people did not migrate`;
    }
  };

  const clearFlowOverlays = () => {
    stopFlowLineAnimation();
    if (appState.linesLayer) appState.linesLayer.removeAll();
    if (appState.pointsLayer) appState.pointsLayer.removeAll();
    syncFlowAndRendererStyling();
  };

  const clearContributorHighlight = () => {
    appState.highlightEnabled = false;
    if (stateLayer) stateLayer.featureEffect = null;
    if (countyLayer) countyLayer.featureEffect = null;
    const highlightToggle = document.getElementById("highlight-toggle");
    if (highlightToggle) {
      highlightToggle.checked = false;
    }
  };

  const runFlowAnalysis = async () => {
    syncFlowDirectionChartVisibility();
    if (!isMigrationToolEnabled()) return;

    if (!appState.lastPolygonGraphic) {
      flowDirectionChart.clear({
        message: "Select a geography in Flow mode to summarize movement direction."
      });
      syncFlowAndRendererStyling();
      return;
    }

    const flowDirection = document.getElementById("flow-segmented")?.value || "outflow";
    appState.flowDirection = flowDirection;
    appState.minValue = Number(flowMinSlider?.value || 500);

    if (flowDirection === "inflow") {
      await handleInflow(appState.lastPolygonGraphic, mainView, stateLayer, countyLayer, selectedYear);
    } else {
      await handleOutflow(appState.lastPolygonGraphic, mainView, stateLayer, countyLayer, selectedYear);
    }

    if (analysisTopFlows) {
      const selectedGeoFips = normalizeFipsForGeo(
        appState.geoLevel === "county"
          ? appState.lastPolygonGraphic?.attributes?.countyfips
          : appState.lastPolygonGraphic?.attributes?.statefips,
        appState.geoLevel
      );
      const topFlows = [...(appState.allRelatedFeatures || [])]
        .filter((feature) => {
          const nValue = Number(feature.attributes?.nValue || 0);
          const partnerFips = getFeaturePartnerFips(
            feature.attributes || {},
            appState.geoLevel,
            appState.flowDirection,
            selectedYear
          );
          const partnerName = getFeaturePartnerName(
            feature.attributes || {},
            appState.geoLevel,
            appState.flowDirection,
            selectedYear
          );
          return Number.isFinite(nValue)
            && nValue > 0
            && nValue >= appState.minValue
            && !isSpecialFlowCode(partnerFips)
            && partnerFips !== selectedGeoFips
            && !partnerName.toLowerCase().includes("non-migrant")
            && !isSelfMigrationFeature(feature.attributes);
        })
        .sort((a, b) => Number(b.attributes?.nValue || 0) - Number(a.attributes?.nValue || 0))
        .slice(0, 3)
        .map((feature) => {
          const name = appState.flowDirection === "inflow"
            ? feature.attributes?.originName
            : feature.attributes?.destinationName;
          const value = Number(feature.attributes?.nValue || 0).toLocaleString();
          return `${name || "Unknown"} — ${value}`;
        });

      renderRankedList(analysisTopFlows, topFlows);
    }

    const selectedLabel = appState.geoLevel === "county"
      ? (appState.selectedCountyName || "Selected county")
      : (appState.selectedStateName || "Selected state");

    await flowDirectionChart.update({
      features: appState.allRelatedFeatures || [],
      flowDirection: appState.flowDirection,
      minValue: appState.minValue,
      aggregation: flowDirectionAggregationToggle?.value === "migrants" ? "migrants" : "count",
      selectedLabel,
      visible: true
    });

    syncFlowAndRendererStyling();
  };

  const runContributorsAnalysis = async () => {
    if (!lastSelectedStateFips || !lastSelectedObjectId) return;

    appState.highlightEnabled = true;
    const flowType = document.getElementById("highlight-flow-toggle")?.value || "inflow";
    const geoLevel = stateLayer.visible ? "state" : "county";
    const defaultThreshold = getDefaultContributorsThreshold(geoLevel);
    const parsedThreshold = Number(contributorsThresholdInput?.value);
    const threshold = Number.isFinite(parsedThreshold) && parsedThreshold >= 0
      ? parsedThreshold
      : defaultThreshold;

    if (geoLevel === "state") {
      appState.stateThreshold = threshold;
    } else {
      appState.countyThreshold = threshold;
    }

    const result = await updateHighlightFlow(
      flowType,
      lastSelectedStateFips,
      lastSelectedObjectId,
      stateLayer,
      countyLayer,
      geoLevel,
      0,
      threshold,
      selectedYear
    );

    if (contributorsCount) contributorsCount.textContent = String(result?.highlightedCount ?? 0);
    if (contributorsRepresented) contributorsRepresented.textContent = `${result?.representedPct ?? 0}%`;
    renderRankedList(contributorsTopList, result?.topContributors || []);
  };

  const setActiveToolSection = (value) => {
    if (analysisSummarySection) analysisSummarySection.hidden = false;
    if (analysisFlowSection) analysisFlowSection.hidden = value !== "flow";
    if (analysisContributorsSection) analysisContributorsSection.hidden = value !== "contributors";
    if (analysisSwipeSection) analysisSwipeSection.hidden = value !== "swipe";
    if (value !== "flow") {
      clearFlowOverlays();
    }
    if (value !== "contributors") {
      clearContributorHighlight();
    }

    syncFlowDirectionChartVisibility();
    syncFlowAndRendererStyling();
  };

  const handleGeographySelection = async (polygonGraphic) => {
    const attrs = polygonGraphic.attributes;
    const geoLevel = stateLayer.visible ? "state" : "county";
    const polygonLayer = geoLevel === "state" ? stateLayer : countyLayer;

    appState.lastPolygonGraphic = polygonGraphic;
    setAnalysisSelectionState(true);
    lastSelectedStateFips = geoLevel === "state"
      ? String(attrs.statefips || "").padStart(2, "0")
      : String(attrs.countyfips || "").padStart(5, "0");
    lastSelectedObjectId = attrs.OBJECTID;

    await applySelectedPolygonHighlights(polygonLayer, lastSelectedObjectId);
    await updateAnalysisSummary(polygonGraphic);

    const tool = analysisToolTabs?.value || "summary";
    if (tool === "flow") {
      await runFlowAnalysis();
    } else if (tool === "contributors") {
      await runContributorsAnalysis();
    }
  };

  const refreshAnalysisForSelection = async (toolValue) => {
    if (!appState.lastPolygonGraphic) return;
    await updateAnalysisSummary(appState.lastPolygonGraphic);
    if (toolValue === "flow") {
      await runFlowAnalysis();
    } else if (toolValue === "contributors") {
      await runContributorsAnalysis();
    }
  };

  window.__refreshAnalysisForSelection = refreshAnalysisForSelection;

  const clearAnalysisSelection = () => {
    appState.lastPolygonGraphic = null;
    lastSelectedStateFips = null;
    lastSelectedObjectId = null;

    clearFlowOverlays();
    clearContributorHighlight();
    clearSelectedPolygonHighlights();
    setAnalysisSelectionState(false);

    if (featureInfoDiv) featureInfoDiv.graphic = null;

    syncFlowDirectionChartVisibility();
  };

  if (analysisToolTabs) {
    analysisToolTabs.addEventListener("calciteSegmentedControlChange", async (event) => {
      const value = event.target.value;
      setActiveToolSection(value);
      syncAnalysisContextChips();
      if (value === "flow") await runFlowAnalysis();
      if (value === "contributors") await runContributorsAnalysis();
    });
    setActiveToolSection(analysisToolTabs.value || "summary");
  }

  flowMinSlider?.addEventListener("calciteSliderInput", async () => {
    if (analysisToolTabs?.value === "flow") {
      await runFlowAnalysis();
    }
  });

  flowMinSlider?.addEventListener("calciteSliderChange", async () => {
    if (analysisToolTabs?.value === "flow") {
      await runFlowAnalysis();
    }
  });

  flowDirectionAggregationToggle?.addEventListener("calciteSegmentedControlChange", async () => {
    if (analysisToolTabs?.value === "flow") {
      await runFlowAnalysis();
    }
  });

  contributorsThresholdInput?.addEventListener("calciteInputNumberChange", async () => {
    const geoLevel = stateLayer?.visible ? "state" : "county";
    const thresholdValue = Number(contributorsThresholdInput?.value);
    if (Number.isFinite(thresholdValue) && thresholdValue >= 0) {
      if (geoLevel === "state") {
        appState.stateThreshold = thresholdValue;
      } else {
        appState.countyThreshold = thresholdValue;
      }
    }

    if (analysisToolTabs?.value === "contributors") {
      await runContributorsAnalysis();
    }
  });

  if (stateLayer && countyLayer) {
    const options = {
      onPolygonSelected: handleGeographySelection,
      onSelectionCleared: clearAnalysisSelection,
      skipDefaultMigration: true
    };
    setupFeatureInfoClick(mainView, featureInfoDiv, stateLayer, countyLayer, options);
    setupFeatureInfoClick(alaskaView, featureInfoDiv, stateLayer, countyLayer, options);
    setupFeatureInfoClick(hawaiiView, featureInfoDiv, stateLayer, countyLayer, options);
  }

  setupLineHoverPopup(mainView);
  setupLineHoverPopup(alaskaView);
  setupLineHoverPopup(hawaiiView);

  const clearSelectedPolygonHighlights = () => {
    selectedPolygonHighlightHandles.forEach((handle) => handle?.remove());
    selectedPolygonHighlightHandles = [];
  };

  const applySelectedPolygonHighlights = async (polygonLayer, objectId) => {
    clearSelectedPolygonHighlights();
    const targetViews = [mainView, alaskaView, hawaiiView];
    const layerViews = await Promise.all(targetViews.map((view) => view.whenLayerView(polygonLayer)));
    selectedPolygonHighlightHandles = layerViews.map((layerView) => layerView.highlight(objectId));
  };

  const flowSegmented = document.getElementById("flow-segmented");
  if (flowSegmented) {
    flowSegmented.addEventListener("calciteSegmentedControlChange", async () => {
      if (analysisToolTabs?.value === "flow") {
        await runFlowAnalysis();
      }
    });
  }

  if (flowHoverPopupToggle) {
    appState.lineHoverPopupEnabled = Boolean(flowHoverPopupToggle.checked || appState.lineHoverPopupEnabled);
    flowHoverPopupToggle.checked = appState.lineHoverPopupEnabled;
    flowHoverPopupToggle.addEventListener("calciteCheckboxChange", (event) => {
      appState.lineHoverPopupEnabled = event.target.checked;
      if (!appState.lineHoverPopupEnabled) {
        const popupDiv = document.getElementById("line-hover-popup");
        if (popupDiv) popupDiv.style.display = "none";
      }
    });
  }

  if (flowLineAnimationToggle) {
    appState.animateFlowLines = Boolean(appState.animateFlowLines);
    flowLineAnimationToggle.checked = appState.animateFlowLines;
    flowLineAnimationToggle.addEventListener("calciteCheckboxChange", async (event) => {
      appState.animateFlowLines = event.target.checked;
      if (!appState.animateFlowLines) {
        stopFlowLineAnimation();
      }
      if (analysisToolTabs?.value === "flow" && appState.lastPolygonGraphic) {
        await runFlowAnalysis();
      }
    });
  }

  const geoLevelSegmented = document.getElementById("geo-level-segmented");
  if (geoLevelSegmented) {
    geoLevelSegmented.addEventListener("calciteSegmentedControlChange", (event) => {
      stopFlowLineAnimation();
      if (appState.linesLayer) appState.linesLayer.removeAll();
      if (appState.pointsLayer) appState.pointsLayer.removeAll();

      if (featureInfoDiv) featureInfoDiv.graphic = null;

      appState.allRelatedFeatures = [];
      appState.selectedStateName = null;
      appState.geoLevel = event.target.value;
      updateGeographyTextLabels(appState.geoLevel);
      syncAnalysisContextChips();

      if (stateLayer) stateLayer.visible = appState.geoLevel === "state";
      if (countyLayer) countyLayer.visible = appState.geoLevel === "county";
      syncContributorsThresholdInput(appState.geoLevel);

      appState.lastPolygonGraphic = null;
      setAnalysisSelectionState(false);
      clearContributorHighlight();
      clearSelectedPolygonHighlights();
      syncFlowDirectionChartVisibility();

      if (appState.highlightHandle) {
        appState.highlightHandle.remove();
        appState.highlightHandle = null;
      }

      const infoBlock = document.getElementById("info-block");
      if (infoBlock) {
        infoBlock.heading = appState.geoLevel === "state" ? "State Information" : "County Information";
        infoBlock.description = appState.geoLevel === "state" ? "Select a State to render pop-up" : "Select a County to render pop-up";
      }

      const slider = document.getElementById("migration-slider");
      if (slider) {
        const defaultStateValue = 2500;
        const defaultCountyValue = 200;
        const newValue = appState.geoLevel === "state" ? defaultStateValue : defaultCountyValue;
        slider.value = newValue;
        appState.minValue = newValue;
        slider.dispatchEvent(new CustomEvent("calciteSliderInput"));
      }
    });
  }

  syncFlowDirectionChartVisibility();

  updateGeographyTextLabels(appState.geoLevel || "state");
  syncAnalysisContextChips();
  syncContributorsThresholdInput(appState.geoLevel || "state");
  setAnalysisSelectionState(false);

  const highlightFlowToggle = document.getElementById("highlight-flow-toggle");
  if (highlightFlowToggle) {
    highlightFlowToggle.addEventListener("calciteSegmentedControlChange", async () => {
      if (analysisToolTabs?.value === "contributors") {
        await runContributorsAnalysis();
      }
    });
  }

  const highlightToggle = document.getElementById("highlight-toggle");
  if (highlightToggle) {
    highlightToggle.addEventListener("calciteSwitchChange", (event) => {
      appState.highlightEnabled = event.target.checked;
      if (!appState.highlightEnabled) {
        if (stateLayer) stateLayer.featureEffect = null;
        if (countyLayer) countyLayer.featureEffect = null;
        clearSelectedPolygonHighlights();
        return;
      }

      if (lastSelectedStateFips && lastSelectedObjectId && analysisToolTabs?.value === "contributors") {
        runContributorsAnalysis();
      }
    });
  }
});
