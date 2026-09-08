import { test, expect } from "@playwright/test";

test.describe("Parkhour End-to-End Application Flows", () => {
  test("Initial Page Load defaults to PMTiles mode without querying Overpass", async ({ page }) => {
    let overpassQueried = false;
    await page.route("**/interpreter**", (route) => {
      overpassQueried = true;
      route.abort();
    });

    await page.goto("/");

    // 1. Verify PMTiles radio is selected by default
    const pmtilesRadio = page.locator('input[name="data-source"][value="pmtiles"]');
    await expect(pmtilesRadio).toBeChecked();

    const overpassRadio = page.locator('input[name="data-source"][value="overpass"]');
    await expect(overpassRadio).not.toBeChecked();

    // 2. Verify controls visibility
    await expect(page.locator("#pmtiles-controls")).toBeVisible();
    await expect(page.locator("#overpass-controls")).toBeHidden();

    // 3. Verify dropdown has preconfigured options
    const pmtilesSelect = page.locator("#pmtiles-select");
    await expect(pmtilesSelect).toBeVisible();
    await expect(pmtilesSelect).toHaveValue("sac_core.pmtiles");

    // 4. Verify no requests were made to Overpass API
    expect(overpassQueried).toBe(false);
  });

  test("PMTiles selection allows switching presets and reveals custom input", async ({ page }) => {
    await page.goto("/");

    const pmtilesSelect = page.locator("#pmtiles-select");
    const customContainer = page.locator("#pmtiles-custom-container");
    const pmtilesInput = page.locator("#pmtiles-url");

    // Initially preset is selected, custom container hidden
    await expect(customContainer).toBeHidden();

    // Switch to Northern California preset
    await pmtilesSelect.selectOption("norcal-260906.pmtiles");
    await expect(pmtilesInput).toHaveValue("norcal-260906.pmtiles");
    await expect(customContainer).toBeHidden();

    // Select Custom URL...
    await pmtilesSelect.selectOption("custom");
    await expect(customContainer).toBeVisible();
    await expect(pmtilesInput).toBeFocused();

    // Type a custom URL
    await pmtilesInput.fill("https://example.com/custom-parking.pmtiles");
    await expect(pmtilesSelect).toHaveValue("custom");
  });

  test("Overpass server selector updates query endpoint", async ({ page }) => {
    let capturedOverpassUrl = "";
    await page.route("**/api/interpreter**", (route) => {
      capturedOverpassUrl = route.request().url();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 0.6, generator: "Mock", elements: [] })
      });
    });

    await page.goto("/");

    // Switch to Overpass
    await page.click('input[name="data-source"][value="overpass"]');
    await expect(page.locator("#overpass-controls")).toBeVisible();
    await expect(page.locator("#pmtiles-controls")).toBeHidden();

    const overpassSelect = page.locator("#overpass-select");
    const overpassInput = page.locator("#overpass-url");
    const customContainer = page.locator("#overpass-custom-container");

    // Switch to Kumi Systems server
    await overpassSelect.selectOption("https://overpass.kumi.systems/api/interpreter");
    await expect(overpassInput).toHaveValue("https://overpass.kumi.systems/api/interpreter");
    await expect(customContainer).toBeHidden();

    // Trigger Reload
    await page.click("#btn-fetch");
    expect(capturedOverpassUrl).toBe("https://overpass.kumi.systems/api/interpreter");

    // Select Custom URL...
    await overpassSelect.selectOption("custom");
    await expect(customContainer).toBeVisible();
    await expect(overpassInput).toBeFocused();
  });

  test("Session Persistence retains user settings across page reload", async ({ page }) => {
    await page.goto("/");

    // Set custom PMTiles URL
    await page.locator("#pmtiles-select").selectOption("norcal-260906.pmtiles");
    await expect(page.locator("#pmtiles-url")).toHaveValue("norcal-260906.pmtiles");

    // Wait a brief moment for storage write
    await page.waitForTimeout(300);

    // Reload page
    await page.reload();

    // Verify restored state
    await expect(page.locator('input[name="data-source"][value="pmtiles"]')).toBeChecked();
    await expect(page.locator("#pmtiles-select")).toHaveValue("norcal-260906.pmtiles");
    await expect(page.locator("#pmtiles-url")).toHaveValue("norcal-260906.pmtiles");
  });

  test("URL parameter ?pmtiles= immediately loads specified PMTiles archive", async ({ page }) => {
    const customUrl = "https://example.com/deep-linked.pmtiles";
    await page.goto(`/?pmtiles=${encodeURIComponent(customUrl)}&lat=38.5816&lon=-121.4944&zoom=15`);

    // Verify PMTiles radio is active
    await expect(page.locator('input[name="data-source"][value="pmtiles"]')).toBeChecked();

    // Verify custom URL input has the deep-linked value
    await expect(page.locator("#pmtiles-url")).toHaveValue(customUrl);

    // Verify dropdown reflects Custom URL
    await expect(page.locator("#pmtiles-select")).toHaveValue("custom");
  });
});
