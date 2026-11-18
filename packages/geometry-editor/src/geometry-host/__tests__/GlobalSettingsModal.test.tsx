// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor, within } from "@testing-library/react";
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

import epcSchema from "../../../../../data/schemas/hem_epc_orchestrator_input.schema.json";

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

  it.each([
    ["an FHS target", undefined, "Suburban (default)"],
    ["an EPC target", ["Ventilation_terrain_class"], "Select terrain class..."],
  ])("shows an unset terrain class on %s as %s", async (_name, rows, placeholder) => {
    renderWith(rows);
    const terrain = await screen.findByLabelText("Terrain Class");
    expect(terrain).toHaveValue("");
    expect((terrain as HTMLSelectElement).selectedOptions[0]).toHaveTextContent(placeholder);
    if (rows) expect(terrain.textContent).not.toContain("(default)");
  });

  it("shows the Context Shading join row only while it is on or the converter asks for it", async () => {
    const store = renderWith();
    await screen.findByLabelText("Shield Class");
    const row = () => screen.queryByLabelText("Join shading parts to fit HEM's segment limit");
    expect(row()).not.toBeInTheDocument();
    act(() => store.getState().setComplianceSettings({ ContextShadingJoinParts: true }));
    expect(row()).toBeChecked();
    await userEvent.click(row()!);
    expect(store.getState().complianceSettings.ContextShadingJoinParts).toBe(false);
    await waitFor(() => expect(row()).not.toBeInTheDocument());
    act(() => store.setState({ targetValidation: { items: [{ message: "Set ContextShadingJoinParts to TRUE to join parts." }] } as never }));
    expect(row()).not.toBeChecked();
  });

});

const EPC_ROWS = ["IsExistingBuilding", "PartGcompliance", "HasElectricitySmartMeter", "HeatingControlType", "ColdWaterSource",
  "Ventilation_cross_vent_possible", "Ventilation_altitude", "Ventilation_terrain_class",
  "Appliances_has_dryer", "Appliances_has_dishwasher", "Appliances_has_separate_fridge_or_freezer"];
/** An HEM:EPC model: the existing-building pathway takes construction bands and no air test. */
let epcIssues: string[] = [];
/** The issues Global Settings reports for the model (its tab and the Global Settings button show them). */
const issues = (pattern: RegExp) => epcIssues.filter((issue) => pattern.test(issue));
function renderEpc(store: ReturnType<typeof createGeometryStore>, focusFieldKey?: string, extra: Record<string, unknown> = {}, postcodeNeeded?: boolean) {
  epcIssues = [];
  return render(
    <GeometryEditorServicePortsProvider
      schemaPort={{ ...canonicalGeometrySchemaPort, getRootSchema: () => epcSchema, targetRules: (settings: Readonly<Record<string, unknown>>) => {
        const existing = settings.IsExistingBuilding === true;
        return {
        requiredMetadataRows: existing ? EPC_ROWS : [...EPC_ROWS, "Ventilation_shield_class", "AirPermeability_test_pressure", "AirPermeability_test_result"],
        constructionBands: existing,
        derivedMetadataRows: ["General_build_type", ...(existing ? ["Ventilation_shield_class"] : [])],
        desnzDefaultRows: { Ventilation_noise_nuisance: "No" },
        ...extra,
      }; } }}
      workspaceResourcePort={createResources()}
    >
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey={focusFieldKey}
          calculationTargetSection={<div>HEM model version</div>} onIndicatorChange={(indicator) => { epcIssues = indicator?.issues ?? []; }}
          postcodeNeeded={postcodeNeeded} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>
  );
}
const pressed = (group: string) => within(screen.getByRole("group", { name: group })).queryAllByRole("button", { pressed: true }).map((b) => b.textContent);

