// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ValidationIssue, ValidationResult } from '../geometry/validation/types';
import type { BuildErrorItem, TargetValidation } from '../types/buildErrors';
import { issuePathSegments, resolveIssueTarget, type IssueTarget } from './issueTarget';

export type DisplayBuildError = {
  item: BuildErrorItem;
  location: string;
  field?: string;
  userMessage: string;
  pathSegments: string[];
};

const titleCaseToken = (token: string) =>
  token
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const pointerSegments = issuePathSegments;

const buildErrorLocation = (path?: string) => {
  const segments = pointerSegments(path);
  const zoneIdx = segments.indexOf('Zone');
  const elementIdx = segments.indexOf('BuildingElement');

  if (zoneIdx >= 0 && segments[zoneIdx + 1]) {
    const zone = segments[zoneIdx + 1];
    if (elementIdx >= 0 && segments[elementIdx + 1]) {
      return {
        location: `${zone} > ${segments[elementIdx + 1]}`,
        field: segments[elementIdx + 2],
      };
    }
    return {
      location: zone,
      field: segments[zoneIdx + 2],
    };
  }

  if (segments.length >= 2) {
    return {
      location: `${titleCaseToken(segments[0])} > ${titleCaseToken(segments[1])}`,
      field: segments[2],
    };
  }

  if (segments.length === 1) {
    return { location: titleCaseToken(segments[0]) };
  }

  return { location: 'Model' };
};

const compactPathLabel = (segments: string[]) => {
  if (segments.length === 0) return 'model';
  return segments.map(titleCaseToken).join(' > ');
};

const requiredFieldFromMessage = (message: string) => {
  const match = message.match(/^"([^"]+)" is a required property$/);
  return match?.[1] ? titleCaseToken(match[1]) : null;
};

const minimumFromMessage = (message: string) => {
  const match = message.match(/^(.+?) is less than the minimum of (.+)$/);
  return match?.[2]?.trim() || null;
};

const maximumFromMessage = (message: string) => {
  const match = message.match(/^(.+?) is greater than the maximum of (.+)$/);
  return match?.[2]?.trim() || null;
};

const unexpectedFieldsFromMessage = (message: string) => {
  const match = message.match(/were unexpected\)$/);
  if (!match) return null;
  const fields = [...message.matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []));
  if (fields.length === 0) return null;
  const shown = fields.slice(0, 5).map(titleCaseToken).join(', ');
  return fields.length > 5 ? `${shown}, and ${fields.length - 5} more` : shown;
};

/** JSON-schema errors carry the failing keyword; converter/source errors do not. */
const isSchemaKeywordError = (item: BuildErrorItem) => Boolean(item.keyword || item.schemaPath);

const formatBuildErrorForDisplay = (item: BuildErrorItem): DisplayBuildError => {
  const pathSegments = pointerSegments(item.path);
  const { location, field } = buildErrorLocation(item.path);
  const fieldLabel = field ? titleCaseToken(field) : undefined;
  const keyword = item.keyword || '';
  const requiredField = requiredFieldFromMessage(item.message);
  const minimum = minimumFromMessage(item.message);
  const maximum = maximumFromMessage(item.message);
  const unexpectedFields = unexpectedFieldsFromMessage(item.message);
  const explicitUserMessage = item.userMessage?.trim();

  let userMessage: string;
  if (explicitUserMessage) {
    userMessage = explicitUserMessage;
  } else if (
    location === 'Appliances' &&
    (item.message.includes('is not allowed for {}') || item.message.includes('has less than'))
  ) {
    userMessage = 'Add at least one appliance entry.';
  } else if (
    pathSegments[0] === 'HotWaterDemand' &&
    (item.message.includes('has less than') || keyword === 'minProperties')
  ) {
    userMessage = 'Add at least one hot water outlet.';
  } else if (
    pathSegments[0] === 'InfiltrationVentilation' &&
    pathSegments[1] === 'MechanicalVentilation' &&
    (item.message.includes("schemas listed in the 'oneOf' keyword") || keyword === 'oneOf' || keyword === 'anyOf')
  ) {
    userMessage = 'Add ventilation position details: height, orientation, and pitch.';
  } else if (requiredField || keyword === 'required') {
    userMessage = requiredField
      ? `Add ${requiredField}.`
      : 'Add the missing required field.';
  } else if (minimum || keyword === 'minimum' || keyword === 'exclusiveMinimum') {
    userMessage = `${fieldLabel || 'Value'} must be at least ${minimum || 'the allowed minimum'}.`;
  } else if (maximum || keyword === 'maximum' || keyword === 'exclusiveMaximum') {
    userMessage = `${fieldLabel || 'Value'} must be no more than ${maximum || 'the allowed maximum'}.`;
  } else if (item.message.includes('has less than') || keyword === 'minProperties') {
    userMessage = `Add at least one entry for ${compactPathLabel(pathSegments)}.`;
  } else if (item.message.includes("schemas listed in the 'oneOf' keyword") || keyword === 'oneOf' || keyword === 'anyOf') {
    userMessage = fieldLabel
      ? `${fieldLabel} does not match an allowed option.`
      : 'Choose a supported option for these settings.';
  } else if (unexpectedFields || keyword === 'unevaluatedProperties' || keyword === 'additionalProperties') {
    userMessage = unexpectedFields
      ? `Remove fields not allowed here: ${unexpectedFields}.`
      : 'Remove fields that are not allowed here.';
  } else if (keyword === 'const' || keyword === 'allOf' || item.message.includes('is not allowed for')) {
    userMessage = location === 'Appliances'
      ? 'Check the appliance entries against the selected schema.'
      : 'These settings conflict with the selected schema.';
  } else if (!isSchemaKeywordError(item)) {
    // Converter/source diagnostics are written for users; a generic "Check X" would hide them.
    userMessage = item.message;
  } else {
    userMessage = fieldLabel
      ? `Check ${fieldLabel}.`
      : 'Check this section.';
  }

  return { item, location, field, userMessage, pathSegments };
};

