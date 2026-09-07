import opening_hours from "https://esm.sh/opening_hours";
import { VectorTile } from "https://esm.sh/@mapbox/vector-tile@1.3.1";
import Protobuf from "https://esm.sh/pbf@3.2.1";

// 1. URL Parameters & Initial View Setup
function getUrlParam(params, ...keys) {
  for (const [k, v] of params.entries()) {
    const lowerK = k.toLowerCase();
    for (const key of keys) {
      if (lowerK === key.toLowerCase()) {
        return v;
      }
    }
  }
  return null;
}

function getInitialView() {
  const defaultCenter = [13.38761, 52.51556]; // Behrenstraße, Berlin
  const defaultZoom = 16;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    const hashParams = new URLSearchParams(hash);

    // Query / Hash parameters: lat, lon/lng/long, zoom/z (case-insensitive)
    const latParam = getUrlParam(searchParams, "lat", "latitude", "y") ??
                     getUrlParam(hashParams, "lat", "latitude", "y");
    const lonParam = getUrlParam(searchParams, "lon", "lng", "long", "longitude", "x") ??
                     getUrlParam(hashParams, "lon", "lng", "long", "longitude", "x");
    const zoomParam = getUrlParam(searchParams, "zoom", "z") ??
                      getUrlParam(hashParams, "zoom", "z");

    let lat = latParam !== null ? parseFloat(latParam) : null;
    let lon = lonParam !== null ? parseFloat(lonParam) : null;
    let zoom = zoomParam !== null ? parseFloat(zoomParam) : null;

    // Check for map parameter (e.g., map=zoom/lat/lon or ?map=16/52.51556/13.38761)
    const mapParam = getUrlParam(searchParams, "map") ?? getUrlParam(hashParams, "map");
    if (mapParam) {
      const parts = mapParam.split("/");
      if (parts.length >= 3) {
        if (zoom === null || isNaN(zoom)) zoom = parseFloat(parts[0]);
        if (lat === null || isNaN(lat)) lat = parseFloat(parts[1]);
        if (lon === null || isNaN(lon)) lon = parseFloat(parts[2]);
      }
    }

    // Check for standard hash format #zoom/lat/lon or #map=zoom/lat/lon
    if (hash && (lat === null || lon === null || isNaN(lat) || isNaN(lon))) {
      let cleanHash = hash;
      if (cleanHash.startsWith("map=")) cleanHash = cleanHash.slice(4);
      const parts = cleanHash.split("/");
      if (parts.length >= 3) {
        const hZ = parseFloat(parts[0]);
        const hLat = parseFloat(parts[1]);
        const hLon = parseFloat(parts[2]);
        if (!isNaN(hZ) && (zoom === null || isNaN(zoom))) zoom = hZ;
        if (!isNaN(hLat) && (lat === null || isNaN(lat))) lat = hLat;
        if (!isNaN(hLon) && (lon === null || isNaN(lon))) lon = hLon;
      }
    }

    const finalLat = (lat !== null && !isNaN(lat) && lat >= -90 && lat <= 90) ? lat : defaultCenter[1];
    const finalLon = (lon !== null && !isNaN(lon) && lon >= -180 && lon <= 180) ? lon : defaultCenter[0];
    const finalZoom = (zoom !== null && !isNaN(zoom) && zoom >= 0 && zoom <= 24) ? zoom : defaultZoom;

    return {
      center: [finalLon, finalLat],
      zoom: finalZoom
    };
  } catch (e) {
    return {
      center: defaultCenter,
      zoom: defaultZoom
    };
  }
}

const initialView = getInitialView();

// 2. Map Initialization
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: initialView.center,
  zoom: initialView.zoom
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

// Register PMTiles Protocol
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// State tracking
let currentDataSource = "overpass";
let activePMTiles = null;
let activePMTilesLayer = "parking";
let activePMTilesHeader = null;
let pmtilesFetchDebounceTimer = null;
let rawFeatures = [];
let currentEvaluatedGeoJSON = { type: "FeatureCollection", features: [] };

