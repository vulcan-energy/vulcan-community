// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Lighting form family, moved verbatim from ElementCreator's five inline
// structures, plus its Lighting-only helpers (buildLightingUiExtra,
// applyGuidedLightingSelection, commitLightingModeChange), which are now
// defined inside renderPanel since they were only ever invoked from the
// Lighting attribute panel's JSX. The legacy element and global hydrate
// branches: only the element-selection chain had a Lighting case, so this
// module's single hydrate covers it.
//
// Lighting read semantics live with the BulkFieldDescriptor pilot so the
// single editor and MultiSelect use the same direct-or-bulb fallback.

import { useState } from 'react';
import type { Element } from '../../geometry/types';
import { getLightingFieldValue } from '../../lib/bulkFieldDescriptors';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import {
  decimalInputProps,
  integerInputProps,
  readExtraJsonRecord,
  useDecimalInput,
  useIntegerInput,
} from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

const LIGHTING_ENTRY_MODE_KEY = '_lighting_entry_mode';
const LIGHTING_GRADE_KEY = '_lighting_grade';
const LIGHTING_LAMP_TYPE_KEY = '_lighting_lamp_type';
export type LightingEntryMode = 'guided' | 'detailed';
export type LightingGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'unknown';
export type LightingLampType = 'Linear fluorescent' | 'LED' | 'Halogen LV' | 'Halogen' | 'Incandescent' | 'CFL';
const LIGHTING_GRADE_TO_EFFICACY: Record<LightingGrade, number | undefined> = {
  A: 210,
  B: 185,
  C: 160,
  D: 135,
  E: 110,
  F: 85,
  G: 0,
  unknown: undefined,
};
const LIGHTING_LAMP_TYPE_DEFAULT_POWER: Record<LightingLampType, number> = {
  'Linear fluorescent': 8.3,
  LED: 10,
  'Halogen LV': 25.7,
  Halogen: 42.8,
  Incandescent: 60,
  CFL: 10,
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLightingGrade(value: unknown): value is LightingGrade {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIGHTING_GRADE_TO_EFFICACY, value);
}

function isLightingLampType(value: unknown): value is LightingLampType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIGHTING_LAMP_TYPE_DEFAULT_POWER, value);
}

function buildLightingUiExtra(
  existing: unknown,
  mode: LightingEntryMode,
  grade?: LightingGrade,
  lampType?: LightingLampType,
) {
  const next = {
    ...readExtraJsonRecord(existing),
    [LIGHTING_ENTRY_MODE_KEY]: mode,
  } as Record<string, unknown>;
  if (grade) {
    next[LIGHTING_GRADE_KEY] = grade;
  } else {
    delete next[LIGHTING_GRADE_KEY];
  }
  if (lampType) {
    next[LIGHTING_LAMP_TYPE_KEY] = lampType;
  } else {
    delete next[LIGHTING_LAMP_TYPE_KEY];
  }
  return next;
}

export interface LightingFormState {
  lightingEntryMode: LightingEntryMode;
  setLightingEntryMode: (value: LightingEntryMode) => void;
  lightingGrade: LightingGrade;
  setLightingGrade: (value: LightingGrade) => void;
  lightingLampType: LightingLampType;
  setLightingLampType: (value: LightingLampType) => void;
  efficacyInput: ReturnType<typeof useDecimalInput>;
  countInput: ReturnType<typeof useIntegerInput>;
  powerInput: ReturnType<typeof useDecimalInput>;
}

function useFormState(ctx: ElementFormStateCtx): LightingFormState {
  const [lightingEntryMode, setLightingEntryMode] = useState<LightingEntryMode>('detailed');
  const [lightingGrade, setLightingGrade] = useState<LightingGrade>('unknown');
  const [lightingLampType, setLightingLampType] = useState<LightingLampType>('LED');
  const efficacyInput = useDecimalInput('', ctx.commitElementNumericField('efficacy'), { commitOnChange: true });
  const countInput = useIntegerInput('', ctx.commitElementNumericField('count'), { commitOnChange: true });
  const powerInput = useDecimalInput(
    '',
    (value) => ctx.commitExistingElementDraft({ power: typeof value === 'number' && value > 0 ? value : undefined } as Partial<Element>),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );

  return {
    lightingEntryMode,
    setLightingEntryMode,
    lightingGrade,
    setLightingGrade,
    lightingLampType,
    setLightingLampType,
    efficacyInput,
    countInput,
    powerInput,
  };
}

