import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";

import { appState } from "./app_state";
import { drawLines, updateMigrationSummaryPanel } from "./draw";

function isMigrationEnabled() {
  const toggle = document.getElementById("migration-toggle");
  return toggle ? toggle.checked : true;
}

function getFlowYearSuffix(year = "2021") {
  const yearSuffixByYear = {
    "2021": "2020_2021",
    "2122": "2021_2022",
    "2223": "2022_2023"
  };
  return yearSuffixByYear[year] || "2021_2022";
}

async function queryFlowLayerWithFallback(url, whereField, whereValue, outFields = ["*"]) {
  const defaultYearSuffix = "2021_2022";

  const executeQuery = async (layerUrl) => {
    const flowLayer = new FeatureLayer({ url: layerUrl });
    const flowQuery = flowLayer.createQuery();
    flowQuery.where = `${whereField} = '${whereValue}'`;
    flowQuery.outFields = outFields;
    flowQuery.returnGeometry = false;
    return flowLayer.queryFeatures(flowQuery);
  };

  try {
    return await executeQuery(url);
  } catch {
    const fallbackUrl = url.replace(/\d{4}_\d{4}/, defaultYearSuffix);
    return executeQuery(fallbackUrl);
  }
}

export async function handleOutflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer, year = "2021") {
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
    let selectedName, queryLayerUrl, whereField, nField, originField, destField, agiField, whereValue;

    const yearSuffix = getFlowYearSuffix(year);

    if (appState.geoLevel === "state") {
      const stateFips = String(attrs.statefips || "").padStart(2, "0");
      selectedName = attrs.NAME;
      agiField = "AGI";
      queryLayerUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/state_outflow_${yearSuffix}_centroids/FeatureServer`;
      whereField = "y1_state_fips";
      nField = "n2";
      originField = "y1_state_name";
      destField = "y2_state_name";
      whereValue = stateFips;
    } else {
      const countyFips = String(attrs.countyfips || "").padStart(5, "0");
      selectedName = attrs.NAME;
      agiField = "agi";
      queryLayerUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/county_outflow_${yearSuffix}_centroids/FeatureServer`;
      whereField = "y1_county_fips";
      nField = "n2";
      originField = "y1_countyname";
      destField = "y2_countyname";
      whereValue = countyFips;
    }

    const flowResult = await queryFlowLayerWithFallback(queryLayerUrl, whereField, whereValue, ["*"]);

    if (appState.geoLevel === "county") {
      const originFipsList = flowResult.features.map(f => f.attributes["y1_county_fips"].padStart(5, "0"));
      const uniqueOriginFips = [...new Set(originFipsList)];
      const whereClause = `countyfips IN ('${uniqueOriginFips.join("','")}')`;

      // FIXED: Use countyPolygonLayer here
      const countyFeatures = await countyPolygonLayer.queryFeatures({
        where: whereClause,
        outFields: ["countyfips", "State", "NAME"],
        returnGeometry: false
      });

      const fipsToCountyInfo = {};
      countyFeatures.features.forEach(f => {
        fipsToCountyInfo[f.attributes.countyfips] = {
          abbr: f.attributes.State,
          name: f.attributes.NAME
        };
      });

      flowResult.features.forEach(f => {
        const originFips = f.attributes["y1_county_fips"].padStart(5, "0");
        const originInfo = fipsToCountyInfo[originFips] || {};
        f.attributes.originName = originInfo.name || f.attributes["y1_countyname"] || originFips;
        f.attributes.originStateAbbr = originInfo.abbr || f.attributes["y1_state"] || "";
        f.attributes.destinationName = f.attributes["y2_countyname"];
        f.attributes.destinationStateAbbr = f.attributes["y2_state"] || "";
        f.attributes.nValue = f.attributes[nField];
        f.attributes.AGI = f.attributes[agiField];
      });
    } else {
      flowResult.features.forEach(f => {
        f.attributes.originName = f.attributes[originField];
        f.attributes.destinationName = f.attributes[destField];
        f.attributes.nValue = f.attributes[nField];
        f.attributes.AGI = f.attributes[agiField];
      });
    }

    appState.allRelatedFeatures = flowResult.features;
    appState.selectedStateName = selectedName;
    appState.selectedCountyName = selectedName;
    appState.selectedCountyAbbr = attrs.State;
    drawLines(appState.allRelatedFeatures, appState.minValue, selectedName, attrs.State);
    updateMigrationSummaryPanel();
  }
}

