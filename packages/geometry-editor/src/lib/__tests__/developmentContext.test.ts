// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  getDevelopmentContextStems,
  normalizeBaseModelStem,
  resolveDevelopmentContextProject,
  resolveNewModelDevelopmentContextProjectId,
  parseDevelopmentContextModel,
  type DevelopmentContextProject,
} from '../developmentContext';
import { getEffectiveStoreyHeight } from '../zoneDerivation';

const collectionProject: DevelopmentContextProject = {
  id: 'collection',
  name: 'Collection',
  kind: 'collection',
  baseModelStems: ['plot-a', 'plot-b'],
};

const developmentProject: DevelopmentContextProject = {
  id: 'development',
  name: 'Development',
  kind: 'development',
  baseModelStems: ['plot-a', 'plot-b', 'input/base_models/plot-c.csv'],
};

describe('developmentContext', () => {
  it('normalizes model stems from names and paths', () => {
    expect(normalizeBaseModelStem('plot-a')).toBe('plot-a');
    expect(normalizeBaseModelStem('plot-a.csv')).toBe('plot-a');
    expect(normalizeBaseModelStem('input/base_models/plot-a.csv')).toBe('plot-a');
  });

  it('uses the selected development project when the current model is a member', () => {
    expect(
      resolveDevelopmentContextProject({
        projects: [collectionProject, developmentProject],
        selectedProjectId: 'development',
        geometryListFilter: 'all',
        currentStem: 'plot-a',
      })?.id,
    ).toBe('development');
  });

  it('uses the filtered development project when no selected project applies', () => {
    expect(
      resolveDevelopmentContextProject({
        projects: [collectionProject, developmentProject],
        selectedProjectId: null,
        geometryListFilter: 'development',
        currentStem: 'plot-a',
      })?.id,
    ).toBe('development');
  });

  it('uses an explicit draft development project before the new model has a saved stem', () => {
    expect(
      resolveDevelopmentContextProject({
        projects: [collectionProject, developmentProject],
        selectedProjectId: null,
        geometryListFilter: 'all',
        currentStem: 'draft_model',
        draftProjectContextId: 'development',
      })?.id,
    ).toBe('development');
  });

  it('keeps the visible inferred development when creating a new model from All models', () => {
    expect(
      resolveNewModelDevelopmentContextProjectId({
        projects: [collectionProject, developmentProject],
        selectedProjectId: null,
        geometryListFilter: 'all',
        currentStem: 'plot-a',
      }),
    ).toBe('development');
  });

  it('keeps an existing draft development context when starting another new model', () => {
    expect(
      resolveNewModelDevelopmentContextProjectId({
        projects: [collectionProject, developmentProject],
        selectedProjectId: null,
        geometryListFilter: 'all',
        currentStem: 'draft_model',
        draftProjectContextId: 'development',
      }),
    ).toBe('development');
  });

  it('does not use an explicit draft context for collection projects', () => {
    expect(
      resolveDevelopmentContextProject({
        projects: [collectionProject, developmentProject],
        selectedProjectId: null,
        geometryListFilter: 'all',
        currentStem: 'draft_model',
        draftProjectContextId: 'collection',
      }),
    ).toBeNull();
  });

  it('does not use collection projects as development context', () => {
    expect(
      resolveDevelopmentContextProject({
        projects: [collectionProject],
        selectedProjectId: 'collection',
        geometryListFilter: 'collection',
        currentStem: 'plot-a',
      }),
    ).toBeNull();
  });

  it('does not merge multiple development projects without an explicit selected or filtered project', () => {
    expect(
      resolveDevelopmentContextProject({
        projects: [
          developmentProject,
          {
            ...developmentProject,
            id: 'development-2',
            name: 'Second Development',
            baseModelStems: ['plot-a', 'plot-d'],
          },
        ],
        selectedProjectId: null,
        geometryListFilter: 'all',
        currentStem: 'plot-a',
      }),
    ).toBeNull();
  });

  it('excludes the active model and de-duplicates context stems', () => {
    expect(
      getDevelopmentContextStems(
        {
          ...developmentProject,
          baseModelStems: ['plot-a', 'plot-b', 'plot-b.csv', 'input/base_models/plot-c.csv'],
        },
        'input/base_models/plot-a.csv',
      ),
    ).toEqual(['plot-b', 'plot-c']);
  });

  it('keeps all project members as context while the current model is draft_model', () => {
    expect(
      getDevelopmentContextStems(developmentProject, 'draft_model'),
    ).toEqual(['plot-a', 'plot-b', 'plot-c']);
  });

  it('keeps parsed metadata and derives local floors for context shading', () => {
    const model = parseDevelopmentContextModel('plot-b.csv', `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
General_storey_of_dwelling,2,,,,,,,,,,,,,
Ventilation_ventilation_zone_base_height,3.1,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Ground Elements,,,,,,,,,,,,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Ground,Living,BuildingElementGround,25,5,5,20,Slab_no_edge_insulation,,,,"0,0,0|5,0,0|5,5,0|0,5,0",

Exposed Elements,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
UpperWall,Living,BuildingElementOpaque,12,90,5,2.4,0,3.1,FALSE,FALSE,,"0,0,1|5,0,1",
`.trim());

    expect(model.stem).toBe('plot-b');
    expect(model.metadata.complianceSettings.storey_of_dwelling).toBe(2);
    expect(model.metadata.complianceSettings.Ventilation_ventilation_zone_base_height).toBe(3.1);
    expect(model.floors.map((floor) => floor.zIndex)).toEqual([0, 1]);
  });

  // Wall-derived height for Floor 0 below is 2.4 (from the ground wall). A `FloorHeightOverride`
  // row records a typed storey height that must win over that derivation — the same reconciliation
  // `ioSlice`'s `loadFromCSV` applies for the primary editor model (see `applyFloorHeightOverrides`
  // in `floorDerivation.ts`). Without it, a neighbour dwelling's typed storey height was silently
  // dropped and context shading fell back to the wall-derived height instead.
  const neighbourCsv = (floorHeightOverrideRow: string) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
${floorHeightOverrideRow}

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
GroundWall,Living,BuildingElementOpaque,9.6,90,4,2.4,180,0,FALSE,FALSE,,"0,0,0|4,0,0",
`.trim();

  it('applies a persisted FloorHeightOverride row onto a neighbour model floor', () => {
    const model = parseDevelopmentContextModel('plot-d.csv', neighbourCsv('FloorHeightOverride,0,2.9,,,,,,,,,,,,,'));

    expect(model.metadata.floorHeightOverrides).toEqual([{ zIndex: 0, height: 2.9 }]);
    const floor0 = model.floors.find((floor) => floor.zIndex === 0)!;
    expect(floor0.height).toBe(2.9);
    expect(floor0.heightUserOverride).toBe(true);
    expect(getEffectiveStoreyHeight(floor0, model.elements)).toBe(2.9);
  });

  it('leaves a neighbour model floor wall-derived when it carries no FloorHeightOverride row', () => {
    const model = parseDevelopmentContextModel('plot-d.csv', neighbourCsv(''));

    expect(model.metadata.floorHeightOverrides).toEqual([]);
    const floor0 = model.floors.find((floor) => floor.zIndex === 0)!;
    expect(floor0.heightUserOverride).not.toBe(true);
    expect(getEffectiveStoreyHeight(floor0, model.elements)).toBe(2.4);
  });
});
