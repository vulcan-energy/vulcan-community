// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../geometry/types';
import {
  buildAddWindowOpeningPatch,
  buildSingleOpeningPatch,
  classifyWindowOpenings,
  windowOpeningsUseTable,
  type WindowOpeningField,
  type WindowOpeningPatch,
  type WindowOpeningRow,
  type WindowOpeningSource,
} from '../../lib/windowOpenings';
import { WINDOW_SECURITY_RISK_HELPER } from '../../lib/schemaDescriptionOverrides';
import { StandardDropdown } from '../StandardDropdown';
import { StandardInput } from '../StandardInput';
import { Tooltip } from '../Tooltip';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { readExtraJsonRecord } from './formPrimitives';

const PART_FIELDS: readonly { key: WindowOpeningField; label: string; unit: string }[] = [
  { key: 'mid_height', label: 'Mid height', unit: 'm' },
  { key: 'free_area_height', label: 'Free area height', unit: 'm' },
  { key: 'max_window_open_area', label: 'Open area', unit: 'm²' },
];
const FULL_ROW = { gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } as const;

const partValue = (part: unknown, key: WindowOpeningField): number | undefined => {
  const value = readExtraJsonRecord(part)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/**
 * a8/a9 openings beyond the first, in the main form: one row of inputs per part, and the button that adds one.
 * One opening stays in the three main-form inputs above; removing down to one part writes it back there.
 */
export function WindowOpeningParts({ source, commit }: Readonly<{
  source: WindowOpeningSource;
  commit: (patch: WindowOpeningPatch) => void;
}>) {
  const openings = classifyWindowOpenings(source);
  // A list this HEM version cannot read is repaired in Advanced Fields ("Convert to a single opening").
  if (openings.kind === 'repair' && openings.reason !== 'incomplete_parts') return null;
  const extra = readExtraJsonRecord(source.extra_json);
  const parts = windowOpeningsUseTable(source) ? extra.window_part_list as readonly unknown[] : null;
  const writeParts = (next: readonly unknown[]) => commit(next.length === 1
    ? buildSingleOpeningPatch(source, readExtraJsonRecord(next[0]) as WindowOpeningRow)
    : { extra_json: { ...extra, window_part_list: next } });
  return <>
    {parts?.map((part, index) => (
      // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- window parts are positional and carry no id.
      <div key={index} style={{ display: 'contents' }}>
        <div style={FULL_ROW}>
          <span className="element-label" style={{ fontWeight: 600 }}>Opening {index + 1}</span>
          <button type="button" className="btn btn-small btn-secondary" aria-label={`Remove opening ${index + 1}`}
            onClick={() => writeParts(parts.filter((_, i) => i !== index))}>Remove</button>
        </div>
        {PART_FIELDS.map(({ key, label, unit }) => {
          const value = partValue(part, key);
          const missing = value === undefined || (key === 'mid_height' && value <= 0);
          const id = `window-opening-${index}-${key}`;
          return <div key={key} style={{ display: 'contents' }}>
            <label className="element-label" htmlFor={id}>{label}</label>
            <div className="element-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StandardInput id={id} key={String(value ?? '')} type="text" inputMode="decimal" unit={unit}
                variant="ghost" size="md" className="flex-1" defaultValue={value ?? ''}
                aria-invalid={missing || undefined}
                onBlur={(event) => {
                  const text = event.target.value.trim();
                  const next = text === '' ? undefined : Number(text);
                  if (next === value || (next !== undefined && !Number.isFinite(next))) return;
                  writeParts(parts.map((entry, i) => {
                    if (i !== index) return entry;
                    const row = { ...readExtraJsonRecord(entry) };
                    if (next === undefined) delete row[key];
                    else row[key] = next;
                    return row;
                  }));
                }} />
              <FieldValidationIndicator hasIssue={missing} issue={missing ? `Enter the ${label.toLowerCase()} of opening ${index + 1}.` : undefined} />
            </div>
          </div>;
        })}
      </div>
    ))}
    <div style={FULL_ROW}>
      <button type="button" className="btn btn-small btn-secondary"
        onClick={() => commit(parts ? { extra_json: { ...extra, window_part_list: [...parts, {}] } } : buildAddWindowOpeningPatch(source))}>
        Add openable part
      </button>
    </div>
  </>;
}

const SECURITY_RISK_OPTIONS = [
  { value: 'true', label: 'Yes · cannot be left open at night' },
  { value: 'false', label: 'No · can be left open at night' },
];

/** The window's `security_risk`, as stored: the store keeps the storey default until the user picks one. */
export function SecurityRiskField({ element, fieldRef, commit }: Readonly<{
  element: Element;
  fieldRef: (node: HTMLDivElement | null) => void;
  commit: (extraJson: Record<string, unknown>) => void;
}>) {
  const extra = readExtraJsonRecord(element.extra_json);
  const stored = typeof extra.security_risk === 'boolean' ? String(extra.security_risk) : '';
  return <>
    <Tooltip content={WINDOW_SECURITY_RISK_HELPER} position="right" maxWidth={350}>
      <label className="element-label" htmlFor="window-security-risk" style={{ fontWeight: 500 }}>Security risk</label>
    </Tooltip>
    <div className="element-input" ref={fieldRef}>
      <StandardDropdown id="window-security-risk" value={stored} options={SECURITY_RISK_OPTIONS} placeholder="Choose"
        variant="ghost" size="md"
        onChange={(value) => { if (value) commit({ ...extra, security_risk: value === 'true' }); }} />
    </div>
  </>;
}
