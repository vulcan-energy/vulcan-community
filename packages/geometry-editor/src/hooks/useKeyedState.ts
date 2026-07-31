// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Local state that belongs to a particular source value.
 *
 * When the source key changes, callers see the new initial value immediately instead
 * of briefly rendering the previous source's draft and resetting it in an effect.
 */
export function useKeyedState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [entry, setEntry] = useState(() => ({ key, value: initialValue }));
  if (entry.key !== key) {
    setEntry({ key, value: initialValue });
  }
  const value = entry.key === key ? entry.value : initialValue;

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setEntry((current) => {
      const currentValue = current.key === key ? current.value : initialValue;
      const nextValue = typeof action === 'function'
        ? (action as (previous: T) => T)(currentValue)
        : action;
      return { key, value: nextValue };
    });
  }, [initialValue, key]);

  return [value, setValue];
}
