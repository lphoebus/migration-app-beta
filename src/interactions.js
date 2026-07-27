import { appState } from "./app_state";
import { highlightFeature } from "./draw";
import { handleOutflow, handleInflow } from "./migration";


export function setupFeatureInfoClick(view, featureInfoDiv, statePolygonLayer, countyPolygonLayer, options = {}) {
    view.when(() => {
        view.on("click", async (event) => {
            const response = await view.hitTest(event);
            const featuresComponent = featureInfoDiv;
            const setFeatureGraphic = (graphic) => {
                if (featuresComponent) {
                    featuresComponent.graphic = graphic;
                }
            };

            // Prioritize point (stay) selection
            const pointGraphic = response.results.find(
                (result) =>
                    result.graphic?.geometry?.type === "point" &&
                    result.graphic?.layer === appState.pointsLayer
            )?.graphic;

            if (pointGraphic) {
                if (appState.highlightHandle) {
                    appState.highlightHandle.remove();
                    appState.highlightHandle = null;
                }
                highlightFeature(pointGraphic, view);
                setFeatureGraphic(pointGraphic);
                appState.selectedLineAttributes = pointGraphic.attributes;
                appState.selectedStatePair = null;
                return;
            }

            // Prioritize polyline (migration line) selection
            const lineGraphic = response.results.find(
                (result) =>
                    result.graphic?.geometry?.type === "polyline" &&
                    result.graphic?.layer === appState.linesLayer
            )?.graphic;

            if (lineGraphic) {
                if (appState.highlightHandle) {
                    appState.highlightHandle.remove();
                    appState.highlightHandle = null;
                }
                highlightFeature(lineGraphic, view);
                setFeatureGraphic(lineGraphic);
                appState.selectedLineAttributes = lineGraphic.attributes;
                appState.selectedStatePair = {
                    stateA: lineGraphic.attributes.originName,
                    stateB: lineGraphic.attributes.destinationName
                };
                return;
            }

            // Otherwise, check for polygon selection
            const polygonGraphic = response.results.find(
                (result) =>
                    result.graphic?.layer?.type === "feature" &&
                    result.graphic?.geometry?.type === "polygon" &&
                    (
                        (appState.geoLevel === "state" && result.graphic.layer === statePolygonLayer) ||
                        (appState.geoLevel === "county" && result.graphic.layer === countyPolygonLayer)
                    )
            )?.graphic;

            if (polygonGraphic) {
                if (appState.highlightHandle) {
                    appState.highlightHandle.remove();
                    appState.highlightHandle = null;
                }
                highlightFeature(polygonGraphic, view);
                setFeatureGraphic(polygonGraphic);
                appState.lastPolygonGraphic = polygonGraphic;

                if (typeof options.onPolygonSelected === "function") {
                    await options.onPolygonSelected(polygonGraphic, view);
                }

                if (options.skipDefaultMigration) {
                    return;
                }

                if (appState.flowDirection === "outflow") {
                    handleOutflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer);
                } else if (appState.flowDirection === "inflow") {
                    handleInflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer);
                } else {
                    handleOutflow(polygonGraphic, view, statePolygonLayer, countyPolygonLayer);
                }
            }
            // If no feature was clicked, clear highlight and info
            if (!pointGraphic && !lineGraphic && !polygonGraphic) {
                if (appState.highlightHandle) {
                    appState.highlightHandle.remove();
                    appState.highlightHandle = null;
                }
                setFeatureGraphic(null);
                appState.selectedLineAttributes = null;
                appState.selectedStatePair = null;
                appState.lastPolygonGraphic = null;

                if (typeof options.onSelectionCleared === "function") {
                    await options.onSelectionCleared(view);
                }
            }
        });
    });
}

export function setupLineHoverPopup(view) {
    view.when(() => {
        view.on("pointer-move", async (event) => {
            const popupDiv = document.getElementById("line-hover-popup");
            if (!appState.lineHoverPopupEnabled) {
                if (popupDiv) popupDiv.style.display = "none";
                return;
            }

            const response = await view.hitTest(event);
            if (popupDiv) popupDiv.style.display = "none";

            // Prioritize polyline (migration line) hover
            const lineGraphic = response.results.find(
                (result) =>
                    result.graphic?.geometry?.type === "polyline" &&
                    result.graphic?.layer === appState.linesLayer
            )?.graphic;

            if (lineGraphic) {
                const attrs = lineGraphic.attributes;
                let popupTitle = "";
                let popupContent = "";

                // --- COUNTY LEVEL POPUP ---
                if (appState.geoLevel === "county") {
                    let originCounty, originAbbr, destCounty, destAbbr;
                    if (appState.flowDirection === "outflow") {
                        originCounty = appState.selectedCountyName || "Unknown County";
                        originAbbr = appState.selectedCountyAbbr || "Unknown State";
                        destCounty = attrs["y2_countyname"] || "Unknown County";
                        destAbbr = attrs["y2_state"] || "Unknown State";
                    } else {
                        originCounty = attrs["y1_countyname"] || "Unknown County";
                        originAbbr = attrs["y1_state"] || "Unknown State";
                        destCounty = appState.selectedCountyName || "Unknown County";
                        destAbbr = appState.selectedCountyAbbr || "Unknown State";
                    }
                    popupTitle = `${originCounty}, ${originAbbr} to ${destCounty}, ${destAbbr}`;
                    popupContent = `<b>${attrs.nValue.toLocaleString()}</b> people moved from <b>${originCounty}, ${originAbbr}</b> to <b>${destCounty}, ${destAbbr}</b>.`;//<br><br>Adjusted Gross Income: <b>$${attrs.AGI ? attrs.AGI.toLocaleString() : "N/A"}</b>.`;
                }
                // --- STATE LEVEL POPUP ---
                else {
                    if (appState.flowDirection === "outflow") {
                        popupTitle = `${attrs.selectedStateName} to ${attrs.destinationName}`;
                        popupContent = `<b>${attrs.nValue.toLocaleString()}</b> people moved from <b>${attrs.selectedStateName}</b> to <b>${attrs.destinationName}</b>.`;//<br><br>Adjusted Gross Income: <b>$${attrs.AGI ? attrs.AGI.toLocaleString() : "N/A"}</b>.`;
                    } else {
                        popupTitle = `${attrs.originName} to ${attrs.selectedStateName}`;
                        popupContent = `<b>${attrs.nValue.toLocaleString()}</b> people moved from <b>${attrs.originName}</b> to <b>${attrs.selectedStateName}</b>.`;//<br><br>Adjusted Gross Income: <b>$${attrs.AGI ? attrs.AGI.toLocaleString() : "N/A"}</b>.`;
                    }
                }

                popupDiv.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">${popupTitle}</div>${popupContent}`;
                popupDiv.style.display = "block";
            } else if (popupDiv) {
                popupDiv.style.display = "none";
            }
        });
    });
}