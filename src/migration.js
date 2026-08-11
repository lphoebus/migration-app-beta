import { appState } from "./app_state";
import { drawLines } from "./draw";

function isMigrationEnabled() {
  const toggle = document.getElementById("migration-toggle");
  return toggle ? toggle.checked : true;
}

function getRelatedFieldYearTokens(year = "2223") {
  return [String(year)];
}

function addYearFieldVariants(fieldNames = [], year = "2223") {
  const tokens = getRelatedFieldYearTokens(year);
  const yearVariants = fieldNames.flatMap((fieldName) => tokens.map((token) => `${fieldName}_${token}`));
  return [...new Set([...fieldNames, ...yearVariants])];
}

const normalizeFipsForGeo = (value, geoLevel) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return geoLevel === "state" ? text.padStart(2, "0") : text.padStart(5, "0");
};

function shouldUseRelatedTableFlowLines(geoLevel) {
  const mode = appState.useRelatedTableFlowLines;
  if (typeof mode === "boolean") return mode;
  if (mode && typeof mode === "object" && geoLevel in mode) {
    return Boolean(mode[geoLevel]);
  }
  return false;
}

function getCaseInsensitiveValue(attributes, fieldName) {
  if (!attributes || !fieldName) return undefined;
  if (fieldName in attributes) return attributes[fieldName];
  const key = Object.keys(attributes).find((candidate) => candidate.toLowerCase() === fieldName.toLowerCase());
  return key ? attributes[key] : undefined;
}

