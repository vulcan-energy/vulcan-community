// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { getElementShape, isTypeShapeCompatible, convertShapeCoordinates, canDeleteVertexFromElement } from '../shapeUtils';

const makeEl = (type: any, coords: Array<{x:number,y:number,z:number}>) => ({ id: 'e1', type, name: 'E1', zoneId: 'z1', coordinates: coords } as any);

describe('shapeUtils', () => {
  it('getElementShape detects point/line/polygon by coordinate count', () => {
    expect(getElementShape(makeEl('Appliance', [{x:0,y:0,z:0}]) as any)).toBe('point');
    expect(getElementShape(makeEl('BuildingElementOpaque', [{x:0,y:0,z:0},{x:1,y:0,z:0}]) as any)).toBe('line');
    expect(getElementShape(makeEl('BuildingElementGround', [{x:0,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0}]) as any)).toBe('polygon');
  });

  it('canDeleteVertexFromElement: polygon and sloped-polygon with 4+ vertices', () => {
    const tri = makeEl('BuildingElementGround', [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ]);
    expect(canDeleteVertexFromElement(tri as any)).toBe(false);
    const quad = makeEl('BuildingElementOpaque', [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ]);
    expect(canDeleteVertexFromElement(quad as any)).toBe(true);
    const line = makeEl('BuildingElementOpaque', [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    expect(canDeleteVertexFromElement(line as any)).toBe(false);
    const sloped = {
      ...makeEl('OnSiteGeneration', [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0.5, z: 0.2 },
        { x: 0, y: 0.5, z: 0.2 },
      ]),
      pitch: 30,
    };
    expect(canDeleteVertexFromElement(sloped as any)).toBe(true);
  });

  it('isTypeShapeCompatible basic expectations', () => {
    expect(isTypeShapeCompatible('ThermalBridgePoint' as any, 'point')).toBe(true);
    expect(isTypeShapeCompatible('BuildingElementOpaque' as any, 'line')).toBe(true);
    expect(isTypeShapeCompatible('BuildingElementOpaque' as any, 'polygon')).toBe(true);
  });

  it('convert polygon→line keeps the longest edge', () => {
    const el = makeEl('BuildingElementOpaque', [
      {x:0,y:0,z:0}, {x:3,y:0,z:0}, {x:3,y:1,z:0}, {x:0,y:1,z:0}
    ]);
    const line = convertShapeCoordinates(el as any, 'line');
    expect(line.length).toBe(2);
    // Expect endpoints to be (0,0) and (3,0) or the top edge
    const pts = line.map(p => `${p.x},${p.y}`).sort();
    expect(pts).toContain('0,0');
    expect(pts).toContain('3,0');
  });

  it('convert line→polygon extrudes a thin rectangle', () => {
    const el = makeEl('BuildingElementOpaque', [ {x:0,y:0,z:0}, {x:2,y:0,z:0} ]);
    const poly = convertShapeCoordinates(el as any, 'polygon');
    expect(poly.length).toBe(4);
    // Expect some y-offset from 0 due to thickness
    const ys = poly.map(p => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
  });

  it('convert point→line and point→polygon seeds defaults', () => {
    const pt = makeEl('Appliance', [ {x:1,y:1,z:0} ]);
    const line = convertShapeCoordinates(pt as any, 'line');
    expect(line.length).toBe(2);
    const poly = convertShapeCoordinates(pt as any, 'polygon');
    expect(poly.length).toBe(4);
  });

  it('preserves z when converting', () => {
    const el = makeEl('BuildingElementOpaque', [ {x:0,y:0,z:2}, {x:1,y:0,z:2} ]);
    const poly = convertShapeCoordinates(el as any, 'polygon');
    expect(poly.every(p => p.z === 2)).toBe(true);
  });
});


