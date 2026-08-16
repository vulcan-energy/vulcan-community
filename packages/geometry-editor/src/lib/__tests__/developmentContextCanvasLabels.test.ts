// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, Floor, SpaceLabel, Zone } from '../../geometry/types';
import type { ParsedCsvMetadata } from '../../geometry/io/parseCsvToGeometry';
import type { DevelopmentContextModel } from '../developmentContext';
import {
  buildDevelopmentContextModelLabels,
  getDevelopmentContextFloorInfo,
  getDevelopmentContextValidationInfo,
} from '../developmentContextCanvasLabels';

const metadata: ParsedCsvMetadata = {
  globalOrientationOffset: 0,
  guideOverlay: null,
  guideOverlayByFloor: {},
  guideOverlaySourceByFloor: {},
  floorHeightOverrides: [],
  floorBaseHeightOverrides: [],
  complianceSettings: {},
};

function contextModel(stem: string, storeyOfDwelling: number | undefined, z = 0): DevelopmentContextModel {
  return {
    stem,
    elements: [{
      id: `${stem}-ground`,
      name: 'Ground',
      type: 'BuildingElementGround',
      coordinates: [
        { x: 0, y: 0, z },
        { x: 4, y: 0, z },
        { x: 4, y: 4, z },
        { x: 0, y: 4, z },
      ],
    } as Element],
    zones: [] as Zone[],
    floors: [] as Floor[],
    spaceLabels: [] as SpaceLabel[],
    metadata: {
      ...metadata,
      complianceSettings: {
        ...(storeyOfDwelling === undefined ? {} : { storey_of_dwelling: storeyOfDwelling }),
      },
    },
  };
}

describe('developmentContextCanvasLabels', () => {
  it('uses storey_of_dwelling as the displayed floor', () => {
    expect(getDevelopmentContextFloorInfo(contextModel('flat-2', 2)).label).toBe('F2');
  });

  it('falls back to geometry floor when metadata is missing', () => {
    expect(getDevelopmentContextFloorInfo(contextModel('flat-geometry', undefined, 1)).label).toBe('F2');
  });

  it('summarizes validation cache entries without treating missing cache as valid', () => {
    expect(getDevelopmentContextValidationInfo('flat-1', {}).state).toBe('unknown');
    expect(getDevelopmentContextValidationInfo('flat-1', {
      'flat-1': {
        warnings: [],
        criticalIssues: [],
        validatedAt: '2026-05-24T00:00:00.000Z',
      },
    }).text).toBe('OK');
    expect(getDevelopmentContextValidationInfo('flat-1', {
      'flat-1.csv': {
        warnings: ['Check model'],
        criticalIssues: [],
        validatedAt: '2026-05-24T00:00:00.000Z',
      },
    }).state).toBe('warning');
    expect(getDevelopmentContextValidationInfo('flat-1', {
      'flat-1': {
        warnings: [],
        criticalIssues: ['Broken geometry'],
        validatedAt: '2026-05-24T00:00:00.000Z',
      },
    }).state).toBe('error');
  });

  it('collapses superimposed sibling models into a selectable stacked label', () => {
    const labels = buildDevelopmentContextModelLabels({
      bounds: [
        { stem: 'flat-1', minX: 100, minY: 100, maxX: 200, maxY: 200, verticalRelation: 'same' },
        { stem: 'flat-2', minX: 102, minY: 102, maxX: 202, maxY: 202, verticalRelation: 'above' },
      ],
      contextModels: [
        contextModel('flat-1', 1),
        contextModel('flat-2', 2),
      ],
      csvValidationCache: {
        'flat-1': {
          warnings: [],
          criticalIssues: [],
          validatedAt: '2026-05-24T00:00:00.000Z',
        },
        'flat-2': {
          warnings: ['Check model'],
          criticalIssues: [],
          validatedAt: '2026-05-24T00:00:00.000Z',
        },
      },
      stageWidth: 800,
      stageHeight: 600,
    });

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      isStack: true,
      primaryText: '2 stacked',
      floorText: 'F1-F2',
      statusText: '1! 1OK',
      statusState: 'mixed',
      stems: ['flat-1', 'flat-2'],
    });
  });

  it('keeps spatially separate sibling model labels independent', () => {
    const labels = buildDevelopmentContextModelLabels({
      bounds: [
        { stem: 'flat-1', minX: 100, minY: 100, maxX: 200, maxY: 200, verticalRelation: 'same' },
        { stem: 'flat-2', minX: 400, minY: 100, maxX: 500, maxY: 200, verticalRelation: 'above' },
      ],
      contextModels: [
        contextModel('flat-1', 1),
        contextModel('flat-2', 2),
      ],
      csvValidationCache: {},
      stageWidth: 800,
      stageHeight: 600,
    });

    expect(labels.map((label) => label.isStack)).toEqual([false, false]);
    expect(labels.map((label) => label.floorText)).toEqual(['F1', 'F2']);
  });
});
