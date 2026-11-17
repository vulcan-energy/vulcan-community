// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useKeyedState } from '../hooks/useKeyedState';
import { ParentElementDropdown } from './ParentElementDropdown';
import { compassPoint } from '../lib/parentOrientation';


/**
 * "On Wall (S) · faces S", first on the window panel: the wall or roof the window is in (a link
 * that selects it), ▾ to move it to another one (it takes that host's pitch and orientation and,
 * on a wall, moves onto the wall's line), and "Detach". A window whose wall was deleted reads
 * "Was on Wall (S)" with "Reattach" while a wall still lies under it. A window wider than its
 * wall says so here; nothing is moved or resized.
 */
export function WindowWallLink({ parentName, orientation, pitch, wasOn, reattachTo, tooWide, zoneId, selfId, onChange, onSelectWall }: {
  parentName: string;
  orientation: number;
  pitch: number | undefined;
  /** The wall this window was on before that wall was deleted. */
  wasOn?: string;
  /** The wall the window lies on now, for "Reattach". */
  reattachTo?: string;
  /** "2.00 m window on a 1.50 m wall". */
  tooWide?: string;
  zoneId: string;
  selfId: string;
  onChange: (wallName: string) => void;
  onSelectWall: () => void;
}) {
  const [picking, setPicking] = useKeyedState(selfId, false);
  const faces = `faces ${compassPoint(orientation)}${pitch !== undefined && Math.abs(pitch - 90) > 0.5 ? ` · pitch ${Math.round(pitch)}°` : ''}`;
  return (
    <div data-window-wall-link style={{ display: 'grid', gap: 6, marginBottom: 'var(--spacing-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="element-label" style={{ margin: 0 }}>On</span>
        <span className="field-source-note" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {parentName ? (
            <span>
              <button type="button" className="field-source-note__link" onClick={onSelectWall} title={`Select ${parentName}`}>{parentName}</button>
              {` · ${faces}`}
            </span>
          ) : wasOn ? (
            <span>
              Was on {wasOn}
              {reattachTo && <>{' · '}<button type="button" className="field-source-note__link" onClick={() => onChange(reattachTo)} title={`Put it back on ${reattachTo}`}>Reattach</button></>}
            </span>
          ) : (
            <span>No wall · {faces}</span>
          )}
          <button type="button" className="field-source-note__link" aria-expanded={picking} onClick={() => setPicking(!picking)}
            aria-label={parentName ? 'Move to another wall or roof' : 'Put on a wall or roof'} title={parentName ? 'Move to another wall or roof' : 'Put on a wall or roof'}>▾</button>
          {parentName && (
            <button type="button" className="field-source-note__link" onClick={() => onChange('')} title="Keep its pitch and orientation as its own">Detach</button>
          )}
        </span>
      </div>
      {tooWide && <div className="field-source-note" style={{ color: 'var(--status-warning-text)' }}>{tooWide}</div>}
      {picking && (
        <ParentElementDropdown
          value=""
          onChange={(value) => { if (value && value !== parentName) { onChange(value); setPicking(false); } }}
          elementType="BuildingElementTransparent"
          zoneId={zoneId}
          placeholder={parentName ? 'Move to another wall or roof…' : 'Put on a wall or roof…'}
          selfId={selfId}
          only={(wall) => wall.name !== parentName}
        />
      )}
    </div>
  );
}
