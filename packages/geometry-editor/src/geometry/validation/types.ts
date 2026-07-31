// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType } from '../types';
import type { BatchPlan } from './partF';

export interface MissingElement {
  type: ElementType;
  zoneId?: string;
  requiredBy: 'schema' | 'fhs' | 'compliance';
  path: string;
  message: string;
  /** Short label shown on the Elements panel pill (e.g. “Space heating”, “Other outlet”). */
  pillQualifier?: string;
  /** When set, links this row to a zone field in the inspector (where supported). */
  fieldKey?: string;
  /**
   * When present, clicking the pill creates the listed elements in one batch (instead of a
   * single placeholder). Used for Part F shortfalls where the user needs multiple vents
   * with specific sizes / parents to close the gap.
   */
  batchPlan?: BatchPlan;
}

export type ValidationSource = 'geometry' | 'schema' | 'fhs';

export interface ValidationIssue {
  message: string;
  fieldKey?: string;
  /** Space-label issue metadata for row-level UI display/focus. */
  spaceLabelId?: string;
  spaceLabelIds?: string[];
  source: ValidationSource;
}

export interface ValidationResult {
  hasIssues: boolean;
  issues: ValidationIssue[];
  hasWarnings: boolean;
  warnings: ValidationIssue[];
  hasMissingElements?: boolean;
  missingElements?: MissingElement[];
}

export function issueMessages(items: ValidationIssue[]): string[] {
  return items.map((i) => i.message);
}
