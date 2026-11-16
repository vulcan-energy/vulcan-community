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
  takesUnconditionedZones,
  unconditionedZoneNames,
  ZONE_UNCONDITIONED,
} from '../lib/unconditionedZones';
import { RU_CALCULATOR_STATE_KEY } from '../lib/unheatedSpaceRu';
import { useGeometryStore } from '../stores/geometryStore';
import { CompactSegmentedControl } from './WindowDetailControls';
import { DirectAdvancedFields } from './DirectAdvancedFields';
import { StandardDropdown } from './StandardDropdown';

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

/** The schema form of one entry under `$defs`, without the `type` the editor fixes. */
function formOf(root: unknown, def: string, extraRequired: readonly string[] = [], omit: readonly string[] = []): Record<string, unknown> {
  const defs = readRecord(readRecord(root).$defs);
  const form = readRecord(defs[def]);
  const properties = { ...readRecord(form.properties) };
  for (const key of ['type', ...omit]) delete properties[key];
  const required = [...(Array.isArray(form.required) ? form.required as string[] : []), ...extraRequired].filter((key) => key in properties);
  return { type: 'object', properties, required, $defs: defs };
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
                <DirectAdvancedFields
                  schema={formOf(root, transparent ? TRANSPARENT : OPAQUE, ['u_value'])}
                  data={p}
                  config={config(transparent ? 'BuildingElementTransparent' : 'BuildingElementOpaque')}
                  onDataChange={(next) => setEnvelope({ ...readRecord(zone.building_element), [part]: { ...next, type: p.type } })}
                />
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
