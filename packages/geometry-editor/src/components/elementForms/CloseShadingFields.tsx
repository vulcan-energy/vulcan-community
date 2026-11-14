import type { Element } from '../../geometry/types';
import { CLOSE_SHADING_KINDS, closeShadingOptions, type CloseShadingKind } from '../../lib/windowOpenings';
import { ResetFieldButton } from '../ResetFieldButton';
import { StandardDropdown } from '../StandardDropdown';

/**
 * A window's close-shading categories on an existing-building model, one per kind (`kinds`, or
 * all), stated on the window. A Window Shading feature drawn for the window shows as the
 * placeholder; what it is is the assessor's choice. Rendered in the window's inspector and
 * beside each drawn feature.
 */
export function CloseShadingFields({ windowName, kinds, elementsById, updateElement }: Readonly<{
  windowName: string;
  kinds?: readonly CloseShadingKind[];
  elementsById: Record<string, Element>;
  updateElement: (id: string, updates: Partial<Element>) => void;
}>) {
  const elements = Object.values(elementsById);
  const win = elements.find((element) => element?.type === 'BuildingElementTransparent' && element.name === windowName);
  if (!win) return null;
  const extra = win.extra_json ?? {};
  const write = (kind: CloseShadingKind, value: string | undefined) => {
    const next = { ...extra };
    if (value) next[kind] = value;
    else delete next[kind];
    updateElement(win.id, { extra_json: next });
  };
  return CLOSE_SHADING_KINDS.map(({ kind, drawn, label }) => {
    if (kinds && !kinds.includes(kind)) return null;
    const feature = elements.find((element) => element?.type === 'WindowShading'
      && element.parent_element === windowName
      && ((element as { shading_type?: string }).shading_type || 'object') === drawn) as { depth?: number } | undefined;
    const depth = typeof feature?.depth === 'number' ? feature.depth : undefined;
    const stated = typeof extra[kind] === 'string' ? extra[kind] as string : '';
    const placeholder = feature ? `Drawn${depth === undefined ? '' : ` ${depth} m`}: choose what it is` : 'None';
    return <div key={kind} style={{ display: 'contents' }}>
      <div className="element-label">{`Window ${label.toLowerCase()}:`}</div>
      <div className="element-input" style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
        <StandardDropdown aria-label={`${windowName} ${label.toLowerCase()}`} value={stated} placeholder={placeholder}
          options={closeShadingOptions(kind, depth)} onChange={(value) => write(kind, value)} variant="ghost" size="md" />
        {stated && <ResetFieldButton onClick={() => write(kind, undefined)} label="Clear" title="Clear" ariaLabel={`Clear the window ${label.toLowerCase()}`} align="inline" />}
      </div>
    </div>;
  });
}
