import { appState } from "./app_state";
import Graphic from "@arcgis/core/Graphic";

const maxAnimatedRoutes = 15;
const routeMinSpeed = 25;
const routeMaxSpeed = 100;

function getRouteAnimationSpeed(nValue, minValue, maxValue) {
  const midpoint = (routeMinSpeed + routeMaxSpeed) / 2;
  if (!Number.isFinite(nValue)) return midpoint;
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
    return midpoint;
  }

  const ratio = (nValue - minValue) / (maxValue - minValue);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return routeMinSpeed + (routeMaxSpeed - routeMinSpeed) * clampedRatio;
}

export function stopFlowLineAnimation() {
  return;
}


// Draw migration lines/arrows on the main map only
export function drawLines(features, minValue, selectedStateName, selectedCountyAbbr) {
  stopFlowLineAnimation();
  appState.linesLayer.removeAll();
  appState.pointsLayer.removeAll();

  const validFeatures = features.filter(f => f.attributes.nValue >= minValue && f.attributes.nValue > 0);

  // Separate points (same location) from lines BEFORE calculating maxValue
  const sameLocationFeatures = validFeatures.filter(f => 
    f.attributes.Origin_X === f.attributes.Destination_X &&
    f.attributes.Origin_Y === f.attributes.Destination_Y
  );

  const lineFeatures = validFeatures.filter(f => 
    f.attributes.Origin_X !== f.attributes.Destination_X ||
    f.attributes.Origin_Y !== f.attributes.Destination_Y
  );

  // maxValue only from LINE features so opacity scaling is not skewed
  const nValues = lineFeatures.map(f => Number(f.attributes.nValue || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const maxValue = nValues.length ? Math.max(...nValues) : 1;
  const minLineValue = nValues.length ? Math.min(...nValues) : 0;
  const animatedThreshold = nValues.length
    ? [...nValues].sort((a, b) => b - a)[Math.min(maxAnimatedRoutes - 1, nValues.length - 1)]
    : Infinity;

  const lineGraphics = [];
  const pointGraphics = [];

  // Draw points for same location features
  sameLocationFeatures.forEach((feature) => {
    const n = feature.attributes.nValue;

    let originX = feature.attributes.Origin_X;
    let originY = feature.attributes.Origin_Y;

    const opacity = Math.min(255, Math.max(60, (n / maxValue) * 255));
    let color = appState.flowDirection === "outflow"
      ? [25, 72, 130, opacity]
      : [25, 130, 67, opacity];

    const point = {
      type: "point",
      x: originX,
      y: originY,
      spatialReference: { wkid: 3857 }
    };

    const pointSymbol = {
      type: "simple-marker",
      color: color,
      size: 18, //Math.min(20, Math.max(6, Math.log10(n) * 3)),
      outline: { color: [255, 255, 255], width: 1 }
    };

    pointGraphics.push(new Graphic({
      geometry: point,
      symbol: pointSymbol,
      attributes: { ...feature.attributes, selectedStateName, flowDirection: appState.flowDirection }
    }));
  });

  // Draw lines for different location features
  lineFeatures.forEach((feature) => {
    const n = feature.attributes.nValue;

    let originX = feature.attributes.Origin_X;
    let originY = feature.attributes.Origin_Y;
    let destinationX = feature.attributes.Destination_X;
    let destinationY = feature.attributes.Destination_Y;

    const opacity = Math.min(255, Math.max(60, (n / maxValue) * 255));
    let color = appState.flowDirection === "outflow"
      ? [25, 72, 130, opacity]
      : [25, 130, 67, opacity];

    const bezierPoints = getBezierPoints(originX, originY, destinationX, destinationY);

    const line = {
      type: "polyline",
      paths: [bezierPoints],
      spatialReference: { wkid: 3857 }
    };

    // Scale width and opacity by volume
    const width = Math.min(10, Math.max(1, Math.log10(n) - 1));
    const arrowSize = Math.min(18, Math.max(6, Math.log10(n) * 3));

    const arrowGeometry = [
      [0, 0],
      [-8, -5.47],
      [-8, 5.47],
      [0, 0]
    ];
    const frame = { xmin: -8, ymin: -5.47, xmax: 0, ymax: 5.47 };

    const symbolLayers = [
      {
        type: "CIMSolidStroke",
        enable: true,
        width: width,
        color: color
      }
    ];

    const shouldAnimateRoute = appState.animateFlowLines && n >= animatedThreshold;
    const animationSpeed = getRouteAnimationSpeed(n, minLineValue, maxValue);

    // Add arrow for both inflow and outflow
    symbolLayers.push({
      type: "CIMVectorMarker",
      enable: true,
      size: arrowSize,
      markerPlacement: {
        type: "CIMMarkerPlacementAlongLineSameSize",
        endings: "WithMarkers",
        placementTemplate: [100],
        angleToLine: true,
        offset: 0,
        controlPointsPlacement: "NoConstraint"
      },
      frame: frame,
      markerGraphics: [
        {
          type: "CIMMarkerGraphic",
          geometry: { rings: [arrowGeometry] },
          symbol: {
            type: "CIMPolygonSymbol",
            symbolLayers: [
              {
                type: "CIMSolidFill",
                enable: true,
                color: color
              }
            ]
          }
        }
      ]
    });

    const lineSymbolData = {
      type: "CIMLineSymbol",
      symbolLayers,
      animations: shouldAnimateRoute ? [
        {
          type: "CIMSymbolAnimationMoveAlongLine",
          movementType: "Speed",
          //distanceAlong: 10,
          speed: animationSpeed,
          continuous: true
        }
      ] : undefined,
      animatedSymbolProperties: shouldAnimateRoute ? {
        playAnimation: true,
        repeatType: "Loop",
        easing: "Linear",
        randomizeStartTime: true,
        randomizeStartSeed: 13
      } : undefined
    };

    const arrowSymbol = {
      type: "cim",
      data: {
        type: "CIMSymbolReference",
        symbol: lineSymbolData
      }
    };

    let popupTitle, popupContent;
    if (appState.geoLevel === "county") {
      let originCounty, originAbbr, destCounty, destAbbr;
      if (appState.flowDirection === "outflow") {
        originCounty = appState.selectedCountyName || "Unknown County";
        originAbbr = appState.selectedCountyAbbr || "Unknown State";
        destCounty = feature.attributes["y2_countyname"] || "Unknown County";
        destAbbr = feature.attributes["y2_state"] || "Unknown State";
      } else {
        originCounty = feature.attributes["y1_countyname"] || "Unknown County";
        originAbbr = feature.attributes["y1_state"] || "Unknown State";
        destCounty = appState.selectedCountyName || "Unknown County";
        destAbbr = appState.selectedCountyAbbr || "Unknown State";
      }
      popupTitle = `${originCounty}, ${originAbbr} to ${destCounty}, ${destAbbr}`;
      popupContent = `<b>${n.toLocaleString()}</b> people moved from <b>${originCounty}, ${originAbbr}</b> to <b>${destCounty}, ${destAbbr}</b>.<br><br>Adjusted Gross Income: <b>$${feature.attributes.AGI ? feature.attributes.AGI.toLocaleString() : ""}</b>`;
    } else {
      if (appState.flowDirection === "outflow") {
        popupTitle = `${selectedStateName} to ${feature.attributes.destinationName}`;
        popupContent = `<b>${n.toLocaleString()}</b> people moved from <b>${selectedStateName}</b> to <b>${feature.attributes.destinationName}</b>.<br><br>Adjusted Gross Income: <b>$${feature.attributes.AGI ? feature.attributes.AGI.toLocaleString() : ""}</b>.`;
      } else {
        popupTitle = `${feature.attributes.originName} to ${selectedStateName}`;
        popupContent = `<b>${n.toLocaleString()}</b> people moved from <b>${feature.attributes.originName}</b> to <b>${selectedStateName}</b>.<br><br>Adjusted Gross Income: <b>$${feature.attributes.AGI ? feature.attributes.AGI.toLocaleString() : ""}</b>.`;
      }
      if (appState.geoLevel === "county" && appState.countyMoveStats) {
        if (appState.flowDirection === "outflow") {
          popupContent += `<hr>
            <b>Of all people who moved from ${appState.selectedCountyName}, ${appState.selectedCountyAbbr}:</b><br>
            <ul>
              <li><b>${appState.countyMoveStats.stayedInState.toLocaleString()}</b> moved to another county <u>within ${appState.selectedCountyAbbr}</u></li>
              <li><b>${appState.countyMoveStats.leftState.toLocaleString()}</b> moved <u>out of state</u></li>
              <li><b>${appState.countyMoveStats.totalMoved.toLocaleString()}</b> total moved out</li>
            </ul>`;
        } else {
          popupContent += `<hr>
            <b>Of all people who moved into ${appState.selectedCountyName}, ${appState.selectedCountyAbbr}:</b><br>
            <ul>
              <li><b>${appState.countyMoveStats.fromInState.toLocaleString()}</b> came from another county <u>within ${appState.selectedCountyAbbr}</u></li>
              <li><b>${appState.countyMoveStats.fromOutOfState.toLocaleString()}</b> came <u>from out of state</u></li>
              <li><b>${appState.countyMoveStats.totalMoved.toLocaleString()}</b> total moved in</li>
            </ul>`;
        }
      }
    }

    lineGraphics.push(new Graphic({
      geometry: line,
      symbol: arrowSymbol,
      attributes: { ...feature.attributes, selectedStateName, flowDirection: appState.flowDirection },
      popupTemplate: {
        title: popupTitle,
        content: popupContent
      }
    }));
  });

  if (lineGraphics.length) {
    appState.linesLayer.addMany(lineGraphics);
  }
  if (pointGraphics.length) {
    appState.pointsLayer.addMany(pointGraphics);
  }

}

export function highlightFeature(feature, view) {
  if (appState.highlightHandle) {
    appState.highlightHandle.remove();
    appState.highlightHandle = null;
  }

  if (appState.linesLayer) {
    appState.linesLayer.graphics = appState.linesLayer.graphics.filter(
      g => !g.attributes?.isCustomHighlight
    );
  }

  if (feature.geometry.type === "polygon") {
    view.highlightOptions = {
      color: [255, 255, 0, 1],
      fillOpacity: 0.2,
      haloOpacity: 0.8
    };
  } else if (feature.geometry.type === "polyline") {
    view.highlightOptions = {
      color: [0, 255, 255, 1],
      haloOpacity: 0.8
    };
  } else if (feature.geometry.type === "point") {
    view.highlightOptions = {
      color: [255, 0, 255, 1],
      haloOpacity: 0.8
    };
  }

  if (feature.layer && (feature.layer.type === "feature" || feature.layer.type === "graphics")) {
    view.whenLayerView(feature.layer).then(layerView => {
      appState.highlightHandle = layerView.highlight(feature);
    });
  }
}

export function updateMigrationSummaryPanel(migrationSummaryDiv) {
  const summaryDiv = migrationSummaryDiv
  if (!summaryDiv) return;

  if (appState.geoLevel === "county" && appState.countyMoveStats) {
    let summaryHtml = "";
    if (appState.flowDirection === "outflow") {
      summaryHtml = `
        <hr>
        <b>Of all people who moved from ${appState.selectedCountyName}, ${appState.selectedCountyAbbr}:</b><br>
        <ul>
          <li><b>${appState.countyMoveStats.stayedInState.toLocaleString()}</b> moved to another county <u>within ${appState.selectedCountyAbbr}</u></li>
          <li><b>${appState.countyMoveStats.leftState.toLocaleString()}</b> moved <u>out of state</u></li>
          <li><b>${appState.countyMoveStats.totalMoved.toLocaleString()}</b> total moved out</li>
        </ul>`;
    } else {
      summaryHtml = `
        <hr>
        <b>Of all people who moved into ${appState.selectedCountyName}, ${appState.selectedCountyAbbr}:</b><br>
        <ul>
          <li><b>${appState.countyMoveStats.fromInState.toLocaleString()}</b> came from another county <u>within ${appState.selectedCountyAbbr}</u></li>
          <li><b>${appState.countyMoveStats.fromOutOfState.toLocaleString()}</b> came <u>from out of state</u></li>
          <li><b>${appState.countyMoveStats.totalMoved.toLocaleString()}</b> total moved in</li>
        </ul>`;
    }
    summaryDiv.innerHTML = summaryHtml;
  } else {
    summaryDiv.innerHTML = "";
  }
}

function getBezierPoints(x1, y1, x2, y2, numPoints = 30) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const curvature = 0.3;
  const cpX = (x1 + x2) / 2 - dy * curvature;
  const cpY = (y1 + y2) / 2 + dx * curvature;

  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cpX + t ** 2 * x2;
    const y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cpY + t ** 2 * y2;
    points.push([x, y]);
  }
  return points;
}

