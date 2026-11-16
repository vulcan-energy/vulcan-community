// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from 'react';
import type { Element } from '../geometry/types';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { targetSchemaMode } from '../../../geometry-editor-host/src/schemaPort';
import { readRecord } from '../lib/jsonTypes';
import { generateUniqueElementName } from '../lib/elementAutoNaming';
import { isExistingBuilding } from '../lib/windowOpenings';
import {
  adjacentUnconditionedZone,
  METHOD_FORBIDS,
  OBSTACLE,
  shadingDef,
  takesUnconditionedZones,
  unconditionedZoneNames,
  ZONE_UNCONDITIONED,
} from '../lib/unconditionedZones';
import { RU_CALCULATOR_STATE_KEY } from '../lib/unheatedSpaceRu';
import { useGeometryStore } from '../stores/geometryStore';
import { CompactSegmentedControl } from './WindowDetailControls';
import { DirectAdvancedFields } from './DirectAdvancedFields';
import { StandardDropdown } from './StandardDropdown';
import { Readout, SourceNote } from './FieldSource';
import { WINDOW_SHADING_TYPE_LABELS } from '../lib/windowOpenings';

const NEW_ZONE = '\u0000new-zone';
const OPAQUE = 'BuildingElementZoneUnconditionedOpaque';
const TRANSPARENT = 'BuildingElementZoneUnconditionedTransparent';
// The orchestrator sends coeff_ventilation_unconditioned_zone with every zone, and the wrapper
// rejects it on a Direct zone (reported to DESNZ). Drop with the converter's matching stop.
const DIRECT_UNAVAILABLE = 'Direct is not available: HEM:EPC rejects it at present.';
// HEM's own values for a blank coefficient (BS EN ISO 52016-1 Tables B.5 and B.16, as the schema states).
const ZONE_DEFAULTS = { coeff_ventilation_unconditioned_zone: 0.5, coeff_temp_limit_unconditioned_zone: 1 };

function useZoneTarget() {
  const schemaPort = useGeometrySchemaPort();
  const existing = useGeometryStore(isExistingBuilding);
  const root = schemaPort.availability === 'available' ? schemaPort.getRootSchema(targetSchemaMode(schemaPort)) : undefined;
  return { schemaPort, root, takes: takesUnconditionedZones(root, existing) };
}

/**
 * "Unheated space from" on an element next to an unheated space: its resistance (R_u), or the
 * unconditioned zone it borders. Shown where the target takes zones, or where the element names
 * one (so a model that cannot have them can switch back).
 */
