// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { GeometryWorkspaceResourcePort } from "../../../geometry-editor-host/src/workspaceResourcePort";
import type { Element } from "../geometry/types";
import type { DefaultsLookup } from "../lib/defaultsCache";
import { assemblySourceValuesFor, elementSubtype } from "../lib/fieldDefault";
import { useTargetRules } from "../hooks/useTargetRules";
import {
  BUILT_IN_FABRIC_PRESETS,
  FabricTabCloseContext,
  FABRIC_PRESET_KEYS,
  fabricPresetValuesProblem,
  fabricRowField,
  fabricRowKey,
  ownFabricClear,
  ownFabricKeys,
  parseFabricPreset,
  type FabricPreset,
  type FabricRow,
} from "../lib/fabricPreset";
import type { CreationDefaultAssemblyIds } from "../lib/multiSelectAssemblyApply";
import { useGeometryStore } from "../stores/geometryStore";
import { StandardDropdown } from "./StandardDropdown";
import "./FabricTable.css";

type BuildUpKey = keyof CreationDefaultAssemblyIds;

/** A user's saved fabric presets: one JSON file each (name, family, values, build-ups). */
const FABRIC_PRESETS_DIR = "input/fabric_presets";

const ROWS: readonly { key: FabricRow; label: string; buildUp?: BuildUpKey; fieldKey?: string }[] = [
  { key: "wall", label: "External walls", buildUp: "wall", fieldKey: "DefaultAssemblyWall" },
  { key: "adjacent_wall", label: "Adjacent walls" },
  { key: "roof", label: "Roofs", buildUp: "roof", fieldKey: "DefaultAssemblyRoof" },
  { key: "ground_floor", label: "Ground floors", buildUp: "ground_floor", fieldKey: "DefaultAssemblyGroundFloor" },
  { key: "window", label: "Windows" },
  { key: "door", label: "Doors" },
];

/** The defaults file's values for a row: one per element type it covers, without repeats. */
function fileValues(lookup: DefaultsLookup, row: FabricRow, field: string): number[] {
  const read = (): unknown[] => {
    if (row === "window") return [lookup.getDefaultValueForElementField(field, "BuildingElementTransparent")];
    if (row === "ground_floor") return [lookup.getDefaultValueForElementField(field, "BuildingElementGround")];
    if (row === "adjacent_wall") {
      return ["BuildingElementAdjacentConditionedSpace", "BuildingElementAdjacentUnconditionedSpace_Simple"]
        .map((type) => lookup.getDefaultValueForElementField(field, type));
    }
    return [lookup.getDefaultValueForElementField(field, "BuildingElementOpaque", row === "door" ? "external_door" : row)];
  };
  return [...new Set(read().flatMap((value) => asNumber(value) ?? []))];
}

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const formatNumber = (value: number | undefined) => (value === undefined ? undefined : String(Math.round(value * 1000) / 1000));
/** How a value reads in the table: the U-value bare, the others named. */
const VALUE_PREFIX: Readonly<Record<string, string>> = { u_value: "", g_value: "g ", thermal_resistance_floor_construction: "R " };
const VALUE_LABEL: Readonly<Record<string, string>> = { u_value: "U-value", g_value: "g-value", thermal_resistance_floor_construction: "construction resistance" };

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const canonical = (value: unknown): unknown => isObject(value)
  ? Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonical(value[key])]))
  : value;
