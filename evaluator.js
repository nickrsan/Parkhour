/**
 * @module evaluator
 * @description Core parking restriction evaluation and geospatial math engine for Parkhour.
 * Provides direction-agnostic curb evaluation, parking lot accessibility resolution,
 * time-machine interval calculations, and tile coordinate mathematics.
 */

import opening_hours from "https://esm.sh/opening_hours";

/**
 * Case-insensitively retrieves a parameter value from URLSearchParams.
 *
 * @param {URLSearchParams} params - Search or hash URL parameters.
 * @param {...string} keys - Candidate parameter names to match against.
 * @returns {string|null} The parameter value if matched, or null.
 */
export function getUrlParam(params, ...keys) {
  if (!params || typeof params.entries !== "function") return null;
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

/**
 * Parses an OpenStreetMap conditional restriction string into an array of rule objects.
 * Handles nested parentheses and semicolon separators.
 *
 * Example input: "no_parking @ (Mo-Fr 08:00-18:00); no_stopping @ (Mo-Fr 07:00-09:00)"
 *
 * @param {string} str - Raw OSM conditional syntax string.
 * @returns {Array<{ value: string, cond: string }>} Array of parsed condition objects.
 */
export function parseConditional(str) {
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

/**
 * Determines whether a given restriction or access tag value represents a prohibitive parking rule.
 *
 * @param {string} val - Tag value string (e.g., "no_parking", "customers", "private").
 * @returns {boolean} True if the value prohibits general public parking.
 */
export function isProhibitive(val) {
  return (
    typeof val === "string" &&
    /^(no_parking|no_stopping|no_standing|loading_only|loading|delivery|no|none|private|permits?|residents?|customers?|disabled)$/i.test(val.trim())
  );
}

/**
 * Evaluates the parking accessibility status for an off-street parking lot.
 *
 * Status states:
 * - "allowed": Public or permissive parking permitted.
 * - "customers": Restricted to customers of adjacent businesses.
 * - "restricted": Private, permit, or closed per scheduled opening_hours.
 * - "unmapped": No access tag mapped.
 *
 * @param {Object} props - OSM feature tags / properties.
 * @param {Date} now - Evaluation timestamp.
 * @returns {{ status: "allowed"|"customers"|"restricted"|"unmapped", rule: string }}
 */
export function evaluateParkingLot(props, now) {
  const access = (props.access || props["parking:access"] || "").toLowerCase().trim();
  const ohStr = props.opening_hours;

  if (ohStr) {
    try {
      const oh = new opening_hours(ohStr);
      if (!oh.getState(now)) {
        return { status: "restricted", rule: `Closed now per opening hours (${ohStr})` };
      }
    } catch (e) {
      // Fallback gracefully on opening_hours parse error
    }
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

/**
 * Evaluates street curb parking status for a given road side ("left" or "right").
 *
 * Priority order:
 * 1. Active conditional restriction (active right now).
 * 2. Upcoming conditional restriction starting later today.
 * 3. Prohibitive access, lane, or way-level parking tags.
 * 4. Default restriction tags.
 * 5. Expired restriction from earlier today (permitted now).
 * 6. Default permitted or unmapped state.
 *
 * @param {"left"|"right"} side - Side of street to evaluate.
 * @param {Object} props - OSM way properties / tags.
 * @param {Date} now - Evaluation timestamp.
 * @returns {{ status: "allowed"|"restricted_today"|"restricted"|"unmapped", rule: string }}
 */
export function evaluateSide(side, props, now) {
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
      } catch (e) {
        // Fallback gracefully on opening_hours parse error
      }
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

/**
 * Processes a collection of raw OSM features (from Overpass or PMTiles) into evaluated
 * GeoJSON features with left/right curb restrictions or parking lot accessibility.
 *
 * @param {Array<Object>|{ features: Array<Object> }} geojsonOrFeatures - Input features.
 * @param {Date} evalTime - Date and time for restriction evaluation.
 * @returns {{ type: "FeatureCollection", features: Array<Object> }} Evaluated GeoJSON FeatureCollection.
 */
export function processFeatures(geojsonOrFeatures, evalTime) {
  const list = Array.isArray(geojsonOrFeatures)
    ? geojsonOrFeatures
    : (geojsonOrFeatures?.features || []);
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

/**
 * Calculates the Web Mercator tile X coordinate for a given longitude and zoom level.
 *
 * @param {number} lon - Longitude in degrees (-180 to 180).
 * @param {number} zoom - Zoom level (0 to 24).
 * @returns {number} Tile X coordinate.
 */
export function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

/**
 * Calculates the Web Mercator tile Y coordinate for a given latitude and zoom level.
 *
 * @param {number} lat - Latitude in degrees (-90 to 90).
 * @param {number} zoom - Zoom level (0 to 24).
 * @returns {number} Tile Y coordinate.
 */
export function lat2tile(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));
}