export async function handleInflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer, year = "2021") {
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
    let selectedName, queryLayerUrl, whereField, nField, originField, destField, agiField, whereValue;

    const yearSuffix = getFlowYearSuffix(year);

    if (appState.geoLevel === "state") {
      const stateFips = attrs.statefips.padStart(2, "0");
      selectedName = attrs.NAME;
      agiField = "AGI";
      queryLayerUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/state_inflow_${yearSuffix}_centroids/FeatureServer`;
      whereField = "y2_state_fips";
      nField = "n2";
      originField = "y1_state_name";
      destField = "y2_state_name";
      whereValue = stateFips;
    } else {
      const countyFips = attrs.countyfips.padStart(5, "0");
      selectedName = attrs.NAME;
      agiField = "agi";
      queryLayerUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/county_inflow_${yearSuffix}_centroids/FeatureServer`;
      whereField = "y2_county_fips";
      nField = "n2";
      originField = "y1_countyname";
      destField = "y2_countyname";
      whereValue = countyFips;
    }

    const flowResult = await queryFlowLayerWithFallback(queryLayerUrl, whereField, whereValue, ["*"]);

    if (appState.geoLevel === "county") {
      const originFipsList = flowResult.features.map(f => f.attributes["y1_county_fips"].padStart(5, "0"));
      const uniqueOriginFips = [...new Set(originFipsList)];
      const whereClause = `countyfips IN ('${uniqueOriginFips.join("','")}')`;

      const countyFeatures = await countyPolygonLayer.queryFeatures({
        where: whereClause,
        outFields: ["countyfips", "State", "NAME"],
        returnGeometry: false
      });

      const fipsToCountyInfo = {};
      countyFeatures.features.forEach(f => {
        fipsToCountyInfo[f.attributes.countyfips] = {
          abbr: f.attributes.State,
          name: f.attributes.NAME
        };
      });

      flowResult.features.forEach(f => {
        const originFips = f.attributes["y1_county_fips"].padStart(5, "0");
        const originInfo = fipsToCountyInfo[originFips] || {};
        f.attributes.originName = originInfo.name || f.attributes["y1_countyname"] || originFips;
        f.attributes.originStateAbbr = originInfo.abbr || f.attributes["y1_state"] || "";
        f.attributes.destinationName = f.attributes["y2_countyname"];
        f.attributes.destinationStateAbbr = f.attributes["y2_state"] || "";
        f.attributes.nValue = f.attributes[nField];
        f.attributes.AGI = f.attributes[agiField];
      });
    } else {
      flowResult.features.forEach(f => {
        f.attributes.originName = f.attributes[originField];
        f.attributes.destinationName = f.attributes[destField];
        f.attributes.nValue = f.attributes[nField];
        f.attributes.AGI = f.attributes[agiField];
      });
    }

    appState.allRelatedFeatures = flowResult.features;
    appState.selectedStateName = selectedName;
    appState.selectedCountyName = selectedName;
    appState.selectedCountyAbbr = attrs.State;
    drawLines(appState.allRelatedFeatures, appState.minValue, selectedName, attrs.State);
    updateMigrationSummaryPanel();
  }
}