describe("GlobalSettingsModal HEM:EPC Global values", () => {
  it("asks the pathway first, as a full-width switch under the target, then the survey groups in order", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    renderEpc(store, "IsExistingBuilding");
    const pathway = await screen.findByRole("group", { name: "The dwelling is" });
    const order = (a: Node, b: Node) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(screen.getByText("HEM model version"), pathway)).toBeTruthy();
    const groups = ["Property", "Rooms and services", "Air test", "Site"].map((name) => screen.getByRole("heading", { name }));
    groups.reduce((before, group) => (expect(order(before, group)).toBeTruthy(), group), pathway as Node);
    expect(pressed("The dwelling is")).toEqual([]);
    expect(issues(/Existing building is not set/)).toHaveLength(1);
    await waitFor(() => expect(within(pathway).getByRole("button", { name: "An existing building" })).toHaveFocus());
    // No FHS copy on an EPC model, and no accordions.
    expect(screen.queryByText("Dwelling details")).not.toBeInTheDocument();
    expect(screen.queryByText(/defaults template/)).not.toBeInTheDocument();
    await user.click(within(pathway).getByRole("button", { name: "A new build" }));
    expect(store.getState().complianceSettings.IsExistingBuilding).toBe(false);
    // A new build's EPC input takes no postcode: it is asked only when the host needs it (below).
    expect(screen.queryByLabelText("Postcode")).not.toBeInTheDocument();
    await user.click(within(pathway).getByRole("button", { name: "An existing building" }));
    expect(store.getState().complianceSettings.IsExistingBuilding).toBe(true);
    expect(await screen.findByLabelText("Postcode")).toBeInTheDocument();
  });

  it("asks each required Yes/No as two segments, none chosen until picked; the noise nuisance input HEM:EPC is removing is not asked", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    renderEpc(store, "HasElectricitySmartMeter");
    await screen.findByRole("group", { name: "Smart electricity meter" });
    for (const group of ["Smart electricity meter", "Clothes dryer", "Dishwasher", "Separate fridge or freezer", "Cross ventilation"]) {
      expect(pressed(group)).toEqual([]);
    }
    expect(screen.queryByRole("group", { name: "Noise nuisance" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Cross ventilation" })).getByRole("button", { name: "Yes" }));
    expect(store.getState().complianceSettings).toMatchObject({ Ventilation_cross_vent_possible: true });
  });

  it("opens More while it holds an unanswered required field, and keeps it open once answered", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    renderEpc(store, "Ventilation_cross_vent_possible");
    const crossVent = await screen.findByRole("group", { name: "Cross ventilation" });
    const more = crossVent.closest("details")!;
    expect(more).toHaveAttribute("open");
    await user.click(within(crossVent).getByRole("button", { name: "No" }));
    expect(store.getState().complianceSettings.Ventilation_cross_vent_possible).toBe(false);
    // The answer does not fold the box away under the pointer.
    expect(more).toHaveAttribute("open");
  });

  it("asks for the GUID once the dwelling has a smart meter, and checks its format", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    renderEpc(store, "HasElectricitySmartMeter");
    await screen.findByRole("group", { name: "Smart electricity meter" });
    expect(screen.queryByLabelText("Smart meter GUID")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Smart electricity meter" })).getByRole("button", { name: "Yes" }));
    expect(issues(/Smart meter GUID is not set/)).toHaveLength(1);
    await user.type(screen.getByLabelText("Smart meter GUID"), "01-23-45");
    expect(screen.getAllByText(/must be 16 hexadecimal characters/).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("Smart meter GUID"), "-67-89-ab-cd-ef");
    expect(screen.queryByText(/must be 16 hexadecimal characters/)).not.toBeInTheDocument();
    expect(store.getState().complianceSettings.ElectricitySmartMeterGUID).toBe("01-23-45-67-89-ab-cd-ef");
  });

  it("offers Not tested on an existing building only; picking it clears the test in one step", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    // A double-glazed window: the converter then asks when the double glazing went in.
    store.getState().setComplianceSettings({ IsExistingBuilding: true, hemieSettings: { HEMIE_construction_window: '{"glazing_type":"double"}' } });
    store.getState().addElement({ name: "W", type: "BuildingElementTransparent", zoneId: "z", coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } as never);
    renderEpc(store, "AirPermeability_test_result");
    expect(await screen.findByText(/estimates the air leakage/)).toBeInTheDocument();
    expect(pressed("Air test")).toEqual(["Not tested"]);
    await user.type(screen.getByLabelText("Open fireplaces"), "2");
    await user.selectOptions(screen.getByLabelText("Double glazing installed"), "double_glazing_unknown_install_date");
    expect(store.getState().complianceSettings.hemieSettings).toMatchObject({
      HEMIE_number_of_open_fireplaces: "2",
      HEMIE_double_glazing_installation_period: "double_glazing_unknown_install_date",
    });
    // With no double-glazed window the date is not asked.
    act(() => store.getState().setComplianceSettings({ hemieSettings: { HEMIE_construction_window: '{"glazing_type":"single"}' } }));
    expect(screen.queryByLabelText("Double glazing installed")).not.toBeInTheDocument();
    // A flat also states its heat loss corridor; a house does not.
    expect(screen.queryByLabelText("Heat loss corridor")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Air test" })).getByRole("button", { name: "Blower door (50 Pa)" }));
    await user.type(screen.getByLabelText("Test result"), "5");
    // A measured result needs no estimate.
    expect(screen.queryByLabelText("Open fireplaces")).not.toBeInTheDocument();
    expect(store.getState().complianceSettings).toMatchObject({ AirPermeability_test_pressure: "Standard", AirPermeability_test_result: 5 });
    await user.click(within(screen.getByRole("group", { name: "Air test" })).getByRole("button", { name: "Not tested" }));
    expect(store.getState().complianceSettings.AirPermeability_test_pressure).toBeUndefined();
    expect(store.getState().complianceSettings.AirPermeability_test_result).toBeUndefined();
    // Picking a test again starts blank.
    await user.click(within(screen.getByRole("group", { name: "Air test" })).getByRole("button", { name: "Pulse (4 Pa)" }));
    expect(screen.getByLabelText("Test result")).toHaveValue("");
    // A new build must state its test.
    act(() => store.getState().setComplianceSettings({ IsExistingBuilding: false, AirPermeability_test_pressure: undefined }));
    expect(within(screen.getByRole("group", { name: "Air test" })).queryByRole("button", { name: "Not tested" })).not.toBeInTheDocument();
    expect(pressed("Air test")).toEqual([]);
  });

  it("lands at the postcode once, and leaves the user where they click after that", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    renderEpc(store, "Postcode");
    await waitFor(() => expect(screen.getByLabelText("Postcode")).toHaveFocus());
    const newBuild = within(screen.getByRole("group", { name: "The dwelling is" })).getByRole("button", { name: "A new build" });
    await user.click(newBuild);
    // The postcode is gone on a new build: the request is done, nothing scrolls or takes focus.
    expect(newBuild).toHaveFocus();
  });

  it("asks the leakage estimate whenever an existing building states no test result, and shows a stated result", async () => {
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true, AirPermeability_test_pressure: "Standard" });
    renderEpc(store, "AirPermeability_test_pressure");
    expect(await screen.findByLabelText("Open fireplaces")).toBeInTheDocument();
    expect(screen.getByLabelText("Test result")).toHaveValue("");
    act(() => store.getState().setComplianceSettings({ AirPermeability_test_pressure: undefined, AirPermeability_test_result: 4 }));
    expect(pressed("Air test")).toEqual([]);
    expect(screen.getByLabelText("Test result")).toHaveValue("4");
    expect(screen.queryByLabelText("Open fireplaces")).not.toBeInTheDocument();
  });

  it("takes each appliance from the drawing while unset, and asks when nothing is drawn", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    store.setState({
      elementsById: { a: { id: "a", name: "Dishwasher", type: "Appliance", appliancekey: "Dishwasher" },
        b: { id: "b", name: "Dishwasher 2", type: "Appliance", appliancekey: "Dishwasher" } } as never,
      elementIds: ["a", "b"],
    });
    renderEpc(store, "Appliances_has_dishwasher");
    const dishwasher = await screen.findByRole("group", { name: "Dishwasher" });
    expect(pressed("Dishwasher")).toEqual(["Yes"]);
    expect(within(dishwasher.parentElement!).getByText("from the drawing")).toBeInTheDocument();
    expect(issues(/dishwasher is not set/i)).toEqual([]);
    // Nothing drawn: no placeholder, and the row is required.
    expect(pressed("Clothes dryer")).toEqual([]);
    expect(issues(/clothes dryer is not set/i)).toHaveLength(1);
    await user.click(within(dishwasher).getByRole("button", { name: "No" }));
    expect(store.getState().complianceSettings.Appliances_has_dishwasher).toBe(false);
    await user.click(screen.getByRole("button", { name: /Dishwasher: use the drawing, Yes/ }));
    expect(store.getState().complianceSettings.Appliances_has_dishwasher).toBeUndefined();
  });

  it("asks no storey count on an existing building, and shows the built form the party walls give", async () => {
    const store = createGeometryStore();
    // A stated count from an older file: the existing-building conversion never reads it.
    store.getState().setComplianceSettings({ IsExistingBuilding: true, storeys_in_dwelling: 3 });
    store.getState().setTargetValidation({ hemVersion: "x", items: [], builtForm: "semi_detached" });
    renderEpc(store, "General_build_type");
    await screen.findByLabelText("Built form");
    expect(screen.queryByText("Storeys in dwelling")).not.toBeInTheDocument();
    // The built form the party walls give is the placeholder, with its source.
    expect((screen.getByLabelText("Built form") as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("Semi detached");
    expect(screen.getByText("from the party walls")).toBeInTheDocument();
  });

  it("shows room counts from the space labels as placeholders, with the source only when there are labels", async () => {
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    renderEpc(store, "NumberOfBedrooms");
    await screen.findByRole("heading", { name: "Rooms and services" });
    expect(screen.queryByText(/from the space labels/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show on the plan" })).not.toBeInTheDocument();
  });
});

describe("GlobalSettingsModal existing building storeys", () => {
  it("keeps the count editable on a target that reads it, whatever the existing-building flag", async () => {
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true, storeys_in_dwelling: 3 });
    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={createResources()}>
        <GeometryStoreProvider store={store}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="General_storeys_in_dwelling" />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    expect(await screen.findByDisplayValue("3")).toBeInTheDocument();
  });
});

