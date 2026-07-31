// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom implements the document, not the layout and media APIs browsers layer on top of
// it. Each shim below stands in for one of those, and exists because a module under test
// calls it during render rather than because the private harness happens to define it.

// Canvas panels and the resizable inspector observe their own box to lay out.
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// The theme store reads the OS colour-scheme preference on first render.
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
