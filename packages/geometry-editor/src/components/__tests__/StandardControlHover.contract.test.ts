// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
const componentPath = (filename: string) =>
  resolve(componentDirectory, filename);

const designSystemCss = readFileSync(resolve(componentDirectory, '..', 'design-system.css'), 'utf8');
const inputCss = readFileSync(componentPath('StandardInput.css'), 'utf8');
const dropdownCss = readFileSync(componentPath('StandardDropdown.css'), 'utf8');
const shellCss = readFileSync(componentPath('StandardControlShell.css'), 'utf8');
const canvasCss = readFileSync(componentPath('GeometryCanvas.css'), 'utf8');

describe('shared standard-control hover contract', () => {
  it('highlights editable default inputs without advertising disabled or read-only inputs', () => {
    expect(inputCss).toMatch(
      /\.standard-input:hover:not\(:focus\):not\(:disabled\):not\(:read-only\)\s*\{[^}]*background:\s*var\(--hover-bg\)/s,
    );
  });

  it('highlights editable dropdowns without replacing their chevron background image', () => {
    expect(dropdownCss).toMatch(
      /\.standard-dropdown:hover:not\(:focus\):not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--hover-bg\)/s,
    );
    expect(dropdownCss).not.toMatch(/\.standard-dropdown-ghost[^}]*\{[^}]*\bbackground:/s);
  });

  it('highlights unit-bearing shells only when they are editable', () => {
    expect(shellCss).toMatch(
      /\.standard-control-shell:hover:not\(\.standard-control-shell-disabled\):not\(\.standard-control-shell-readonly\):not\(:focus-within\)\s*\{[^}]*background:\s*var\(--hover-bg\)/s,
    );
  });

  it('keeps error borders visible during hover', () => {
    expect(inputCss).toMatch(
      /\.standard-input-error:hover:not\(:focus\):not\(:disabled\):not\(:read-only\)\s*\{[^}]*border-color:\s*var\(--error-text\)/s,
    );
    expect(dropdownCss).toMatch(
      /\.standard-dropdown-error:hover:not\(:focus\):not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--error-text\)/s,
    );
    expect(shellCss).toMatch(
      /\.standard-control-shell-error:hover:not\(\.standard-control-shell-disabled\):not\(\.standard-control-shell-readonly\):not\(:focus-within\)\s*\{[^}]*border-color:\s*var\(--error-text\)/s,
    );
  });
});

describe('geometry editor control sizing contract', () => {
  it('keeps authoring fields and their adjacent actions on the shared large radius', () => {
    expect(designSystemCss).toMatch(
      /--form-input-radius:\s*var\(--radius-lg\)/,
    );
    expect(inputCss).toMatch(
      /\.standard-input-ghost\s*\{[^}]*border-radius:\s*var\(--form-input-radius\)/s,
    );
    expect(dropdownCss).toMatch(
      /\.standard-dropdown-ghost\s*\{[^}]*border-radius:\s*var\(--form-input-radius\)/s,
    );
    expect(shellCss).toMatch(
      /\.standard-control-shell-ghost\s*\{[^}]*border-radius:\s*var\(--form-input-radius\)/s,
    );
    expect(canvasCss).toMatch(
      /\.element-editor-input-action[^}]*border-radius:\s*var\(--form-input-radius\)/s,
    );
    expect(canvasCss).toMatch(
      /\.multi-select-field-select\s*\{[^}]*border-radius:\s*var\(--form-input-radius\)/s,
    );
  });

  it('keeps medium inputs, dropdowns, shells, and adjacent actions on the shared field height', () => {
    expect(inputCss).toMatch(
      /\.standard-input-md\s*\{[^}]*height:\s*var\(--form-input-height\)/s,
    );
    expect(dropdownCss).toMatch(
      /\.standard-dropdown-md\s*\{[^}]*height:\s*var\(--form-input-height\)/s,
    );
    expect(shellCss).toMatch(
      /\.standard-control-shell-md\s*\{[^}]*height:\s*var\(--form-input-height\)/s,
    );
    expect(canvasCss).toMatch(
      /\.element-editor-input-action[^}]*height:\s*var\(--form-input-height\)/s,
    );
    expect(canvasCss).toMatch(
      /\.multi-select-field-select\s*\{[^}]*min-height:\s*var\(--form-input-height\)/s,
    );
    expect(inputCss).not.toMatch(
      /@media\s*\(max-width:\s*768px\)[\s\S]*\.standard-input-md\s*\{[^}]*height:/,
    );
  });

  it('does not shrink every standard form control just because it is inside the canvas', () => {
    expect(canvasCss).not.toContain(
      '.geometry-canvas .standard-input,\n.geometry-canvas .standard-dropdown',
    );
    expect(canvasCss).toContain('.geometry-canvas .filename-bar .standard-input');
    expect(canvasCss).toContain('.geometry-canvas .overlay-drawtoolbar .standard-dropdown');
  });

  it('does not shrink every button just because it is inside the canvas', () => {
    expect(canvasCss).not.toContain(
      '.geometry-canvas .btn,\n.geometry-canvas .btn-standard',
    );
    expect(canvasCss).toContain('.geometry-canvas .btn-nav');
  });
});
