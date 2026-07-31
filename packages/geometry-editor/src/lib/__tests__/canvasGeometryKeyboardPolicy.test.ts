// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  isCanvasKeydownTargetAFormControl,
  isGeometryHistoryKeyboardCombo,
  shouldReserveNativeTextUndoForGeometry,
} from '../canvasGeometryKeyboardPolicy';

function key(mod: { meta?: boolean; ctrl?: boolean; shift?: boolean }, k: string): KeyboardEvent {
  return {
    key: k,
    ctrlKey: Boolean(mod.ctrl),
    metaKey: Boolean(mod.meta),
    shiftKey: Boolean(mod.shift),
  } as KeyboardEvent;
}

describe('canvasGeometryKeyboardPolicy', () => {
  it('isGeometryHistoryKeyboardCombo for ctrl/meta + z or y only', () => {
    expect(isGeometryHistoryKeyboardCombo(key({ meta: true }, 'z'))).toBe(true);
    expect(isGeometryHistoryKeyboardCombo(key({ meta: true }, 'Z'))).toBe(true);
    expect(isGeometryHistoryKeyboardCombo(key({ ctrl: true, shift: true }, 'Z'))).toBe(true);
    expect(isGeometryHistoryKeyboardCombo(key({ meta: true }, 'y'))).toBe(true);
    expect(isGeometryHistoryKeyboardCombo(key({ meta: true }, 'a'))).toBe(false);
    expect(isGeometryHistoryKeyboardCombo(key({}, 'z'))).toBe(false);
  });

  it('isCanvasKeydownTargetAFormControl for real form controls and contentEditable', () => {
    const input = document.createElement('input');
    const ta = document.createElement('textarea');
    const sel = document.createElement('select');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const btn = document.createElement('button');
    expect(isCanvasKeydownTargetAFormControl(input)).toBe(true);
    expect(isCanvasKeydownTargetAFormControl(ta)).toBe(true);
    expect(isCanvasKeydownTargetAFormControl(sel)).toBe(true);
    expect(isCanvasKeydownTargetAFormControl(div)).toBe(true);
    expect(isCanvasKeydownTargetAFormControl(btn)).toBe(false);
  });

  it('shouldReserveNativeTextUndoForGeometry: number and range use geometry', () => {
    const n = document.createElement('input');
    n.type = 'number';
    const r = document.createElement('input');
    r.type = 'range';
    expect(shouldReserveNativeTextUndoForGeometry(n)).toBe(false);
    expect(shouldReserveNativeTextUndoForGeometry(r)).toBe(false);
  });

  it('shouldReserveNativeTextUndoForGeometry: text fields keep native', () => {
    const t = document.createElement('input');
    t.type = 'text';
    const s = document.createElement('input');
    s.type = 'search';
    const ta = document.createElement('textarea');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(shouldReserveNativeTextUndoForGeometry(t)).toBe(true);
    expect(shouldReserveNativeTextUndoForGeometry(s)).toBe(true);
    expect(shouldReserveNativeTextUndoForGeometry(ta)).toBe(true);
    expect(shouldReserveNativeTextUndoForGeometry(div)).toBe(true);
  });

  it('shouldReserveNativeTextUndoForGeometry: select uses geometry', () => {
    const sel = document.createElement('select');
    expect(shouldReserveNativeTextUndoForGeometry(sel)).toBe(false);
  });

  it('data-allow-native-undo on ancestor reserves native for number', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-allow-native-undo', 'true');
    const n = document.createElement('input');
    n.type = 'number';
    wrap.appendChild(n);
    expect(shouldReserveNativeTextUndoForGeometry(n)).toBe(true);
  });

  it('data-geometry-undo-while-focused overrides allow-native on same branch', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-allow-native-undo', 'true');
    wrap.setAttribute('data-geometry-undo-while-focused', 'true');
    const t = document.createElement('input');
    t.type = 'text';
    wrap.appendChild(t);
    expect(shouldReserveNativeTextUndoForGeometry(t)).toBe(false);
  });

  it('data-geometry-undo-while-focused on text field allows geometry', () => {
    const t = document.createElement('input');
    t.type = 'text';
    t.setAttribute('data-geometry-undo-while-focused', 'true');
    expect(shouldReserveNativeTextUndoForGeometry(t)).toBe(false);
  });
});
