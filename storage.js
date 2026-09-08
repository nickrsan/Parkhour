/**
 * @module storage
 * @description Session persistence and configuration resolution engine for Parkhour.
 * Manages saving and restoring user view settings, endpoints, and data source selections
 * using browser `localStorage` with fallback handling for restricted environments.
 */

import { getUrlParam } from "./evaluator.js";

/**
 * Storage key used in localStorage for Parkhour user settings.
 */
export const STORAGE_KEY = "parkhour_user_settings_v1";

/**
 * Built-in coordinate and zoom defaults.
 */
export const DEFAULT_VIEW = {
  center: [13.38761, 52.51556], // Behrenstraße, Berlin
  zoom: 16
};

/**
 * Safely saves settings to localStorage with defensive error handling
 * for private browsing or quota limits.
 *
 * @param {Object} settings - Settings object to persist.
 * @param {string} [settings.dataSource] - "pmtiles" | "overpass".
 * @param {string} [settings.overpassUrl] - Overpass endpoint URL.
 * @param {string} [settings.pmtilesUrl] - PMTiles URL or file path.
 * @param {[number, number]} [settings.center] - [longitude, latitude].
 * @param {number} [settings.zoom] - Map zoom level.
 * @param {Storage} [storage=window.localStorage] - Storage implementation.
 * @returns {boolean} True if saved successfully, false otherwise.
 */
export function saveSettings(settings, storage = (typeof window !== "undefined" ? window.localStorage : null)) {
  if (!storage || typeof storage.setItem !== "function") return false;

  try {
    const existing = loadSettings(storage) || {};
    const updated = {
      ...existing,
      ...settings,
      lastUpdated: new Date().toISOString()
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return true;
  } catch (err) {
    console.warn("Parkhour: unable to persist settings to localStorage:", err.message);
    return false;
  }
}

/**
 * Safely loads persisted settings from localStorage with JSON parsing guards.
 *
 * @param {Storage} [storage=window.localStorage] - Storage implementation.
 * @returns {Object} Persisted settings object or empty object if missing/invalid.
 */
export function loadSettings(storage = (typeof window !== "undefined" ? window.localStorage : null)) {
  if (!storage || typeof storage.getItem !== "function") return {};

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("Parkhour: error reading settings from localStorage:", err.message);
    return {};
  }
}

/**
 * Parses coordinates and zoom level from search or hash URL parameters.
 * Supports lat, lon/lng/long, zoom/z, map=zoom/lat/lon, and #zoom/lat/lon.
 *
 * @param {URLSearchParams} searchParams - Query string parameters.
 * @param {URLSearchParams} [hashParams] - Hash string parameters.
 * @returns {{ center: [number, number]|null, zoom: number|null }}
 */
export function parseUrlView(searchParams, hashParams = new URLSearchParams()) {
  const latParam = getUrlParam(searchParams, "lat", "latitude", "y") ??
                   getUrlParam(hashParams, "lat", "latitude", "y");
  const lonParam = getUrlParam(searchParams, "lon", "lng", "long", "longitude", "x") ??
                   getUrlParam(hashParams, "lon", "lng", "long", "longitude", "x");
  const zoomParam = getUrlParam(searchParams, "zoom", "z") ??
                    getUrlParam(hashParams, "zoom", "z");

  let lat = latParam !== null ? parseFloat(latParam) : null;
  let lon = lonParam !== null ? parseFloat(lonParam) : null;
  let zoom = zoomParam !== null ? parseFloat(zoomParam) : null;

  // Check map parameter (e.g. map=16/38.58/-121.49)
  const mapParam = getUrlParam(searchParams, "map") ?? getUrlParam(hashParams, "map");
  if (mapParam) {
    const parts = mapParam.split("/");
    if (parts.length >= 3) {
      if (zoom === null || isNaN(zoom)) zoom = parseFloat(parts[0]);
      if (lat === null || isNaN(lat)) lat = parseFloat(parts[1]);
      if (lon === null || isNaN(lon)) lon = parseFloat(parts[2]);
    }
  }

  const validLat = lat !== null && !isNaN(lat) && lat >= -90 && lat <= 90;
  const validLon = lon !== null && !isNaN(lon) && lon >= -180 && lon <= 180;
  const validZoom = zoom !== null && !isNaN(zoom) && zoom >= 0 && zoom <= 24;

  return {
    center: (validLat && validLon) ? [lon, lat] : null,
    zoom: validZoom ? zoom : null
  };
}

