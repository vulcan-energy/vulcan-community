// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Text } from 'react-konva';
import type { Element } from '../../geometry/types';
import { getElementShape, worldToCanvas } from '../../lib/shapeUtils';

/** Another user's selection: a glowing outline in their colour with a name pill (host-supplied presence). */
export type GeometryCanvasRemoteSelection = Readonly<{
  key: string;
  label: string;
  color: string;
  initials: string;
  imageUrl?: string;
  elementIds: readonly string[];
}>;

/** Another user's pointer on the current floor, in model coordinates (metres). */
export type GeometryCanvasRemoteCursor = Readonly<{
  key: string;
  label: string;
  color: string;
  initials: string;
  imageUrl?: string;
  x: number;
  y: number;
}>;

/** A viewport as its centre in model coordinates and the canvas zoom scale. */
export type GeometryCanvasViewport = Readonly<{ cx: number; cy: number; scale: number }>;

type Point = { x: number; y: number };

/** Easing time constant: a cursor covers ~95% of a jump in 150 ms. */
export const REMOTE_CURSOR_EASE_MS = 50;

/**
 * One animation step: each displayed point eases toward its target; a new key
 * starts at its target and a key no longer targeted is dropped. Returns
 * whether any point is still moving.
 */
export function easeRemoteCursors(
  displayed: Map<string, Point>,
  targets: readonly Readonly<{ key: string; x: number; y: number }>[],
  elapsedMs: number,
): boolean {
  const k = 1 - Math.exp(-Math.max(0, elapsedMs) / REMOTE_CURSOR_EASE_MS);
  const live = new Set<string>();
  let moving = false;
  for (const target of targets) {
    live.add(target.key);
    const point = displayed.get(target.key);
    if (!point) {
      displayed.set(target.key, { x: target.x, y: target.y });
      continue;
    }
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    // Within a millimetre: settle.
    if (Math.hypot(dx, dy) < 1e-3) {
      point.x = target.x;
      point.y = target.y;
      continue;
    }
    point.x += dx * k;
    point.y += dy * k;
    moving = true;
  }
  for (const key of displayed.keys()) if (!live.has(key)) displayed.delete(key);
  return moving;
}

// Profile images load once per URL; initials show until one loads, or for good if it fails.
const avatarImages = new Map<string, HTMLImageElement>();
const avatarListeners = new Set<() => void>();
const subscribeAvatars = (listener: () => void) => {
  avatarListeners.add(listener);
  return () => {
    avatarListeners.delete(listener);
  };
};
function loadAvatar(url: string): void {
  if (avatarImages.has(url)) return;
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    for (const listener of avatarListeners) listener();
  };
  image.src = url;
  avatarImages.set(url, image);
}
function loadedAvatar(url: string | undefined): HTMLImageElement | undefined {
  const image = url ? avatarImages.get(url) : undefined;
  return image?.complete && image.naturalWidth > 0 ? image : undefined;
}

const PILL_HEIGHT = 20;
const DISC_RADIUS = 7;
const FONT_SIZE = 11;
const LEADER = 14;
// The arrow's tip is its origin.
const ARROW = [0, 0, 0, 16, 4.5, 12, 7.5, 18.5, 10, 17.5, 7, 11, 12.5, 11];

let measurer: Konva.Text | null = null;
function labelWidth(label: string): number {
  measurer ??= new Konva.Text({ fontSize: FONT_SIZE, fontStyle: 'bold' });
  return measurer.text(label).width();
}

function AvatarDisc({ x, y, color, initials, imageUrl }: Readonly<{
  x: number; y: number; color: string; initials: string; imageUrl?: string;
}>) {
  useEffect(() => {
    if (imageUrl) loadAvatar(imageUrl);
  }, [imageUrl]);
  const image = useSyncExternalStore(subscribeAvatars, () => loadedAvatar(imageUrl));
  return (
    <Group x={x} y={y}>
      <Circle radius={DISC_RADIUS} fill={color} stroke="#fff" strokeWidth={1.5} />
      {image ? (
        <Group clipFunc={(context) => context.arc(0, 0, DISC_RADIUS, 0, Math.PI * 2, false)}>
          <KonvaImage image={image} x={-DISC_RADIUS} y={-DISC_RADIUS} width={DISC_RADIUS * 2} height={DISC_RADIUS * 2} />
        </Group>
      ) : (
        <Text
          text={initials}
          x={-DISC_RADIUS}
          y={-DISC_RADIUS}
          width={DISC_RADIUS * 2}
          height={DISC_RADIUS * 2}
          align="center"
          verticalAlign="middle"
          fontSize={7}
          fontStyle="bold"
          fill="#fff"
        />
      )}
    </Group>
  );
}

/** Avatar and name on the person's colour; origin top-left, or bottom-centre when `centred`. */
function NamePill({ color, label, initials, imageUrl, centred = false }: Readonly<{
  color: string; label: string; initials: string; imageUrl?: string; centred?: boolean;
}>) {
  const width = useMemo(() => PILL_HEIGHT + labelWidth(label) + 8, [label]);
  return (
    <Group x={centred ? -width / 2 : 0} y={centred ? -PILL_HEIGHT : 0}>
      <Rect width={width} height={PILL_HEIGHT} cornerRadius={PILL_HEIGHT / 2} fill={color} shadowColor="#000" shadowBlur={4} shadowOpacity={0.25} />
      <AvatarDisc x={PILL_HEIGHT / 2} y={PILL_HEIGHT / 2} color={color} initials={initials} imageUrl={imageUrl} />
      <Text x={PILL_HEIGHT + 1} height={PILL_HEIGHT} verticalAlign="middle" text={label} fontSize={FONT_SIZE} fontStyle="bold" fill="#fff" />
    </Group>
  );
}

