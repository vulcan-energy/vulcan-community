// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import type {
  GeometryProductCatalogueContribution,
  GeometryProductSlot,
  GeometryProductSlotContext,
} from '../../../geometry-editor-host/src/inspectorContributions';
import { useGeometryStore } from '../stores/geometryStore';
import { ValidationPill } from './ValidationIndicator';

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the chip says and how it looks for a slot. */
function productSlotChip(slot: GeometryProductSlot): { text: string; title: string; missing: boolean } {
  if (slot.product_id == null) {
    return {
      text: slot.technology_types.length ? `Pick a product: ${slot.technology_types.join(' or ')}` : 'Product needed',
      title: `${sentence(slot.rule)}.`,
      missing: true,
    };
  }
  return {
    text: slot.source === 'default' ? 'Default product' : 'Product',
    title: `${slot.label ?? `Product ${slot.product_id}`}. ${sentence(slot.rule)}.`,
    missing: false,
  };
}

type Props = {
  element: Readonly<Record<string, unknown>> & { name?: string };
  productCatalogue: GeometryProductCatalogueContribution | null;
  onPatchExtraJson: GeometryProductSlotContext['onPatchExtraJson'];
};

/**
 * One source chip per product slot of the element, as the selected target's last conversion
 * reports it. The chip opens the host's product picker. Nothing renders for a target whose
 * conversion reports no slots.
 */
export function ProductSlotChips({ element, productCatalogue, onPatchExtraJson }: Props) {
  const slots = useGeometryStore((state) => state.targetValidation?.productSlots);
  const [open, setOpen] = useState<string | null>(null);
  const own = element.name ? (slots ?? []).filter((slot) => slot.row === element.name) : [];
  if (!own.length) return null;
  const openSlot = own.find((slot) => slot.path === open);
  const canPick = !!productCatalogue?.renderProductSlot;
  return (
    <div className="element-editor-status-row">
      <div className="element-editor-pill-row">
        {own.map((slot) => {
          const chip = productSlotChip(slot);
          const toggle = canPick ? () => setOpen(open === slot.path ? null : slot.path) : undefined;
          return chip.missing ? (
            <ValidationPill key={slot.path} message={chip.text} title={chip.title} variant="error" onClick={toggle} />
          ) : (
            <button
              key={slot.path}
              type="button"
              className="element-editor-status-chip"
              title={chip.title}
              aria-expanded={canPick ? open === slot.path : undefined}
              onClick={toggle}
              style={{ fontFamily: 'inherit', cursor: canPick ? 'pointer' : 'default' }}
            >
              {chip.text}
            </button>
          );
        })}
      </div>
      {openSlot && (
        <div style={{ flexBasis: '100%' }}>
          {productCatalogue?.renderProductSlot?.({ slot: openSlot, element, onPatchExtraJson })}
        </div>
      )}
    </div>
  );
}