// 3. Evaluator Functions
function parseConditional(str) {
  if (!str || typeof str !== "string") return [];
  const segments = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) {
      if (cur.trim()) segments.push(cur.trim());
      cur = "";
    } else {
      cur += char;
    }
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments.map((seg) => {
    const atIdx = seg.indexOf("@");
    if (atIdx === -1) return null;
    const value = seg.slice(0, atIdx).trim().toLowerCase();
    let cond = seg.slice(atIdx + 1).trim();
    if (cond.startsWith("(") && cond.endsWith(")")) cond = cond.slice(1, -1).trim();
    return { value, cond };
  }).filter(Boolean);
}

function evaluateParkingLot(props, now) {
  const access = (props.access || props["parking:access"] || "").toLowerCase().trim();
  const ohStr = props.opening_hours;

  if (ohStr) {
    try {
      const oh = new opening_hours(ohStr);
      if (!oh.getState(now)) {
        return { status: "restricted", rule: `Closed now per opening hours (${ohStr})` };
      }
    } catch (e) {}
  }

  if (access === "customers") {
    return { status: "customers", rule: "Customers only (access=customers)" };
  }
  if (["private", "no", "permit", "residents", "employees"].includes(access)) {
    return { status: "restricted", rule: `Restricted access (access=${access})` };
  }
  if (access === "yes" || access === "public" || access === "permissive") {
    return { status: "allowed", rule: `Public parking (access=${access})` };
  }
  if (!access) {
    return { status: "unmapped", rule: "No access tag mapped (unspecified)" };
  }
  return { status: "restricted", rule: `Access restricted (${access})` };
}

function evaluateSide(side, props, now) {
  const condTag = props[`parking:${side}:restriction:conditional`] ||
                  props[`parking:lane:${side}:restriction:conditional`] ||
                  props[`parking:${side}:access:conditional`] ||
                  props[`parking:lane:${side}:access:conditional`] ||
                  props[`parking:lane:${side}:conditional`] ||
                  props[`parking:condition:${side}:conditional`] ||
                  props[`parking:${side}:maxstay:conditional`] ||
                  props[`parking:lane:${side}:maxstay:conditional`] ||
                  props["parking:both:restriction:conditional"] ||
                  props["parking:both:access:conditional"] ||
                  props["parking:lane:both:conditional"] ||
                  props["parking:condition:both:conditional"] ||
                  props["parking:both:maxstay:conditional"] ||
                  props["parking:lane:both:maxstay:conditional"];
  const defaultRestr = props[`parking:${side}:restriction`] ||
                       props[`parking:lane:${side}:restriction`] ||
                       props[`parking:condition:${side}`] ||
                       props["parking:both:restriction"] ||
                       props["parking:lane:both:restriction"] ||
                       props["parking:condition:both"] ||
                       props["parking:restriction"];
  const accessTag = props[`parking:${side}:access`] ||
                    props[`parking:lane:${side}:access`] ||
                    props["parking:both:access"] ||
                    props["parking:lane:both:access"] ||
                    props["parking:access"];
  const laneTag = props[`parking:${side}`] ||
                  props[`parking:lane:${side}`] ||
                  props["parking:both"] ||
                  props["parking:lane:both"];
  const wayParking = props["parking"];

  const hasParkingData = condTag || defaultRestr || accessTag || laneTag || wayParking;
  if (!hasParkingData) {
    return { status: "unmapped", rule: "No parking mapped" };
  }

  const isProhibitive = (v) =>
    typeof v === "string" &&
    /^(no_parking|no_stopping|no_standing|loading_only|loading|delivery|no|none|private|permits?|residents?|customers?|disabled)$/i.test(v.trim());

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let activeNowRule = null;
  let upcomingRule = null;
  let upcomingStart = null;
  let pastEndedRule = null;
  let pastEndTime = null;

  if (condTag) {
    const rules = parseConditional(condTag);
    for (const r of rules) {
      try {
        const oh = new opening_hours(r.cond);
        if (oh.getState(now)) {
          activeNowRule = r;
        } else if (isProhibitive(r.value)) {
          const intervalsLater = oh.getOpenIntervals(now, endOfDay);
          if (intervalsLater && intervalsLater.length > 0) {
            const nextStart = intervalsLater[0][0];
            if (!upcomingStart || nextStart < upcomingStart) {
              upcomingStart = nextStart;
              upcomingRule = r;
            }
          }
          const intervalsAllToday = oh.getOpenIntervals(startOfDay, endOfDay);
          for (const inv of intervalsAllToday) {
            if (inv[1] <= now && (!pastEndTime || inv[1] > pastEndTime)) {
              pastEndTime = inv[1];
              pastEndedRule = r;
            }
          }
        }
      } catch (e) {}
    }
  }

  if (activeNowRule) {
    if (isProhibitive(activeNowRule.value)) {
      return { status: "restricted", rule: `Active right now: ${activeNowRule.value} @ (${activeNowRule.cond})` };
    }
    return { status: "allowed", rule: `Active right now: ${activeNowRule.value} @ (${activeNowRule.cond})` };
  }

  if (upcomingRule && upcomingStart) {
    const timeStr = upcomingStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { status: "restricted_today", rule: `Restricted later today at ${timeStr}: ${upcomingRule.value} @ (${upcomingRule.cond})` };
  }

  if (accessTag && isProhibitive(accessTag)) {
    return { status: "restricted", rule: `Access restricted: ${accessTag}` };
  }
  if (wayParking && isProhibitive(wayParking)) {
    return { status: "restricted", rule: `Street parking: ${wayParking}` };
  }
  if (laneTag && isProhibitive(laneTag)) {
    return { status: "restricted", rule: `Parking lane: ${laneTag}` };
  }
  if (defaultRestr) {
    return isProhibitive(defaultRestr)
      ? { status: "restricted", rule: `Default restriction: ${defaultRestr}` }
      : { status: "allowed", rule: `Default: ${defaultRestr}` };
  }

  if (pastEndedRule && pastEndTime) {
    const endStr = pastEndTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { status: "allowed", rule: `Allowed now (restriction ended today at ${endStr})` };
  }

  return { status: "allowed", rule: condTag ? "Outside restricted hours (allowed)" : "Permitted" };
}

