// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ValidationIssue, ValidationResult } from '../geometry/validation/types';
import { EVIDENCE_CODE, type BuildErrorItem, type TargetValidation } from '../types/buildErrors';
import { isContextShadingJoinPartsError } from './contextShadingGeometry';
import { issuePathSegments, resolveIssueTarget, type IssueTarget } from './issueTarget';
import { HEMIE_AIR_TEST_ROWS, HEMIE_NATION, hemieConstructionTypeLabel } from './hemieFabric';
import { EPC_FORM_LABELS, EPC_GLOBAL_VALUES_TITLES, globalSettingsFieldSection, globalSettingsLocation, METADATA_INPUT_LABELS, REQUIRED_SETTINGS_LABELS, TARGET_INPUT_ROW_SET } from './globalSettingsValidation';

const VENTILATION_SETTINGS = new Set(['cross_vent_possible', 'terrain_class', 'altitude', 'shield_class', 'noise_nuisance', 'ventilation_zone_base_height']);

/** A top-level input the model lacks that Global Settings asks for: '"NumberOfBathrooms" is a required property'. */
const missingSettingsInput = (segments: string[], message?: string): string | undefined => {
  const key = segments.length === 0 ? /^"([^"]+)" is a required property$/.exec(message ?? '')?.[1] : undefined;
  return key && METADATA_INPUT_LABELS[key] && globalSettingsFieldSection(key) ? key : undefined;
};

/**
 * The Global Settings field a model-settings path comes from: a Metadata row, an air test or
 * ventilation setting, or a missing top-level input Global Settings asks for.
 */
export const globalSettingsFieldOf = (path?: string, message?: string): string | undefined => {
  const segments = issuePathSegments(path);
  return settingsRow(segments) ?? missingSettingsInput(segments, message);
};

const settingsRow = (segments: string[]): string | undefined => {
  if (segments[0] === 'Metadata') return segments[1];
  // A top-level input Global Settings asks for (`/ElectricitySmartMeterGUID`).
  if (segments.length === 1 && METADATA_INPUT_LABELS[segments[0]!] && globalSettingsFieldSection(segments[0]!)) return segments[0];
  // HEM:EPC's appliance presence answers (`has_dryer`) are the Global Settings rows `Appliances_has_dryer`.
  if (segments[0] === 'Appliances' && segments[1]?.startsWith('has_')) return `Appliances_${segments[1]}`;
  if (segments[0] !== 'InfiltrationVentilation') return undefined;
  if (segments[1] === 'Leaks') {
    return segments[2] === 'ventilation_zone_height' || segments[2] === 'test_pressure' ? `AirPermeability_${segments[2]}` : 'AirPermeability_test_result';
  }
  return segments[1] && VENTILATION_SETTINGS.has(segments[1]) ? `Ventilation_${segments[1]}` : undefined;
};

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

/** Which Global Settings form names the locations: HEM:EPC's Global values groups, or the accordions. */
export type BuildErrorDisplayOptions = { epcForm?: boolean };

