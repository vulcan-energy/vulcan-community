// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { getSchemaObjectForMode } from './schemaCache';
import { getVulcanDescriptionOverride, type TooltipDescriptionSource } from './schemaDescriptionOverrides';
import {
  asSchemaNode,
  isSchemaNode,
  schemaType,
  variantTitleFor,
  type SchemaNode,
} from './schemaTypes';
import { resolveRefChain, resolveSchemaRef } from './schemaRefResolver';

export type { SchemaNode } from './schemaTypes';

type SchemaSearchMatch = { param: SchemaNode; paramId: string; path: string[] };

function resolveNode(value: SchemaNode, root: SchemaNode): SchemaNode | null {
  return resolveRefChain(root, value);
}

export interface ParameterInfo {
  name: string;
  title?: string;
  description?: string;
  type: string | string[];
  units?: string | null;
  constraints?: {
    min?: number;
    max?: number;
    enum?: unknown[];
  };
  jsonPath: string;
  parentKeys: string[];
  param: SchemaNode; // The full schema object for this parameter
  variants?: string[]; // Which oneOf/anyOf variants this property applies to
  source?: TooltipDescriptionSource;
}

/**
 * Extract units from description text (e.g., "(unit: m²)")
 */
export function extractUnitsFromDescription(description: string): string | null {
  const unitMatch = description.match(/\(unit:\s*([^)]+)\)/i);
  return unitMatch?.[1]?.trim() || null;
}

/**
 * Extract constraints (min, max, enum) from a parameter schema
 */
export function extractConstraints(param: SchemaNode): {
  min?: number;
  max?: number;
  enum?: unknown[];
} {
  const constraints: { min?: number; max?: number; enum?: unknown[] } = {};

  if (typeof param.minimum === 'number') constraints.min = param.minimum;
  if (typeof param.maximum === 'number') constraints.max = param.maximum;
  if (Array.isArray(param.enum)) constraints.enum = param.enum;

  return constraints;
}

/**
 * Resolve $ref but preserve local metadata (e.g., description/title/default) from the referencing node.
 *
 * This is important for tooltips because many schemas use `$ref` for type/enum,
 * while attaching the human description to the referencing property.
 */
function resolveRefPreservingLocal(param: SchemaNode, root: SchemaNode): SchemaNode {
  const ref = param.$ref;
  if (!ref || typeof ref !== 'string') return param;

  const resolved = resolveRefChain(root, param);
  if (!resolved) return param;

  // Merge: resolved base first, then overlay local fields (but drop $ref itself to avoid confusion)
  const local = { ...(param as Record<string, unknown>) };
  delete local.$ref;
  return { ...resolved, ...local };
}

/**
 * Recursively search for a parameter in schema properties and $defs
 */
function searchInObject(
  obj: SchemaNode,
  paramId: string,
  root: SchemaNode,
  path: string[] = [],
  results: SchemaSearchMatch[] = []
): void {
  // Handle $ref
  if (obj.$ref) {
    const resolved = resolveSchemaRef(root, obj.$ref);
    if (resolved) {
      searchInObject(resolved, paramId, root, path, results);
    }
    return;
  }

  // Handle oneOf/anyOf - search in each option
  if (obj.oneOf || obj.anyOf) {
    const options = obj.oneOf || obj.anyOf;
    for (let i = 0; options && i < options.length; i++) {
      searchInObject(options[i], paramId, root, path, results);
    }
    return;
  }

  // Handle conditional / composed schemas used heavily by the FHS fabric defs.
  if (Array.isArray(obj.allOf)) {
    for (let i = 0; i < obj.allOf.length; i++) {
      searchInObject(obj.allOf[i], paramId, root, [...path, 'allOf', String(i)], results);
    }
  }
  if (obj.if) {
    searchInObject(obj.if, paramId, root, [...path, 'if'], results);
  }
  if (obj.then) {
    searchInObject(obj.then, paramId, root, [...path, 'then'], results);
  }
  if (obj.else) {
    searchInObject(obj.else, paramId, root, [...path, 'else'], results);
  }

  // Search in properties
  if (obj.properties && typeof obj.properties === 'object') {
    for (const [key, value] of Object.entries(obj.properties)) {
      const newPath = [...path, key];
      const fullPath = newPath.join('.');

      // Exact match
      if (key === paramId || fullPath === paramId) {
        const param = value;
        // Resolve $ref but preserve local metadata (description/title/etc.)
        const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;
        if (resolvedParam) {
          results.push({ param: resolvedParam, paramId: key, path: newPath });
        }
      }

      // Case-insensitive partial match
      if (key.toLowerCase().includes(paramId.toLowerCase()) ||
          fullPath.toLowerCase().includes(paramId.toLowerCase())) {
        const param = value;
        const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;
        if (resolvedParam && !results.some(r => r.paramId === key && r.path.join('.') === fullPath)) {
          results.push({ param: resolvedParam, paramId: key, path: newPath });
        }
      }

      // Recursively search nested properties
      if (value && typeof value === 'object') {
        searchInObject(value, paramId, root, newPath, results);
      }
    }
  }

  // Search in items (for arrays)
  if (obj.items) {
    searchInObject(obj.items, paramId, root, path, results);
  }

  // Search in additionalProperties
  if (isSchemaNode(obj.additionalProperties)) {
    searchInObject(obj.additionalProperties, paramId, root, path, results);
  }
}