function processFeatures(geojsonOrFeatures, evalTime) {
  const list = Array.isArray(geojsonOrFeatures)
    ? geojsonOrFeatures
    : (geojsonOrFeatures.features || []);
  const evalTimeStr = evalTime.toLocaleTimeString([], { weekday: "long", hour: "2-digit", minute: "2-digit" });

  const processed = list.map((f) => {
    const rawProps = f.properties?.tags ? { ...f.properties.tags } : { ...(f.properties || {}) };
    const p = rawProps;

    const isLot = p.amenity === "parking" ||
                  (f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"));

    const newProps = { ...p };

    if (isLot && p.amenity === "parking") {
      const lot = evaluateParkingLot(p, evalTime);
      newProps.is_parking_lot = true;
      newProps.parking_lot_status = lot.status;
      newProps.parking_lot_rule = lot.rule;
      newProps.eval_time = evalTimeStr;
    } else {
      const left = evaluateSide("left", p, evalTime);
      const right = evaluateSide("right", p, evalTime);

      newProps.is_parking_lot = false;
      newProps.parking_left_status = left.status;
      newProps.parking_left_rule = left.rule;
      newProps.parking_right_status = right.status;
      newProps.parking_right_rule = right.rule;
      newProps.eval_time = evalTimeStr;
    }

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: newProps
    };
  });

  return {
    type: "FeatureCollection",
    features: processed
  };
}

