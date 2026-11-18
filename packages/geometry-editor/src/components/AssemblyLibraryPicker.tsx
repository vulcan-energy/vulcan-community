// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import { SearchableDescribedSelect, type SearchableDescribedOption } from './SearchableDescribedSelect';
import type { BundledAssemblyLibrary } from '../lib/assemblyLibrary';
import { assemblyProvenanceLabel, assemblySearchHaystack } from '../lib/assemblyNaming';
import type { AssemblyExample } from '../lib/assemblyTypes';

export type LibraryElementType = 'wall' | 'roof' | 'ground_floor';

const SAMPLE_TITLE: Record<LibraryElementType, string> = {
  wall: 'Sample library · Walls',
  roof: 'Sample library · Roofs',
  ground_floor: 'Sample library · Floors',
};

interface AssemblyLibraryPickerProps {
  /** Null while the library loads: the picker is disabled. */
  library: BundledAssemblyLibrary | null;
  elementType: LibraryElementType;
  /** The figure beside each row; a row it returns null for is left out when `offeredOnly` is set. */
  figure: (row: AssemblyExample) => string | null;
  /** Leave out the rows `figure` gives no figure for (several elements: only what fits all of them). */
  offeredOnly?: boolean;
  /** The chosen row's id; '' for none. */
  value: string;
  onPick: (row: AssemblyExample | null) => void;
  placeholder?: string;
  /** Offers "None" first (the Fabric tab's build-up). */
  none?: boolean;
  /** "Save these layers to your library" in the menu. */
  onSave?: () => void;
  saveDisabled?: boolean;
  disabled?: boolean;
  menuZIndex?: number;
  triggerVariant?: 'default' | 'standard';
  triggerSize?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
}

/** One library picker for the element panel, several elements and the Fabric tab. */
export const AssemblyLibraryPicker: React.FC<AssemblyLibraryPickerProps> = ({
  library,
  elementType,
  figure,
  offeredOnly = false,
  value,
  onPick,
  placeholder = 'Search assemblies…',
  none = false,
  onSave,
  saveDisabled = false,
  disabled = false,
  menuZIndex,
  triggerVariant,
  triggerSize,
  'aria-label': ariaLabel,
}) => {
  const [closeSignal, setCloseSignal] = useState(0);
  const option = (row: AssemblyExample): SearchableDescribedOption | null => {
    const aside = figure(row);
    if (offeredOnly && aside === null) return null;
    return {
      value: row.id,
      label: row.name,
      ...(aside ? { aside, asideLabel: aside.startsWith('R_f') ? aside : `U ${aside}` } : {}),
      searchText: library ? assemblySearchHaystack(row, library.materialsById) : '',
    };
  };
  const rows = library?.examples.filter((row) => row.elementType === elementType) ?? [];
  const options = (user: boolean) => rows
    .filter((row) => (assemblyProvenanceLabel(row) === 'User created') === user)
    .flatMap((row) => option(row) ?? []);
  // A stored id the library no longer holds still shows, named as missing.
  const missing = library && value && !library.examples.some((row) => row.id === value)
    ? [{ options: [{ value, label: `${value} (missing from library)` }] }]
    : [];
  const sections = [
    ...(none ? [{ options: [{ value: '', label: 'None' }] }] : []),
    ...missing,
    { title: 'Your library', options: options(true) },
    { title: SAMPLE_TITLE[elementType], options: options(false) },
  ].filter((section) => section.options.length > 0);

  return (
    <SearchableDescribedSelect
      key={`library-${elementType}`}
      value={value}
      placeholder={placeholder}
      searchPlaceholder="Filter"
      minWidth="100%"
      menuMinWidth={360}
      disabled={disabled || !library}
      menuZIndex={menuZIndex}
      triggerVariant={triggerVariant}
      triggerSize={triggerSize}
      aria-label={ariaLabel}
      listboxLabel="Layers"
      wrapOptionLabels
      menuBoundsSelector=".modal-container, .element-creator, .multi-select-panel"
      sections={sections}
      onChange={(id) => {
        // The current choice again (a missing row among them) changes nothing.
        if (id === value) return;
        onPick(library?.examples.find((row) => row.id === id) ?? null);
      }}
      closeMenuSignal={closeSignal}
      menuFooter={onSave ? (
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={saveDisabled}
          onClick={() => {
            onSave();
            setCloseSignal((n) => n + 1);
          }}
        >
          Save these layers to your library
        </button>
      ) : undefined}
    />
  );
};
