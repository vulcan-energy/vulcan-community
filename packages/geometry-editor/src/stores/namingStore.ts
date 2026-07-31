// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fhsFloorCodeForCanvasFloor } from '../lib/storeySemantics';

export type NamingRuleId =
  | 'externalWall'
  | 'pitchedRoof'
  | 'flatRoof'
  | 'exposedFloor'
  | 'externalDoor'
  | 'window'
  | 'groundFloor'
  | 'internalWall'
  | 'internalFloor'
  | 'internalCeiling'
  | 'partyWall'
  | 'partyFloor'
  | 'partyCeiling'
  | 'unheatedWall'
  | 'unheatedFloor'
  | 'unheatedCeiling'
  | 'systemDerived'
  | 'wetEmitterDerived'
  | 'mechanicalVentilationDerived'
  | 'hotWaterDerived'
  | 'applianceDerived'
  | 'thermalBridge'
  | 'windowShading'
  | 'lighting'
  | 'ventilationDuctwork'
  | 'ventilationTerminal'
  | 'waterPipework'
  | 'contextShading'
  | 'vent'
  | 'onSiteGeneration'
  | 'electricBattery';

export type FloorLabelStyle = 'fhs';
export type OrientationLabelStyle = 'short-brackets' | 'short' | 'long' | 'bearing';
export type NamingLabelMode = 'editable' | 'derived';
export type NamingToken = 'floor' | 'name' | 'orientation' | 'number';

export type ElementNamingRule = {
  label: string;
  optionLabels: Record<string, string>;
};

export type NamingPreferences = {
  includeFloor: boolean;
  includeOrientation: boolean;
  floorLabelStyle: FloorLabelStyle;
  orientationLabelStyle: OrientationLabelStyle;
  tokenOrder: NamingToken[];
  separator: string;
  rules: Record<NamingRuleId, ElementNamingRule>;
};

export type ElementAutoNameParts = {
  ruleId: NamingRuleId;
  defaultLabel: string;
  derivedLabel?: string;
  derivedOptionId?: string;
  detail?: string;
  orientation?: string;
  number?: string;
  floor?: string;
};

export type NamingOptionDefinition = {
  id: string;
  label: string;
  defaultLabel: string;
  groupLabel?: string;
  preview?: ElementAutoNameParts;
};

export type NamingRuleDefinition = {
  id: NamingRuleId;
  label: string;
  defaultLabel: string;
  labelMode: NamingLabelMode;
  preview: ElementAutoNameParts;
  options?: ReadonlyArray<NamingOptionDefinition>;
};

