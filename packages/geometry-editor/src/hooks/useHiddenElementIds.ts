// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo } from 'react';
import {
  loadHiddenElementIds,
  saveHiddenElementIds,
  storageKeyForIndividualHidden,
} from '../lib/elementIndividualVisibility';
import { useKeyedState } from './useKeyedState';

export function useHiddenElementIds(filename: string | undefined, validElementIds: readonly string[]) {
  const storageKey = useMemo(() => storageKeyForIndividualHidden(filename), [filename]);

  const validSet = useMemo(() => new Set(validElementIds), [validElementIds]);
  const initialHiddenIds = useMemo(
    () => new Set([...loadHiddenElementIds(storageKey)].filter((id) => validSet.has(id))),
    [storageKey, validSet],
  );
  const validIdsKey = useMemo(() => [...validSet].sort().join('\0'), [validSet]);
  const [hiddenIds, setHiddenIds] = useKeyedState(
    `${storageKey}\0${validIdsKey}`,
    initialHiddenIds,
  );

  useEffect(() => {
    saveHiddenElementIds(storageKey, hiddenIds);
  }, [hiddenIds, storageKey]);

  const toggleElementsHidden = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      setHiddenIds((prev) => {
        const allHidden = ids.every((id) => prev.has(id));
        const next = new Set(prev);
        if (allHidden) {
          for (const id of ids) next.delete(id);
        } else {
          for (const id of ids) next.add(id);
        }
        return next;
      });
    },
    [setHiddenIds],
  );

  const unhideElement = useCallback(
    (id: string) => {
      setHiddenIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [setHiddenIds],
  );

  return { hiddenElementIds: hiddenIds, toggleElementsHidden, unhideElement };
}
