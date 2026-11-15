// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType } from '../geometry/types';

export type ElementTypeSectionId =
  | 'fabric'
  | 'thermal-bridges'
  | 'shading'
  | 'ventilation'
  | 'heating-hot-water'
  | 'lighting-appliances'
  | 'solar-battery';

export interface ElementTypeMenuSection {
  id: ElementTypeSectionId;
  label: string;
  summary: string;
  types: readonly ElementType[];
}

export interface ElementTypeMenuOption {
  type: ElementType;
  label: string;
  subtitle: string;
  section: ElementTypeSectionId;
}

export const ELEMENT_TYPE_ORDER = [
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementGround',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
  'ThermalBridgeLinear',
  'ThermalBridgePoint',
  'WindowShading',
  'Lighting',
  'MechanicalVentilationDuctwork',
  'MechanicalVentilationTerminal',
  'WaterPipework',
  'WetEmitter',
  'Appliance',
  'HotWaterDemand',
  'ContextShading',
  'Vents',
  'MechanicalVentilation',
  'CombustionAppliances',
  'OnSiteGeneration',
  'ElectricBattery',
  'System',
] as const satisfies readonly ElementType[];

export const ELEMENT_TYPE_COMPACT_LABELS: Record<ElementType, string> = {
  BuildingElementOpaque: 'External surface',
  BuildingElementTransparent: 'Window / rooflight',
  BuildingElementGround: 'Ground floor',
  BuildingElementAdjacentConditionedSpace: 'Internal element',
  BuildingElementAdjacentUnconditionedSpace_Simple: 'Unheated boundary',
  BuildingElementPartyWall: 'Party wall',
  ThermalBridgeLinear: 'Linear bridge',
  ThermalBridgePoint: 'Point bridge',
  WindowShading: 'Window shading',
  Lighting: 'Lighting',
  MechanicalVentilationDuctwork: 'Ductwork',
  MechanicalVentilationTerminal: 'MVHR terminal',
  WaterPipework: 'Primary pipework',
  WetEmitter: 'Heat emitter',
  Appliance: 'Appliance',
  HotWaterDemand: 'Hot water outlet',
  ContextShading: 'External shading',
  Vents: 'Air vent',
  MechanicalVentilation: 'Ventilation system',
  CombustionAppliances: 'Combustion appliance',
  OnSiteGeneration: 'Solar panel',
  ElectricBattery: 'Battery storage',
  System: 'Plant system',
};

const ELEMENT_TYPE_DETAILS: Record<ElementType, Omit<ElementTypeMenuOption, 'type' | 'label'>> = {
  BuildingElementOpaque: {
    subtitle: 'External wall, roof or door',
    section: 'fabric',
  },
  BuildingElementTransparent: {
    subtitle: 'External window or rooflight',
    section: 'fabric',
  },
  BuildingElementGround: {
    subtitle: 'Ground-contact floor',
    section: 'fabric',
  },
  BuildingElementAdjacentConditionedSpace: {
    subtitle: 'Boundary to heated space',
    section: 'fabric',
  },
  BuildingElementAdjacentUnconditionedSpace_Simple: {
    subtitle: 'Boundary to loft, garage, void or exposed floor',
    section: 'fabric',
  },
  BuildingElementPartyWall: {
    subtitle: 'Wall shared with another dwelling',
    section: 'fabric',
  },
  ThermalBridgeLinear: {
    subtitle: 'Line heat-loss junction',
    section: 'thermal-bridges',
  },
  ThermalBridgePoint: {
    subtitle: 'Point heat-loss junction',
    section: 'thermal-bridges',
  },
  WindowShading: {
    subtitle: 'Overhangs, reveals and fins',
    section: 'shading',
  },
  ContextShading: {
    subtitle: 'Nearby buildings or obstructions',
    section: 'shading',
  },
  Vents: {
    subtitle: 'Passive background or purge opening',
    section: 'ventilation',
  },
  MechanicalVentilation: {
    subtitle: 'Whole-dwelling, MVHR or room system',
    section: 'ventilation',
  },
  MechanicalVentilationDuctwork: {
    subtitle: 'Supply, extract, intake or exhaust run',
    section: 'ventilation',
  },
  MechanicalVentilationTerminal: {
    subtitle: 'MVHR intake or exhaust terminal',
    section: 'ventilation',
  },
  System: {
    subtitle: 'PCDB and heating, hot water & cooling presets',
    section: 'heating-hot-water',
  },
  WetEmitter: {
    subtitle: 'Radiator, UFH or fan coil',
    section: 'heating-hot-water',
  },
  HotWaterDemand: {
    subtitle: 'Tap, shower, bath or outlet',
    section: 'heating-hot-water',
  },
  WaterPipework: {
    subtitle: 'Connects heat source and hot water cylinder',
    section: 'heating-hot-water',
  },
  CombustionAppliances: {
    subtitle: 'Legacy appliance and flue',
    section: 'heating-hot-water',
  },
  Lighting: {
    subtitle: 'Lighting points and controls',
    section: 'lighting-appliances',
  },
  Appliance: {
    subtitle: 'Electric appliance load',
    section: 'lighting-appliances',
  },
  OnSiteGeneration: {
    subtitle: 'PV array or collector',
    section: 'solar-battery',
  },
  ElectricBattery: {
    subtitle: 'Electrical storage',
    section: 'solar-battery',
  },
};