/**
 * Find a parameter in the schema by paramId
 * Supports simple names, dot-separated paths, and fuzzy matching
 * @param paramId - The parameter ID to search for
 * @param contextPath - Optional path to limit search scope (e.g., ['$defs', 'BuildingElement'])
 * @param elementType - Optional element type to prefer when multiple matches exist (e.g., 'BuildingElementGround')
 */
export function findParameterInSchema(
  paramId: string,
  contextPath?: string[],
  elementType?: string,
  useFHSSchema = false,
): ParameterInfo | null {
  const root = asSchemaNode(getSchemaObjectForMode(useFHSSchema));
  if (!root) return null;

  const results: SchemaSearchMatch[] = [];

  // SIMPLE DIRECT LOOKUP: If we have elementType, directly look it up in $defs
  // This is much simpler and more reliable than navigating through contextPath
  // Works for both core schema (BuildingElementOpaque) and FHS schema (BuildingElementOpaqueFHS)
  if (elementType) {
  // Try FHS variant first when an FHS-flavoured definition exists.
    const fhsVariant = elementType + 'FHS';
    let elementTypeDef: SchemaNode | null = null;
    let actualElementTypeName = elementType;

    // Special case: WindowShading maps to WindowShadingObject in schema
    if (elementType === 'WindowShading') {
      actualElementTypeName = 'WindowShadingObject';
    }
    // Special case: Lighting maps to ZoneLighting in schema
    if (elementType === 'Lighting') {
      actualElementTypeName = 'ZoneLighting';
    }

    if (root.$defs?.[fhsVariant]) {
      elementTypeDef = root.$defs[fhsVariant];
      actualElementTypeName = fhsVariant;
    } else if (root.$defs?.[actualElementTypeName]) {
      elementTypeDef = root.$defs[actualElementTypeName];
    } else if (root.$defs?.[elementType]) {
      // Fall back to base name (for core schema)
      elementTypeDef = root.$defs[elementType];
      actualElementTypeName = elementType;
    }

    if (elementTypeDef) {
      // Resolve $ref if needed
      const resolvedDef = resolveNode(elementTypeDef, root);

      // Handle oneOf structures (like WindowShadingObject)
      if (resolvedDef && resolvedDef.oneOf && Array.isArray(resolvedDef.oneOf)) {
        for (const option of resolvedDef.oneOf) {
          const resolvedOption = resolveNode(option, root);
          if (resolvedOption && resolvedOption.properties && resolvedOption.properties[paramId]) {
            const param = resolvedOption.properties[paramId];
            const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;
            if (resolvedParam) {
              // Only add once per paramId to avoid duplicates from multiple oneOf options
              const pathStr = ['$defs', actualElementTypeName, paramId].join('.');
              if (!results.some(r => r.paramId === paramId && r.path.join('.') === pathStr)) {
                results.push({ param: resolvedParam, paramId, path: ['$defs', actualElementTypeName, paramId] });
              }
            }
          }
        }
      }

      // Handle normal properties structure
      if (resolvedDef && resolvedDef.properties && resolvedDef.properties[paramId]) {
        // Direct property lookup - this is the simplest and most reliable approach
        const param = resolvedDef.properties[paramId];
        const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;

        if (resolvedParam) {
          // Build path: ['$defs', actualElementTypeName, paramId]
          const elementTypePath = ['$defs', actualElementTypeName, paramId];
          results.push({ param: resolvedParam, paramId, path: elementTypePath });
          // Found it! Skip all the complex contextPath navigation
        }
      }

      // FHS fabric schemas often hide properties inside allOf/if/then branches.
      // Search within the resolved element definition as a fallback before giving up.
      if (results.length === 0 && resolvedDef) {
        searchInObject(resolvedDef, paramId, root, ['$defs', actualElementTypeName], results);
      }

      // Special case: Lighting - count and power are in ZoneLightingBulbs (nested under bulbs.additionalProperties)
      if (elementType === 'Lighting' && (paramId === 'count' || paramId === 'power')) {
        const bulbsDef = root.$defs?.['ZoneLightingBulbs'];
        if (bulbsDef) {
          const resolvedBulbsDef = resolveNode(bulbsDef, root);
          if (resolvedBulbsDef && resolvedBulbsDef.properties && resolvedBulbsDef.properties[paramId]) {
            const param = resolvedBulbsDef.properties[paramId];
            const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;
            if (resolvedParam) {
              results.push({ param: resolvedParam, paramId, path: ['$defs', 'ZoneLightingBulbs', paramId] });
            }
          }
        }
      }

      // Special case: WindowShading in FHS schema - height and transparency are in WindowShadingObstacle
      // (In core schema, they're in WindowShadingObject.oneOf, but FHS schema splits them)
      if (elementType === 'WindowShading' && (paramId === 'height' || paramId === 'transparency')) {
        const obstacleDef = root.$defs?.['WindowShadingObstacle'];
        if (obstacleDef) {
          const resolvedObstacleDef = resolveNode(obstacleDef, root);
          if (resolvedObstacleDef && resolvedObstacleDef.properties && resolvedObstacleDef.properties[paramId]) {
            const param = resolvedObstacleDef.properties[paramId];
            const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;
            if (resolvedParam) {
              results.push({ param: resolvedParam, paramId, path: ['$defs', 'WindowShadingObstacle', paramId] });
            }
          }
        }
      }

    }

    // Special case: BuildingElementGround has conditional variants that live in separate $defs
    // (e.g. depth_basement_floor is only present under the Heated/Unheated basement variants),
    // but ElementCreator tooltips pass elementType='BuildingElementGround' with contextPath ['$defs','BuildingElement'].
    //
    // BuildingElementGround may not exist as a direct $defs entry, so we do this scan even when
    // `elementTypeDef` is missing.
    if (results.length === 0 && elementType === 'BuildingElementGround' && root.$defs && typeof root.$defs === 'object') {
      for (const defName of Object.keys(root.$defs)) {
        if (!defName.startsWith('BuildingElementGround')) continue;
        const def = root.$defs[defName];
        if (!def) continue;

        const resolvedVariant = resolveNode(def, root);

        if (resolvedVariant && resolvedVariant.properties && resolvedVariant.properties[paramId]) {
          const param = resolvedVariant.properties[paramId];
          const resolvedParam = param.$ref ? resolveRefPreservingLocal(param, root) : param;
          if (resolvedParam) {
            results.push({ param: resolvedParam, paramId, path: ['$defs', defName, paramId] });
          }
        }
      }
    }

    // If we found results via direct lookup, skip contextPath search entirely
    if (results.length > 0) {
      // We have a direct match, proceed to filtering and return
    } else if (contextPath && contextPath.length > 0) {
      // No direct match, fall back to contextPath search
    } else {
      // No elementType match and no contextPath, will do broad search below
    }
  }

  // If contextPath is provided and we haven't found results yet, search within that context
  if (results.length === 0 && contextPath && contextPath.length > 0) {
    let contextNode: SchemaNode | null = root;

    // Navigate to context
    for (const segment of contextPath) {
      if (contextNode) {
        contextNode = resolveNode(contextNode, root);
        if (!contextNode) break;

        // Handle special segments: '$defs' and 'properties' refer to the schema root
        if (segment === '$defs' && root.$defs) {
          contextNode = root.$defs as SchemaNode;
        } else if (segment === 'properties' && root.properties) {
          contextNode = root.properties as SchemaNode;
        } else if (contextNode.properties && contextNode.properties[segment]) {
          contextNode = contextNode.properties[segment];
        } else if (contextNode.$defs && contextNode.$defs[segment]) {
          contextNode = contextNode.$defs[segment];
        } else {
          // Direct property access (e.g., when already in $defs, access BuildingElement directly)
          contextNode = asSchemaNode(contextNode[segment]);
          if (!contextNode) break;
        }
      }
    }

    if (contextNode) {
      // Resolve $ref if needed
      contextNode = resolveNode(contextNode, root);

      // Handle additionalProperties pattern (used in FHS schema for BuildingElement)
      // The oneOf might be inside additionalProperties instead of directly on the node
      let oneOfNode = contextNode?.oneOf;
      if (!oneOfNode && isSchemaNode(contextNode?.additionalProperties)) {
        const resolvedAdditional = resolveNode(contextNode.additionalProperties, root);
        if (resolvedAdditional && resolvedAdditional.oneOf) {
          oneOfNode = resolvedAdditional.oneOf;
        }
      }

      // Search within context normally
      // (elementType direct lookup already handled above if provided)
      // Handle additionalProperties.oneOf pattern
      if (oneOfNode && Array.isArray(oneOfNode)) {
        for (const option of oneOfNode) {
          searchInObject(option, paramId, root, contextPath, results);
        }
      } else if (contextNode) {
        searchInObject(contextNode, paramId, root, contextPath, results);
      }
    }
  }

  // If no context or no results in context, search broadly
  // BUT: If contextPath was provided, we should have found results in that context
  // Only fall back to broad search if no contextPath was provided
  // This prevents finding wrong results (like PV pitch) when we have a valid context
  if (results.length === 0 && (!contextPath || contextPath.length === 0)) {
    // Search in root properties
    if (root.properties) {
      searchInObject(root.properties, paramId, root, [], results);
    }

    // Search in $defs
    if (root.$defs) {
      searchInObject(root.$defs, paramId, root, [], results);
    }

    // If still no results, try searching the entire schema
    if (results.length === 0) {
      searchInObject(root, paramId, root, [], results);
    }
  }

  // Prefer exact matches, then shortest path matches
  if (results.length === 0) return null;

  // If contextPath was provided, filter to only results within that context
  let filteredResults = results;
  if (contextPath && contextPath.length > 0) {
    // If we have elementType and contextPath points to BuildingElement,
    // prioritize results from the elementType definition (direct lookup results)
    if (elementType && contextPath.length >= 2 && contextPath[contextPath.length - 1] === 'BuildingElement') {
      // Check if any result is from the elementType definition in $defs
      // These are results from our direct lookup above
      const elementTypeResults = results.filter(result => {
        // Result path should be like ['$defs', elementType, paramId] or ['$defs', elementType + 'FHS', paramId]
        if (result.path.length >= 2 && result.path[0] === '$defs') {
          const defName = result.path[1];
          // Check if this is the elementType or a variant (like BuildingElementOpaqueFHS)
          return defName === elementType || defName === elementType + 'FHS' || defName.startsWith(elementType);
        }
        return false;
      });

      // If we found elementType results from direct lookup, use those (highest priority)
      if (elementTypeResults.length > 0) {
        filteredResults = elementTypeResults;
      } else {
        // No direct lookup results, check context path matches
        const contextPrefix = contextPath.join('.');
        const contextResults = results.filter(result => {
          const resultPrefix = result.path.slice(0, contextPath.length).join('.');
          return resultPrefix === contextPrefix;
        });
        if (contextResults.length > 0) {
          filteredResults = contextResults;
        }
      }
    } else {
      // No elementType, just filter by contextPath
      // BUT: If we have elementType and found results via direct lookup (oneOf),
      // those results should be preserved even if contextPath filtering would remove them
      // This handles cases like WindowShading where oneOf results have path ['$defs', 'WindowShadingObject', paramId]
      // and contextPath is ['$defs', 'WindowShadingObject']
      if (elementType && results.length > 0) {
        // Check if any results are from direct elementType lookup (these should be preserved)
        const directLookupResults = results.filter(result => {
          if (result.path.length >= 2 && result.path[0] === '$defs') {
            const defName = result.path[1];
            // For WindowShading, actualElementTypeName would be 'WindowShadingObject'
            // For Lighting, actualElementTypeName would be 'ZoneLighting'
            let expectedDefName = elementType;
            if (elementType === 'WindowShading') {
              expectedDefName = 'WindowShadingObject';
            } else if (elementType === 'Lighting') {
              expectedDefName = 'ZoneLighting';
            }
            return defName === expectedDefName || defName === elementType;
          }
          return false;
        });

        if (directLookupResults.length > 0) {
          // Use direct lookup results (from oneOf or direct properties)
          filteredResults = directLookupResults;
        } else {
          // No direct lookup results, filter by contextPath
      const contextPrefix = contextPath.join('.');
      const contextResults = results.filter(result => {
        const resultPrefix = result.path.slice(0, contextPath.length).join('.');
        return resultPrefix === contextPrefix;
      });
      if (contextResults.length > 0) {
        filteredResults = contextResults;
          }
        }
      } else {
        // No elementType, just filter by contextPath
        const contextPrefix = contextPath.join('.');
        const contextResults = results.filter(result => {
          const resultPrefix = result.path.slice(0, contextPath.length).join('.');
          return resultPrefix === contextPrefix;
        });
        if (contextResults.length > 0) {
          filteredResults = contextResults;
        }
      }
    }
  }

  // If elementType is provided and we're searching within BuildingElement oneOf,
  // prefer results from the specific element type definition
  if (elementType && contextPath && contextPath.length >= 2 && contextPath[contextPath.length - 1] === 'BuildingElement') {
    // Prefer results that are from the specific element type definition in $defs
    // Results should have paths like ['$defs', elementType, 'properties', paramId] or similar
    const preferredResults = filteredResults.filter(result => {
      // Check if the path includes the elementType
      // Path could be: ['$defs', elementType, 'properties', paramId]
      // Or: ['$defs', 'BuildingElement', 'oneOf', index, 'properties', paramId] where the option resolves to elementType
      const pathStr = result.path.join('.');

      // Direct match: path includes $defs.elementType
      if (pathStr.includes(`$defs.${elementType}`) || pathStr.includes(`$defs/${elementType}`)) {
        return true;
      }

      // Check if this result is from a oneOf option that resolves to the elementType
      // We need to verify the param exists in the elementType definition
      if (root.$defs?.[elementType]) {
        const elementDef = resolveNode(root.$defs[elementType], root);
        if (elementDef && elementDef.properties && elementDef.properties[paramId]) {
          // The param exists in the elementType definition, so this result is valid
          // But we need to check if the result path actually points to this definition
          // For now, if the path starts with $defs and the param exists in elementType, prefer it
          if (result.path[0] === '$defs') {
            return true;
          }
        }
      }

      return false;
    });

    if (preferredResults.length > 0) {
      filteredResults = preferredResults;
    }
  }

  // Sort: exact name match first, then by path length
  filteredResults.sort((a, b) => {
    const aExact = a.paramId === paramId || a.path.join('.') === paramId;
    const bExact = b.paramId === paramId || b.path.join('.') === paramId;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return a.path.length - b.path.length;
  });

  const bestMatch = filteredResults[0];
  const param = bestMatch.param;
  const jsonPath = `#/${bestMatch.path.join('/')}`;
  let description = param.description || '';
  let source: TooltipDescriptionSource = 'schema';

  // Option A: apply HEM guidance overrides only when schema lacks a description.
  if (!description || description.trim().length === 0) {
    const override = getVulcanDescriptionOverride(elementType, bestMatch.paramId);
    if (override) {
      description = override;
      source = 'hem_guidance';
    }
  }
  const units = extractUnitsFromDescription(description);
  const constraints = extractConstraints(param);

  // Determine type
  const type = schemaType(param.type);

  return {
    name: bestMatch.paramId,
    title: param.title || bestMatch.paramId,
    description,
    type,
    units: units || undefined,
    constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
    jsonPath,
    parentKeys: bestMatch.path.slice(0, -1),
    param,
    source
  };
}

