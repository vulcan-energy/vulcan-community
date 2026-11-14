// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementDraft, ElementType } from '../types';

/** Elements a missing-element CTA creates in one history step (Part F vents, auto-ducts). */
export interface BatchPlan {
  drafts: ElementDraft[];
  /** Display string e.g. "3 background vents (200 cm² total)". */
  summary: string;
}

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
   * single placeholder): Part F vent shortfalls and missing MVHR ductwork.
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

/**
 * Issues a host adds for a task the user chose to run (e.g. a private calculation). They show as
 * errors on their element or space label. `blockingWarnings` are existing warning messages the
 * task cannot run past: those show as errors, with the same wording.
 */
export type HostValidationFindings = Readonly<{
  elements?: Readonly<Record<string, readonly ValidationIssue[]>>;
  spaceLabels?: Readonly<Record<string, readonly ValidationIssue[]>>;
  blockingWarnings?: readonly string[];
}>;

/** Moves the host's blocking warnings into `issues` and adds its own issues. */
export function withHostFindings(
  issues: ValidationIssue[],
  warnings: ValidationIssue[],
  own: readonly ValidationIssue[] | undefined,
  blockingWarnings: readonly string[] | undefined,
): { issues: ValidationIssue[]; warnings: ValidationIssue[] } {
  if (!own?.length && !blockingWarnings?.length) return { issues, warnings };
  const blocking = new Set(blockingWarnings);
  return {
    issues: [...issues, ...warnings.filter((w) => blocking.has(w.message)), ...(own ?? [])],
    warnings: warnings.filter((w) => !blocking.has(w.message)),
  };
}

export function issueMessages(items: ValidationIssue[]): string[] {
  return items.map((i) => i.message);
}
