// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { calculateDirectionArrow, calculateArrowPoints } from '../directionArrows';

describe('Direction Arrow Calculations', () => {
  describe('calculateDirectionArrow', () => {
    it('should calculate arrow for horizontal line (always perpendicular)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ],
        orientation360: 0 // This value is ignored - arrow always points perpendicular
      };
      
      const result = calculateDirectionArrow(element as any);
      
      // Horizontal line A→B points east, so the outward arrow points south.
      expect(result).toEqual({
        centerX: 5,
        centerY: 0,
        arrowX: 5,
        arrowY: -0.25,
        orientation: 180,
      });
    });

    it('should ignore orientation360 for horizontal line (always perpendicular = North)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ],
        orientation360: 90 // Ignored — arrow is always perpendicular to wall geometry
      };
      
      const result = calculateDirectionArrow(element as any);
      
      // Horizontal line always has the same outward normal regardless of orientation360.
      expect(result?.centerX).toBeCloseTo(5, 5);
      expect(result?.centerY).toBeCloseTo(0, 5);
      expect(result?.arrowX).toBeCloseTo(5, 5);
      expect(result?.arrowY).toBeCloseTo(-0.25, 5);
      expect(result?.orientation).toBeCloseTo(180, 5);
    });

    it('should ignore orientation360=180 for horizontal line (perpendicular still North)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ],
        orientation360: 180 // Ignored
      };
      
      const result = calculateDirectionArrow(element as any);
      
      expect(result?.centerX).toBeCloseTo(5, 5);
      expect(result?.centerY).toBeCloseTo(0, 5);
      expect(result?.arrowX).toBeCloseTo(5, 5);
      expect(result?.arrowY).toBeCloseTo(-0.25, 5);
      expect(result?.orientation).toBeCloseTo(180, 5);
    });

    it('should ignore orientation360=270 for horizontal line (perpendicular still North)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ],
        orientation360: 270 // Ignored
      };
      
      const result = calculateDirectionArrow(element as any);
      
      expect(result?.centerX).toBeCloseTo(5, 5);
      expect(result?.centerY).toBeCloseTo(0, 5);
      expect(result?.arrowX).toBeCloseTo(5, 5);
      expect(result?.arrowY).toBeCloseTo(-0.25, 5);
      expect(result?.orientation).toBeCloseTo(180, 5);
    });

    it('should calculate perpendicular for vertical line (always East)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 10, z: 0 }
        ],
        orientation360: 0 // Ignored
      };
      
      const result = calculateDirectionArrow(element as any);
      
      // Vertical line going south: perpendicular points East (90°)
      expect(result?.centerX).toBeCloseTo(0, 5);
      expect(result?.centerY).toBeCloseTo(5, 5);
      expect(result?.arrowX).toBeCloseTo(0.25, 5); // Perpendicular = East
      expect(result?.arrowY).toBeCloseTo(5, 5);
      expect(result?.orientation).toBeCloseTo(90, 5);
    });

    it('should calculate arrow for diagonal line pointing northeast (orientation360: 45)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 10, z: 0 }
        ],
        orientation360: 45
      };
      
      const result = calculateDirectionArrow(element as any);
      
      // Line goes NE, so the outward normal points SE.
      const expectedArrowX = 5 + 0.25 * Math.cos((45 - 90) * Math.PI / 180);
      const expectedArrowY = 5 + 0.25 * Math.sin((45 - 90) * Math.PI / 180);
      
      expect(result?.centerX).toBeCloseTo(5, 5);
      expect(result?.centerY).toBeCloseTo(5, 5);
      expect(result?.arrowX).toBeCloseTo(expectedArrowX, 5);
      expect(result?.arrowY).toBeCloseTo(expectedArrowY, 5);
      expect(result?.orientation).toBe(135);
    });

    it('should return null for non-line elements', () => {
      const element = {
        type: 'BuildingElementGround' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
          { x: 10, y: 10, z: 0 }
        ],
        orientation360: 0
      };
      
      const result = calculateDirectionArrow(element as any);
      expect(result).toBeNull();
    });

    it('should return null for elements without orientation360', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ]
        // No orientation360 property
      };
      
      const result = calculateDirectionArrow(element as any);
      expect(result).toBeNull();
    });

    it('should return null for elements with wrong number of coordinates', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 }
        ], // Only one point
        orientation360: 0
      };
      
      const result = calculateDirectionArrow(element as any);
      expect(result).toBeNull();
    });
  });

  describe('calculateArrowPoints', () => {
    it('should calculate arrowhead points for north-pointing arrow', () => {
      const arrow = {
        centerX: 5,
        centerY: 0,
        arrowX: 5,
        arrowY: -15,
        orientation: 0
      };
      
      const result = calculateArrowPoints(arrow);
      
      // Arrowhead should point north with two side points
      expect(result.tip).toEqual({ x: 5, y: -15 });
      expect(result.left.x).toBeCloseTo(8, 1); // Left side of arrowhead (as calculated)
      expect(result.left.y).toBeCloseTo(-12, 1);
      expect(result.right.x).toBeCloseTo(2, 1); // Right side of arrowhead (as calculated)
      expect(result.right.y).toBeCloseTo(-12, 1);
    });

    it('should calculate arrowhead points for east-pointing arrow', () => {
      const arrow = {
        centerX: 5,
        centerY: 0,
        arrowX: 20,
        arrowY: 0,
        orientation: 90
      };
      
      const result = calculateArrowPoints(arrow);
      
      // Arrowhead should point east with two side points
      expect(result.tip).toEqual({ x: 20, y: 0 });
      expect(result.left.x).toBeCloseTo(17, 1); // Left side of arrowhead (as calculated)
      expect(result.left.y).toBeCloseTo(3, 1);
      expect(result.right.x).toBeCloseTo(17, 1); // Right side of arrowhead (as calculated)
      expect(result.right.y).toBeCloseTo(-3, 1);
    });

    it('should calculate arrowhead points for south-pointing arrow', () => {
      const arrow = {
        centerX: 5,
        centerY: 0,
        arrowX: 5,
        arrowY: 15,
        orientation: 180
      };
      
      const result = calculateArrowPoints(arrow);
      
      // Arrowhead should point south with two side points
      expect(result.tip).toEqual({ x: 5, y: 15 });
      expect(result.left.x).toBeCloseTo(2, 1); // Left side of arrowhead (as calculated)
      expect(result.left.y).toBeCloseTo(12, 1);
      expect(result.right.x).toBeCloseTo(8, 1); // Right side of arrowhead (as calculated)
      expect(result.right.y).toBeCloseTo(12, 1);
    });

    it('should calculate arrowhead points for west-pointing arrow', () => {
      const arrow = {
        centerX: 5,
        centerY: 0,
        arrowX: -10,
        arrowY: 0,
        orientation: 270
      };
      
      const result = calculateArrowPoints(arrow);
      
      // Arrowhead should point west with two side points
      expect(result.tip).toEqual({ x: -10, y: 0 });
      expect(result.left.x).toBeCloseTo(-7, 1); // Left side of arrowhead (as calculated)
      expect(result.left.y).toBeCloseTo(-3, 1);
      expect(result.right.x).toBeCloseTo(-7, 1); // Right side of arrowhead (as calculated)
      expect(result.right.y).toBeCloseTo(3, 1);
    });
  });

  describe('Edge Cases', () => {
    it('should ignore orientation360 outside 0-360 range (uses geometry perpendicular)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ],
        orientation360: 450 // Ignored — arrow is always perpendicular to wall geometry
      };
      
      const result = calculateDirectionArrow(element as any);
      
      expect(result?.orientation).toBeCloseTo(180, 5);
      expect(result?.arrowX).toBeCloseTo(5, 5);
      expect(result?.arrowY).toBeCloseTo(-0.25, 5);
    });

    it('should ignore negative orientation360 values (uses geometry perpendicular)', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 }
        ],
        orientation360: -90 // Ignored — arrow is always perpendicular to wall geometry
      };
      
      const result = calculateDirectionArrow(element as any);
      
      expect(result?.orientation).toBeCloseTo(180, 5);
      expect(result?.arrowX).toBeCloseTo(5, 5);
      expect(result?.arrowY).toBeCloseTo(-0.25, 5);
    });

    it('should handle very small line segments', () => {
      const element = {
        type: 'BuildingElementOpaque' as const,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 0.1, y: 0, z: 0 }
        ],
        orientation360: 0
      };
      
      const result = calculateDirectionArrow(element as any);
      
      expect(result?.centerX).toBeCloseTo(0.05, 5);
      expect(result?.centerY).toBeCloseTo(0, 5);
      expect(result?.arrowX).toBeCloseTo(0.05, 5);
      expect(result?.arrowY).toBeCloseTo(-0.25, 5);
      expect(result?.orientation).toBeCloseTo(180, 5);
    });
  });
});
