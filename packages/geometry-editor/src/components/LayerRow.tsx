// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { DraftSafeNumberInput } from './DraftSafeNumberInput';
import { ResetFieldButton } from './ResetFieldButton';
import { layerNumberInputStyle } from './layerRowStyle';
import './ElementCreator.css';

/** Reordering by drag: the row's handle and drop target. */
export type LayerRowDrag = Readonly<{
  dragging: boolean;
  /** Where a dragged layer would land, drawn as a line on this row. */
  insertLine?: 'above' | 'below';
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}>;

/** The thickness and R columns' width, shared by the rows and the header over them. */
const THICKNESS_WIDTH = 56;
const R_WIDTH = 36;
const quiet: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)' };

/**
 * One layer of a build-up, inside to outside: a drag handle, the layer's name (`LayerRowName`),
 * its thickness in mm and a quiet R. The one row for every layer editor (an element's layers and
 * an existing wall's). A click on the name opens the row; what it shows open goes in `details`.
 */
export function LayerRow({ label, children, thickness, r, onReset, active, drag, actions, before, details }: {
  /** The row's name for its controls ("Layer 2"). */
  label: string;
  /** The row's name (`LayerRowName`). */
  children: React.ReactNode;
  /** No thickness: the material says it (a cavity's gap). */
  thickness?: Readonly<{ valueMm: number | ''; placeholder?: string; onChange: (mm: number | undefined) => void }>;
  /** The layer's thermal resistance (m²·K/W), shown quietly. */
  r?: number;
  /** An edited row: ↺ puts it back. */
  onReset?: () => void;
  /** The row open for editing, highlighted like an edited one. */
  active?: boolean;
  drag?: LayerRowDrag;
  actions?: React.ReactNode;
  before?: React.ReactNode;
  details?: React.ReactNode;
}) {
  return (
    <div
      data-layer-row={label}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      style={{
        padding: '4px 8px',
        borderTop: '1px solid var(--border-subtle)',
        background: onReset || active ? 'var(--row-highlight-bg)' : undefined,
        opacity: drag?.dragging ? 0.72 : 1,
        boxShadow: drag?.insertLine === 'above'
          ? 'inset 0 3px 0 0 var(--accent-primary)'
          : drag?.insertLine === 'below' ? 'inset 0 -3px 0 0 var(--accent-primary)' : undefined,
        transition: 'opacity 0.12s, box-shadow 0.12s',
      }}
    >
      {before}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
        {drag && (
          <span
            draggable
            aria-grabbed={drag.dragging}
            title="Drag to reorder"
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
            style={{
              cursor: drag.dragging ? 'grabbing' : 'grab', flexShrink: 0, userSelect: 'none', padding: '2px',
              color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1,
            }}
          >
            ≡
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
          {children}
          {onReset && <ResetFieldButton align="note" label="" title="Use default" ariaLabel={`${label}: use default`} onClick={onReset} />}
        </div>
        {thickness && (
          <DraftSafeNumberInput
            aria-label={`${label} thickness (mm)`}
            className="layer-row__thickness"
            value={thickness.valueMm}
            placeholder={thickness.placeholder}
            onChange={(event) => {
              const text = event.target.value.trim();
              const mm = Number(text);
              if (text === '') thickness.onChange(undefined);
              else if (Number.isFinite(mm) && mm > 0) thickness.onChange(mm);
            }}
            style={{ ...layerNumberInputStyle, width: THICKNESS_WIDTH, height: 26, padding: '2px 6px', flexShrink: 0, textAlign: 'right' }}
          />
        )}
        <span style={{ ...quiet, width: R_WIDTH, flexShrink: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} title="R (m²·K/W)">
          {r === undefined ? '' : r.toFixed(2)}
        </span>
        {actions}
      </div>
      {details}
    </div>
  );
}

/** A row's name: a click opens the row (its material and details) in place. */
export function LayerRowName({ name, open, onToggle, italic }: { name: string; open: boolean; onToggle: () => void; italic?: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      style={{
        flex: '0 1 auto', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '4px 0', color: 'inherit',
        fontSize: 12, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontStyle: italic ? 'italic' : undefined,
      }}
    >
      {name}
    </button>
  );
}

/** The `Inside` or `Outside` end of the rows, with `+ layer` where a layer can go in there. */
export function LayerEndRow({ label, onAdd }: { label: 'Inside' | 'Outside'; onAdd?: () => void }) {
  return (
    <div style={{ ...quiet, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', ...(label === 'Outside' ? { borderTop: '1px solid var(--border-subtle)' } : {}) }}>
      <span>{label}</span>
      {onAdd && (
        <button type="button" className="field-source-note__link" aria-label={`Add a layer at the ${label.toLowerCase()}`} onClick={onAdd}>
          + layer
        </button>
      )}
    </div>
  );
}

/** The rows' frame: the mm and R column heads, then the rows between their Inside and Outside ends. */
export function LayerRows({ children }: { children: React.ReactNode }) {
  return (
    <div data-layer-rows style={{ borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
      <div aria-hidden style={{ ...quiet, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '4px 8px 0' }}>
        <span style={{ width: THICKNESS_WIDTH, textAlign: 'right' }}>mm</span>
        <span style={{ width: R_WIDTH, textAlign: 'right' }}>R</span>
      </div>
      {children}
    </div>
  );
}
