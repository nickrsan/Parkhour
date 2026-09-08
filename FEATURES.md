# Parkhour Features & Capabilities Registry

This document maintains the running registry of all supported Parkhour features, functional specifications, and regression verification checks. Before modifying any codebase logic, verify that changes do not regress any features recorded below.

---

## Existing Baseline Features

### 1. Dual-Curb Left/Right Parking Evaluation
- **Description:** Streets are evaluated direction-agnostically with independent restriction tracking for the left curb and right curb lanes.
- **Specification:**
  - Evaluates tags such as `parking:lane:left:*`, `parking:lane:right:*`, `parking:left:*`, `parking:right:*`, `parking:both:*`, and `parking:lane:both:*`.
  - Prioritizes conditional restrictions (`*:conditional`), followed by explicit access rules, lane types, and default restrictions (`parking:restriction`).
  - Renders separate left and right curb offset lines flanking the road centerline.

### 2. Three-State Curb Restriction Status
- **Description:** Curb segments are categorized into color-coded status states based on active and upcoming restrictions:
  - **`allowed` (Blue, `#1e88e5`):** Parking is currently permitted and no restrictions begin later today.
  - **`restricted_today` (Yellow, `#f1c40f`):** Parking is allowed right now, but a restriction will begin later today (e.g. street sweeping at 14:00).
  - **`restricted` (Red, `#e53935`):** Parking is prohibited right now by an active restriction or prohibitive tag (e.g. `no_parking`, `no_stopping`, `private`).
  - **`unmapped` (Gray, `#b0bec5`):** No parking lane or restriction tags are mapped for this side of the street.

### 3. Off-Street Parking Lot Evaluation
- **Description:** Evaluates polygon/multipolygon parking lots (`amenity=parking`) for public and private access.
- **Specification:**
  - Evaluates `access` and `parking:access` tags alongside scheduled restrictions (`opening_hours`).
  - `access=yes`, `access=public`, `access=permissive` categorized as `allowed` (`#1e88e5`).
  - `access=customers` categorized as `customers` (`#f1c40f`).
  - `access=private`, `no`, `permit`, `residents`, `employees` categorized as `restricted` (`#e53935`).
  - When `opening_hours` indicates the lot is currently closed, marked as `restricted`.
  - Unmapped access tags categorized as `unmapped` (`#b0bec5`).

### 4. Dynamic Time-Machine
- **Description:** Users can evaluate parking conditions at any arbitrary date and time or reset immediately to the current time.
- **Specification:**
  - Date and time picker (`#eval-datetime`) allows inspecting future and past conditions.
  - "Reset to Now" button (`#btn-now`) snaps back to the current local date and time.
  - URL parameters (`datetime`, `time`, `date`) allow initializing the evaluation timestamp.
  - Conditional expressions are evaluated using `opening_hours` against the chosen timestamp.

### 5. Dual Data Providers (Overpass API and PMTiles)
- **Description:** Map supports querying live Overpass API endpoints as well as extracting vector data directly from PMTiles archives.
- **Specification:**
  - Overpass mode queries road ways with parking tags and parking lots within the bounding box, converting them via `osmtogeojson`.
  - PMTiles mode fetches tile byte ranges (`pmtiles.Protocol`) and decodes vector tiles (`@mapbox/vector-tile`, `pbf`) client-side.
  - Debounced tile fetching ensures smooth panning and zooming without overwhelming network channels.

### 6. Interactive Popup Inspector
- **Description:** Clicking any curb line or parking lot displays an informative popup details card.
- **Specification:**
  - Displays feature name or default label ("Parking Lot", "Unnamed Street").
  - For curbs: displays left curb status and exact parsed rule, and right curb status and exact parsed rule.
  - For lots: displays access status, rule, fee, and capacity (if available).
  - Shows evaluation timestamp for full auditability.

### 7. Deep-Linking via URL Parameters
- **Description:** Map coordinates, zoom level, and evaluation time can be specified via URL query or hash parameters.
- **Specification:**
  - Supports `lat` / `latitude` / `y`, `lon` / `lng` / `long` / `x`, `zoom` / `z`, `map=zoom/lat/lon`, and `#zoom/lat/lon`.
  - Supports initial evaluation time via `datetime`, `time`, or `date`.

---

## Planned Enhancements (Completed)

- [x] **Default PMTiles Data Source:** App loads PMTiles mode by default on initial visit without querying Overpass servers.
- [x] **Preconfigured Hosted PMTiles Areas:** Dropdown selector to choose between preconfigured PMTiles datasets (`config.json`) and custom URLs.
- [x] **Configurable Overpass Server:** Dropdown selector to choose between preconfigured Overpass API endpoints and custom URLs.
- [x] **Session Persistence:** Browser `localStorage` retains selected provider, URLs, map center, and zoom level across reloads.
- [x] **URL Parameter PMTiles Loading:** Automatically activates and loads archives when `?pmtiles=...` is specified in the URL.
- [x] **Automated Test Suite:** Comprehensive Vitest unit tests and Playwright E2E browser tests ensuring 100% feature reliability.