describe("GlobalSettingsModal ventilation zone height", () => {
  const renderWith = (derivedMetadataRows: readonly string[], ventilationZoneHeight?: number) => {
    const store = createGeometryStore();
    if (ventilationZoneHeight !== undefined) store.getState().setTargetValidation({ hemVersion: "x", items: [], ventilationZoneHeight });
    render(
      <GeometryEditorServicePortsProvider
        schemaPort={{ ...canonicalGeometrySchemaPort, targetRules: () => ({ derivedMetadataRows }) }}
        workspaceResourcePort={createResources()}
      >
        <GeometryStoreProvider store={store}>
          <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="AirPermeability_ventilation_zone_height" />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    return store;
  };

  it("shows the converter's height where the target derives it, and no sum of floor heights", async () => {
    renderWith(["AirPermeability_ventilation_zone_height"], 5.35);
    const field = await screen.findByLabelText(/Ventilation Zone Height/);
    expect(field).toHaveDisplayValue("5.35");
    expect(screen.getByText("From the drawing")).toBeInTheDocument();
    expect(screen.queryByText(/sum of floor heights/)).not.toBeInTheDocument();
  });

  it("says the height comes once the model converts, with no number before then", async () => {
    renderWith(["AirPermeability_ventilation_zone_height"]);
    const field = await screen.findByLabelText(/Ventilation Zone Height/);
    expect(field).toHaveDisplayValue("");
    expect(screen.getByText("From the drawing, once the model converts")).toBeInTheDocument();
  });

  it("shows the converter's height in an EPC model's Site group, and saves only a typed height", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    store.getState().setTargetValidation({ hemVersion: "x", items: [], ventilationZoneHeight: 5.35 });
    renderEpc(store, "AirPermeability_ventilation_zone_height", { derivedMetadataRows: ["General_build_type", "Ventilation_shield_class", "AirPermeability_ventilation_zone_height"] });
    const field = await screen.findByRole("textbox", { name: /^Zone height/ });
    expect(field).toHaveDisplayValue("5.35");
    expect(store.getState().complianceSettings.AirPermeability_ventilation_zone_height).toBeUndefined();
    await user.clear(field);
    await user.type(field, "6");
    expect(store.getState().complianceSettings.AirPermeability_ventilation_zone_height).toBe(6);
    // The next check reports no converter height for a stated row: the typed value stands alone.
    act(() => store.getState().setTargetValidation({ hemVersion: "x", items: [] }));
    expect(field).toHaveDisplayValue("6");
    expect(screen.queryByText("From the drawing, once the model converts")).not.toBeInTheDocument();
  });
});

