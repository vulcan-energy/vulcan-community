// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeometryWorkspaceResourcePort } from "../../../../geometry-editor-host/src/index";
import { FabricTable } from "../FabricTable";
import { BUILT_IN_FABRIC_PRESETS, FabricTabCloseContext, presetValueFor } from "../../lib/fabricPreset";
import { createGeometryStore, GeometryStoreProvider } from "../../stores/geometryStore";

const FABRIC_FILE = {
  Zone: { "zone 1": { BuildingElement: {
    "wall 0": { type: "BuildingElementOpaque", pitch: 90, u_value: 0.18 },
    "roof 0": { type: "BuildingElementOpaque", pitch: 45, u_value: 0.11 },
    "external door": { type: "BuildingElementOpaque", pitch: 90, is_external_door: true, u_value: 1 },
    "window 0": { type: "BuildingElementTransparent", u_value: 1.2, g_value: 0.75 },
    ground: { type: "BuildingElementGround", u_value: 0.13, thermal_resistance_floor_construction: 6.12 },
    "wall 4": { type: "BuildingElementAdjacentConditionedSpace", u_value: 0.15 },
    "wall 5": { type: "BuildingElementAdjacentUnconditionedSpace_Simple", u_value: 0.18 },
  } } },
};

const line = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
const wall = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, type: "BuildingElementOpaque", zoneId: "zone", pitch: 90, width: 4, height: 2, area: 8, coordinates: line, extra_json: extra,
});

function resources(files: Record<string, string> = {}, overrides: Partial<GeometryWorkspaceResourcePort> = {}): GeometryWorkspaceResourcePort {
  return {
    availability: "available",
    readText: vi.fn(async (path: string) => files[path] ?? "{}"),
    readFile: vi.fn(),
    writeText: vi.fn(async () => undefined),
    writeBytes: vi.fn(),
    removeFile: vi.fn(),
    ensureDirectory: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    list: vi.fn(async (path: string) => Object.keys(files).filter((file) => file.startsWith(`${path}/`))
      .map((file) => ({ name: file.split("/").pop()!, kind: "file" as const }))),
    ...overrides,
  };
}

