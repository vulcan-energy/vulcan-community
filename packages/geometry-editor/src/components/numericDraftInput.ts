// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, InputHTMLAttributes } from 'react';

export type NumericDraftValue = number | '';

type NumericDraftExternalValue = number | string | '' | null | undefined;

type NumericDraftBlurFormat = 'fixed2' | 'preserve' | 'number';

type NumericDraftOptions = {
  commitOnChange?: boolean;
  formatOnBlur?: NumericDraftBlurFormat;
  integer?: boolean;
  syncExternal?: boolean;
};

type ParseOptions = {
  integer?: boolean;
};

export type NumericInputAttributes = {
  inputMode: NonNullable<InputHTMLAttributes<HTMLInputElement>['inputMode']>;
  min?: string;
  max?: string;
  step: string;
  pattern?: string;
  'data-exclusive-minimum'?: string;
  'data-exclusive-maximum'?: string;
};

const DECIMAL_COMPLETE_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const INTEGER_COMPLETE_PATTERN = /^[+-]?\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberToInputString(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

function parseCompleteNumericDraft(rawValue: string, options?: ParseOptions): NumericDraftValue | null {
  const trimmed = rawValue.trim();
  if (trimmed === '') return '';

  const pattern = options?.integer ? INTEGER_COMPLETE_PATTERN : DECIMAL_COMPLETE_PATTERN;
  if (!pattern.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (options?.integer && !Number.isInteger(parsed)) return null;
  return parsed;
}

function externalValueToState(value: NumericDraftExternalValue, options?: ParseOptions): NumericDraftValue {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseCompleteNumericDraft(value, options);
    return parsed ?? '';
  }
  return '';
}

function externalValueToInputString(value: NumericDraftExternalValue): string {
  if (typeof value === 'number' && Number.isFinite(value)) return numberToInputString(value);
  if (typeof value === 'string') return value;
  return '';
}

function formatBlurredInput(rawValue: string, parsed: NumericDraftValue, format: NumericDraftBlurFormat): string {
  if (parsed === '') return '';
  if (format === 'fixed2') return parsed.toFixed(2);
  if (format === 'number') return numberToInputString(parsed);
  return rawValue.trim();
}

export function useNumericDraftInput(
  externalValue: NumericDraftExternalValue = '',
  onCommit?: (value: NumericDraftValue) => void,
  options?: NumericDraftOptions,
) {
  const integer = options?.integer ?? false;
  const syncExternal = options?.syncExternal ?? false;
  const formatOnBlur = options?.formatOnBlur ?? 'preserve';
  const commitOnChange = options?.commitOnChange ?? false;
  const [value, setValueState] = useState<NumericDraftValue>(() => externalValueToState(externalValue, { integer }));
  const [inputValue, setInputValue] = useState<string>(() => externalValueToInputString(externalValue));
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(isEditing);

  const externalInputValue = useMemo(() => externalValueToInputString(externalValue), [externalValue]);
  const externalStateValue = useMemo(
    () => externalValueToState(externalValue, { integer }),
    [externalValue, integer],
  );

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const currentValue = syncExternal && !isEditing ? externalStateValue : value;
  const currentInputValue = syncExternal && !isEditing ? externalInputValue : inputValue;

  const setValue = useCallback((nextValue: NumericDraftExternalValue) => {
    setIsEditing(false);
    setValueState(externalValueToState(nextValue, { integer }));
    setInputValue(externalValueToInputString(nextValue));
  }, [integer]);

  const syncValue = useCallback((nextValue: NumericDraftExternalValue) => {
    if (isEditingRef.current) return;
    setValueState(externalValueToState(nextValue, { integer }));
    setInputValue(externalValueToInputString(nextValue));
  }, [integer]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    setIsEditing(true);
    setInputValue(rawValue);
    if (!commitOnChange) return;

    const parsed = parseCompleteNumericDraft(rawValue, { integer });
    if (parsed === null) return;
    setValueState(parsed);
    onCommit?.(parsed);
  }, [commitOnChange, integer, onCommit]);

  const commitRawValue = useCallback((rawValue: string) => {
    const parsed = parseCompleteNumericDraft(rawValue, { integer });
    setIsEditing(false);

    if (parsed === null) {
      setInputValue(currentValue === '' ? '' : numberToInputString(currentValue));
      return;
    }

    setValueState(parsed);
    setInputValue(formatBlurredInput(rawValue, parsed, formatOnBlur));
    onCommit?.(parsed);
  }, [currentValue, formatOnBlur, integer, onCommit]);

  const handleBlur = useCallback((e?: FocusEvent<HTMLInputElement>) => {
    commitRawValue(e?.currentTarget.value ?? currentInputValue);
  }, [commitRawValue, currentInputValue]);

  return {
    value: currentValue,
    setValue,
    syncValue,
    inputValue: currentInputValue,
    handleInputChange,
    handleBlur,
    commitRawValue,
    isEditing,
  };
}

export function numericInputAttributesFromSchema(
  schema: unknown,
  options?: { integer?: boolean },
): NumericInputAttributes {
  const s = isRecord(schema) ? schema : {};
  const minimum = finiteNumber(s.minimum);
  const maximum = finiteNumber(s.maximum);
  const exclusiveMinimum = finiteNumber(s.exclusiveMinimum);
  const exclusiveMaximum = finiteNumber(s.exclusiveMaximum);
  const multipleOf = finiteNumber(s.multipleOf);
  const integer = options?.integer ?? false;

  const attrs: NumericInputAttributes = {
    inputMode: integer ? 'numeric' : 'decimal',
    step: multipleOf && multipleOf > 0 ? numberToInputString(multipleOf) : 'any',
    pattern: integer ? '[+-]?\\d*' : '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d*)?',
  };

  const min = minimum ?? exclusiveMinimum;
  const max = maximum ?? exclusiveMaximum;
  if (min !== undefined) attrs.min = numberToInputString(min);
  if (max !== undefined) attrs.max = numberToInputString(max);
  if (exclusiveMinimum !== undefined) attrs['data-exclusive-minimum'] = numberToInputString(exclusiveMinimum);
  if (exclusiveMaximum !== undefined) attrs['data-exclusive-maximum'] = numberToInputString(exclusiveMaximum);

  return attrs;
}
