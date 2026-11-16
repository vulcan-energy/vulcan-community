// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GeometryWorkspaceResourcePort } from "../../../../geometry-editor-host/src/index";
import { GlobalSettingsModal } from "../../components/GlobalSettingsModal";
import { GeometryEditorServicePortsProvider } from "../../../../geometry-editor-host/src/index";
import { canonicalGeometrySchemaPort } from "../../lib/geometrySchemaPort";
import { targetFieldAvailability } from "../../lib/schemaCache";
import { globalSettingsFieldSection } from "../../lib/globalSettingsValidation";
import {
  createGeometryStore,
  GeometryStoreProvider,
} from "../../stores/geometryStore";

const FHS_FILE = '{"Zone":{},"name":"Community defaults"}';

function createResources(
  overrides: Partial<GeometryWorkspaceResourcePort> = {}
): GeometryWorkspaceResourcePort {
  return {
    availability: "available",
    readText: vi.fn(async () => FHS_FILE),
    readFile: vi.fn(),
    writeText: vi.fn(),
    writeBytes: vi.fn(),
    removeFile: vi.fn(),
    ensureDirectory: vi.fn(),
    exists: vi.fn(async () => true),
    list: vi.fn(async (path) =>
      path === "input/defaults"
        ? [{ name: "defaults_template.json", kind: "file" }]
        : []
    ),
    ...overrides,
  };
}

const generalFlat = (extra: Record<string, unknown>) => ({
  type: "object",
  properties: { build_type: { enum: ["flat", "house"] } },
  if: { properties: { build_type: { const: "flat" } } },
  then: { required: Object.keys(extra), properties: extra },
});

