/**
 * @module ui-helpers
 * @description UI control helpers for managing preconfigured selection dropdowns,
 * custom URL inputs, and container visibility across PMTiles and Overpass data sources.
 */

/**
 * Populates an HTML `<select>` element with a list of preconfigured items plus a "Custom URL..." option.
 *
 * @param {HTMLSelectElement} selectEl - The select dropdown element to populate.
 * @param {Array<{ name: string, url: string }>} items - List of preset items.
 * @param {string} [currentUrl] - Currently active URL to pre-select.
 * @param {string} [customLabel="Custom URL..."] - Label for the custom input option.
 * @returns {{ selectedValue: string, isCustom: boolean }} The selected value and custom status.
 */
export function populateDropdown(selectEl, items = [], currentUrl = "", customLabel = "Custom URL...") {
  if (!selectEl) return { selectedValue: "", isCustom: false };

  selectEl.innerHTML = "";

  const presets = Array.isArray(items) ? items : [];
  for (const item of presets) {
    const opt = document.createElement("option");
    opt.value = item.url;
    opt.textContent = item.name;
    selectEl.appendChild(opt);
  }

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = customLabel;
  selectEl.appendChild(customOpt);

  const trimmedUrl = (currentUrl || "").trim();
  const matched = presets.find((p) => p.url === trimmedUrl);

  if (matched) {
    selectEl.value = matched.url;
  } else if (trimmedUrl && trimmedUrl !== "custom") {
    selectEl.value = "custom";
  } else if (presets.length > 0) {
    selectEl.value = presets[0].url;
  } else {
    selectEl.value = "custom";
  }

  return {
    selectedValue: selectEl.value,
    isCustom: selectEl.value === "custom"
  };
}

/**
 * Synchronizes the visibility of a custom input container based on whether "custom" is selected in the dropdown.
 * Updates the input element value when a preset option is chosen.
 *
 * @param {HTMLSelectElement} selectEl - The select dropdown element.
 * @param {HTMLInputElement} inputEl - The custom URL text/url input element.
 * @param {HTMLElement} containerEl - The container wrapping the custom input.
 * @returns {boolean} True if custom input mode is active.
 */
export function syncCustomInputVisibility(selectEl, inputEl, containerEl) {
  if (!selectEl || !containerEl) return false;

  const isCustom = selectEl.value === "custom";

  if (isCustom) {
    containerEl.style.display = "flex";
    if (inputEl && typeof inputEl.focus === "function") {
      inputEl.focus();
    }
  } else {
    containerEl.style.display = "none";
    if (inputEl) {
      inputEl.value = selectEl.value;
    }
  }

  return isCustom;
}

/**
 * Synchronizes the dropdown selection when the user types in the custom input field.
 * If the entered URL matches a preconfigured preset, the dropdown switches to that preset;
 * otherwise, it sets the dropdown to "custom".
 *
 * @param {HTMLInputElement} inputEl - The custom URL text/url input element.
 * @param {HTMLSelectElement} selectEl - The select dropdown element.
 * @param {Array<{ name: string, url: string }>} items - List of preset items.
 * @returns {string} The active dropdown value.
 */
export function syncDropdownWithCustomInput(inputEl, selectEl, items = []) {
  if (!inputEl || !selectEl) return "";

  const val = (inputEl.value || "").trim();
  const presets = Array.isArray(items) ? items : [];
  const match = presets.find((p) => p.url === val);

  if (match) {
    selectEl.value = match.url;
  } else {
    selectEl.value = "custom";
  }

  return selectEl.value;
}
