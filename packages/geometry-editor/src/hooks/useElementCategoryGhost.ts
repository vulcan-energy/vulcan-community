// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useState } from 'react';
import type { Element } from '../geometry/types';
import {
  elementIsCategoryGhost,
  loadElementCategoryGhostState,
  type ElementCategoryGhostKey,
  type ElementCategoryGhostState,
  saveElementCategoryGhostState,
} from '../lib/elementCategoryVisibility';

export function useElementCategoryGhost() {
  const [state, setState] = useState<ElementCategoryGhostState>(loadElementCategoryGhostState);

  const toggleCategoryGhost = useCallback((key: ElementCategoryGhostKey) => {
    setState((prev) => {
      const next: ElementCategoryGhostState = { ...prev, [key]: !prev[key] };
      saveElementCategoryGhostState(next);
      return next;
    });
  }, []);

  const isElementCategoryGhost = useCallback(
    (el: Element) => elementIsCategoryGhost(el, state),
    [state],
  );

  return { elementCategoryGhostState: state, toggleCategoryGhost, isElementCategoryGhost };
}