describe("GlobalSettingsModal target rules", () => {
  const a7Root = { properties: { NumberOfSanitaryAccommodations: { type: "integer" }, General: generalFlat({ storey_of_dwelling: { type: "integer" } }) } };
  const a9Root = { properties: { General: generalFlat({ storeys_in_building: { type: "integer" } }) } };

  it("classifies fields as available, absent or unknown", () => {
    expect(targetFieldAvailability(a7Root, ["General", "storey_of_dwelling"])).toBe("available");
    expect(targetFieldAvailability(a9Root, ["General", "storey_of_dwelling"])).toBe("absent");
    expect(targetFieldAvailability(null, ["General", "storey_of_dwelling"])).toBe("unknown");
    expect(targetFieldAvailability({ properties: {} }, ["General", "storey_of_dwelling"])).toBe("unknown");
    expect(targetFieldAvailability({ properties: { General: {}, x: false } }, ["x"])).toBe("absent");
  });

  it.each([
    ["a7", a7Root, true],
    ["a9", a9Root, false],
    ["no schema", null, true],
  ])("shows target-only global fields on %s", async (_name, root, visible) => {
    const store = createGeometryStore();
    store.setState({ complianceSettings: { ...store.getState().complianceSettings, build_type: "flat" } });
    render(
      <GeometryEditorServicePortsProvider
        schemaPort={{ ...canonicalGeometrySchemaPort, getRootSchema: () => root }}
        workspaceResourcePort={createResources()}
      >
        <GeometryStoreProvider store={store}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="Postcode" />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    await screen.findByLabelText("Property postcode");
    expect(screen.queryAllByText(/Storey of dwelling/i).length > 0).toBe(visible);
    expect(screen.queryAllByText(/Number of sanitary accommodations/i).length > 0).toBe(visible);
  });
});

describe("GlobalSettingsModal target-required rows", () => {
  const renderWith = (requiredMetadataRows?: readonly string[]) => {
    const store = createGeometryStore();
    render(
      <GeometryEditorServicePortsProvider
        schemaPort={{ ...canonicalGeometrySchemaPort, ...(requiredMetadataRows ? { targetRules: () => ({ requiredMetadataRows }) } : {}) }}
        workspaceResourcePort={createResources()}
      >
        <GeometryStoreProvider store={store}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="Ventilation_altitude" />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    return store;
  };
  const epcOnly = ["Existing building", "Electricity smart meter", "Has a clothes dryer", "Has a dishwasher", "Has a separate fridge or freezer", "Cross ventilation possible"];

  it("shows no target-only row when the target requires none", async () => {
    renderWith();
    await screen.findByLabelText("Shield Class");
    for (const label of epcOnly) expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(screen.getByText(/Noise nuisance/)).toBeInTheDocument();
  });

  it("asks for each required row as an empty Yes/No choice and saves the pick", async () => {
    const user = userEvent.setup();
    const store = renderWith(["HasElectricitySmartMeter", "IsExistingBuilding", "Appliances_has_dryer", "Appliances_has_dishwasher",
      "Appliances_has_separate_fridge_or_freezer", "Ventilation_cross_vent_possible", "Ventilation_noise_nuisance", "PartGcompliance"]);
    await screen.findByLabelText("Shield Class");
    await user.click(screen.getByText("Dwelling details"));
    for (const label of epcOnly) expect(screen.getByLabelText(label)).toHaveValue("");
    // Required booleans with no default are choices, never an unticked box that reads as "no".
    expect(screen.getByLabelText("Noise nuisance")).toHaveValue("");
    expect(screen.getByLabelText("Part G compliance")).toHaveValue("TRUE");
    await user.selectOptions(screen.getByLabelText("Electricity smart meter"), "No");
    await user.selectOptions(screen.getByLabelText("Cross ventilation possible"), "Yes");
    expect(store.getState().complianceSettings).toMatchObject({ HasElectricitySmartMeter: false, Ventilation_cross_vent_possible: true });
    expect(screen.getAllByText(/Existing building is not set/).length).toBeGreaterThan(0);
  });
});

describe("GlobalSettingsModal existing building", () => {
  it("asks it with the target, before the dwelling details, without opening a section", async () => {
    render(
      <GeometryEditorServicePortsProvider
        schemaPort={{ ...canonicalGeometrySchemaPort, targetRules: () => ({ requiredMetadataRows: ["IsExistingBuilding"] }) }}
        workspaceResourcePort={createResources()}
      >
        <GeometryStoreProvider store={createGeometryStore()}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="IsExistingBuilding"
            calculationTargetSection={<div>HEM model version</div>} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    const existing = await screen.findByLabelText("Existing building");
    const order = (a: Node, b: Node) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(screen.getByText("HEM model version"), existing)).toBeTruthy();
    expect(order(existing, screen.getByText("Dwelling details"))).toBeTruthy();
    // A new build states its build type up front; its EPC input takes no postcode.
    expect(order(screen.getByText("Build type"), screen.getByText("Dwelling details"))).toBeTruthy();
    expect(screen.queryByLabelText("Property postcode")).not.toBeInTheDocument();
  });
});

describe("GlobalSettingsModal border postcode", () => {
  it.each([
    ["CH4 1AA", true, true],
    ["MK40 1AA", true, false],
    ["CH4 1AA", false, false],
  ])("asks the nation for %s under construction bands %s: %s", async (postcode, constructionBands, asked) => {
    const store = createGeometryStore();
    store.getState().setPropertyPostcode(postcode);
    render(
      <GeometryEditorServicePortsProvider
        schemaPort={{ ...canonicalGeometrySchemaPort, targetRules: () => ({ constructionBands }) }}
        workspaceResourcePort={createResources()}
      >
        <GeometryStoreProvider store={store}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="Postcode" />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    await screen.findByLabelText("Property postcode");
    expect(screen.queryByLabelText("Nation") !== null).toBe(asked);
    if (!asked) return;
    expect(screen.getByLabelText("Nation")).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText("Nation"), "Wales");
    expect(store.getState().complianceSettings.hemieSettings).toEqual({ HEMIE_nation: "Wales" });
  });
});

describe("GlobalSettingsModal", () => {
  it("uses one public modal for fabric and every core global-values section", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    const resources = createResources();

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
        />
      </GeometryStoreProvider>
    );

    expect(screen.getByText("Global Settings")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Fabric" })).toHaveAttribute("aria-selected", "true");
    await screen.findAllByText("Standard template");
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.getByText("Dwelling details")).toBeInTheDocument();
    expect(screen.getByText("Air tightness")).toBeInTheDocument();
    expect(screen.getByText("Ventilation environment")).toBeInTheDocument();
    expect(screen.getByText("Thermal bridging")).toBeInTheDocument();

    const dwellingDetails = screen.getByText("Dwelling details");
    await user.click(dwellingDetails);
    expect(screen.getByLabelText("Property postcode")).toBeInTheDocument();
    await user.click(dwellingDetails);
    expect(screen.queryByLabelText("Property postcode")).not.toBeInTheDocument();

    const airTightness = screen.getByText("Air tightness");
    await user.click(airTightness);
    expect(screen.getByLabelText("Test Pressure")).toBeInTheDocument();
    await user.click(airTightness);
    expect(screen.queryByLabelText("Test Pressure")).not.toBeInTheDocument();

    const ventilation = screen.getByText("Ventilation environment");
    await user.click(ventilation);
    expect(screen.getByLabelText("Shield Class")).toBeInTheDocument();
    await user.click(ventilation);
    expect(screen.queryByLabelText("Shield Class")).not.toBeInTheDocument();

    await user.click(dwellingDetails);
    const postcode = screen.getByLabelText("Property postcode");
    await user.type(postcode, "mk40 1aa");
    expect(store.getState().propertyPostcode).toBe("MK40 1AA");
  });

  it("offers no fallback thermal-bridging heat loss, which no target applies", async () => {
    const user = userEvent.setup();
    render(
      <GeometryStoreProvider store={createGeometryStore()}>
        <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} />
      </GeometryStoreProvider>
    );

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    await user.click(screen.getByText("Thermal bridging"));
    expect(screen.queryByText(/Fallback heat loss/)).not.toBeInTheDocument();
  });

  it("saves the table as a fabric preset through the injected workspace, fabric only", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    const writeText = vi.fn(async () => undefined);
    const resources = createResources({ exists: vi.fn(async () => false), writeText });
    vi.spyOn(window, "prompt").mockReturnValue("Our spec");

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={resources} />
      </GeometryStoreProvider>
    );

    await screen.findAllByText("Standard template");
    await user.click(screen.getByRole("button", { name: "Save as a copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const [path, text] = writeText.mock.calls[0] as unknown as [string, string];
    expect(path).toBe("input/fabric_presets/our_spec.json");
    expect(JSON.parse(text)).toMatchObject({ name: "Our spec", family: "fhs" });
    // The model's defaults file stays as it was.
    expect(store.getState().defaultsPath).toBe("input/defaults/defaults_template.json");
    expect(store.getState().fabricPreset?.name).toBe("Our spec");
  });

  it("opens at a focused field: its tab and section open and its control takes focus", async () => {
    const store = createGeometryStore();
    const { rerender } = render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen focusFieldKey="Ventilation_shield_class" onClose={vi.fn()} workspaceResourcePort={createResources()} />
      </GeometryStoreProvider>
    );
    await waitFor(() => expect(screen.getByLabelText("Shield Class")).toHaveFocus());
    expect(screen.queryByLabelText("Property postcode")).not.toBeInTheDocument();

    rerender(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen focusFieldKey="Postcode" onClose={vi.fn()} workspaceResourcePort={createResources()} />
      </GeometryStoreProvider>
    );
    await waitFor(() => expect(screen.getByLabelText("Property postcode")).toHaveFocus());
  });

  it("focuses the field again when its tab and section are already open", async () => {
    const store = createGeometryStore();
    const resources = createResources();
    const modal = (focusFieldKey?: string) => (
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen focusFieldKey={focusFieldKey} onClose={vi.fn()} workspaceResourcePort={resources} />
      </GeometryStoreProvider>
    );
    const { rerender } = render(modal("Ventilation_shield_class"));
    await waitFor(() => expect(screen.getByLabelText("Shield Class")).toHaveFocus());
    screen.getByLabelText("Shield Class").blur();
    rerender(modal());
    rerender(modal("Ventilation_shield_class"));
    await waitFor(() => expect(screen.getByLabelText("Shield Class")).toHaveFocus());
  });

  it("is a labelled modal dialog that Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <GeometryStoreProvider store={createGeometryStore()}>
        <GlobalSettingsModal isOpen onClose={onClose} workspaceResourcePort={createResources()} />
      </GeometryStoreProvider>
    );

    const dialog = screen.getByRole("dialog", { name: "Global Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names a content-hash defaults file as this model's defaults, in the defaults list of a host that pins no target", async () => {
    const hash = "0123456789abcdef".repeat(4);
    const hashPath = `input/defaults/${hash}.json`;
    const writeText = vi.fn(async () => undefined);
    const resources = createResources({
      exists: vi.fn(async (path) => !path.endsWith("/copy.json")),
      writeText,
      list: vi.fn(async (path) =>
        path === "input/defaults"
          ? [
              { name: `${hash}.json`, kind: "file" as const },
              { name: "defaults_template.json", kind: "file" as const },
            ]
          : []
      ),
    });
    const store = createGeometryStore();
    store.getState().setDefaultsPath(hashPath);

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={resources} />
      </GeometryStoreProvider>
    );

    const labels = await screen.findAllByText(/This model's defaults/);
    for (const label of labels) expect(label).toHaveTextContent(/^This model's defaults$/);
    expect(screen.queryByText(new RegExp(hash.slice(0, 8)))).not.toBeInTheDocument();
    expect(await screen.findByText("Standard template")).toBeInTheDocument();

    expect(screen.getByText("Defaults file")).toBeInTheDocument();
  });

  it("keeps global values usable when the Community host has no implicit defaults file", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const onIndicatorChange = vi.fn();
    const resources = createResources({
      exists: vi.fn(async () => false),
      list: vi.fn(async () => []),
    });

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
          onIndicatorChange={onIndicatorChange}
        />
      </GeometryStoreProvider>
    );

    await waitFor(() => {
      const indicator =
        onIndicatorChange.mock.calls[onIndicatorChange.mock.calls.length - 1]?.[0];
      expect(indicator?.variant).toBe("error");
      expect(indicator?.issues[0]).toBe("No defaults file is selected.");
    });
    expect(
      screen.getByText("No JSON files found under input/defaults/")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.getByText("Dwelling details")).toBeInTheDocument();
  });

  it("combines defaults errors with required global-value issues in the filename indicator", async () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const onIndicatorChange = vi.fn();
    const resources = createResources({
      exists: vi.fn(async () => false),
      list: vi.fn(async () => []),
    });

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
          onIndicatorChange={onIndicatorChange}
        />
      </GeometryStoreProvider>
    );

    await waitFor(() => {
      const indicator =
        onIndicatorChange.mock.calls[onIndicatorChange.mock.calls.length - 1]?.[0];
      expect(indicator?.variant).toBe("error");
      expect(indicator?.issues[0]).toBe("No defaults file is selected.");
      expect(indicator?.issues).toContain(
        "Global Settings: Number of hot-tapped rooms is not set. Enter it in Global Settings."
      );
    });
  });

  it("keeps disconnected workspace resources idle and gives host-neutral guidance", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const list = vi.fn(async () => []);
    const exists = vi.fn(async () => false);
    const resources = createResources({
      availability: "unavailable",
      list,
      exists,
    });

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
        />
      </GeometryStoreProvider>
    );

    expect(
      screen.getByText(/Use Files to choose or reconnect a workspace folder/i)
    ).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.getByText("Dwelling details")).toBeInTheDocument();
  });
});

