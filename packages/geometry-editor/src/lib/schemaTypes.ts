// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type SchemaNode = Record<string, unknown> & {
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  examples?: unknown[];
  default?: unknown;
  const?: unknown;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  patternProperties?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
  defs?: Record<string, SchemaNode>;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  allOf?: SchemaNode[];
  items?: SchemaNode;
  additionalProperties?: SchemaNode | boolean;
  if?: SchemaNode;
  then?: SchemaNode;
  else?: SchemaNode;
  discriminator?: {
    propertyName?: string;
    mapping?: Record<string, string>;
  };
};

export function isSchemaNode(value: unknown): value is SchemaNode {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function asSchemaNode(value: unknown): SchemaNode | null {
  return isSchemaNode(value) ? value : null;
}

export function schemaType(value: unknown): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const stringTypes = value.filter((item): item is string => typeof item === 'string' && item !== 'null');
    return stringTypes.length > 0 ? stringTypes : 'unknown';
  }
  return 'unknown';
}

export function variantTitleFor(node: SchemaNode): string | undefined {
  const title = node.title;
  const typeNode = node.properties?.type;
  const constValue = typeNode?.const;
  const enumValue = Array.isArray(typeNode?.enum) ? typeNode.enum[0] : undefined;
  const value = title ?? constValue ?? enumValue;
  return typeof value === 'string' ? value : undefined;
}
