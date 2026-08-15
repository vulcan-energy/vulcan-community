// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import type { GeometrySchemaParameterInfo, GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { type SchemaNode } from '../../lib/schemaTypes';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { unwrapNullableSchema } from '../../lib/schemaShape';
import { EnumControl, NumberControl, TextControl } from '../jsonformsRenderers';

afterEach(cleanup);

const schemaPort: GeometrySchemaPort = {
  availability: 'available',
  preload: async () => undefined,
  getRootSchema: () => ({}),
  getElementSubschema: () => ({}),
  getBaseFieldsForElementType: () => [],
  getApplianceKeys: () => [],
  getStrictestIntegerKeysForElementType: () => new Set(),
  getSchemaSubtypeForElementData: () => undefined,
  getConditionalRequiredFields: () => [],
  validateProperty: () => ({ valid: true }),
  findParameter: () => null,
};

function renderControl(
  Control: typeof NumberControl | typeof EnumControl | typeof TextControl,
  {
    data = 0.25,
    path = 'field',
    label = 'Field',
    schema = { type: 'number', units: 'm' },
    uischema = { type: 'Control', scope: '#/properties/field' },
    config = {},
    enabled = true,
    handleChange = vi.fn(),
    defaultsJson = null,
    contextSchemaPort = null,
  }: {
    data?: unknown;
    path?: string;
    label?: string;
    schema?: Record<string, unknown>;
    uischema?: Record<string, unknown>;
    config?: Record<string, unknown>;
    enabled?: boolean;
    handleChange?: ReturnType<typeof vi.fn>;
    /**
     * Seeds the store's template defaults. The controls read their default value off
     * the store (`useDefaultValues`/`useDefaultsLookup`), not off `config`, so this is
     * the only way to reach the default-wins branch of the placeholder ladder. Left
     * `null` by default: every pre-existing case here wants "no template default".
     */
    defaultsJson?: Record<string, unknown> | null;
    /**
     * Mounts the control inside a `GeometryEditorServicePortsProvider` carrying this
     * port. `null` (the default) mounts with NO provider above the control, which is
     * what every pre-existing case here wants and what makes `useGeometrySchemaPort()`
     * hand back `unavailableGeometrySchemaPort`.
     */
    contextSchemaPort?: GeometrySchemaPort | null;
  } = {},
) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  if (defaultsJson !== null) store.setState({ defaultsJson });
  const props = {
    data,
    path,
    // R4.6b-2: `propKey` is a required prop now, supplied by whichever walk mounts the
    // control (`DirectAdvancedFields` / `DirectSpecFields`, both of which hold the decoded
    // leaf segment). This harness stands in for that walk, so it derives the same key the
    // walk would for these single-hop paths rather than making every case restate it.
    propKey: path.split('.').pop() ?? path,
    label,
    schema,
    uischema,
    config: {
      advancedEditor: true,
      elementType: 'TestElement',
      schemaPort,
      ...config,
    },
    handleChange,
    enabled,
    errors: '',
    id: `control-${path}`,
    required: false,
    visible: true,
    rootSchema: schema,
  };

  const tree = (
    <GeometryStoreProvider store={store}>
      <Control {...props as never} />
    </GeometryStoreProvider>
  );

  return {
    handleChange,
    ...render(
      contextSchemaPort
        ? (
          <GeometryEditorServicePortsProvider
            schemaPort={contextSchemaPort}
            workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
          >
            {tree}
          </GeometryEditorServicePortsProvider>
        )
        : tree,
    ),
  };
}

function expectUnit(unit: string): HTMLElement {
  return screen.getByText(unit, { selector: '.standard-control-unit' });
}

