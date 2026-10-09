// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useEffect, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { Line2, LineGeometry, LineSegments2 } from 'three-stdlib';
import { readRootCssVar } from '../../lib/cssVars';
import type { AutoThermalBridgeCandidate } from '../../geometry/thermalBridge/autoThermalBridgeCandidates';
import type { ThermalBridgeInventoryRow } from '../../geometry/thermalBridge/thermalBridgeInventory';
import { resolveHostElementForLinearTb } from '../../geometry/thermalBridge/tbLinkage';
import type { Element } from '../../geometry/types';
import type { AutoThermalBridgePreview, ThermalBridgePreviewAnchor } from '../../hooks/useAutoThermalBridgePreview';
import { thermalBridgeCandidatesForRender, thermalBridgeIssuesForRender } from './thermalBridgePreviewRenderRows';
import {
  isThermalBridgePreviewClick,
  incidentThermalBridgePreviewSurfaces,
  offsetThermalBridgePreviewWorldPoints,
  thermalBridgePreviewCandidateIdsAtHit,
  thermalBridgePreviewWorldPoints,
  type ThermalBridgePreviewHostSurface,
} from './thermalBridgePreview3dGeometry';

function previewAnchor(event: { nativeEvent: MouseEvent | PointerEvent }): ThermalBridgePreviewAnchor {
  const canvas = event.nativeEvent.currentTarget;
  const canvasElement = canvas instanceof HTMLCanvasElement ? canvas : null;
  const bounds = canvasElement?.closest('.geometry-canvas-3d')?.getBoundingClientRect() ??
    canvasElement?.getBoundingClientRect();
  if (!bounds) return { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
  return {
    x: event.nativeEvent.clientX - bounds.left,
    y: event.nativeEvent.clientY - bounds.top,
  };
}

function PreviewCandidateLine({
  candidate,
  preview,
  hostSurfaces,
}: {
  candidate: AutoThermalBridgeCandidate;
  preview: AutoThermalBridgePreview;
  hostSurfaces: readonly ThermalBridgePreviewHostSurface[];
}) {
  const cameraPosition = useThree((state) => state.camera.position);
  const lineRefs = useRef<Array<Line2 | LineSegments2 | null>>([]);
  const lastCameraPosition = useRef({ x: Number.NaN, y: Number.NaN, z: Number.NaN });
  const points = thermalBridgePreviewWorldPoints(candidate.coordinates);
  const incidentSurfaces = incidentThermalBridgePreviewSurfaces(points, hostSurfaces);
  const renderSurfaces: Array<ThermalBridgePreviewHostSurface | null> = incidentSurfaces.length
    ? incidentSurfaces
    : [null];
  const hovered = preview.hover?.ids.includes(candidate.proposalId) ?? false;
  useFrame(({ camera }) => {
    const dx = lastCameraPosition.current.x - camera.position.x;
    const dy = lastCameraPosition.current.y - camera.position.y;
    const dz = lastCameraPosition.current.z - camera.position.z;
    if (dx * dx + dy * dy + dz * dz < 1e-10) return;
    lastCameraPosition.current = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    renderSurfaces.forEach((surface, index) => {
      const currentLine = lineRefs.current[index];
      if (!currentLine || !surface) return;
      const worldPoints = offsetThermalBridgePreviewWorldPoints(points, camera.position, surface);
      (currentLine.geometry as LineGeometry).setPositions(worldPoints.flat());
      currentLine.computeLineDistances();
    });
  });
  return (
    <group>
      {renderSurfaces.map((surface, index) => (
        <Line
          key={surface
            ? `${surface.hostElementId ?? 'host'}:${surface.normal.map((value) => value.toFixed(6)).join(',')}:${surface.thicknessM.toFixed(4)}`
            : `${candidate.proposalId}:unmapped-host`}
            ref={(line) => { lineRefs.current[index] = line; }}
            points={surface ? offsetThermalBridgePreviewWorldPoints(points, cameraPosition, surface) : points}
            color={readRootCssVar('--canvas-drawing-guide', '#ddee63')}
            lineWidth={hovered ? 4 : 2.5}
            dashed
            dashSize={0.24}
            gapSize={0.12}
            depthTest
            depthWrite={false}
            transparent
            opacity={0.98}
            toneMapped={false}
            userData={{ thermalBridgePreviewCandidateId: candidate.proposalId }}
            onPointerMove={(event) => {
              event.stopPropagation();
            if (preview.pinned) return;
              preview.onHover(
                thermalBridgePreviewCandidateIdsAtHit(event.intersections, candidate.proposalId),
                previewAnchor(event),
              );
            }}
            onClick={(event) => {
              event.stopPropagation();
              event.nativeEvent.stopPropagation();
              if (!isThermalBridgePreviewClick(event.delta)) return;
              preview.onActivate(
                thermalBridgePreviewCandidateIdsAtHit(event.intersections, candidate.proposalId),
                previewAnchor(event),
              );
            }}
          />
      ))}
    </group>
  );
}

function PreviewIssueMarker({
  issue,
  preview,
  onInspectThermalBridge,
  color,
  elementsById,
  hostSurfacesByElementId,
}: {
  issue: ThermalBridgeInventoryRow;
  preview: AutoThermalBridgePreview;
  onInspectThermalBridge?: (id: string) => void;
  color: string;
  elementsById: Record<string, Element>;
  hostSurfacesByElementId: ReadonlyMap<string, readonly ThermalBridgePreviewHostSurface[]>;
}) {
  const [a, b] = issue.tb.coordinates;
  const points = a && b ? thermalBridgePreviewWorldPoints([a, b]) : [];
  const host = resolveHostElementForLinearTb(issue.tb.parent_element, issue.tb.zoneId, elementsById);
  const hostSurfaces = host ? hostSurfacesByElementId.get(host.id) ?? [] : [];
  const cameraPosition = useThree((state) => state.camera.position);
  const meshRef = useRef<Mesh>(null);
  const midpoint = points.reduce(
    (mid, point) => [mid[0] + point[0] / 2, mid[1] + point[1] / 2, mid[2] + point[2] / 2],
    [0, 0, 0] as [number, number, number],
  );
  const hostSurface = incidentThermalBridgePreviewSurfaces([midpoint], hostSurfaces)[0];
  const markerPosition = hostSurface
    ? offsetThermalBridgePreviewWorldPoints([midpoint], cameraPosition, hostSurface)[0]!
    : midpoint;
  useFrame(({ camera }) => {
    if (!meshRef.current || !hostSurface) return;
    meshRef.current.position.set(
      ...offsetThermalBridgePreviewWorldPoints([midpoint], camera.position, hostSurface)[0]!,
    );
  });
  if (!a || !b) return null;
  const issueId = `issue:${issue.tb.id}`;
  return (
    <>
      {/* react-doctor-disable-next-line react-doctor/no-unknown-property -- userData is a Three.js Object3D field used for issue picking. */}
      <mesh
        ref={meshRef}
        position={markerPosition}
        userData={{ thermalBridgePreviewIssueId: issue.tb.id }}
        onPointerMove={(event) => {
          event.stopPropagation();
          preview.onHover([issueId], previewAnchor(event));
        }}
        onClick={(event) => {
          event.stopPropagation();
          event.nativeEvent.stopPropagation();
          if (isThermalBridgePreviewClick(event.delta)) onInspectThermalBridge?.(issue.tb.id);
        }}
        renderOrder={2100}
      >
        <sphereGeometry args={[0.15, 12, 8]} />
        <meshBasicMaterial color={color} depthTest depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

export const ThermalBridgePreview3D = memo(function ThermalBridgePreview3D({
  preview,
  onInspectThermalBridge,
  hostSurfacesByProposalId,
  hostSurfacesByElementId,
  elementsById,
}: {
  preview?: AutoThermalBridgePreview;
  onInspectThermalBridge?: (id: string) => void;
  hostSurfacesByProposalId: ReadonlyMap<string, readonly ThermalBridgePreviewHostSurface[]>;
  hostSurfacesByElementId: ReadonlyMap<string, readonly ThermalBridgePreviewHostSurface[]>;
  elementsById: Record<string, Element>;
}) {
  const active = Boolean(preview?.active);
  const raycaster = useThree((state) => state.raycaster);
  useEffect(() => {
    if (!active) return;
    const params = raycaster.params as typeof raycaster.params & { Line2?: { threshold?: number } };
    const previous = params.Line2;
    // eslint-disable-next-line react-hooks/immutability -- R3F raycaster params are mutable renderer configuration.
    params.Line2 = { ...previous, threshold: Math.max(previous?.threshold ?? 0, 8) };
    return () => {
      if (previous) params.Line2 = previous;
      else delete params.Line2;
    };
  }, [active, raycaster]);
  if (!preview?.active) return null;
  const candidatesToRender = thermalBridgeCandidatesForRender(preview.candidates, preview);
  const issuesToRender = thermalBridgeIssuesForRender(preview.issues, preview);
  return (
    <group>
      {candidatesToRender.map((candidate) => (
        <PreviewCandidateLine
          key={candidate.proposalId}
          candidate={candidate}
          preview={preview}
          hostSurfaces={hostSurfacesByProposalId.get(candidate.proposalId) ?? []}
        />
      ))}
      {issuesToRender.map((issue) => (
        <PreviewIssueMarker
          key={issue.tb.id}
          issue={issue}
          preview={preview}
          onInspectThermalBridge={onInspectThermalBridge}
          elementsById={elementsById}
          hostSurfacesByElementId={hostSurfacesByElementId}
          color={readRootCssVar(
            issue.severity === 'error' ? '--validation-error' : '--validation-warning',
            issue.severity === 'error' ? '#dc2626' : '#f59e0b',
          )}
        />
      ))}
    </group>
  );
});
