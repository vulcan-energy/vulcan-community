// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Text } from 'react-konva';
import type { Element } from '../../geometry/types';
import { easePointsToward } from '../../lib/geometryTransform';
import { getElementShape, worldToCanvas } from '../../lib/shapeUtils';
import { ATTENTION_GLOW } from './elementRendererPalette';

/** Another user's selection: a glowing outline in their colour with a name pill (host-supplied presence). */
export type GeometryCanvasRemoteSelection = Readonly<{
  key: string;
  label: string;
  color: string;
  /** Shown until an image loads; taken from `label` when absent. */
  initials?: string;
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

/**
 * Another user's edit in progress, dashed in their colour with a name pill:
 * each dragged element at its provisional position, or a drawing's path to
 * their cursor. Model coordinates (metres); one point draws as a ring.
 */
export type GeometryCanvasRemoteGhost = Readonly<{
  key: string;
  label: string;
  color: string;
  initials?: string;
  imageUrl?: string;
  /** `key` names a path within its ghost (the dragged element, say), so its points ease in place. */
  paths: readonly Readonly<{ key: string; points: readonly Readonly<{ x: number; y: number }>[]; closed: boolean }>[];
}>;

/** A viewport as its centre in model coordinates and the canvas zoom scale. */
export type GeometryCanvasViewport = Readonly<{ cx: number; cy: number; scale: number }>;

type Point = { x: number; y: number };

/** Easing time constant: a cursor covers ~95% of a jump in 150 ms. */
const CURSOR_EASE_MS = 50;

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
const LEADER = 22;
// A ~22 px pointer; its tip is the origin.
const ARROW = [0, 0, 0, 19, 5.5, 14.5, 9, 22, 12, 20.8, 8.5, 13.3, 15, 13.3];

/** Two letters from a label's words, for a pill without host-supplied initials. */
function initialsOf(label: string): string {
  let result = '';
  for (const word of label.split(/[\s@._-]+/)) {
    if (word && /\w/.test(word[0]!)) result += word[0]!.toUpperCase();
    if (result.length === 2) break;
  }
  return result || '?';
}

type PillPlacement = Readonly<{ anchor: Point; direction: Point }>;

const UP: Point = { x: 0, y: -1 };

/**
 * Where a selection's pill sits and which way its leader runs: a line's
 * midpoint, out along its normal (away from `centre`, else right or up), so the
 * leader never lies along the line; a closed shape's top centre, upward; a point, upward.
 */
function pillPlacement(shape: string, points: readonly Point[], centre: Point | null): PillPlacement {
  if (shape === 'point' || points.length < 2) return { anchor: points[0]!, direction: UP };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (shape !== 'line') return { anchor: { x: (minX + maxX) / 2, y: minY }, direction: UP };
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const anchor = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const length = Math.hypot(last.x - first.x, last.y - first.y);
  if (length === 0) return { anchor, direction: UP };
  let direction = { x: -(last.y - first.y) / length, y: (last.x - first.x) / length };
  const outward = centre ? (anchor.x - centre.x) * direction.x + (anchor.y - centre.y) * direction.y : 0;
  const flip = outward !== 0 ? outward < 0 : direction.x < 0 || (direction.x === 0 && direction.y > 0);
  if (flip) direction = { x: -direction.x, y: -direction.y };
  return { anchor, direction };
}

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

/**
 * Avatar and name on the person's colour; origin top-left, or with `toward`
 * the pill lies beyond its origin in that direction (UP: bottom-centre on it).
 */
function NamePill({ color, label, initials, imageUrl, toward }: Readonly<{
  color: string; label: string; initials: string; imageUrl?: string; toward?: Point;
}>) {
  const width = useMemo(() => PILL_HEIGHT + labelWidth(label) + 8, [label]);
  const x = toward ? -width / 2 + (toward.x * width) / 2 : 0;
  const y = toward ? -PILL_HEIGHT / 2 + (toward.y * PILL_HEIGHT) / 2 : 0;
  return (
    <Group x={x} y={y}>
      <Rect width={width} height={PILL_HEIGHT} cornerRadius={PILL_HEIGHT / 2} fill={color} shadowColor="#000" shadowBlur={4} shadowOpacity={0.25} />
      <AvatarDisc x={PILL_HEIGHT / 2} y={PILL_HEIGHT / 2} color={color} initials={initials} imageUrl={imageUrl} />
      <Text x={PILL_HEIGHT + 1} height={PILL_HEIGHT} verticalAlign="middle" text={label} fontSize={FONT_SIZE} fontStyle="bold" fill="#fff" />
    </Group>
  );
}

/** A ref callback that registers a node under `key`. */
const keep = <T,>(map: Map<string, T>, key: string) => (node: T | null) => {
  if (node) map.set(key, node);
  else map.delete(key);
};

type ElementCanvasDatum = Readonly<{ element: Element; canvasCoords: readonly Point[] }>;

type RemotePresenceLayerProps = Readonly<{
  selections: readonly GeometryCanvasRemoteSelection[];
  cursors: readonly GeometryCanvasRemoteCursor[];
  ghosts: readonly GeometryCanvasRemoteGhost[];
  elementCanvasData: readonly ElementCanvasDatum[];
  scale: number;
  panOffset: Point;
  canvasCenter: Point;
}>;

const ghostPointKey = (ghost: string, path: string, point: number) => `ghost:${ghost}\n${path}\n${point}`;

/**
 * Colleagues on this floor: their selections (glow, tint, name pill, a pulse
 * when it changes), their edits in progress and their pointers, the last two
 * eased toward each update so ~10 Hz input moves smoothly. Not listening: it never takes a click.
 */
export const RemotePresenceLayer = memo(function RemotePresenceLayer({
  selections,
  cursors,
  ghosts,
  elementCanvasData,
  scale,
  panOffset,
  canvasCenter,
}: RemotePresenceLayerProps) {
  const layerRef = useRef<Konva.Layer>(null);
  // Mutable registries that never trigger a render.
  const [cursorNodes] = useState(() => new Map<string, Konva.Group>());
  const [displayed] = useState(() => new Map<string, Point>());
  const [selectionNodes] = useState(() => new Map<string, Konva.Group>());
  const [selectionSignatures] = useState(() => new Map<string, string>());
  const [ghostNodes] = useState(() => new Map<string, Konva.Shape>());
  const [ghostPills] = useState(() => new Map<string, Konva.Group>());

  // Cursors and every ghost point ease as one set of targets.
  const targets = useMemo(() => {
    if (ghosts.length === 0) return cursors;
    const all: { key: string; x: number; y: number }[] = [...cursors];
    for (const ghost of ghosts) {
      for (const path of ghost.paths) {
        path.points.forEach((point, index) => all.push({ key: ghostPointKey(ghost.key, path.key, index), x: point.x, y: point.y }));
      }
    }
    return all;
  }, [cursors, ghosts]);

  // Positions are set here, not as props, so a re-render never jumps a cursor or ghost to its target.
  useLayoutEffect(() => {
    const toCanvas = (key: string) => {
      const point = displayed.get(key);
      return point ? worldToCanvas(point, scale, panOffset, canvasCenter) : null;
    };
    const place = () => {
      for (const cursor of cursors) {
        const at = toCanvas(cursor.key);
        if (at) cursorNodes.get(cursor.key)?.position(at);
      }
      for (const ghost of ghosts) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity;
        for (const path of ghost.paths) {
          const flat: number[] = [];
          path.points.forEach((_, index) => {
            const at = toCanvas(ghostPointKey(ghost.key, path.key, index));
            if (!at) return;
            flat.push(at.x, at.y);
            minX = Math.min(minX, at.x);
            maxX = Math.max(maxX, at.x);
            minY = Math.min(minY, at.y);
          });
          const node = ghostNodes.get(`${ghost.key}\n${path.key}`);
          if (node instanceof Konva.Line) node.points(flat);
          else if (node && flat.length >= 2) node.position({ x: flat[0]!, y: flat[1]! });
        }
        // The pill rides above the ghost's top centre.
        if (minY !== Infinity) ghostPills.get(ghost.key)?.position({ x: (minX + maxX) / 2, y: minY - LEADER / 2 });
      }
      layerRef.current?.batchDraw();
    };
    let last = performance.now();
    let frame: number | null = null;
    const tick = (time: number) => {
      const moving = easePointsToward(displayed, targets, time - last, CURSOR_EASE_MS);
      last = time;
      place();
      frame = moving ? requestAnimationFrame(tick) : null;
    };
    const moving = easePointsToward(displayed, targets, 0, CURSOR_EASE_MS);
    place();
    if (moving) frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [targets, cursors, ghosts, displayed, cursorNodes, ghostNodes, ghostPills, scale, panOffset, canvasCenter]);

  // A changed selection pulses once.
  useEffect(() => {
    const present = new Set<string>();
    for (const selection of selections) {
      const signature = selection.elementIds.join('\n');
      present.add(selection.key);
      if (selectionSignatures.get(selection.key) === signature) continue;
      selectionSignatures.set(selection.key, signature);
      const group = selectionNodes.get(selection.key);
      const pill = selectionNodes.get(`${selection.key}:pill`);
      group?.opacity(0.3);
      group?.to({ opacity: 1, duration: 0.4 });
      pill?.scale({ x: 1.25, y: 1.25 });
      pill?.to({ scaleX: 1, scaleY: 1, duration: 0.4 });
    }
    for (const key of selectionSignatures.keys()) if (!present.has(key)) selectionSignatures.delete(key);
  }, [selectionNodes, selectionSignatures, selections]);

  if (selections.length === 0 && cursors.length === 0 && ghosts.length === 0) return null;
  // The floor's centre, for pointing a wall's pill outward.
  let layoutCentre: Point | null = null;
  if (selections.length > 0) {
    let sumX = 0, sumY = 0, count = 0;
    for (const { canvasCoords } of elementCanvasData) {
      for (const point of canvasCoords) {
        sumX += point.x;
        sumY += point.y;
        count += 1;
      }
    }
    if (count > 0) layoutCentre = { x: sumX / count, y: sumY / count };
  }

  return (
    <Layer ref={layerRef} name="remote-presence-layer" listening={false}>
      {selections.map((remote) => {
        const ids = new Set(remote.elementIds);
        const shapes: ReactNode[] = [];
        let placement: PillPlacement | null = null;
        for (const { element, canvasCoords } of elementCanvasData) {
          const first = canvasCoords[0];
          if (!ids.has(element.id) || !first) continue;
          const shape = getElementShape(element);
          placement ??= pillPlacement(shape, canvasCoords, layoutCentre);
          const glow = { shadowColor: remote.color, ...ATTENTION_GLOW };
          if (shape === 'point') {
            shapes.push(<Circle key={element.id} x={first.x} y={first.y} radius={9} stroke={remote.color} strokeWidth={2} {...glow} />);
            continue;
          }
          const points = canvasCoords.flatMap((point) => [point.x, point.y]);
          if (shape !== 'line') shapes.push(<Line key={`${element.id}:tint`} points={points} closed fill={remote.color} opacity={0.12} />);
          shapes.push(
            <Line key={element.id} points={points} closed={shape !== 'line'} stroke={remote.color} strokeWidth={4} lineJoin="round" {...glow} />,
          );
        }
        if (!placement) return null;
        const { anchor, direction } = placement;
        const end = { x: anchor.x + direction.x * LEADER, y: anchor.y + direction.y * LEADER };
        return (
          <Group key={remote.key} ref={keep(selectionNodes, remote.key)}>
            {shapes}
            <Line points={[anchor.x, anchor.y, end.x, end.y]} stroke={remote.color} strokeWidth={2} />
            <Group x={end.x} y={end.y} ref={keep(selectionNodes, `${remote.key}:pill`)}>
              <NamePill color={remote.color} label={remote.label} initials={remote.initials ?? initialsOf(remote.label)} imageUrl={remote.imageUrl} toward={direction} />
            </Group>
          </Group>
        );
      })}
      {ghosts.map((ghost) => (
        <Group key={ghost.key} name="remote-ghost" id={`remote-ghost:${ghost.key}`}>
          {ghost.paths.map((path) => {
            const ref = keep<Konva.Shape>(ghostNodes, `${ghost.key}\n${path.key}`);
            return path.points.length === 1
              ? <Circle key={path.key} ref={ref} radius={9} stroke={ghost.color} strokeWidth={2} dash={[4, 3]} />
              : <Line key={path.key} ref={ref} closed={path.closed} stroke={ghost.color} strokeWidth={2} dash={[8, 5]} lineJoin="round" />;
          })}
          <Group ref={keep(ghostPills, ghost.key)}>
            <NamePill color={ghost.color} label={ghost.label} initials={ghost.initials ?? initialsOf(ghost.label)} imageUrl={ghost.imageUrl} toward={UP} />
          </Group>
        </Group>
      ))}
      {cursors.map((cursor) => (
        <Group key={cursor.key} name="remote-cursor" id={`remote-cursor:${cursor.key}`} ref={keep(cursorNodes, cursor.key)}>
          <Line points={ARROW} closed fill={cursor.color} fillEnabled stroke="#fff" strokeWidth={1.5} lineJoin="round" />
          <Group x={14} y={22}>
            <NamePill color={cursor.color} label={cursor.label} initials={cursor.initials} imageUrl={cursor.imageUrl} />
          </Group>
        </Group>
      ))}
    </Layer>
  );
});
