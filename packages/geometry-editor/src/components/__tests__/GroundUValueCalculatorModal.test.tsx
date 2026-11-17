// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GroundUValueCalculatorModal } from '../GroundUValueCalculatorModal';

// HEM:EPC targets require IsExistingBuilding; other targets do not.
const rules = vi.hoisted(() => ({ requiredMetadataRows: ['IsExistingBuilding'] as string[] }));
vi.mock('../../hooks/useTargetRules', () => ({ useTargetRules: () => rules }));

const show = (currentData: Record<string, unknown>, advancedFieldsData: Record<string, unknown>) =>
  render(<GroundUValueCalculatorModal isOpen onClose={() => {}} onApply={() => {}}
    currentData={{ total_area: 100, perimeter: 40, thickness_walls: 0.3, ...currentData }}
    advancedFieldsData={{ thermal_resistance_floor_construction: 0.05, ...advancedFieldsData }} />);

it('lists an edge insulation thickness as still needed until a thickness or conductivity is given', () => {
  const { unmount } = show({ floor_type: 'Slab_edge_insulation' },
    { edge_insulation: [{ type: 'horizontal', width: 1, edge_thermal_resistance: 1.5 }] });
  expect(screen.getByText(/Still needed:/)).toHaveTextContent('Edge insulation thickness');
  unmount();
  show({ floor_type: 'Slab_edge_insulation' },
    { edge_insulation: [{ type: 'horizontal', width: 1, edge_thermal_resistance: 1.5, thickness: 0.06 }] });
  expect(screen.queryByText(/Still needed:/)).not.toBeInTheDocument();
});

it('lists the basement wall resistance as needed for a heated basement on HEM:EPC only', () => {
  rules.requiredMetadataRows = ['IsExistingBuilding'];
  const { unmount } = show({ floor_type: 'Heated_basement', depth_basement_floor: 2 }, {});
  expect(screen.getByText(/Still needed:/)).toHaveTextContent('Basement wall R below ground');
  expect(screen.getByText(/basement walls below ground/)).toBeInTheDocument();
  unmount();
  // FHS and Core take the basement floor alone; its walls are entered as walls.
  rules.requiredMetadataRows = [];
  show({ floor_type: 'Heated_basement', depth_basement_floor: 2 }, {});
  expect(screen.queryByText(/Still needed:/)).not.toBeInTheDocument();
  expect(screen.getByText(/The basement walls are entered as walls/)).toBeInTheDocument();
});