/**
 * Search result item for schema search
 */
export interface SearchResult {
  key: string;
  path: string[]; // Array of path segments
  jsonPath: string; // JSON Pointer format
  dotPath: string; // Dot-separated path
  type: string | string[];
  param: SchemaNode; // The schema object
  variants?: string[]; // Which oneOf/anyOf variants this property applies to (e.g., ["BuildingElementTransparent"])
}

/**
 * Navigate to a node in the schema by path
 */
export function navigateToPath(path: string[], useFHSSchema = false): ParameterInfo | null {
  const root = asSchemaNode(getSchemaObjectForMode(useFHSSchema));
  if (!root) return null;

  if (path.length === 0) {
    // Root level - return schema root info
    return {
      name: 'root',
      title: 'Schema Root',
      description: root.description || '',
      type: 'object',
      jsonPath: '#/',
      parentKeys: [],
      param: root
    };
  }

  let current: SchemaNode | null = root;
  const resolvedPath: string[] = [];

  // Navigate through path segments
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];

      if (current && typeof current === 'object') {
        // Handle $ref
        if (current.$ref) {
          current = resolveSchemaRef(root, current.$ref);
        }
        if (!current) return null;

      // Check if this is a root-level property (first segment)
      if (i === 0 && root.properties && root.properties[segment]) {
        current = root.properties[segment];
        resolvedPath.push('properties', segment);
      }
      // Check if this is a $defs entry (first segment)
      else if (i === 0 && root.$defs && root.$defs[segment]) {
        current = root.$defs[segment];
        resolvedPath.push('$defs', segment);
      }
      // Navigate within current object
      else if (current.properties && current.properties[segment]) {
        current = current.properties[segment];
        resolvedPath.push(segment);
      } else if (current.$defs && current.$defs[segment]) {
        current = current.$defs[segment];
        resolvedPath.push(segment);
      }
      // Handle additionalProperties pattern (e.g., HeatSourceWet)
      else if (isSchemaNode(current.additionalProperties)) {
        const additionalProps = current.additionalProperties;
        const resolvedAdditional = resolveNode(additionalProps, root);

        if (resolvedAdditional) {
          // Check if segment exists in oneOf/anyOf options
          let found = false;
          if (resolvedAdditional.oneOf && Array.isArray(resolvedAdditional.oneOf)) {
            for (const option of resolvedAdditional.oneOf) {
              const resolvedOption = option.$ref ? resolveSchemaRef(root, option.$ref) : option;
              if (resolvedOption && resolvedOption.properties && resolvedOption.properties[segment]) {
                current = resolvedOption.properties[segment];
                resolvedPath.push(segment);
                found = true;
                break;
              }
            }
          }
          if (!found && resolvedAdditional.anyOf && Array.isArray(resolvedAdditional.anyOf)) {
            for (const option of resolvedAdditional.anyOf) {
              const resolvedOption = option.$ref ? resolveSchemaRef(root, option.$ref) : option;
              if (resolvedOption && resolvedOption.properties && resolvedOption.properties[segment]) {
                current = resolvedOption.properties[segment];
                resolvedPath.push(segment);
                found = true;
                break;
              }
            }
          }
          if (!found && resolvedAdditional.properties && resolvedAdditional.properties[segment]) {
            current = resolvedAdditional.properties[segment];
            resolvedPath.push(segment);
            found = true;
          }
          if (!found) {
            return null; // Path not found
          }
        } else {
          return null; // Path not found
        }
      } else {
        return null; // Path not found
      }
    } else {
      return null;
    }
  }

  // Resolve final $ref if needed
  current = current ? resolveNode(current, root) : null;

  if (!current) return null;

  // Check if this property came from a oneOf/anyOf variant
  // We need to trace back to see if the parent had oneOf/anyOf
  let variants: string[] | undefined = undefined;
  try {
    // Navigate back to parent to check for oneOf/anyOf
    let parentNode: SchemaNode | null = root;
    const parentPath = path.slice(0, -1);
    const propertyName = path[path.length - 1];

    // Navigate to parent
    for (let i = 0; i < parentPath.length; i++) {
      const segment = parentPath[i];
      if (i === 0 && root.properties && root.properties[segment]) {
        parentNode = root.properties[segment];
      } else if (parentNode?.properties && parentNode.properties[segment]) {
        parentNode = parentNode.properties[segment];
      } else if (isSchemaNode(parentNode?.additionalProperties)) {
        const additionalProps = parentNode.additionalProperties;
        const resolvedAdditional = resolveNode(additionalProps, root);
        if (resolvedAdditional && resolvedAdditional.properties && resolvedAdditional.properties[segment]) {
          parentNode = resolvedAdditional.properties[segment];
        }
      }

      // Resolve $ref
      parentNode = parentNode ? resolveNode(parentNode, root) : null;
    }

    // Check if parent has additionalProperties with oneOf/anyOf
    if (isSchemaNode(parentNode?.additionalProperties)) {
      const additionalProps = parentNode.additionalProperties;
      const resolvedAdditional = resolveNode(additionalProps, root);

      if (resolvedAdditional) {
        const variantList: string[] = [];
        if (resolvedAdditional.oneOf && Array.isArray(resolvedAdditional.oneOf)) {
          for (const option of resolvedAdditional.oneOf) {
            const resolvedOption = resolveNode(option, root);
            if (resolvedOption && resolvedOption.properties && resolvedOption.properties[propertyName]) {
              const variantTitle = variantTitleFor(resolvedOption);
              if (variantTitle) variantList.push(variantTitle);
            }
          }
        }
        if (resolvedAdditional.anyOf && Array.isArray(resolvedAdditional.anyOf)) {
          for (const option of resolvedAdditional.anyOf) {
            const resolvedOption = resolveNode(option, root);
            if (resolvedOption && resolvedOption.properties && resolvedOption.properties[propertyName]) {
              const variantTitle = variantTitleFor(resolvedOption);
              if (variantTitle && !variantList.includes(variantTitle)) variantList.push(variantTitle);
            }
          }
        }
        if (variantList.length > 0) {
          variants = variantList;
        }
      }
    }

    // Also check if parent itself has oneOf/anyOf
    if (!variants && parentNode) {
      const variantList: string[] = [];
      if (parentNode.oneOf && Array.isArray(parentNode.oneOf)) {
        for (const option of parentNode.oneOf) {
          const resolvedOption = resolveNode(option, root);
          if (resolvedOption && resolvedOption.properties && resolvedOption.properties[propertyName]) {
            const variantTitle = variantTitleFor(resolvedOption);
            if (variantTitle) variantList.push(variantTitle);
          }
        }
      }
      if (parentNode.anyOf && Array.isArray(parentNode.anyOf)) {
        for (const option of parentNode.anyOf) {
          const resolvedOption = resolveNode(option, root);
          if (resolvedOption && resolvedOption.properties && resolvedOption.properties[propertyName]) {
            const variantTitle = variantTitleFor(resolvedOption);
            if (variantTitle && !variantList.includes(variantTitle)) variantList.push(variantTitle);
          }
        }
      }
      if (variantList.length > 0) {
        variants = variantList;
      }
    }
  } catch {
    // If variant detection fails, continue without variants
  }

  const description = current.description || '';
  const units = extractUnitsFromDescription(description);
  const constraints = extractConstraints(current);

  const type = schemaType(current.type);

  return {
    name: path[path.length - 1] || '',
    title: current.title || path[path.length - 1] || '',
    description,
    type,
    units: units || undefined,
    constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
    jsonPath: `#/${resolvedPath.join('/')}`,
    parentKeys: resolvedPath.slice(0, -1),
    param: current,
    variants
  };
}

