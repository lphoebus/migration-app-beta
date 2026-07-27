const SVG_NS = "http://www.w3.org/2000/svg";
const DIRECTION_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function createSvgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDirectionLabel(label) {
  const expanded = {
    N: "north",
    NE: "northeast",
    E: "east",
    SE: "southeast",
    S: "south",
    SW: "southwest",
    W: "west",
    NW: "northwest"
  };
  return expanded[label] || label.toLowerCase();
}

function getRenderedDirectionVector(attributes = {}, flowDirection = "outflow") {
  let originX = Number(attributes.Origin_X);
  let originY = Number(attributes.Origin_Y);
  let destinationX = Number(attributes.Destination_X);
  let destinationY = Number(attributes.Destination_Y);

  if (![originX, originY, destinationX, destinationY].every(Number.isFinite)) {
    return null;
  }

  if (flowDirection === "inflow") {
    [originX, originY, destinationX, destinationY] = [destinationX, destinationY, originX, originY];
  }

  const dx = destinationX - originX;
  const dy = destinationY - originY;
  if (!dx && !dy) return null;

  return { dx, dy };
}

function getDirectionIndex(dx, dy) {
  const angle = Math.atan2(dy, dx);
  const compassDegrees = (90 - ((angle * 180) / Math.PI) + 360) % 360;
  return Math.round(compassDegrees / 45) % 8;
}

function aggregateDirectionData(features = [], {
  flowDirection = "outflow",
  minValue = 0,
  mode = "count" //count or migrants
} = {}) {
  const bins = DIRECTION_LABELS.map((label) => ({ label, value: 0 }));
  let total = 0;

  features.forEach((feature) => {
    const attributes = feature?.attributes || {};
    const nValue = Number(attributes.nValue || 0);
    if (!Number.isFinite(nValue) || nValue <= 0 || nValue < minValue) return;

    const vector = getRenderedDirectionVector(attributes, flowDirection);
    if (!vector) return;

    const index = getDirectionIndex(vector.dx, vector.dy);
    const increment = mode === "migrants" ? nValue : 1;
    bins[index].value += increment;
    total += increment;
  });

  const maxValue = Math.max(0, ...bins.map((bin) => bin.value));
  const dominant = bins.reduce((best, current) => (current.value > best.value ? current : best), bins[0]);

  return {
    bins,
    total,
    maxValue,
    dominant: dominant?.value > 0 ? dominant : null,
    mode
  };
}

function renderRadarChart(svg, bins, maxValue) {
  svg.innerHTML = "";

  const size = 220;
  const center = size / 2;
  const radius = 72;
  const ringCount = 4;

  const background = createSvgNode("circle", {
    cx: center,
    cy: center,
    r: radius + 26,
    fill: "rgba(255,255,255,0.9)"
  });
  svg.appendChild(background);

  for (let ring = 1; ring <= ringCount; ring += 1) {
    const ringRadius = (radius * ring) / ringCount;
    const points = bins.map((_, index) => {
      const angle = ((index * 45) - 90) * (Math.PI / 180);
      const x = center + Math.cos(angle) * ringRadius;
      const y = center + Math.sin(angle) * ringRadius;
      return `${x},${y}`;
    }).join(" ");

    svg.appendChild(createSvgNode("polygon", {
      points,
      fill: ring === ringCount ? "rgba(58, 98, 181, 0.05)" : "none",
      stroke: "rgba(110, 122, 145, 0.28)",
      "stroke-width": 1
    }));
  }

  bins.forEach((bin, index) => {
    const angle = ((index * 45) - 90) * (Math.PI / 180);
    const outerX = center + Math.cos(angle) * radius;
    const outerY = center + Math.sin(angle) * radius;
    const labelX = center + Math.cos(angle) * (radius + 18);
    const labelY = center + Math.sin(angle) * (radius + 18);

    svg.appendChild(createSvgNode("line", {
      x1: center,
      y1: center,
      x2: outerX,
      y2: outerY,
      stroke: "rgba(110, 122, 145, 0.28)",
      "stroke-width": 1
    }));

    const label = createSvgNode("text", {
      x: labelX,
      y: labelY,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      class: "flow-direction-axis-label"
    });
    label.textContent = bin.label;
    svg.appendChild(label);
  });

  const polygonPoints = bins.map((bin, index) => {
    const angle = ((index * 45) - 90) * (Math.PI / 180);
    const scaledRadius = maxValue > 0 ? clamp((bin.value / maxValue) * radius, 0, radius) : 0;
    const x = center + Math.cos(angle) * scaledRadius;
    const y = center + Math.sin(angle) * scaledRadius;
    return { x, y, value: bin.value };
  });

  svg.appendChild(createSvgNode("polygon", {
    points: polygonPoints.map(({ x, y }) => `${x},${y}`).join(" "),
    fill: "rgba(37, 99, 235, 0.2)",
    stroke: "rgba(37, 99, 235, 0.95)",
    "stroke-width": 2
  }));

  polygonPoints.forEach(({ x, y, value }) => {
    svg.appendChild(createSvgNode("circle", {
      cx: x,
      cy: y,
      r: value > 0 ? 3.5 : 2,
      fill: value > 0 ? "rgba(37, 99, 235, 1)" : "rgba(110, 122, 145, 0.45)"
    }));
  });

  svg.appendChild(createSvgNode("circle", {
    cx: center,
    cy: center,
    r: 2.5,
    fill: "rgba(51, 65, 85, 0.85)"
  }));
}

export function createFlowDirectionChart({
  cardId = "flow-direction-card",
  svgId = "flow-direction-chart-svg",
  emptyId = "flow-direction-chart-empty",
  summaryId = "flow-direction-chart-summary"
} = {}) {
  const card = document.getElementById(cardId);
  const svg = document.getElementById(svgId);
  const emptyState = document.getElementById(emptyId);
  const summary = document.getElementById(summaryId);

  const setVisible = (visible) => {
    if (!card) return;
    card.hidden = !visible;
  };

  const clear = ({ hideCard = false, message } = {}) => {
    if (svg) svg.innerHTML = "";
    if (summary) {
      summary.textContent = message || "No directional flow lines available for the current selection.";
    }
    if (emptyState) emptyState.hidden = false;
    if (svg) svg.hidden = true;
    if (hideCard) setVisible(false);
  };

  const update = ({
    features = [],
    flowDirection = "outflow",
    minValue = 0,
    aggregation = "count",
    selectedLabel = "Selected geography",
    visible = true
  } = {}) => {
    if (!card || !svg || !summary || !emptyState) return;

    setVisible(visible);
    const normalizedAggregation = aggregation === "migrants" ? "migrants" : "count";
    const result = aggregateDirectionData(features, {
      flowDirection,
      minValue,
      mode: normalizedAggregation
    });

    if (!result.total || !result.maxValue || !result.dominant) {
      clear({
        message: `${selectedLabel}: no directional lines meet the current filter.`
      });
      setVisible(visible);
      return result;
    }

    renderRadarChart(svg, result.bins, result.maxValue);

    const dominantPct = Math.round((result.dominant.value / result.total) * 100);
    const totalLabel = normalizedAggregation === "migrants"
      ? `${Number(result.total).toLocaleString()} migrants`
      : `${Number(result.total).toLocaleString()} paths`;

    summary.textContent = `${selectedLabel}: most visible movement trends ${formatDirectionLabel(result.dominant.label)} (${dominantPct}% of ${totalLabel}).`;
    emptyState.hidden = true;
    svg.hidden = false;

    return result;
  };

  return {
    update,
    clear,
    setVisible
  };
}
