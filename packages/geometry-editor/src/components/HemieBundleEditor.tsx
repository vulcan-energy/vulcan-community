// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The parameters of a bay window or conservatory bundle, shown on its anchor (the front wall).
// A committed change regenerates the members in place; what the user set on a member (its
// fabric, a window's opening type) stays.

import { useState, type ReactNode } from 'react';
import type { BuildingElementOpaque, Element, ElementDraft } from '../geometry/types';
import { useGeometryStore, useGeometryStoreApi } from '../stores/geometryStore';
import {
  bayParametersProblem,
  buildBayBundleDraft,
  buildConservatoryBundleDraft,
  bundleMemberNames,
  conservatoryParametersProblem,
  getHemieBundle,
  getHemieBundleMembers,
  groundFloorUnderWall,
  hemieBundleHostProblem,
  isHemieBundleHost,
  planBundleUpdate,
  type BayParameters,
  type ConservatoryParameters,
} from '../lib/hemieBundles';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import { INLINE_FIELD_NOTE_STYLE } from './elementForms/formPrimitives';

type Field<P> = (
  | { key: keyof P; label: string; kind: 'number'; unit?: string }
  | { key: keyof P; label: string; kind: 'choice'; options: Array<{ value: string; label: string }> }
) & { shown?: (p: P) => boolean; note?: string };

const BAY_FIELDS: Field<BayParameters>[] = [
  { key: 'centre', label: 'Opening centre from wall start', kind: 'number', unit: 'm' },
  { key: 'openingWidth', label: 'Opening width', kind: 'number', unit: 'm' },
  { key: 'depth', label: 'Projection', kind: 'number', unit: 'm' },
  { key: 'sideAngle', label: 'Side angle (90° square)', kind: 'number', unit: '°' },
  { key: 'roof', label: 'Roof', kind: 'choice', options: [{ value: 'flat', label: 'Flat' }, { value: 'pitched', label: 'Pitched' }, { value: 'none', label: 'None (a bay above)' }] },
  { key: 'sideWindows', label: 'Side windows', kind: 'choice', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'sillHeight', label: 'Window sill height', kind: 'number', unit: 'm' },
  { key: 'windowHeight', label: 'Window height', kind: 'number', unit: 'm' },
];

const CONSERVATORY_FIELDS: Field<ConservatoryParameters>[] = [
  { key: 'conservatoryType', label: 'Type', kind: 'choice', options: [{ value: 'non-separated', label: 'Non-separated (heated, open to the dwelling)' }, { value: 'separated', label: 'Separated' }, { value: 'unheated', label: 'Unheated' }] },
  {
    key: 'adjacentSpaceType',
    label: 'Unheated space type',
    kind: 'choice',
    options: [{ value: '', label: 'Choose…' }, ...['corridor', 'garage', 'roof void', 'stairwell'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))],
    shown: (p) => p.conservatoryType === 'unheated',
    note: 'HEMIE has no conservatory type yet; pick the closest.',
  },
  { key: 'centre', label: 'Centre from wall start', kind: 'number', unit: 'm' },
  { key: 'width', label: 'Width', kind: 'number', unit: 'm' },
  { key: 'depth', label: 'Depth', kind: 'number', unit: 'm' },
  { key: 'wallHeight', label: 'Wall height (to eaves)', kind: 'number', unit: 'm' },
  { key: 'dwarfWallHeight', label: 'Dwarf wall height', kind: 'number', unit: 'm' },
  { key: 'roof', label: 'Roof', kind: 'choice', options: [{ value: 'lean-to', label: 'Lean-to' }, { value: 'dual', label: 'Dual pitch (gable at the front)' }, { value: 'flat', label: 'Flat' }] },
  { key: 'roofPitch', label: 'Roof pitch', kind: 'number', unit: '°', shown: (p) => p.roof !== 'flat' },
];