function getFirstValue(attributes, fieldNames = []) {
  for (const fieldName of fieldNames) {
    const value = getCaseInsensitiveValue(attributes, fieldName);
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

export const SPECIAL_FLOW_PREFIXES = ["57", "58", "59", "96", "97", "98"];

export function isSpecialFlowCode(value) {
  const code = String(value ?? "").trim().replace(/^0+/, "");
  return SPECIAL_FLOW_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function isSpecialStateCode(value) {
  return isSpecialFlowCode(value);
}

function isSpecialCountyCode(value) {
  return isSpecialFlowCode(value);
}

async function loadCentroidsFromJsonIntoCache(geoLevel, requestedFips = []) {
  if (!appState.useJsonCentroidLookup) return;

  const cacheKey = geoLevel === "state" ? "stateCentroidCache" : "countyCentroidCache";
  if (!appState[cacheKey]) appState[cacheKey] = {};
  const cache = appState[cacheKey];

  const url = appState.centroidJsonUrls?.[geoLevel];
  if (!url) return;

  // Keep parsed JSON in memory so we can copy requested keys on every call.
  if (!appState._jsonCentroidDict) appState._jsonCentroidDict = { state: null, county: null };

  let asDict = appState._jsonCentroidDict[geoLevel];
  if (!asDict) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`Centroid JSON load failed for ${geoLevel}: ${res.status} (${url})`);
      return;
    }

    const json = await res.json();
    const centroids = json?.centroids || {};
    asDict = Array.isArray(centroids)
      ? Object.fromEntries(
          centroids
            .map((r) => {
              const fips = normalizeFipsForGeo(r.fips ?? r.FIPS ?? r.id, geoLevel);
              if (!fips || r.x == null || r.y == null) return null;
              return [fips, { x: Number(r.x), y: Number(r.y), name: r.name ?? "", stateAbbr: r.stateAbbr ?? "" }];
            })
            .filter(Boolean)
        )
      : centroids;

    appState._jsonCentroidDict[geoLevel] = asDict;
  }

  const keys = requestedFips.length
    ? requestedFips.map((f) => normalizeFipsForGeo(f, geoLevel)).filter(Boolean)
    : Object.keys(asDict);

  keys.forEach((fips) => {
    if (cache[fips]) return;
    const row = asDict[fips];
    if (!row) return;
    const x = Number(row.x);
    const y = Number(row.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    cache[fips] = {
      x,
      y,
      name: String(row.name ?? "").trim(),
      stateAbbr: String(row.stateAbbr ?? "").trim()
    };
  });
}

async function ensureCentroidsForFips(geoLevel, requestedFips = [], statePolygonLayer, countyPolygonLayer) {
  const cacheKey = geoLevel === "state" ? "stateCentroidCache" : "countyCentroidCache";
  if (!appState[cacheKey]) appState[cacheKey] = {};
  const existingCache = appState[cacheKey];

  const normalizedRequestedFips = [...new Set(
    requestedFips
      .map((value) => normalizeFipsForGeo(value, geoLevel))
      .filter(Boolean)
  )];

  try {
    await loadCentroidsFromJsonIntoCache(geoLevel, normalizedRequestedFips);
  } catch (e) {
    console.warn(`JSON centroid hydrate failed for ${geoLevel}.`, e);
  }

  const missingFips = normalizedRequestedFips.filter((fips) => !existingCache[fips]);
  if (missingFips.length) {
    console.warn(`Centroid JSON is missing ${missingFips.length} ${geoLevel} FIPS values. Sample: ${missingFips.slice(0, 10).join(", ")}`);
  }

  return existingCache;
}

async function queryRelatedFlowRecords(layer, objectId, relationshipId = 0) {
  const relatedResults = await layer.queryRelatedFeatures({
    relationshipId,
    objectIds: [objectId],
    outFields: ["*"]
  });
  return relatedResults[objectId]?.features || [];
}

async function tryBuildStateFlowFromRelatedTable(layer, objectId, attrs, flowDirection, year, statePolygonLayer, countyPolygonLayer) {
  if (typeof layer?.queryRelatedFeatures !== "function") {
    console.warn("State layer does not support queryRelatedFeatures; rendering no state lines.");
    return [];
  }

  try {
    const relatedRecords = await queryRelatedFlowRecords(layer, objectId);
    if (!relatedRecords.length) {
      console.warn("No related state flow records returned; rendering no state lines.");
      return [];
    }

    const selectedStateFips = normalizeFipsForGeo(attrs.statefips, "state");
    const partnerFips = relatedRecords
      .map((record) => getStatePartnerFips(record.attributes || {}))
      .filter((fips) => fips && fips !== selectedStateFips && !isSpecialStateCode(fips));
    const centroidCache = await ensureCentroidsForFips(
      "state",
      [selectedStateFips, ...partnerFips],
      statePolygonLayer,
      countyPolygonLayer
    );
    const flowFeatures = buildStateFlowFeaturesFromRelatedRecords(
      relatedRecords,
      attrs,
      flowDirection,
      year,
      centroidCache
    );

    if (!flowFeatures.length) {
      console.warn("Related state flow records could not be normalized into draw-ready features; rendering no state lines.");
      return [];
    }

    return flowFeatures;
  } catch (error) {
    console.error(`State ${flowDirection} related-table flow failed; rendering no state lines.`, error);
    return [];
  }
}

async function tryBuildCountyFlowFromRelatedTable(layer, objectId, attrs, flowDirection, year, statePolygonLayer, countyPolygonLayer) {
  if (typeof layer?.queryRelatedFeatures !== "function") {
    console.warn("County layer does not support queryRelatedFeatures; rendering no county lines.");
    return [];
  }

  try {
    const relatedRecords = await queryRelatedFlowRecords(layer, objectId);
    if (!relatedRecords.length) {
      console.warn("No related county flow records returned; rendering no county lines.");
      return [];
    }

    const selectedCountyFips = normalizeFipsForGeo(attrs.countyfips, "county");
    const partnerFips = relatedRecords
      .map((record) => getCountyPartnerFips(record.attributes || {}, flowDirection, year))
      .filter((fips) => fips && fips !== selectedCountyFips && !isSpecialCountyCode(fips));
    const centroidCache = await ensureCentroidsForFips(
      "county",
      [selectedCountyFips, ...partnerFips],
      statePolygonLayer,
      countyPolygonLayer
    );
    const flowFeatures = buildCountyFlowFeaturesFromRelatedRecords(
      relatedRecords,
      attrs,
      flowDirection,
      year,
      centroidCache
    );

    if (!flowFeatures.length) {
      console.warn("Related county flow records could not be normalized into draw-ready features for the selected year; rendering no county lines.");
      return [];
    }

    return flowFeatures;
  } catch (error) {
    console.error(`County ${flowDirection} related-table flow failed; rendering no county lines.`, error);
    return [];
  }
}

function getStateFlowValue(attributes, flowDirection, year) {
  const baseCandidates = flowDirection === "inflow"
    ? ["IN_n2", "in_n2"]
    : ["OUT_n2", "out_n2"];
  const candidates = addYearFieldVariants(baseCandidates, year);
  const value = Number(getFirstValue(attributes, candidates) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getStateFlowAgi(attributes, flowDirection, year) {
  const baseCandidates = flowDirection === "inflow"
    ? ["IN_AGI", "in_agi", "AGI", "agi"]
    : ["OUT_AGI", "out_agi", "AGI", "agi"];
  const candidates = addYearFieldVariants(baseCandidates, year);
  const value = Number(getFirstValue(attributes, candidates) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getStatePartnerFips(attributes, flowDirection, year = "2223") {
  const directionalCandidates = flowDirection === "inflow"
    ? ["y1_state_fips", "y1_statefips", "origin_state_fips"]
    : flowDirection === "outflow"
      ? ["y2_state_fips", "y2_statefips", "destination_state_fips"]
      : [];
  const partnerCandidates = addYearFieldVariants([
    "partner_statefips",
    "partner_fips",
    "partnerStateFips"
  ], year);
  const directionalCandidatesWithYear = addYearFieldVariants(directionalCandidates, year);

  return normalizeFipsForGeo(
    getFirstValue(attributes, [...partnerCandidates, ...directionalCandidatesWithYear]),
    "state"
  );
}

function getStatePartnerName(attributes) {
  return String(
    getFirstValue(attributes, [
      "partner_state_name",
      "destinationName",
      "originName",
      "NAME",
      "name"
    ]) ?? ""
  ).trim();
}

function getCountyPartnerFips(attributes, flowDirection, year) {
  const partnerCandidates = addYearFieldVariants([
    "partner_countyfips",
    "partner_fips",
    "partnerCountyFips"
  ], year);

  return normalizeFipsForGeo(
    getFirstValue(attributes, partnerCandidates),
    "county"
  );
}

function getCountyPartnerName(attributes, flowDirection, year) {
  const directionalCandidates = flowDirection === "inflow"
    ? ["y1_countyname", "y1_county_name", "originName"]
    : ["y2_countyname", "y2_county_name", "destinationName"];

  const partnerCandidates = addYearFieldVariants([
    "partner_county_name",
    "partner_countyname"
  ], year);
  const directionalCandidatesWithYear = addYearFieldVariants(directionalCandidates, year);

  return String(
    getFirstValue(attributes, [
      ...partnerCandidates,
      ...directionalCandidatesWithYear,
      "NAME",
      "name"
    ]) ?? ""
  ).trim();
}

function getCountyPartnerStateAbbr(attributes, flowDirection, year) {
  const directionalCandidates = flowDirection === "inflow"
    ? ["y1_state", "y1_state_abbr", "origin_state", "origin_state_abbr"]
    : ["y2_state", "y2_state_abbr", "destination_state", "destination_state_abbr"];

  const partnerCandidates = addYearFieldVariants([
    "partner_state",
    "partner_state_abbr"
  ], year);
  const directionalCandidatesWithYear = addYearFieldVariants(directionalCandidates, year);

  return String(
    getFirstValue(attributes, [
      ...partnerCandidates,
      ...directionalCandidatesWithYear,
      "State",
      "state"
    ]) ?? ""
  ).trim();
}

function buildStateFlowFeaturesFromRelatedRecords(relatedRecords, selectedAttrs, flowDirection, year, centroidCache) {
  const selectedStateFips = normalizeFipsForGeo(selectedAttrs.statefips, "state");
  const selectedStateName = String(getFirstValue(selectedAttrs, ["NAME", "name"]) ?? "Selected state");

  return relatedRecords.flatMap((record) => {
    const attrs = record.attributes || {};
    const partnerFips = getStatePartnerFips(attrs, flowDirection, year);
    if (!partnerFips || isSpecialStateCode(partnerFips)) {
      return [];
    }

    const nValue = getStateFlowValue(attrs, flowDirection, year);
    if (!Number.isFinite(nValue) || nValue <= 0) {
      return [];
    }

    const originFips = flowDirection === "outflow" ? selectedStateFips : partnerFips;
    const destinationFips = flowDirection === "outflow" ? partnerFips : selectedStateFips;
    const originPt = centroidCache[originFips];
    const destinationPt = centroidCache[destinationFips];
    if (!originPt || !destinationPt) {
      return [];
    }

    const partnerName = getStatePartnerName(attrs) || centroidCache[partnerFips]?.name || partnerFips;
    const originName = flowDirection === "outflow" ? selectedStateName : partnerName;
    const destinationName = flowDirection === "outflow" ? partnerName : selectedStateName;

    return [{
      attributes: {
        ...attrs,
        nValue,
        AGI: getStateFlowAgi(attrs, flowDirection, year),
        originName,
        destinationName,
        Origin_X: originPt.x,
        Origin_Y: originPt.y,
        Destination_X: destinationPt.x,
        Destination_Y: destinationPt.y
      }
    }];
  });
}

function buildCountyFlowFeaturesFromRelatedRecords(relatedRecords, selectedAttrs, flowDirection, year, centroidCache) {
  const selectedCountyFips = normalizeFipsForGeo(selectedAttrs.countyfips, "county");
  const selectedCountyName = String(getFirstValue(selectedAttrs, ["NAME", "name"]) ?? "Selected county");
  const selectedCountyStateAbbr = String(getFirstValue(selectedAttrs, ["State", "STATE_ABBR", "state"]) ?? "").trim();

  return relatedRecords.flatMap((record) => {
    const attrs = record.attributes || {};
    const partnerFips = getCountyPartnerFips(attrs, flowDirection, year);
    if (!partnerFips || isSpecialCountyCode(partnerFips)) {
      return [];
    }

    const nValue = getStateFlowValue(attrs, flowDirection, year);
    if (!Number.isFinite(nValue) || nValue <= 0) {
      return [];
    }

    const originFips = flowDirection === "outflow" ? selectedCountyFips : partnerFips;
    const destinationFips = flowDirection === "outflow" ? partnerFips : selectedCountyFips;
    const originPt = centroidCache[originFips];
    const destinationPt = centroidCache[destinationFips];
    if (!originPt || !destinationPt) {
      return [];
    }

    const partnerName = getCountyPartnerName(attrs, flowDirection, year) || centroidCache[partnerFips]?.name || partnerFips;
    const partnerStateAbbr = getCountyPartnerStateAbbr(attrs, flowDirection, year) || centroidCache[partnerFips]?.stateAbbr || "";
    const originName = flowDirection === "outflow" ? selectedCountyName : partnerName;
    const destinationName = flowDirection === "outflow" ? partnerName : selectedCountyName;
    const originStateAbbr = flowDirection === "outflow" ? selectedCountyStateAbbr : partnerStateAbbr;
    const destinationStateAbbr = flowDirection === "outflow" ? partnerStateAbbr : selectedCountyStateAbbr;

    return [{
      attributes: {
        ...attrs,
        nValue,
        AGI: getStateFlowAgi(attrs, flowDirection, year),
        originName,
        destinationName,
        y1_countyname: originName,
        y1_state: originStateAbbr,
        y2_countyname: destinationName,
        y2_state: destinationStateAbbr,
        Origin_X: originPt.x,
        Origin_Y: originPt.y,
        Destination_X: destinationPt.x,
        Destination_Y: destinationPt.y
      }
    }];
  });
}

export async function handleOutflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer, year = "2223") {
  if (!isMigrationEnabled()) return;

  if (appState.geoLevel === "county" && polygonGraphic && polygonGraphic.geometry && view) {
    await view.goTo({
      target: polygonGraphic.geometry,
      zoom: 6
    });
  }

  const objectId = polygonGraphic.attributes.OBJECTID;
  const layer = polygonGraphic.layer;

  const result = await layer.queryFeatures({
    objectIds: [objectId],
    outFields: ["*"]
  });
  if (result.features.length > 0) {
    const attrs = result.features[0].attributes;

    if (!shouldUseRelatedTableFlowLines(appState.geoLevel)) {
      console.warn(`Related-table flow lines are disabled for ${appState.geoLevel}; rendering no lines.`);
      appState.allRelatedFeatures = [];
      drawLines([], appState.minValue, attrs.NAME, attrs.State);
      return;
    }

    const flowFeatures = appState.geoLevel === "state"
      ? await tryBuildStateFlowFromRelatedTable(layer, objectId, attrs, "outflow", year, statePolygonLayer, countyPolygonLayer)
      : await tryBuildCountyFlowFromRelatedTable(layer, objectId, attrs, "outflow", year, statePolygonLayer, countyPolygonLayer);

    appState.allRelatedFeatures = Array.isArray(flowFeatures) ? flowFeatures : [];
    appState.selectedStateName = attrs.NAME;
    appState.selectedCountyName = attrs.NAME;
    appState.selectedCountyAbbr = attrs.State;
    drawLines(appState.allRelatedFeatures, appState.minValue, attrs.NAME, attrs.State);
  }
}

export async function handleInflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer, year = "2223") {
  if (!isMigrationEnabled()) return;

  if (appState.geoLevel === "county" && polygonGraphic && polygonGraphic.geometry && view) {
    await view.goTo({
      target: polygonGraphic.geometry,
      zoom: 6
    });
  }

  const objectId = polygonGraphic.attributes.OBJECTID;
  const layer = polygonGraphic.layer;

  const result = await layer.queryFeatures({
    objectIds: [objectId],
    outFields: ["*"]
  });
  if (result.features.length > 0) {
    const attrs = result.features[0].attributes;

    if (!shouldUseRelatedTableFlowLines(appState.geoLevel)) {
      console.warn(`Related-table flow lines are disabled for ${appState.geoLevel}; rendering no lines.`);
      appState.allRelatedFeatures = [];
      drawLines([], appState.minValue, attrs.NAME, attrs.State);
      return;
    }

    const flowFeatures = appState.geoLevel === "state"
      ? await tryBuildStateFlowFromRelatedTable(layer, objectId, attrs, "inflow", year, statePolygonLayer, countyPolygonLayer)
      : await tryBuildCountyFlowFromRelatedTable(layer, objectId, attrs, "inflow", year, statePolygonLayer, countyPolygonLayer);

    appState.allRelatedFeatures = Array.isArray(flowFeatures) ? flowFeatures : [];
    appState.selectedStateName = attrs.NAME;
    appState.selectedCountyName = attrs.NAME;
    appState.selectedCountyAbbr = attrs.State;
    drawLines(appState.allRelatedFeatures, appState.minValue, attrs.NAME, attrs.State);
  }
}

export async function updateHighlightFlow(
  flowType,
  selectedStateFips,
  objectId,
  stateLayer,
  countyLayer,
  geoLevel,
  relationshipId = 0,
  threshold,
  year = "2223"
) {

  const layer = geoLevel === "state" ? stateLayer : countyLayer;
  const fipsField = geoLevel === "state" ? "statefips" : "countyfips";
  const inflowField = `IN_n2_${year}`;
  const outflowField = `OUT_n2_${year}`;
  const normalizeFips = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return geoLevel === "state" ? text.padStart(2, "0") : text.padStart(5, "0");
  };
  const normalizedSelectedFips = normalizeFips(selectedStateFips);
  const getPartnerFipsFromRecord = (attributes = {}) => (
    geoLevel === "state"
      ? getStatePartnerFips(attributes, flowType, year)
      : getCountyPartnerFips(attributes, flowType, year)
  );

  if (typeof layer.queryRelatedFeatures !== "function") {
    console.error("State layer does not support queryRelatedFeatures");
    return;
  }
  // Always query related records for the selected OBJECTID
  const relatedResults = await layer.queryRelatedFeatures({
    relationshipId,
    objectIds: [objectId],
    outFields: ["*"]
  });
  const relatedRecords = relatedResults[objectId]?.features || [];

  // Filter by direction
  const validRecords = relatedRecords.filter((rec) => {
    const partner = getPartnerFipsFromRecord(rec.attributes || {});
    return (
      !isSpecialFlowCode(partner) &&
      partner !== normalizedSelectedFips
    );
  });

  const recordValue = (rec) =>
    flowType === "inflow" ? Number(rec.attributes[inflowField] || 0) : Number(rec.attributes[outflowField] || 0);

  const partnerNameFieldCandidates = geoLevel === "state"
    ? (flowType === "inflow"
      ? ["y1_state_name", "partner_state_name", "originName", "NAME", "name"]
      : ["y2_state_name", "partner_state_name", "destinationName", "NAME", "name"])
    : (flowType === "inflow"
      ? ["y1_countyname", "y1_county_name", "partner_county_name", "partner_countyname", "originName", "NAME", "name", "countyname", "county_name"]
      : ["y2_countyname", "y2_county_name", "partner_county_name", "partner_countyname", "destinationName", "NAME", "name", "countyname", "county_name"]);

  const partnerNameFromRecord = (rec) => {
    for (const field of partnerNameFieldCandidates) {
      const value = String(rec.attributes?.[field] ?? "").trim();
      if (value) return value;
    }
    return "";
  };

  const selectedRecords = validRecords.filter((rec) => recordValue(rec) > threshold);

  const highlightFips = [...new Set(selectedRecords.map((rec) => getPartnerFipsFromRecord(rec.attributes || {}))).values()].filter(Boolean);

  const totalValidValue = validRecords.reduce((sum, rec) => sum + recordValue(rec), 0);
  const selectedValue = selectedRecords.reduce((sum, rec) => sum + recordValue(rec), 0);
  const representedPct = totalValidValue > 0 ? Math.round((selectedValue / totalValidValue) * 100) : 0;

  let fipsToName = {};
  if (highlightFips.length) {
    const whereClause = `${fipsField} IN ('${highlightFips.join("','")}')`;
    const featureResult = await layer.queryFeatures({
      where: whereClause,
      outFields: [fipsField, "NAME"],
      returnGeometry: false
    });

    featureResult.features.forEach((feature) => {
      fipsToName[normalizeFips(feature.attributes[fipsField])] = feature.attributes.NAME;
    });
  }

  const resolvedHighlightFips = highlightFips.filter((fips) => Boolean(fipsToName[fips]));

  const topContributorRecords = [];
  const seenContributorFips = new Set();
  [...selectedRecords]
    .sort((a, b) => recordValue(b) - recordValue(a))
    .forEach((rec) => {
      const fips = getPartnerFipsFromRecord(rec.attributes || {});
      if (!fips || isSpecialFlowCode(fips) || seenContributorFips.has(fips) || topContributorRecords.length >= 4) return;
      if (!fipsToName[fips]) return;
      seenContributorFips.add(fips);
      topContributorRecords.push({
        fips,
        label: partnerNameFromRecord(rec) || fipsToName[fips]
      });
    });

  const topContributors = topContributorRecords.map((item) => String(item.label).trim()).filter(Boolean);

  const innerGlow = geoLevel === "county" ? 8 : 6;
  const outerGlow = geoLevel === "county" ? 18 : 14;

  // Apply the effect
  layer.featureEffect = {
    filter: {
      where: resolvedHighlightFips.length ? `${fipsField} IN (${resolvedHighlightFips.map(f => `'${f}'`).join(",")})` : "1=0"
    },
    includedEffect: `
      drop-shadow(0 0 ${outerGlow}px rgba(52, 52, 52, 0.65))
    `,
    excludedEffect: "opacity(50%)"
  };

  return {
    highlightedCount: resolvedHighlightFips.length,
    representedPct,
    topContributors
  };
}
