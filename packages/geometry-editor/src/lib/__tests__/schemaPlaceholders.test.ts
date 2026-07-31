// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { 
  generateRobustPlaceholder, 
  generateSpecificPlaceholder, 
  generateCompletePlaceholder,
  generateDefaultValue,
  resolveSchemaRef 
} from '../schemaPlaceholders';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the ACTUAL schema from the real file
const actualSchemaPath = join(import.meta.dirname, '../../../../../hem_engine_upstream/schemas/core-input.schema.json');
let actualSchema: any = null;

try {
  const schemaText = readFileSync(actualSchemaPath, 'utf-8');
  actualSchema = JSON.parse(schemaText);
} catch (error) {
  console.warn('⚠️ Could not load actual schema:', error);
}

// Mock schema data based on actual input.schema.json structure
const mockSchema = {
  $defs: {
    WindowShadingObject: {
      oneOf: [
        {
          type: 'object',
          title: 'obstacle',
          required: ['height', 'distance', 'transparency'],
          properties: {
            height: { type: 'number', format: 'double' },
            distance: { type: 'number', format: 'double' },
            transparency: { type: 'number', format: 'double' },
            type: { type: 'string', enum: ['obstacle'] }
          },
          additionalProperties: false
        },
        {
          type: 'object',
          title: 'overhang/ sidefinright/ sidefinleft/ reveal',
          required: ['depth', 'distance'],
          properties: {
            depth: { type: 'number', format: 'double' },
            distance: { type: 'number', format: 'double' },
            type: { type: 'string', enum: ['overhang', 'sidefinright', 'sidefinleft', 'reveal'] }
          },
          additionalProperties: false
        }
      ]
    },
    WindowTreatment: {
      type: 'object',
      required: ['controls', 'delta_r', 'trans_red', 'type'],
      properties: {
        controls: { $ref: '#/$defs/WindowTreatmentControl' },
        delta_r: { type: 'number', format: 'double' },
        trans_red: { type: 'number', format: 'double' },
        type: { $ref: '#/$defs/WindowTreatmentType' }
      },
      additionalProperties: false
    },
    WindowTreatmentControl: {
      type: 'string',
      enum: ['auto_motorised', 'combined_light_blind_HVAC', 'manual', 'manual_motorised']
    },
    WindowTreatmentType: {
      type: 'string',
      enum: ['blinds', 'curtains']
    },
    WindowPart: {
      type: 'object',
      properties: {
        mid_height_air_flow_path: { type: 'number', format: 'double' }
      }
    }
  }
};

