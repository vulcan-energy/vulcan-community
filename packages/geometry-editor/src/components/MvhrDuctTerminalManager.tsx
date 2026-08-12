// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MVHR duct/terminal manager, moved verbatim from ElementCreator.tsx per the
// slice-4 extraction brief's decision (g).4. This is the cluster
// MechanicalVentilation's panel invokes when the selected unit is an MVHR
// (elementForms/mechanicalVentilation.tsx renders
// `ctx.renderMvhrDuctAndTerminalManager()`): selectedMvhrUnit, the
// select/create/draw helpers, the manager render function itself, and the
// MVHR_MANAGER_* styles. It creates MechanicalVentilationDuctwork/
// MechanicalVentilationTerminal elements and reads store-level state with no
// dependency on MechanicalVentilation's own module state (confirmed by the
// slice-4 brief's read-only scoping pass), so it stays orchestrator-INVOKED
// rather than moving into the module contract — ElementCreator still owns
// exactly one instance via useMvhrDuctTerminalManager (the same
// single-hook-call precedent as useServiceLineFormState) and wires the
// returned render function onto ElementFormRenderCtx.renderMvhrDuctAndTerminalManager.
//
// selectedMvhrUnit's useMemo is why this is a hook rather than a plain
// exported function: the orchestrator calls it unconditionally, in the same
// position the inline block used to occupy, so Rules of Hooks are satisfied
// exactly as before.
//
// Threaded explicit args, in place of ElementCreatorContent's closure (per
// the brief's plumbing-only instruction — bodies below are otherwise
// verbatim): selection/elementsById/getElementById (selectedMvhrUnit's
// lookup, with the same elementsById-then-getElementById fallback order),
// addElement/updateElement (store actions), setSelection (an
// ElementCreator prop, NOT store-derived — distinct from
// geometryStore.getState().setSelection used inside the post-create
// setTimeout), setSelectedElementIds (store action), geometryStore (the
// StoreApi handle, for the one getState() call in
// selectElementByNameAfterCreate — that function already re-reads
// elementIds/elementsById/setSelection/setSelectedElementIds fresh off the
// store rather than closing over the hook's own args, unchanged from legacy),
// and the onStartMvhrDuctDraw/onStartMvhrTerminalDraw component props.
// generateUniqueElementName is a pure top-level import (lib/elementAutoNaming)
// with no orchestrator-scope dependency, so it's imported directly rather
// than threaded. allElements is derived locally from the threaded
// elementsById via the same one-line `Object.values` the orchestrator itself
// uses (ElementCreatorContent's own `allElements` memo) — a separate memo
// cache, but an identical formula, so it stays behaviourally interchangeable.
//
// `selection` is typed as ElementFormSelection (non-null): this hook is only
// ever called from ElementCreatorContent, whose own `selection` prop is
// already NonNullable (see elementForms/mechanicalVentilationTerminal.tsx's
// header comment for the general nullability note) — so, unlike a module
// reached through the generic ElementFormRenderCtx, no `?.` adaptation is
// needed here.
//
// LucideSvgIcon and the Pencil/Plus/X icon imports move here too: grep
// against ElementCreator.tsx confirmed both were used only by this cluster.
// ElementOfType<T> is ElementCreator's own local, non-exported alias (used
// elsewhere in ElementCreator.tsx too, e.g. WetEmitter's subcategory cast),
// so this file mirrors it locally instead — same precedent as
// mechanicalVentilationTerminal.tsx's own copy. INLINE_FIELD_NOTE_STYLE and
// EDITOR_FIELD_ACTION_ROW_STYLE (spread into two of the MVHR_MANAGER_* consts
// below) stay defined in ElementCreator.tsx — both are used by dozens of
// still-inline families there — so this file carries its own local copies,
// same precedent as elementForms/mechanicalVentilation.tsx's own duplicate of
// INLINE_FIELD_NOTE_STYLE.

import React, { useMemo, type ReactNode } from 'react';
import type { IconNode } from 'lucide';
import { Pencil, Plus, X as XIcon } from 'lucide';
import type { Element } from '../geometry/types';
import { isGlobalObject, type GeometryStoreApi } from '../stores/geometryStore';
import {
  MVHR_DUCT_ROLES,
  MVHR_TERMINAL_ROLES,
  isMvhrTerminalHost,
  type MvhrDuctRole,
  type MvhrTerminalRole,
} from '../lib/mvhrDuctwork';
import { generateUniqueElementName } from '../lib/elementAutoNaming';
import { StandardDropdown } from './StandardDropdown';
import type { ElementFormSelection } from './elementForms/types';

