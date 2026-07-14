import * as colorRendererCreator from "@arcgis/core/smartMapping/renderers/color";
import {getSchemes} from "@arcgis/core/smartMapping/symbology/color";
import { rendererOptionsByField } from "./renderer_definitions.js";

const rendererCache = {};
const originalRendererByLayer = new WeakMap();
const RENDERER_CACHE_VERSION = "v4";

export function cacheOriginalRenderersForLayers(layers = []) {
  layers.forEach((layer) => {
    if (!layer || originalRendererByLayer.has(layer)) return;
    const originalRenderer = layer.renderer;
    originalRendererByLayer.set(
      layer,
      originalRenderer?.clone ? originalRenderer.clone() : originalRenderer
    );
  });
}

export function resetRenderersForLayers(layers = []) {
  layers.forEach((layer) => {
    if (!layer || !originalRendererByLayer.has(layer)) return;
    const originalRenderer = originalRendererByLayer.get(layer);
    layer.renderer = originalRenderer?.clone ? originalRenderer.clone() : originalRenderer;
  });
}


// --- Smart mapping options config ---
export const allFields = [
  { label: "Inflow", value: "in_n2_" },
  { label: "Outflow", value: "out_n2_" },
  { label: "Net Migration", value: "net_migration_" },
  { label: "Rate of Inflow", value: "in_", suffix: "_rate" },
  { label: "Rate of Outflow", value: "out_", suffix: "_rate" },
  { label: "Rate of Net Migration", value: "net_", suffix: "_rate" }
];

const YEAR_LABEL_MAP = {
  "2021": "2020-2021",
  "2122": "2021-2022",
  "2223": "2022-2023"
};

function extractYearCode(field = "") {
  const match = String(field).match(/(2021|2122|2223)/);
  return match?.[1] || "2223";
}

function extractGeoLevelFromLayer(layer) {
  const layerId = String(layer?.id || "").toLowerCase();
  const layerTitle = String(layer?.title || "").toLowerCase();
  if (layerId.includes("county") || layerTitle.includes("county")) return "county";
  return "state";
}

function normalizeStopValues(stopValues) {
  if (!stopValues || typeof stopValues !== "object") return [];
  const low = stopValues.lowest ?? stopValues.low;
  const mid = stopValues.middle ?? stopValues.mid;
  const high = stopValues.highest ?? stopValues.high;
  return [low, mid, high].filter((value) => value != null).map((value) => ({ value }));
}

function normalizeStopCollection(configured) {
  if (!configured) return [];
  if (Array.isArray(configured)) {
    return configured
      .filter((stop) => stop != null)
      .map((stop) => (typeof stop === "number" ? { value: stop } : stop));
  }
  return normalizeStopValues(configured);
}

function getConfiguredStops(rendererOptions = {}, yearCode = "2223", geoLevel = "state") {
  const geoKey = geoLevel === "county" ? "county" : "state";

  const customStopsByGeoByYear = rendererOptions.customStopsByGeoByYear?.[geoKey]?.[yearCode];
  if (customStopsByGeoByYear) return normalizeStopCollection(customStopsByGeoByYear);

  const customStopsByGeo = rendererOptions.customStopsByGeo?.[geoKey];
  if (customStopsByGeo) return normalizeStopCollection(customStopsByGeo);

  const customStopsByYear = rendererOptions.customStopsByYear?.[yearCode];
  if (customStopsByYear) return normalizeStopCollection(customStopsByYear);

  if (rendererOptions.customStops) return normalizeStopCollection(rendererOptions.customStops);

  const stopValuesByGeoByYear = rendererOptions.stopValuesByGeoByYear?.[geoKey]?.[yearCode];
  if (stopValuesByGeoByYear) return normalizeStopCollection(stopValuesByGeoByYear);

  const stopValuesByGeo = rendererOptions.stopValuesByGeo?.[geoKey];
  if (stopValuesByGeo) return normalizeStopCollection(stopValuesByGeo);

  const yearStopValues = rendererOptions.stopValuesByYear?.[yearCode];
  if (yearStopValues) return normalizeStopCollection(yearStopValues);

  if (rendererOptions.stopValues) return normalizeStopCollection(rendererOptions.stopValues);
  return [];
}

function normalizeRampColors(colors) {
  if (!Array.isArray(colors)) return [];
  return colors.filter((color) => color != null);
}

