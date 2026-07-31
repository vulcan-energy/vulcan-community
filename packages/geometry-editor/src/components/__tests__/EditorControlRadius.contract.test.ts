// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

function productionComponentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionComponentFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

type JsxOpening = Readonly<{ text: string; line: number }>;

function jsxOpenings(
  path: string,
  names: ReadonlySet<string>,
): Readonly<{ source: string; openings: readonly JsxOpening[] }> {
  const source = readFileSync(path, 'utf8');
  const tagPattern = new RegExp(`<(${[...names].join('|')})\\b`, 'g');
  const openings: JsxOpening[] = [];

  for (const match of source.matchAll(tagPattern)) {
    const start = match.index;
    let braceDepth = 0;
    let quote: "'" | '"' | '`' | null = null;

    for (let index = start + match[0].length; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === '\\') {
          index += 1;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === '{') {
        braceDepth += 1;
      } else if (character === '}') {
        braceDepth -= 1;
      } else if (character === '>' && braceDepth === 0) {
        openings.push({
          text: source.slice(start, index + 1),
          line: source.slice(0, start).split('\n').length,
        });
        break;
      }
    }
  }

  return { source, openings };
}

describe('geometry editor authoring-control radius contract', () => {
  it('makes every production StandardInput and StandardDropdown authoring field explicitly ghost', () => {
    const failures = productionComponentFiles(componentDirectory).flatMap((path) => {
      const { openings } = jsxOpenings(path, new Set(['StandardInput', 'StandardDropdown']));
      return openings.flatMap((opening) =>
        /\bvariant\s*=\s*["']ghost["']/.test(opening.text)
          ? []
          : [`${path.slice(componentDirectory.length + 1)}:${opening.line}`],
      );
    });

    expect(failures).toEqual([]);
  });

  it('keeps the bespoke preset-name field on the authoring-field radius', () => {
    const elementCreator = readFileSync(join(componentDirectory, 'ElementCreator.tsx'), 'utf8');
    expect(elementCreator).toContain(
      'className="standard-input standard-input-md standard-input-ghost"',
    );
  });

  it('uses the authoring-field radius and height for searchable select triggers', () => {
    const searchablePath = join(componentDirectory, 'SearchableDescribedSelect.tsx');
    const { openings } = jsxOpenings(searchablePath, new Set(['button']));
    const trigger = openings.find((opening) => opening.text.includes('aria-haspopup="listbox"'));

    expect(trigger?.text).toContain('standard-dropdown-ghost');
    expect(trigger?.text).toContain("height: 'var(--form-input-height)'");
    expect(trigger?.text).toContain("borderRadius: 'var(--form-input-radius)'");
  });

  it('uses one ghost shell for read-only advanced enum fields', () => {
    const rendererPath = join(componentDirectory, 'jsonformsRenderers.tsx');
    const { source, openings } = jsxOpenings(rendererPath, new Set(['StandardControlShell']));
    const readOnlyShell = openings.find((opening) => /\breadOnly\b/.test(opening.text));
    const readOnlyBranch = source.slice(source.indexOf('if (isReadOnly)'));

    expect(readOnlyShell?.text).toContain('variant="ghost"');
    expect(readOnlyBranch).toMatch(/borderRadius:\s*'inherit'/);
    expect(readOnlyBranch).toMatch(/border:\s*0/);
  });

  it('uses the shared authoring-field radius and height for native assembly controls', () => {
    const assemblyPath = join(componentDirectory, 'AssemblyCalculatorModal.tsx');
    const { source: assemblyText, openings: selects } = jsxOpenings(
      assemblyPath,
      new Set(['select']),
    );

    expect(selects).toHaveLength(6);
    for (const select of selects) {
      expect(select.text).toContain("borderRadius: 'var(--form-input-radius)'");
      expect(select.text).toContain("height: 'var(--form-input-height)'");
    }

    expect(assemblyText).toMatch(
      /const assemblyStackNumberInputStyle:[\s\S]*?borderRadius:\s*'var\(--form-input-radius\)'/,
    );
    expect(assemblyText).toMatch(
      /const assemblyStackNumberInputStyle:[\s\S]*?height:\s*'var\(--form-input-height\)'/,
    );

    const { openings: numberInputs } = jsxOpenings(
      assemblyPath,
      new Set(['DraftSafeNumberInput']),
    );
    expect(numberInputs).toHaveLength(9);
    for (const input of numberInputs) {
      const usesSharedStyle = input.text.includes('assemblyStackNumberInputStyle');
      const usesSharedTokens =
        input.text.includes("borderRadius: 'var(--form-input-radius)'") &&
        input.text.includes("height: 'var(--form-input-height)'");
      expect(
        usesSharedStyle || usesSharedTokens,
        `AssemblyCalculatorModal.tsx:${input.line}`,
      ).toBe(true);
    }
  });

  it('uses the shared authoring-field treatment for the ground-calculator number input', () => {
    const groundPath = join(componentDirectory, 'GroundUValueCalculatorModal.tsx');
    const { openings } = jsxOpenings(groundPath, new Set(['DraftSafeNumberInput']));

    expect(openings).toHaveLength(1);
    expect(openings[0]?.text).toContain("borderRadius: 'var(--form-input-radius)'");
    expect(openings[0]?.text).toContain("height: 'var(--form-input-height)'");
  });

  it('matches field-adjacent actions to the authoring-field radius and height', () => {
    const multiSelectPath = join(componentDirectory, 'MultiSelectPanel.tsx');
    const { openings: multiSelectButtons } = jsxOpenings(multiSelectPath, new Set(['button']));
    const libraryButton = multiSelectButtons.find((opening) => opening.text.includes('prefetchAssemblyCalculatorModal'));
    expect(libraryButton?.text).toContain('element-editor-input-action');

    const assemblyPath = join(componentDirectory, 'AssemblyCalculatorModal.tsx');
    const { openings: assemblyButtons } = jsxOpenings(assemblyPath, new Set(['button']));
    const fieldActions = assemblyButtons.filter(
      (opening) =>
        opening.text.includes('title="Repeating bridges in this thickness') ||
        opening.text.includes('aria-label="Remove bridge"'),
    );
    expect(fieldActions).toHaveLength(2);
    for (const action of fieldActions) {
      expect(action.text).toContain('style={assemblyFieldActionStyle}');
    }

    const presetCss = readFileSync(join(componentDirectory, 'PresetDropdown.css'), 'utf8');
    expect(presetCss).toMatch(
      /\.preset-icon-btn\s*\{[\s\S]*?border-radius:\s*var\(--form-input-radius\)/,
    );
  });
});