// 4. Map Layers Setup
function addParkingLayers(sourceId) {
  if (map.getLayer("street-centerline")) return;

  const common = { source: sourceId };

  // Centerline
  map.addLayer({
    id: "street-centerline",
    type: "line",
    ...common,
    filter: ["!=", ["get", "is_parking_lot"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": 1.5,
      "line-color": "#7f8c8d",
      "line-opacity": 0.4,
      "line-dasharray": [2, 2]
    }
  });

  // Left Curb
  map.addLayer({
    id: "parking-left-curb",
    type: "line",
    ...common,
    filter: ["!=", ["get", "is_parking_lot"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": { stops: [[13, 2], [15, 3.5], [17, 5], [19, 7]] },
      "line-offset": { stops: [[13, -2.5], [15, -5], [17, -8.5], [19, -13]] },
      "line-color": [
        "match",
        ["get", "parking_left_status"],
        "allowed", "#1e88e5",
        "restricted_today", "#f1c40f",
        "restricted", "#e53935",
        "#b0bec5"
      ]
    }
  });

  // Right Curb
  map.addLayer({
    id: "parking-right-curb",
    type: "line",
    ...common,
    filter: ["!=", ["get", "is_parking_lot"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": { stops: [[13, 2], [15, 3.5], [17, 5], [19, 7]] },
      "line-offset": { stops: [[13, 2.5], [15, 5], [17, 8.5], [19, 13]] },
      "line-color": [
        "match",
        ["get", "parking_right_status"],
        "allowed", "#1e88e5",
        "restricted_today", "#f1c40f",
        "restricted", "#e53935",
        "#b0bec5"
      ]
    }
  });

  // Parking Lots Fill
  map.addLayer({
    id: "parking-lots-fill",
    type: "fill",
    ...common,
    filter: ["==", ["get", "is_parking_lot"], true],
    paint: {
      "fill-color": [
        "match",
        ["get", "parking_lot_status"],
        "allowed", "#1e88e5",
        "customers", "#f1c40f",
        "restricted", "#e53935",
        "#b0bec5"
      ],
      "fill-opacity": 0.45
    }
  });

  // Parking Lots Outline
  map.addLayer({
    id: "parking-lots-outline",
    type: "line",
    ...common,
    filter: ["==", ["get", "is_parking_lot"], true],
    paint: {
      "line-color": [
        "match",
        ["get", "parking_lot_status"],
        "allowed", "#0d47a1",
        "customers", "#b78103",
        "restricted", "#b71c1c",
        "#546e7a"
      ],
      "line-width": 2
    }
  });

  // Hover cursor styling
  ["parking-left-curb", "parking-right-curb", "parking-lots-fill"].forEach((layerId) => {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  });
}

function setMapData(geojsonData) {
  if (map.getSource("parking-geojson")) {
    map.getSource("parking-geojson").setData(geojsonData);
  } else {
    map.addSource("parking-geojson", {
      type: "geojson",
      data: geojsonData
    });
    addParkingLayers("parking-geojson");
  }
}

// Tile coordinate calculation helpers
function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));
}

// 5. Data Fetchers
async function fetchOverpassData() {
  const status = document.getElementById("status-indicator");
  const bounds = map.getBounds();
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const endpoint = document.getElementById("overpass-url").value.trim();

  const query = `[out:json][timeout:25][bbox:${bbox}];
(
  way[~"^parking"~"."];
  way["highway"~"^(unclassified|residential|primary|secondary|tertiary|living_street)$"];
  wr["amenity"="parking"];
);
out body;
>;
out skel qt;`;

  status.textContent = "Querying Overpass API...";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      body: query,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const osmData = await res.json();
    const rawGeoJSON = osmtogeojson(osmData);
    rawFeatures = rawGeoJSON.features || [];

    const evalTime = getSelectedDateTime();
    currentEvaluatedGeoJSON = processFeatures(rawFeatures, evalTime);
    setMapData(currentEvaluatedGeoJSON);
    status.textContent = `Loaded ${currentEvaluatedGeoJSON.features.length} features from Overpass.`;
  } catch (err) {
    status.textContent = `Overpass error: ${err.message}`;
  }
}

