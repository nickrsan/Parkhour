import { describe, it, expect } from "vitest";
import {
  getUrlParam,
  parseConditional,
  isProhibitive,
  evaluateParkingLot,
  evaluateSide,
  processFeatures,
  lon2tile,
  lat2tile
} from "../../evaluator.js";

describe("evaluator.js Unit Tests", () => {
  describe("getUrlParam", () => {
    it("retrieves parameter case-insensitively", () => {
      const params = new URLSearchParams("LAT=38.5&Lon=-121.5&Zoom=15");
      expect(getUrlParam(params, "lat")).toBe("38.5");
      expect(getUrlParam(params, "lon", "lng")).toBe("-121.5");
      expect(getUrlParam(params, "zoom", "z")).toBe("15");
      expect(getUrlParam(params, "missing")).toBeNull();
    });

    it("returns null for invalid inputs", () => {
      expect(getUrlParam(null, "lat")).toBeNull();
      expect(getUrlParam({}, "lat")).toBeNull();
    });
  });

  describe("parseConditional", () => {
    it("parses single conditional rule", () => {
      const res = parseConditional("no_parking @ (Mo-Fr 08:00-18:00)");
      expect(res).toEqual([{ value: "no_parking", cond: "Mo-Fr 08:00-18:00" }]);
    });

    it("parses multiple conditional rules separated by semicolons", () => {
      const res = parseConditional("no_parking @ (Mo-Fr 08:00-18:00); no_stopping @ (Mo-Fr 07:00-09:00)");
      expect(res).toHaveLength(2);
      expect(res[0]).toEqual({ value: "no_parking", cond: "Mo-Fr 08:00-18:00" });
      expect(res[1]).toEqual({ value: "no_stopping", cond: "Mo-Fr 07:00-09:00" });
    });

    it("handles nested parentheses and whitespace", () => {
      const res = parseConditional("   no_parking @ (Mo-Fr 08:00-18:00; Sa 09:00-12:00)  ");
      expect(res).toEqual([{ value: "no_parking", cond: "Mo-Fr 08:00-18:00; Sa 09:00-12:00" }]);
    });

    it("returns empty array for empty or non-string inputs", () => {
      expect(parseConditional("")).toEqual([]);
      expect(parseConditional(null)).toEqual([]);
      expect(parseConditional(123)).toEqual([]);
    });
  });

  describe("isProhibitive", () => {
    it("identifies prohibitive restriction keywords", () => {
      expect(isProhibitive("no_parking")).toBe(true);
      expect(isProhibitive("no_stopping")).toBe(true);
      expect(isProhibitive("no_standing")).toBe(true);
      expect(isProhibitive("loading_only")).toBe(true);
      expect(isProhibitive("private")).toBe(true);
      expect(isProhibitive("permit")).toBe(true);
      expect(isProhibitive("residents")).toBe(true);
      expect(isProhibitive("customers")).toBe(true);
      expect(isProhibitive("disabled")).toBe(true);
      expect(isProhibitive("no")).toBe(true);
    });

    it("identifies non-prohibitive restriction keywords", () => {
      expect(isProhibitive("free")).toBe(false);
      expect(isProhibitive("yes")).toBe(false);
      expect(isProhibitive("ticket")).toBe(false);
      expect(isProhibitive("disc")).toBe(false);
      expect(isProhibitive("")).toBe(false);
      expect(isProhibitive(null)).toBe(false);
    });
  });

  describe("evaluateParkingLot", () => {
    // Reference date: Monday at 10:00 AM
    const mondayMorning = new Date("2026-09-07T10:00:00");
    // Reference date: Monday at 23:00 (11:00 PM)
    const mondayNight = new Date("2026-09-07T23:00:00");

    it("evaluates public and permissive access as allowed", () => {
      expect(evaluateParkingLot({ access: "yes" }, mondayMorning).status).toBe("allowed");
      expect(evaluateParkingLot({ access: "public" }, mondayMorning).status).toBe("allowed");
      expect(evaluateParkingLot({ access: "permissive" }, mondayMorning).status).toBe("allowed");
      expect(evaluateParkingLot({ "parking:access": "yes" }, mondayMorning).status).toBe("allowed");
    });

    it("evaluates customer access as customers", () => {
      const res = evaluateParkingLot({ access: "customers" }, mondayMorning);
      expect(res.status).toBe("customers");
      expect(res.rule).toContain("access=customers");
    });

    it("evaluates private, permit, residents, employees, and no as restricted", () => {
      expect(evaluateParkingLot({ access: "private" }, mondayMorning).status).toBe("restricted");
      expect(evaluateParkingLot({ access: "permit" }, mondayMorning).status).toBe("restricted");
      expect(evaluateParkingLot({ access: "residents" }, mondayMorning).status).toBe("restricted");
      expect(evaluateParkingLot({ access: "employees" }, mondayMorning).status).toBe("restricted");
      expect(evaluateParkingLot({ access: "no" }, mondayMorning).status).toBe("restricted");
    });

    it("evaluates unmapped access as unmapped", () => {
      const res = evaluateParkingLot({}, mondayMorning);
      expect(res.status).toBe("unmapped");
    });

    it("evaluates opening_hours restrictions", () => {
      const lotWithHours = {
        access: "yes",
        opening_hours: "Mo-Fr 08:00-18:00"
      };

      // Open at 10:00 AM
      const openRes = evaluateParkingLot(lotWithHours, mondayMorning);
      expect(openRes.status).toBe("allowed");

      // Closed at 23:00 PM
      const closedRes = evaluateParkingLot(lotWithHours, mondayNight);
      expect(closedRes.status).toBe("restricted");
      expect(closedRes.rule).toContain("Closed now per opening hours");
    });

    it("handles malformed opening_hours gracefully", () => {
      const malformed = {
        access: "yes",
        opening_hours: "INVALID_SYNTAX_9999"
      };
      // Should not throw, should fall back to access evaluation
      const res = evaluateParkingLot(malformed, mondayMorning);
      expect(res.status).toBe("allowed");
    });
  });

  describe("evaluateSide (Curb Evaluation)", () => {
    // 2026-09-07 is Monday
    const monday0700 = new Date("2026-09-07T07:00:00");
    const monday1000 = new Date("2026-09-07T10:00:00");
    const monday1500 = new Date("2026-09-07T15:00:00");
    const monday2000 = new Date("2026-09-07T20:00:00");

    it("returns unmapped when no parking tags exist", () => {
      const res = evaluateSide("left", { highway: "residential" }, monday1000);
      expect(res.status).toBe("unmapped");
      expect(res.rule).toBe("No parking mapped");
    });

    it("evaluates active prohibitive conditional restriction as restricted", () => {
      const props = {
        "parking:lane:left:restriction:conditional": "no_parking @ (Mo-Fr 08:00-18:00)"
      };
      const res = evaluateSide("left", props, monday1000);
      expect(res.status).toBe("restricted");
      expect(res.rule).toContain("Active right now: no_parking");
    });

    it("evaluates upcoming prohibitive restriction today as restricted_today", () => {
      const props = {
        "parking:lane:left:restriction:conditional": "no_parking @ (Mo-Fr 14:00-16:00)"
      };
      // At 10:00 AM, restriction starts later at 14:00 (2:00 PM)
      const res = evaluateSide("left", props, monday1000);
      expect(res.status).toBe("restricted_today");
      expect(res.rule).toContain("Restricted later today");
    });

    it("evaluates allowed when a restriction already ended earlier today", () => {
      const props = {
        "parking:lane:left:restriction:conditional": "no_parking @ (Mo-Fr 06:00-09:00)"
      };
      // At 15:00, morning street sweeping ended at 09:00
      const res = evaluateSide("left", props, monday1500);
      expect(res.status).toBe("allowed");
      expect(res.rule).toContain("Allowed now (restriction ended today");
    });

    it("evaluates default restriction when no conditional is present", () => {
      const propsRestricted = {
        "parking:lane:right:restriction": "no_parking"
      };
      expect(evaluateSide("right", propsRestricted, monday1000).status).toBe("restricted");

      const propsAllowed = {
        "parking:lane:right:restriction": "free"
      };
      expect(evaluateSide("right", propsAllowed, monday1000).status).toBe("allowed");
    });

    it("evaluates access and lane tags appropriately", () => {
      expect(evaluateSide("left", { "parking:left:access": "private" }, monday1000).status).toBe("restricted");
      expect(evaluateSide("right", { "parking:lane:right": "no_stopping" }, monday1000).status).toBe("restricted");
      expect(evaluateSide("right", { "parking": "no_parking" }, monday1000).status).toBe("restricted");
    });

    it("evaluates dual curbs independently on the same street", () => {
      const props = {
        // Left side: street sweeping on Monday 12:00-14:00
        "parking:lane:left:restriction:conditional": "no_parking @ (Mo 12:00-14:00)",
        // Right side: permitted free parking
        "parking:lane:right:restriction": "free"
      };

      // At 10:00 AM on Monday:
      // Left side is restricted later today
      const leftRes = evaluateSide("left", props, monday1000);
      expect(leftRes.status).toBe("restricted_today");

      // Right side is allowed
      const rightRes = evaluateSide("right", props, monday1000);
      expect(rightRes.status).toBe("allowed");
    });
  });

  describe("processFeatures", () => {
    const monday1000 = new Date("2026-09-07T10:00:00");

    it("processes street ways into dual-curb features", () => {
      const rawFeatures = [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[-121.49, 38.58], [-121.48, 38.58]]
          },
          properties: {
            name: "Main St",
            "parking:lane:left:restriction": "no_parking",
            "parking:lane:right:restriction": "free"
          }
        }
      ];

      const result = processFeatures(rawFeatures, monday1000);
      expect(result.type).toBe("FeatureCollection");
      expect(result.features).toHaveLength(1);

      const f = result.features[0];
      expect(f.properties.is_parking_lot).toBe(false);
      expect(f.properties.parking_left_status).toBe("restricted");
      expect(f.properties.parking_right_status).toBe("allowed");
      expect(f.properties.eval_time).toBeDefined();
    });

    it("processes parking lot polygons into lot features", () => {
      const rawLot = [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-121.49, 38.58], [-121.48, 38.58], [-121.48, 38.59], [-121.49, 38.58]]]
          },
          properties: {
            amenity: "parking",
            name: "City Hall Garage",
            access: "public",
            fee: "yes",
            capacity: "250"
          }
        }
      ];

      const result = processFeatures(rawLot, monday1000);
      expect(result.features).toHaveLength(1);

      const lot = result.features[0];
      expect(lot.properties.is_parking_lot).toBe(true);
      expect(lot.properties.parking_lot_status).toBe("allowed");
      expect(lot.properties.fee).toBe("yes");
      expect(lot.properties.capacity).toBe("250");
    });
  });

  describe("lon2tile & lat2tile", () => {
    it("computes Web Mercator tile coordinates correctly", () => {
      // Zoom 0 should always be tile (0, 0)
      expect(lon2tile(0, 0)).toBe(0);
      expect(lat2tile(0, 0)).toBe(0);

      // Sacramento, CA (-121.4944, 38.5816) at zoom 15
      const x = lon2tile(-121.4944, 15);
      const y = lat2tile(38.5816, 15);
      expect(x).toBe(5325);
      expect(y).toBe(12572);

      // Berlin (13.38761, 52.51556) at zoom 16
      const bx = lon2tile(13.38761, 16);
      const by = lat2tile(52.51556, 16);
      expect(bx).toBe(35205);
      expect(by).toBe(21494);
    });
  });
});
