// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Directions table of a Context Shading object: one row per part, From and To in degrees and
 * the distance in metres. A drawn polygon's rows are read-only (the drawing owns them). A line, and
 * a row with no coordinates, have editable cells, committed on blur or Enter; an edit the object can't
 * take is refused: the cell shows its error state and the reason shows under the table. Hovering a row marks its part on the plan, and the reverse.
 */
import { useState } from 'react';
import { StandardInput } from '../StandardInput';
import { FieldValidationIndicator, ValidationPill } from '../ValidationIndicator';
import type { DirectionField } from '../../lib/contextShadingDrawing';

export type DirectionRow = { from: number; to: number; distance: number; /** Stable across edits: the part's index and face (a face can be seen in two parts), or the row's start. */ key: string | number };
export type DirectionIssue = { message: string; variant: 'error' | 'warning' } | null;
type Refusal = { cell: string; reason: string };

const NAMES: Record<DirectionField, string> = { start_angle: 'From', end_angle: 'To', distance: 'Distance' };

/** The typed text as a value the cell takes, or the reason it can't be one. */
function parseCell(field: DirectionField, text: string): { value: number } | { reason: string } {
  const name = NAMES[field];
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { reason: `${name} must be a number.` };
  const value = Number(text);
  if (field === 'distance') return { value };
  if (value < 0 || value > 360) return { reason: `${name} must be between 0 and 360 degrees.` };
  if (!Number.isInteger(value)) return { reason: `${name} must be a whole number of degrees.` };
  return { value };
}

/** A cell commits only on blur or Enter; a refused one keeps the typed text and shows its error state. */
function DirectionCell({ value, integer, label, invalid, onCommit, onType }: {
  value: number;
  integer: boolean;
  label: string;
  invalid: boolean;
  /** The typed text, parsed: null when accepted, otherwise why not. */
  onCommit: (text: string) => string | null;
  onType: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // The typed text shows while the user is in the cell or its refusal stands; a stale one is never shown.
  const typed = draft !== null && (focused || invalid) ? draft : null;
  return (
    <div className="context-shading-directions-cell">
      <StandardInput
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={typed ?? (integer ? String(value) : value.toFixed(2))}
        onChange={(event) => { setDraft(event.target.value); onType(); }}
        onFocus={() => { setFocused(true); if (!invalid) setDraft(null); }}
        onBlur={() => {
          setFocused(false);
          if (draft === null) return;
          if (draft.trim() === '') { setDraft(null); return; }
          if (onCommit(draft.trim()) === null) setDraft(null);
        }}
        aria-label={label}
        aria-invalid={invalid || undefined}
        variant="ghost"
        size="sm"
      />
    </div>
  );
}

export function ContextShadingDirections({ rows, editable, issues, hoveredIndex, onHover, onEdit }: {
  rows: readonly DirectionRow[];
  editable: boolean;
  issues: readonly DirectionIssue[];
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
  /** Returns null when the edit is taken, otherwise why it was refused (nothing changed). */
  onEdit?: (index: number, field: DirectionField, value: number) => string | null;
}) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="context-shading-directions-wrap">
      <div className="context-shading-directions" data-testid="context-shading-directions">
        <span className="context-shading-directions-head">From (°)</span>
        <span className="context-shading-directions-head">To (°)</span>
        <span className="context-shading-directions-head">Distance (m)</span>
        <span className="context-shading-directions-head" />
        {rows.map((row, index) => {
          const issue = issues[index];
          const cells: [DirectionField, number, boolean][] = [
            ['start_angle', row.from, true],
            ['end_angle', row.to, true],
            ['distance', row.distance, false],
          ];
          return (
            <div
              key={row.key}
              className={`context-shading-directions-row${hoveredIndex === index ? ' is-hovered' : ''}`}
              data-testid={`context-shading-direction-${index}`}
              onMouseEnter={() => onHover(index)}
              onMouseLeave={() => onHover(null)}
            >
              {cells.map(([field, value, integer]) => {
                const cell = `${row.key}:${field}`;
                return editable && onEdit
                  ? (
                    <DirectionCell
                      key={field}
                      value={value}
                      integer={integer}
                      label={`${NAMES[field]}, direction ${index + 1}`}
                      invalid={refusal?.cell === cell}
                      onType={() => setRefusal(null)}
                      onCommit={(text) => {
                        const parsed = parseCell(field, text);
                        const reason = 'reason' in parsed ? parsed.reason : onEdit(index, field, parsed.value);
                        setRefusal(reason === null ? null : { cell, reason });
                        return reason;
                      }}
                    />
                  )
                  : <span key={field} className="context-shading-directions-fixed">{integer ? value : value.toFixed(2)}</span>;
              })}
              <span className="context-shading-directions-flag">
                <FieldValidationIndicator hasIssue={!!issue} issue={issue?.message} variant={issue?.variant} />
              </span>
            </div>
          );
        })}
      </div>
      {refusal && <div role="alert"><ValidationPill message={refusal.reason} variant="error" /></div>}
    </div>
  );
}