/** Two presets state the same values (key order aside). */
const samePreset = (a: FabricPreset | null, b: FabricPreset | null) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const presetFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "preset"}.json`;

type Change = { id: string; name: string; patch: Partial<Element>; to: string };
type SavedPresets = { presets: { preset: FabricPreset; path: string }[]; problems: string[] };


/**
 * A count in a Fabric table: selecting it closes Global Settings and selects those elements, which
 * the canvas highlights in 2D and 3D and the multi-select panel opens on. Plain text at zero.
 */
export function ShowElementsButton({ ids, label, children }: { ids: readonly string[]; label: string; children: ReactNode }) {
  const close = use(FabricTabCloseContext);
  const { clearElementSelection, setSelectedElementIds, setSelection } = useGeometryStore(useShallow((state) => ({
    clearElementSelection: state.clearElementSelection,
    setSelectedElementIds: state.setSelectedElementIds,
    setSelection: state.setSelection,
  })));
  if (!ids.length) return <>{children}</>;
  return (
    <button
      type="button"
      className="fabric-table__count"
      title={label}
      onClick={() => {
        clearElementSelection();
        setSelectedElementIds([...ids]);
        setSelection({ type: "element", id: ids[0]! });
        close?.();
      }}
    >
      {children}
    </button>
  );
}

const builtIn = (item: FabricPreset) => BUILT_IN_FABRIC_PRESETS.includes(item);

/** A value cell: edited in place, committed on Enter or on leaving the field. */
function ValueInput({ label, value, onCommit }: { label: string; value: string; onCommit: (text: string) => void }) {
  return (
    <input
      className="fabric-table__value"
      type="text"
      inputMode="decimal"
      aria-label={label}
      defaultValue={value}
      placeholder="—"
      onBlur={(event) => { if (event.currentTarget.value.trim() !== value) onCommit(event.currentTarget.value); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); }
      }}
    />
  );
}

/** The preview of "Apply to all elements…": which elements' own values it replaces. */
function ApplyPreview({ preview, onApply, onClose }: { preview: readonly Change[]; onApply: () => void; onClose: () => void }) {
  return (
    <section className="fabric-table__preview" aria-label="Apply to all elements">
      {preview.length ? (
        <>
          <p className="fabric-table__help">This replaces the own values of {preview.length === 1 ? "this element" : `these ${preview.length} elements`}:</p>
          <ul>
            {preview.map((change) => <li key={change.id}>{change.name}: {change.to}</li>)}
          </ul>
          <div className="fabric-table__actions">
            <button type="button" className="btn btn-primary btn-small" onClick={onApply}>Apply</button>
            <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className="fabric-table__help">Every element already follows this table.</p>
          <div className="fabric-table__actions">
            <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The Fabric tab body for targets with fabric values: "Fabric values from" (the defaults file's
 * own fabric, a built-in preset or a user's saved preset), then one row per construction type with
 * its use, values and the build-up new elements take. The model stores the preset once; the
 * converter gives each element the values it does not state itself. "Apply to all elements…"
 * clears the elements' own fabric values, after a preview.
 */
export function FabricTable({ workspaceResourcePort, family, fileLabel }: {
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  family: "fhs" | "epc";
  /** The defaults file's name, for the choice that uses its own fabric. */
  fileLabel: string;
}) {
  const { elementsById, defaultsJson, ids, library, libraryLoading, libraryError, lookup, storedPreset } = useGeometryStore(
    useShallow((state) => ({
      elementsById: state.elementsById,
      // Re-read the file's values when it changes.
      defaultsJson: state.defaultsJson,
      ids: state.creationDefaultAssemblyIds,
      library: state.bundledAssemblyLibrary,
      libraryLoading: state.bundledAssemblyLibraryLoading,
      libraryError: state.bundledAssemblyLibraryError,
      lookup: state.getDefaultsLookup(),
      storedPreset: state.fabricPreset,
    })),
  );
  // A preset for the other family (FHS on HEM:EPC, say) waits unused: the table shows the file's values.
  const preset = storedPreset?.family === family ? storedPreset : null;
  const setIds = useGeometryStore((state) => state.setCreationDefaultAssemblyIds);
  const setPreset = useGeometryStore((state) => state.setFabricPreset);
  const updateElement = useGeometryStore((state) => state.updateElement);
  const { arealHeatCapacity } = useTargetRules();
  // The preview of "Apply to all", or how many elements the last apply changed.
  const [step, setStep] = useState<{ preview: Change[] } | { applied: number } | null>(null);
  const preview = step && "preview" in step ? step.preview : null;
  // The user's saved presets with their files, and the files that are not valid presets.
  const [saved, setSaved] = useState<SavedPresets>({ presets: [], problems: [] });
  // Bumped to put the value cells back after an edit that did not go through.
  const [revision, setRevision] = useState(0);

  const ready = workspaceResourcePort.availability === "available";
  const loadSaved = useCallback(async (): Promise<SavedPresets> => {
    if (!ready) return { presets: [], problems: [] };
    const entries = await workspaceResourcePort.list(FABRIC_PRESETS_DIR).catch(() => []);
    const names = entries.flatMap((entry) => {
      const name = typeof entry === "string" ? entry : entry.name;
      return name.endsWith(".json") ? [name] : [];
    }).sort();
    const read = await Promise.all(names.map(async (name) => {
      const path = `${FABRIC_PRESETS_DIR}/${name}`;
      try {
        return { path, preset: parseFabricPreset(await workspaceResourcePort.readText(path)) };
      } catch (error: unknown) {
        return { path, problem: `${path}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }));
    return {
      presets: read.flatMap((item) => (item.preset ? [{ preset: item.preset, path: item.path }] : [])),
      problems: read.flatMap((item) => (item.problem ? [item.problem] : [])),
    };
  }, [ready, workspaceResourcePort]);
  useEffect(() => {
    let cancelled = false;
    void loadSaved().then((result) => { if (!cancelled) setSaved(result); });
    return () => { cancelled = true; };
  }, [loadSaved]);

  // Built-in presets are FHS only: HEM:EPC new build has no DESNZ notional fabric.
  const choices = useMemo(() => {
    // A built-in named as the defaults file is that file's own fabric: it shows once.
    const list = [...BUILT_IN_FABRIC_PRESETS.filter((item) => item.name !== fileLabel), ...saved.presets.map((item) => item.preset)]
      .filter((item) => item.family === family);
    // A model's preset saved elsewhere still shows, so it reads as picked.
    return preset && !list.some((item) => item.name === preset.name) ? [...list, preset] : list;
  }, [family, fileLabel, preset, saved]);

  const byRow = useMemo(() => {
    const rows = new Map<FabricRow, Element[]>(ROWS.map((row) => [row.key, []]));
    for (const element of Object.values(elementsById)) {
      const key = fabricRowKey(element);
      if (key) rows.get(key)!.push(element);
    }
    return rows;
  }, [elementsById]);

  // The table's values: the preset's, else the defaults file's (two where its adjacent walls differ).
  const values = useMemo(() => {
    void defaultsJson;
    return new Map(ROWS.map((row) => [row.key, Object.fromEntries(FABRIC_PRESET_KEYS[row.key].map((key) => {
      const own = asNumber(preset?.values[row.key]?.[key]);
      return [key, own !== undefined ? [own] : fileValues(lookup, row.key, key)];
    }))]));
  }, [defaultsJson, lookup, preset]);
  const single = (row: FabricRow, key: string) => {
    const list = values.get(row)![key]!;
    return list.length === 1 ? list[0] : undefined;
  };
  const describe = (row: FabricRow) => FABRIC_PRESET_KEYS[row]
    .map((key) => `${key === "u_value" ? "U " : VALUE_PREFIX[key]}${values.get(row)![key]!.map(formatNumber).join(" / ")}`).join(" · ");
  // The table as preset values: what a copy saves.
  const tableValues = (): FabricPreset["values"] => Object.fromEntries(ROWS.flatMap((row) => {
    const rowValues = Object.fromEntries(FABRIC_PRESET_KEYS[row.key].flatMap((key) => {
      const value = single(row.key, key);
      return value === undefined ? [] : [[key, value]];
    }));
    return Object.keys(rowValues).length ? [[row.key, rowValues]] : [];
  }));

  const options = (buildUp: BuildUpKey) => {
    const current = ids[buildUp] ?? "";
    const base = library?.examples.filter((example) => example.elementType === buildUp)
      .map((example) => ({ value: example.id, label: example.name || example.id })) ?? [];
    return [
      { value: "", label: "None" },
      ...base,
      ...(current && !base.some((option) => option.value === current) ? [{ value: current, label: `${current} (missing from library)` }] : []),
    ];
  };

  // What "Apply to all" changes: the elements with fabric values of their own lose them, so they
  // take the table's values (the preset's, else the file's).
  const changes = (): Change[] => ROWS.flatMap((row) => {
    if (FABRIC_PRESET_KEYS[row.key].every((key) => !values.get(row.key)![key]!.length)) return [];
    return byRow.get(row.key)!.flatMap((element) => {
      const own = ownFabricKeys(element, row.key);
      if (!own.length) return [];
      const buildUp = own.includes("vulcan_assembly_v1")
        ? assemblySourceValuesFor(element.extra_json, element.type, elementSubtype(element), arealHeatCapacity)
        : {};
      const to = `${describe(row.key)} from ${preset?.name ?? fileLabel}`
        + (own.includes("vulcan_assembly_v1") ? "; its build-up is removed, with the values it set (such as the heat capacity)" : "");
      return [{ id: element.id, name: element.name, patch: ownFabricClear(element, row.key, buildUp), to }];
    });
  });

  const buildUps = () => (Object.keys(ids).length ? { buildUps: { ...ids } } : {});
  const writePreset = async (path: string, item: FabricPreset) => {
    await workspaceResourcePort.ensureDirectory(FABRIC_PRESETS_DIR);
    await workspaceResourcePort.writeText(path, `${JSON.stringify(item, null, 2)}\n`);
    setSaved(await loadSaved());
  };

  /** Saves the table (or `copyValues`) as a new preset of the user's and picks it. False when nothing was saved. */
  const saveCopy = async (copyValues: FabricPreset["values"] = tableValues()): Promise<boolean> => {
    try {
      const name = prompt("Name of the fabric preset:", `${preset?.name ?? fileLabel} copy`)?.trim();
      if (!name) return false;
      if (BUILT_IN_FABRIC_PRESETS.some((item) => item.name === name)) {
        alert(`"${name}" is a built-in preset. Choose another name.`);
        return false;
      }
      const copy: FabricPreset = { name, family, values: copyValues, ...buildUps() };
      const path = `${FABRIC_PRESETS_DIR}/${presetFileName(name)}`;
      if (await workspaceResourcePort.exists(path) && !confirm("A preset with this name exists. Replace it?")) return false;
      await writePreset(path, copy);
      setPreset(copy);
      return true;
    } catch (error: unknown) {
      alert(`Save as a copy failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  /**
   * An edited value cell. A user's preset takes the value at once, with the elements that follow
   * it, in one undo step, and its file is rewritten. A built-in preset and the file's own values
   * stay as they are: the edit is saved as a copy first.
   */
  const editValue = async (row: FabricRow, key: string, text: string) => {
    const trimmed = text.trim();
    const value = trimmed === "" ? undefined : Number(trimmed);
    const base = preset && !builtIn(preset) ? preset.values : tableValues();
    const rowValues = { ...base[row] };
    if (value === undefined) delete rowValues[key];
    else rowValues[key] = value;
    const nextValues = Object.fromEntries([...Object.entries(base).filter(([name]) => name !== row), ...(Object.keys(rowValues).length ? [[row, rowValues]] : [])]);
    const problem = fabricPresetValuesProblem(nextValues);
    if (problem) {
      alert(`Not changed: ${problem}.`);
      setRevision((current) => current + 1);
      return;
    }
    if (!preset || builtIn(preset)) {
      if (!await saveCopy(nextValues)) setRevision((current) => current + 1);
      return;
    }
    const next: FabricPreset = { ...preset, values: nextValues, ...buildUps() };
    setPreset(next);
    const path = saved.presets.find((item) => item.preset.name === preset.name)?.path;
    if (path) {
      await writePreset(path, next).catch((error: unknown) => alert(`Saving the preset file failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  const choiceRow = (item: FabricPreset | null) => {
    const selected = (preset?.name ?? null) === (item?.name ?? null);
    // The saved preset changed since the model took it: picking it again brings its values in.
    const stale = selected && !samePreset(preset, item);
    return (
      <button
        key={item?.name ?? ""}
        type="button"
        className="fabric-source"
        aria-pressed={selected}
        onClick={() => { if (!samePreset(storedPreset, item)) setPreset(item); }}
      >
        <span className="fabric-source__name">{item?.name ?? fileLabel}</span>
        <span className="fabric-table__note">{stale ? "Update from saved preset" : !item || builtIn(item) ? "built-in" : "your preset"}</span>
      </button>
    );
  };

  return (
    <div className="fabric-table-group">
      <div className="fabric-table__label">Fabric values from</div>
      <fieldset className="fabric-sources" aria-label="Fabric values from">
        {choiceRow(null)}
        {choices.map(choiceRow)}
      </fieldset>
      {saved.problems.map((problem) => <p key={problem} className="fabric-table__help fabric-table__help--error">Left out, not a valid preset: {problem}</p>)}
      <table className="fabric-table">
        <thead>
          <tr><th>Type</th><th>Used by</th><th>U-value</th><th>Build-up</th></tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const elements = byRow.get(row.key)!;
            const own = elements.filter((element) => ownFabricKeys(element, row.key).length > 0);
            const value = values.get(row.key)!;
            return (
              <tr key={row.key} data-fabric-row={row.key}>
                <td data-field-key={fabricRowField(row.key)}>{row.label}</td>
                <td>
                  <ShowElementsButton ids={elements.map((element) => element.id)} label={`Show the ${row.label.toLowerCase()} on the drawing`}>{elements.length}</ShowElementsButton>
                  {own.length ? (
                    <span className="fabric-table__note"> · <ShowElementsButton ids={own.map((element) => element.id)} label="Show these elements on the drawing">{own.length} with own values</ShowElementsButton></span>
                  ) : null}
                </td>
                <td>
                  <span className="fabric-table__values">
                    {FABRIC_PRESET_KEYS[row.key].map((key) => (
                      <span key={`${key}-${revision}-${value[key]!.join("/")}`} className="fabric-table__value-field">
                        {VALUE_PREFIX[key] ? <span className="fabric-table__note">{VALUE_PREFIX[key]}</span> : null}
                        <ValueInput
                          label={`${row.label} ${VALUE_LABEL[key]}`}
                          value={value[key]!.map(formatNumber).join(" / ")}
                          onCommit={(text) => void editValue(row.key, key, text)}
                        />
                      </span>
                    ))}
                  </span>
                </td>
                <td>
                  {row.buildUp ? (
                    <StandardDropdown
                      className="fabric-table__dropdown"
                      label={<span data-field-key={row.fieldKey}>{row.label} build-up</span>}
                      value={ids[row.buildUp] ?? ""}
                      onChange={(next) => setIds({ [row.buildUp!]: next || undefined })}
                      options={options(row.buildUp)}
                      variant="ghost"
                      size="sm"
                      disabled={!library}
                    />
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {libraryLoading && !library ? <p className="fabric-table__help">Loading the assembly library…</p>
        : libraryError ? <p className="fabric-table__help fabric-table__help--error">Could not load input/assembly_library/: {libraryError}</p> : null}
      <p className="fabric-table__help">Select a count to show those elements on the drawing.</p>
      <p className="fabric-table__help">
        Elements take these values where they state none of their own; new elements take the build-up where one is chosen.
      </p>
      {preview ? (
        <ApplyPreview
          preview={preview}
          onApply={() => {
            preview.forEach((change, index) => updateElement(change.id, change.patch, index < preview.length - 1));
            setStep({ applied: preview.length });
          }}
          onClose={() => setStep(null)}
        />
      ) : (
        <div className="fabric-table__actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setStep({ preview: changes() })}>
            Apply to all elements…
          </button>
          <button type="button" className="btn btn-secondary btn-small" disabled={!ready} onClick={() => void saveCopy()}>
            Save as a copy
          </button>
          {step && "applied" in step ? <span className="fabric-table__note">Applied to {step.applied === 1 ? "1 element" : `${step.applied} elements`}. Undo restores their values.</span> : null}
        </div>
      )}
    </div>
  );
}