describe('advanced numeric field presentations', () => {
  it.each([
    ['plain', { type: 'number', units: 'm' }],
    ['integer', { type: 'integer', units: 'm3/h' }],
    ['nullable', { anyOf: [{ type: 'number' }, { type: 'null' }], units: 'l/s' }],
  ])('renders a normalized unit for a %s number control', (_kind, schema) => {
    renderControl(NumberControl, { schema });
    expect(expectUnit(schema.units === 'm3/h' ? 'm³/h' : schema.units === 'l/s' ? 'L/s' : 'm')).toBeVisible();
  });

  it('uses the active conditional schema override for both label and adornment', () => {
    renderControl(NumberControl, {
      label: 'Flow temperature (degrees C)',
      schema: { type: 'number', units: 'K' },
      uischema: {
        type: 'Control',
        scope: '#/properties/field',
        options: { schemaOverride: { type: 'number', units: 'degrees C' } },
      },
    });

    expect(expectUnit('°C')).toBeVisible();
    expect(screen.getByText('Flow temperature')).toBeVisible();
    expect(screen.queryByText('Flow temperature (degrees C)')).not.toBeInTheDocument();
  });

  it('keeps a fraction numeric-enum value unchanged', () => {
    const handleChange = vi.fn();
    renderControl(EnumControl, {
      path: 'frame_area_fraction',
      label: 'Frame area fraction',
      schema: { type: 'number', enum: [0.25, 0.5] },
      config: { elementType: 'BuildingElementTransparent' },
      handleChange,
    });

    expect(expectUnit('fraction')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0.5' } });
    expect(handleChange).toHaveBeenCalledWith('frame_area_fraction', 0.5);
  });

  it('keeps the adornment on a read-only numeric enum', () => {
    renderControl(EnumControl, {
      schema: { type: 'number', enum: [0.25, 0.5], units: 'fraction' },
      enabled: false,
    });

    expect(expectUnit('fraction')).toBeVisible();
    expect(screen.getByText('0.25')).toHaveAttribute('aria-readonly', 'true');
  });

  it.each([
    [
      'Calculate R_u',
      'thermal_resistance_unconditioned_space',
      'BuildingElementAdjacentUnconditionedSpace_Simple',
      { openRuCalculator: vi.fn() },
    ],
    [
      'Calc U',
      'u_value',
      'BuildingElementGround',
      { openGroundUCalculator: vi.fn() },
    ],
  ])('uses the shared field-action sizing for %s', (buttonName, path, elementType, actionConfig) => {
    renderControl(NumberControl, {
      data: null,
      path,
      label: path,
      config: { elementType, ...actionConfig },
    });

    const button = screen.getByRole('button', { name: buttonName });
    expect(button).toHaveClass('element-editor-input-action');
    expect(button).not.toHaveClass('btn-nav');
    expect(button).not.toHaveAttribute('style');
  });

  // Ported from the deleted web jsonformsRenderers.test.tsx's "R_u field action
  // button" describe block (parent repo, R4.5) -- the it.each above only covers the
  // no-value ("Calculate R_u") branch and only asserts CSS classes; this is the
  // has-value label flip, asserted on the button's actual text.
  it('shows Edit R_u once the unheated-space resistance field has a value', () => {
    renderControl(NumberControl, {
      data: 0.45,
      path: 'thermal_resistance_unconditioned_space',
      label: 'thermal_resistance_unconditioned_space',
      config: {
        elementType: 'BuildingElementAdjacentUnconditionedSpace_Simple',
        openRuCalculator: vi.fn(),
      },
    });

    const button = screen.getByRole('button', { name: 'Edit R_u' });
    expect(button.textContent).toBe('Edit R_u');
    expect(button).toHaveAttribute('title', 'Edit calculated R_u');
  });

  // Ported from the deleted web jsonformsRenderers.test.tsx's "JsonForms Renderers -
  // Number Draft Editing" describe block (parent repo, R4.5): schema `minimum`/
  // `maximum` map to `min`/`max`, and with no `multipleOf` the step stays the generic
  // `'any'` -- `numericInputAttributesFromSchema` must not invent a precision the
  // schema never declared.
  it('maps schema number ranges to input constraints without inventing precision', () => {
    renderControl(NumberControl, {
      data: 0.16,
      path: 'psi_wall_floor_junc',
      label: 'psi_wall_floor_junc',
      schema: { type: 'number', minimum: 0, maximum: 2 },
      config: { elementType: 'BuildingElementGround' },
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('2');
    expect(input.getAttribute('step')).toBe('any');
  });
});

/**
 * R4.5 FOLLOW-UP, closed in R4.6a. `TextControl`'s JSON-blob rows (object/array-typed
 * properties, rendered as an editable `JSON.stringify` string) parse the typed text
 * back into a real value on BLUR. That handler used to early-return on
 * `!elementType || !propKey` BEFORE the parse, even though only the VALIDATION step
 * needs those two — so a host that supplies neither committed the raw string that
 * `onChange` writes on every keystroke, and the parse never ran at all.
 *
 * The host that hits this is web's `SnippetEditor` (parent repo), which mounts with
 * `config={{}}`: editing a nested object there wrote
 * `{"orientation":"{\"add_degrees\":42}"}` instead of `{"orientation":{"add_degrees":42}}`.
 * Its own characterization test currently PINS the broken string, with a KNOWN-ISSUE
 * comment; that pin is updated parent-side, not here. These cases are the
 * community-side coverage for the same behaviour, per the test-move policy (coverage
 * for community code lives in community).
 *
 * The last two came out of R4.6a review round 1, and both cover the boundary rather
 * than the happy path: that the guarded branch commits ONLY IF VALIDATION PASSES (the
 * module's default stub port always says valid, so the original case could only ever
 * prove that a commit happened), and that a bare tab-through of an already-empty row
 * emits nothing at all.
 */
describe('TextControl JSON-blob commit (R4.5 follow-up, R4.6a)', () => {
  const objectSchema = { type: 'object' };

  /**
   * `data` is the value the HOST currently holds for the row; `raw` is what the user
   * leaves in the input before blurring. `typed: false` blurs WITHOUT an intervening
   * `onChange`, which is what a bare tab-through looks like.
   */
  function blurWith(
    raw: string,
    config: Record<string, unknown>,
    { data = {} as unknown, typed = true }: { data?: unknown; typed?: boolean } = {},
  ) {
    const handleChange = vi.fn();
    renderControl(TextControl, {
      data,
      path: 'orientation',
      label: 'Orientation',
      schema: objectSchema,
      config,
      handleChange,
    });
    const input = screen.getByRole('textbox');
    if (typed) fireEvent.change(input, { target: { value: raw } });
    fireEvent.blur(input, { target: { value: raw } });
    return { handleChange, input };
  }

  it('commits a parsed object when the host supplies no elementType (the SnippetEditor case)', () => {
    const { handleChange } = blurWith('{"add_degrees":42}', { elementType: undefined });
    expect(handleChange).toHaveBeenLastCalledWith('orientation', { add_degrees: 42 });
    // The failure this replaces: the last committed value was the raw STRING, so the
    // host persisted a JSON-encoded string where an object belongs.
    expect(handleChange).not.toHaveBeenLastCalledWith('orientation', '{"add_degrees":42}');
  });

  it('still validates before committing when the host DOES supply elementType (Advanced Fields, unchanged)', () => {
    const { handleChange } = blurWith('{"add_degrees":42}', {});
    expect(handleChange).toHaveBeenLastCalledWith('orientation', { add_degrees: 42 });
  });

  it('commits ONLY IF valid when an elementType is present -- an invalid parse sets the error and is not committed', () => {
    // R4.6a review round 1: the case above proves a commit HAPPENS, but the module's
    // stub `schemaPort.validateProperty` always returns `{valid:true}`, so it says
    // nothing about the "only if valid" half of the guarded branch. Override the port
    // for this one mount so validation actually rejects.
    const rejectingPort: GeometrySchemaPort = {
      ...schemaPort,
      validateProperty: () => ({ valid: false, errors: ['must be an object of the right shape'] }),
    };
    const { handleChange } = blurWith('{"add_degrees":42}', { schemaPort: rejectingPort });

    // The blur added no commit: the last call is still the per-keystroke raw string
    // `onChange` wrote, not the parsed object.
    expect(handleChange).toHaveBeenLastCalledWith('orientation', '{"add_degrees":42}');
    expect(handleChange).not.toHaveBeenCalledWith('orientation', { add_degrees: 42 });
    expect(screen.getByText('must be an object of the right shape')).toBeVisible();
  });

  it('reports invalid JSON and commits nothing new, with or without an elementType', () => {
    for (const config of [{ elementType: undefined }, {}]) {
      const { handleChange } = blurWith('{not json', config);
      expect(screen.getByText(/Invalid JSON/)).toBeVisible();
      // Only the per-keystroke raw-string `onChange` fired; blur added no commit.
      expect(handleChange).toHaveBeenLastCalledWith('orientation', '{not json');
      cleanup();
    }
  });

  it('clearing a populated row still unsets, regardless of host config', () => {
    for (const config of [{ elementType: undefined }, {}]) {
      // `onChange` has already written the empty STRING to the host by blur time,
      // which is what distinguishes a real clear from a tab-through.
      const { handleChange } = blurWith('   ', config, { data: { add_degrees: 42 } });
      expect(handleChange).toHaveBeenLastCalledWith('orientation', undefined);
      cleanup();
    }
  });

  it('R4.6a review round 1: tabbing through an already-empty row emits NOTHING -- no spurious dirty', () => {
    // A JSON-blob row renders '' for absent data AND for an empty `{}`/`[]`, so a bare
    // focus/blur used to reach the empty-input branch and emit
    // `handleChange(path, undefined)` -- which `setAtPath` turns into a fresh object
    // identity and the host turns into "this element changed". Both hosts are covered:
    // the config-less one, where moving the R4.5 guard newly exposed this, and the
    // element editor, where it has been latent since the handler was written.
    for (const config of [{ elementType: undefined }, {}]) {
      for (const data of [undefined, null, {}, []]) {
        const { handleChange } = blurWith('', config, { data, typed: false });
        expect(handleChange).not.toHaveBeenCalled();
        cleanup();
      }
    }
  });
});

/**
 * Ported from the deleted web `jsonformsRenderers.test.tsx` (parent repo, R4.5). Five
 * of that file's seventeen cases never went through the `<JsonForms renderers={...}>`
 * mount the deletion was justified by — they did `render(<TextControl {...props} />)`
 * directly, so they were community behaviour tests sitting in the wrong repo and were
 * dropped with no equivalent. Re-seated here on the current prop shape
 * (`AdvancedControlProps` + this file's `renderControl`), not copied verbatim; the
 * originals predate `schemaPort`, the store-injected defaults, and R4.5's local
 * control-props type.
 *
 * What they are the only coverage OF, and therefore what they are written to fail on:
 *
 *  - Placeholder WIRING, not placeholder GENERATION. `generateRobustPlaceholder`'s own
 *    unit tests (`lib/__tests__/schemaPlaceholders.test.ts`) survived R4.5 and pin the
 *    strings; nothing pinned that `TextControl` calls it with the row's resolved schema
 *    and `$defs`, suppresses it once the row has content, prefers a template default
 *    over it, and renders the result as the input's `placeholder` ATTRIBUTE. Assertions
 *    below therefore read `getAttribute('placeholder')` — a `textContent` assertion
 *    cannot see a placeholder at all, which is how this stayed unpinned.
 *  - The empty-value sentinel rule (`isMeaningfulExplicitValue` ->
 *    `getStatusPillType` / `shouldShowResetToSource`, `jsonformsRenderers.tsx`): `''`,
 *    `'{}'` and `'[]'` are blank-like, NOT user overrides. Nothing anywhere referenced
 *    those symbols or the `custom-value` class. The last case pins it through its three
 *    observable consequences, so a regression to a bare `data !== undefined` fails it.
 */
describe('TextControl placeholder wiring and blank-like sentinels (ported from the deleted web registry test, R4.5)', () => {
  // `data: null` below stands in for the originals' `data: undefined`: `renderControl`'s
  // destructuring default (`data = 0.25`) fires on an explicit `undefined`, so passing
  // one would silently mount a numeric value instead of an empty row. `null` and
  // `undefined` are indistinguishable to everything asserted here — both render '' and
  // both are blank-like to `isMeaningfulExplicitValue`.

  /** `type: ['array','null']` + `items.$ref` + sibling `$defs` — the live window shape. */
  function arrayOfRefSchema(defName: string, def: Record<string, unknown>) {
    return {
      type: ['array', 'null'],
      items: { $ref: `#/$defs/${defName}` },
      $defs: { [defName]: def },
    };
  }

  const treatmentSchema = arrayOfRefSchema('WindowTreatment', {
    type: 'object',
    properties: {
      controls: {
        type: 'string',
        enum: ['auto_motorised', 'combined_light_blind_HVAC', 'manual', 'manual_motorised'],
      },
      delta_r: { type: 'number' },
      trans_red: { type: 'number' },
      type: { type: 'string', enum: ['blinds', 'curtains'] },
    },
  });

  function placeholderOf(): string | null {
    return (screen.getByRole('textbox') as HTMLInputElement).getAttribute('placeholder');
  }

  it('resolves a nested $ref through the row schema\'s own $defs, and drops the placeholder once the row is populated', () => {
    renderControl(TextControl, {
      data: null,
      path: 'treatment',
      label: 'Treatment',
      schema: treatmentSchema,
      config: { elementType: 'BuildingElementTransparent' },
    });
    // The item `$ref` is resolved against the schema's own `$defs`, and every property
    // of the resolved object appears — not `[]`, which is what an unresolved `$ref`
    // degrades to.
    expect(placeholderOf()).toBe(
      '[{"controls":"auto_motorised","delta_r":1,"trans_red":1,"type":"blinds"}]',
    );
    cleanup();

    // Second half of the wiring: a populated row shows its value, never a hint on top
    // of it.
    renderControl(TextControl, {
      data: [{ type: 'curtains' }],
      path: 'treatment',
      label: 'Treatment',
      schema: treatmentSchema,
      config: { elementType: 'BuildingElementTransparent' },
    });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('[{"type":"curtains"}]');
    expect(placeholderOf()).toBeNull();
  });

  it('picks the object-ish branch of a oneOf item schema (shading)', () => {
    renderControl(TextControl, {
      data: null,
      path: 'shading',
      label: 'Shading',
      schema: arrayOfRefSchema('WindowShadingObject', {
        oneOf: [
          {
            type: 'object',
            properties: {
              height: { type: 'number' },
              distance: { type: 'number' },
              transparency: { type: 'number' },
              type: { type: 'string', enum: ['obstacle'] },
            },
          },
        ],
      }),
      config: { elementType: 'BuildingElementTransparent' },
    });

    expect(placeholderOf()).toBe('[{"height":1,"distance":1,"transparency":1,"type":"obstacle"}]');
  });

  it('generates a single-property item example (window_part_list)', () => {
    renderControl(TextControl, {
      data: null,
      path: 'window_part_list',
      label: 'Window Part List',
      schema: arrayOfRefSchema('WindowPart', {
        type: 'object',
        properties: { mid_height_air_flow_path: { type: 'number' } },
      }),
      config: { elementType: 'BuildingElementTransparent' },
    });

    expect(placeholderOf()).toBe('[{"mid_height_air_flow_path":1}]');
  });

  it('prefers a template default over the schema example, and JSON-stringifies it instead of rendering [object Object]', () => {
    // The original case asserted only that `[object Object]` was absent, from a mount
    // with no default at all — so it could not reach the branch that produces one. An
    // object-valued template default is exactly that branch: the ladder's PRIORITY 1
    // arm has to stringify it, and `String(someObject)` is `'[object Object]'`.
    renderControl(TextControl, {
      data: null,
      path: 'treatment',
      label: 'Treatment',
      schema: treatmentSchema,
      config: { elementType: 'BuildingElementTransparent' },
      // Shaped for `getDefaultValue`'s typed depth-first search: it only returns a
      // value from a node whose own `type` matches the control's `elementType`.
      defaultsJson: {
        BuildingElement: {
          'window 1': {
            type: 'BuildingElementTransparent',
            treatment: [{ type: 'blinds', controls: 'manual' }],
          },
        },
      },
    });

    const placeholder = placeholderOf();
    expect(placeholder).not.toContain('[object Object]');
    // The default, not the schema example the same mount would otherwise have shown
    // (asserted verbatim in the first case above) — so this pins the ladder's order too.
    expect(placeholder).toBe('[{"type":"blinds","controls":"manual"}]');
  });

  it('treats \'\', \'{}\', \'[]\' and empty containers as blank-like, not as a user override', () => {
    // The ONLY coverage of `isMeaningfulExplicitValue`. Asserted through all three of
    // its observable consequences, because each fails on a different mutation of the
    // rule: the status pill (`getStatusPillType`), the reset-to-source affordance
    // (`shouldShowResetToSource`), and the `custom-value` class on the input container.
    // A regression to `data !== undefined` shows up in at least one of the three for
    // every value below.
    for (const [data, displayed] of [
      ['', ''],
      ['{}', '{}'],
      ['[]', '[]'],
      [[], ''],
      [{}, ''],
    ] as Array<[unknown, string]>) {
      renderControl(TextControl, {
        data,
        path: 'treatment',
        label: 'Treatment',
        schema: treatmentSchema,
        config: { elementType: 'BuildingElementTransparent' },
      });

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe(displayed);
      expect(screen.queryByText('Custom')).not.toBeInTheDocument();
      expect(screen.getByText('Schema')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
      expect(input.closest('.standard-input-container')).not.toHaveClass('custom-value');
      cleanup();
    }

    // Contrast, so the loop above cannot pass by asserting nothing ever renders: a
    // genuinely non-empty value on the same field DOES read as a user override.
    renderControl(TextControl, {
      data: [{ type: 'blinds' }],
      path: 'treatment',
      label: 'Treatment',
      schema: treatmentSchema,
      config: { elementType: 'BuildingElementTransparent' },
    });
    expect(screen.getByText('Custom')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeVisible();
    expect(screen.getByRole('textbox').closest('.standard-input-container')).toHaveClass(
      'custom-value',
    );
  });
});

/**
 * R4.6a REGRESSION, the WIRING half. `lib/__tests__/schemaPlaceholders.test.ts` pins
 * what `generateRobustPlaceholder` RETURNS for a dictionary schema; this pins that
 * `TextControl` actually renders it, on the real published node, through the real
 * `unwrapNullableSchema`. Generator coverage without wiring coverage is exactly what
 * let the original placeholder bugs through — see the ported block above — so the
 * assertions below read the `placeholder` ATTRIBUTE and the "Copy example" clipboard
 * payload, which is the surface a user actually pastes from.
 */
describe('TextControl renders `{}` for a dictionary row (R4.6a regression)', () => {
  /** Root property with its `$ref` followed once, as the walks deliver it. */
  function publishedNode(root: SchemaNode, container: string, property: string): SchemaNode {
    const node = root.properties?.[container] as SchemaNode;
    const resolved =
      typeof node.$ref === 'string' ? (root.$defs ?? {})[node.$ref.replace('#/$defs/', '')] : node;
    return resolved.properties?.[property] as SchemaNode;
  }

  function mountAndReadPlaceholder(
    root: SchemaNode,
    container: string,
    property: string,
    { unwrap }: { unwrap: boolean },
  ): { placeholder: string | null; copyExample: HTMLElement | null } {
    const published = publishedNode(root, container, property);
    renderControl(TextControl, {
      data: null,
      path: `${container}.${property}`,
      label: property,
      schema: unwrap ? unwrapNullableSchema(published) : published,
      config: { elementType: 'System', subtype: container, $defs: root.$defs },
    });
    return {
      placeholder: (screen.getByRole('textbox') as HTMLInputElement).getAttribute('placeholder'),
      copyExample: screen.queryByRole('button', { name: 'Copy example' }),
    };
  }

  // Core, WRAPPED: `anyOf:[dict,{type:'null'}]`. Before R4.6a the wrapper reached the
  // generator intact and produced `{}`; the unwrap strips it, and without the guard fix
  // the same field then offered `[]`, which the editor ACCEPTED and committed — see the
  // measured note in `lib/schemaPlaceholders.ts`: per-property validation is a no-op on
  // every System-walk row, so the bad example landed in `extra_json` silently rather
  // than erroring. This test cannot observe that half (`renderControl` injects a stub
  // schemaPort whose `validateProperty` always returns valid), and does not claim to —
  // it pins the placeholder. Asserting both columns makes the regression a single
  // readable equality rather than a remembered "it used to be".
  it.each([
    ['InfiltrationVentilation', 'MechanicalVentilation'],
    ['HotWaterDemand', 'Bath'],
    ['HotWaterDemand', 'Other'],
    ['HotWaterDemand', 'Shower'],
  ])('core System:%s.%s renders `{}` wrapped AND unwrapped', (container, property) => {
    for (const unwrap of [false, true]) {
      const { placeholder } = mountAndReadPlaceholder(coreSchema as never, container, property, { unwrap });
      expect(placeholder).toBe('{}');
      cleanup();
    }
  });

  // DECLARED PRE-EXISTING CHANGE: never wrapped, so these rendered `[]` before R4.6a as
  // well as after, on both profiles. The same guard fix corrects them.
  it.each([
    ['core', 'InfiltrationVentilation', 'Vents'],
    ['fhs', 'InfiltrationVentilation', 'Vents'],
    ['fhs', 'InfiltrationVentilation', 'MechanicalVentilation'],
    ['fhs', 'HotWaterDemand', 'Shower'],
  ] as Array<['core' | 'fhs', string, string]>)(
    '%s System:%s.%s: a bare dictionary renders `{}`',
    (profile, container, property) => {
      const root = (profile === 'core' ? coreSchema : fhsSchema) as never as SchemaNode;
      const { placeholder } = mountAndReadPlaceholder(root, container, property, { unwrap: true });
      expect(placeholder).toBe('{}');
    },
  );

  it('offers the same `{}` on the clipboard, which is the half that errored on paste', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { placeholder, copyExample } = mountAndReadPlaceholder(
      coreSchema as never,
      'InfiltrationVentilation',
      'MechanicalVentilation',
      { unwrap: true },
    );
    expect(placeholder).toBe('{}');
    expect(copyExample).not.toBeNull();

    fireEvent.click(copyExample as HTMLElement);
    expect(writeText).toHaveBeenCalledWith('{}');
    // The exact string the bug put on the clipboard, named so the pin cannot be read
    // as merely "some placeholder exists".
    expect(writeText).not.toHaveBeenCalledWith('[]');
  });
});

/**
 * R4.6b-1 fix round: WHICH schema port a control row's label reads.
 *
 * R4.6b-1 moved Text/Boolean/WindowPartList off `ProviderFieldLabelWithTooltip` (which
 * read the CONTEXT port via `useGeometrySchemaPort`) and onto the informed path (which
 * read `config.schemaPort`). In the community Advanced Fields grid the two are the same
 * object, so nothing moved; in a host that mounts a control with `config={{}}` inside a
 * `GeometryEditorServicePortsProvider` — which is how the parent repo's snippet editors
 * mount `DirectSpecFields` — the move silently swapped a real port for `unavailable` and
 * dropped every tooltip on those rows.
 *
 * The fallback below is the fix: `cfg.schemaPort ?? useGeometrySchemaPort()`. TextControl
 * is the subject because it is one of the three that regressed.
 */
describe('advanced control label resolution falls back to the provider schema port', () => {
  const DESCRIBED: GeometrySchemaParameterInfo = {
    name: 'field',
    title: 'Field',
    description: 'Only the port knows this.',
    type: 'string',
    jsonPath: '#/properties/field',
    parentKeys: [],
    param: { type: 'string' },
    source: 'schema',
  };

  function describedPort(findParameter: GeometrySchemaPort['findParameter']): GeometrySchemaPort {
    return { ...schemaPort, findParameter };
  }

  /** The label's own hover target, not a pill's or an input adornment's. */
  function labelTooltip(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>('.tooltip-container');
  }

  it('reads the provider port when the config carries none, and asks it for the real property key', () => {
    const findParameter = vi.fn(() => DESCRIBED);
    const { container } = renderControl(TextControl, {
      data: 'x',
      schema: { type: 'string' },
      // Exactly the parent repo's `DirectSpecFields … config={{}}` shape: no port here.
      config: { schemaPort: undefined },
      contextSchemaPort: describedPort(findParameter),
    });

    expect(findParameter).toHaveBeenCalled();
    expect(findParameter.mock.calls[0][0]).toBe('field');
    const tip = labelTooltip(container);
    expect(tip).not.toBeNull();
    expect(tip).toHaveTextContent('Field');
  });

  it('renders a bare label when neither the config nor a provider supplies a port', () => {
    const { container } = renderControl(TextControl, {
      data: 'x',
      schema: { type: 'string' },
      config: { schemaPort: undefined },
      contextSchemaPort: null,
    });

    // `unavailableGeometrySchemaPort` THROWS on `findParameter`; the label resolving at
    // all is the assertion that the availability gate held.
    expect(screen.getByText('Field')).toBeVisible();
    expect(labelTooltip(container)).toBeNull();
  });

  it('still prefers the config port when a host supplies one, provider or not', () => {
    const fromConfig = vi.fn(() => DESCRIBED);
    const fromContext = vi.fn(() => DESCRIBED);
    const { container } = renderControl(TextControl, {
      data: 'x',
      schema: { type: 'string' },
      config: { schemaPort: describedPort(fromConfig) },
      contextSchemaPort: describedPort(fromContext),
    });

    expect(fromConfig).toHaveBeenCalled();
    expect(fromContext).not.toHaveBeenCalled();
    expect(labelTooltip(container)).not.toBeNull();
  });
});