function getConfiguredRampColors(rendererOptions = {}, yearCode = "2223", geoLevel = "state") {
  const geoKey = geoLevel === "county" ? "county" : "state";

  const byGeoByYear = rendererOptions.rampColorsByGeoByYear?.[geoKey]?.[yearCode];
  if (byGeoByYear) return normalizeRampColors(byGeoByYear);

  const byGeo = rendererOptions.rampColorsByGeo?.[geoKey];
  if (byGeo) return normalizeRampColors(byGeo);

  const byYear = rendererOptions.rampColorsByYear?.[yearCode];
  if (byYear) return normalizeRampColors(byYear);

  return normalizeRampColors(rendererOptions.rampColors);
}

function pickRampColor(rampColors = [], index = 0, total = 1) {
  if (!rampColors.length) return null;
  if (rampColors.length === 1) return rampColors[0];
  if (total <= 1) return rampColors[0];

  const ratio = index / (total - 1);
  const colorIndex = Math.round(ratio * (rampColors.length - 1));
  return rampColors[Math.max(0, Math.min(colorIndex, rampColors.length - 1))];
}

// Helper: get the active layer (state or county)
export function getActiveLayer(getTargetLayers) {
  const layers = getTargetLayers();
  return layers.find(layer => layer.visible);
}

// Helper: build the correct field name (handles rate fields)
export function getFieldName(fieldObj, year) {
  if (fieldObj.suffix) {
    return `${fieldObj.value}${year}${fieldObj.suffix}`;
  }
  return `${fieldObj.value}${year}`;
}