describe("GlobalSettingsModal border postcode", () => {
  it.each([
    ["CH4 1AA", true],
    ["MK40 1AA", false],
  ])("asks the nation for %s on an existing building: %s", async (postcode, asked) => {
    const store = createGeometryStore();
    store.getState().setPropertyPostcode(postcode);
    store.getState().setComplianceSettings({ IsExistingBuilding: true });
    renderEpc(store, "Postcode");
    await screen.findByLabelText("Postcode");
    expect(screen.queryByLabelText("Nation") !== null).toBe(asked);
    if (!asked) {
      expect(screen.getByText("England")).toBeInTheDocument();
      return;
    }
    expect(screen.getByLabelText("Nation")).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText("Nation"), "Wales");
    expect(store.getState().complianceSettings.hemieSettings).toEqual({ HEMIE_nation: "Wales" });
  });

  it("asks the postcode, and the nation of a border area, on a HEM:EPC new build when the host needs them", async () => {
    const store = createGeometryStore();
    store.getState().setPropertyPostcode("CH4 1AA");
    store.getState().setComplianceSettings({ IsExistingBuilding: false });
    renderEpc(store, "HEMIE_nation", {}, true);
    expect(await screen.findByLabelText("Postcode")).toHaveValue("CH4 1AA");
    await waitFor(() => expect(screen.getByLabelText("Nation")).toHaveFocus());
  });

  it("asks the nation under the postcode on an FHS model too, and a link to it lands there", async () => {
    // Part O reads the nation on any target.
    const store = createGeometryStore();
    store.getState().setPropertyPostcode("CH4 1AA");
    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal isOpen onClose={vi.fn()} workspaceResourcePort={createResources()} focusFieldKey="HEMIE_nation" />
      </GeometryStoreProvider>
    );
    await screen.findByLabelText("Property postcode");
    await waitFor(() => expect(screen.getByLabelText("Nation")).toHaveFocus());
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
