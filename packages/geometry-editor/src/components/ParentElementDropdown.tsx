// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Parent Element Dropdown Component. Moved verbatim from ElementCreator.tsx so
// extracted elementForms modules can use it without importing the orchestrator.

import React from 'react';
import { useGeometryStore, type ElementType } from '../stores/geometryStore';
import { StandardDropdown } from './StandardDropdown';

interface ParentElementDropdownProps {
  value: string;
  onChange: (value: string) => void;
  elementType: ElementType;
  zoneId: string;
  placeholder: string;
  selfId?: string;
}

export const ParentElementDropdown: React.FC<ParentElementDropdownProps> = ({
  value,
  onChange,
  elementType,
  zoneId,
  placeholder,
  selfId
}) => {
  const getAvailableParentElements = useGeometryStore((s) => s.getAvailableParentElements);
  const availableParents = getAvailableParentElements(elementType, zoneId, selfId);

  return (
    <div className="element-input" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <StandardDropdown
          value={value}
          onChange={onChange}
          options={[
            { value: '', label: placeholder },
            ...availableParents.map((parent) => ({
              value: parent.name,
              label: `${parent.name || '(Unnamed)'} (${parent.type === 'BuildingElementOpaque' ? 'Opaque' : parent.type})`
            }))
          ]}
          variant="ghost"
          size="md"
        />
      </div>
      {value && (
        <button
          type="button"
          className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action"
          onClick={() => onChange('')}
          title="Unlink parent element"
        >
          Unlink
        </button>
      )}
    </div>
  );
};