export const NAMING_RULE_DEFINITIONS: ReadonlyArray<NamingRuleDefinition> = [
  { id: 'externalWall', label: 'External walls', defaultLabel: 'Wall', labelMode: 'editable', preview: { ruleId: 'externalWall', defaultLabel: 'Wall', floor: 'GF', orientation: '(S)' } },
  { id: 'pitchedRoof', label: 'Pitched roofs', defaultLabel: 'Pitched Roof', labelMode: 'editable', preview: { ruleId: 'pitchedRoof', defaultLabel: 'Pitched Roof', floor: 'F1', orientation: '(E)' } },
  { id: 'flatRoof', label: 'Flat roofs', defaultLabel: 'Flat Roof', labelMode: 'editable', preview: { ruleId: 'flatRoof', defaultLabel: 'Flat Roof', floor: 'F1' } },
  { id: 'exposedFloor', label: 'Exposed floors', defaultLabel: 'Exposed Floor', labelMode: 'editable', preview: { ruleId: 'exposedFloor', defaultLabel: 'Exposed Floor', floor: 'GF', orientation: '(N)' } },
  { id: 'externalDoor', label: 'External doors', defaultLabel: 'Door', labelMode: 'editable', preview: { ruleId: 'externalDoor', defaultLabel: 'Door', floor: 'GF' } },
  { id: 'window', label: 'Windows', defaultLabel: 'Window', labelMode: 'editable', preview: { ruleId: 'window', defaultLabel: 'Window', floor: 'GF' } },
  { id: 'groundFloor', label: 'Ground elements', defaultLabel: 'Floor', labelMode: 'editable', preview: { ruleId: 'groundFloor', defaultLabel: 'Floor', floor: 'GF' } },
  { id: 'internalWall', label: 'Internal walls', defaultLabel: 'Internal Wall', labelMode: 'editable', preview: { ruleId: 'internalWall', defaultLabel: 'Internal Wall', floor: 'GF', orientation: '(W)' } },
  { id: 'internalFloor', label: 'Internal floors', defaultLabel: 'Internal Floor', labelMode: 'editable', preview: { ruleId: 'internalFloor', defaultLabel: 'Internal Floor', floor: 'GF' } },
  { id: 'internalCeiling', label: 'Internal ceilings', defaultLabel: 'Internal Ceiling', labelMode: 'editable', preview: { ruleId: 'internalCeiling', defaultLabel: 'Internal Ceiling', floor: 'F1' } },
  { id: 'partyWall', label: 'Party walls', defaultLabel: 'Party Wall', labelMode: 'editable', preview: { ruleId: 'partyWall', defaultLabel: 'Party Wall', floor: 'GF' } },
  { id: 'partyFloor', label: 'Party floors', defaultLabel: 'Party Floor', labelMode: 'editable', preview: { ruleId: 'partyFloor', defaultLabel: 'Party Floor', floor: 'GF' } },
  { id: 'partyCeiling', label: 'Party ceilings', defaultLabel: 'Party Ceiling', labelMode: 'editable', preview: { ruleId: 'partyCeiling', defaultLabel: 'Party Ceiling', floor: 'F1' } },
  { id: 'unheatedWall', label: 'Unheated walls', defaultLabel: 'Unheated Wall', labelMode: 'editable', preview: { ruleId: 'unheatedWall', defaultLabel: 'Unheated Wall', floor: 'GF', orientation: '(N)' } },
  { id: 'unheatedFloor', label: 'Unheated floors', defaultLabel: 'Unheated Floor', labelMode: 'editable', preview: { ruleId: 'unheatedFloor', defaultLabel: 'Unheated Floor', floor: 'GF' } },
  { id: 'unheatedCeiling', label: 'Unheated ceilings', defaultLabel: 'Unheated Ceiling', labelMode: 'editable', preview: { ruleId: 'unheatedCeiling', defaultLabel: 'Unheated Ceiling', floor: 'F1' } },
  { id: 'thermalBridge', label: 'Thermal bridges', defaultLabel: 'TB', labelMode: 'editable', preview: { ruleId: 'thermalBridge', defaultLabel: 'TB', detail: 'E5', floor: 'GF' } },
  {
    id: 'systemDerived',
    label: 'Systems',
    defaultLabel: 'System',
    labelMode: 'derived',
    preview: { ruleId: 'systemDerived', defaultLabel: 'System', derivedLabel: 'Heat source wet', derivedOptionId: 'HeatSourceWet', floor: 'GF' },
    options: [
      { id: 'HeatSourceWet', label: 'Heat source wet', defaultLabel: 'Heat source wet' },
      { id: 'HotWaterSource', label: 'Hot water source', defaultLabel: 'Hot water' },
      { id: 'SpaceCoolSystem', label: 'Space cooling', defaultLabel: 'Space cooling' },
      { id: 'SpaceHeatSystem', label: 'Space heating', defaultLabel: 'Space heating' },
      { id: 'WWHRS', label: 'WWHRS', defaultLabel: 'WWHRS' },
    ],
  },
  {
    id: 'wetEmitterDerived',
    label: 'Emitters',
    defaultLabel: 'Radiator',
    labelMode: 'derived',
    preview: { ruleId: 'wetEmitterDerived', defaultLabel: 'Radiator', derivedLabel: 'Radiator', derivedOptionId: 'radiator', floor: 'GF' },
    options: [
      { id: 'radiator', label: 'Radiators', defaultLabel: 'Radiator' },
      { id: 'ufh', label: 'Underfloor heating', defaultLabel: 'Underfloor Heating' },
      { id: 'fancoil', label: 'Fan coils', defaultLabel: 'Fan Coil' },
    ],
  },
  {
    id: 'mechanicalVentilationDerived',
    label: 'Ventilation',
    defaultLabel: 'Ventilation',
    labelMode: 'derived',
    preview: { ruleId: 'mechanicalVentilationDerived', defaultLabel: 'Ventilation', derivedLabel: 'MVHR', derivedOptionId: 'MVHR', floor: 'GF' },
    options: [
      { id: 'Intermittent MEV', label: 'Intermittent MEV', defaultLabel: 'Intermittent MEV' },
      { id: 'Centralised continuous MEV', label: 'Centralised continuous MEV', defaultLabel: 'Centralised Continuous MEV' },
      { id: 'Decentralised continuous MEV', label: 'Decentralised continuous MEV', defaultLabel: 'Decentralised Continuous MEV' },
      { id: 'MVHR', label: 'MVHR', defaultLabel: 'MVHR' },
    ],
  },
  {
    id: 'hotWaterDerived',
    label: 'Hot water outlets',
    defaultLabel: 'Hot Water',
    labelMode: 'derived',
    preview: { ruleId: 'hotWaterDerived', defaultLabel: 'Hot Water', derivedLabel: 'Shower', derivedOptionId: 'MixerShower', floor: 'GF' },
    options: [
      { id: 'Bath', label: 'Baths', defaultLabel: 'Bath' },
      { id: 'MixerShower', label: 'Mixer showers', defaultLabel: 'Shower' },
      { id: 'InstantElecShower', label: 'Instant electric showers', defaultLabel: 'Shower' },
      { id: 'OtherWaterUseDetails', label: 'Other outlets', defaultLabel: 'Tap' },
    ],
  },
  {
    id: 'applianceDerived',
    label: 'Appliances',
    defaultLabel: 'Appliance',
    labelMode: 'derived',
    preview: { ruleId: 'applianceDerived', defaultLabel: 'Appliance', derivedLabel: 'Dishwasher', derivedOptionId: 'Dishwasher', floor: 'GF' },
    options: [
      { id: 'Clothes_drying', label: 'Clothes drying', defaultLabel: 'Clothes Drying' },
      { id: 'Clothes_washing', label: 'Clothes washing', defaultLabel: 'Clothes Washing' },
      { id: 'Dishwasher', label: 'Dishwashers', defaultLabel: 'Dishwasher' },
      { id: 'Fridge', label: 'Fridges', defaultLabel: 'Fridge' },
      { id: 'Fridge-Freezer', label: 'Fridge-freezers', defaultLabel: 'Fridge Freezer' },
      { id: 'Freezer', label: 'Freezers', defaultLabel: 'Freezer' },
      { id: 'Hobs', label: 'Hobs', defaultLabel: 'Hobs' },
      { id: 'Kettle', label: 'Kettles', defaultLabel: 'Kettle' },
      { id: 'Microwave', label: 'Microwaves', defaultLabel: 'Microwave' },
      { id: 'Otherdevices', label: 'Other devices', defaultLabel: 'Otherdevices' },
      { id: 'Oven', label: 'Ovens', defaultLabel: 'Oven' },
    ],
  },
  { id: 'windowShading', label: 'Window shading', defaultLabel: 'Shading', labelMode: 'editable', preview: { ruleId: 'windowShading', defaultLabel: 'Shading', floor: 'GF' } },
  { id: 'lighting', label: 'Lighting', defaultLabel: 'Light', labelMode: 'editable', preview: { ruleId: 'lighting', defaultLabel: 'Light', floor: 'GF' } },
  { id: 'ventilationDuctwork', label: 'Ventilation ductwork', defaultLabel: 'Duct', labelMode: 'editable', preview: { ruleId: 'ventilationDuctwork', defaultLabel: 'Duct', floor: 'GF' } },
  { id: 'ventilationTerminal', label: 'MVHR terminals', defaultLabel: 'Terminal', labelMode: 'editable', preview: { ruleId: 'ventilationTerminal', defaultLabel: 'Terminal', floor: 'GF' } },
  { id: 'waterPipework', label: 'Water pipework', defaultLabel: 'Pipe', labelMode: 'editable', preview: { ruleId: 'waterPipework', defaultLabel: 'Pipe', floor: 'GF' } },
  { id: 'contextShading', label: 'Context shading', defaultLabel: 'Context', labelMode: 'editable', preview: { ruleId: 'contextShading', defaultLabel: 'Context', floor: 'GF' } },
  { id: 'vent', label: 'Vents', defaultLabel: 'Vent', labelMode: 'editable', preview: { ruleId: 'vent', defaultLabel: 'Vent', floor: 'GF' } },
  { id: 'onSiteGeneration', label: 'On-site generation', defaultLabel: 'Solar Panel', labelMode: 'editable', preview: { ruleId: 'onSiteGeneration', defaultLabel: 'Solar Panel', floor: 'F1' } },
  { id: 'electricBattery', label: 'Electric batteries', defaultLabel: 'Electric Battery', labelMode: 'editable', preview: { ruleId: 'electricBattery', defaultLabel: 'Electric Battery', floor: 'GF' } },
];

