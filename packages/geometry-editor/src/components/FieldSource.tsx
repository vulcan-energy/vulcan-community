// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { ResetFieldButton } from './ResetFieldButton';
import './FieldSource.css';

/**
 * Where a value comes from, shown the same way in every editor:
 * - set by the drawing or another input: a quiet note ("from the drawing", "from Wall (S)")
 *   whose link goes to the source;
 * - default: a grey placeholder and the note "default", linking to the Defaults tab;
 * - entered by you: white text, plus one "↺ Use …" control only when there is a value to go back to.
 * A value HEM does not let you set reads as text (`Readout`), not as a dead input box.
 */

// ponytail: the Defaults tab is reached through any key its section owns; phase 3 renames the tab.
const DEFAULTS_TAB_FIELD = 'DefaultAssembly';

/** Opens Global Settings on the Defaults tab (the host listens for this event). */
// eslint-disable-next-line react-refresh/only-export-components -- event helper shared by the source notes.
export function openDefaultsTab(): void {
  window.dispatchEvent(new CustomEvent('open-global-settings', { detail: { field: DEFAULTS_TAB_FIELD } }));
}

/** "from <link>" style note. With `onGo`, the link part is a button that goes to the source. */
export function SourceNote({
  children,
  link,
  onGo,
  title,
}: {
  children?: React.ReactNode;
  link?: React.ReactNode;
  onGo?: () => void;
  title?: string;
}) {
  return (
    <span className="field-source-note" title={onGo ? undefined : title}>
      {children}
      {children && link ? ' ' : null}
      {link && onGo ? (
        <button type="button" className="field-source-note__link" onClick={onGo} title={title}>
          {link}
        </button>
      ) : (
        link
      )}
    </span>
  );
}

/** The "default" note, linking to where the property's defaults are set. */
export function DefaultNote() {
  return <SourceNote link="default" onGo={openDefaultsTab} title="Open the model defaults" />;
}

/** Label on the left, its source on the right (wraps under the label when narrow). */
export function FieldLabelRow({ label, source }: { label: React.ReactNode; source?: React.ReactNode }) {
  if (!source) return <>{label}</>;
  return (
    <div className="field-label-row">
      {label}
      <span className="field-label-row__source">{source}</span>
    </div>
  );
}

/** A value HEM does not let you set. Plain text, so it can be selected and copied. */
export function Readout({ value, unit, label }: { value: string | number | null | undefined; unit?: string; label: string }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <output className="field-readout" aria-label={label}>
      <span>{empty ? '—' : value}</span>
      {!empty && unit ? <span className="field-readout__unit">{unit}</span> : null}
    </output>
  );
}

/** Rounds for display only: at most three decimals, no trailing zeros. */
// eslint-disable-next-line react-refresh/only-export-components -- display helper shared by the source notes.
export function formatSourceValue(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * Source for a value that is normally derived but can be overridden: the note while the
 * value follows the source, "↺ <useLabel>: X" once it differs, nothing when nothing can be derived
 * (an incomplete drawing).
 */
export function DerivedSource({
  derived,
  current,
  note,
  onUse,
  useLabel = 'Use the drawing',
  unit,
  fieldLabel,
  ariaLabel,
  overridden,
  tolerance = 0.005,
}: {
  derived: number | null | undefined;
  current: number | '' | null | undefined;
  note: React.ReactNode;
  onUse: (derived: number) => void;
  useLabel?: string;
  unit?: string;
  /** Names the field for screen readers; the control sits in that field's label row. */
  fieldLabel?: string;
  ariaLabel?: string;
  /** An authored marker, when the caller has one: an authored value equal to the source is still yours. */
  overridden?: boolean;
  tolerance?: number;
}) {
  if (derived === null || derived === undefined || !Number.isFinite(derived)) return null;
  if (!(overridden ?? isOverridden(derived, current, tolerance))) return <>{note}</>;
  const shown = `${formatSourceValue(derived)}${unit ? ` ${unit}` : ''}`;
  return (
    <ResetFieldButton
      align="note"
      label={`${useLabel}: ${shown}`}
      title={`${useLabel}: ${shown}`}
      ariaLabel={ariaLabel ?? (fieldLabel ? `${fieldLabel}: ${useLabel.toLowerCase()}, ${shown}` : `${useLabel}: ${shown}`)}
      onClick={() => onUse(derived)}
    />
  );
}

/** True when a stated number differs from its source. Blank follows the source. */
// eslint-disable-next-line react-refresh/only-export-components -- shared predicate for the source class.
export function isOverridden(derived: number | null | undefined, current: number | '' | null | undefined, tolerance = 0.005): boolean {
  if (derived === null || derived === undefined || !Number.isFinite(derived)) return false;
  return typeof current === 'number' && Number.isFinite(current) && Math.abs(current - derived) > tolerance;
}

/** "from Wall (S)": the value comes from the host element (`parent_element` holds its name); the link selects it. */
export function ParentSourceNote({
  parentName,
  ctx,
}: {
  parentName: string;
  ctx: {
    elementsById: Readonly<Record<string, { id: string; name?: string }>>;
    setSelection: (selection: { type: 'element'; id: string }) => void;
  };
}) {
  const parent = Object.values(ctx.elementsById).find((element) => element.name === parentName);
  return (
    <SourceNote
      link={parentName}
      onGo={parent ? () => ctx.setSelection({ type: 'element', id: parent.id }) : undefined}
      title={`Select ${parentName}`}
    >
      from
    </SourceNote>
  );
}
