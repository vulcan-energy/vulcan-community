// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometrySchemaMode = 'core' | 'fhs';

/** Structural JSON Schema node; the public host contract does not own a schema implementation. */
export type GeometrySchemaNode = Readonly<Record<string, unknown>>;

/** Public tooltip shape compatible with Vulcan's existing schema parameter information. */
export interface GeometrySchemaParameterInfo {
  name: string;
  title?: string;
  description?: string;
  type: string | string[];
  units?: string | null;
  constraints?: Readonly<{
    min?: number;
    max?: number;
    enum?: readonly unknown[];
  }>;
  jsonPath: string;
  parentKeys: readonly string[];
  param: GeometrySchemaNode;
  variants?: readonly string[];
  source?: 'schema' | 'hem_guidance';
}

export interface GeometrySchemaPropertyValidation {
  valid: boolean;
  errors?: readonly string[];
}

/**
 * Schema capability contributed by an editor host. Public editor modules depend
 * on this contract rather than a particular schema cache or runtime package.
 */
export interface GeometrySchemaPort {
  readonly availability: 'available' | 'unavailable';
  /** Notify mounted editors when the selected schema is cleared or becomes ready. */
  subscribe?(listener: () => void): () => void;
  getRevision?(): number;
  /** The selected target needs thermal-bridge records even where its schema accepts a total. */
  requiresDetailedThermalBridges?(): boolean;
  /** The selected target's model type; undefined when the host has no target catalogue. */
  targetSchemaMode?(): GeometrySchemaMode | undefined;
  preload(mode: GeometrySchemaMode): Promise<void>;
  getRootSchema(mode: GeometrySchemaMode): GeometrySchemaNode | null;
  getElementSubschema(
    mode: GeometrySchemaMode,
    elementType: string,
    subtype?: string,
  ): GeometrySchemaNode | null;
  getBaseFieldsForElementType(elementType: string): readonly string[];
  getApplianceKeys(mode: GeometrySchemaMode): readonly string[];
  getStrictestIntegerKeysForElementType(
    elementType: string,
    subtype?: string,
  ): ReadonlySet<string>;
  getSchemaSubtypeForElementData(
    elementType: string,
    elementData: Readonly<Record<string, unknown>> | null | undefined,
  ): string | undefined;
  getConditionalRequiredFields(
    mode: GeometrySchemaMode,
    elementType: string,
    elementData: Readonly<Record<string, unknown>> | null | undefined,
    subtype?: string,
  ): readonly string[];
  validateProperty(
    mode: GeometrySchemaMode,
    elementType: string,
    subtype: string | undefined,
    propertyName: string,
    value: unknown,
  ): GeometrySchemaPropertyValidation;
  findParameter(
    paramId: string,
    contextPath?: readonly string[],
    elementType?: string,
    mode?: GeometrySchemaMode,
  ): GeometrySchemaParameterInfo | null;
}

/**
 * The model type of the selected target. With no port, or a host with no target catalogue, it is
 * the HEM 1.0.0a7 target an unpinned CSV converts as, and every pinned target, today: FHS. A new
 * model type, such as EPC, comes from the host's target here.
 */
export function targetSchemaMode(port?: GeometrySchemaPort): GeometrySchemaMode {
  return port?.targetSchemaMode?.() ?? 'fhs';
}

function unavailable(operation: string): never {
  throw new Error(`Geometry schema ${operation} is unavailable`);
}

/** Explicit no-schema composition; callers must gate schema-backed behavior. */
export const unavailableGeometrySchemaPort: GeometrySchemaPort = Object.freeze({
  availability: 'unavailable',
  preload: async () => unavailable('preload'),
  getRootSchema: () => unavailable('root lookup'),
  getElementSubschema: () => unavailable('element lookup'),
  getBaseFieldsForElementType: () => unavailable('base-field lookup'),
  getApplianceKeys: () => unavailable('appliance-key lookup'),
  getStrictestIntegerKeysForElementType: () => unavailable('numeric-typing lookup'),
  getSchemaSubtypeForElementData: () => unavailable('subtype lookup'),
  getConditionalRequiredFields: () => unavailable('conditional-required lookup'),
  validateProperty: () => unavailable('property validation'),
  findParameter: () => unavailable('parameter lookup'),
});
