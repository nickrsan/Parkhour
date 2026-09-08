/**
 * @module config
 * @description Configuration loader and schema validator for Parkhour.
 * Provides fallback defaults for hosted PMTiles archives and Overpass interpreter servers.
 */

/**
 * Built-in default configuration used as fallback if config.json fails to load.
 */
export const DEFAULT_CONFIG = {
  defaultDataSource: "pmtiles",
  defaultPMTiles: "sac_core.pmtiles",
  pmtilesAreas: [
    { name: "Sacramento Core", url: "sac_core.pmtiles" },
    { name: "Northern California", url: "norcal-260906.pmtiles" }
  ],
  defaultOverpass: "https://overpass-api.de/api/interpreter",
  overpassServers: [
    { name: "Main OSM (overpass-api.de)", url: "https://overpass-api.de/api/interpreter" },
    { name: "Kumi Systems", url: "https://overpass.kumi.systems/api/interpreter" },
    { name: "French OSM Instance", url: "https://overpass.openstreetmap.fr/api/interpreter" }
  ]
};

/**
 * Validates and normalizes configuration options, falling back to defaults for missing keys.
 *
 * @param {Object} raw - Raw configuration object parsed from JSON.
 * @returns {typeof DEFAULT_CONFIG} Validated configuration.
 */
export function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIG };
  }

  const defaultDataSource = typeof raw.defaultDataSource === "string" && ["overpass", "pmtiles"].includes(raw.defaultDataSource)
    ? raw.defaultDataSource
    : DEFAULT_CONFIG.defaultDataSource;

  const defaultPMTiles = typeof raw.defaultPMTiles === "string" && raw.defaultPMTiles.trim()
    ? raw.defaultPMTiles.trim()
    : DEFAULT_CONFIG.defaultPMTiles;

  const pmtilesAreas = Array.isArray(raw.pmtilesAreas) && raw.pmtilesAreas.length > 0
    ? raw.pmtilesAreas.filter(a => a && typeof a.name === "string" && typeof a.url === "string")
    : DEFAULT_CONFIG.pmtilesAreas;

  const defaultOverpass = typeof raw.defaultOverpass === "string" && raw.defaultOverpass.trim()
    ? raw.defaultOverpass.trim()
    : DEFAULT_CONFIG.defaultOverpass;

  const overpassServers = Array.isArray(raw.overpassServers) && raw.overpassServers.length > 0
    ? raw.overpassServers.filter(s => s && typeof s.name === "string" && typeof s.url === "string")
    : DEFAULT_CONFIG.overpassServers;

  return {
    defaultDataSource,
    defaultPMTiles,
    pmtilesAreas: pmtilesAreas.length > 0 ? pmtilesAreas : DEFAULT_CONFIG.pmtilesAreas,
    defaultOverpass,
    overpassServers: overpassServers.length > 0 ? overpassServers : DEFAULT_CONFIG.overpassServers
  };
}

/**
 * Asynchronously loads configuration from a URL with graceful fallback to built-in defaults.
 *
 * @param {string} [url="config.json"] - Path or URL to the configuration JSON file.
 * @param {Function} [customFetch] - Optional custom fetch implementation for testing or polyfills.
 * @returns {Promise<typeof DEFAULT_CONFIG>} The resolved configuration object.
 */
export async function loadConfig(url = "config.json", customFetch = (typeof fetch !== "undefined" ? fetch : null)) {
  if (!customFetch) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const response = await customFetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch config from ${url}: HTTP ${response.status}. Using default configuration.`);
      return { ...DEFAULT_CONFIG };
    }
    const data = await response.json();
    return validateConfig(data);
  } catch (error) {
    console.warn(`Error loading config from ${url}: ${error.message}. Using default configuration.`);
    return { ...DEFAULT_CONFIG };
  }
}