const NAMING_RULE_BY_ID = new Map(NAMING_RULE_DEFINITIONS.map((rule) => [rule.id, rule]));

const makeDefaultNamingRules = (): Record<NamingRuleId, ElementNamingRule> =>
  NAMING_RULE_DEFINITIONS.reduce((rules, definition) => {
    rules[definition.id] = {
      label: definition.labelMode === 'derived' ? '' : definition.defaultLabel,
      optionLabels: Object.fromEntries(
        (definition.options ?? []).map((option) => [option.id, option.defaultLabel]),
      ),
    };
    return rules;
  }, {} as Record<NamingRuleId, ElementNamingRule>);

export const createDefaultNamingPreferences = (): NamingPreferences => ({
  includeFloor: false,
  includeOrientation: true,
  floorLabelStyle: 'fhs',
  orientationLabelStyle: 'short-brackets',
  tokenOrder: ['floor', 'name', 'orientation', 'number'],
  separator: ' ',
  rules: makeDefaultNamingRules(),
});

export const DEFAULT_NAMING_PREFERENCES: NamingPreferences = {
  includeFloor: false,
  includeOrientation: true,
  floorLabelStyle: 'fhs',
  orientationLabelStyle: 'short-brackets',
  tokenOrder: ['floor', 'name', 'orientation', 'number'],
  separator: ' ',
  rules: makeDefaultNamingRules(),
};

