// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { ParentElementDropdown } from './ParentElementDropdown';

/**
 * "Link to wall or roof", last on the window panel: the wall or roof the window is in (a link that
 * selects it), "Unlink", and a list to move the window to another host: it takes that host's pitch
 * and orientation, and on a wall moves onto the wall's line.
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
      <div className="element-label">Link to wall or roof</div>
      {parentName ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span>
            In{' '}
            <button type="button" className="field-source-note__link" onClick={onSelectWall} title={`Select ${parentName}`}>{parentName}</button>
            : takes its pitch and orientation.
          </span>
          <button type="button" className="btn editor-action-btn editor-action-btn--secondary" onClick={() => onChange('')}>Unlink</button>
        </div>
      ) : (
        <div className="field-source-note">Not linked: enter its pitch and orientation above.</div>
      )}
      <ParentElementDropdown
        value=""
        onChange={(value) => { if (value && value !== parentName) onChange(value); }}
        elementType="BuildingElementTransparent"
        zoneId={zoneId}
        placeholder={parentName ? 'Move to another wall or roof…' : 'Link to a wall or roof…'}
        selfId={selfId}
        only={(wall) => wall.name !== parentName}
      />
    </div>
  );
}
