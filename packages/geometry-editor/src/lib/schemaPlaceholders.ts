// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { type SchemaNode } from './schemaTypes';

/**
 * Robust schema-driven placeholder generation utilities for input.schema.json
 *
 * This module provides comprehensive placeholder generation that understands
 * the complex structure of input.schema.json including:
 * - $ref resolution
 * - oneOf/anyOf unions
 * - required fields
 * - enum values
 * - nested object structures
 */

/**
 * Resolves a JSON Schema reference ($ref) to its actual definition
 */
export function resolveSchemaRef(ref: string, defs?: Record<string, SchemaNode> | null): SchemaNode | null {
  if (!ref.startsWith('#/$defs/')) {
    return null;
  }

  const defName = ref.replace('#/$defs/', '');
  return defs?.[defName] || null;
}

/**
 * Generate meaningful numeric defaults based on schema properties
 */
function generateMeaningfulNumericDefault(schema: SchemaNode): number {
  // Check for minimum/maximum values in schema
  if (schema.minimum !== undefined) {
    return schema.minimum;
  }
  if (schema.maximum !== undefined) {
    return Math.min(schema.maximum, 100); // Cap at reasonable value
  }

  // Check for examples in schema
  if (schema.examples && schema.examples.length > 0) {
    const numericExample = schema.examples.find((ex): ex is number => typeof ex === 'number');
    if (numericExample !== undefined) {
      return numericExample;
    }
  }

  // Check for default value in schema
  if (schema.default !== undefined && typeof schema.default === 'number') {
    return schema.default;
  }

  // Check for enum values (use first numeric enum)
  if (schema.enum && schema.enum.length > 0) {
    const numericEnum = schema.enum.find((val): val is number => typeof val === 'number');
    if (numericEnum !== undefined) {
      return numericEnum;
    }
  }

  // Check for const value
  if (schema.const !== undefined && typeof schema.const === 'number') {
    return schema.const;
  }

  // Default based on format
  if (schema.format === 'double') return 1.0;
  if (schema.format === 'float') return 1.0;
  if (schema.format === 'int32') return 1;
  if (schema.format === 'int64') return 1;

  // Default fallback
  return 1.0;
}

/**
 * Generate meaningful string defaults based on schema properties and context
 */
function generateMeaningfulStringDefault(schema: SchemaNode): string {
  // Check for default value in schema
  if (schema.default !== undefined && typeof schema.default === 'string') {
    return schema.default;
  }

  // Check for const value
  if (schema.const !== undefined && typeof schema.const === 'string') {
    return schema.const;
  }

  // Check for examples in schema
  if (schema.examples && schema.examples.length > 0) {
    const stringExample = schema.examples.find((ex): ex is string => typeof ex === 'string');
    if (stringExample !== undefined) {
      return stringExample;
    }
  }

  // Check for format-specific defaults
  if (schema.format) {
    switch (schema.format) {
      case 'date':
        return '2024-01-01';
      case 'date-time':
        return '2024-01-01T00:00:00Z';
      case 'time':
        return '00:00:00';
      case 'email':
        return 'user@example.com';
      case 'uri':
        return 'https://example.com';
      case 'uuid':
        return '123e4567-e89b-12d3-a456-426614174000';
    }
  }

  // Check for pattern-based suggestions
  if (schema.pattern) {
    // Common patterns and their example values
    if (schema.pattern.includes('^[A-Za-z]')) {
      return 'Example';
    }
    if (schema.pattern.includes('^[0-9]')) {
      return '123';
    }
    if (schema.pattern.includes('^[A-Za-z0-9]')) {
      return 'Example123';
    }
  }

  // Check for minLength/maxLength hints
  if (schema.minLength && schema.minLength > 0) {
    if (schema.maxLength && schema.maxLength <= 10) {
      return 'Example';
    }
    return 'Example text';
  }

  // Default fallback - more meaningful than "value"
  return 'example';
}

/**
 * Generates a default value for a given schema type
 */
