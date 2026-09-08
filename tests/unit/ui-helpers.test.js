// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  populateDropdown,
  syncCustomInputVisibility,
  syncDropdownWithCustomInput
} from "../../ui-helpers.js";

describe("ui-helpers.js Unit Tests", () => {
  const sampleAreas = [
    { name: "Sacramento Core", url: "sac_core.pmtiles" },
    { name: "Northern California", url: "norcal-260906.pmtiles" }
  ];

  let selectEl;
  let inputEl;
  let containerEl;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="container" style="display: none;">
        <input type="text" id="input" value="" />
      </div>
      <select id="select"></select>
    `;
    selectEl = document.getElementById("select");
    inputEl = document.getElementById("input");
    containerEl = document.getElementById("container");
  });

  describe("populateDropdown", () => {
    it("populates select element with options and a Custom URL entry", () => {
      const result = populateDropdown(selectEl, sampleAreas, "sac_core.pmtiles");
      expect(selectEl.options.length).toBe(3); // 2 presets + 1 custom
      expect(selectEl.options[0].value).toBe("sac_core.pmtiles");
      expect(selectEl.options[0].textContent).toBe("Sacramento Core");
      expect(selectEl.options[1].value).toBe("norcal-260906.pmtiles");
      expect(selectEl.options[2].value).toBe("custom");
      expect(selectEl.value).toBe("sac_core.pmtiles");
      expect(result.selectedValue).toBe("sac_core.pmtiles");
      expect(result.isCustom).toBe(false);
    });

    it("selects Custom option when current URL is not in presets", () => {
      const result = populateDropdown(selectEl, sampleAreas, "https://example.com/custom.pmtiles");
      expect(selectEl.value).toBe("custom");
      expect(result.isCustom).toBe(true);
    });

    it("defaults to first preset when no URL is provided", () => {
      const result = populateDropdown(selectEl, sampleAreas, "");
      expect(selectEl.value).toBe("sac_core.pmtiles");
      expect(result.isCustom).toBe(false);
    });

    it("gracefully handles null selectEl", () => {
      const result = populateDropdown(null, sampleAreas);
      expect(result).toEqual({ selectedValue: "", isCustom: false });
    });
  });

  describe("syncCustomInputVisibility", () => {
    it("hides container and copies preset value to input when preset is selected", () => {
      populateDropdown(selectEl, sampleAreas, "sac_core.pmtiles");
      selectEl.value = "norcal-260906.pmtiles";

      const isCustom = syncCustomInputVisibility(selectEl, inputEl, containerEl);
      expect(isCustom).toBe(false);
      expect(containerEl.style.display).toBe("none");
      expect(inputEl.value).toBe("norcal-260906.pmtiles");
    });

    it("displays container and leaves input value intact when custom is selected", () => {
      populateDropdown(selectEl, sampleAreas, "sac_core.pmtiles");
      selectEl.value = "custom";
      inputEl.value = "https://custom.url/file.pmtiles";

      const isCustom = syncCustomInputVisibility(selectEl, inputEl, containerEl);
      expect(isCustom).toBe(true);
      expect(containerEl.style.display).toBe("flex");
      expect(inputEl.value).toBe("https://custom.url/file.pmtiles");
    });
  });

  describe("syncDropdownWithCustomInput", () => {
    it("switches dropdown to preset value when input matches a known preset URL", () => {
      populateDropdown(selectEl, sampleAreas, "custom");
      selectEl.value = "custom";
      inputEl.value = "sac_core.pmtiles";

      const val = syncDropdownWithCustomInput(inputEl, selectEl, sampleAreas);
      expect(val).toBe("sac_core.pmtiles");
      expect(selectEl.value).toBe("sac_core.pmtiles");
    });

    it("switches dropdown to custom when input does not match any preset URL", () => {
      populateDropdown(selectEl, sampleAreas, "sac_core.pmtiles");
      inputEl.value = "https://other.domain/test.pmtiles";

      const val = syncDropdownWithCustomInput(inputEl, selectEl, sampleAreas);
      expect(val).toBe("custom");
      expect(selectEl.value).toBe("custom");
    });
  });
});
