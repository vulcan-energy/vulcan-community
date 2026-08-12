// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.2 spike: render the existing custom JsonForms Advanced Fields controls directly
 * off a resolved subschema, with no <JsonForms> dispatch and no uischema. Scoped to
 * ElectricBattery only, behind `isDirectRenderAdvancedFieldsEnabled()`
 * (see `../lib/directRenderAdvancedFieldsFlag`). This module must not import anything
 * from `@jsonforms/*` — every prop shape below is inferred structurally from the
 * control components themselves (`React.ComponentProps<typeof TextControl>`, etc.),
 * matching the cast pattern in `__tests__/jsonformsRenderers.units.test.tsx`.
 */

import React from 'react';
import { dereferenceSchemaNodeInRoot } from '../lib/subschemaCache';
import { readRecord } from '../lib/jsonTypes';
import {
  BooleanControl,
  EnumControl,
  NumberControl,
  TextControl,
  schemaHasConstAlternatives,
  schemaHasEnum,
  schemaIsNullableNumberAnyOf,
  schemaTypeList,
  validateAdvancedFieldPrimitive,
} from './jsonformsRenderers';

export type DirectAdvancedFieldsProps = {
  /** The built subschema (has .properties, maybe .$defs, maybe .required) — same object AdvancedFieldsEditor passes to <JsonForms schema={...}>. */
  schema: Record<string, unknown>;
  /** advancedFieldsData — the flat extra_json record for this element. */
  data: Record<string, unknown>;
  /** The SAME jsonFormsConfig object the JsonForms mount gets. */
  config: Record<string, unknown>;
  onDataChange: (next: Record<string, unknown>) => void;
};

// Prop shape accepted by the four custom controls, inferred (not imported) from the
// control components themselves so this module never touches `@jsonforms/*` types.
type DirectControlProps = React.ComponentProps<typeof TextControl>;

/**
 * Port of the `standardRenderers` tester precedence in
 * `components/jsonformsRenderers.tsx` (registry near the bottom of that file), as it
 * applies in the Advanced Fields context (`config.advancedEditor: true`), collapsed by
 * rank (highest wins in JsonForms). The schema predicates are IMPORTED from that file —
 * the same functions the tester table itself calls — so only the rank-collapse ordering
 * below is hand-maintained, not the predicate logic:
 *
 *  - rank 1100 (x2): oneOf/anyOf where EVERY alternative declares `const` -> 'enum'
 *  - rank 1000: `schemaHasEnum` -> 'enum'
 *  - ranks 280 (`advancedFieldsNumericTester`, gated on `advancedEditor: true`) / 92
 *    (integer) / 90 (`isNumberControl`): type list includes 'number'/'integer', or a
 *    nullable-number anyOf (`schemaIsNullableNumberAnyOf`, e.g. HEM
 *    `area_per_perimeter_vent`) -> 'number'
 *  - rank 90 (`isBooleanControl`): type list includes 'boolean' -> 'boolean'
 *  - ranks 90/80 (`isStringControl`): type list includes 'string' -> 'text'
 *  - rank 5 fallback (`GenericControl`): re-checks enum-like / boolean / number-integer,
 *    else text (minus its `window_part_list` special case, which cannot occur for
 *    ElectricBattery). Structurally unreachable here — the branches above already
 *    cover every predicate GenericControl checks — so it collapses into the trailing
 *    `return 'text'` below rather than being restated as dead code.
 *
 * The `Group` accordion renderer (rank 100) and System uischemas are deliberately NOT
 * ported: out of spike scope (generated uischemas for non-System types, including
 * ElectricBattery, are flat — no groups).
 */
export function pickDirectControl(resolved: Record<string, unknown>): 'enum' | 'number' | 'boolean' | 'text' {
  if (schemaHasConstAlternatives(resolved, 'oneOf') || schemaHasConstAlternatives(resolved, 'anyOf')) return 'enum';
  if (schemaHasEnum(resolved)) return 'enum';

  const types = schemaTypeList(resolved);
  if (types.includes('number') || types.includes('integer') || schemaIsNullableNumberAnyOf(resolved)) return 'number';
  if (types.includes('boolean')) return 'boolean';

  return 'text';
}

