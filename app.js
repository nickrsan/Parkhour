import { VectorTile } from "https://esm.sh/@mapbox/vector-tile@1.3.1";
import Protobuf from "https://esm.sh/pbf@3.2.1";
import {
  getUrlParam,
  parseConditional,
  evaluateParkingLot,
  evaluateSide,
  processFeatures,
  lon2tile,
  lat2tile
} from "./evaluator.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import {
  saveSettings,
  loadSettings,
  resolveInitialState
} from "./storage.js";
import {
  populateDropdown,
  syncCustomInputVisibility,
  syncDropdownWithCustomInput
} from "./ui-helpers.js";

// 1. Initial State Resolution & Map Initialization
const initialSearchParams = new URLSearchParams(window.location.search);
const initialHash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
const initialHashParams = new URLSearchParams(initialHash);
const initialSavedSettings = loadSettings();
const bootState = resolveInitialState(initialSearchParams, initialHashParams, initialSavedSettings, DEFAULT_CONFIG);

// 2. Map Initialization
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: bootState.center,
  zoom: bootState.zoom
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

// Register PMTiles Protocol
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// State tracking
let currentDataSource = bootState.dataSource;
let appConfig = null;
let activePMTiles = null;
let activePMTilesLayer = "parking";
let activePMTilesHeader = null;
let pmtilesFetchDebounceTimer = null;
let rawFeatures = [];
let currentEvaluatedGeoJSON = { type: "FeatureCollection", features: [] };


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

async function loadPMTilesArchive(url, layerName = "parking") {
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
document.addEventListener("DOMContentLoaded", async () => {
  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
  const hashParams = new URLSearchParams(hash);
  const dtPicker = document.getElementById("eval-datetime");

  const pmtilesSelect = document.getElementById("pmtiles-select");
  const pmtilesUrlInput = document.getElementById("pmtiles-url");
  const pmtilesCustomContainer = document.getElementById("pmtiles-custom-container");

  const overpassSelect = document.getElementById("overpass-select");
  const overpassUrlInput = document.getElementById("overpass-url");
  const overpassCustomContainer = document.getElementById("overpass-custom-container");

  appConfig = await loadConfig();
  const savedSettings = loadSettings();
  const state = resolveInitialState(searchParams, hashParams, savedSettings, appConfig);

  currentDataSource = state.dataSource;

  // Set inputs to resolved values
  if (pmtilesUrlInput) pmtilesUrlInput.value = state.pmtilesUrl;
  if (overpassUrlInput) overpassUrlInput.value = state.overpassUrl;

  // Set radio state
  const radioToSelect = document.querySelector(`input[name="data-source"][value="${currentDataSource}"]`);
  if (radioToSelect) {
    radioToSelect.checked = true;
  }
  const isOverpass = currentDataSource === "overpass";
  document.getElementById("overpass-controls").style.display = isOverpass ? "block" : "none";
  document.getElementById("pmtiles-controls").style.display = isOverpass ? "none" : "block";

  // Populate PMTiles dropdown
  if (pmtilesSelect && appConfig?.pmtilesAreas) {
    populateDropdown(pmtilesSelect, appConfig.pmtilesAreas, state.pmtilesUrl);
    syncCustomInputVisibility(pmtilesSelect, pmtilesUrlInput, pmtilesCustomContainer);

    pmtilesSelect.addEventListener("change", async () => {
      const isCustom = syncCustomInputVisibility(pmtilesSelect, pmtilesUrlInput, pmtilesCustomContainer);
      saveSettings({ pmtilesUrl: pmtilesUrlInput.value.trim() });
      if (!isCustom) {
        const layerName = document.getElementById("pmtiles-layer")?.value.trim() || "parking";
        await loadPMTilesArchive(pmtilesSelect.value, layerName);
      }
    });

    if (pmtilesUrlInput) {
      pmtilesUrlInput.addEventListener("input", () => {
        syncDropdownWithCustomInput(pmtilesUrlInput, pmtilesSelect, appConfig.pmtilesAreas);
        saveSettings({ pmtilesUrl: pmtilesUrlInput.value.trim() });
      });
    }
  }

  // Populate Overpass dropdown
  if (overpassSelect && appConfig?.overpassServers) {
    populateDropdown(overpassSelect, appConfig.overpassServers, state.overpassUrl);
    syncCustomInputVisibility(overpassSelect, overpassUrlInput, overpassCustomContainer);

    overpassSelect.addEventListener("change", () => {
      syncCustomInputVisibility(overpassSelect, overpassUrlInput, overpassCustomContainer);
      saveSettings({ overpassUrl: overpassUrlInput.value.trim() });
      if (currentDataSource === "overpass") {
        fetchOverpassData();
      }
    });

    if (overpassUrlInput) {
      overpassUrlInput.addEventListener("input", () => {
        syncDropdownWithCustomInput(overpassUrlInput, overpassSelect, appConfig.overpassServers);
        saveSettings({ overpassUrl: overpassUrlInput.value.trim() });
      });
    }
  }

  const timeParam = getUrlParam(searchParams, "datetime", "time", "date") ??
                    getUrlParam(hashParams, "datetime", "time", "date");
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
      saveSettings({ dataSource: currentDataSource });
      const overpassActive = currentDataSource === "overpass";
      document.getElementById("overpass-controls").style.display = overpassActive ? "block" : "none";
      document.getElementById("pmtiles-controls").style.display = overpassActive ? "none" : "block";

      if (overpassActive) {
        fetchOverpassData();
      } else if (activePMTiles) {
        fetchPMTilesData();
      } else {
        const url = pmtilesUrlInput?.value.trim() || appConfig.defaultPMTiles;
        const layerName = document.getElementById("pmtiles-layer")?.value.trim() || "parking";
        loadPMTilesArchive(url, layerName);
      }
    });
  });

  document.getElementById("btn-fetch").addEventListener("click", fetchOverpassData);

  document.getElementById("btn-load-pmtiles").addEventListener("click", async () => {
    const url = pmtilesUrlInput.value.trim();
    const layerName = document.getElementById("pmtiles-layer").value.trim() || "parking";
    saveSettings({ pmtilesUrl: url });
    await loadPMTilesArchive(url, layerName);
  });
});

map.on("moveend", () => {
  const center = map.getCenter();
  saveSettings({
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    dataSource: currentDataSource,
    pmtilesUrl: document.getElementById("pmtiles-url")?.value.trim(),
    overpassUrl: document.getElementById("overpass-url")?.value.trim()
  });

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

map.on("load", async () => {
  if (!appConfig) {
    appConfig = await loadConfig();
  }
  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
  const hashParams = new URLSearchParams(hash);
  const savedSettings = loadSettings();
  const state = resolveInitialState(searchParams, hashParams, savedSettings, appConfig);

  if (state.dataSource === "pmtiles" || state.autoLoadPMTiles) {
    const layerName = document.getElementById("pmtiles-layer")?.value.trim() || "parking";
    await loadPMTilesArchive(state.pmtilesUrl, layerName);
  } else if (state.dataSource === "overpass") {
    fetchOverpassData();
  }
});