async function fetchPMTilesData() {
  if (!activePMTiles || !activePMTilesHeader) return;
  const status = document.getElementById("status-indicator");

  const bounds = map.getBounds();
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();

  const currentZoom = Math.round(map.getZoom());
  const minZ = activePMTilesHeader.minZoom ?? 0;
  const maxZ = activePMTilesHeader.maxZoom ?? 16;
  const zoom = Math.min(maxZ, Math.max(minZ, currentZoom));

  const minX = Math.max(0, lon2tile(west, zoom));
  const maxX = Math.min(Math.pow(2, zoom) - 1, lon2tile(east, zoom));
  const minY = Math.max(0, lat2tile(north, zoom));
  const maxY = Math.min(Math.pow(2, zoom) - 1, lat2tile(south, zoom));

  const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
  if (tileCount > 64 && currentZoom < minZ) {
    status.textContent = `Zoom in closer to evaluate PMTiles parking restrictions (${tileCount} tiles in view).`;
    return;
  }

  status.textContent = "Loading PMTiles vector data...";

  try {
    const tilePromises = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tilePromises.push(
          activePMTiles.getZxy(zoom, x, y).then((res) => ({ res, x, y, z: zoom }))
        );
      }
    }

    const tileResults = await Promise.all(tilePromises);
    const extractedFeatures = [];

    for (const { res, x, y, z } of tileResults) {
      if (!res || !res.data) continue;
      const pbf = new Protobuf(new Uint8Array(res.data));
      const vt = new VectorTile(pbf);
      const layer = vt.layers[activePMTilesLayer];
      if (layer) {
        for (let i = 0; i < layer.length; i++) {
          extractedFeatures.push(layer.feature(i).toGeoJSON(x, y, z));
        }
      }
    }

    rawFeatures = extractedFeatures;
    const evalTime = getSelectedDateTime();
    currentEvaluatedGeoJSON = processFeatures(rawFeatures, evalTime);
    setMapData(currentEvaluatedGeoJSON);
    status.textContent = `Loaded ${currentEvaluatedGeoJSON.features.length} features from PMTiles.`;
  } catch (err) {
    status.textContent = `PMTiles error: ${err.message}`;
  }
}

function getSelectedDateTime() {
  const picker = document.getElementById("eval-datetime");
  return picker.value ? new Date(picker.value) : new Date();
}

// 6. Popup Handler
map.on("click", (e) => {
  const features = map.queryRenderedFeatures(e.point, {
    layers: ["parking-left-curb", "parking-right-curb", "parking-lots-fill"]
  });
  if (!features.length) return;

  const f = features[0];
  const p = f.properties;
  let html = `<div style="font-family: sans-serif; font-size: 13px; min-width: 200px;">`;

  if (p.is_parking_lot === "true" || p.is_parking_lot === true) {
    html += `<h3 style="margin: 0 0 4px 0;">${p.name || "Parking Lot"}</h3>`;
    html += `<div><b>Status:</b> ${p.parking_lot_status}</div>`;
    html += `<div style="font-size: 11px; color: #555; margin-top: 2px;"><code>${p.parking_lot_rule}</code></div>`;
    if (p.fee) html += `<div style="font-size: 11px; color: #555;"><b>Fee:</b> ${p.fee}</div>`;
    if (p.capacity) html += `<div style="font-size: 11px; color: #555;"><b>Capacity:</b> ${p.capacity} spaces</div>`;
  } else {
    html += `<h3 style="margin: 0 0 4px 0;">${p.name || "Unnamed Street"}</h3>`;
    html += `<div style="margin-bottom: 4px;"><b>Left Curb:</b> ${p.parking_left_status}<br/><span style="font-size: 11px; color: #555;"><code>${p.parking_left_rule}</code></span></div>`;
    html += `<div><b>Right Curb:</b> ${p.parking_right_status}<br/><span style="font-size: 11px; color: #555;"><code>${p.parking_right_rule}</code></span></div>`;
  }

  html += `<div style="font-size: 10px; color: #888; margin-top: 6px; border-top: 1px solid #eee; padding-top: 4px;">Evaluated: ${p.eval_time}</div></div>`;

  new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
});

