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

/** A host's per-target rules the schema cannot state. */
export interface TargetRules {
  /** Checks that the model is complete and consistent for this target, such as a wet emitter needing a heat source. */
  modelValidityChecks: boolean;
  /**
   * The FHS wrapper's own input rules: the living-room area split, thermal bridging, the FHS
   * missing-element rows, discrete areal heat capacity, the glazing limit. A target that reads
   * the FHS schema without the FHS wrapper sets this false.
   */
  fhsInputRules: boolean;
  /** Building Regulations checks, such as Part F and Part O. */
  buildingRegulationsChecks: boolean;
  /** Element types the target does not take, each with the reason shown on an existing element. */
  excludedElementTypes: Readonly<Record<string, { reason: string }>>;
  /** Field keys hidden per element type. */
  hiddenFields: Readonly<Record<string, readonly string[]>>;
  /**
   * Systems take HEM Database products, which the product slot picker chooses. The host's other
   * product sources, such as a sample/catalogue source switch, do not apply.
   */
  hemDatabaseProducts: boolean;
  /**
   * Metadata rows the user must state for this target: no defaults-file value fills one, and an
   * unset one is an error. Global Settings shows a row that only some targets take (such as
   * `HasElectricitySmartMeter`) only when it is listed here.
   */
  requiredMetadataRows: readonly string[];
  /**
   * A battery states its age, grid charging and grid export; each one left unset takes a
   * DESNZ-defined default in the converter, which the battery form shows.
   */
  batteryGridInputs: boolean;
  /**
   * Build types that take the storey of dwelling and storeys in building rows, where the
   * target's schema states no condition for them.
   */
  storeyBuildTypes: readonly string[];
  /**
   * Fabric comes from construction bands: the model's age band and a construction per
   * construction type (the `HEMIE_` model settings), which an element may override. The host's
   * fabric defaults replace the default assemblies, and the canvas can colour elements by fabric.
   */
  constructionBands: boolean;
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
  /** The selected target's rules for these model settings; a rule it leaves out keeps the default of {@link targetRules}. */
  targetRules?(modelSettings: Readonly<Record<string, unknown>>): Partial<TargetRules> | undefined;
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

/**
 * The host's rules over the defaults: model-validity checks run for every target, the FHS input
 * rules and Building Regulations checks for an FHS target, nothing is excluded or hidden,
 * products come from the host's own sources, and no Metadata row is required beyond what the
 * schema and defaults decide; fabric comes from elements and default assemblies.
 */
export function targetRules(
  port: GeometrySchemaPort | undefined,
  modelSettings: Readonly<Record<string, unknown>>,
): TargetRules {
  return {
    modelValidityChecks: true,
    fhsInputRules: targetSchemaMode(port) === 'fhs',
    buildingRegulationsChecks: targetSchemaMode(port) === 'fhs',
    excludedElementTypes: {},
    hiddenFields: {},
    hemDatabaseProducts: false,
    requiredMetadataRows: [],
    batteryGridInputs: false,
    storeyBuildTypes: ['flat'],
    constructionBands: false,
    ...port?.targetRules?.(modelSettings),
  };
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