const isNamingRuleId = (value: string): value is NamingRuleId => NAMING_RULE_BY_ID.has(value as NamingRuleId);
const isFloorLabelStyle = (value: unknown): value is FloorLabelStyle => value === 'fhs';
const isOrientationLabelStyle = (value: unknown): value is OrientationLabelStyle => (
  value === 'short-brackets' || value === 'short' || value === 'long' || value === 'bearing'
);
const sanitizeSeparator = (value: unknown): string => (
  typeof value === 'string' ? value.slice(0, 8) : DEFAULT_NAMING_PREFERENCES.separator
);
const isNamingToken = (value: unknown): value is NamingToken => (
  value === 'floor' || value === 'name' || value === 'orientation' || value === 'number'
);
const sanitizeTokenOrder = (value: unknown, legacyFloorFirst: boolean | null): NamingToken[] => {
  if (Array.isArray(value)) {
    const ordered = value.filter(isNamingToken);
    if (ordered.includes('name')) {
      const seen = new Set<NamingToken>();
      const deduped = ordered.filter((token) => {
        if (seen.has(token)) return false;
        seen.add(token);
        return true;
      });
      for (const token of DEFAULT_NAMING_PREFERENCES.tokenOrder) {
        if (!seen.has(token)) deduped.push(token);
      }
      return deduped;
    }
  }
  if (legacyFloorFirst === false) return ['name', 'orientation', 'floor', 'number'];
  return [...DEFAULT_NAMING_PREFERENCES.tokenOrder];
};

const sanitizeOptionLabels = (
  ruleId: NamingRuleId,
  raw: unknown,
): Record<string, string> => {
  const fallback = { ...DEFAULT_NAMING_PREFERENCES.rules[ruleId].optionLabels };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  for (const [optionId, label] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof label === 'string') {
      fallback[optionId] = label;
    }
  }
  return fallback;
};