export async function handleNetMigration(polygonGraphic, view, statePolygonLayer, countyPolygonLayer, year = "2021") {
  if (!isMigrationEnabled()) return;

  if (appState.geoLevel === "county" && polygonGraphic && polygonGraphic.geometry && view) {
    await view.goTo({
      target: polygonGraphic.geometry,
      zoom: 7
    });
  }

  const attrs = polygonGraphic.attributes;
  let inflowUrl, outflowUrl, inflowWhereField, outflowWhereField, whereValue, originField, destField, agiField, nField;

  const yearSuffix = getFlowYearSuffix(year);

  if (appState.geoLevel === "state") {
    const stateFips = attrs.statefips.padStart(2, "0");
    inflowUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/state_inflow_${yearSuffix}_centroids/FeatureServer`;
    outflowUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/state_outflow_${yearSuffix}_centroids/FeatureServer`;
    inflowWhereField = "y2_state_fips";
    outflowWhereField = "y1_state_fips";
    whereValue = stateFips;
    originField = "y1_state_name";
    destField = "y2_state_name";
    agiField = "AGI";
    nField = "n2";
  } else {
    const countyFips = attrs.countyfips.padStart(5, "0");
    inflowUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/county_inflow_${yearSuffix}_centroids/FeatureServer`;
    outflowUrl = `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/county_outflow_${yearSuffix}_centroids/FeatureServer`;
    inflowWhereField = "y2_county_fips";
    outflowWhereField = "y1_county_fips";
    whereValue = countyFips;
    originField = "y1_countyname";
    destField = "y2_countyname";
    agiField = "agi";
    nField = "n2";
  }

  const [inflowResult, outflowResult] = await Promise.all([
    queryFlowLayerWithFallback(inflowUrl, inflowWhereField, whereValue, ["*"]),
    queryFlowLayerWithFallback(outflowUrl, outflowWhereField, whereValue, ["*"])
  ]);

  // Build maps for inflow and outflow
  const inflowMap = {};
  inflowResult.features.forEach(f => {
    const key = appState.geoLevel === "state"
      ? f.attributes["y1_state_fips"] + "_" + f.attributes["y2_state_fips"]
      : f.attributes["y1_county_fips"] + "_" + f.attributes["y2_county_fips"];
    inflowMap[key] = f;
  });

  const outflowMap = {};
  outflowResult.features.forEach(f => {
    const key = appState.geoLevel === "state"
      ? f.attributes["y1_state_fips"] + "_" + f.attributes["y2_state_fips"]
      : f.attributes["y1_county_fips"] + "_" + f.attributes["y2_county_fips"];
    outflowMap[key] = f;
  });

  // Calculate net migration for each pair
  const netFeatures = [];
  const allKeys = new Set([...Object.keys(inflowMap), ...Object.keys(outflowMap)]);
  allKeys.forEach(key => {
    const inflow = inflowMap[key]?.attributes?.n2 || 0;
    const outflow = outflowMap[key]?.attributes?.n2 || 0;
    const net = inflow - outflow;
    if (Math.abs(net) < appState.minValue) return;

    // Use inflow feature as base, or outflow if inflow missing
    const baseFeature = inflowMap[key] || outflowMap[key];
    const featAttrs = { ...baseFeature.attributes };
    featAttrs.nValue = Math.abs(net);
    featAttrs.netDirection = net > 0 ? "inflow" : "outflow";
    featAttrs.originName = featAttrs[originField];
    featAttrs.destinationName = featAttrs[destField];
    featAttrs.AGI = featAttrs[agiField];
    netFeatures.push({ attributes: featAttrs, net });
  });

  appState.allRelatedFeatures = netFeatures;
  appState.selectedStateName = attrs.STATE_NAME;
  appState.selectedCountyName = attrs.NAME;
  appState.selectedCountyAbbr = attrs.STATE_ABBR;

  // --- Draw net migration lines with direction and color ---
  appState.linesLayer.removeAll();
  appState.pointsLayer.removeAll();

  netFeatures.forEach(feature => {
    const attrs = feature.attributes;
    const n = attrs.nValue;
    if (n <= 0) return;

    let originX = attrs.Origin_X;
    let originY = attrs.Origin_Y;
    let destinationX = attrs.Destination_X;
    let destinationY = attrs.Destination_Y;

    // Reverse direction for net inflow
    if (attrs.netDirection === "inflow") {
      [originX, originY, destinationX, destinationY] = [destinationX, destinationY, originX, originY];
    }

    const line = {
      type: "polyline",
      paths: [
        [originX, originY],
        [destinationX, destinationY]
      ],
      spatialReference: { wkid: 3857 }
    };

    // Green for net inflow, blue for net outflow
    const color = attrs.netDirection === "inflow"
      ? [25, 130, 67, 255]   // green
      : [25, 72, 130, 255];  // blue

    const width = Math.min(8, Math.max(0.5, Math.log10(n) - 2));
    const arrowSymbol = {
      type: "simple-line",
      color: color,
      width: width,
      style: "solid"
    };

    appState.linesLayer.add(new Graphic({
      geometry: line,
      symbol: arrowSymbol,
      attributes: attrs,
      popupTemplate: {
        title: attrs.netDirection === "inflow"
          ? `Net gain to ${attrs.destinationName}`
          : `Net loss from ${attrs.destinationName}`,
        content: `<b>${n.toLocaleString()}</b> more people 
          ${attrs.netDirection === "inflow" ? "moved into" : "left"} <b>${attrs.destinationName}</b> 
          than ${attrs.netDirection === "inflow" ? "left" : "moved in"}.`
      }
    }));
  });

  updateMigrationSummaryPanel();
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
  year = "2021"
) {

  const layer = geoLevel === "state" ? stateLayer : countyLayer;
  const fipsField = geoLevel === "state" ? "statefips" : "countyfips";
  const partnerFipsField = geoLevel === "state" ? "partner_statefips" : "partner_countyfips";
  const inflowField = `IN_n2_${year}`;
  const outflowField = `OUT_n2_${year}`;
  const normalizeFips = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return geoLevel === "state" ? text.padStart(2, "0") : text.padStart(5, "0");
  };
  const normalizeSpecialCode = (value) => String(value ?? "").trim().replace(/^0+/, "");
  const isSpecialCode = (value) => {
    const code = normalizeSpecialCode(value);
    return code === "96" || code === "97" || code.startsWith("96") || code.startsWith("97");
  };
  const normalizedSelectedFips = normalizeFips(selectedStateFips);

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
    const partner = normalizeFips(rec.attributes[partnerFipsField]);
    return (
      !isSpecialCode(partner) &&
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

  const highlightFips = [...new Set(selectedRecords.map((rec) => normalizeFips(rec.attributes[partnerFipsField]))).values()].filter(Boolean);

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
      const fips = normalizeFips(rec.attributes[partnerFipsField]);
      if (!fips || isSpecialCode(fips) || seenContributorFips.has(fips) || topContributorRecords.length >= 4) return;
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
