# Real-Time Parking Map (Curbs & Parking Lots)

An interactive web map built with MapLibre GL JS, `opening_hours.js`, and PMTiles support that dynamically evaluates OpenStreetMap conditional parking restrictions and off-street parking lot accessibility.

## Features
* **Direction-Agnostic Dual Offset Curbs:** Displays the left side and right side of streets independently using negative and positive `line-offset` values.
* **Three-State Street Logic:**
  * **Blue (`#1e88e5`):** Parking allowed right now.
  * **Yellow (`#f1c40f`):** Allowed now, but has a scheduled restriction starting later today.
  * **Red (`#e53935`):** Restricted right now (or static permit/private/no parking).
* **Parking Lot Polygons:**
  * **Blue:** Public / general parking.
  * **Yellow:** Customers only (`access=customers`).
  * **Red:** Private, permit, residents, or currently closed.
* **Dynamic Time Machine:** Adjust the date/time selector in the UI to preview future parking conditions (such as weekday morning street sweeping).
* **Dual Data Providers:**
  * **Overpass API:** Bounding-box queries with local feature mutation via `opening_hours.js`.
  * **PMTiles:** Cloud-optimized vector tile loading from any public URL or GitHub release.

## GitHub Pages Deployment
1. Push `index.html`, `style.css`, and `app.js` to your GitHub repository.
2. In your repository on GitHub, navigate to **Settings > Pages**.
3. Under **Branch**, select `main` (or `master`) and `/ (root)`, then click **Save**.
4. Access your map at `https://<username>.github.io/<repo-name>/`.

## Overpass Ultra Snippet
For one-click map queries without hosting files, copy the contents of `overpass-ultra-parking.yaml` and paste it into [Overpass Ultra](https://overpass-ultra.us).