/**
 * Tiny local start-case helper for snake_case schema keys, e.g. `battery_age` ->
 * `Battery Age`. Full rollout must match lodash `startCase` exactly (it also handles
 * camelCase, digits, consecutive caps, etc.) — this only covers the snake_case keys
 * ElectricBattery actually uses.
 */
function startCaseSnakeKey(key: string): string {
  return key
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Label for one property: `resolved.title` if present, else start-cased key.
 *
 * SPIKE FINDING: no `*` is appended for required fields, even though JsonForms core's
 * own `computeLabel(label, required, hideRequiredAsterisk)` would append one. None of
 * TextControl / NumberControl / BooleanControl / EnumControl in jsonformsRenderers.tsx
 * read the `required` prop or call `computeLabel` — the OFF path never renders a
 * required-asterisk today (verified in
 * `AdvancedFieldsEditor.electricBattery.test.tsx`, "OFF-path characterization"). The
 * brief's original spec ("append '*' … mirrors JsonForms' computeLabel") does not hold
 * for this renderer stack; matching the OFF path (not the brief) is what parity means.
 */
function labelForProperty(key: string, resolved: Record<string, unknown>): string {
  const title = resolved.title;
  return typeof title === 'string' && title.trim() ? title : startCaseSnakeKey(key);
}

export function DirectAdvancedFields({
  schema,
  data,
  config,
  onDataChange,
}: DirectAdvancedFieldsProps): React.ReactElement {
  const properties = readRecord(schema.properties);
  const requiredList = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const elementType = typeof config.elementType === 'string' ? config.elementType : undefined;

  // Resolution root for $ref lookups, built once per render (cheap: just wraps the
  // $defs the property schemas point into). Falls back to config.$defs the same way
  // AdvancedFieldsEditor's jsonFormsConfig does ("Pass $defs through config so
  // TextControl can resolve references") for callers that hand DirectAdvancedFields an
  // unfiltered subschema without its own $defs (see the EnumControl $ref probe test).
  const defs = (schema as { $defs?: unknown }).$defs ?? (config as { $defs?: unknown }).$defs;
  const resolutionRoot = { $defs: defs };

  const handleChange = React.useCallback(
    (path: string, value: unknown) => {
      // Advanced Fields paths for ElectricBattery are flat top-level keys. A dotted
      // path would mean some control in the direct-render tree tried to address a
      // nested field this spike never validated — warn once and ignore rather than
      // silently corrupt sibling data.
      if (path.includes('.') || path.includes('/')) {
        console.warn('[DirectAdvancedFields] ignoring unexpected nested path:', path);
        return;
      }
      const next = { ...data };
      if (value === undefined) {
        delete next[path];
      } else {
        next[path] = value;
      }
      onDataChange(next);
    },
    [data, onDataChange],
  );

  // Property walk deliberately mirrors JsonForms' generated-uischema enumeration:
  // `Object.keys(schema.properties)` insertion order. Iteration order is load-bearing
  // — review history: ordering drift is the one bug class that has survived review in
  // this file. Do not "helpfully" sort these keys.
  const keys = Object.keys(properties);

  return (
    <div data-testid="direct-advanced-fields">
      {keys.map((key) => {
        const resolved = readRecord(dereferenceSchemaNodeInRoot(properties[key], resolutionRoot));
        const control = pickDirectControl(resolved);
        const label = labelForProperty(key, resolved);
        const required = requiredList.includes(key);
        const validation = validateAdvancedFieldPrimitive(
          config as Parameters<typeof validateAdvancedFieldPrimitive>[0],
          elementType,
          key,
          data[key],
        );
        const errors = (validation.errors ?? []).join('\n');

        const controlProps = {
          data: data[key],
          path: key,
          label,
          schema: resolved,
          uischema: { type: 'Control', scope: `#/properties/${key}` },
          config,
          enabled: true,
          visible: true,
          required,
          errors,
          id: `direct-${key}`,
          handleChange,
          rootSchema: schema,
        } as unknown as DirectControlProps;

        switch (control) {
          case 'enum':
            return <EnumControl key={key} {...controlProps} />;
          case 'number':
            return <NumberControl key={key} {...controlProps} />;
          case 'boolean':
            return <BooleanControl key={key} {...controlProps} />;
          default:
            return <TextControl key={key} {...controlProps} />;
        }
      })}
    </div>
  );
}
