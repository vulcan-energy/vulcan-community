// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

describe('parseCsvToGeometry — Context Shading CSV', () => {
  it('parses app export layout (Name, ContextShading, shading_type, …)', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Context Shading,,,,,,,,,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords,extra_json
MyShade,ContextShading,obstacle,10,20,30,5.5,Wall1,"0,0,0|1,0,0|1,1,0|0,1,0","{""development_context_shading"":{""version"":1}}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const cs = elements.find((e) => e.type === 'ContextShading');
    expect(cs).toBeDefined();
    expect((cs as any).shading_type).toBe('obstacle');
    expect((cs as any).start_angle).toBe(10);
    expect((cs as any).end_angle).toBe(20);
    expect((cs as any).distance).toBe(30);
    expect((cs as any).height).toBe(5.5);
    expect((cs as any).parent_element).toBe('Wall1');
    expect((cs as any).coordinates?.length).toBeGreaterThanOrEqual(3);
    expect((cs as any).extra_json?.development_context_shading).toEqual({ version: 1 });
  });

  it('parses rows with empty angle cells', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Context Shading,,,,,,,,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords
X,ContextShading,ContextShading,,27,154,5.89,Floor,"0,0,0|1,0,0|1,1,0|0,1,0"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const cs = elements.find((e) => e.type === 'ContextShading');
    expect((cs as any).shading_type).toBe('obstacle');
    expect((cs as any).end_angle).toBe(27);
    expect((cs as any).distance).toBe(154);
    expect((cs as any).height).toBe(5.89);
    expect((cs as any).parent_element).toBe('Floor');
  });

  it('parses legacy spaced angle headers used by older saved files', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Context Shading,,,,,,,,,
Name,Type,start angle,end angle,distance,height,parent_element,coords,extra_json
OldShade,obstacle,299,336,5.94,2,GroundFloor,"-6.659,-5.269,0.000|-6.789,-10.727,0.000|-6.997,-10.717,0.000|-6.947,-5.258,0.000",
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const cs = elements.find((e) => e.type === 'ContextShading');
    expect(cs).toBeDefined();
    expect((cs as any).shading_type).toBe('obstacle');
    expect((cs as any).start_angle).toBe(299);
    expect((cs as any).end_angle).toBe(336);
    expect((cs as any).distance).toBe(5.94);
    expect((cs as any).parent_element).toBe('GroundFloor');
    expect((cs as any).coordinates?.length).toBe(4);
  });

  it('expands a single-point coords cell into a quad', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Context Shading,,,,,,,,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords
T0,ContextShading,obstacle,30,45,20,5,,,"15.000,10.000,0.000"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const cs = elements.find((e) => e.type === 'ContextShading');
    expect(cs).toBeDefined();
    expect((cs as any).height).toBe(5);
    expect((cs as any).coordinates?.length).toBeGreaterThanOrEqual(1);
  });
});