/** Mirrors ElementCreator's own local ElementOfType<T> alias (not exported
 * there), used the same way here for the duct/terminal filter predicates. */
type ElementOfType<T extends Element['type']> = Extract<Element, { type: T }>;

/** Local copies of ElementCreator's shared inline-note/action-row styles —
 * see module header comment. */
const INLINE_FIELD_NOTE_STYLE: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};
const EDITOR_FIELD_ACTION_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
};

const MVHR_MANAGER_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  marginTop: '8px',
};
const MVHR_MANAGER_SECTION_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: '4px',
};
const MVHR_MANAGER_SECTION_HEADER_STYLE: React.CSSProperties = {
  ...INLINE_FIELD_NOTE_STYLE,
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
};
const MVHR_MANAGER_ROW_STYLE: React.CSSProperties = {
  ...EDITOR_FIELD_ACTION_ROW_STYLE,
  gap: '6px',
  minHeight: '30px',
};
const MVHR_MANAGER_ROLE_LABEL_STYLE: React.CSSProperties = {
  flex: '0 0 104px',
  minWidth: 0,
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  textTransform: 'capitalize',
};
const MVHR_MANAGER_CONTENT_STYLE: React.CSSProperties = {
  flex: '1 1 180px',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flexWrap: 'wrap',
};
const MVHR_MANAGER_LINK_STYLE: React.CSSProperties = {
  flex: '0 1 180px',
  minWidth: '140px',
};
const MVHR_MANAGER_LINKED_ITEM_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  maxWidth: '100%',
  minHeight: '28px',
  padding: '2px 3px 2px 8px',
  border: '1px solid var(--surface-control-active)',
  borderRadius: '6px',
  background: 'var(--surface-control)',
  color: 'var(--text-primary)',
};
const MVHR_MANAGER_LINKED_NAME_STYLE: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '12px',
};
const MVHR_MANAGER_EMPTY_STYLE: React.CSSProperties = {
  ...INLINE_FIELD_NOTE_STYLE,
  fontSize: '12px',
};
const MVHR_MANAGER_ICON_BUTTON_STYLE: React.CSSProperties = {
  width: '28px',
  minWidth: '28px',
  height: '28px',
  minHeight: '28px',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const MVHR_MANAGER_WARNING_STYLE: React.CSSProperties = {
  ...INLINE_FIELD_NOTE_STYLE,
  marginLeft: '110px',
};

// eslint-disable-next-line react-refresh/only-export-components -- moved verbatim from ElementCreator.tsx alongside useMvhrDuctTerminalManager; not itself exported.
const LucideSvgIcon: React.FC<{ node: IconNode; size?: number; strokeWidth?: number }> = ({
  node,
  size = 14,
  strokeWidth = 2,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {node.map(([tag, attrs], index) =>
      React.createElement(tag as keyof React.JSX.IntrinsicElements, {
        key: index,
        ...(attrs as Record<string, unknown>),
      }),
    )}
  </svg>
);

export function useMvhrDuctTerminalManager(args: {
  selection: ElementFormSelection;
  elementsById: Record<string, Element>;
  getElementById: (id: string) => Element | undefined;
  addElement: (element: Omit<Element, 'id'>) => void;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  /** ElementCreator prop — not store-derived; see module header comment. */
  setSelection: (selection: ElementFormSelection | null) => void;
  setSelectedElementIds: (ids: string[]) => void;
  geometryStore: GeometryStoreApi;
  onStartMvhrDuctDraw?: (args: { role: MvhrDuctRole; parentName: string }) => void;
  onStartMvhrTerminalDraw?: (args: { role: MvhrTerminalRole; parentName: string }) => void;
}): () => ReactNode {
  const {
    selection,
    elementsById,
    getElementById,
    addElement,
    updateElement,
    setSelection,
    setSelectedElementIds,
    geometryStore,
    onStartMvhrDuctDraw,
    onStartMvhrTerminalDraw,
  } = args;

  const allElements = useMemo(() => Object.values(elementsById) as Element[], [elementsById]);

  const selectedMvhrUnit = useMemo(() => {
    if (!(selection.type === 'element' || selection.type === 'global')) return null;
    const element = elementsById[selection.id] ?? getElementById(selection.id);
    return element?.type === 'MechanicalVentilation' && element.vent_type === 'MVHR' ? element : null;
  }, [selection, elementsById, getElementById]);

  const selectElementById = (id: string) => {
    const element = getElementById(id);
    if (!element) return;
    setSelection({ type: isGlobalObject(element) ? 'global' : 'element', id } as any);
    setSelectedElementIds([id]);
  };

  const selectElementByNameAfterCreate = (type: Element['type'], name: string) => {
    setTimeout(() => {
      const state = geometryStore.getState();
      const created = state.elementIds
        .map((id) => state.elementsById[id])
        .find((element) => element?.type === type && element.name === name);
      if (!created) return;
      state.setSelection({ type: isGlobalObject(created) ? 'global' : 'element', id: created.id } as any);
      state.setSelectedElementIds([created.id]);
    }, 0);
  };

  const createMvhrDuct = (role: MvhrDuctRole) => {
    if (!selectedMvhrUnit?.name) return;
    const existingNames = allElements.map((element) => element.name).filter((name): name is string => !!name);
    const name = generateUniqueElementName(`${role} duct`, existingNames);
    const anchor = selectedMvhrUnit.coordinates?.[0] ?? { x: 0, y: 0, z: 0 };
    const z = typeof anchor.z === 'number' && Number.isFinite(anchor.z) ? anchor.z : 0;
    addElement({
      name,
      type: 'MechanicalVentilationDuctwork',
      duct_type: role,
      length: 1,
      parent_element: selectedMvhrUnit.name,
      floorId: selectedMvhrUnit.floorId,
      coordinates: [
        { x: anchor.x + 0.5, y: anchor.y, z },
        { x: anchor.x + 1.5, y: anchor.y, z },
      ],
    } as Omit<Element, 'id'>);
    selectElementByNameAfterCreate('MechanicalVentilationDuctwork', name);
  };

  const createMvhrTerminal = (role: MvhrTerminalRole) => {
    if (!selectedMvhrUnit?.name) return;
    const existingNames = allElements.map((element) => element.name).filter((name): name is string => !!name);
    const name = generateUniqueElementName(`${role} terminal`, existingNames);
    const firstHost = allElements.find((element) => isMvhrTerminalHost(element));
    const hostCoords = firstHost?.coordinates;
    const hostPoint =
      hostCoords && hostCoords.length >= 2
        ? {
            x: (hostCoords[0]!.x + hostCoords[1]!.x) / 2,
            y: (hostCoords[0]!.y + hostCoords[1]!.y) / 2,
            z: 2.4,
          }
        : selectedMvhrUnit.coordinates?.[0] ?? { x: 0, y: 0, z: 2.4 };
    addElement({
      name,
      type: 'MechanicalVentilationTerminal',
      terminal_type: role,
      parent_element: selectedMvhrUnit.name,
      host_element: firstHost?.name ?? null,
      orientation360: firstHost ? undefined : 0,
      pitch: firstHost ? undefined : 90,
      floorId: firstHost?.floorId ?? selectedMvhrUnit.floorId,
      coordinates: [hostPoint],
    } as Omit<Element, 'id'>);
    selectElementByNameAfterCreate('MechanicalVentilationTerminal', name);
  };

  const startMvhrDuctDraw = (role: MvhrDuctRole) => {
    if (!selectedMvhrUnit?.name) return;
    if (onStartMvhrDuctDraw) {
      onStartMvhrDuctDraw({ role, parentName: selectedMvhrUnit.name });
      return;
    }
    createMvhrDuct(role);
  };

  const startMvhrTerminalDraw = (role: MvhrTerminalRole) => {
    if (!selectedMvhrUnit?.name) return;
    if (onStartMvhrTerminalDraw) {
      onStartMvhrTerminalDraw({ role, parentName: selectedMvhrUnit.name });
      return;
    }
    createMvhrTerminal(role);
  };

  const renderMvhrDuctAndTerminalManager = () => {
    if (!selectedMvhrUnit?.name) return null;
    const mvhrName = selectedMvhrUnit.name;
    const ducts = allElements.filter(
      (element): element is ElementOfType<'MechanicalVentilationDuctwork'> =>
        element.type === 'MechanicalVentilationDuctwork',
    );
    const terminals = allElements.filter(
      (element): element is ElementOfType<'MechanicalVentilationTerminal'> =>
        element.type === 'MechanicalVentilationTerminal',
    );

    const renderIconButton = (
      label: string,
      onClick: () => void,
      icon: IconNode,
    ) => (
      <button
        type="button"
        className="btn editor-action-btn editor-action-btn--secondary"
        style={MVHR_MANAGER_ICON_BUTTON_STYLE}
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        <LucideSvgIcon node={icon} />
      </button>
    );

    const renderLinkedItem = (
      element: Element,
      kind: string,
      onUnlink: () => void,
    ) => {
      const name = element.name || '(Unnamed)';
      return (
        <div key={element.id} style={MVHR_MANAGER_LINKED_ITEM_STYLE}>
          <span style={MVHR_MANAGER_LINKED_NAME_STYLE} title={name}>{name}</span>
          {renderIconButton(`Edit ${name}`, () => selectElementById(element.id), Pencil)}
          {renderIconButton(`Unlink ${name || kind}`, onUnlink, XIcon)}
        </div>
      );
    };

    return (
      <div style={MVHR_MANAGER_STYLE}>
        <div style={MVHR_MANAGER_SECTION_STYLE}>
          <div style={MVHR_MANAGER_SECTION_HEADER_STYLE}>MVHR ductwork</div>
          {MVHR_DUCT_ROLES.map((role) => {
            const linkedDucts = ducts.filter((duct) => duct.parent_element === mvhrName && duct.duct_type === role);
            const availableDucts = ducts.filter((duct) => duct.duct_type === role && !duct.parent_element?.trim());
            return (
              <div key={role} style={MVHR_MANAGER_ROW_STYLE}>
                <div style={MVHR_MANAGER_ROLE_LABEL_STYLE}>{role} ducts</div>
                <div style={MVHR_MANAGER_CONTENT_STYLE}>
                  {linkedDucts.length > 0 ? linkedDucts.map((duct) =>
                    renderLinkedItem(
                      duct,
                      'duct',
                      () => updateElement(duct.id, { parent_element: null } as Partial<Element>),
                    ),
                  ) : (
                    <span style={MVHR_MANAGER_EMPTY_STYLE}>None linked</span>
                  )}
                </div>
                {availableDucts.length > 0 ? (
                  <div style={MVHR_MANAGER_LINK_STYLE}>
                    <StandardDropdown
                      value=""
                      onChange={(value) => {
                        const duct = ducts.find((candidate) => candidate.id === value);
                        if (!duct) return;
                        updateElement(duct.id, { parent_element: mvhrName } as Partial<Element>);
                      }}
                      options={availableDucts.map((duct) => ({ value: duct.id, label: duct.name }))}
                      placeholder={`Link ${role} duct`}
                      variant="ghost"
                      size="sm"
                    />
                  </div>
                ) : null}
                {renderIconButton(`Draw ${role} duct`, () => startMvhrDuctDraw(role), Plus)}
              </div>
            );
          })}
        </div>

        <div style={MVHR_MANAGER_SECTION_STYLE}>
          <div style={MVHR_MANAGER_SECTION_HEADER_STYLE}>MVHR terminals</div>
          {MVHR_TERMINAL_ROLES.map((role) => {
            const linkedTerminals = terminals.filter((terminal) => terminal.parent_element === mvhrName && terminal.terminal_type === role);
            const availableTerminals = terminals.filter(
              (terminal) => terminal.terminal_type === role && !terminal.parent_element?.trim(),
            );
            return (
              <React.Fragment key={role}>
                <div style={MVHR_MANAGER_ROW_STYLE}>
                  <div style={MVHR_MANAGER_ROLE_LABEL_STYLE}>{role} terminal</div>
                  <div style={MVHR_MANAGER_CONTENT_STYLE}>
                    {linkedTerminals.length > 0 ? linkedTerminals.map((terminal) =>
                      renderLinkedItem(
                        terminal,
                        'terminal',
                        () => updateElement(terminal.id, { parent_element: null } as Partial<Element>),
                      ),
                    ) : (
                      <span style={MVHR_MANAGER_EMPTY_STYLE}>None linked</span>
                    )}
                  </div>
                  {availableTerminals.length > 0 ? (
                    <div style={MVHR_MANAGER_LINK_STYLE}>
                    <StandardDropdown
                      value=""
                      onChange={(value) => {
                        const terminal = terminals.find((candidate) => candidate.id === value);
                        if (!terminal) return;
                        linkedTerminals
                          .filter((candidate) => candidate.id !== terminal.id)
                          .forEach((candidate) => updateElement(candidate.id, { parent_element: null } as Partial<Element>));
                        updateElement(terminal.id, {
                          parent_element: mvhrName,
                          terminal_type: role,
                        } as Partial<Element>);
                      }}
                      options={availableTerminals.map((terminal) => ({ value: terminal.id, label: terminal.name }))}
                      placeholder={linkedTerminals.length > 0 ? `Replace ${role}` : `Link ${role}`}
                      variant="ghost"
                      size="sm"
                    />
                    </div>
                  ) : null}
                  {linkedTerminals.length === 0
                    ? renderIconButton(`Place ${role} terminal`, () => startMvhrTerminalDraw(role), Plus)
                    : null}
                </div>
                {linkedTerminals.length > 1 ? (
                  <div style={MVHR_MANAGER_WARNING_STYLE}>Multiple {role} terminals are linked; validation requires one.</div>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  return renderMvhrDuctAndTerminalManager;
}
