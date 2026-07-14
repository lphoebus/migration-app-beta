import './style.css'
import { defineCustomElements } from "@esri/calcite-components/dist/loader";
defineCustomElements(window);

import "@arcgis/map-components/dist/components/arcgis-map";
import "@arcgis/map-components/dist/components/arcgis-layer-list";
import "@arcgis/map-components/dist/components/arcgis-legend";
import "@arcgis/map-components/dist/components/arcgis-home";
import "@arcgis/map-components/dist/components/arcgis-zoom";
import "@arcgis/map-components/dist/components/arcgis-bookmarks";
import "@arcgis/map-components/dist/components/arcgis-feature";
import "@arcgis/map-components/dist/components/arcgis-expand";
import "@arcgis/map-components/dist/components/arcgis-swipe";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import Extent from "@arcgis/core/geometry/Extent";

import { appState } from "./app_state";

import {
  setupActionBarToggle,
  showShellAndHideLoader,
  setupSlider,
  setupClearLinesBtn,
  setupResetSliderBtn,
  setupAboutDialog,
  setupPanelController
} from "./ui";

import { drawLines } from "./draw";
import { handleOutflow, handleInflow, handleNetMigration, updateHighlightFlow } from "./migration";
import { setupFeatureInfoClick, setupLineHoverPopup } from "./interactions";
import { setupMigrationMappingUI} from './mapping';
import { setupSwipeCompareComponent } from './swipe';

const featureInfoDiv = document.getElementById("feature-info");

let stateLayer, countyLayer; // Declare variables to hold references to the layers

document.addEventListener("DOMContentLoaded", () => {
  setupPanelController("shell-panel-start");
  setupPanelController("shell-panel-end");
  addYearSelectListener();
});


let lastSelectedStateFips = null; // Track the last selected state FIPS code for flow highlighting
let lastSelectedObjectId = null; // Track the last selected feature's OBJECTID for related queries
let selectedYear = "2122"; // default to 2021-2022 for stable data availability
let selectedPolygonHighlightHandles = [];

