// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, Zone } from '../../geometry/types';
import {
  DEVELOPMENT_CONTEXT_SHADING_META_KEY,
  isDevelopmentContextGeneratedShading,
  resolveDevelopmentModelVerticalContext,
  syncDevelopmentContextShadingElements,
} from '../developmentContextShading';
import { deriveFloorsFromElements } from '../floorDerivation';

const zone: Zone = {
  id: 'zone',
  name: 'Living',
  floorArea: 16,
  height: 2.4,
  volume: 38.4,
};


function ground(id: string, name: string, x0: number, y0: number, x1: number, y1: number, z = 0): Element {
  return {
    id,
    name,
    type: 'BuildingElementGround',
    zoneId: zone.id,
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
    area: Math.abs((x1 - x0) * (y1 - y0)),
    total_area: Math.abs((x1 - x0) * (y1 - y0)),
    perimeter: 2 * (Math.abs(x1 - x0) + Math.abs(y1 - y0)),
    floor_type: 'Slab_no_edge_insulation',
    parent_element: null,
    coordinates: [
      { x: x0, y: y0, z },
      { x: x1, y: y0, z },
      { x: x1, y: y1, z },
      { x: x0, y: y1, z },
    ],
  } as Element;
}

function wall(id: string, name: string, x0: number, y0: number, x1: number, y1: number, height = 2.4, baseHeight = 0): Element {
  return {
    id,
    name,
    type: 'BuildingElementOpaque',
    zoneId: zone.id,
    area: Math.hypot(x1 - x0, y1 - y0) * height,
    pitch: 90,
    width: Math.hypot(x1 - x0, y1 - y0),
    height,
    orientation360: 0,
    base_height: baseHeight,
    is_unheated_pitched_roof: false,
    is_external_door: false,
    parent_element: null,
    coordinates: [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
    ],
  } as Element;
}

function contextShading(
  id: string,
  name: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  height = 4,
  shadingType: 'obstacle' | 'overhang' = 'obstacle',
): Element {
  return {
    id,
    name,
    type: 'ContextShading',
    shading_type: shadingType,
    start_angle: 0,
    end_angle: 0,
    distance: 0,
    height,
    parent_element: 'Source Ground',
    coordinates: [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
      { x: x0, y: y1, z: 0 },
    ],
  } as Element;
}

function contextModel(stem: string, elements: Element[]) {
  return {
    stem,
    elements,
    zones: [zone],
    floors: deriveFloorsFromElements(elements),
  };
}