function setup(elements: Record<string, unknown>, options: { defaultsJson?: unknown; family?: "fhs" | "epc"; port?: GeometryWorkspaceResourcePort; close?: () => void; fileLabel?: string } = {}) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.setState({
    elementsById: elements as never, elementIds: Object.keys(elements), defaultsJson: (options.defaultsJson ?? FABRIC_FILE) as never,
    // History entries are the saved CSV, so the fixture must be exportable.
    zones: [{ id: "zone", name: "Zone", floorArea: 1, height: 2 }] as never, zoneIds: ["zone"],
  });
  const { container } = render(
    <GeometryStoreProvider store={store}>
      <FabricTabCloseContext value={options.close ?? null}>
        <FabricTable workspaceResourcePort={options.port ?? resources()} family={options.family ?? "fhs"} fileLabel={options.fileLabel ?? "Standard template"} />
      </FabricTabCloseContext>
    </GeometryStoreProvider>,
  );
  const row = (key: string) => container.querySelector(`[data-fabric-row="${key}"]`) as HTMLElement;
  const extra = (id: string) => store.getState().elementsById[id]!.extra_json as Record<string, unknown>;
  const cell = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  return { store, row, extra, cell };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FabricTable", () => {
  it("shows every construction type with no drawing yet, so build-ups can be chosen first", () => {
    const { row, cell } = setup({});
    expect(row("wall")).toHaveTextContent(/^External walls0/);
    expect(cell("External walls U-value").value).toBe("0.18");
    expect(cell("Roofs U-value").value).toBe("0.11");
    // The ground's U-value comes from the floor calculation: the table states its resistance.
    expect(row("ground_floor")).toHaveTextContent(/^Ground floors0R/);
    expect(cell("Ground floors construction resistance").value).toBe("6.12");
    expect(cell("Windows U-value").value).toBe("1.2");
    expect(cell("Windows g-value").value).toBe("0.75");
    expect(row("door")).toHaveTextContent("Doors0—");
    expect(cell("Doors U-value").value).toBe("1");
    // The file's two adjacent walls differ: both show.
    expect(cell("Adjacent walls U-value").value).toBe("0.15 / 0.18");
    expect(within(row("wall")).getByLabelText("External walls build-up")).toBeInTheDocument();
  });

  it("stores a preset once and leaves the elements as they are, in one undo step", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { store, row, extra, cell } = setup({ a: wall("a", "Wall A"), b: wall("b", "Wall B", { u_value: 0.3 }) });
    act(() => store.getState().saveToHistory("fixture baseline"));

    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    expect(store.getState().fabricPreset?.name).toBe("Part L 2021");
    // The converter gives Wall A the preset's U-value; the element itself does not change.
    expect(extra("a")).toEqual({});
    expect(extra("b")).toEqual({ u_value: 0.3 });
    expect(presetValueFor(store.getState().elementsById.a!, store.getState().fabricPreset)).toEqual({ u_value: 0.26 });
    expect(presetValueFor(store.getState().elementsById.b!, store.getState().fabricPreset)).toEqual({});
    expect(row("wall")).toHaveTextContent("2 · 1 with own values");
    expect(cell("External walls U-value").value).toBe("0.26");
    expect(cell("Adjacent walls U-value").value).toBe("0.26");
    expect(cell("Windows U-value").value).toBe("1.6");
    expect(cell("Windows g-value").value).toBe("0.63");
    expect(store.getState().defaultsPath).toBeUndefined();

    act(() => vi.advanceTimersByTime(350));
    act(() => store.getState().undo());
    expect(store.getState().fabricPreset).toBeNull();
  });

  it("counts only fabric values as an element's own: a heat capacity leaves the preset's U-value", async () => {
    const user = userEvent.setup();
    const { store, row } = setup({ a: wall("a", "Wall A", { areal_heat_capacity: 110000 }) });
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    expect(row("wall")).not.toHaveTextContent("with own values");
    expect(presetValueFor(store.getState().elementsById.a!, store.getState().fabricPreset)).toEqual({ u_value: 0.26 });
  });

  it("Apply to all clears the elements' own fabric values after a preview, in one undo step", async () => {
    const user = userEvent.setup();
    const { row, extra } = setup({ a: wall("a", "Wall A"), b: wall("b", "Wall B", { u_value: 0.3, mass_distribution_class: "I" }) });
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    await user.click(screen.getByRole("button", { name: "Apply to all elements…" }));
    const preview = screen.getByRole("region", { name: "Apply to all elements" });
    expect(preview).toHaveTextContent("This replaces the own values of this element:Wall B: U 0.26 from Part L 2021");
    await user.click(within(preview).getByRole("button", { name: "Apply" }));
    // The mass distribution class is not a fabric value the preset gives: it stays.
    expect(extra("b")).toEqual({ u_value: undefined, thermal_resistance_construction: undefined, vulcan_assembly_v1: undefined, mass_distribution_class: "I" });
    expect(row("wall")).toHaveTextContent(/^External walls2/);
    expect(row("wall")).not.toHaveTextContent("with own values");
    expect(screen.getByText("Applied to 1 element. Undo restores their values.")).toBeInTheDocument();
  });

  it("leaves elements alone where neither the file nor a preset states a value", async () => {
    const user = userEvent.setup();
    // The EPC template's elements have no U-value: elements must state their own.
    const epc = { Zone: { "zone 1": { BuildingElement: { "wall 0": { type: "BuildingElementOpaque", pitch: 90 } } } } };
    const { row, cell } = setup({ b: wall("b", "Wall B", { u_value: 0.3 }) }, { defaultsJson: epc, family: "epc" });
    expect(row("wall")).toHaveTextContent(/^External walls1 · 1 with own values/);
    expect(cell("External walls U-value").value).toBe("");
    await user.click(screen.getByRole("button", { name: "Apply to all elements…" }));
    expect(screen.getByText("Every element already follows this table.")).toBeInTheDocument();
  });

  it("offers HEM:EPC new build only the user's own presets, and saves the table as one", async () => {
    const user = userEvent.setup();
    const saved = { name: "Our EPC spec", family: "epc", values: { wall: { u_value: 0.2 } } };
    const port = resources({ "input/fabric_presets/our_epc_spec.json": JSON.stringify(saved), "input/fabric_presets/fhs.json": JSON.stringify({ ...saved, name: "FHS one", family: "fhs" }) });
    const { store } = setup({}, { family: "epc", port });
    const sources = screen.getByRole("group", { name: "Fabric values from" });
    await waitFor(() => expect(sources).toHaveTextContent("Standard templatebuilt-inOur EPC specyour preset"));
    expect(sources).not.toHaveTextContent("Part L 2021");
    expect(sources).not.toHaveTextContent("FHS one");

    await user.click(within(sources).getByRole("button", { name: /Our EPC spec/ }));
    vi.spyOn(window, "prompt").mockReturnValue("Copy");
    await user.click(screen.getByRole("button", { name: "Save as a copy" }));
    await waitFor(() => expect(port.writeText).toHaveBeenCalled());
    const [path, text] = vi.mocked(port.writeText).mock.calls[0] as unknown as [string, string];
    expect(path).toBe("input/fabric_presets/copy.json");
    // The adjacent walls differ in the file: the copy leaves them to it.
    expect(JSON.parse(text)).toEqual({ name: "Copy", family: "epc", values: {
      wall: { u_value: 0.2 }, roof: { u_value: 0.11 }, ground_floor: { thermal_resistance_floor_construction: 6.12 }, window: { u_value: 1.2, g_value: 0.75 }, door: { u_value: 1 },
    } });
    expect(store.getState().fabricPreset?.name).toBe("Copy");
  });

  it("keeps a model saved before presets as it was, and saves the preset with the model", async () => {
    const user = userEvent.setup();
    const { store, extra } = setup({ a: wall("a", "Wall A"), b: wall("b", "Wall B", { u_value: 0.3 }) });
    expect(store.getState().fabricPreset).toBeNull();
    expect(extra("b")).toEqual({ u_value: 0.3 });
    expect(store.getState().generateCSV({ allowUnresolvedMigration: true })).not.toMatch(/^FabricPreset,/m);
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
    expect(csv).toMatch(/^FabricPreset,/m);
    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(csv);
    expect(reloaded.getState().fabricPreset).toMatchObject({ name: "Part L 2021", values: { wall: { u_value: 0.26 } } });
    const reloadedA = Object.values(reloaded.getState().elementsById).find((element) => element.name === "Wall A")!;
    expect(reloadedA.extra_json ?? {}).not.toHaveProperty("u_value");
  });

  it("gives both kinds of adjacent wall the adjacent-wall row", async () => {
    const user = userEvent.setup();
    const adjacent = (id: string, type: string) => ({ ...wall(id, id), type });
    const { store, row } = setup({
      c: adjacent("c", "BuildingElementAdjacentConditionedSpace"),
      u: adjacent("u", "BuildingElementAdjacentUnconditionedSpace_Simple"),
    });
    expect(row("adjacent_wall")).toHaveTextContent(/^Adjacent walls2/);
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    const { elementsById, fabricPreset } = store.getState();
    expect(presetValueFor(elementsById.c!, fabricPreset)).toEqual({ u_value: 0.26 });
    expect(presetValueFor(elementsById.u!, fabricPreset)).toEqual({ u_value: 0.26 });
    await user.click(screen.getByRole("button", { name: /HEM case study/ }));
    expect(presetValueFor(store.getState().elementsById.c!, store.getState().fabricPreset)).toEqual({ u_value: 0.18 });
  });

  it("keeps the user's build-ups for the types a preset gives none", async () => {
    const user = userEvent.setup();
    const port = resources({ "input/fabric_presets/ours.json": JSON.stringify({ name: "Ours", family: "fhs", values: {}, buildUps: { roof: "roof-b" } }) });
    const { store } = setup({}, { port });
    act(() => store.getState().setCreationDefaultAssemblyIds({ wall: "wall-a", roof: "roof-a" }));
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    expect(store.getState().creationDefaultAssemblyIds).toEqual({ wall: "wall-a", roof: "roof-a" });
    await user.click(await screen.findByRole("button", { name: /Ours/ }));
    expect(store.getState().creationDefaultAssemblyIds).toEqual({ wall: "wall-a", roof: "roof-b" });
    act(() => store.getState().setFabricPreset(null));
    expect(store.getState().creationDefaultAssemblyIds).toEqual({ wall: "wall-a", roof: "roof-b" });
  });

  it("edits a user's preset in place: the preset row and its file, in one undo step", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const ours = { name: "Ours", family: "fhs", values: { wall: { u_value: 0.2 } } };
    const port = resources({ "input/fabric_presets/ours_file.json": JSON.stringify(ours) });
    const { store, extra, cell } = setup({ a: wall("a", "Wall A"), b: wall("b", "Wall B", { u_value: 0.3 }) }, { port });
    await user.click(await screen.findByRole("button", { name: /Ours/ }));
    act(() => vi.advanceTimersByTime(350));

    await user.clear(cell("External walls U-value"));
    await user.type(cell("External walls U-value"), "0.15{Enter}");
    expect(store.getState().fabricPreset?.values.wall).toEqual({ u_value: 0.15 });
    expect(presetValueFor(store.getState().elementsById.a!, store.getState().fabricPreset)).toEqual({ u_value: 0.15 });
    expect(extra("a")).toEqual({});
    expect(extra("b").u_value).toBe(0.3);
    await waitFor(() => expect(port.writeText).toHaveBeenCalled());
    const [path, text] = vi.mocked(port.writeText).mock.calls[0] as unknown as [string, string];
    expect(path).toBe("input/fabric_presets/ours_file.json");
    expect(JSON.parse(text).values.wall).toEqual({ u_value: 0.15 });

    act(() => vi.advanceTimersByTime(350));
    act(() => store.getState().undo());
    expect(store.getState().fabricPreset?.values.wall).toEqual({ u_value: 0.2 });
  });

  it("saves an edit of a built-in preset as a copy first, and leaves the built-in as it was", async () => {
    const user = userEvent.setup();
    const port = resources();
    const { store, cell } = setup({ a: wall("a", "Wall A") }, { port });
    await user.click(screen.getByRole("button", { name: /Part L 2021/ }));
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce(null);
    await user.clear(cell("External walls U-value"));
    await user.type(cell("External walls U-value"), "0.2{Enter}");
    // Cancelled: nothing changes and the cell shows the preset's value again.
    expect(store.getState().fabricPreset?.name).toBe("Part L 2021");
    await waitFor(() => expect(cell("External walls U-value").value).toBe("0.26"));

    prompt.mockReturnValueOnce("Our Part L");
    await user.clear(cell("External walls U-value"));
    await user.type(cell("External walls U-value"), "0.2{Enter}");
    await waitFor(() => expect(store.getState().fabricPreset?.name).toBe("Our Part L"));
    expect(store.getState().fabricPreset?.values.wall).toEqual({ u_value: 0.2 });
    expect(store.getState().fabricPreset?.values.roof).toEqual({ u_value: 0.16 });
    expect(vi.mocked(port.writeText).mock.calls[0]![0]).toBe("input/fabric_presets/our_part_l.json");
  });

  it("creates a HEM:EPC new-build preset from the table", async () => {
    const user = userEvent.setup();
    const epc = { Zone: { "zone 1": { BuildingElement: { "wall 0": { type: "BuildingElementOpaque", pitch: 90 } } } } };
    const { store, cell } = setup({ a: wall("a", "Wall A") }, { defaultsJson: epc, family: "epc" });
    vi.spyOn(window, "prompt").mockReturnValueOnce("Our EPC spec");
    await user.type(cell("External walls U-value"), "0.22{Enter}");
    await waitFor(() => expect(store.getState().fabricPreset).toEqual({ name: "Our EPC spec", family: "epc", values: { wall: { u_value: 0.22 } } }));
  });

  it("refuses a value out of range in a cell", async () => {
    const user = userEvent.setup();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const port = resources({ "input/fabric_presets/ours.json": JSON.stringify({ name: "Ours", family: "fhs", values: { wall: { u_value: 0.2 } } }) });
    const { store, cell } = setup({}, { port });
    await user.click(await screen.findByRole("button", { name: /Ours/ }));
    await user.clear(cell("External walls U-value"));
    await user.type(cell("External walls U-value"), "12{Enter}");
    expect(alert).toHaveBeenCalledWith("Not changed: the wall U-value 12 is outside 0 to 10 W/m²K.");
    expect(store.getState().fabricPreset?.values.wall).toEqual({ u_value: 0.2 });
    await waitFor(() => expect(cell("External walls U-value").value).toBe("0.2"));
  });

  it("offers to update a model's preset row from its saved file when the file changed", async () => {
    const user = userEvent.setup();
    const file = { name: "Ours", family: "fhs", values: { wall: { u_value: 0.25 } } };
    const port = resources({ "input/fabric_presets/ours.json": JSON.stringify(file) });
    const { store } = setup({ a: wall("a", "Wall A") }, { port });
    act(() => store.setState({ fabricPreset: { name: "Ours", family: "fhs", values: { wall: { u_value: 0.2 } } } }));
    const choice = await screen.findByRole("button", { name: /Update from saved preset/ });
    expect(choice).toHaveTextContent("Ours");
    await user.click(choice);
    expect(store.getState().fabricPreset?.values.wall).toEqual({ u_value: 0.25 });
    expect(choice).toHaveTextContent("your preset");
  });

  it("leaves a preset of the other family unused, and picking the file's own removes it", async () => {
    const user = userEvent.setup();
    const { store, cell } = setup({ a: wall("a", "Wall A") }, { family: "epc" });
    act(() => store.setState({ fabricPreset: BUILT_IN_FABRIC_PRESETS[0]! }));
    const sources = screen.getByRole("group", { name: "Fabric values from" });
    expect(sources).not.toHaveTextContent("Part L 2021");
    expect(within(sources).getByRole("button", { name: /Standard template/ })).toHaveAttribute("aria-pressed", "true");
    expect(cell("External walls U-value").value).toBe("0.18");
    await user.click(within(sources).getByRole("button", { name: /Standard template/ }));
    expect(store.getState().fabricPreset).toBeNull();
  });

  it("says plainly which saved preset files it left out", async () => {
    const port = resources({ "input/fabric_presets/bad.json": JSON.stringify({ name: "Bad", family: "fhs", values: { wall: { u_value: 99 } } }) });
    setup({}, { port });
    expect(await screen.findByText(/Left out, not a valid preset: input\/fabric_presets\/bad\.json: Fabric preset "Bad": the wall U-value 99 is outside 0 to 10 W\/m²K\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bad/ })).not.toBeInTheDocument();
  });

  it("shows a built-in preset named as the defaults file once", () => {
    setup({}, { fileLabel: "HEM case study" });
    expect(screen.getByRole("group", { name: "Fabric values from" })).toHaveTextContent(/^HEM case studybuilt-inPart L 2021built-in$/);
  });

  it("selects the elements of a count on the drawing and closes Global Settings", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const { store, row } = setup({ a: wall("a", "Wall A"), b: wall("b", "Wall B", { u_value: 0.3 }) }, { close });
    expect(screen.getByText("Select a count to show those elements on the drawing.")).toBeInTheDocument();
    // Nothing to show: a zero count is text.
    expect(within(row("roof")).queryByRole("button", { name: "0" })).not.toBeInTheDocument();
    await user.click(within(row("wall")).getByRole("button", { name: "1 with own values" }));
    expect(store.getState().selectedElementIds).toEqual(["b"]);
    expect(store.getState().selection).toMatchObject({ type: "element", id: "b" });
    expect(close).toHaveBeenCalledTimes(1);
    await user.click(within(row("wall")).getByRole("button", { name: "2" }));
    expect(store.getState().selectedElementIds).toEqual(["a", "b"]);
  });
});
