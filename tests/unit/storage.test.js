// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  STORAGE_KEY,
  DEFAULT_VIEW,
  saveSettings,
  loadSettings,
  parseUrlView,
  resolveInitialState
} from "../../storage.js";

describe("storage.js Unit Tests", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("saveSettings & loadSettings", () => {
    it("saves and retrieves settings from localStorage", () => {
      const settings = {
        dataSource: "pmtiles",
        pmtilesUrl: "sac_core.pmtiles",
        overpassUrl: "https://overpass-api.de/api/interpreter",
        center: [-121.49, 38.58],
        zoom: 15
      };

      const saved = saveSettings(settings, window.localStorage);
      expect(saved).toBe(true);

      const loaded = loadSettings(window.localStorage);
      expect(loaded.dataSource).toBe("pmtiles");
      expect(loaded.pmtilesUrl).toBe("sac_core.pmtiles");
      expect(loaded.overpassUrl).toBe("https://overpass-api.de/api/interpreter");
      expect(loaded.center).toEqual([-121.49, 38.58]);
      expect(loaded.zoom).toBe(15);
      expect(loaded.lastUpdated).toBeDefined();
    });

    it("merges incremental setting updates without overwriting untouched keys", () => {
      saveSettings({ dataSource: "pmtiles", zoom: 14 });
      saveSettings({ zoom: 16, overpassUrl: "https://custom.overpass/" });

      const loaded = loadSettings(window.localStorage);
      expect(loaded.dataSource).toBe("pmtiles");
      expect(loaded.zoom).toBe(16);
      expect(loaded.overpassUrl).toBe("https://custom.overpass/");
    });

    it("handles corrupted JSON in localStorage gracefully without throwing", () => {
      window.localStorage.setItem(STORAGE_KEY, "INVALID_JSON_CORRUPTED{{{");
      const loaded = loadSettings(window.localStorage);
      expect(loaded).toEqual({});
    });

    it("handles localStorage quota or security exceptions gracefully", () => {
      const brokenStorage = {
        getItem: vi.fn(),
        setItem: vi.fn().mockImplementation(() => {
          throw new Error("QuotaExceededError");
        })
      };

      const result = saveSettings({ zoom: 15 }, brokenStorage);
      expect(result).toBe(false);
    });
  });

  describe("parseUrlView", () => {
    it("parses query parameters lat, lon, zoom", () => {
      const search = new URLSearchParams("lat=38.58&lon=-121.49&zoom=15");
      const view = parseUrlView(search);
      expect(view.center).toEqual([-121.49, 38.58]);
      expect(view.zoom).toBe(15);
    });

    it("parses slash-delimited map parameter", () => {
      const search = new URLSearchParams("map=14/38.58/-121.49");
      const view = parseUrlView(search);
      expect(view.center).toEqual([-121.49, 38.58]);
      expect(view.zoom).toBe(14);
    });

    it("parses hash parameters", () => {
      const search = new URLSearchParams();
      const hash = new URLSearchParams("lat=52.51&lon=13.38&zoom=16");
      const view = parseUrlView(search, hash);
      expect(view.center).toEqual([13.38, 52.51]);
      expect(view.zoom).toBe(16);
    });

    it("returns null for invalid or missing coordinates", () => {
      const search = new URLSearchParams("lat=999&lon=999"); // Out of bounds
      const view = parseUrlView(search);
      expect(view.center).toBeNull();
      expect(view.zoom).toBeNull();
    });
  });

  describe("resolveInitialState (Hierarchy Resolution)", () => {
    const mockConfig = {
      defaultDataSource: "pmtiles",
      defaultPMTiles: "sac_core.pmtiles",
      defaultOverpass: "https://overpass-api.de/api/interpreter"
    };

    it("Tier 1: URL parameters override both localStorage and config defaults", () => {
      const search = new URLSearchParams("lat=38.58&lon=-121.49&zoom=15&pmtiles=custom.pmtiles");
      const saved = {
        center: [10.0, 50.0],
        zoom: 12,
        dataSource: "overpass",
        pmtilesUrl: "old.pmtiles"
      };

      const state = resolveInitialState(search, new URLSearchParams(), saved, mockConfig);

      expect(state.center).toEqual([-121.49, 38.58]);
      expect(state.zoom).toBe(15);
      expect(state.dataSource).toBe("pmtiles");
      expect(state.pmtilesUrl).toBe("custom.pmtiles");
      expect(state.autoLoadPMTiles).toBe(true);
    });

    it("Tier 2: Saved localStorage settings override config defaults when URL params are absent", () => {
      const search = new URLSearchParams();
      const saved = {
        center: [-121.48, 38.57],
        zoom: 14,
        dataSource: "overpass",
        overpassUrl: "https://overpass.kumi.systems/api/interpreter"
      };

      const state = resolveInitialState(search, new URLSearchParams(), saved, mockConfig);

      expect(state.center).toEqual([-121.48, 38.57]);
      expect(state.zoom).toBe(14);
      expect(state.dataSource).toBe("overpass");
      expect(state.overpassUrl).toBe("https://overpass.kumi.systems/api/interpreter");
      expect(state.pmtilesUrl).toBe(mockConfig.defaultPMTiles);
    });

    it("Tier 3: Fallback to config defaults when neither URL params nor localStorage are present", () => {
      const search = new URLSearchParams();
      const saved = {};

      const state = resolveInitialState(search, new URLSearchParams(), saved, mockConfig);

      expect(state.center).toEqual(DEFAULT_VIEW.center);
      expect(state.zoom).toBe(DEFAULT_VIEW.zoom);
      expect(state.dataSource).toBe("pmtiles");
      expect(state.pmtilesUrl).toBe("sac_core.pmtiles");
      expect(state.overpassUrl).toBe("https://overpass-api.de/api/interpreter");
    });

    it("Automatically activates PMTiles mode when ?pmtiles= is specified in URL", () => {
      const search = new URLSearchParams("pmtiles=https://example.com/city.pmtiles");
      const saved = { dataSource: "overpass" };

      const state = resolveInitialState(search, new URLSearchParams(), saved, mockConfig);

      expect(state.dataSource).toBe("pmtiles");
      expect(state.pmtilesUrl).toBe("https://example.com/city.pmtiles");
      expect(state.autoLoadPMTiles).toBe(true);
    });
  });
});