export function UnheatedSpaceFrom({ element, commit, editElement }: {
  element: Element;
  commit: (extraJson: Record<string, unknown>) => void;
  editElement: (id: string) => void;
}) {
  const { takes } = useZoneTarget();
  const elementsById = useGeometryStore((state) => state.elementsById);
  const addElement = useGeometryStore((state) => state.addElement);
  const zone = adjacentUnconditionedZone(element);
  const zones = useMemo(() => unconditionedZoneNames(Object.values(elementsById)), [elementsById]);
  if (!takes && zone === undefined) return null;

  const extra = readRecord(element.extra_json);
  const link = (name: string) => {
    const next: Record<string, unknown> = { ...extra, [ZONE_UNCONDITIONED]: name };
    delete next.thermal_resistance_unconditioned_space;
    delete next[RU_CALCULATOR_STATE_KEY];
    commit(next);
  };
  const addZone = () => {
    const systems = Object.values(elementsById).flatMap((e) => (e.type === 'System' ? [e.name] : []));
    const name = generateUniqueElementName('Unconditioned zone', [...systems, ...zones]);
    const anchor = element.coordinates?.[0] ?? { x: 0, y: 0, z: 0 };
    addElement({
      name, type: 'System', subcategory: ZONE_UNCONDITIONED, zoneId: element.zoneId, parent_element: null,
      coordinates: [{ x: anchor.x + 0.75, y: anchor.y + 0.75, z: anchor.z ?? 0 }],
      extra_json: { [ZONE_UNCONDITIONED]: { [name]: { method: 'Calculated' } } },
    } as unknown as Omit<Element, 'id'>);
    link(name);
  };
  const choose = (method: 'resistance' | 'zone') => {
    if (method === (zone === undefined ? 'resistance' : 'zone')) return;
    if (method === 'zone') {
      if (zones[0]) link(zones[0]);
      else addZone();
      return;
    }
    const next = { ...extra };
    delete next[ZONE_UNCONDITIONED];
    commit(next);
  };
  const zoneRow = zone === undefined ? undefined : Object.values(elementsById).find((e) => (
    e.type === 'System' && e.subcategory === ZONE_UNCONDITIONED && zone in readRecord(readRecord(e.extra_json)[ZONE_UNCONDITIONED])
  ));

  return (
    <>
      <div className="element-label">Unheated space from</div>
      <div className="element-input">
        <CompactSegmentedControl
          ariaLabel="Unheated space from"
          value={zone === undefined ? 'resistance' : 'zone'}
          options={[
            { value: 'resistance', label: 'Resistance' },
            { value: 'zone', label: 'Unconditioned zone', disabled: !takes, title: takes ? undefined : 'This model cannot have unconditioned zones.' },
          ]}
          onChange={choose}
        />
      </div>
      {zone !== undefined && (
        <>
          <div className="element-label">Zone</div>
          <div className="element-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <StandardDropdown
                value={zone}
                onChange={(value) => (value === NEW_ZONE ? addZone() : link(String(value)))}
                options={[
                  ...(zones.includes(zone) ? [] : [{ value: zone, label: `${zone} (missing)`, disabled: true }]),
                  ...zones.map((name) => ({ value: name, label: name })),
                  ...(takes ? [{ value: NEW_ZONE, label: 'New zone…' }] : []),
                ]}
                variant="ghost"
                size="md"
              />
            </div>
            {zoneRow && (
              <button type="button" className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action" onClick={() => editElement(zoneRow.id)}>
                Edit
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The schema form of one entry under `$defs`, without the `type` the editor fixes and the keys in
 * `omit`; the keys in `order` come first, as a user fills them, and any others after.
 */
function formOf(root: unknown, def: string, extraRequired: readonly string[] = [], omit: readonly string[] = [], order: readonly string[] = []): Record<string, unknown> {
  const defs = readRecord(readRecord(root).$defs);
  const form = readRecord(defs[def]);
  const all = readRecord(form.properties);
  const properties = Object.fromEntries([...order, ...Object.keys(all)].flatMap((key) => (key in all ? [[key, all[key]]] : [])));
  for (const key of ['type', ...omit]) delete properties[key];
  const required = [...(Array.isArray(form.required) ? form.required as string[] : []), ...extraRequired].filter((key) => key in properties);
  return { type: 'object', properties, required, $defs: defs };
}

// A window as a user fills it: its thermal values, then where it is, then its shading.
const WINDOW_ORDER = ['u_value', 'g_value', 'frame_area_fraction', 'orientation360', 'pitch', 'width', 'height', 'base_height'];
const OPAQUE_ORDER = ['area', 'u_value'];

/** A zone window's width × height, or undefined without both (HEM takes all three). */
function widthByHeight({ width, height }: Record<string, unknown>): number | undefined {
  return typeof width === 'number' && typeof height === 'number' ? Math.round(width * height * 1000) / 1000 : undefined;
}

/** A width or height edit writes the area as width × height; any other edit keeps the stored area. */
function withWindowArea(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const derived = widthByHeight(next);
  if (derived === undefined || (next.width === prev.width && next.height === prev.height)) return next;
  return { ...next, area: derived };
}

const shadingForm = (root: unknown, kind: string) => formOf(root, shadingDef(kind));

const shadingLabel = (kind: string) => (kind === OBSTACLE ? WINDOW_SHADING_TYPE_LABELS.object : WINDOW_SHADING_TYPE_LABELS[kind as keyof typeof WINDOW_SHADING_TYPE_LABELS] ?? kind);

/**
 * The shading of a zone window (`shading`: overhangs, fins, reveals and obstacles), one row each,
 * with the fields the schema gives that kind. None is the default.
 */
function ShadingRows({ value, onChange, root, config }: {
  value: unknown;
  onChange: (next: Record<string, unknown>[] | undefined) => void;
  root: unknown;
  config: Record<string, unknown>;
}) {
  const rows = Array.isArray(value) ? value.map(readRecord) : [];
  const defs = readRecord(readRecord(root).$defs);
  const kinds = [...((readRecord(defs.WindowShadingType).enum as string[] | undefined) ?? []), OBSTACLE];
  const set = (next: Record<string, unknown>[]) => onChange(next.length ? next : undefined);
  // Rows have no name: each is keyed by its kind and its count among that kind, which an edit keeps.
  const seen: Record<string, number> = {};
  const keys = rows.map((row) => {
    const kind = String(row.type ?? '');
    seen[kind] = (seen[kind] ?? 0) + 1;
    return `${kind}-${seen[kind]}`;
  });
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="element-label">Shading</div>
      {rows.map((row, index) => (
        <div key={keys[index]} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <StandardDropdown
                aria-label={`Shading ${index + 1}`}
                value={String(row.type ?? '')}
                // Another kind keeps the values its form takes.
                onChange={(kind) => set(rows.map((r, i) => {
                  if (i !== index) return r;
                  const takes = readRecord(shadingForm(root, String(kind)).properties);
                  return { ...Object.fromEntries(Object.entries(r).filter(([key]) => key in takes)), type: kind };
                }))}
                options={kinds.map((kind) => ({ value: kind, label: shadingLabel(kind) }))}
                variant="ghost"
                size="md"
              />
            </div>
            <button type="button" className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action" aria-label={`Remove shading ${index + 1}`}
              onClick={() => set(rows.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
          <DirectAdvancedFields
            schema={shadingForm(root, String(row.type))}
            data={row}
            config={config}
            onDataChange={(next) => set(rows.map((r, i) => (i === index ? { ...next, type: row.type } : r)))}
          />
        </div>
      ))}
      <div>
        <button type="button" className="btn editor-action-btn editor-action-btn--secondary" onClick={() => set([...rows, { type: kinds[0] ?? 'overhang' }])}>
          Add shading
        </button>
      </div>
    </div>
  );
}

/**
 * The zone of a Systems row with subcategory ZoneUnconditioned: its method, its envelope (each
 * outside wall, roof or window, with the U-value the Calculated method sums) and its coefficients.
 */
export function UnconditionedZoneFields({ row, commit }: {
  row: Element;
  commit: (extraJson: Record<string, unknown>) => void;
}) {
  const { schemaPort, root } = useZoneTarget();
  const extra = readRecord(row.extra_json);
  const zones = readRecord(extra[ZONE_UNCONDITIONED]);
  const [name, value] = Object.entries(zones)[0] ?? [row.name, {}];
  const zone = readRecord(value);
  const method = zone.method === 'Direct' ? 'Direct' : 'Calculated';
  const envelope = Object.entries(readRecord(zone.building_element));
  // Parts read as the window or wall forms do (labels, units, help); the zone's own inputs show HEM's defaults.
  const config = (elementType: string) => ({ elementType, schemaPort, $defs: readRecord(root).$defs, derivedDefaults: ZONE_DEFAULTS });

  const write = (next: Record<string, unknown>) => commit({ ...extra, [ZONE_UNCONDITIONED]: { ...zones, [name]: next } });
  const setEnvelope = (next: Record<string, unknown>) => {
    const z = { ...zone };
    if (Object.keys(next).length) z.building_element = next;
    else delete z.building_element;
    write(z);
  };
  const setPart = (part: string, next: Record<string, unknown>) => setEnvelope({ ...readRecord(zone.building_element), [part]: next });
  const addPart = (type: string, label: string) => {
    const taken = envelope.map(([key]) => key);
    setEnvelope({ ...readRecord(zone.building_element), [generateUniqueElementName(label, taken)]: { type } });
  };
  const chooseMethod = (next: string) => {
    if (next === method) return;
    const z: Record<string, unknown> = { ...zone, method: next };
    for (const key of METHOD_FORBIDS[next] ?? []) delete z[key];
    write(z);
  };

  // The zone's own inputs other than its method and envelope, minus what the method forbids.
  const zoneForm = formOf(root, 'Input_ZoneUnconditioned', [], ['method', 'building_element', ...(METHOD_FORBIDS[method] ?? [])]);
  const zoneInputs = Object.fromEntries(Object.entries(zone).filter(([key]) => key in readRecord(zoneForm.properties)));

  return (
    <>
      <div className="element-label">Method</div>
      <div className="element-input" style={{ display: 'grid', gap: 4 }}>
        <CompactSegmentedControl
          ariaLabel="Method"
          value={method}
          options={[
            { value: 'Calculated', label: 'Calculated' },
            { value: 'Direct', label: 'Direct', disabled: method !== 'Direct', title: DIRECT_UNAVAILABLE },
          ]}
          onChange={chooseMethod}
        />
        <div className="field-source-note">
          {method === 'Direct' ? 'HEM:EPC rejects the Direct method at present. Choose Calculated.' : DIRECT_UNAVAILABLE}
        </div>
      </div>
      {method === 'Calculated' && (
        <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
          <div className="element-label">Envelope</div>
          {envelope.length === 0 && <div className="field-source-note">Add the zone’s outside walls, roof and windows.</div>}
          {envelope.map(([part, partValue]) => {
            const p = readRecord(partValue);
            const transparent = p.type === TRANSPARENT;
            return (
              <div key={part} className="element-editor-subsection" style={{ border: 'var(--border-width-thin) solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 'var(--font-size-sm)' }}>{part}</strong>
                  <button
                    type="button"
                    className="btn editor-action-btn editor-action-btn--secondary"
                    aria-label={`Remove ${part}`}
                    onClick={() => {
                      const next = { ...readRecord(zone.building_element) };
                      delete next[part];
                      setEnvelope(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
                {transparent && (() => {
                  // A stored area other than width × height (from a CSV) is its own value until reset.
                  const derived = widthByHeight(p);
                  const own = p.area !== derived;
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <span className="element-label">Area</span>
                        {!own && <SourceNote>from width × height</SourceNote>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Readout value={typeof p.area === 'number' ? p.area : null} unit="m²" label={`${part} area`} />
                        {own && derived !== undefined && (
                          <button type="button" className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action" onClick={() => setPart(part, { ...p, area: derived })}>
                            Use width × height
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
                <DirectAdvancedFields
                  schema={transparent
                    ? formOf(root, TRANSPARENT, ['u_value'], ['area', 'shading'], WINDOW_ORDER)
                    : formOf(root, OPAQUE, ['u_value'], [], OPAQUE_ORDER)}
                  data={p}
                  config={config(transparent ? 'BuildingElementTransparent' : 'BuildingElementOpaque')}
                  onDataChange={(next) => setPart(part, transparent ? withWindowArea(p, { ...p, ...next }) : { ...next, type: p.type })}
                />
                {transparent && (
                  <ShadingRows
                    value={p.shading}
                    root={root}
                    config={config('BuildingElementTransparent')}
                    onChange={(shading) => {
                      const next = { ...p };
                      if (shading) next.shading = shading;
                      else delete next.shading;
                      setPart(part, next);
                    }}
                  />
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn editor-action-btn editor-action-btn--secondary" onClick={() => addPart(OPAQUE, 'Wall')}>Add wall or roof</button>
            <button type="button" className="btn editor-action-btn editor-action-btn--secondary" onClick={() => addPart(TRANSPARENT, 'Window')}>Add window</button>
          </div>
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}>
        <DirectAdvancedFields
          schema={zoneForm}
          data={zoneInputs}
          config={config('System')}
          onDataChange={(next) => write({ ...Object.fromEntries(Object.entries(zone).filter(([key]) => !(key in zoneInputs))), ...next })}
        />
      </div>
    </>
  );
}