export const ELEMENT_TYPE_SECTIONS: readonly ElementTypeMenuSection[] = [
  {
    id: 'fabric',
    label: 'Building Fabric',
    summary: 'Surfaces and adjacent spaces',
    types: [
      'BuildingElementOpaque',
      'BuildingElementTransparent',
      'BuildingElementGround',
      'BuildingElementAdjacentConditionedSpace',
      'BuildingElementAdjacentUnconditionedSpace_Simple',
      'BuildingElementPartyWall',
    ],
  },
  {
    id: 'thermal-bridges',
    label: 'Thermal Bridges',
    summary: 'Linear and point junctions',
    types: ['ThermalBridgeLinear', 'ThermalBridgePoint'],
  },
  {
    id: 'shading',
    label: 'Shading',
    summary: 'Window and external obstructions',
    types: ['WindowShading', 'ContextShading'],
  },
  {
    id: 'ventilation',
    label: 'Ventilation',
    summary: 'Systems, ducts, terminals and vents',
    types: ['MechanicalVentilation', 'MechanicalVentilationDuctwork', 'MechanicalVentilationTerminal', 'Vents'],
  },
  {
    id: 'heating-hot-water',
    label: 'Heating & Hot Water',
    summary: 'Systems, emitters and pipework',
    types: ['System', 'WetEmitter', 'HotWaterDemand', 'WaterPipework', 'CombustionAppliances'],
  },
  {
    id: 'lighting-appliances',
    label: 'Lighting & Appliances',
    summary: 'Electrical loads',
    types: ['Lighting', 'Appliance'],
  },
  {
    id: 'solar-battery',
    label: 'Solar & Battery',
    summary: 'Generation and storage',
    types: ['OnSiteGeneration', 'ElectricBattery'],
  },
];

export function getElementTypeMenuOption(type: ElementType): ElementTypeMenuOption {
  return {
    type,
    label: ELEMENT_TYPE_COMPACT_LABELS[type],
    ...ELEMENT_TYPE_DETAILS[type],
  };
}

export function getElementTypeSectionId(type: ElementType): ElementTypeSectionId {
  return ELEMENT_TYPE_DETAILS[type].section;
}

export function getElementTypeMenuSections(options: readonly ElementType[]): ElementTypeMenuSection[] {
  const allowed = new Set(options);
  return ELEMENT_TYPE_SECTIONS
    .map((section) => ({
      ...section,
      types: section.types.filter((type) => allowed.has(type)),
    }))
    .filter((section) => section.types.length > 0);
}
