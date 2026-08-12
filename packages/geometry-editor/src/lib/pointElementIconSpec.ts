// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { IconNode } from 'lucide';
import {
  ArrowLeftRight,
  Bath,
  Battery,
  BatteryCharging,
  BookOpen,
  BrickWall,
  CircleOff,
  Coffee,
  CookingPot,
  Cylinder,
  Droplets,
  Fan,
  Flame,
  Heater,
  Lightbulb,
  Microwave,
  Network,
  Package,
  Puzzle,
  Recycle,
  Refrigerator,
  Shirt,
  ShowerHead,
  Snowflake,
  SunDim,
  Thermometer,
  ThermometerSnowflake,
  WashingMachine,
  Waves,
  Wind,
  Zap,
} from 'lucide';
import type { SystemSubcategory, Element } from '../geometry/types';

const HEAT_PUMP_PCDB_TYPES = new Set<string>([
  'AirSourceHeatPump',
  'BoosterHeatPump',
  'ExhaustAirMevHeatPump',
  'ExhaustAirMixedHeatPump',
  'ExhaustAirMvhrHeatPump',
  'GroundSourceHeatPump',
  'HybridHeatPump',
  'HotWaterOnlyHeatPump',
  'WaterSourceHeatPump',
]);

/** Normalise batch preset stem (filename without `.json`, lowercased). */
function normalisePresetStem(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const base = raw.trim().split(/[/\\]/).pop() ?? raw.trim();
  const noExt = base.replace(/\.json$/i, '');
  const v = noExt.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

function readPcdbProductType(element: Element): string | null {
  if (element.type !== 'System') return null;
  const ex = (element as { extra_json?: unknown }).extra_json;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null;
  const pcdb = (ex as Record<string, unknown>)._pcdb;
  if (!pcdb || typeof pcdb !== 'object' || Array.isArray(pcdb)) return null;
  const pt = (pcdb as Record<string, unknown>).productType;
  return typeof pt === 'string' && pt.trim() ? pt.trim() : null;
}

function iconForPcdbProductType(productType: string): IconNode {
  if (HEAT_PUMP_PCDB_TYPES.has(productType)) return ThermometerSnowflake;
  if (productType === 'CombiBoiler' || productType === 'RegularBoiler') return Flame;
  if (productType === 'HeatBatteryDryCore' || productType === 'HeatBatteryPCM') return BatteryCharging;
  if (productType === 'SmartHotWaterTank') return Cylinder;
  if (productType === 'InstantaneousWwhrSystem') return Recycle;
  if (
    productType === 'CentralisedMev' ||
    productType === 'DecentralisedMev' ||
    productType === 'CentralisedMv' ||
    productType === 'CentralisedMvhr'
  ) {
    return Fan;
  }
  if (productType === 'MvhrDuct') return Wind;
  if (productType === 'ConvectorRadiator' || productType === 'UnderFloorHeating' || productType === 'FanCoils') {
    return Heater;
  }
  if (productType === 'DirectElectricHeaters') return Zap;
  if (productType === 'StorageHeater') return Heater;
  if (productType === 'HeatNetworks') return Network;
  if (productType === 'HeatInterfaceUnit') return ArrowLeftRight;
  if (productType === 'SmartAirBrick') return BrickWall;
  if (productType === 'AirPoweredShowers') return ShowerHead;
  if (
    productType === 'HeatingControlRequirements' ||
    productType === 'HeatingControls' ||
    productType === 'HotWaterOnlyInUseFactors' ||
    productType === 'MVInUseFactors'
  ) {
    return BookOpen;
  }
  return Package;
}

const SYSTEM_PRESET_ICONS: Record<string, IconNode> = {
  gas_boiler: Flame,
  hp: ThermometerSnowflake,
  hp_large: ThermometerSnowflake,
  hp_upsized: ThermometerSnowflake,
  a2a_heat_pump: ThermometerSnowflake,
  heat_battery: BatteryCharging,
  combi_boiler: Flame,
  gas_boiler_cylinder: Flame,
  cylinder: Cylinder,
  heat_pump_cylinder: Cylinder,
  immersion_cylinder: Cylinder,
  basic_air_conditioning: Snowflake,
  high_efficiency_cooling: Snowflake,
  no_cooling: CircleOff,
  elec_storage_heater: Heater,
  instant_elec_heater: Zap,
  warm_air_heat_pump: Wind,
  radiators: Heater,
  radiators_high_efficiency: Heater,
  radiators_standard: Heater,
  hp_no_wc: Heater,
  hp_wc: Heater,
  mev_intermittent: Fan,
  mev_standard: Fan,
  mvhr_high_efficiency: Fan,
  mvhr_standard: Fan,
  none: CircleOff,
};

const SYSTEM_SUBCATEGORY_ICONS: Record<SystemSubcategory, IconNode> = {
  HeatSourceWet: Flame,
  HotWaterSource: Cylinder,
  HotWaterDemand: ShowerHead,
  InfiltrationVentilation: Fan,
  SpaceCoolSystem: Snowflake,
  SpaceHeatSystem: Heater,
  WWHRS: Recycle,
};

function iconForSystem(element: Element & { type: 'System' }): IconNode {
  const pcdbPt = readPcdbProductType(element);
  if (pcdbPt) return iconForPcdbProductType(pcdbPt);

  const stem = normalisePresetStem(element.system_preset);
  if (stem && SYSTEM_PRESET_ICONS[stem]) return SYSTEM_PRESET_ICONS[stem]!;

  const sub = element.subcategory as SystemSubcategory | undefined;
  if (sub && SYSTEM_SUBCATEGORY_ICONS[sub]) return SYSTEM_SUBCATEGORY_ICONS[sub]!;

  return Package;
}

const APPLIANCE_ICONS: Record<string, IconNode> = {
  Clothes_drying: Shirt,
  Clothes_washing: WashingMachine,
  Dishwasher: Waves,
  Fridge: Refrigerator,
  'Fridge-Freezer': Refrigerator,
  Freezer: Snowflake,
  Hobs: Flame,
  Kettle: Coffee,
  Microwave,
  Otherdevices: Puzzle,
  Oven: CookingPot,
};

const HOT_WATER_ICONS: Record<string, IconNode> = {
  OtherWaterUseDetails: Droplets,
  MixerShower: ShowerHead,
  InstantElecShower: Zap,
  Bath,
};

/**
 * Lucide icon node for a point-placed geometry element (2D canvas + 3D marker).
 */
export function getPointElementIconNode(element: Element): IconNode {
  const t = element.type;

  if (t === 'ThermalBridgePoint' || t === 'ThermalBridgeLinear') return Thermometer;

  if (t === 'Appliance') {
    const key = String((element as { appliancekey?: string }).appliancekey ?? '');
    return APPLIANCE_ICONS[key] ?? Package;
  }

  if (t === 'HotWaterDemand') {
    const sub = String((element as { subcategory?: string }).subcategory ?? '');
    return HOT_WATER_ICONS[sub] ?? Droplets;
  }

  if (t === 'System') return iconForSystem(element as Element & { type: 'System' });

  switch (t) {
    case 'Lighting':
      return Lightbulb;
    case 'MechanicalVentilation':
      return Fan;
    case 'MechanicalVentilationTerminal':
      return Wind;
    case 'CombustionAppliances':
      return Flame;
    case 'ElectricBattery':
      return Battery;
    case 'Vents':
      return Wind;
    case 'WindowShading':
      return SunDim;
    default:
      return Package;
  }
}