const YEAR_LABEL_MAP = {
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
    if (yearChip) yearChip.textContent = YEAR_LABEL_MAP[selectedYear] || "2021-2022";
  }
  if (yearSelect && !yearSelect._listenerAdded) {
    yearSelect.addEventListener("calciteSelectChange", (e) => {
      selectedYear = e.target.value;
      if (yearChip) yearChip.textContent = YEAR_LABEL_MAP[selectedYear] || "2020-2021";
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
mainMap.addEventListener("arcgisViewReadyChange", () => {
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

  const migrationToggle = document.getElementById("migration-toggle");
  const migrationToolsPanel = document.getElementById("migration-tools-panel"); // wrap your migration controls in a div

  if (migrationToggle && migrationToolsPanel) {
    migrationToggle.addEventListener("calciteSwitchChange", (event) => {
      const enabled = event.target.checked;
      migrationToolsPanel.style.display = enabled ? "block" : "none";
      if (!enabled) {
        if (appState.linesLayer) appState.linesLayer.removeAll();
        if (appState.pointsLayer) appState.pointsLayer.removeAll();
      }
    });
  }

  // --- Access state/county layers from the web map if needed ---
  stateLayer = map.layers.find(layer => layer.title === "State Migration Data");
  countyLayer = map.layers.find(layer => layer.title === "County Migration Data");
  stateLayer.outFields = ["*"];
  countyLayer.outFields = ["*"];

  // Create hidden comparison layers (not in legend/layer list)
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

  // --- Store references in appState ---
  appState.mainView = mainView;
  appState.alaskaView = alaskaView;
  appState.hawaiiView = hawaiiView;
  appState.stateLayerMain = stateLayer;
  appState.countyLayerMain = countyLayer;

  setupActionBarToggle(mainView);
  showShellAndHideLoader();
  setupSlider(drawLines);
  setupClearLinesBtn();
  setupResetSliderBtn();
  setupAboutDialog();
  setupMigrationMappingUI({
    mapId: "mainMap",
    getTargetLayers: () => [stateLayer, countyLayer].filter(Boolean),
  });
  setupSwipeCompareComponent({
    mapView: mainView,
    getStateLayer: () => stateLayer,
    getCountyLayer: () => countyLayer,
    getStateLayerCompare: () => stateLayerCompare,
    getCountyLayerCompare: () => countyLayerCompare
  });

  const analysisToolTabs = document.getElementById("analysis-tool-tabs");
  const analysisEmptyState = document.getElementById("analysis-empty-state");
  const analysisContent = document.getElementById("analysis-content");
  const analysisSummarySection = document.getElementById("analysis-summary-block");
  const analysisFlowSection = document.getElementById("analysis-flow-section");
  const analysisContributorsSection = document.getElementById("analysis-contributors-section");
  const analysisSwipeSection = document.getElementById("analysis-swipe-section");
  const flowMinInput = document.getElementById("flow-min-input");
  const flowHoverPopupToggle = document.getElementById("flow-hover-popup-toggle");
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

  const getDefaultContributorsThreshold = (geoLevel) =>
    geoLevel === "state" ? appState.stateThreshold : appState.countyThreshold;

  const syncContributorsThresholdInput = (geoLevel) => {
    if (!contributorsThresholdInput) return;
    contributorsThresholdInput.value = String(getDefaultContributorsThreshold(geoLevel));
  };

  const yearSelect = document.getElementById("analysis-year-select");
  const highlightYearSelect = document.getElementById("highlight-year-select");
  if (yearSelect) {
    selectedYear = yearSelect.value || "2122";
    if (highlightYearSelect) highlightYearSelect.value = selectedYear;
    if (chipYear) chipYear.textContent = YEAR_LABEL_MAP[selectedYear] || "2021-2022";
  }

  const getFieldValue = (attributes, fieldName) => {
    if (!attributes || !fieldName) return null;
    if (fieldName in attributes) return attributes[fieldName];
    const key = Object.keys(attributes).find((k) => k.toLowerCase() === fieldName.toLowerCase());
    return key ? attributes[key] : null;
  };

  const getMetricValue = (attributes, prefix) => {
    const yearFallbackOrder = [selectedYear, "2122", "2021", "2223"];
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
    if (chipYear) chipYear.textContent = YEAR_LABEL_MAP[selectedYear] || "2020-2021";
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

  const getFlowYearSuffix = (year = "2021") => {
    const yearSuffixByYear = {
      "2021": "2020_2021",
      "2122": "2021_2022",
      "2223": "2022_2023"
    };
    return yearSuffixByYear[year] || "2021_2022";
  };

  const queryTopPartnersByYear = async ({ geoLevel, selectedFips, direction, year = "2122" }) => {
    const yearSuffix = getFlowYearSuffix(year);
    const defaultYearSuffix = "2021_2022";

    const configByGeo = {
      state: {
        inflow: {
          url: `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/state_inflow_${yearSuffix}_centroids/FeatureServer`,
          whereField: "y2_state_fips",
          nameField: "y1_state_name",
          partnerField: "y1_state_fips"
        },
        outflow: {
          url: `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/state_outflow_${yearSuffix}_centroids/FeatureServer`,
          whereField: "y1_state_fips",
          nameField: "y2_state_name",
          partnerField: "y2_state_fips"
        }
      },
      county: {
        inflow: {
          url: `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/county_inflow_${yearSuffix}_centroids/FeatureServer`,
          whereField: "y2_county_fips",
          nameField: "y1_countyname",
          partnerField: "y1_county_fips"
        },
        outflow: {
          url: `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/county_outflow_${yearSuffix}_centroids/FeatureServer`,
          whereField: "y1_county_fips",
          nameField: "y2_countyname",
          partnerField: "y2_county_fips"
        }
      }
    };

    const config = configByGeo[geoLevel]?.[direction];
    if (!config) return { topNames: [], nonMigrants: 0 };

    const queryForUrl = async (url) => {
      const layer = new FeatureLayer({ url });
      const query = layer.createQuery();
      query.where = `${config.whereField} = '${selectedFips}'`;
      query.outFields = [config.nameField, config.partnerField, "n2"];
      query.returnGeometry = false;
      query.orderByFields = ["n2 DESC"];
      query.num = 100;
      return layer.queryFeatures(query);
    };

    let result;
    try {
      result = await queryForUrl(config.url);
    } catch {
      const fallbackUrl = config.url.replace(yearSuffix, defaultYearSuffix);
      result = await queryForUrl(fallbackUrl);
    }

    let nonMigrants = 0;
    const rankedPartners = [];

    result.features.forEach((feature) => {
      const attrs = feature.attributes || {};
      const partnerFips = String(attrs[config.partnerField] ?? "").trim();
      const partnerName = String(attrs[config.nameField] ?? "").trim();
      const value = Number(attrs.n2 || 0);

      if ((partnerFips && partnerFips === selectedFips) || partnerName.toLowerCase().includes("non-migrant")) {
        nonMigrants += value;
        return;
      }

      if (partnerName) {
        rankedPartners.push({ name: partnerName, value });
      }
    });

    const topNames = rankedPartners
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((item) => item.name);

    return { topNames, nonMigrants };
  };

  const updateAnalysisSummary = async (polygonGraphic) => {
    const attrs = polygonGraphic?.attributes || {};
    const geoLevel = stateLayer.visible ? "state" : "county";
    const selectedFips = geoLevel === "state"
      ? String(attrs.statefips || "").padStart(2, "0")
      : String(attrs.countyfips || "").padStart(5, "0");

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
        queryTopPartnersByYear({ geoLevel, selectedFips, direction: "inflow", year: selectedYear }),
        queryTopPartnersByYear({ geoLevel, selectedFips, direction: "outflow", year: selectedYear })
      ]);
    } catch {
      topSourcesResult = { topNames: [], nonMigrants: 0 };
      topDestinationsResult = { topNames: [], nonMigrants: 0 };
    }

    renderRankedList(analysisTopSources, topSourcesResult.topNames || []);
    renderRankedList(analysisTopDestinations, topDestinationsResult.topNames || []);

    const nonMigrants = Number(topSourcesResult.nonMigrants || topDestinationsResult.nonMigrants || 0);
    if (analysisNonMigrants) {
      analysisNonMigrants.textContent = `${formatNumber(nonMigrants)} people did not migrate`;
    }
  };

  const clearFlowOverlays = () => {
    if (appState.linesLayer) appState.linesLayer.removeAll();
    if (appState.pointsLayer) appState.pointsLayer.removeAll();
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
    if (!appState.lastPolygonGraphic) return;
    const flowDirection = document.getElementById("flow-segmented")?.value || "outflow";
    appState.flowDirection = flowDirection;
    appState.minValue = Number(flowMinInput?.value || 500);

    if (flowDirection === "inflow") {
      await handleInflow(appState.lastPolygonGraphic, mainView, stateLayer, countyLayer, selectedYear);
    } else {
      await handleOutflow(appState.lastPolygonGraphic, mainView, stateLayer, countyLayer, selectedYear);
    }

    if (analysisTopFlows) {
      const topFlows = [...(appState.allRelatedFeatures || [])]
        .filter((feature) => !isSelfMigrationFeature(feature.attributes))
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

  flowMinInput?.addEventListener("calciteInputNumberChange", async () => {
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

  const geoLevelSegmented = document.getElementById("geo-level-segmented");
  if (geoLevelSegmented) {
    geoLevelSegmented.addEventListener("calciteSegmentedControlChange", (event) => {
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
        const defaultCountyValue = 100;
        const newValue = appState.geoLevel === "state" ? defaultStateValue : defaultCountyValue;
        slider.value = newValue;
        appState.minValue = newValue;
        slider.dispatchEvent(new CustomEvent("calciteSliderInput"));
      }
    });
  }

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