export function generateDefaultValue(schema: SchemaNode | null | undefined, defs?: Record<string, SchemaNode>): unknown {
  if (!schema) return null;

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveSchemaRef(schema.$ref, defs);
    if (resolved) {
      return generateDefaultValue(resolved, defs);
    }
    return null;
  }

  // Handle oneOf/anyOf unions
  if (schema.oneOf || schema.anyOf) {
    const options = schema.oneOf || schema.anyOf;
    if (options && options.length > 0) {
      // Prefer a "richer" option so placeholders include useful required fields.
      const best = pickBestUnionOption(options, defs);
      return generateDefaultValue(best, defs);
    }
    return null;
  }

  // Handle different types (including union types like ["number", "null"])
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];

  // For union types, prefer non-null types for placeholders
  const nonNullTypes = types.filter((t): t is string => typeof t === 'string' && t !== 'null');
  const primaryType = nonNullTypes.length > 0 ? nonNullTypes[0] : types[0];

  switch (primaryType) {
    case 'string':
      if (schema.enum && schema.enum.length > 0) {
        return schema.enum[0]; // Use first enum value
      }
      // Generate more meaningful defaults for union types
      return generateMeaningfulStringDefault(schema);

    case 'number':
    case 'integer':
      // Provide more meaningful defaults based on schema properties
      return generateMeaningfulNumericDefault(schema);

    case 'boolean':
      return false;

    case 'array':
      if (schema.items) {
        const itemDefault = generateDefaultValue(schema.items, defs);
        return itemDefault !== null ? [itemDefault] : [];
      }
      return [];

    case 'object':
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        const requiredFields = schema.required || [];

        // Generate values for required fields first
        for (const field of requiredFields) {
          if (schema.properties[field]) {
            obj[field] = generateDefaultValue(schema.properties[field], defs);
          }
        }

        // For placeholders, also generate values for non-required fields to make them more helpful
        // This ensures we get complete examples even when no fields are marked as required
        for (const [field, fieldSchema] of Object.entries(schema.properties)) {
          if (!requiredFields.includes(field) && !Object.prototype.hasOwnProperty.call(obj, field)) {
            obj[field] = generateDefaultValue(fieldSchema, defs);
          }
        }

        return obj;
      }
      return {};

    case 'null':
      // If only null type, return null
      return null;

    default:
      return null;
  }
}

/**
 * Generates a complete, valid placeholder for any field type
 * This ensures the placeholder represents exactly what the engine requires
 */
export function generateCompletePlaceholder(schema: SchemaNode | null | undefined, defs?: Record<string, SchemaNode>): string {
  if (!schema) return '[]';

  // Handle anyOf/oneOf schemas
  if (schema.anyOf || schema.oneOf) {
    const options = schema.anyOf || schema.oneOf;
    if (options && options.length > 0) {
      const best = pickBestUnionOption(options, defs);
      const defaultValue = generateDefaultValue(best, defs);
      return JSON.stringify(defaultValue);
    }
  }

  // Handle simple field types first (not just complex ones)
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean') {
    const defaultValue = generateDefaultValue(schema, defs);
    return JSON.stringify(defaultValue);
  }

  // Handle union types like ["number", "null"]
  if (Array.isArray(schema.type)) {
    const nonNullTypes = schema.type.filter((t): t is string => typeof t === 'string' && t !== 'null');
    const primaryType = nonNullTypes.length > 0 ? nonNullTypes[0] : schema.type[0];

    if (primaryType === 'string' || primaryType === 'number' || primaryType === 'integer' || primaryType === 'boolean') {
      const defaultValue = generateDefaultValue(schema, defs);
      return JSON.stringify(defaultValue);
    }

    // Handle array union types like ["array", "null"]
    if (primaryType === 'array' && schema.items) {
      const itemSchema = schema.items;
      const resolvedItemSchema = itemSchema.$ref ?
        resolveSchemaRef(itemSchema.$ref, defs) : itemSchema;

      if (!resolvedItemSchema) {
        return '[]';
      }

      // Handle oneOf/anyOf for array items
      if (resolvedItemSchema.oneOf || resolvedItemSchema.anyOf) {
        const options = resolvedItemSchema.oneOf || resolvedItemSchema.anyOf;
        if (options && options.length > 0) {
          const best = pickBestUnionOption(options, defs);
          const example = generateDefaultValue(best, defs);
          return JSON.stringify([example]);
        }
      }

      // Handle object array items
      if (resolvedItemSchema.type === 'object' && resolvedItemSchema.properties) {
        const example = generateDefaultValue(resolvedItemSchema, defs);
        return JSON.stringify([example]);
      }

      // Handle primitive array items
      const example = generateDefaultValue(resolvedItemSchema, defs);
      return JSON.stringify([example]);
    }
  }

  // Handle array types
  if (schema.type === 'array' && schema.items) {
    const itemSchema = schema.items;
    const resolvedItemSchema = itemSchema.$ref ?
      resolveSchemaRef(itemSchema.$ref, defs) : itemSchema;

    if (!resolvedItemSchema) {
      return '[]';
    }

    // Handle oneOf/anyOf for array items
    if (resolvedItemSchema.oneOf || resolvedItemSchema.anyOf) {
      const options = resolvedItemSchema.oneOf || resolvedItemSchema.anyOf;
      if (options && options.length > 0) {
        const best = pickBestUnionOption(options, defs);
        const example = generateDefaultValue(best, defs);
        return JSON.stringify([example]);
      }
    }

    // Handle object array items
    if (resolvedItemSchema.type === 'object' && resolvedItemSchema.properties) {
      const example = generateDefaultValue(resolvedItemSchema, defs);
      return JSON.stringify([example]);
    }

    // Handle primitive array items
    const example = generateDefaultValue(resolvedItemSchema, defs);
    return JSON.stringify([example]);
  }

  // Handle object types.
  //
  // R4.6a REGRESSION FIX: this guard used to require `schema.properties` as well, so a
  // DICTIONARY (`{type:'object', additionalProperties:{…}}` — no `properties`, which is
  // how HEM models every user-keyed map) fell past it to the `'[]'` fallback below and
  // offered an ARRAY as the example for an OBJECT-shaped field. Pasting that via the
  // "Copy example" button then failed `validateAdvancedFieldPrimitive`, so the row
  // errored and nothing committed.
  //
  // It only became visible in R4.6a because HEM writes an optional dictionary as
  // `anyOf:[dict,{type:'null'}]`: the wrapper took the union branch at the top of this
  // function and produced `'{}'`, masking the broken guard. `unwrapNullableSchema`
  // (`components/DirectAdvancedFields.tsx`) now strips the wrapper before the node gets
  // here, so the dictionary arrives bare and the guard's gap became reachable — Core
  // `System:InfiltrationVentilation.MechanicalVentilation` and
  // `System:HotWaterDemand.{Bath,Other,Shower}`. A dictionary that was NEVER wrapped
  // (`InfiltrationVentilation.Vents`, and every one of these on FHS) hit it all along.
  //
  // `generateDefaultValue` already returns `{}` for an object with no `properties`, so
  // dropping the extra condition is the whole fix. `{}` deliberately, not a sampled
  // one-entry map: the KEY of a dictionary entry is a user-chosen plant/appliance name
  // ("MVHR Default", "mixer shower 1"), so any sample would invent a HEM name and paste
  // it into the user's model. `{}` is also exactly what the pre-R4.6a union branch
  // produced, and what `HotWaterDemand.Distribution` — a 3-branch `anyOf` the unwrap
  // deliberately leaves alone — still produces today, so the four sibling rows in that
  // one grid agree again.
  if (schema.type === 'object') {
    const example = generateDefaultValue(schema, defs);
    return JSON.stringify(example);
  }

  return '[]';
}