/**
 * Get children of a node at the given path
 */
export function getChildrenOfPath(path: string[], useFHSSchema = false): SearchResult[] {
  const root = asSchemaNode(getSchemaObjectForMode(useFHSSchema));
  if (!root) return [];

  let current: SchemaNode | null = root;

  // If path is empty, return root-level properties
  if (path.length === 0) {
    const children: SearchResult[] = [];
    if (root.properties) {
      for (const [key, value] of Object.entries(root.properties)) {
        const resolvedParam = resolveNode(value, root);

        if (resolvedParam) {
          const type = schemaType(resolvedParam.type);

          children.push({
            key,
            path: [key],
            jsonPath: `#/properties/${key}`,
            dotPath: key,
            type,
            param: resolvedParam
          });
        }
      }
    }
    return children;
  }

  // Navigate to the node
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];

    if (current) {
      current = resolveNode(current, root);
      if (!current) return [];

      // First segment - check root properties or $defs
      if (i === 0 && root.properties && root.properties[segment]) {
        current = root.properties[segment];
      } else if (i === 0 && root.$defs && root.$defs[segment]) {
        current = root.$defs[segment];
      }
      // Subsequent segments - navigate within current object
      else if (current.properties && current.properties[segment]) {
        current = current.properties[segment];
      } else if (current.$defs && current.$defs[segment]) {
        current = current.$defs[segment];
      }
      // Handle additionalProperties pattern (e.g., Zone -> ZoneInput -> BuildingElement)
      else if (isSchemaNode(current.additionalProperties)) {
        const additionalProps = current.additionalProperties;
        const resolvedAdditional = resolveNode(additionalProps, root);

        if (resolvedAdditional) {
          // Check if segment exists in properties of the resolved additionalProperties
          if (resolvedAdditional.properties && resolvedAdditional.properties[segment]) {
            current = resolvedAdditional.properties[segment];
          } else {
            // If not found in properties, check oneOf/anyOf options
            let found = false;
            if (resolvedAdditional.oneOf && Array.isArray(resolvedAdditional.oneOf)) {
              for (const option of resolvedAdditional.oneOf) {
                const resolvedOption = resolveNode(option, root);
                if (resolvedOption && resolvedOption.properties && resolvedOption.properties[segment]) {
                  current = resolvedOption.properties[segment];
                  found = true;
                  break;
                }
              }
            }
            if (!found && resolvedAdditional.anyOf && Array.isArray(resolvedAdditional.anyOf)) {
              for (const option of resolvedAdditional.anyOf) {
                const resolvedOption = resolveNode(option, root);
                if (resolvedOption && resolvedOption.properties && resolvedOption.properties[segment]) {
                  current = resolvedOption.properties[segment];
                  found = true;
                  break;
                }
              }
            }
            if (!found) {
              return [];
            }
          }
        } else {
          return [];
        }
      } else {
        return [];
      }
    } else {
      return [];
    }
  }

  // Resolve final $ref if needed - keep resolving until we get a node without $ref
  current = current ? resolveNode(current, root) : null;

  if (!current) return [];

  // Get children from properties
  const children: SearchResult[] = [];
  const seenKeys = new Set<string>();

  // Helper to add a child if not already seen
  const addChild = (key: string, value: SchemaNode, childPath: string[], variantTitle?: string) => {
    const resolvedParam = resolveNode(value, root);

    if (resolvedParam) {
      const type = schemaType(resolvedParam.type);

      const jsonPathParts = path.length > 0
        ? ['properties', ...path, key]
        : ['properties', key];

      // If key already exists, merge variants
      const existing = children.find(c => c.key === key);
      if (existing) {
        if (variantTitle && existing.variants && !existing.variants.includes(variantTitle)) {
          existing.variants.push(variantTitle);
        } else if (variantTitle && !existing.variants) {
          existing.variants = [variantTitle];
        }
      } else {
        children.push({
          key,
          path: childPath,
          jsonPath: `#/${jsonPathParts.join('/')}`,
          dotPath: childPath.join('.'),
          type,
          param: resolvedParam,
          variants: variantTitle ? [variantTitle] : undefined
        });
        seenKeys.add(key);
      }
    }
  };

  // Check if current node has properties
  if (current.properties && typeof current.properties === 'object') {
    for (const [key, value] of Object.entries(current.properties)) {
      addChild(key, value, [...path, key]);
    }
  }

  // Check for additionalProperties (e.g., HeatSourceWet uses this pattern)
  if (isSchemaNode(current.additionalProperties)) {
    const additionalProps = current.additionalProperties;
    const resolvedAdditional = resolveNode(additionalProps, root);

    // If additionalProperties resolves to a oneOf/anyOf, extract children from all options
    if (resolvedAdditional) {
      if (resolvedAdditional.oneOf && Array.isArray(resolvedAdditional.oneOf)) {
        for (const option of resolvedAdditional.oneOf) {
          const resolvedOption = resolveNode(option, root);
          if (resolvedOption && resolvedOption.properties) {
            // Extract variant title (from title field or type const)
            const variantTitle = variantTitleFor(resolvedOption);

            for (const [key, value] of Object.entries(resolvedOption.properties)) {
              // Skip the 'type' field itself as it's just a discriminator
              if (key !== 'type') {
                addChild(key, value, [...path, key], variantTitle);
              }
            }
          }
        }
      } else if (resolvedAdditional.anyOf && Array.isArray(resolvedAdditional.anyOf)) {
        for (const option of resolvedAdditional.anyOf) {
          const resolvedOption = resolveNode(option, root);
          if (resolvedOption && resolvedOption.properties) {
            const variantTitle = variantTitleFor(resolvedOption);

            for (const [key, value] of Object.entries(resolvedOption.properties)) {
              if (key !== 'type') {
                addChild(key, value, [...path, key], variantTitle);
              }
            }
          }
        }
      } else if (resolvedAdditional.properties) {
        // additionalProperties itself has properties (unlikely but possible)
        for (const [key, value] of Object.entries(resolvedAdditional.properties)) {
          addChild(key, value, [...path, key]);
        }
      }
    }
  }

  // Also check if the resolved node has oneOf/anyOf - extract children from all options
  if (current.oneOf && Array.isArray(current.oneOf)) {
    for (const option of current.oneOf) {
      const resolvedOption = resolveNode(option, root);
      if (resolvedOption && resolvedOption.properties) {
        // Extract variant title
        const variantTitle = variantTitleFor(resolvedOption);

        for (const [key, value] of Object.entries(resolvedOption.properties)) {
          if (key !== 'type') {
            addChild(key, value, [...path, key], variantTitle);
          }
        }
      }
    }
  }

  if (current.anyOf && Array.isArray(current.anyOf)) {
    for (const option of current.anyOf) {
      const resolvedOption = resolveNode(option, root);
      if (resolvedOption && resolvedOption.properties) {
        const variantTitle = variantTitleFor(resolvedOption);

        for (const [key, value] of Object.entries(resolvedOption.properties)) {
          if (key !== 'type') {
            addChild(key, value, [...path, key], variantTitle);
          }
        }
      }
    }
  }

  return children;
}

