// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { StandardInput } from './StandardInput';
import { ResetFieldButton } from './ResetFieldButton';
import { parseDimensionOverride } from '../lib/globalSettingsValidation';

export type DerivedNumberFieldProps = {
  /** Field label content, typically `complianceFieldLabel(...)`. */
  label: React.ReactNode;
  /** Geometry-derived value; `0` (or negative) means nothing could be derived. */
  derivedValue: number;
  /** Stored override; `undefined` means the field is following the derived value. */
  manualValue: number | undefined;
  /** Called with the next override, or `undefined` to return the field to auto. */
  onChange: (next: number | undefined) => void;
  /** Extra label content (evidence pills, validation indicators). */
  labelAccessory?: React.ReactNode;
  placeholderWhenUnavailable?: string;
  helperTextWhenDerived?: React.ReactNode;
  helperTextWhenUnavailable?: React.ReactNode;
  resetTitle: string;
  resetAriaLabel: string;
  step?: string;
  /** Persistent display-only unit; never included in the input value or change event. */
  unit?: string;
  /** Below this difference an entered value counts as "same as derived" and clears the override. */
  matchTolerance?: number;
  autoTagMarginLeft?: number;
};

/**
 * A compliance number that is normally derived from the geometry but can be overridden.
 *
 * Ground floor area and building length/width each hand-rolled this: the same value fallback,
 * the same "typing the derived value returns the field to auto" rule, the same
 * `(manual override)` / `(auto)` tag, and the same conditional reset button. Roughly 60 lines
 * apiece, free to drift on any one of those rules.
 *
 * Parsing is delegated to `parseDimensionOverride`, so the policy that anything non-finite or
 * negative returns the field to auto - rather than being clamped or stored as 0 - stays in one
 * place. That parse is the only real guard: `min="0"` and `step` are carried through from the
 * three call sites to keep the rendered DOM identical, but `StandardInput` turns `type="number"`
 * into a draft-safe `type="text"` with `inputmode="decimal"`, and both attributes are inert on a
 * text input. Do not rely on them to reject anything.
 *
 * The two ventilation-zone heights are deliberately not built on this. They carry an extra
 * mismatch warning block and different parse/tolerance rules, so they want their own follow-up
 * rather than more props here.
 */
export function DerivedNumberField({
  label,
  derivedValue,
  manualValue,
  onChange,
  labelAccessory,
  placeholderWhenUnavailable = '',
  helperTextWhenDerived,
  helperTextWhenUnavailable,
  resetTitle,
  resetAriaLabel,
  step = '0.01',
  unit,
  matchTolerance = 1e-4,
  autoTagMarginLeft,
}: DerivedNumberFieldProps) {
  const hasDerived = derivedValue > 0;
  const isManual = manualValue !== undefined;

  const handleChange = (raw: string) => {
    if (raw === '') {
      onChange(undefined);
      return;
    }
    const parsed = parseDimensionOverride(raw);
    if (parsed === undefined) {
      onChange(undefined);
      return;
    }
    // Matching the derived value is the same as not overriding it. This also stops Reset -
    // which writes the derived value into the input - from immediately re-flagging as manual.
    onChange(hasDerived && Math.abs(parsed - derivedValue) < matchTolerance ? undefined : parsed);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-xs)' }}>
      <StandardInput
        type="number"
        label={
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {label}
            {hasDerived && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  ...(autoTagMarginLeft === undefined ? {} : { marginLeft: autoTagMarginLeft }),
                  color: isManual ? 'var(--text-warning)' : 'var(--text-muted)',
                }}
              >
                {isManual ? '(manual override)' : '(auto)'}
              </span>
            )}
            {labelAccessory}
          </div>
        }
        value={isManual ? String(manualValue) : hasDerived ? String(derivedValue) : ''}
        unit={unit}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={hasDerived ? String(derivedValue) : placeholderWhenUnavailable}
        min="0"
        step={step}
        variant="ghost"
        size="md"
        helperText={hasDerived ? helperTextWhenDerived : helperTextWhenUnavailable}
      />
      {isManual && hasDerived && (
        <ResetFieldButton
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(undefined);
          }}
          title={resetTitle}
          ariaLabel={resetAriaLabel}
          align="input-row"
        />
      )}
    </div>
  );
}