/**
 * Generates specific placeholders for known complex fields
 * These are tailored to the exact schema requirements
 */
export function generateSpecificPlaceholder(
  fieldName: string,
  schema: SchemaNode,
  defs?: Record<string, SchemaNode>,
): string {
  const availableDefs = defs;

  if (!availableDefs) {
    return generateCompletePlaceholder(schema, defs);
  }

  // Use programmatic approach for all fields
  return generateCompletePlaceholder(schema, defs);
}

// Pick the "best" option from a oneOf/anyOf union for placeholder generation.
// Goal: return a representative object that includes required fields and is not trivially empty.
function pickBestUnionOption(options: SchemaNode[], defs?: Record<string, SchemaNode>): SchemaNode {
  const resolved = options
    .map((opt) => {
      if (opt && opt.$ref) return resolveSchemaRef(opt.$ref, defs) || opt;
      return opt;
    })
    // Prefer non-null options
    .filter((opt) => opt && opt.type !== 'null');

  if (resolved.length === 0) return options[0];

  const score = (opt: SchemaNode): number => {
    const type = opt?.type;
    const isObj = type === 'object' || (!!opt?.properties && typeof opt.properties === 'object');
    const req = Array.isArray(opt?.required) ? opt.required.length : 0;
    const props = opt?.properties && typeof opt.properties === 'object' ? Object.keys(opt.properties).length : 0;
    // Object-ness dominates, then required count, then property count.
    return (isObj ? 10000 : 0) + req * 100 + props;
  };

  let best = resolved[0];
  let bestScore = score(best);
  for (const opt of resolved.slice(1)) {
    const s = score(opt);
    if (s > bestScore) {
      best = opt;
      bestScore = s;
    }
  }

  return best;
}

/**
 * Main function to generate robust placeholders for any field
 */
export function generateRobustPlaceholder(
  fieldName: string,
  schema: SchemaNode,
  defs?: Record<string, SchemaNode>
): string {
  // Try specific placeholder first
  const specific = generateSpecificPlaceholder(fieldName, schema, defs);
  if (specific && specific !== '[]') {
    return specific;
  }

  // Fallback to generic generation
  const generic = generateCompletePlaceholder(schema, defs);
  return generic;
}
