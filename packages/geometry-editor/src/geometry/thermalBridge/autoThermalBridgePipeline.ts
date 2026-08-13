// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Floor } from '../../geometry/types';
import type { Element } from '../types';
import { proposeAdjacentWallJunctionThermalBridges } from './proposeAdjacentWallJunction';
import { proposeBasementGroundE22ThermalBridges } from './proposeBasementFloorE22';
import { proposeDormerRoofToHostRoofR10ThermalBridges } from './proposeDormerRoofToHostRoofR10';
import { proposeDormerWallToHostRoofR8R9ThermalBridges } from './proposeDormerWallToHostRoofR8R9';
import { proposeE7PartyFloorToExternalWallThermalBridges } from './proposeE7PartyFloorExternalWall';
import { proposeExternalCornerThermalBridges } from './proposeExternalCorners';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { proposeFacadeOpeningThermalBridges } from './proposeFacadeOpenings';
import { dedupeFacadeThermalBridgeProposals } from './facadeTbProposalGlobalDedupe';
import { proposeFlatRoofEdgeThermalBridges } from './proposeFlatRoofEdge';
import { proposePartyWallGroundP1P6ThermalBridges } from './proposePartyWallGroundP1P6';
import { proposePartyWallIntermediateFloorP2P3ThermalBridges } from './proposePartyWallIntermediateFloorP2P3';
import { proposePartyWallToExternalE18 } from './proposePartyWallToExternalE18';
import { proposePartyWallToFlatRoofP4ThermalBridges } from './proposePartyWallToFlatRoofP4';
import { proposePartyWallToSlopedRoofP4P5ThermalBridges } from './proposePartyWallToSlopedRoofP4P5';
import { proposeRoofOpeningThermalBridges } from './proposeRoofOpenings';
import { proposeRoomInRoofRoofToWallR8R9ThermalBridges } from './proposeRoomInRoofRoofToWallR8R9';
import { proposeSlopedRoofEavesGableThermalBridges } from './proposeSlopedRoofEavesGable';
import { proposeWallGroundContinuous } from './proposeWallGroundContinuous';
import { proposeWallIntermediateContinuous } from './proposeWallIntermediateContinuous';

export interface AutoThermalBridgePipelineResult {
  rawProposals: FacadeOpeningTbProposal[];
  dedupedProposals: FacadeOpeningTbProposal[];
}

export function proposeAutoThermalBridgesWithRaw(
  elements: Element[],
  floors?: Floor[],
  globalOrientationOffset?: number,
): AutoThermalBridgePipelineResult {
  const openings = proposeFacadeOpeningThermalBridges(elements, floors);
  const roofOpenings = proposeRoofOpeningThermalBridges(elements, floors, globalOrientationOffset);
  const flatRoofEdges = proposeFlatRoofEdgeThermalBridges(elements, floors);
  const slopedEavesGable = proposeSlopedRoofEavesGableThermalBridges(elements, floors, globalOrientationOffset);
  const groundContinuous = proposeWallGroundContinuous(elements, openings, floors);
  const intermediateContinuous = proposeWallIntermediateContinuous(elements, openings, floors);
  const corners = proposeExternalCornerThermalBridges(elements);
  const partyWallToExternalE18 = proposePartyWallToExternalE18(elements, floors);
  const partyWallIntermediateFloorP23 = proposePartyWallIntermediateFloorP2P3ThermalBridges(elements, floors);
  const partyWallGroundP16 = proposePartyWallGroundP1P6ThermalBridges(elements, floors);
  const basementE22 = proposeBasementGroundE22ThermalBridges(elements, floors);
  const e7PartyFloor = proposeE7PartyFloorToExternalWallThermalBridges(elements, floors);
  const partyWallToRoofP45 = proposePartyWallToSlopedRoofP4P5ThermalBridges(elements, floors, globalOrientationOffset);
  const partyWallToFlatRoofP4 = proposePartyWallToFlatRoofP4ThermalBridges(elements, floors);
  const adjacentJunctions = proposeAdjacentWallJunctionThermalBridges(elements, floors);
  const roomInRoofR89 = proposeRoomInRoofRoofToWallR8R9ThermalBridges(elements, floors, globalOrientationOffset);
  const dormerHostR89 = proposeDormerWallToHostRoofR8R9ThermalBridges(elements, floors, globalOrientationOffset);
  const dormerRoofHostR10 = proposeDormerRoofToHostRoofR10ThermalBridges(elements, floors, globalOrientationOffset);

  const rawProposals = [
    ...openings,
    ...roofOpenings,
    ...flatRoofEdges,
    ...slopedEavesGable,
    ...groundContinuous,
    ...intermediateContinuous,
    ...corners,
    ...partyWallToExternalE18,
    ...partyWallIntermediateFloorP23,
    ...partyWallGroundP16,
    ...basementE22,
    ...e7PartyFloor,
    ...partyWallToRoofP45,
    ...partyWallToFlatRoofP4,
    ...adjacentJunctions,
    ...roomInRoofR89,
    ...dormerHostR89,
    ...dormerRoofHostR10,
  ];

  return {
    rawProposals,
    dedupedProposals: dedupeFacadeThermalBridgeProposals(rawProposals, { elements, floors }),
  };
}

export function proposeAutoThermalBridges(
  elements: Element[],
  floors?: Floor[],
  globalOrientationOffset?: number,
): FacadeOpeningTbProposal[] {
  return proposeAutoThermalBridgesWithRaw(elements, floors, globalOrientationOffset).dedupedProposals;
}
