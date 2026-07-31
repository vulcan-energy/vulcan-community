// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import type { ResolvedFieldPresentation } from '../lib/fieldPresentation';
import { formatSchemaInfoForTooltip } from '../utils/schemaTooltipHelpers';
import { Tooltip } from './Tooltip';

interface ResolvedFieldLabelProps {
  presentation: ResolvedFieldPresentation;
  useFHSSchema: boolean;
}

/** Label and tooltip rendered from the same presentation used by the unit adornment. */
export function ResolvedFieldLabel({
  presentation,
  useFHSSchema,
}: ResolvedFieldLabelProps): React.ReactElement {
  const label = (
    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
      {presentation.label}
    </span>
  );
  if (!presentation.tooltipInfo) return label;
  return (
    <Tooltip
      content={formatSchemaInfoForTooltip(presentation.tooltipInfo)}
      useFHSSchema={useFHSSchema}
      position="right"
      maxWidth={350}
    >
      {label}
    </Tooltip>
  );
}
