// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../geometry/types';
import { useKeyedState } from '../../hooks/useKeyedState';
import { CLOSE_SHADING_KINDS, closeShadingOptions, drawnCloseShading, type CloseShadingKind } from '../../lib/windowOpenings';
import { StandardDropdown } from '../StandardDropdown';

/** The add buttons: a side fin adds both fins, as a fin is surveyed per side. */
const ADD_GROUPS: readonly { label: string; kinds: readonly CloseShadingKind[] }[] = [
  { label: 'Overhang', kinds: ['overhang'] },
  { label: 'Side fin', kinds: ['side_fin_left', 'side_fin_right'] },
  { label: 'Balcony front', kinds: ['obstacle'] },
];
const NO_KINDS: readonly CloseShadingKind[] = [];

/**
 * A window's close-shading categories on an existing-building model, stated on the window.
 * "None" is the normal case; each kind is added when present ("+ Overhang · + Side fin ·
 * + Balcony front") and ✕ removes it in one undo step. A Window Shading feature drawn for the
 * window always shows its kind, with the drawing as the placeholder; what it is is the
 * assessor's choice. Rendered in the window's inspector and, for one kind, beside each drawn
 * feature.
 */
export function CloseShadingFields({ windowName, kinds, elementsById, updateElement }: Readonly<{
  windowName: string;
  kinds?: readonly CloseShadingKind[];
  elementsById: Record<string, Element>;
  updateElement: (id: string, updates: Partial<Element>) => void;
}>) {
  // Kinds added but not chosen yet: nothing is stated until a category is picked.
  const [added, setAdded] = useKeyedState<readonly CloseShadingKind[]>(windowName, NO_KINDS);
  const elements = Object.values(elementsById);
  const win = elements.find((element) => element?.type === 'BuildingElementTransparent' && element.name === windowName);
  if (!win) return null;
  const extra = win.extra_json ?? {};
  const write = (kind: CloseShadingKind, value: string | undefined) => {
    const next = { ...extra };
    if (value) next[kind] = value;
    else delete next[kind];
    updateElement(win.id, { extra_json: next });
  };
  const offered = CLOSE_SHADING_KINDS.flatMap((item) => {
    if (kinds && !kinds.includes(item.kind)) return [];
    const { feature, depth } = drawnCloseShading(elements, windowName, item.kind);
    const stated = typeof extra[item.kind] === 'string' ? extra[item.kind] as string : '';
    return [{ ...item, drawnFeature: !!feature, depth, stated }];
  });
  // One kind (beside a drawn feature) is that kind's field alone, always shown.
  const single = offered.length === 1;
  const shown = offered.filter((row) => single || row.stated || row.drawnFeature || added.includes(row.kind));
  const isShown = (kind: CloseShadingKind) => shown.some((row) => row.kind === kind);
  const remove = (kind: CloseShadingKind) => {
    setAdded((current) => current.filter((k) => k !== kind));
    if (offered.find((row) => row.kind === kind)?.stated) write(kind, undefined);
  };
  const addGroups = single ? [] : ADD_GROUPS.flatMap((group) => {
    const groupKinds = group.kinds.filter((kind) => offered.some((row) => row.kind === kind));
    return groupKinds.length > 0 && !groupKinds.every(isShown) ? [{ ...group, kinds: groupKinds }] : [];
  });
  if (single) {
    // Beside a drawn feature: the form's label and input columns, as before.
    const { kind, label, depth, stated } = shown[0]!;
    return <div style={{ display: 'contents' }}>
      <div className="element-label">{`Window ${label.toLowerCase()}`}</div>
      <div className="element-input" style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
        <StandardDropdown aria-label={`${windowName} ${label.toLowerCase()}`} value={stated}
          placeholder={shown[0]!.drawnFeature ? `Drawn${depth === undefined ? '' : ` ${depth} m`}: choose what it is` : 'None'}
          options={closeShadingOptions(kind, depth)} onChange={(value) => write(kind, value)} variant="ghost" size="md" />
        {stated && <button type="button" className="btn btn-ghost btn-sm element-editor-input-action" onClick={() => write(kind, undefined)}
          aria-label={`Clear the window ${label.toLowerCase()}`} title="Clear">✕</button>}
      </div>
    </div>;
  }
  const fields = shown.map(({ kind, label, depth, drawnFeature, stated }) => (
    <div key={kind} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <div className="element-label" style={{ margin: 0 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StandardDropdown aria-label={`${windowName} ${label.toLowerCase()}`} value={stated}
            placeholder={drawnFeature ? `Drawn${depth === undefined ? '' : ` ${depth} m`}: choose what it is` : 'Choose…'}
            options={closeShadingOptions(kind, depth)} onChange={(value) => write(kind, value)} variant="ghost" size="md" />
        </div>
        {(stated || !drawnFeature) && (
          <button type="button" className="btn btn-ghost btn-sm element-editor-input-action" onClick={() => remove(kind)}
            aria-label={`Remove the ${label.toLowerCase()}`} title={`Remove the ${label.toLowerCase()}`}>✕</button>
        )}
      </div>
      {drawnFeature && <div className="field-source-note">from the drawing</div>}
    </div>
  ));
  return (
    <div className="element-editor-section-spacer" data-close-shading style={{ display: 'grid', gap: 6 }}>
      <div className="element-label" style={{ margin: 0 }}>Shading close to the window</div>
      {shown.length === 0 && <div>None</div>}
      {addGroups.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {addGroups.map((group) => (
            <button key={group.label} type="button" className="btn btn-small btn-secondary" style={{ padding: '3px 8px', fontSize: 'var(--font-size-xs)' }}
              onClick={() => setAdded((current) => [...current, ...group.kinds.filter((kind) => !current.includes(kind))])}>
              + {group.label}
            </button>
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>{fields}</div>
      )}
    </div>
  );
}