type ElementCanvasDatum = Readonly<{ element: Element; canvasCoords: readonly Point[] }>;

type RemotePresenceLayerProps = Readonly<{
  selections: readonly GeometryCanvasRemoteSelection[];
  cursors: readonly GeometryCanvasRemoteCursor[];
  elementCanvasData: readonly ElementCanvasDatum[];
  scale: number;
  panOffset: Point;
  canvasCenter: Point;
}>;

/**
 * Colleagues on this floor: their selections (glow, tint, name pill, a pulse
 * when it changes) and their pointers, eased toward each update so ~10 Hz
 * input moves smoothly. Not listening: it never takes a click.
 */
export const RemotePresenceLayer = memo(function RemotePresenceLayer({
  selections,
  cursors,
  elementCanvasData,
  scale,
  panOffset,
  canvasCenter,
}: RemotePresenceLayerProps) {
  const layerRef = useRef<Konva.Layer>(null);
  const cursorNodes = useRef(new Map<string, Konva.Group>());
  const displayed = useRef(new Map<string, Point>());
  const selectionNodes = useRef(new Map<string, Konva.Group>());
  const selectionSignatures = useRef(new Map<string, string>());

  // Positions are set here, not as props, so a re-render never jumps a cursor to its target.
  useLayoutEffect(() => {
    const place = () => {
      for (const [key, point] of displayed.current) {
        cursorNodes.current.get(key)?.position(worldToCanvas(point, scale, panOffset, canvasCenter));
      }
      layerRef.current?.batchDraw();
    };
    let last = performance.now();
    let frame: number | null = null;
    const tick = (time: number) => {
      const moving = easeRemoteCursors(displayed.current, cursors, time - last);
      last = time;
      place();
      frame = moving ? requestAnimationFrame(tick) : null;
    };
    const moving = easeRemoteCursors(displayed.current, cursors, 0);
    place();
    if (moving) frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [cursors, scale, panOffset, canvasCenter]);

  // A changed selection pulses once.
  useEffect(() => {
    const next = new Map<string, string>();
    for (const selection of selections) {
      const signature = selection.elementIds.join('\n');
      next.set(selection.key, signature);
      if (selectionSignatures.current.get(selection.key) === signature) continue;
      const group = selectionNodes.current.get(selection.key);
      const pill = selectionNodes.current.get(`${selection.key}:pill`);
      group?.opacity(0.3);
      group?.to({ opacity: 1, duration: 0.4 });
      pill?.scale({ x: 1.25, y: 1.25 });
      pill?.to({ scaleX: 1, scaleY: 1, duration: 0.4 });
    }
    selectionSignatures.current = next;
  }, [selections]);

  if (selections.length === 0 && cursors.length === 0) return null;
  const keep = (map: Map<string, Konva.Group>, key: string) => (node: Konva.Group | null) => {
    if (node) map.set(key, node);
    else map.delete(key);
  };

  return (
    <Layer ref={layerRef} name="remote-presence-layer" listening={false}>
      {selections.map((remote) => {
        const ids = new Set(remote.elementIds);
        const shapes: ReactNode[] = [];
        let anchor: Point | null = null;
        for (const { element, canvasCoords } of elementCanvasData) {
          const first = canvasCoords[0];
          if (!ids.has(element.id) || !first) continue;
          anchor ??= first;
          const shape = getElementShape(element);
          const glow = { shadowColor: remote.color, shadowBlur: 12, shadowOpacity: 0.9 };
          if (shape === 'point') {
            shapes.push(<Circle key={element.id} x={first.x} y={first.y} radius={9} stroke={remote.color} strokeWidth={2} {...glow} />);
            continue;
          }
          const points = canvasCoords.flatMap((point) => [point.x, point.y]);
          if (shape !== 'line') shapes.push(<Line key={`${element.id}:tint`} points={points} closed fill={remote.color} opacity={0.12} />);
          shapes.push(
            <Line key={element.id} points={points} closed={shape !== 'line'} stroke={remote.color} strokeWidth={3} lineJoin="round" {...glow} />,
          );
        }
        if (!anchor) return null;
        return (
          <Group key={remote.key} ref={keep(selectionNodes.current, remote.key)}>
            {shapes}
            <Line points={[anchor.x, anchor.y, anchor.x, anchor.y - LEADER]} stroke={remote.color} strokeWidth={1.5} />
            <Group x={anchor.x} y={anchor.y - LEADER} ref={keep(selectionNodes.current, `${remote.key}:pill`)}>
              <NamePill color={remote.color} label={remote.label} initials={remote.initials} imageUrl={remote.imageUrl} centred />
            </Group>
          </Group>
        );
      })}
      {cursors.map((cursor) => (
        <Group key={cursor.key} ref={keep(cursorNodes.current, cursor.key)}>
          <Line points={ARROW} closed fill={cursor.color} stroke="#fff" strokeWidth={1.5} lineJoin="round" />
          <Group x={12} y={18}>
            <NamePill color={cursor.color} label={cursor.label} initials={cursor.initials} imageUrl={cursor.imageUrl} />
          </Group>
        </Group>
      ))}
    </Layer>
  );
});
