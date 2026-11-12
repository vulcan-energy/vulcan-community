// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { MechanicalVentilationDuctwork } from '../geometry/types';

export const MVHR_DUCT_ROLES = ['supply', 'extract', 'intake', 'exhaust'] as const;
export type MvhrDuctRole = (typeof MVHR_DUCT_ROLES)[number];

export const MVHR_TERMINAL_ROLES = ['intake', 'exhaust'] as const;
export type MvhrTerminalRole = (typeof MVHR_TERMINAL_ROLES)[number];

export type MvhrDuctRoleStyle = {
  stroke: string;
  strokeWidth: number;
  dash: readonly number[];
};

export const MVHR_DUCT_ROLE_STYLES: Record<MvhrDuctRole, MvhrDuctRoleStyle> = {
  supply: { stroke: '#4ADE80', strokeWidth: 2, dash: [] },
  extract: { stroke: '#22C55E', strokeWidth: 2, dash: [6, 4] },
  intake: { stroke: '#86EFAC', strokeWidth: 2, dash: [12, 5] },
  exhaust: { stroke: '#15803D', strokeWidth: 2, dash: [10, 4, 2, 4] },
};

export function isMvhrDuctRole(value: unknown): value is MvhrDuctRole {
  return typeof value === 'string' && (MVHR_DUCT_ROLES as readonly string[]).includes(value);
}

export function isMvhrTerminalRole(value: unknown): value is MvhrTerminalRole {
  return typeof value === 'string' && (MVHR_TERMINAL_ROLES as readonly string[]).includes(value);
}

export function getMvhrDuctRoleStyle(value: unknown): MvhrDuctRoleStyle {
  return MVHR_DUCT_ROLE_STYLES[isMvhrDuctRole(value) ? value : 'supply'];
}

export function getMechanicalVentilationDuctworkRoleStyle(
  duct: Pick<MechanicalVentilationDuctwork, 'duct_type'>,
): MvhrDuctRoleStyle {
  return getMvhrDuctRoleStyle(duct.duct_type);
}