/**
 * Build search index from a subschema (starting from a given path)
 */
function buildSearchIndex(
  node: SchemaNode,
  root: SchemaNode,
  basePath: string[] = [],
  index: SearchResult[] = [],
  seen: WeakSet<object> = new WeakSet(),
  variantTitle?: string
): void {
  // Prevent infinite loops
  if (seen.has(node)) return;
  seen.add(node);

  // Handle $ref
  if (node.$ref) {
    const resolved = resolveSchemaRef(root, node.$ref);
    if (resolved) {
      buildSearchIndex(resolved, root, basePath, index, seen, variantTitle);
    }
    return;
  }

  // Handle oneOf/anyOf - extract variant titles and index each option
  if (node.oneOf || node.anyOf) {
    const options = node.oneOf || node.anyOf;
    for (const option of options || []) {
      const resolvedOption = resolveNode(option, root);
      if (!resolvedOption) continue;
      const optionVariantTitle = variantTitleFor(resolvedOption);
      buildSearchIndex(resolvedOption, root, basePath, index, seen, optionVariantTitle);
    }
    return;
  }

  // Index properties
  if (node.properties && typeof node.properties === 'object') {
    for (const [key, value] of Object.entries(node.properties)) {
      const resolvedParam = resolveNode(value, root);

      if (resolvedParam) {
        const fullPath = [...basePath, key];
        const type = schemaType(resolvedParam.type);

        // Build JSON path correctly
        const jsonPathParts = basePath.length > 0
          ? ['properties', ...basePath, key]
          : ['properties', key];

        // Check if this key already exists in index (from another variant)
        const existing = index.find(item => item.key === key && item.dotPath === fullPath.join('.'));
        if (existing) {
          // Merge variants
          if (variantTitle && existing.variants && !existing.variants.includes(variantTitle)) {
            existing.variants.push(variantTitle);
          } else if (variantTitle && !existing.variants) {
            existing.variants = [variantTitle];
          }
        } else {
          index.push({
            key,
            path: fullPath,
            jsonPath: `#/${jsonPathParts.join('/')}`,
            dotPath: fullPath.join('.'),
            type,
            param: resolvedParam,
            variants: variantTitle ? [variantTitle] : undefined
          });
        }

        // Recursively index nested properties
        if (resolvedParam.properties || resolvedParam.$ref) {
          buildSearchIndex(resolvedParam, root, fullPath, index, seen, variantTitle);
        }
      }
    }
  }

  // Index items (for arrays)
  if (node.items) {
    buildSearchIndex(node.items, root, basePath, index, seen, variantTitle);
  }

  // Index additionalProperties
  if (isSchemaNode(node.additionalProperties)) {
    buildSearchIndex(node.additionalProperties, root, basePath, index, seen, variantTitle);
  }
}

