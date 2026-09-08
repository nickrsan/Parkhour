# Parkhour User Guide

Welcome to **Parkhour**, an interactive map application designed to evaluate and visualize real-time parking restrictions, curb lanes, and off-street parking lots using OpenStreetMap data.

---

### Table of Contents
1. [Overview](#overview)
2. [Default PMTiles Vector Mode](#default-pmtiles-vector-mode)
3. [Selecting PMTiles Areas or Custom Archives](#selecting-pmtiles-areas-or-custom-archives)
4. [Using Overpass Mode & Server Selection](#using-overpass-mode--server-selection)
5. [Dynamic Time-Machine (Checking Past or Future Parking)](#dynamic-time-machine-checking-past-or-future-parking)
6. [Interactive Inspection & Popups](#interactive-inspection--popups)
7. [Color Legend & Visual Guide](#color-legend--visual-guide)
8. [Session Persistence](#session-persistence)
9. [Deep-Linking & Sharing Map Views](#deep-linking--sharing-map-views)

---

### Overview
Parkhour displays on-street curb parking regulations and off-street parking lot accessibility. Streets are evaluated direction-agnostically with independent restriction tracking for the **left curb** and **right curb**.

The application operates entirely within your browser (client-side) and fetches geospatial vector tiles or queries live OpenStreetMap data without needing a private backend server.

---

### Default PMTiles Vector Mode
When you open Parkhour, it loads in **PMTiles Vector mode** by default. 

- **Why PMTiles by default?** Vector tiles provide fast loading without hitting public OpenStreetMap / Overpass server rate limits.
- On launch, the map renders parking vector features directly from the configured local or hosted PMTiles archive.

---

### Selecting PMTiles Areas or Custom Archives
In the left floating panel under **PMTiles Vector**:

1. **Preconfigured Areas:**
   - Click the **PMTiles Dataset Area** dropdown to choose from hosted archives (e.g., *Sacramento Core*, *Northern California*).
   - Selecting a preset automatically loads the archive and centers the map over that area.
2. **Custom Archive URL:**
   - Choose **Custom URL...** from the dropdown.
   - An input field labelled **Custom PMTiles URL / Path** will appear.
   - Enter any HTTP/HTTPS URL or local path pointing to a valid `.pmtiles` archive.
   - Specify the source layer name (default is `parking`).
   - Click **Load PMTiles** to inspect restrictions in that dataset.

---

### Using Overpass Mode & Server Selection
If you want to inspect live OpenStreetMap data for any location worldwide:

1. Select the **Overpass API** radio button.
2. **Choose an Overpass Server:**
   - Click the **Overpass Server** dropdown to select among preconfigured community interpreter endpoints:
     - **Main OSM (`overpass-api.de`)**: The standard global Overpass server.
     - **Kumi Systems (`overpass.kumi.systems`)**: High-performance mirror.
     - **French OSM Instance (`overpass.openstreetmap.fr`)**: Regional European mirror.
     - **Custom URL...**: Enter an arbitrary Overpass interpreter URL.
3. Click **Reload Area Data** to fetch raw OSM features within the currently visible map bounding box.

---

### Dynamic Time-Machine (Checking Past or Future Parking)
Parking rules vary depending on the day of week and time of day (e.g., street sweeping on Tuesdays between 08:00 and 10:00, or free parking after 18:00).

- **Evaluation Time:** Use the datetime picker in the panel to inspect restrictions at any past or future date and time.
- **Reset to Now:** Click the **Reset to Now** button to quickly snap back to your current local date and time.
- As soon as the timestamp changes, curbs and lots immediately recalculate their visual status.

---

### Interactive Inspection & Popups
Click on any colored curb lane or parking lot polygon to open a detailed inspection popup:

- **Street Segments:**
  - Displays the street name (or "Unnamed Street").
  - Shows left curb status and exact rule condition (e.g., `no_parking @ (Mo-Fr 08:00-18:00)`).
  - Shows right curb status and rule condition.
- **Parking Lots:**
  - Displays the facility name and access status.
  - Lists fee requirements and vehicle capacity when mapped.
- **Timestamp Audit:** Every popup indicates the exact evaluation timestamp used for the calculation.

---

### Color Legend & Visual Guide

| Color | Hex Code | Street Curb Status | Parking Lot Status | Meaning |
|---|---|---|---|---|
| **Blue** | `#1e88e5` | Parking Allowed | Public / Allowed | Permitted parking; no restrictions begin later today. |
| **Yellow** | `#f1c40f` | Restricted Later Today | Customers Only | Allowed right now, but a restriction begins later today; or restricted to store customers. |
| **Red** | `#e53935` | Restricted / No Parking | Private / Closed | Actively prohibited right now, private permit required, or lot is currently closed. |
| **Gray** | `#b0bec5` | No Curb Lane / Unmapped | Unmapped Access | No parking tags or access rules are mapped on OpenStreetMap. |

---

### Session Persistence
Parkhour automatically remembers your settings across browser sessions using `localStorage`:
- Your last map center position and zoom level.
- The active data source (PMTiles vs Overpass).
- The selected PMTiles area or custom URL.
- The selected Overpass server endpoint.

When you reopen the map, you resume exactly where you left off.

---

### Deep-Linking & Sharing Map Views
You can bookmark or share direct links with predefined coordinates, zoom levels, data sources, and archives:

- **PMTiles Archive:** `?pmtiles=https://example.com/city.pmtiles`
- **Coordinates & Zoom:** `?lat=38.5816&lon=-121.4944&zoom=15`
- **Compact Map Format:** `?map=15/38.5816/-121.4944` or `#15/38.5816/-121.4944`
- **Data Source:** `?source=pmtiles` or `?source=overpass`
- **Overpass Server:** `?overpass=https://overpass.kumi.systems/api/interpreter`
- **Evaluation Time:** `?datetime=2026-09-08T10:00:00`

*Example Shared Link:*
```text
https://username.github.io/Parkhour/?pmtiles=sac_core.pmtiles&lat=38.5816&lon=-121.4944&zoom=15
```
Opening this link will center the map at Sacramento and load vector features from `sac_core.pmtiles`.
