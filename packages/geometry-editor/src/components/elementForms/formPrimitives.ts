// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Input-binding primitives shared by ElementCreator and its per-family form
// modules. Moved verbatim from ElementCreator.tsx: modules cannot import from
// the orchestrator component without creating an import cycle.

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useNumericDraftInput } from '../numericDraftInput';

// Custom hook for decimal input handling with proper typing support.
export const useDecimalInput = (
  initialValue: number | '' = '',
  onCommit?: (value: number | '') => void,
  options?: { commitOnChange?: boolean; formatOnBlur?: 'fixed2' | 'preserve' | 'number' },
) => useNumericDraftInput(initialValue, onCommit, {
  commitOnChange: options?.commitOnChange,
  formatOnBlur: options?.formatOnBlur ?? 'fixed2',
});

// Custom hook for integer-only input handling
// - Accepts blank while editing
// - On blur, coerces to an integer and formats without decimals
export const useIntegerInput = (
  initialValue: number | '' = '',
  onCommit?: (value: number | '') => void,
  options?: { commitOnChange?: boolean },
) => {
  const [value, setValue] = useState<number | ''>(initialValue);
  const [inputValue, setInputValue] = useState<string>(initialValue === '' ? '' : initialValue.toString());
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(isEditing);
  const commitOnChange = options?.commitOnChange ?? false;
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);
  const setExternalValue = (nextValue: number | '') => {
    setIsEditing(false);
    setValue(nextValue);
    setInputValue(nextValue === '' ? '' : nextValue.toString());
  };
  const syncValue = (nextValue: number | '') => {
    if (isEditingRef.current) return;
    setValue(nextValue);
    setInputValue(nextValue === '' ? '' : nextValue.toString());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    setIsEditing(true);
    setInputValue(rawValue);
    if (!commitOnChange) return;

    const trimmed = rawValue.trim();
    if (trimmed === '') {
      setValue('');
      onCommit?.('');
      return;
    }

    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      const rounded = Math.round(parsed);
      setValue(rounded);
      onCommit?.(rounded);
    }
  };

  const commitRawValue = (rawValue: string) => {
    setIsEditing(false);
    const emitCommit = (nextValue: number | '') => {
      if (!onCommit) return;
      setTimeout(() => onCommit(nextValue), 0);
    };
    const trimmed = rawValue.trim();
    if (trimmed === '') {
      setValue('');
      setInputValue('');
      emitCommit('');
    } else {
      const parsed = parseFloat(trimmed);
      if (!isNaN(parsed)) {
        const rounded = Math.round(parsed);
        setValue(rounded);
        setInputValue(String(rounded));
        emitCommit(rounded);
      } else {
        // Reset to previous valid value on invalid input
        setInputValue(value === '' ? '' : value.toString());
      }
    }
  };

  const handleBlur = (e?: React.FocusEvent<HTMLInputElement>) => {
    commitRawValue(e?.currentTarget.value ?? inputValue);
  };

  return {
    value,
    setValue: setExternalValue,
    syncValue,
    inputValue,
    handleInputChange,
    handleBlur,
    isEditing,
  };
};

export const decimalInputProps = (input: ReturnType<typeof useDecimalInput>) => ({
  type: 'text' as const,
  inputMode: 'decimal' as const,
  value: input.inputValue,
  onChange: input.handleInputChange,
  onBlur: input.handleBlur,
});

export const integerInputProps = (input: ReturnType<typeof useIntegerInput>) => ({
  type: 'text' as const,
  inputMode: 'numeric' as const,
  value: input.inputValue,
  onChange: input.handleInputChange,
  onBlur: input.handleBlur,
});

export const numericDraftValueOrDefault = (value: number | '', fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export function readExtraJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
