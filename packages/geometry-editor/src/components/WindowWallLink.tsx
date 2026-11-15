// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { ParentElementDropdown } from './ParentElementDropdown';

/**
 * "Link to wall", last on the window panel: the wall the window is in (a link that selects it),
 * "Unlink", and a list to move the window to another wall (it moves onto that wall's line and
 * takes its pitch and orientation).
 */
export function WindowWallLink({ parentName, zoneId, selfId, onChange, onSelectWall }: {
  parentName: string;
  zoneId: string;
  selfId: string;
  onChange: (wallName: string) => void;
  onSelectWall: () => void;
}) {
  return (
    <div className="element-editor-section-spacer" data-window-wall-link style={{ display: 'grid', gap: 6 }}>
      <div className="element-label">Link to wall</div>
      {parentName ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span>
            In{' '}
            <button type="button" className="field-source-note__link" onClick={onSelectWall} title={`Select ${parentName}`}>{parentName}</button>
            : faces and pitches with the wall.
          </span>
          <button type="button" className="btn editor-action-btn editor-action-btn--secondary" onClick={() => onChange('')}>Unlink</button>
        </div>
      ) : (
        <div className="field-source-note">Not in a wall: enter its pitch and orientation above.</div>
      )}
      <ParentElementDropdown
        value=""
        onChange={(value) => { if (value && value !== parentName) onChange(value); }}
        elementType="BuildingElementTransparent"
        zoneId={zoneId}
        placeholder={parentName ? 'Move to another wall…' : 'Put it in a wall…'}
        selfId={selfId}
        only={(wall) => wall.name !== parentName}
      />
    </div>
  );
}