/**
 * Search within a subschema (from a given path)
 * If fromPath is empty or null, searches entire schema
 */
export function searchSubschema(
  searchTerm: string,
  fromPath: string[] | null = null,
  useFHSSchema = false,
): SearchResult[] {
  const root = asSchemaNode(getSchemaObjectForMode(useFHSSchema));
  if (!root) return [];

  if (!searchTerm.trim()) return [];

  const term = searchTerm.toLowerCase().trim();

  // If fromPath is null or empty, search entire schema
  if (!fromPath || fromPath.length === 0) {
    // Build index from root
    const index: SearchResult[] = [];
    buildSearchIndex(root, root, [], index, new WeakSet());

    // Search and rank results
    const results: Array<SearchResult & { score: number }> = [];

    for (const item of index) {
      let score = 0;
      const keyLower = item.key.toLowerCase();
      const dotPathLower = item.dotPath.toLowerCase();

      // Exact key match (highest priority)
      if (keyLower === term) {
        score = 1000;
      }
      // Key starts with term
      else if (keyLower.startsWith(term)) {
        score = 500;
      }
      // Key contains term
      else if (keyLower.includes(term)) {
        score = 200;
      }
      // Path contains term
      else if (dotPathLower.includes(term)) {
        score = 100;
      }
      // Path segment matches
      else if (item.path.some(seg => seg.toLowerCase().includes(term))) {
        score = 50;
      }

      if (score > 0) {
        results.push({ ...item, score });
      }
    }

    // Sort by score (descending), then alphabetically
    results.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.dotPath.localeCompare(b.dotPath);
    });

    return results.map((result) => {
      const item: SearchResult & { score?: number } = { ...result };
      delete item.score;
      return item;
    });
  }

  // Build index from the subschema
  let startNode: SchemaNode | null = root;

  // Navigate to starting path
  for (const segment of fromPath) {
    if (startNode) {
      startNode = resolveNode(startNode, root);
      if (!startNode) {
        startNode = root;
        break;
      }

      if (startNode.properties && startNode.properties[segment]) {
        startNode = startNode.properties[segment];
      } else if (startNode.$defs && startNode.$defs[segment]) {
        startNode = startNode.$defs[segment];
      } else {
        // Path not found, search from root
        startNode = root;
        break;
      }
    }
  }

  // Resolve $ref if needed
  startNode = startNode ? (resolveNode(startNode, root) ?? root) : root;

  // Build index from this node's subtree
  const index: SearchResult[] = [];
  buildSearchIndex(startNode, root, fromPath, index, new WeakSet());

  // Search and rank results
  const results: Array<SearchResult & { score: number }> = [];

  for (const item of index) {
    let score = 0;
    const keyLower = item.key.toLowerCase();
    const dotPathLower = item.dotPath.toLowerCase();

    // Exact key match (highest priority)
    if (keyLower === term) {
      score = 1000;
    }
    // Key starts with term
    else if (keyLower.startsWith(term)) {
      score = 500;
    }
    // Key contains term
    else if (keyLower.includes(term)) {
      score = 200;
    }
    // Path contains term
    else if (dotPathLower.includes(term)) {
      score = 100;
    }
    // Path segment matches
    else if (item.path.some(seg => seg.toLowerCase().includes(term))) {
      score = 50;
    }

    if (score > 0) {
      // Bonus for shorter paths (closer to current location)
      const pathDepth = item.path.length - fromPath.length;
      score += Math.max(0, 10 - pathDepth);

      results.push({ ...item, score });
    }
  }

  // Sort by score (descending), then alphabetically
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.dotPath.localeCompare(b.dotPath);
  });

  return results.map((result) => {
    const item: SearchResult & { score?: number } = { ...result };
    delete item.score;
    return item;
  });
}

/**
 * Parse a path string into path array
 * Supports: JSON Pointer (#/properties/Control), dot-path (Control.setPoint), or simple name
 * Handles trailing dots by treating them as partial paths
 */
export function parsePath(pathStr: string): { path: string[]; format: 'json-pointer' | 'dot-path' | 'simple'; isPartial?: boolean } | null {
  if (!pathStr.trim()) return null;

  const trimmed = pathStr.trim();

  // JSON Pointer format
  if (trimmed.startsWith('#/')) {
    const segments = trimmed.slice(2).split('/').filter(Boolean);
    // Remove 'properties' or '$defs' prefix if present (we'll handle it in navigation)
    const filtered = segments.filter(s => s !== 'properties' && s !== '$defs');
    return { path: filtered, format: 'json-pointer' };
  }

  // Dot-path format
  if (trimmed.includes('.')) {
    const segments = trimmed.split('.').filter(Boolean);
    const isPartial = trimmed.endsWith('.');
    return { path: segments, format: 'dot-path', isPartial };
  }

  // Simple name (will trigger fuzzy search)
  return { path: [trimmed], format: 'simple' };
}
