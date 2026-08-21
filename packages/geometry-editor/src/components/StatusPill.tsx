// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import './StatusPill.css';

export type StatusPillType =
  | 'custom'
  | 'calculated'
  | 'default-used'
  | 'no-default-schema';

/** Selects a colour set independent of `type`, from the shared `--status-*` tokens
 *  (which themselves alias `--validation-*` / `--success-*` / `--error-*`). Used by
 *  callers — e.g. the SAP Calculator's validation-summary chips — that carry a tick,
 *  a count, or a dash rather than one of the four provenance `type`s above. */
export type StatusPillTone = 'success' | 'error' | 'warning' | 'neutral';

interface StatusPillProps {
  /** Optional so a caller can drive colouring purely from `tone` (e.g. a fixed-size
   *  SAP Calculator chip with no provenance meaning) without also claiming one of the
   *  four provenance `type`s. When omitted, no `status-pill-<type>` class is emitted
   *  and `getPillContent`'s default branch renders no fallback word — only
   *  `labelOverride`, or nothing. Every existing caller passes `type` and is
   *  unaffected. */
  type?: StatusPillType;
  className?: string;
  labelOverride?: string;
  /** Overrides `type`'s colouring with one of the shared status tones. `type` still
   *  selects the default label text (see `getPillContent`) unless `labelOverride` is
   *  also given. Omit to keep today's `type`-driven colouring. */
  tone?: StatusPillTone;
  /** `'fixed'` renders the pill at a constant height/min-width with centred content,
   *  so a tick, a count, or a dash all render at one fixed size and shape. Omit for
   *  today's auto-sized rendering. */
  size?: 'fixed';
  /** Set to `false` to opt out of the pill's default 8px left margin — e.g. when it
   *  is not rendered inline immediately after a label. Defaults to `true`, matching
   *  every existing caller's rendering. */
  inline?: boolean;
  /** Accessible name for the chip (e.g. the classification reason behind a fixed-size,
   *  type-less tone chip). Omit to leave the span unlabelled, as today. */
  ariaLabel?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  type,
  className = '',
  labelOverride,
  tone,
  size,
  inline = true,
  ariaLabel,
}) => {
  const getPillContent = () => {
    if (labelOverride && labelOverride.trim() !== '') {
      return labelOverride;
    }
    switch (type) {
      case 'custom':
        return 'Custom';
      case 'calculated':
        return 'Calculated';
      case 'default-used':
        return 'Default';
      case 'no-default-schema':
        return 'Schema';
      default:
        return '';
    }
  };

  const classes = [
    'status-pill',
    type ? `status-pill-${type}` : null,
    tone ? `status-pill-tone-${tone}` : null,
    size === 'fixed' ? 'status-pill-fixed' : null,
    inline ? 'status-pill-inline' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} aria-label={ariaLabel}>
      {getPillContent()}
    </span>
  );
};