// 7. UI Controls & Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  const searchParams = new URLSearchParams(window.location.search);
  const dtPicker = document.getElementById("eval-datetime");

  const timeParam = getUrlParam(searchParams, "datetime", "time", "date");
  if (timeParam) {
    const parsedDate = new Date(timeParam);
    if (!isNaN(parsedDate.getTime())) {
      dtPicker.value = new Date(parsedDate.getTime() - parsedDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    } else {
      const now = new Date();
      dtPicker.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
  } else {
    const now = new Date();
    dtPicker.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  document.getElementById("btn-now").addEventListener("click", () => {
    const current = new Date();
    dtPicker.value = new Date(current.getTime() - current.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    reEvaluateCurrentData();
  });

  dtPicker.addEventListener("change", reEvaluateCurrentData);

  document.querySelectorAll('input[name="data-source"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      currentDataSource = e.target.value;
      const isOverpass = currentDataSource === "overpass";
      document.getElementById("overpass-controls").style.display = isOverpass ? "block" : "none";
      document.getElementById("pmtiles-controls").style.display = isOverpass ? "none" : "block";

      if (isOverpass) {
        fetchOverpassData();
      } else if (activePMTiles) {
        fetchPMTilesData();
      }
    });
  });

  document.getElementById("btn-fetch").addEventListener("click", fetchOverpassData);

  document.getElementById("btn-load-pmtiles").addEventListener("click", async () => {
    const url = document.getElementById("pmtiles-url").value.trim();
    const layerName = document.getElementById("pmtiles-layer").value.trim() || "parking";
    const status = document.getElementById("status-indicator");
    if (!url) {
      status.textContent = "Please enter a PMTiles URL or file path.";
      return;
    }

    status.textContent = "Opening PMTiles archive...";
    try {
      activePMTiles = new pmtiles.PMTiles(url);
      activePMTilesHeader = await activePMTiles.getHeader();
      activePMTilesLayer = layerName;

      // If map is currently outside the PMTiles bounds, fly to center
      if (activePMTilesHeader.minLon !== undefined && activePMTilesHeader.maxLon !== undefined) {
        const bounds = map.getBounds();
        const intersects = !(
          bounds.getEast() < activePMTilesHeader.minLon ||
          bounds.getWest() > activePMTilesHeader.maxLon ||
          bounds.getNorth() < activePMTilesHeader.minLat ||
          bounds.getSouth() > activePMTilesHeader.maxLat
        );
        if (!intersects) {
          const centerLon = activePMTilesHeader.centerLon ?? (activePMTilesHeader.minLon + activePMTilesHeader.maxLon) / 2;
          const centerLat = activePMTilesHeader.centerLat ?? (activePMTilesHeader.minLat + activePMTilesHeader.maxLat) / 2;
          map.flyTo({
            center: [centerLon, centerLat],
            zoom: Math.max(14, activePMTilesHeader.centerZoom || 15)
          });
        }
      }

      await fetchPMTilesData();
    } catch (err) {
      status.textContent = `Failed to load PMTiles: ${err.message}`;
    }
  });

  // Handle URL source parameters on initial page load
  const pmtilesParam = getUrlParam(searchParams, "pmtiles", "pmtile");
  const sourceParam = getUrlParam(searchParams, "source", "datasource", "data-source");
  if (pmtilesParam || sourceParam === "pmtiles") {
    if (pmtilesParam) {
      document.getElementById("pmtiles-url").value = pmtilesParam;
    }
    const pmtilesRadio = document.querySelector('input[name="data-source"][value="pmtiles"]');
    if (pmtilesRadio) {
      pmtilesRadio.checked = true;
      pmtilesRadio.dispatchEvent(new Event("change"));
    }
  }
});

map.on("moveend", () => {
  if (currentDataSource === "pmtiles" && activePMTiles) {
    if (pmtilesFetchDebounceTimer) clearTimeout(pmtilesFetchDebounceTimer);
    pmtilesFetchDebounceTimer = setTimeout(() => {
      fetchPMTilesData();
    }, 200);
  }
});

function reEvaluateCurrentData() {
  if (rawFeatures && rawFeatures.length) {
    const evalTime = getSelectedDateTime();
    currentEvaluatedGeoJSON = processFeatures(rawFeatures, evalTime);
    setMapData(currentEvaluatedGeoJSON);
  }
}

map.on("load", () => {
  if (currentDataSource === "overpass") {
    fetchOverpassData();
  }
});