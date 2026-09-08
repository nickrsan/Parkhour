import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CONFIG, validateConfig, loadConfig } from "../../config.js";

describe("config.js Unit Tests", () => {
  it("exports valid DEFAULT_CONFIG structure", () => {
    expect(DEFAULT_CONFIG.defaultDataSource).toBe("pmtiles");
    expect(DEFAULT_CONFIG.defaultPMTiles).toBe("sac_core.pmtiles");
    expect(DEFAULT_CONFIG.pmtilesAreas.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.defaultOverpass).toContain("overpass");
    expect(DEFAULT_CONFIG.overpassServers.length).toBeGreaterThan(0);
  });

  describe("validateConfig", () => {
    it("returns DEFAULT_CONFIG when input is null, undefined, or non-object", () => {
      expect(validateConfig(null)).toEqual(DEFAULT_CONFIG);
      expect(validateConfig(undefined)).toEqual(DEFAULT_CONFIG);
      expect(validateConfig("string")).toEqual(DEFAULT_CONFIG);
      expect(validateConfig([1, 2, 3])).toEqual(DEFAULT_CONFIG);
    });

    it("accepts valid full configuration", () => {
      const custom = {
        defaultDataSource: "overpass",
        defaultPMTiles: "custom.pmtiles",
        pmtilesAreas: [{ name: "Custom Area", url: "https://example.com/custom.pmtiles" }],
        defaultOverpass: "https://custom.overpass/api",
        overpassServers: [{ name: "Custom Server", url: "https://custom.overpass/api" }]
      };
      const result = validateConfig(custom);
      expect(result.defaultDataSource).toBe("overpass");
      expect(result.defaultPMTiles).toBe("custom.pmtiles");
      expect(result.pmtilesAreas).toEqual(custom.pmtilesAreas);
      expect(result.defaultOverpass).toBe("https://custom.overpass/api");
      expect(result.overpassServers).toEqual(custom.overpassServers);
    });

    it("falls back to default values for missing or invalid properties", () => {
      const partial = {
        defaultDataSource: "invalid_source",
        defaultPMTiles: "",
        pmtilesAreas: []
      };
      const result = validateConfig(partial);
      expect(result.defaultDataSource).toBe(DEFAULT_CONFIG.defaultDataSource);
      expect(result.defaultPMTiles).toBe(DEFAULT_CONFIG.defaultPMTiles);
      expect(result.pmtilesAreas).toEqual(DEFAULT_CONFIG.pmtilesAreas);
      expect(result.defaultOverpass).toBe(DEFAULT_CONFIG.defaultOverpass);
      expect(result.overpassServers).toEqual(DEFAULT_CONFIG.overpassServers);
    });
  });

  describe("loadConfig", () => {
    it("successfully loads and parses configuration via custom fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          defaultDataSource: "pmtiles",
          defaultPMTiles: "sac_core.pmtiles",
          pmtilesAreas: [{ name: "Sacramento Core", url: "sac_core.pmtiles" }],
          defaultOverpass: "https://overpass-api.de/api/interpreter",
          overpassServers: [{ name: "OSM", url: "https://overpass-api.de/api/interpreter" }]
        })
      });

      const config = await loadConfig("config.json", mockFetch);
      expect(mockFetch).toHaveBeenCalledWith("config.json");
      expect(config.defaultPMTiles).toBe("sac_core.pmtiles");
      expect(config.defaultDataSource).toBe("pmtiles");
    });

    it("falls back to DEFAULT_CONFIG when HTTP request fails (404/500)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({})
      });

      const config = await loadConfig("missing.json", mockFetch);
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it("falls back to DEFAULT_CONFIG on network or JSON parsing error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection refused"));
      const config = await loadConfig("config.json", mockFetch);
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it("falls back to DEFAULT_CONFIG if no fetch implementation is available", async () => {
      const config = await loadConfig("config.json", null);
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });
});