describe("GlobalSettingsModal Fabric tab", () => {
  const EPC_FILE = '{"Zone":{},"IsExistingBuilding":false}';
  const PART_L = '{"Zone":{"zone 1":{}}}';
  const files: Record<string, string> = {
    "input/defaults/defaults_template.json": FHS_FILE,
    "input/defaults/defaults_template_epc.json": EPC_FILE,
    "input/defaults/defaults_partyL2021.json": PART_L,
    "input/defaults/overheating_engineered_empty.json": "{}",
    "input/defaults/our_spec.json": FHS_FILE,
  };
  const resources = () => createResources({
    readText: vi.fn(async (path: string) => files[path] ?? FHS_FILE),
    list: vi.fn(async (path) => (path === "input/defaults"
      ? Object.keys(files).map((file) => ({ name: file.split("/").pop()!, kind: "file" as const }))
      : [])),
  });
  // A host that pins each target to its own defaults, as the Vulcan app does.
  const pinnedStore = () => {
    const store = createGeometryStore({
      defaultsPathForTarget: (id) => (id === "epc" ? "input/defaults/defaults_template_epc.json" : "input/defaults/defaults_template.json"),
    });
    store.getState().setTargetBundleId("fhs");
    return store;
  };
  const view = (store: ReturnType<typeof createGeometryStore>, rules: Record<string, unknown>, props: Record<string, unknown> = {}) => {
    const port = { ...canonicalGeometrySchemaPort, targetRules: () => rules };
    const ui = (nextRules = rules) => (
      <GeometryEditorServicePortsProvider schemaPort={{ ...port, targetRules: () => nextRules }} workspaceResourcePort={createResources()}>
        <GeometryStoreProvider store={store}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={resources()} fabricSection={<div>Bands table</div>} {...props} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    const result = render(ui());
    return { ...result, rerenderWith: (nextRules: Record<string, unknown>) => result.rerender(ui(nextRules)) };
  };

  it("offers fabric presets on a pinned target, never a defaults file of its own", async () => {
    const user = userEvent.setup();
    const store = pinnedStore();
    view(store, {});
    const sources = await screen.findByRole("group", { name: "Fabric values from" });
    await waitFor(() => expect(sources).toHaveTextContent("Standard templatebuilt-inPart L 2021built-inHEM case studybuilt-in"));
    expect(screen.queryByText("Defaults file")).not.toBeInTheDocument();
    expect(screen.queryByText(/does not run/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    expect(store.getState().fabricPreset?.name).toBe("Part L 2021");
    expect(store.getState().defaultsPath).toBe("input/defaults/defaults_template.json");
  });

  it("names a model's file for another target plainly, with the way back to the target's own", async () => {
    const user = userEvent.setup();
    const store = pinnedStore();
    store.getState().setDefaultsPath("input/defaults/defaults_template_epc.json");
    view(store, {});
    expect(await screen.findByRole("alert")).toHaveTextContent('The defaults file "EPC template" is for another target, so the model does not run.');
    await user.click(screen.getByRole("button", { name: "Use the Standard template" }));
    expect(store.getState().defaultsPath).toBe("input/defaults/defaults_template.json");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows an existing building's bands in Fabric, not Global values, with no file list", async () => {
    const user = userEvent.setup();
    const store = pinnedStore();
    store.getState().setTargetBundleId("epc");
    view(store, { constructionBands: true, requiredMetadataRows: ["IsExistingBuilding"] });
    expect(screen.getByText("Bands table")).toBeInTheDocument();
    expect(screen.queryByText("Fabric values from")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.queryByText("Bands table")).not.toBeInTheDocument();
  });

  it.each([
    ["a file for another target", "input/defaults/defaults_template.json", 'The defaults file "Standard template" is for another target'],
    ["a missing file", "input/defaults/gone.json", 'The defaults file "Gone" is missing.'],
  ])("offers the EPC template to an existing building with %s", async (_name, path, message) => {
    const user = userEvent.setup();
    const store = pinnedStore();
    store.getState().setTargetBundleId("epc");
    store.getState().setDefaultsPath(path);
    files["input/defaults/gone.json"] = undefined as never;
    const r = resources();
    r.exists = vi.fn(async (p: string) => p !== "input/defaults/gone.json");
    view(store, { constructionBands: true, requiredMetadataRows: ["IsExistingBuilding"] }, { workspaceResourcePort: r });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    await user.click(screen.getByRole("button", { name: "Use the EPC template" }));
    expect(store.getState().defaultsPath).toBe("input/defaults/defaults_template_epc.json");
  });

  it("follows a target switch with the modal open: EPC new build lists EPC files, existing shows its bands", async () => {
    const store = pinnedStore();
    const { rerenderWith } = view(store, {});
    expect(await screen.findByRole("button", { name: /Standard template/ })).toBeInTheDocument();
    act(() => store.getState().setTargetBundleId("epc"));
    rerenderWith({ requiredMetadataRows: ["IsExistingBuilding"] });
    // Standard defaults follow the target; HEM:EPC new build has no built-in preset.
    expect(await screen.findByRole("button", { name: /EPC template/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Part L 2021/ })).not.toBeInTheDocument();
    rerenderWith({ constructionBands: true, requiredMetadataRows: ["IsExistingBuilding"] });
    expect(screen.getByText("Bands table")).toBeInTheDocument();
    rerenderWith({ requiredMetadataRows: ["IsExistingBuilding"] });
    expect(screen.queryByText("Bands table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /EPC template/ })).toBeInTheDocument();
  });

  it.each(["HEMIE_age_band", "HEMIE_construction_external_wall", "DefaultAssemblyWall"])("opens the Fabric tab for %s", async (key) => {
    const store = pinnedStore();
    const modal = (focusFieldKey: string) => (
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen focusFieldKey={focusFieldKey} onClose={vi.fn()} workspaceResourcePort={resources()} />
      </GeometryStoreProvider>
    );
    const { rerender } = render(modal("Ventilation_shield_class"));
    expect(screen.getByRole("tab", { name: /Global values/i })).toHaveAttribute("aria-selected", "true");
    rerender(modal(key));
    expect(screen.getByRole("tab", { name: "Fabric" })).toHaveAttribute("aria-selected", "true");
    expect(globalSettingsFieldSection(key)).toBe("fabric");
  });

});