const buildErrorLocation = (path: string | undefined, epcForm: boolean) => {
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

  // The existing-building fabric rows, where the editor shows them.
  if (segments[0] === 'Metadata' && segments[1]?.startsWith('HEMIE_') && segments[1] !== 'HEMIE_distant_shading') {
    const constructionType = segments[1].match(/^HEMIE_construction_(.+)$/)?.[1];
    return {
      location: segments[1] === HEMIE_NATION
        // The nation follows the postcode.
        ? globalSettingsLocation('Postcode', epcForm)!
        : epcForm && HEMIE_AIR_TEST_ROWS.has(segments[1])
          ? `Global Settings > ${EPC_GLOBAL_VALUES_TITLES.airTightness}`
          : `Global Settings > Fabric${constructionType ? ` > ${hemieConstructionTypeLabel(constructionType)}` : ''}`,
    };
  }

  // Other model settings, where Global Settings shows them.
  const row = settingsRow(segments);
  const location = row ? globalSettingsLocation(row, epcForm) : null;
  if (location) return { location };

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

/** What a top-level schema error on a system section asks for: that section is empty. */
const MISSING_SYSTEM_MESSAGES: Readonly<Record<string, string>> = {
  HotWaterSource: 'Add a hot water system.',
  SpaceHeatSystem: 'Add a heating system.',
};

/** JSON-schema errors carry the failing keyword; converter/source errors do not. */
const isSchemaKeywordError = (item: BuildErrorItem) => Boolean(item.keyword || item.schemaPath);

/** A system section's own `type` error: the section is missing (not an object). Any other error there keeps its message. */
const isMissingSystemError = (item: BuildErrorItem, pathSegments: readonly string[]) =>
  item.keyword === 'type' && pathSegments.length === 1;

const formatBuildErrorForDisplay = (item: BuildErrorItem, epcForm: boolean): DisplayBuildError => {
  const pathSegments = pointerSegments(item.path);
  const missingInput = missingSettingsInput(pathSegments, item.message);
  const located = buildErrorLocation(item.path, epcForm);
  const field = located.field;
  // A missing top-level input is where Global Settings asks for it.
  const location = missingInput ? globalSettingsLocation(missingInput, epcForm)! : located.location;
  // A Global Settings row is named by its label there.
  const settingsField = field ? undefined : settingsRow(pathSegments);
  const fieldLabel = field ? titleCaseToken(field) : settingsField && REQUIRED_SETTINGS_LABELS[settingsField];
  const keyword = item.keyword || '';
  const requiredField = requiredFieldFromMessage(item.message);
  const minimum = minimumFromMessage(item.message);
  const maximum = maximumFromMessage(item.message);
  const unexpectedFields = unexpectedFieldsFromMessage(item.message);
  const explicitUserMessage = item.userMessage?.trim();

  const requiredRow = item.code === 'E_EPC_REQUIRED_INPUT' && pathSegments[0] === 'Metadata' ? pathSegments[1] : undefined;
  const inputKey = requiredRow ?? missingInput;
  // The HEM:EPC form's own label where it words a field differently.
  const unstatedInput = inputKey && ((epcForm && EPC_FORM_LABELS[inputKey])
    || (requiredRow ? REQUIRED_SETTINGS_LABELS[requiredRow] : METADATA_INPUT_LABELS[inputKey]));

  let userMessage: string;
  if (explicitUserMessage) {
    userMessage = explicitUserMessage;
  } else if (unstatedInput) {
    // Lower-case the label mid-sentence, keeping proper names (Part G, SAP).
    const label = /^[A-Z][a-z]/.test(unstatedInput) && !/^Part\b/.test(unstatedInput)
      ? unstatedInput[0].toLowerCase() + unstatedInput.slice(1)
      : unstatedInput;
    // A yes/no row reads as a choice, not an entry.
    userMessage = TARGET_INPUT_ROW_SET.has(pathSegments[1] ?? missingInput ?? '') ? `Choose yes or no for ${label}.` : `Enter ${label}.`;
  } else if (isMissingSystemError(item, pathSegments) && MISSING_SYSTEM_MESSAGES[pathSegments[0]!]) {
    // A system section that is not an object: the model has no such system.
    userMessage = MISSING_SYSTEM_MESSAGES[pathSegments[0]!]!;
  } else if (
    location === 'Appliances' &&
    (item.message.includes('is not allowed for {}') || item.message.includes('has less than'))
  ) {
    userMessage = 'Add at least one appliance entry.';
  } else if (
    pathSegments[0] === 'HotWaterDemand' && pathSegments.length === 1 &&
    (item.message.includes('has less than') || keyword === 'minProperties' || keyword === 'anyOf' || keyword === 'oneOf')
  ) {
    // The demand fails as a whole until it has an outlet.
    userMessage = 'Add a shower, bath or tap.';
  } else if (
    pathSegments[0] === 'HotWaterDemand' &&
    (item.message.includes('has less than') || keyword === 'minProperties')
  ) {
    userMessage = 'Add at least one hot water outlet.';
  } else if (pathSegments[0] === 'Zone' && pathSegments[2] === 'Lighting' && pathSegments.length === 3 && item.message.startsWith('null ')) {
    // The converter writes no Lighting for a zone without light rows.
    userMessage = 'Add at least one light to this zone.';
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
      : `${compactPathLabel(pathSegments)} matches none of the forms this HEM version takes. Check its type and the inputs it states.`;
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
    // A first line is the summary; the lines after it show under Details.
    userMessage = item.message.split('\n')[0]!;
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

  // A converter error says why the converted input is wrong: the schema's own "none of the
  // alternatives match" row at the top of a section (an existing building's Zone or Geometry) adds only noise.
  const converterFailed = errors.some((error) => !isSchemaKeywordError(error.item) && !error.item.severity);
  // With no hot water system, the hot water demand fails too: one row asks for the system.
  const noHotWaterSystem = errors.some((error) => isMissingSystemError(error.item, error.pathSegments) && error.pathSegments[0] === 'HotWaterSource');
  return errors.filter((error) => {
    const topLevelAlternatives = isSchemaKeywordError(error.item) && error.pathSegments.length <= 1
      && (error.item.keyword === 'anyOf' || error.item.keyword === 'oneOf');
    if (topLevelAlternatives && (converterFailed || (noHotWaterSystem && error.pathSegments[0] === 'HotWaterDemand'))) return false;
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
  resolve: (path?: string, message?: string) => IssueTarget,
): DisplayBuildErrorRow[] => {
  // Converter and source messages name elements in quotes; schema messages name fields.
  const rows = errors.map((error) => ({
    ...error,
    target: resolve(error.item.path, isSchemaKeywordError(error.item) ? undefined : error.item.message),
    derived: [] as DisplayBuildError[],
  }));
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

/**
 * The items the build-error list shows: the live check's errors and notices once it has run (it
 * runs from the moment a model opens and after every edit, and a Save refreshes it), then the
 * save's own messages, such as a load's data loss or a notice; until it has run, the save's items.
 */
export const buildErrorListItems = (
  reported: readonly BuildErrorItem[],
  live: readonly BuildErrorItem[] | undefined,
): readonly BuildErrorItem[] => {
  if (!live) return reported;
  // The live check reruns the save's check (its schema items); the host's own messages stay.
  const key = (item: BuildErrorItem) => `${item.code}|${item.path}|${item.message}`;
  const seen = new Set(live.map(key));
  return [...live, ...reported.filter((item) => item.source !== 'schema' && !seen.has(key(item)))];
};

/**
 * A row's text under Details: its technical message, with the converted value a schema error
 * repeats in front of "is not valid" left out (a whole zone or system as JSON says nothing the path does not).
 */
export const buildErrorTechnicalText = (item: BuildErrorItem): string =>
  item.technicalMessage || item.message.replace(/^[{[][\s\S]*[}\]] (is not valid under any of the schemas listed in the '(?:anyOf|oneOf)' keyword)$/, 'The value $1');

/** The rows the build-error list shows: user wording, noise dropped, consequences folded. */
export const displayBuildErrorRows = (
  items: readonly BuildErrorItem[],
  resolve: (path?: string, message?: string) => IssueTarget,
  { epcForm = false }: BuildErrorDisplayOptions = {},
): DisplayBuildErrorRow[] => collapseDerivedBuildErrors(
  filterDisplayBuildErrors(items.map((item) => formatBuildErrorForDisplay(item, epcForm))), resolve);

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
  // Lodgement evidence is a to-do, not a fault on the element: the lodge journey lists it.
  const items = validation.items.filter((item) => item.code !== EVIDENCE_CODE);
  for (const row of displayBuildErrorRows(items, (path, message) => resolveIssueTarget(path, model, message))) {
    const { elementId, zoneId } = row.target;
    // A missing required field is that field's issue, though the path names its row.
    const fieldKey = row.target.fieldKey ?? /"([^"]+)" is a required property/.exec(row.item.message)?.[1];
    const owner = elementId
      ? { map: elements, id: elementId }
      : zoneId && row.pathSegments[2] !== 'BuildingElement' ? { map: zones, id: zoneId } : undefined;
    if (!owner) continue;
    // The message says what to fix; no engine-version prefix.
    const message = row.userMessage.replace(/^HEM [^\s:]+: /, '');
    owner.map.set(owner.id, [...(owner.map.get(owner.id) ?? []), { message, fieldKey, source: 'schema', ...(row.item.severity === 'warning' && { warning: true }) }]);
  }
  return { elements, zones };
};

/** A target issue; `warning` ones are shown as warnings and never block. */
export type TargetIssue = ValidationIssue & { warning?: boolean };

/** Adds target issues to a live validation result without copying when there are none. */
export const withTargetIssues = (validation: ValidationResult, issues: readonly TargetIssue[] | undefined): ValidationResult => {
  if (!issues?.length) return validation;
  // A field the editor already flags shows its own message once.
  const flagged = new Set(validation.issues.flatMap((issue) => (issue.fieldKey ? [issue.fieldKey] : [])));
  const errors = issues.filter((issue) => !issue.warning && !(issue.fieldKey && flagged.has(issue.fieldKey)));
  const warnings = issues.filter((issue) => issue.warning);
  return {
    ...validation,
    hasIssues: validation.hasIssues || errors.length > 0,
    issues: [...validation.issues, ...errors],
    hasWarnings: validation.hasWarnings || warnings.length > 0,
    warnings: [...validation.warnings, ...warnings],
  };
};

/** A button beside an issue row that fixes it. */
export type IssueAction = Readonly<{ label: string; run: () => void }>;

/** The fix a build error offers, if any: the converter's over-limit Context Shading error offers joining parts. */
export const buildErrorFixAction = (
  message: string | undefined,
  setComplianceSettings: (settings: { ContextShadingJoinParts: true }) => void,
): IssueAction | undefined => (isContextShadingJoinPartsError(message)
  ? { label: 'Join parts', run: () => setComplianceSettings({ ContextShadingJoinParts: true }) }
  : undefined);