describe('developmentContextShading', () => {
  it('derives floors from context model coordinate z values', () => {
    const floors = deriveFloorsFromElements([
      ground('g0', 'Ground', 0, 0, 4, 4, 0),
      ground('g2', 'Second', 0, 0, 4, 4, 2),
    ]);
    expect(floors.map((floor) => floor.zIndex)).toEqual([0, 2]);
  });

  it('uses ventilation zone base height as vertical placement when local fabric starts at zero', () => {
    const elements = [
      ground('source-ground', 'Source Ground', 8, 0, 12, 4),
      wall('source-wall', 'Source Wall', 8, 0, 12, 0, 2.7),
    ];
    const vertical = resolveDevelopmentModelVerticalContext({
      elements,
      zones: [zone],
      floors: deriveFloorsFromElements(elements),
      complianceSettings: {
        Ventilation_ventilation_zone_base_height: 3.1,
      },
    });
    expect(vertical.baseM).toBe(3.1);
    expect(vertical.topM).toBe(5.8);
    expect(vertical.source).toBe('ventilation_zone_base_height');
  });

  it('creates an idempotent generated ContextShading object for a neighbouring model', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceElements = [
      ground('source-ground', 'Source Ground', 8, 0, 12, 4),
      wall('source-wall', 'Source Wall', 8, 0, 12, 0, 2.7),
    ];
    const first = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [contextModel('plot-b', sourceElements)],
    });

    expect(first.changed).toBe(true);
    expect(first.generatedCount).toBe(1);
    const generated = Object.values(first.elementsById).find((element) => element.type === 'ContextShading') as any;
    expect(generated).toBeDefined();
    expect(generated.parent_element).toBe('Active Ground');
    expect(generated.distance).toBe(8);
    expect(generated.height).toBe(2.7);
    expect(generated.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sourceStem).toBe('plot-b');

    const second = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: first.elementsById,
      elementIds: first.elementIds,
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: sourceElements,
        zones: [zone],
        floors: deriveFloorsFromElements(sourceElements),
      }],
    });
    expect(second.changed).toBe(false);
  });

  it('rebases draft generated project shading when the draft model is renamed', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceElements = [
      ground('source-ground', 'Source Ground', 8, 0, 12, 4),
      wall('source-wall', 'Source Wall', 8, 0, 12, 0, 2.7),
    ];
    const first = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'draft_model',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [contextModel('plot-b', sourceElements)],
    });
    const draftGenerated = Object.values(first.elementsById)
      .find((element) => element.type === 'ContextShading') as any;
    expect(draftGenerated.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.activeStem).toBe('draft_model');

    const renamed = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-new',
      elementsById: first.elementsById,
      elementIds: first.elementIds,
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [contextModel('plot-b', sourceElements)],
    });
    const generated = Object.values(renamed.elementsById)
      .filter((element) => element.type === 'ContextShading') as any[];

    expect(generated).toHaveLength(1);
    expect(generated[0].id).toBe(draftGenerated.id);
    expect(generated[0].extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.activeStem).toBe('plot-new');
  });

  it('skips footprint shading when a sibling model has no explicit or derived height', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceGround = ground('source-ground', 'Source Ground', 8, 0, 12, 4);

    const result = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: [sourceGround],
        zones: [],
        floors: deriveFloorsFromElements([sourceGround]),
      }],
    });

    expect(result.changed).toBe(false);
    expect(result.generatedCount).toBe(0);
    expect(result.skippedUnknownHeightCount).toBe(1);
  });

  it('skips overlapping model footprints on the same or different storeys', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const overlappingSource = [
      ground('source-ground', 'Source Ground', 0, 0, 4, 4),
      wall('source-wall', 'Source Wall', 0, 0, 4, 0, 2.4),
    ];

    const sameFloor = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: overlappingSource,
        zones: [zone],
        floors: deriveFloorsFromElements(overlappingSource),
      }],
    });
    expect(sameFloor.generatedCount).toBe(0);
    expect(sameFloor.skippedSameFloorOverlapCount).toBe(1);

    const stacked = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: overlappingSource,
        zones: [zone],
        floors: deriveFloorsFromElements(overlappingSource),
        metadata: {
          globalOrientationOffset: 0,
          guideOverlay: null,
          guideOverlayByFloor: {},
          guideOverlaySourceByFloor: {},
          complianceSettings: {
            Ventilation_ventilation_zone_base_height: 3,
          },
        },
      }],
    });
    const generated = Object.values(stacked.elementsById).find((element) => element.type === 'ContextShading') as any;
    expect(stacked.generatedCount).toBe(0);
    expect(generated).toBeUndefined();
  });

  it('regenerates an edited project footprint shading object on sync', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceElements = [
      ground('source-ground', 'Source Ground', 8, 0, 12, 4),
      wall('source-wall', 'Source Wall', 8, 0, 12, 0, 2.4),
    ];
    const first = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: sourceElements,
        zones: [zone],
        floors: deriveFloorsFromElements(sourceElements),
      }],
    });
    const generated = Object.values(first.elementsById).find((element) => element.type === 'ContextShading')!;
    const manuallyEdited = {
      ...generated,
      distance: 99,
    } as Element;
    const second = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: {
        ...first.elementsById,
        [generated.id]: manuallyEdited,
      },
      elementIds: first.elementIds,
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: sourceElements,
        zones: [zone],
        floors: deriveFloorsFromElements(sourceElements),
      }],
    });

    expect(second.changed).toBe(true);
    expect((second.elementsById[generated.id] as any).distance).toBe((generated as any).distance);
  });

  it('shares explicit sibling ContextShading by default and recomputes parent-relative geometry', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceElements = [
      ground('source-ground', 'Source Ground', 8, 0, 12, 4),
      wall('source-wall', 'Source Wall', 8, 0, 12, 0, 2.4),
      contextShading('source-tree', 'Tree belt', 20, 0, 22, 4, 6.5, 'overhang'),
    ];

    const result = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [{
        stem: 'plot-b',
        elements: sourceElements,
        zones: [zone],
        floors: deriveFloorsFromElements(sourceElements),
      }],
    });

    const generated = Object.values(result.elementsById)
      .filter((element) => element.type === 'ContextShading') as any[];
    const sharedContext = generated.find((element) =>
      element.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sharedId
    );

    expect(result.generatedCount).toBe(2);
    expect(sharedContext).toBeDefined();
    expect(sharedContext.name).toBe('Project context - plot-b - Tree belt');
    expect(sharedContext.shading_type).toBe('overhang');
    expect(sharedContext.parent_element).toBe('Active Ground');
    expect(sharedContext.height).toBe(6.5);
    expect(sharedContext.distance).toBe(19);
    expect(sharedContext.start_angle).not.toBe(0);
    expect(isDevelopmentContextGeneratedShading(sharedContext)).toBe(false);
    expect(sharedContext.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sourceKind).toBeUndefined();
    expect(sharedContext.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sharedId).toMatch(/^ctx-/);
    expect(sharedContext.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sourceElementId).toBe('source-tree');
    expect(sharedContext.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sourceStem).toBe('plot-b');
  });

  it('materialises local explicit ContextShading as a shared editable source', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const activeContext = contextShading('active-tree', 'Tree belt', 20, 0, 22, 4, 6.5);

    const result = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: {
        [activeGround.id]: activeGround,
        [activeContext.id]: activeContext,
      },
      elementIds: [activeGround.id, activeContext.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround, activeContext]),
      contextModels: [],
    });

    const materialized = result.elementsById[activeContext.id] as any;
    const meta = materialized.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY];

    expect(result.changed).toBe(true);
    expect(result.generatedCount).toBe(0);
    expect(isDevelopmentContextGeneratedShading(materialized)).toBe(false);
    expect(meta.sharedId).toMatch(/^ctx-/);
    expect(meta.projectId).toBe('project');
    expect(meta.sourceName).toBeUndefined();
    expect(meta.sourceKind).toBeUndefined();
  });

  it('deduplicates explicit sibling ContextShading and regenerates edited generated shading', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceContext = contextShading('source-tree', 'Tree belt', 20, 0, 22, 4, 6.5);
    const sourceBElements = [ground('source-ground-b', 'Source Ground B', 8, 0, 12, 4), sourceContext];
    const sourceCElements = [
      ground('source-ground-c', 'Source Ground C', 13, 0, 17, 4),
      contextShading('source-tree-copy', 'Tree belt copy', 20, 0, 22, 4, 6.5),
    ];
    const first = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [
        contextModel('plot-b', sourceBElements),
        contextModel('plot-c', sourceCElements),
      ],
    });
    const explicitGenerated = Object.values(first.elementsById).find((element: any) =>
      element.type === 'ContextShading' &&
      element.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sharedId
    )!;
    const manuallyEdited = {
      ...explicitGenerated,
      distance: 123,
    } as Element;

    const second = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: {
        ...first.elementsById,
        [explicitGenerated.id]: manuallyEdited,
      },
      elementIds: first.elementIds,
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [
        contextModel('plot-b', sourceBElements),
        contextModel('plot-c', sourceCElements),
      ],
    });

    const explicitRows = Object.values(second.elementsById).filter((element: any) =>
      element.type === 'ContextShading' &&
      element.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sharedId
    );

    expect(first.generatedCount).toBe(3);
    expect(explicitRows).toHaveLength(1);
    expect((second.elementsById[explicitGenerated.id] as any).distance).toBe((explicitGenerated as any).distance);
  });

  it('does not treat sibling generated ContextShading or PV as generated project shading sources', () => {
    const activeGround = ground('active-ground', 'Active Ground', 0, 0, 4, 4);
    const sourceGround = ground('source-ground', 'Source Ground', 8, 0, 12, 4);
    const generatedSourceContext = {
      ...contextShading('generated-source-context', 'Generated source context', 20, 0, 22, 4, 6.5),
      extra_json: {
        [DEVELOPMENT_CONTEXT_SHADING_META_KEY]: {
          version: 1,
          projectId: 'project',
          activeStem: 'plot-b',
          sourceStem: 'plot-a',
          sourceElementId: 'active-ground',
          sourceKey: 'legacy',
          sourceFingerprint: 'legacy',
          generatedSignature: 'legacy',
          verticalRelation: 'same',
        },
      },
    } as Element;
    const pv = {
      id: 'pv',
      name: 'PV canopy',
      type: 'OnSiteGeneration',
      parent_element: null,
      coordinates: [
        { x: 30, y: 0, z: 0 },
        { x: 34, y: 0, z: 0 },
        { x: 34, y: 4, z: 0 },
        { x: 30, y: 4, z: 0 },
      ],
    } as Element;

    const result = syncDevelopmentContextShadingElements({
      projectId: 'project',
      activeStem: 'plot-a',
      elementsById: { [activeGround.id]: activeGround },
      elementIds: [activeGround.id],
      zones: [zone],
      floors: deriveFloorsFromElements([activeGround]),
      contextModels: [contextModel('plot-b', [sourceGround, generatedSourceContext, pv])],
    });

    const generated = Object.values(result.elementsById)
      .filter((element) => element.type === 'ContextShading') as any[];
    expect(result.generatedCount).toBe(1);
    expect(generated).toHaveLength(1);
    expect(generated[0].extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY]?.sourceKind).toBe('model_footprint');
  });
});