/**
 * Resolves application startup state using a strict 3-tier precedence hierarchy:
 * 1. URL Query / Hash parameters (highest priority).
 * 2. Saved `localStorage` settings.
 * 3. `config.json` defaults (fallback).
 *
 * @param {URLSearchParams} searchParams - Current window URL search parameters.
 * @param {URLSearchParams} [hashParams] - Current window URL hash parameters.
 * @param {Object} [savedSettings={}] - Settings retrieved from localStorage.
 * @param {Object} [config={}] - Validated application configuration.
 * @returns {{
 *   center: [number, number],
 *   zoom: number,
 *   dataSource: "pmtiles"|"overpass",
 *   pmtilesUrl: string,
 *   overpassUrl: string,
 *   autoLoadPMTiles: boolean
 * }} The computed initial state.
 */
export function resolveInitialState(
  searchParams = new URLSearchParams(),
  hashParams = new URLSearchParams(),
  savedSettings = {},
  config = {}
) {
  const urlView = parseUrlView(searchParams, hashParams);

  // 1. Center & Zoom
  let center = DEFAULT_VIEW.center;
  let zoom = DEFAULT_VIEW.zoom;

  if (urlView.center) {
    center = urlView.center;
  } else if (
    Array.isArray(savedSettings.center) &&
    savedSettings.center.length === 2 &&
    typeof savedSettings.center[0] === "number" &&
    typeof savedSettings.center[1] === "number"
  ) {
    center = savedSettings.center;
  }

  if (urlView.zoom !== null) {
    zoom = urlView.zoom;
  } else if (typeof savedSettings.zoom === "number" && !isNaN(savedSettings.zoom)) {
    zoom = savedSettings.zoom;
  }

  // 2. PMTiles URL Parameter
  const pmtilesParam = getUrlParam(searchParams, "pmtiles", "pmtile") ??
                       getUrlParam(hashParams, "pmtiles", "pmtile");

  // 3. Overpass URL Parameter
  const overpassParam = getUrlParam(searchParams, "overpass", "overpass_url") ??
                        getUrlParam(hashParams, "overpass", "overpass_url");

  // 4. Data Source Parameter
  const sourceParam = getUrlParam(searchParams, "source", "datasource", "data-source") ??
                      getUrlParam(hashParams, "source", "datasource", "data-source");

  // Resolve PMTiles URL: URL Param > Saved Settings > Config Default
  const pmtilesUrl = (pmtilesParam && pmtilesParam.trim()) ||
                     savedSettings.pmtilesUrl ||
                     config.defaultPMTiles ||
                     "sac_core.pmtiles";

  // Resolve Overpass URL: URL Param > Saved Settings > Config Default
  const overpassUrl = (overpassParam && overpassParam.trim()) ||
                      savedSettings.overpassUrl ||
                      config.defaultOverpass ||
                      "https://overpass-api.de/api/interpreter";

  // Resolve Data Source:
  // If ?pmtiles= is supplied, automatically default to PMTiles
  let dataSource = config.defaultDataSource || "pmtiles";

  if (pmtilesParam) {
    dataSource = "pmtiles";
  } else if (sourceParam && ["pmtiles", "overpass"].includes(sourceParam.toLowerCase())) {
    dataSource = sourceParam.toLowerCase();
  } else if (savedSettings.dataSource && ["pmtiles", "overpass"].includes(savedSettings.dataSource)) {
    dataSource = savedSettings.dataSource;
  }

  const autoLoadPMTiles = Boolean(pmtilesParam || dataSource === "pmtiles");

  return {
    center,
    zoom,
    dataSource,
    pmtilesUrl,
    overpassUrl,
    autoLoadPMTiles
  };
}
