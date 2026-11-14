// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { StatusPill } from './StatusPill';
import { EmitterSizingChart } from './EmitterSizingChart';
import { HeatSourceSizingBar } from './HeatSourceSizingBar';
import type { Element } from '../geometry/types';
import { heatSourceSizingsFor, systemSizingFor } from '../geometry/validation/validateElement';
import { selectHeatingSizing } from '../stores/geometryStore/slices/heatingSizingSlice';
import { useGeometryStore } from '../stores/geometryStore';
import { emitterLineView, heatSourceView, sizingGate, systemView, type SizingNote } from '../lib/heatingSizingView';
import './HeatingSizing.css';

const Note = ({ note }: { note: SizingNote }) => <p className="heating-sizing__dim">{note.text}</p>;

/**
 * The sizing block of a System (HeatSourceWet: bar, SpaceHeatSystem: chart) or WetEmitter (one line).
 * Renders nothing when there is nothing to say about the element.
 */
export function HeatingSizingBlock({ element, elements }: { element: Element | null; elements: readonly Element[] }) {
  const sizing = useGeometryStore(selectHeatingSizing);
  if (!element) return null;
  const gate = sizingGate(sizing);
  if (gate.kind === 'hidden') return null;
  const isHeatSource = element.type === 'System' && element.subcategory === 'HeatSourceWet';
  const isSystem = element.type === 'System' && element.subcategory === 'SpaceHeatSystem';
  if (!isHeatSource && !isSystem && element.type !== 'WetEmitter') return null;
  if (gate.kind === 'note') return element.type === 'WetEmitter' ? null : <div className="heating-sizing"><Note note={gate} /></div>;

  const { result } = gate;
  if (isHeatSource) {
    const entries = heatSourceSizingsFor(result, element);
    if (entries.length === 0) return null;
    // A System holding several plants: one block each, headed by the plant's name.
    return entries.map((entry) => {
      const view = heatSourceView(entry, result);
      return (
        <div key={entry.name}>
          {entries.length > 1 ? <h4 className="heating-sizing__plant">{entry.name}</h4> : null}
          {view.kind === 'note' ? <div className="heating-sizing"><Note note={view} /></div> : <HeatSourceSizingBar view={view} />}
        </div>
      );
    });
  }
  const entry = systemSizingFor(result, element, elements);
  if (!entry) return null;
  if (isSystem) {
    const view = systemView(entry, result);
    return view.kind === 'note' ? <div className="heating-sizing"><Note note={view} /></div> : <EmitterSizingChart view={view} />;
  }
  const line = emitterLineView(entry, result);
  if (!line) return null;
  return (
    <div className="heating-sizing">
      <StatusPill tone={line.pill.tone} labelOverride={line.pill.label} inline={false} />
      <p className="heating-sizing__sentence">{line.sentence}</p>
    </div>
  );
}
