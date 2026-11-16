// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ThermalMethod } from '../lib/thermalMethod';
import { CompactSegmentedControl } from './WindowDetailControls';

/**
 * "Thermal values from": how this element's U-value is known. Only the chosen method's inputs
 * show; switching clears the old method's values in one undo step (`thermalMethodSwitchPatch`).
 */
export function ThermalMethodControl({ methods, value, onChange }: {
  methods: readonly { value: ThermalMethod; label: string }[];
  value: ThermalMethod;
  onChange: (method: ThermalMethod) => void;
}) {
  return (
    <div className="element-editor-section-spacer" data-thermal-method={value} style={{ display: 'grid', gap: 6 }}>
      <div className="element-label">Thermal values from</div>
      <CompactSegmentedControl ariaLabel="Thermal values from" value={value} options={[...methods]} onChange={onChange} />
    </div>
  );
}