/** Remount per anchor (`key`): field edits not yet committed belong to one bundle. */
export function HemieBundleEditor({ anchor }: { anchor: Element }) {
  const store = useGeometryStoreApi();
  const elementsById = useGeometryStore((s) => s.elementsById);
  const tag = getHemieBundle(anchor)!;
  // Typed but not yet committed values, over the saved parameters.
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const draft = { ...(tag.parameters as unknown as Record<string, unknown>), ...edits };
  const host = Object.values(elementsById).find((element) => element.name === tag.host_wall && isHemieBundleHost(element)) as
    | BuildingElementOpaque
    | undefined;
  const isBay = tag.kind === 'bay';
  const fields = (isBay ? BAY_FIELDS : CONSERVATORY_FIELDS) as Field<Record<string, unknown>>[];
  const parameters = draft as unknown as BayParameters & ConservatoryParameters;
  const hostProblem = hemieBundleHostProblem(anchor, Object.values(elementsById));
  const problem = !host
    ? hostProblem
    : isBay ? bayParametersProblem(host, parameters) : conservatoryParametersProblem(host, parameters);

  const commit = (next: Record<string, unknown>) => {
    setEdits(next);
    const nextParameters = next as unknown as BayParameters & ConservatoryParameters;
    if (!host || (isBay ? bayParametersProblem(host, nextParameters) : conservatoryParametersProblem(host, nextParameters))) return;
    const state = store.getState();
    const all = Object.values(state.elementsById);
    const members = getHemieBundleMembers(all, tag.bundle_id);
    const input = {
      host,
      groundFloor: groundFloorUnderWall(host, all),
      existingNames: all.map((element) => element.name),
      globalOrientationOffset: state.globalOrientationOffset,
      bundleId: tag.bundle_id,
      bundleName: tag.bundle_name,
      names: bundleMemberNames(members),
    };
    const bundle = isBay
      ? buildBayBundleDraft({ ...input, parameters: nextParameters })
      : buildConservatoryBundleDraft({ ...input, parameters: nextParameters });
    const plan = planBundleUpdate(members, bundle);
    state.updateElementsBulk(plan.update as Record<string, Partial<Element>>);
    if (plan.add.length) {
      state.addElements(plan.add.map((member) => ({
        ...member.updates,
        name: member.name,
        type: member.type,
        zoneId: host.zoneId,
        parent_element: member.parent_element,
      }) as ElementDraft));
    }
    for (const id of plan.remove) state.removeElement(id);
    setEdits({});
  };

  return (
    <>
      {fields.filter((field) => !field.shown || field.shown(draft)).map((field) => (
        <FieldRow key={String(field.key)} label={`${field.label}:`}>
          {field.kind === 'choice' ? (
            <StandardDropdown
              value={String(draft[field.key as string] ?? '')}
              onChange={(value) => commit({ ...draft, [field.key]: value === 'true' ? true : value === 'false' ? false : value })}
              options={field.options}
              aria-label={field.label}
              variant="ghost"
              size="md"
            />
          ) : (
            <StandardInput
              type="number"
              value={String(draft[field.key as string] ?? '')}
              unit={field.unit}
              step="0.1"
              aria-label={field.label}
              onChange={(e) => setEdits({ ...edits, [field.key]: e.target.value === '' ? '' : Number(e.target.value) })}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(draft); }}
              variant="ghost"
              size="md"
            />
          )}
          {field.note ? <div style={INLINE_FIELD_NOTE_STYLE}>{field.note}</div> : null}
        </FieldRow>
      ))}
      {problem ? <div style={INLINE_FIELD_NOTE_STYLE} role="alert">{problem}</div> : null}
      {host && hostProblem ? (
        <>
          <div style={INLINE_FIELD_NOTE_STYLE} role="alert">{hostProblem}</div>
          <button type="button" className="btn btn-nav btn-small" onClick={() => commit(draft)}>Place again</button>
        </>
      ) : null}
      {!isBay && parameters.conservatoryType !== 'non-separated' ? (
        <div style={INLINE_FIELD_NOTE_STYLE}>
          Not entered in the EPC: only a heated conservatory open to the dwelling is.{' '}
          {parameters.conservatoryType === 'unheated'
            ? <>&apos;{tag.host_wall}&apos; is a sheltered wall where the conservatory adjoins it.</>
            : <>&apos;{tag.host_wall}&apos; stays an external wall.</>}
        </div>
      ) : null}
    </>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="element-label" style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{label}</div>
      <div className="element-input">{children}</div>
    </>
  );
}
