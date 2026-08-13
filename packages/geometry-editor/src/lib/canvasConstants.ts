// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Canvas rendering constants
export const CANVAS_CONSTANTS = {
  // Opacity values
  OPACITY: {
    CURRENT_FLOOR: 1.0,
    /** Off active toolbar floor: 2D plan and 3D (`elementCanvasFloor3dMaterial`). */
    OTHER_FLOORS: 0.2,
  },

  // Label rendering
  LABEL: {
    HEIGHT: 24,
    MARGIN: 8,
    PADDING: 8,
    SPACING: 6,
  },

  // Colors
  COLORS: {
    WALL: '#EAFD5A',
    GROUND: '#B7CEC4',
    WINDOW: '#87CEEB',
    SELECTED: '#FF6B6B',
    HANDLE: '#FFD93D',
    TEXT: '#FFFFFF',
    DRAWING_PREVIEW: '#FFD93D',
    VALIDATION_ERROR: '#E74C3C',
    VALIDATION_WARNING: '#F59E0B',
    VALIDATION_WARNING_BORDER: '#D97706',
  },

  VIEW: {
    MIN_SCALE: 0.5,
    MAX_SCALE: 9,
  },

  // Element types that support different drawing modes
  DRAWING_ELEMENT_TYPES: {
    LINE: [
      'BuildingElementOpaque',
      'BuildingElementTransparent',
      'BuildingElementGround',
      'ThermalBridgeLinear',
      'MechanicalVentilationDuctwork',
      'WaterPipework',
      'WetEmitter',
      'BuildingElementAdjacentConditionedSpace',
      'BuildingElementAdjacentUnconditionedSpace_Simple',
      'BuildingElementPartyWall'
    ] as const,

    POLYGON: [
      'BuildingElementOpaque',
      'BuildingElementTransparent',
      'BuildingElementGround',
      'ContextShading',
      'BuildingElementAdjacentConditionedSpace',
      'BuildingElementAdjacentUnconditionedSpace_Simple',
      'WetEmitter',
      'OnSiteGeneration'
    ] as const,

    ROOM: [
      'BuildingElementOpaque',
      'BuildingElementTransparent',
      'BuildingElementAdjacentConditionedSpace',
      'BuildingElementAdjacentUnconditionedSpace_Simple'
    ] as const,

    SLOPED_POLYGON: [
      'BuildingElementOpaque',
      'BuildingElementTransparent',
      'OnSiteGeneration'
    ] as const,

    POINT: [
      'ThermalBridgePoint',
      'Lighting',
      'Appliance',
      'HotWaterDemand',
      'Vents',
      'MechanicalVentilation',
      'MechanicalVentilationTerminal',
      'CombustionAppliances',
      'WindowShading',
      'ElectricBattery',
      'System'
    ] as const,
  },

  // Default values
  DEFAULTS: {
    DRAW_ELEMENT_TYPE: 'BuildingElementOpaque' as const,
    STAGE_SIZE: { width: 800, height: 600 },
    SCALE: 1,
    PAN_OFFSET: { x: 0, y: 0 },
  },
};