const isNoisyUnexpectedPropertiesError = (error: DisplayBuildError) =>
  error.item.keyword === 'unevaluatedProperties' ||
  error.item.keyword === 'additionalProperties' ||
  error.item.message.includes('Unevaluated properties are not allowed') ||
  error.item.message.includes('Additional properties are not allowed');

const filterDisplayBuildErrors = (errors: DisplayBuildError[]) => {
  const concreteErrorParents = new Set<string>();

  for (const error of errors) {
    if (isNoisyUnexpectedPropertiesError(error)) continue;
    if (error.pathSegments.length > 1) {
      concreteErrorParents.add(error.pathSegments.slice(0, -1).join('/'));
    }
  }

  return errors.filter((error) => {
    if (!isNoisyUnexpectedPropertiesError(error)) return true;
    return !concreteErrorParents.has(error.pathSegments.join('/'));
  });
};

export type DisplayBuildErrorRow = DisplayBuildError & { target: IssueTarget; derived: DisplayBuildError[] };

/**
 * Schema errors on an object that also has a converter/source error are usually its
 * consequence (the converter could not produce valid input), so they move under that
 * row's Details. Ownership comes from the path alone: no per-attribute rules.
 */
const collapseDerivedBuildErrors = (
  errors: DisplayBuildError[],
  resolve: (path?: string) => IssueTarget,
): DisplayBuildErrorRow[] => {
  const rows = errors.map((error) => ({ ...error, target: resolve(error.item.path), derived: [] as DisplayBuildError[] }));
  const sourceRowByOwner = new Map<string, DisplayBuildErrorRow>();
  for (const row of rows) {
    // Only zone elements and zone-level keys: a top-level section error (e.g. an unlinked
    // system or a defaulted cell) does not explain other errors in that section.
    if (!isSchemaKeywordError(row.item) && !row.item.severity && row.target.section === 'Zone' && !sourceRowByOwner.has(row.target.ownerKey)) {
      sourceRowByOwner.set(row.target.ownerKey, row);
    }
  }
  return rows.filter((row) => {
    const sourceRow = isSchemaKeywordError(row.item) ? sourceRowByOwner.get(row.target.ownerKey) : undefined;
    if (!sourceRow) return true;
    sourceRow.derived.push(row);
    return false;
  });
};

/** The rows the build-error list shows: user wording, noise dropped, consequences folded. */
export const displayBuildErrorRows = (
  items: readonly BuildErrorItem[],
  resolve: (path?: string) => IssueTarget,
): DisplayBuildErrorRow[] => collapseDerivedBuildErrors(filterDisplayBuildErrors(items.map(formatBuildErrorForDisplay)), resolve);

/**
 * Target-validation rows that land on an editor element or zone, keyed by its id, worded
 * for that HEM version. Rows on other sections stay in the build-error list only.
 */
export const targetValidationIssues = (
  validation: TargetValidation | null,
  model: Parameters<typeof resolveIssueTarget>[1],
) => {
  const elements = new Map<string, TargetIssue[]>();
  const zones = new Map<string, TargetIssue[]>();
  if (!validation?.items) return { elements, zones };
  const hem = `HEM ${validation.hemVersion}`;
  for (const row of displayBuildErrorRows(validation.items, (path) => resolveIssueTarget(path, model))) {
    const { elementId, zoneId, fieldKey } = row.target;
    const owner = elementId
      ? { map: elements, id: elementId }
      : zoneId && row.pathSegments[2] !== 'BuildingElement' ? { map: zones, id: zoneId } : undefined;
    if (!owner) continue;
    const message = row.userMessage.startsWith(hem) ? row.userMessage : `${hem}: ${row.userMessage}`;
    owner.map.set(owner.id, [...(owner.map.get(owner.id) ?? []), { message, fieldKey, source: 'schema', ...(row.item.severity === 'warning' && { warning: true }) }]);
  }
  return { elements, zones };
};

/** A target issue; `warning` ones are shown as warnings and never block. */
export type TargetIssue = ValidationIssue & { warning?: boolean };

/** Adds target issues to a live validation result without copying when there are none. */
export const withTargetIssues = (validation: ValidationResult, issues: readonly TargetIssue[] | undefined): ValidationResult => {
  if (!issues?.length) return validation;
  const errors = issues.filter((issue) => !issue.warning);
  const warnings = issues.filter((issue) => issue.warning);
  return {
    ...validation,
    hasIssues: validation.hasIssues || errors.length > 0,
    issues: [...validation.issues, ...errors],
    hasWarnings: validation.hasWarnings || warnings.length > 0,
    warnings: [...validation.warnings, ...warnings],
  };
};
