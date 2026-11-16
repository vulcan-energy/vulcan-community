// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Element } from "../../geometry/types";
import { createGeometryStore } from "../../stores/geometryStore";
import { BUILT_IN_FABRIC_PRESETS, fabricPresetForTarget, ownFabricKeys, parseFabricPreset, presetValueFor } from "../fabricPreset";
import { syncGroundExposedPerimetersFromWalls } from "../groundSuspendedFabricSync";

const [partL, caseStudy] = BUILT_IN_FABRIC_PRESETS;

const ground = {
  id: "g", name: "Ground floor", zoneId: "z", floorId: "0", type: "BuildingElementGround",
  width: 5, height: 0, area: 20, total_area: 20, perimeter: 18, thickness_walls: 0.3, floor_type: "Slab_no_edge_insulation", parent_element: null,
  extra_json: {},
  coordinates: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }],
};
const element = (type: string, extra: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  ({ id: "e", name: "E", type, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], extra_json: extra, ...more }) as unknown as Element;

describe("presetValueFor", () => {
  it("gives each preset value the element does not state, as the converter does", () => {
    expect(presetValueFor(element("BuildingElementOpaque", {}, { pitch: 90 }), partL!)).toEqual({ u_value: 0.26 });
    expect(presetValueFor(element("BuildingElementOpaque", {}, { pitch: 40 }), partL!)).toEqual({ u_value: 0.16 });
    expect(presetValueFor(element("BuildingElementOpaque", {}, { pitch: 90, is_external_door: true }), partL!)).toEqual({ u_value: 1.6 });
    // A resistance or a build-up states the wall's fabric.
    expect(presetValueFor(element("BuildingElementOpaque", { thermal_resistance_construction: 2 }, { pitch: 90 }), partL!)).toEqual({});
    expect(presetValueFor(element("BuildingElementOpaque", { vulcan_assembly_v1: {} }, { pitch: 90 }), partL!)).toEqual({});
    // A window stating its g-value takes the U-value only.
    expect(presetValueFor(element("BuildingElementTransparent", { g_value: 0.7 }), partL!)).toEqual({ u_value: 1.6 });
    // A ground U-value is never a preset value: the floor takes the resistance.
    expect(presetValueFor(element("BuildingElementGround", { u_value: 0.2, _ground_u_value_manual: true }), partL!)).toEqual({ thermal_resistance_floor_construction: 4.5 });
    expect(presetValueFor(element("BuildingElementOpaque", {}, { pitch: 90 }), caseStudy!)).toEqual({});
    expect(presetValueFor(element("BuildingElementOpaque", {}, { pitch: 90 }), null)).toEqual({});
  });

  it("counts a calculated ground U-value as the editor's, and a stated one as the user's", () => {
    expect(ownFabricKeys(element("BuildingElementGround", { u_value: 0.17 }), "ground_floor")).toEqual([]);
    expect(ownFabricKeys(element("BuildingElementGround", { u_value: 0.17, _ground_u_value_manual: true }), "ground_floor")).toEqual(["u_value"]);
  });

  it("is for the target's family only, and for no existing building", () => {
    const fhs = { requiredMetadataRows: [], constructionBands: false };
    const epcNew = { requiredMetadataRows: ["IsExistingBuilding"], constructionBands: false };
    const epcExisting = { requiredMetadataRows: ["IsExistingBuilding"], constructionBands: true };
    expect(fabricPresetForTarget(partL!, fhs)).toBe(partL);
    expect(fabricPresetForTarget(partL!, epcNew)).toBeNull();
    expect(fabricPresetForTarget({ ...partL!, family: "epc" }, epcExisting)).toBeNull();
  });
});

describe("a fabric preset on a ground floor", () => {
  it("gives the floor calculation its resistance, and a change of preset works the U-value out again", () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.setState({ elementsById: { g: ground } as never, elementIds: ["g"] });
    const extra = () => (store.getState().elementsById.g!.extra_json ?? {}) as Record<string, unknown>;
    // What the element creator's effect runs after every change, with the preset the target takes.
    const sync = () => act(() => syncGroundExposedPerimetersFromWalls(store.getState().elementsById, store.getState().updateElement, false,
      (g) => presetValueFor(g, store.getState().fabricPreset)));

    sync();
    expect(extra().u_value).toBeUndefined();
    act(() => store.getState().setFabricPreset(partL!));
    sync();
    const partLU = extra().u_value as number;
    expect(partLU).toEqual(expect.any(Number));
    // The resistance stays the preset's, not the element's.
    expect(extra().thermal_resistance_floor_construction).toBeUndefined();

    act(() => store.getState().setFabricPreset(caseStudy!));
    sync();
    expect(extra().u_value).toBeLessThan(partLU);

    // No preset: the calculated U-value goes, and the defaults file's pair applies.
    act(() => store.getState().setFabricPreset(null));
    sync();
    expect(extra().u_value).toBeUndefined();
  });

  it("keeps a U-value the user stated through a change of preset", () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.setState({ elementsById: { g: { ...ground, extra_json: { u_value: 0.3, _ground_u_value_manual: true } } } as never, elementIds: ["g"] });
    act(() => store.getState().setFabricPreset(partL!));
    expect(store.getState().elementsById.g!.extra_json).toMatchObject({ u_value: 0.3 });
  });
});

describe("parseFabricPreset", () => {
  const text = (values: unknown) => JSON.stringify({ name: "Spec", family: "fhs", values });

  it("reads a valid preset", () => {
    expect(parseFabricPreset(text({ wall: { u_value: 0.2 }, window: { u_value: 1.4, g_value: 0.6 } }))?.values.wall).toEqual({ u_value: 0.2 });
  });

  it("rejects values that are not numbers in their range, or not preset values, plainly", () => {
    expect(() => parseFabricPreset(text({ wall: { u_value: "0.2" } }))).toThrow('Fabric preset "Spec": the wall U-value is not a number.');
    expect(() => parseFabricPreset(text({ wall: { u_value: 0 } }))).toThrow("the wall U-value 0 is outside 0 to 10 W/m²K");
    expect(() => parseFabricPreset(text({ window: { g_value: 1.5 } }))).toThrow("the window g-value 1.5 is outside 0 to 1");
    expect(() => parseFabricPreset(text({ ground_floor: { u_value: 0.18 } }))).toThrow("ground_floor takes thermal_resistance_floor_construction, not u_value");
    expect(() => parseFabricPreset(text({ attic: { u_value: 0.2 } }))).toThrow('"attic" is not a construction type');
    expect(() => parseFabricPreset(JSON.stringify({ name: "Spec", family: "sap", values: {} }))).toThrow('family must be "fhs" or "epc"');
    expect(() => parseFabricPreset("{")).toThrow("Not a fabric preset: the text is not JSON.");
  });
});