const sanitizeRule = (ruleId: NamingRuleId, raw: unknown): ElementNamingRule => {
  const fallback = DEFAULT_NAMING_PREFERENCES.rules[ruleId];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...fallback, optionLabels: { ...fallback.optionLabels } };
  }
  const record = raw as Record<string, unknown>;
  return {
    label: typeof record.label === 'string' ? record.label : fallback.label,
    optionLabels: sanitizeOptionLabels(ruleId, record.optionLabels),
  };
};

const applyLegacyAdjacentPrefix = (
  rules: Record<NamingRuleId, ElementNamingRule>,
  rawRules: Record<string, unknown>,
  legacyRuleId: string,
  defaultPrefix: string,
  targets: ReadonlyArray<[NamingRuleId, string]>,
) => {
  const rawRule = rawRules[legacyRuleId];
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return;
  const label = (rawRule as Record<string, unknown>).label;
  if (typeof label !== 'string' || !label.trim() || label.trim() === defaultPrefix) return;
  for (const [ruleId, surface] of targets) {
    rules[ruleId] = {
      ...rules[ruleId],
      label: `${label.trim()} ${surface}`,
    };
  }
};

const sanitizePreferences = (raw: unknown): NamingPreferences => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultNamingPreferences();
  }
  const record = raw as Record<string, unknown>;
  const rawRules = record.rules && typeof record.rules === 'object' && !Array.isArray(record.rules)
    ? record.rules as Record<string, unknown>
    : {};
  const rules = makeDefaultNamingRules();
  let legacyFloorFirst: boolean | null = record.floorPosition === 'after-name'
    ? false
    : record.floorPosition === 'before-name'
      ? true
      : null;
  let legacyIncludeFloor = false;
  for (const [ruleId, rawRule] of Object.entries(rawRules)) {
    if (!isNamingRuleId(ruleId)) continue;
    rules[ruleId] = sanitizeRule(ruleId, rawRule);
    if (rawRule && typeof rawRule === 'object' && !Array.isArray(rawRule)) {
      const tokens = (rawRule as Record<string, unknown>).tokens;
      if (legacyFloorFirst === null && Array.isArray(tokens) && tokens.includes('floor')) {
        legacyFloorFirst = tokens[0] === 'floor';
      }
      if ((rawRule as Record<string, unknown>).includeFloor === true || (Array.isArray(tokens) && tokens.includes('floor'))) {
        legacyIncludeFloor = true;
      }
    }
  }
  applyLegacyAdjacentPrefix(rules, rawRules, 'internalAdjacentSurface', 'Internal', [
    ['internalWall', 'Wall'],
    ['internalFloor', 'Floor'],
    ['internalCeiling', 'Ceiling'],
  ]);
  applyLegacyAdjacentPrefix(rules, rawRules, 'partyAdjacentSurface', 'Party', [
    ['partyWall', 'Wall'],
    ['partyFloor', 'Floor'],
    ['partyCeiling', 'Ceiling'],
  ]);
  applyLegacyAdjacentPrefix(rules, rawRules, 'unheatedAdjacentSurface', 'Unheated', [
    ['unheatedWall', 'Wall'],
    ['unheatedFloor', 'Floor'],
    ['unheatedCeiling', 'Ceiling'],
  ]);
  return {
    includeFloor: typeof record.includeFloor === 'boolean' ? record.includeFloor : legacyIncludeFloor,
    includeOrientation: typeof record.includeOrientation === 'boolean' ? record.includeOrientation : DEFAULT_NAMING_PREFERENCES.includeOrientation,
    floorLabelStyle: isFloorLabelStyle(record.floorLabelStyle) ? record.floorLabelStyle : DEFAULT_NAMING_PREFERENCES.floorLabelStyle,
    orientationLabelStyle: isOrientationLabelStyle(record.orientationLabelStyle) ? record.orientationLabelStyle : DEFAULT_NAMING_PREFERENCES.orientationLabelStyle,
    tokenOrder: sanitizeTokenOrder(record.tokenOrder, legacyFloorFirst),
    separator: sanitizeSeparator(record.separator),
    rules,
  };
};