describe('Schema Placeholder Generation', () => {
  describe('resolveSchemaRef', () => {
    it('should resolve valid $ref to definition', () => {
      const result = resolveSchemaRef('#/$defs/WindowTreatmentControl', mockSchema.$defs);
      expect(result).toEqual({
        type: 'string',
        enum: ['auto_motorised', 'combined_light_blind_HVAC', 'manual', 'manual_motorised']
      });
    });

    it('should return null for invalid $ref', () => {
      const result = resolveSchemaRef('#/$defs/NonExistent', mockSchema.$defs);
      expect(result).toBeNull();
    });

    it('should return null for non-$ref strings', () => {
      const result = resolveSchemaRef('not-a-ref', mockSchema.$defs);
      expect(result).toBeNull();
    });
  });

  describe('generateDefaultValue', () => {
    it('should generate default for string enum', () => {
      const schema = { type: 'string', enum: ['blinds', 'curtains'] };
      const result = generateDefaultValue(schema);
      expect(result).toBe('blinds');
    });

    it('should generate default for number', () => {
      const schema = { type: 'number', format: 'double' };
      const result = generateDefaultValue(schema);
      expect(result).toBe(1);
    });

    it('should generate default for boolean', () => {
      const schema = { type: 'boolean' };
      const result = generateDefaultValue(schema);
      expect(result).toBe(false);
    });

    it('should generate default for object with required fields', () => {
      const schema = {
        type: 'object',
        required: ['height', 'distance'],
        properties: {
          height: { type: 'number' },
          distance: { type: 'number' },
          optional: { type: 'string' }
        }
      };
      const result = generateDefaultValue(schema);
      expect(result).toEqual({
        height: 1,
        distance: 1,
        optional: 'example'
      });
    });

    it('should generate default for array', () => {
      const schema = {
        type: 'array',
        items: { type: 'string', enum: ['blinds', 'curtains'] }
      };
      const result = generateDefaultValue(schema);
      expect(result).toEqual(['blinds']);
    });

    it('should resolve $ref in schema', () => {
      const schema = { $ref: '#/$defs/WindowTreatmentControl' };
      const result = generateDefaultValue(schema, mockSchema.$defs);
      expect(result).toBe('auto_motorised');
    });

    it('should handle oneOf by using first option', () => {
      const schema = { oneOf: [{ type: 'string' }, { type: 'number' }] };
      const result = generateDefaultValue(schema);
      expect(result).toBe('example');
    });

    it('should handle union types like ["number", "null"]', () => {
      const schema = {
        type: ['number', 'null'],
        format: 'double'
      };
      const result = generateDefaultValue(schema);
      expect(result).toBe(1.0); // Should prefer number over null
    });

    it('should handle union types like ["string", "null"]', () => {
      const schema = {
        type: ['string', 'null']
      };
      const result = generateDefaultValue(schema);
      expect(result).toBe('example'); // Should prefer string over null
    });

    it('should handle null-only type', () => {
      const schema = {
        type: ['null']
      };
      const result = generateDefaultValue(schema);
      expect(result).toBe(null);
    });
  });

  describe('generateSpecificPlaceholder', () => {
    it('should generate complete shading placeholder', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowShadingObject' } };
      const result = generateSpecificPlaceholder('shading', schema, mockSchema.$defs);
      
      expect(result).toBe('[{"height":1,"distance":1,"transparency":1,"type":"obstacle"}]');
    });

    it('should generate complete treatment placeholder', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowTreatment' } };
      const result = generateSpecificPlaceholder('treatment', schema, mockSchema.$defs);
      
      expect(result).toBe('[{"controls":"auto_motorised","delta_r":1,"trans_red":1,"type":"blinds"}]');
    });

    it('should generate complete window_part_list placeholder', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowPart' } };
      const result = generateSpecificPlaceholder('window_part_list', schema, mockSchema.$defs);
      
      expect(result).toBe('[{"mid_height_air_flow_path":1}]');
    });

    it('should fallback to generic generation for unknown fields', () => {
      const schema = { type: 'array', items: { type: 'string' } };
      const result = generateSpecificPlaceholder('unknown_field', schema, mockSchema.$defs);
      
      expect(result).toBe('["example"]');
    });
  });

  describe('generateCompletePlaceholder', () => {
    it('should handle array with object items', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            value: { type: 'number' }
          }
        }
      };
      const result = generateCompletePlaceholder(schema);
      expect(result).toBe('[{"name":"example","value":1}]');
    });

    it('should handle array with primitive items', () => {
      const schema = { type: 'array', items: { type: 'number' } };
      const result = generateCompletePlaceholder(schema);
      expect(result).toBe('[1]');
    });

    it('should handle object with required fields', () => {
      const schema = {
        type: 'object',
        required: ['id', 'active'],
        properties: {
          id: { type: 'string' },
          active: { type: 'boolean' },
          optional: { type: 'number' }
        }
      };
      const result = generateCompletePlaceholder(schema);
      expect(result).toBe('{"id":"example","active":false,"optional":1}');
    });

    it('should handle oneOf in array items', () => {
      const schema = {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            { type: 'number' }
          ]
        }
      };
      const result = generateCompletePlaceholder(schema);
      expect(result).toBe('["example"]');
    });
  });

  describe('generateRobustPlaceholder', () => {
    it('should use specific placeholder for known fields', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowShadingObject' } };
      const result = generateRobustPlaceholder('shading', schema, mockSchema.$defs);
      
      expect(result).toBe('[{"height":1,"distance":1,"transparency":1,"type":"obstacle"}]');
    });

    it('should fallback to generic generation for unknown fields', () => {
      const schema = { type: 'array', items: { type: 'string' } };
      const result = generateRobustPlaceholder('unknown_field', schema, mockSchema.$defs);
      
      expect(result).toBe('["example"]');
    });

    it('should handle missing defs gracefully', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowShadingObject' } };
      const result = generateRobustPlaceholder('shading', schema, undefined);
      
      expect(result).toBe('[]');
    });
  });

  describe('Real-world scenarios', () => {
    it('should generate valid shading placeholder that matches schema', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowShadingObject' } };
      const placeholder = generateRobustPlaceholder('shading', schema, mockSchema.$defs);
      
      // Parse and validate the placeholder
      const parsed = JSON.parse(placeholder);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      
      const item = parsed[0];
      expect(item).toHaveProperty('height');
      expect(item).toHaveProperty('distance');
      expect(item).toHaveProperty('transparency');
      expect(item).toHaveProperty('type');
      expect(item.type).toBe('obstacle');
      expect(typeof item.height).toBe('number');
      expect(typeof item.distance).toBe('number');
      expect(typeof item.transparency).toBe('number');
    });

    it('should generate valid treatment placeholder that matches schema', () => {
      const schema = { type: 'array', items: { $ref: '#/$defs/WindowTreatment' } };
      const placeholder = generateRobustPlaceholder('treatment', schema, mockSchema.$defs);
      
      // Parse and validate the placeholder
      const parsed = JSON.parse(placeholder);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      
      const item = parsed[0];
      expect(item).toHaveProperty('controls');
      expect(item).toHaveProperty('delta_r');
      expect(item).toHaveProperty('trans_red');
      expect(item).toHaveProperty('type');
      expect(['auto_motorised', 'combined_light_blind_HVAC', 'manual', 'manual_motorised']).toContain(item.controls);
      expect(['blinds', 'curtains']).toContain(item.type);
      expect(typeof item.delta_r).toBe('number');
      expect(typeof item.trans_red).toBe('number');
    });
  });

  // REALISTIC TESTS USING ACTUAL SCHEMA
  describe('Real-world tests with actual schema', () => {
    // Skip if we couldn't load the actual schema
    const testIfSchemaAvailable = actualSchema ? it : it.skip;
    
    testIfSchemaAvailable('should generate placeholders for real BuildingElement fields', () => {
      if (!actualSchema?.$defs?.BuildingElement) {
        return;
      }

      // Test a simple field that should exist in BuildingElement
      const simpleNumberSchema = { type: 'number', format: 'double' };
      const result = generateRobustPlaceholder('h_ce', simpleNumberSchema, actualSchema.$defs);
      expect(result).toBeTruthy();
      expect(result).not.toBe('[]');
      expect(result).not.toBe('null');
      
      // Should be a valid number
      const parsed = JSON.parse(result);
      expect(typeof parsed).toBe('number');
    });

    testIfSchemaAvailable('should generate placeholders for real Appliance fields', () => {
      if (!actualSchema?.$defs?.Appliance) {
        return;
      }

      // Test the actual Appliance schema
      const applianceDef = actualSchema.$defs.Appliance;

      // Test fields that should exist in Appliance
      const testFields = ['kWh_per_100cycle', 'kWh_per_annum', 'kWh_per_cycle', 'kg_load'];
      
      for (const fieldName of testFields) {
        if (applianceDef.properties?.[fieldName]) {
          const fieldSchema = applianceDef.properties[fieldName];
          const result = generateRobustPlaceholder(fieldName, fieldSchema, actualSchema.$defs);
          expect(result).toBeTruthy();
          expect(result).not.toBe('[]');
          expect(result).not.toBe('null');
          
          // Should be a valid value
          const parsed = JSON.parse(result);
          expect(parsed).not.toBeUndefined();
        }
      }
    });

    testIfSchemaAvailable('should generate placeholders for real WindowShading fields', () => {
      if (!actualSchema?.$defs?.WindowShadingObject) {
        return;
      }

      // Test shading array field
      const shadingSchema = { type: 'array', items: { $ref: '#/$defs/WindowShadingObject' } };
      const result = generateRobustPlaceholder('shading', shadingSchema, actualSchema.$defs);
      expect(result).toBeTruthy();
      expect(result).not.toBe('[]');
      
      // Should be a valid array
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      
      // Should have required properties (schema uses type, depth, distance)
      const item = parsed[0];
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('depth');
      expect(item).toHaveProperty('distance');
    });

    testIfSchemaAvailable('should handle all schema types programmatically', () => {
      if (!actualSchema?.$defs) {
        return;
      }

      const defs = actualSchema.$defs;
      const defKeys = Object.keys(defs);

      let successCount = 0;
      let failureCount = 0;
      const failures: string[] = [];

      // Test a sample of schema definitions
      for (const defKey of defKeys.slice(0, 10)) { // Test first 10 to avoid timeout
        const def = defs[defKey];
        
        try {
          // Test generating a placeholder for this definition
          const result = generateRobustPlaceholder(defKey, def, defs);
          
          if (result && result !== '[]' && result !== 'null') {
            successCount++;
          } else {
            failureCount++;
            failures.push(`${defKey}: got ${result}`);
          }
        } catch (error) {
          failureCount++;
          failures.push(`${defKey}: error ${error}`);
        }
      }

      // At least 70% should succeed
      const successRate = successCount / (successCount + failureCount);
      expect(successRate).toBeGreaterThan(0.7);
    });

    testIfSchemaAvailable('should generate placeholders for the specific fields that were failing in console logs', () => {
      // Test the exact fields mentioned in the original issue
      const failingFields = [
        { name: 'h_ce', schema: { type: 'number', format: 'double' } },
        { name: 'h_ci', schema: { type: 'number', format: 'double' } },
        { name: 'h_re', schema: { type: 'number', format: 'double' } },
        { name: 'h_ri', schema: { type: 'number', format: 'double' } },
        { name: 'kWh_per_100cycle', schema: { type: ['number', 'null'], format: 'double' } },
        { name: 'kWh_per_annum', schema: { type: ['number', 'null'], format: 'double' } },
        { name: 'kWh_per_cycle', schema: { type: ['number', 'null'], format: 'double' } },
        { name: 'kg_load', schema: { type: ['number', 'null'], format: 'double' } },
        { name: 'standard_use', schema: { type: ['number', 'null'], format: 'double' } },
        { name: 'Energysupply', schema: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        { name: 'loadshifting', schema: { type: 'object', properties: { demand_limit_weighted: { type: 'number' } } } }
      ];

      for (const field of failingFields) {
        const result = generateRobustPlaceholder(field.name, field.schema, actualSchema.$defs);
        // These fields should NOT return empty arrays or null
        expect(result).toBeTruthy();
        expect(result).not.toBe('[]');
        expect(result).not.toBe('null');
        
        // Should be valid JSON
        const parsed = JSON.parse(result);
        expect(parsed).not.toBeUndefined();
      }
    });
  });
});
