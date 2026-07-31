// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useId } from 'react';
import './StandardControlShell.css';

export type StandardControlSize = 'sm' | 'md' | 'lg';
export type StandardControlVariant = 'default' | 'ghost';

interface StandardControlShellProps {
  unit?: string;
  size: StandardControlSize;
  variant: StandardControlVariant;
  disabled?: boolean;
  readOnly?: boolean;
  error?: boolean;
  describedBy?: string;
  children: (describedBy: string | undefined) => React.ReactElement;
}

function joinIds(...ids: Array<string | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/** Shared visual and accessibility boundary for controls with trailing units. */
export function StandardControlShell({
  unit,
  size,
  variant,
  disabled,
  readOnly,
  error,
  describedBy,
  children,
}: StandardControlShellProps): React.ReactElement {
  const generatedId = useId();
  const normalizedUnit = unit?.trim();

  // Preserve the existing direct-control DOM when no adornment is requested.
  if (!normalizedUnit) return children(describedBy);

  const unitDescriptionId = `${generatedId}-unit`;
  const controlDescribedBy = joinIds(describedBy, unitDescriptionId);

  return (
    <div
      className={[
        'standard-control-shell',
        `standard-control-shell-${size}`,
        `standard-control-shell-${variant}`,
        disabled ? 'standard-control-shell-disabled' : '',
        readOnly ? 'standard-control-shell-readonly' : '',
        error ? 'standard-control-shell-error' : '',
      ].filter(Boolean).join(' ')}
    >
      {children(controlDescribedBy)}
      <span className="standard-control-unit" aria-hidden="true">
        {normalizedUnit}
      </span>
      <span id={unitDescriptionId} className="standard-control-unit-description">
        Unit: {normalizedUnit}
      </span>
    </div>
  );
}