export const sanitizeNamingPreferences = sanitizePreferences;

export const cloneNamingPreferences = (preferences: NamingPreferences): NamingPreferences => (
  sanitizePreferences(preferences)
);

export const formatFloorLabel = (storeyIndex: number | undefined, _style: FloorLabelStyle = 'fhs'): string => {
  void _style;
  if (typeof storeyIndex !== 'number' || !Number.isFinite(storeyIndex)) return '';
  return fhsFloorCodeForCanvasFloor(storeyIndex);
};

export const ORIENTATION_LABEL_STYLE_OPTIONS: ReadonlyArray<{
  id: OrientationLabelStyle;
  label: string;
  preview: string;
}> = [
  { id: 'short-brackets', label: 'Abbreviated with brackets', preview: '(S)' },
  { id: 'short', label: 'Abbreviated', preview: 'S' },
  { id: 'long', label: 'Full direction', preview: 'South' },
  { id: 'bearing', label: 'Bearing', preview: '180 deg' },
];

const ORIENTATION_SHORT_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const ORIENTATION_LONG_LABELS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'] as const;

const normalizeOrientationDegrees = (orientation360: number): number => (
  ((orientation360 % 360) + 360) % 360
);

export const formatOrientationLabel = (
  orientation360: number | undefined,
  style: OrientationLabelStyle = DEFAULT_NAMING_PREFERENCES.orientationLabelStyle,
): string => {
  if (typeof orientation360 !== 'number' || !Number.isFinite(orientation360)) return '';
  const normalized = normalizeOrientationDegrees(orientation360);
  const index = Math.round(normalized / 45) % ORIENTATION_SHORT_LABELS.length;
  const shortLabel = ORIENTATION_SHORT_LABELS[index];
  if (style === 'short') return shortLabel;
  if (style === 'long') return ORIENTATION_LONG_LABELS[index];
  if (style === 'bearing') {
    const rounded = Math.round(normalized * 100) / 100;
    const displayValue = rounded === 360 ? 0 : rounded;
    return `${Number.isInteger(displayValue) ? displayValue.toFixed(0) : displayValue} deg`;
  }
  return `(${shortLabel})`;
};

const joinNameTokens = (tokens: string[], separator: string): string => (
  tokens
    .map((token) => token.trim())
    .filter(Boolean)
    .join(separator)
    .replace(/\s+/g, ' ')
    .trim()
);

export const formatAutoElementName = (
  parts: ElementAutoNameParts,
  preferences: NamingPreferences,
): string => {
  const definition = NAMING_RULE_BY_ID.get(parts.ruleId);
  const fallbackRule = DEFAULT_NAMING_PREFERENCES.rules[parts.ruleId];
  const rule = preferences.rules[parts.ruleId] ?? fallbackRule;
  const configuredLabel = rule?.label.trim() || parts.defaultLabel || definition?.defaultLabel || '';
  const tokensByType: Partial<Record<NamingToken, string[]>> = {};

  if (definition?.labelMode === 'derived') {
    const configuredOptionLabel = parts.derivedOptionId
      ? rule?.optionLabels?.[parts.derivedOptionId]?.trim()
      : '';
    tokensByType.name = [configuredOptionLabel || parts.derivedLabel?.trim() || parts.defaultLabel || definition.defaultLabel];
  } else {
    tokensByType.name = [configuredLabel];
  }

  if (parts.detail) tokensByType.name = [...(tokensByType.name ?? []), parts.detail];
  if (preferences.includeOrientation && parts.orientation) tokensByType.orientation = [parts.orientation];
  if (preferences.includeFloor && parts.floor?.trim()) tokensByType.floor = [parts.floor.trim()];
  if (parts.number?.trim()) tokensByType.number = [parts.number.trim()];

  const tokens = preferences.tokenOrder.flatMap((token) => tokensByType[token] ?? []);

  return joinNameTokens(tokens, preferences.separator) || configuredLabel || parts.defaultLabel;
};
