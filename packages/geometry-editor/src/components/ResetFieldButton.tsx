// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';

/**
 * How the button is positioned vertically relative to the control it acts on. Required, so
 * adding a reset button forces a decision rather than inheriting whichever default happened
 * to look right in the first row it was pasted into.
 *
 * - `'input-row'` - the row contains a `StandardInput`/`StandardDropdown` that renders its
 *   own `label` *above* the control, so the button must clear that label to sit level with
 *   the input.
 * - `'inline'` - nothing in the row renders a label above the control, either because the
 *   label is a sibling emitted before the row (`renderFieldLabel`, `.element-input`) or
 *   because the row sets its own `alignItems`. The button takes no vertical offset; adding
 *   one here pushes it *below* the input.
 */
export type ResetFieldButtonAlign = 'input-row' | 'inline';

/**
 * Anchored from the *top* and pushed down by the label's height, deliberately. The obvious
 * alternative - `alignSelf: 'flex-end'` - tracks the bottom of the tallest item in the row,
 * which lands on the input only while nothing extends below it. `StandardInput` renders
 * helper and error text *inside* its own container, directly under the input, so a field
 * with `helperText` grows and drags a bottom-anchored button below the input it belongs to.
 * Top-anchoring is immune to that: the label height above the input does not change.
 *
 * Deliberately not exported: `align="input-row"` is the only way to ask for this offset, so
 * it stays defined once and no call site can hand-roll a variant that drifts.
 */
const RESET_BUTTON_ALIGNED_WITH_INPUT_STYLE: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 'calc(1.5rem + var(--spacing-xs) + var(--spacing-xs))',
};

export function ResetFieldButton({
  onClick,
  align,
  title = 'Reset to default',
  ariaLabel = 'Reset to default',
  label,
  style,
  disabled,
}: {
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  align: ResetFieldButtonAlign;
  title?: string;
  ariaLabel?: string;
  label?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn btn-ghost btn-sm element-editor-input-action"
      style={{
        flexShrink: 0,
        opacity: disabled ? 0.45 : undefined,
        cursor: disabled ? 'not-allowed' : undefined,
        ...(align === 'input-row' ? RESET_BUTTON_ALIGNED_WITH_INPUT_STYLE : null),
        ...style,
      }}
      title={title}
      aria-label={ariaLabel}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginRight: '4px' }}>
        <polyline points="23,4 23,10 17,10" stroke="currentColor" strokeWidth="2" />
        <polyline points="1,20 1,14 7,14" stroke="currentColor" strokeWidth="2" />
        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" />
      </svg>
      {label ?? 'Reset to default'}
    </button>
  );
}