export const lightingFormModule: ElementFormModule<LightingFormState> = {
  type: 'Lighting',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'Lighting') return;
    const currentExtra = readExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
    const savedModeRaw = readNonEmptyString(currentExtra[LIGHTING_ENTRY_MODE_KEY]);
    const savedGradeRaw = readNonEmptyString(currentExtra[LIGHTING_GRADE_KEY]);
    const savedLampTypeRaw = readNonEmptyString(currentExtra[LIGHTING_LAMP_TYPE_KEY]);
    const hasSavedGrade = isLightingGrade(savedGradeRaw);
    const savedGrade = hasSavedGrade ? savedGradeRaw : 'unknown';
    const savedLampType = isLightingLampType(savedLampTypeRaw) ? savedLampTypeRaw : 'LED';
    const entryMode: LightingEntryMode =
      savedModeRaw === 'guided' || savedModeRaw === 'detailed' ? savedModeRaw : 'detailed';
    const efficacyFromElement = getLightingFieldValue(element, 'efficacy');
    const nextEfficacy = entryMode === 'guided'
      ? (hasSavedGrade ? LIGHTING_GRADE_TO_EFFICACY[savedGrade] : efficacyFromElement)
      : efficacyFromElement;
    const powerFromElement = getLightingFieldValue(element, 'power');
    const nextPower = entryMode === 'guided'
      ? (powerFromElement ?? LIGHTING_LAMP_TYPE_DEFAULT_POWER[savedLampType])
      : (powerFromElement ?? '');

    state.setLightingEntryMode(entryMode);
    state.setLightingGrade(savedGrade);
    state.setLightingLampType(savedLampType);
    state.efficacyInput.setValue(nextEfficacy ?? '');
    state.countInput.setValue(getLightingFieldValue(element, 'count') ?? '');
    state.powerInput.setValue(nextPower);
  },

  reset(state) {
    state.setLightingEntryMode('detailed');
    state.setLightingGrade('unknown');
    state.setLightingLampType('LED');
    state.powerInput.setValue('');
    state.efficacyInput.setValue('');
    state.countInput.setValue('');
  },

  buildElementData(state, ctx) {
    const { countInput, powerInput, efficacyInput, lightingEntryMode, lightingGrade, lightingLampType } = state;
    const countVal = countInput.value;
    const powerVal = powerInput.value;
    const enteredEfficacy = efficacyInput.value;
    const enteredEfficacyIsPositive = typeof enteredEfficacy === 'number' && Number.isFinite(enteredEfficacy) && enteredEfficacy > 0;
    const powerIsPositive = typeof powerVal === 'number' && Number.isFinite(powerVal) && powerVal > 0;
    const countIsPositive = typeof countVal === 'number' && Number.isFinite(countVal) && countVal > 0;
    const effVal = lightingEntryMode === 'guided'
      ? (LIGHTING_GRADE_TO_EFFICACY[lightingGrade] ?? undefined)
      : (enteredEfficacyIsPositive ? enteredEfficacy : undefined);
    const resolvedPower = lightingEntryMode === 'guided'
      ? (powerIsPositive ? powerVal : LIGHTING_LAMP_TYPE_DEFAULT_POWER[lightingLampType])
      : (powerIsPositive ? powerVal : undefined);
    const resolvedCount = countIsPositive ? countVal : undefined;
    const extraJsonLighting: Record<string, unknown> = {
      [LIGHTING_ENTRY_MODE_KEY]: lightingEntryMode,
      [LIGHTING_GRADE_KEY]: lightingGrade,
      [LIGHTING_LAMP_TYPE_KEY]: lightingLampType,
    };
    const ledBulb = {
      count: resolvedCount,
      power: resolvedPower,
      efficacy: effVal,
    };
    return {
      ...ctx.baseData,
      simplified_lighting: false,
      efficacy: effVal,
      count: resolvedCount,
      power: resolvedPower,
      bulbs: { led: ledBulb },
      extra_json: extraJsonLighting,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      lightingEntryMode, setLightingEntryMode,
      lightingGrade, setLightingGrade,
      lightingLampType, setLightingLampType,
      efficacyInput, countInput, powerInput,
    } = state;
    const { elementType, fieldUnit, renderFieldLabel, selection, getElementById, commitExistingElementDraft } = ctx;

    const applyGuidedLightingSelection = (
      grade: LightingGrade,
      lampType: LightingLampType,
    ) => {
      const nextEfficacy = LIGHTING_GRADE_TO_EFFICACY[grade];
      const nextPower = LIGHTING_LAMP_TYPE_DEFAULT_POWER[lampType];
      setLightingGrade(grade);
      setLightingLampType(lampType);
      efficacyInput.setValue(nextEfficacy ?? '');
      powerInput.setValue(nextPower);

      if (!selection || (selection.type !== 'element' && selection.type !== 'global') || selection.isPlaceholder) {
        return;
      }
      const current = getElementById(selection.id);
      if (!current || current.type !== 'Lighting') return;
      commitExistingElementDraft({
        simplified_lighting: false,
        efficacy: nextEfficacy,
        count: countInput.value || undefined,
        power: nextPower,
        extra_json: buildLightingUiExtra(current.extra_json, 'guided', grade, lampType),
      } as Partial<Element>);
    };

    const commitLightingModeChange = (targetMode: LightingEntryMode) => {
      setLightingEntryMode(targetMode);

      if (!selection || (selection.type !== 'element' && selection.type !== 'global') || selection.isPlaceholder) {
        return;
      }
      const current = getElementById(selection.id);
      if (!current || current.type !== 'Lighting') return;

      const currentEfficacy = typeof efficacyInput.value === 'number' ? efficacyInput.value : undefined;
      const nextEfficacy = targetMode === 'guided'
        ? LIGHTING_GRADE_TO_EFFICACY[lightingGrade]
        : (currentEfficacy !== undefined && Number.isFinite(currentEfficacy) && currentEfficacy > 0 ? currentEfficacy : undefined);
      if (targetMode === 'guided' || !(currentEfficacy !== undefined && Number.isFinite(currentEfficacy) && currentEfficacy > 0)) efficacyInput.setValue(nextEfficacy ?? '');
      const defaultPower = targetMode === 'guided' ? LIGHTING_LAMP_TYPE_DEFAULT_POWER[lightingLampType] : undefined;
      const nextPower =
        typeof powerInput.value === 'number' && Number.isFinite(powerInput.value) && powerInput.value > 0
          ? powerInput.value
          : defaultPower;
      if (!(typeof powerInput.value === 'number' && Number.isFinite(powerInput.value) && powerInput.value > 0)) {
        powerInput.setValue(nextPower ?? '');
      }

      commitExistingElementDraft({
        simplified_lighting: false,
        efficacy: nextEfficacy,
        count: countInput.value || undefined,
        power: nextPower,
        extra_json: buildLightingUiExtra(
          current.extra_json,
          targetMode,
          targetMode === 'guided' ? lightingGrade : undefined,
          lightingLampType,
        ),
      } as Partial<Element>);
    };

    return (
      <>
        <div className="element-editor-segment">
          <div className="element-editor-segment__label">Entry mode</div>
          <div className="element-editor-segment__control">
            <button
              type="button"
              className={`element-editor-segment__button ${lightingEntryMode === 'guided' ? 'element-editor-segment__button--active' : ''}`}
              onClick={() => commitLightingModeChange('guided')}
            >
              Guided
            </button>
            <button
              type="button"
              className={`element-editor-segment__button ${lightingEntryMode === 'detailed' ? 'element-editor-segment__button--active' : ''}`}
              onClick={() => commitLightingModeChange('detailed')}
            >
              Detailed
            </button>
          </div>
        </div>
        {renderFieldLabel('Count:', elementType)}
        <div className="element-input">
          <StandardInput
            {...integerInputProps(countInput)}
            unit={fieldUnit('count')}
            step="1"
            min="1"
            required
            variant="ghost"
            size="md"
          />
        </div>
        {lightingEntryMode === 'guided' && (
          <>
            {renderFieldLabel('Efficiency Grade:', elementType)}
            <div className="element-input">
              <StandardDropdown
                value={lightingGrade}
                onChange={(value) => applyGuidedLightingSelection(value as LightingGrade, lightingLampType)}
                options={[
                  { value: 'A', label: 'A (210 lm/W)' },
                  { value: 'B', label: 'B (185 lm/W)' },
                  { value: 'C', label: 'C (160 lm/W)' },
                  { value: 'D', label: 'D (135 lm/W)' },
                  { value: 'E', label: 'E (110 lm/W)' },
                  { value: 'F', label: 'F (85 lm/W)' },
                  { value: 'G', label: 'G (0 lm/W)' },
                  { value: 'unknown', label: 'Unknown' },
                ]}
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Lamp Type:', elementType)}
            <div className="element-input">
              <StandardDropdown
                value={lightingLampType}
                onChange={(value) => {
                  const nextLampType = value as LightingLampType;
                  applyGuidedLightingSelection(lightingGrade, nextLampType);
                }}
                options={[
                  { value: 'Linear fluorescent', label: 'Linear fluorescent (8.3 W)' },
                  { value: 'LED', label: 'LED (10 W)' },
                  { value: 'Halogen LV', label: 'Halogen LV (25.7 W)' },
                  { value: 'Halogen', label: 'Halogen (42.8 W)' },
                  { value: 'Incandescent', label: 'Incandescent (60 W)' },
                  { value: 'CFL', label: 'CFL (10 W)' },
                ]}
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Efficacy (lm/W):', elementType)}
            <div className="element-input">
              <StandardInput
                type="text"
                inputMode="numeric"
                value={LIGHTING_GRADE_TO_EFFICACY[lightingGrade] ?? ''}
                unit={fieldUnit('efficacy')}
                disabled
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Power (W):', elementType)}
            <div className="element-input">
              <StandardInput
                type="text"
                inputMode="numeric"
                value={LIGHTING_LAMP_TYPE_DEFAULT_POWER[lightingLampType]}
                unit={fieldUnit('power')}
                disabled
                variant="ghost"
                size="md"
              />
            </div>
            <div className="element-editor-note">
              Grade writes efficacy and lamp type writes power.
            </div>
          </>
        )}
        {lightingEntryMode === 'detailed' && (
          <>
            {renderFieldLabel('Efficacy (lm/W):', elementType)}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(efficacyInput)}
                unit={fieldUnit('efficacy')}
                step="0.01"
                min="0"
                required
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Power (W):', elementType)}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(powerInput)}
                unit={fieldUnit('power')}
                step="0.1"
                min="0"
                required
                variant="ghost"
                size="md"
              />
            </div>
          </>
        )}
      </>
    );
  },
};
