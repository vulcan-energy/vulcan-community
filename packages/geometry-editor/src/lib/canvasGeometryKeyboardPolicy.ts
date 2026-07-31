// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Decides when canvas geometry shortcuts (undo/redo vs other keys) may run
 * while focus is inside a form control. See useKeyboardShortcuts hook.
 */

const ATTR_ALLOW_NATIVE_UNDO = '[data-allow-native-undo]';
const ATTR_FORCE_GEOMETRY_UNDO = '[data-geometry-undo-while-focused]';

function resolveKeyboardTargetEL(t: EventTarget | null): HTMLElement | null {
  if (!t) {
    return null;
  }
  if (t instanceof HTMLElement) {
    return t;
  }
  if (t instanceof Node && t.parentElement) {
    return t.parentElement;
  }
  return null;
}

function isContentEditableHostElement(el: HTMLElement): boolean {
  if (el.isContentEditable) {
    return true;
  }
  const a = el.getAttribute('contenteditable');
  if (a === 'true' || a === '' || a === 'plaintext-only') {
    return true;
  }
  return false;
}

/**
 * True when the event target is a control that should block default canvas shortcuts
 * (zoom, arrows, delete, etc.), except when special handling in the hook allows
 * history shortcuts through.
 */
export function isCanvasKeydownTargetAFormControl(target: EventTarget | null): boolean {
  const el = resolveKeyboardTargetEL(target);
  if (!el) {
    return false;
  }
  if (isContentEditableHostElement(el)) {
    return true;
  }
  if (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement
  ) {
    return true;
  }
  return false;
}

const TEXT_TYPING_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', '']);

/** Cmd/Ctrl+Y redo; Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (redo on Windows) */
export function isGeometryHistoryKeyboardCombo(e: KeyboardEvent): boolean {
  if (!e.ctrlKey && !e.metaKey) {
    return false;
  }
  const k = e.key.toLowerCase();
  return k === 'y' || k === 'z';
}

/**
 * When the user is focused in a form control, should Cmd/Ctrl+Z/Y be left to the
 * browser (native in-field / OS behaviour) instead of the geometry store?
 *
 * Return `true` = reserve native, do not run `undo`/`redo`.
 * Return `false` = allow the hook to `preventDefault` and call geometry `undo`/`redo`.
 */
export function shouldReserveNativeTextUndoForGeometry(target: EventTarget | null): boolean {
  const el = resolveKeyboardTargetEL(target);
  if (!el) {
    return true;
  }
  if (el.closest(ATTR_FORCE_GEOMETRY_UNDO)) {
    return false;
  }
  if (el.closest(ATTR_ALLOW_NATIVE_UNDO)) {
    return true;
  }
  if (isContentEditableHostElement(el)) {
    return true;
  }
  if (el instanceof HTMLTextAreaElement) {
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    return false;
  }
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'number' || t === 'range') {
      return false;
    }
    if (TEXT_TYPING_INPUT_TYPES.has(t)) {
      return true;
    }
    // Picker, button-like, and unknown types: do not override browser undo
    if (
      t === 'button' ||
      t === 'submit' ||
      t === 'reset' ||
      t === 'image' ||
      t === 'checkbox' ||
      t === 'radio' ||
      t === 'file' ||
      t === 'color' ||
      t === 'hidden'
    ) {
      return false;
    }
    return true;
  }
  return true;
}
