// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDecimalInput, useIntegerInput } from '../elementForms/formPrimitives';

const typed = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

describe.each([
  ['useDecimalInput', useDecimalInput],
  ['useIntegerInput', useIntegerInput],
])('%s blur', (_name, useInput) => {
  it('writes nothing when the user did not edit the text', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInput('', onCommit));
    act(() => result.current.setValue(2));
    act(() => result.current.handleBlur());
    act(() => vi.runAllTimers());
    expect(onCommit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('commits an edit', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInput('', onCommit));
    act(() => result.current.setValue(2));
    act(() => result.current.handleInputChange(typed('3')));
    act(() => result.current.handleBlur());
    act(() => vi.runAllTimers());
    expect(onCommit.mock.calls.at(-1)?.[0]).toBe(3);
    vi.useRealTimers();
  });
});
