# Real-Time Parking Map (Curbs & Parking Lots)

An interactive web map built with MapLibre GL JS, `opening_hours.js`, and PMTiles support that dynamically evaluates OpenStreetMap conditional parking restrictions and off-street parking lot accessibility.

Live demo at https://nickrsan.github.io/Parkhour

## Default Data Source & Overpass Protection
The application defaults to local/hosted **PMTiles vector tiles** on initial visit to protect community Overpass API instances from excessive query traffic. You can switch to Overpass mode at any time using the control panel to query live OpenStreetMap data for any area worldwide.

## Features
* **Default PMTiles Mode:** Loads hosted vector tiles instantly without hitting public Overpass server rate limits.
* **Preconfigured Datasets & Endpoints:** Dropdown selectors configured via `config.json` for hosted PMTiles archives (e.g. Sacramento Core, Northern California) and Overpass servers (Main OSM, Kumi Systems, French OSM) with fallback to custom URLs.
* **Session Persistence:** Browser `localStorage` retains chosen data source, endpoint URLs, map center coordinates, and zoom level across reloads.
* **URL Parameter Deep-Linking:** Share direct links with preset coordinates, zoom level, or arbitrary PMTiles files (`?pmtiles=<url>&lat=...&lon=...&zoom=...`) that automatically load on visit.
* **Direction-Agnostic Dual Offset Curbs:** Displays the left side and right side of streets independently using negative and positive `line-offset` values.
* **Three-State Street Logic:**
  * **Blue (`#1e88e5`):** Parking allowed right now.
  * **Yellow (`#f1c40f`):** Allowed now, but has a scheduled restriction starting later today.
  * **Red (`#e53935`):** Restricted right now (or static permit/private/no parking).
* **Parking Lot Polygons:**
  * **Blue:** Public / general parking (`access=yes` / `access=public` / `access=permissive`).
  * **Yellow:** Customers only (`access=customers`).
  * **Red:** Private, permit, residents, or currently closed.
  * **Gray:** Unspecified / unmapped access tag.
* **Dynamic Time Machine:** Adjust the date/time selector in the UI to preview future parking conditions (such as weekday morning street sweeping).
* **Dual Data Providers:**
  * **Overpass API:** Bounding-box queries with local feature mutation via `opening_hours.js`.
  * **PMTiles:** Cloud-optimized vector tile loading from any public URL or GitHub release.

## Automated Testing
Parkhour includes a comprehensive test suite covering all features and regression scenarios:

```bash
# Run Vitest unit & integration tests
npm test

# Run Vitest tests with v8 code coverage
npm run test:coverage

# Run Playwright end-to-end browser tests in Chromium
npm run test:e2e
```

## Documentation
- **[User Guide](documentation/user_guide.md):** Step-by-step instructions for map navigation, time machine usage, dataset selection, and deep linking.
- **[Developer Guide](documentation/developer_guide.md):** Architecture breakdown, API reference (`evaluator.js`, `storage.js`, `ui-helpers.js`, `config.js`), and testing guide.
- **[Feature Registry](FEATURES.md):** Running feature capabilities list and regression verification tracking.

## GitHub Pages Deployment
1. Push `index.html`, `style.css`, and `app.js` to your GitHub repository.
2. In your repository on GitHub, navigate to **Settings > Pages**.
3. Under **Branch**, select `main` (or `master`) and `/ (root)`, then click **Save**.
4. Access your map at `https://<username>.github.io/<repo-name>/`.

## Overpass Ultra Snippet
For one-click map queries without hosting files, copy the contents of `overpass-ultra-parking.yaml` and paste it into [Overpass Ultra](https://overpass-ultra.us).

## GenAI Disclosure
The code in this project was generated almost exclusively by an LLM agent. I used JetBrains Junie
backed by Gemini Flash for the conversion to a standalone project, though I just used Gemini in the browser
for the initial prototypes. I have reviewed the outputs and accepted them to present as my work for this demo, but have
not performed a line by line review.

## License
MIT license - PRs welcome, but any additional generative AI or LLM usage must be disclosed and you must take responsibility
for the quality of the code.