// --- UI Wiring for Migration Mapping ---
export function setupMigrationMappingUI({ mapId = "mainMap", getTargetLayers }) {
  const mapEl = document.getElementById(mapId);
  const yearSelect = document.getElementById("analysis-year-select");
  const resetRendererBtn = document.getElementById("reset-renderer-btn");
  const mapRenderLegend = document.getElementById("map-render-legend");
  let activeRendererMode = null;

  // Main metric buttons
  const inflowBtn = document.getElementById("inflow-btn");
  const outflowBtn = document.getElementById("outflow-btn");
  const netBtn = document.getElementById("net-btn");

  // Rate buttons
  const rateInflowBtn = document.getElementById("rate-inflow-btn");
  const rateOutflowBtn = document.getElementById("rate-outflow-btn");
  const rateNetBtn = document.getElementById("rate-net-btn");

  function getYear() {
    return yearSelect?.value || "2223";
  }

  function getSelectedYearLabel() {
    return YEAR_LABEL_MAP[getYear()] || getYear();
  }

  function getLegendModeLabel(mode) {
    const labelByMode = {
      inflow: "Inflow",
      outflow: "Outflow",
      net: "Net Migration",
      "rate-inflow": "Rate Inflow",
      "rate-outflow": "Rate Outflow",
      "rate-net": "Rate Net"
    };
    return labelByMode[mode] || "Migration";
  }

  function getLegendUnitLabel(mode) {
    return String(mode || "").startsWith("rate-") ? "per 1,000 people" : "";
  }

  function colorToCss(color) {
    if (!color) return "var(--calcite-color-border-2)";
    if (typeof color === "string") return color;
    if (Array.isArray(color)) {
      const [r = 0, g = 0, b = 0, a = 1] = color;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (typeof color?.toCss === "function") return color.toCss();
    if (typeof color?.toHex === "function") return color.toHex();
    if (typeof color?.r === "number" && typeof color?.g === "number" && typeof color?.b === "number") {
      const alpha = typeof color?.a === "number" ? color.a : 1;
      return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
    }
    return "var(--calcite-color-border-2)";
  }

  function formatLegendNumber(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "0";
    return Math.abs(numberValue) >= 1000
      ? Math.round(numberValue).toLocaleString()
      : numberValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function getBoundaryLegendLabels(stops = []) {
    if (!stops.length) {
      return { minLabel: "", midLabel: "", maxLabel: "" };
    }

    const firstStop = stops[0];
    const middleStop = stops[Math.floor(stops.length / 2)];
    const lastStop = stops[stops.length - 1];

    return {
      minLabel: firstStop?.label || `< ${formatLegendNumber(firstStop?.value)}`,
      midLabel: middleStop?.label || formatLegendNumber(middleStop?.value),
      maxLabel: lastStop?.label || `> ${formatLegendNumber(lastStop?.value)}`
    };
  }

  function clearDynamicLegend() {
    if (!mapRenderLegend) return;
    mapRenderLegend.innerHTML = "";
    mapRenderLegend.hidden = true;
  }

  function renderDynamicLegend(renderer, mode) {
    if (!mapRenderLegend || !renderer) return;

    const visualVariable = renderer.visualVariables?.[0];
    const legendTitle = getLegendModeLabel(mode);
    const legendUnitLabel = getLegendUnitLabel(mode);
    const yearLabel = getSelectedYearLabel();
    const stops = visualVariable?.stops || [];

    if (!visualVariable || stops.length === 0) {
      clearDynamicLegend();
      return;
    }

    if (visualVariable.type === "color") {
      const gradientStops = stops.length > 1
        ? stops
          .map((stop, index) => {
            const pct = Math.round((index / (stops.length - 1)) * 100);
            return `${colorToCss(stop?.color)} ${pct}%`;
          })
          .join(", ")
        : `${colorToCss(stops[0]?.color)} 0%, ${colorToCss(stops[0]?.color)} 100%`;

      const { minLabel, midLabel, maxLabel } = getBoundaryLegendLabels(stops);

      mapRenderLegend.innerHTML = `
        <div class="map-render-legend-header">${legendTitle} <span class="map-render-legend-year">(${yearLabel})</span></div>
        ${legendUnitLabel ? `<div class="map-render-legend-unit">${legendUnitLabel}</div>` : ""}
        <div class="map-render-legend-ramp" style="background: linear-gradient(90deg, ${gradientStops});"></div>
        <div class="map-render-legend-ramp-labels">
          <span>${minLabel}</span>
          <span>${midLabel}</span>
          <span>${maxLabel}</span>
        </div>
      `;
      mapRenderLegend.hidden = false;
      return;
    }

    const pickStops = [stops[0], stops[Math.floor(stops.length / 2)], stops[stops.length - 1]].filter(Boolean);
    const { minLabel, midLabel, maxLabel } = getBoundaryLegendLabels(pickStops);
    const boundaryLabels = [minLabel, midLabel, maxLabel];
    const rowsHtml = pickStops.map((stop, index) => {
      const label = boundaryLabels[index] || formatLegendNumber(stop?.value);
      const sizePx = Math.max(6, Math.min(20, Number(stop?.size || 8)));
      return `
        <div class="map-render-legend-row">
          <span class="map-render-legend-dot" style="width:${sizePx}px;height:${sizePx}px;"></span>
          <span class="map-render-legend-label">${label}</span>
        </div>
      `;
    }).join("");

    mapRenderLegend.innerHTML = `
      <div class="map-render-legend-header">${legendTitle} <span class="map-render-legend-year">(${yearLabel})</span></div>
      ${legendUnitLabel ? `<div class="map-render-legend-unit">${legendUnitLabel}</div>` : ""}
      <div class="map-render-legend-items">${rowsHtml}</div>
    `;
    mapRenderLegend.hidden = false;
  }

  function cacheOriginalRenderers() {
    cacheOriginalRenderersForLayers(getTargetLayers());
  }

  function resetToOriginalRenderers() {
    resetRenderersForLayers(getTargetLayers());
  }

  function renderMigration(type) {
    activeRendererMode = type;
    const year = getYear();
    let fieldObj;
    if (type === "inflow") fieldObj = allFields[0];
    if (type === "outflow") fieldObj = allFields[1];
    if (type === "net") fieldObj = allFields[2];
    if (!fieldObj) return;
    const field = getFieldName(fieldObj, year);
    updateRendererWithField(field);
  }

  function renderRate(type) {
    activeRendererMode = type;
    const year = getYear();
    let fieldObj;
    if (type === "rate-inflow") fieldObj = allFields[3];
    if (type === "rate-outflow") fieldObj = allFields[4];
    if (type === "rate-net") fieldObj = allFields[5];
    if (!fieldObj) return;
    const field = getFieldName(fieldObj, year);
    updateRendererWithField(field);
  }

  async function updateRendererWithField(field) {
    const activeLayer = getActiveLayer(getTargetLayers);
    if (!activeLayer) return;
    getTargetLayers().forEach((layer) => {
      if (layer) layer.featureEffect = null;
    });
    cacheOriginalRenderers();
    const view = mapEl.view;
    const geoLevel = extractGeoLevelFromLayer(activeLayer);
    const renderer = await createRendererForField(field, view, activeLayer, { geoLevel });
    activeLayer.renderer = renderer;
    renderDynamicLegend(renderer, activeRendererMode);
  }

  // Button event listeners
  if (inflowBtn) inflowBtn.onclick = () => renderMigration("inflow");
  if (outflowBtn) outflowBtn.onclick = () => renderMigration("outflow");
  if (netBtn) netBtn.onclick = () => renderMigration("net");
  if (rateInflowBtn) rateInflowBtn.onclick = () => renderRate("rate-inflow");
  if (rateOutflowBtn) rateOutflowBtn.onclick = () => renderRate("rate-outflow");
  if (rateNetBtn) rateNetBtn.onclick = () => renderRate("rate-net");
  if (resetRendererBtn) {
    resetRendererBtn.onclick = () => {
      if (typeof window.__resetSwipeCompareState === "function") {
        window.__resetSwipeCompareState();
      }
      activeRendererMode = null;
      resetToOriginalRenderers();
      clearDynamicLegend();
    };
  }

  if (yearSelect && !yearSelect._mappingListenerAdded) {
    yearSelect.addEventListener("calciteSelectChange", () => {
      if (!activeRendererMode) return;
      if (activeRendererMode === "inflow" || activeRendererMode === "outflow" || activeRendererMode === "net") {
        renderMigration(activeRendererMode);
        return;
      }
      renderRate(activeRendererMode);
    });
    yearSelect._mappingListenerAdded = true;
  }
}

async function resolveScheme(view, layer, theme, schemeName) {
  const schemes = await getSchemes({
    basemap: view.map.basemap,
    geometryType: layer.geometryType,
    theme
  });

  const allSchemes = [
    ...(schemes.primarySchemes || []),
    ...(schemes.secondarySchemes || []),
    ...(schemes.otherSchemes || [])
  ];

  return allSchemes.find((s) => s.name === schemeName) || null;
}

export async function createRendererForField(field, view, layer, { geoLevel = "state" } = {}) {
  const fieldKey = Object.keys(rendererOptionsByField).find((key) => field.startsWith(key));
  const rendererOptions = rendererOptionsByField[fieldKey] || {};
  const theme = rendererOptions.theme || "above-and-below";
  const schemeName = rendererOptions.schemeName || "default";
  const yearCode = extractYearCode(field);
  const normalizedGeoLevel = geoLevel === "county" ? "county" : "state";
  const configuredStops = getConfiguredStops(rendererOptions, yearCode, normalizedGeoLevel);
  const configuredRampColors = getConfiguredRampColors(rendererOptions, yearCode, normalizedGeoLevel);
  const stopCacheKey = JSON.stringify(configuredStops);
  const colorCacheKey = JSON.stringify(configuredRampColors);

  const cacheKey = `${RENDERER_CACHE_VERSION}|${layer.id}|${field}|${theme}|${schemeName}|${normalizedGeoLevel}|${stopCacheKey}|${colorCacheKey}`;
  if (rendererCache[cacheKey]) return rendererCache[cacheKey];

  const colorScheme = rendererOptions.schemeName
    ? await resolveScheme(view, layer, theme, rendererOptions.schemeName)
    : null;

  const response = await colorRendererCreator.createContinuousRenderer({
    layer,
    view,
    field,
    theme,
    colorScheme: colorScheme || undefined,
    outlineOptimizationEnabled: true
  });

  if (response?.renderer) {
    const visualVariable = response.renderer.visualVariables?.[0];
    if (visualVariable?.stops?.length && configuredStops.length) {
      const baseStops = visualVariable.stops;
      const mappedStops = configuredStops.map((configuredStop, index) => {
        const templateIndex = configuredStops.length > 1
          ? Math.round((index / (configuredStops.length - 1)) * (baseStops.length - 1))
          : 0;
        const templateStop = baseStops[Math.max(0, templateIndex)] || {};

        if (typeof configuredStop === "number") {
          return {
            value: configuredStop,
            color: pickRampColor(configuredRampColors, index, configuredStops.length) ?? templateStop?.color,
            size: templateStop?.size,
            opacity: templateStop?.opacity,
            label: templateStop?.label
          };
        }

        return {
          value: configuredStop?.value ?? templateStop?.value,
          color: configuredStop?.color
            ?? pickRampColor(configuredRampColors, index, configuredStops.length)
            ?? templateStop?.color,
          size: configuredStop?.size ?? templateStop?.size,
          opacity: configuredStop?.opacity ?? templateStop?.opacity,
          label: configuredStop?.label ?? templateStop?.label
        };
      });

      const isRenderableColorStops = visualVariable.type !== "color"
        || mappedStops.every((stop) => stop?.color != null);
      const isRenderableSizeStops = visualVariable.type !== "size"
        || mappedStops.every((stop) => stop?.size != null);

      if (isRenderableColorStops && isRenderableSizeStops) {
        visualVariable.stops = mappedStops;

        if (response.renderer.authoringInfo?.visualVariables?.[0]) {
          response.renderer.authoringInfo.visualVariables[0].stops = mappedStops;
        }
      }
    }

  }

  rendererCache[cacheKey] = response.renderer;
  return response.renderer;
}
