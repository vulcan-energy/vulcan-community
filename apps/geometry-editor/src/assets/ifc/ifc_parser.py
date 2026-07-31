#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""
IFC Parser using IfcOpenShell (Python)
Extracts building elements from IFC files for conversion to Vulcan CSV format
"""

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import json
import sys
import numpy as np
import math
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import argparse


class IfcElement:
    def __init__(self, id: int, type: str, name: str = None, geometry: Any = None, properties: Dict[str, Any] = None):
        self.id = id
        self.type = type
        self.name = name
        self.geometry = geometry
        self.properties = properties or {}
        self.coordinates: Optional[List[Tuple[float, float, float]]] = None
        self.coords_csv: str = ""
        self.area: Optional[float] = None
        self.height: Optional[float] = None
        self.width: Optional[float] = None
        self.orientation: Optional[float] = None
        self.storey: Optional[str] = None
        self.pitch: Optional[float] = None
        self.parent_element: Optional[str] = None
        self.base_height: Optional[float] = None
        # Window-specific properties for FHS schema
        self.frame_area_fraction: Optional[float] = None
        self.free_area_height: Optional[float] = None
        self.mid_height: Optional[float] = None
        # original IFC GlobalId when known (used for host linkage)
        self.global_id: Optional[str] = None


class AuditCollector:
    """Collects audit information for element processing decisions"""
    
    def __init__(self, level: str = 'standard', output_path: Optional[str] = None):
        self.level = level
        self.output_path = output_path
        self.records = []
        self.batch_size = 200
        self.batch_count = 0
        self._wrote_header = False
        self._metadata = None  # Store metadata in memory
    
    def log_element(self, element_id: str, ifc_type: str, ifc_name: str, 
                   final_state: str, reasons: List[str], csv_fields: Dict[str, Any],
                   sources: Dict[str, str], classification: Dict[str, Any],
                   storey: Dict[str, Any]):
        """Log a complete element processing record"""
        record = {
            "id": element_id,
            "type": ifc_type,
            "name": ifc_name,
            "final_state": final_state,
            "reasons": reasons,
            "csv_fields": csv_fields,
            "sources": sources,
            "classification": classification,
            "storey": storey
        }
        
        self.records.append(record)
        self.batch_count += 1
        
        # Batch write to file
        if self.batch_count >= self.batch_size:
            self._flush_batch()
    
    def _flush_batch(self):
        """Write accumulated records to JSONL file"""
        if not self.output_path or not self.records:
            return
        
        try:
            with open(self.output_path, 'a', encoding='utf-8') as f:
                for record in self.records:
                    f.write(json.dumps(record, separators=(',', ':')) + '\n')
            self.records.clear()
            self.batch_count = 0
        except Exception as e:
            pass
    
    def finalize(self):
        """Write any remaining records and close"""
        self._flush_batch()

    def write_metadata(self, metadata: Dict[str, Any]):
        """Write a single metadata record at the top of the audit file."""
        self._metadata = metadata  # Store in memory
        if not self.output_path:
            return
        try:
            if self._wrote_header:
                return
            with open(self.output_path, 'w', encoding='utf-8') as f:
                f.write(json.dumps({"_meta": metadata}, separators=(',', ':')) + '\n')
            self._wrote_header = True
        except Exception as e:
            pass
    
    def get_content(self) -> str:
        """
        Get all audit content as JSONL string (for browser/in-memory mode)
        Returns the metadata + all records as a single JSONL string
        """
        lines = []
        
        # Add metadata if available
        if self._metadata:
            lines.append(json.dumps({"_meta": self._metadata}, separators=(',', ':')))
        
        # Add all records (including those that may have been flushed to file)
        # For in-memory mode, records should all be in self.records
        for record in self.records:
            lines.append(json.dumps(record, separators=(',', ':')))
        
        return '\n'.join(lines) + '\n' if lines else ''


class IfcModel:
    def __init__(self):
        self.walls: List[IfcElement] = []
        self.windows: List[IfcElement] = []
        self.doors: List[IfcElement] = []
        self.floors: List[IfcElement] = []
        self.roofs: List[IfcElement] = []
        self.spaces: List[IfcElement] = []
        self.storeys: List[Dict[str, Any]] = []
        self.units: Dict[str, float] = {}


class IfcParser:
    """
    IFC to CSV converter with hybrid coordinate extraction system
    
    This parser converts IFC files to Vulcan's CSV template format, implementing
    a hybrid coordinate extraction approach that preserves internal face coordinates
    for walls (critical for HEM thermal modeling) while using universal coordinates
    for other elements to ensure consistency.
    """
    
    def __init__(self, audit_level: Optional[str] = None, audit_path: Optional[str] = None, use_internal_faces: bool = True, progress_callback=None, delayering_enabled: bool = True):
        """
        Initialize the IFC parser
        
        Args:
            audit_level: Audit logging level ('standard', 'verbose', or None)
            audit_path: Path for audit log output
            use_internal_faces: Whether to use internal face coordinates for walls (default: True)
            progress_callback: Optional callback function(status: str, current: int, total: int)
        """
        self.model = None
        self.initialized = False
        self.audit_collector = AuditCollector(audit_level, audit_path) if audit_level else None
        # unit conversion to meters (set in _extract_units)
        self.length_unit_factor: float = 0.001
        # Flag to preserve internal face measurements for HEM accuracy
        self.use_internal_faces: bool = use_internal_faces
        # Progress callback for browser mode
        self.progress_callback = progress_callback
        # Wall delayering flag (drop external layers of overlapping assemblies)
        self.delayering_enabled: bool = delayering_enabled
        
        # ============================================================================
        # TOLERANCE CONSTANTS (centralized)
        # ============================================================================
        self.tol_equal = 0.001  # meters - for exact coordinate matching
        self.tol_colinear = 1e-6  # normalized cross product threshold
        self.tol_span = 0.002  # meters - span extension for edge matching
        self.epsilon_step = 0.15  # meters - epsilon step for inside/outside test
        # Consolidation tolerances
        self.tol_height = 0.01  # meters - height matching for consolidation
        self.tol_merge = 0.02  # meters - gap tolerance for merging segments
        self.tol_overlap = 0.01  # meters - minimum overlap for adjacency

    # ============================================================================
    # GEOMETRY UTILITIES (consolidated helpers)
    # ============================================================================
    
    def _point_line_perp_distance(self, p: Tuple[float, float], a: Tuple[float, float], b: Tuple[float, float]) -> float:
        """Perpendicular distance from point p to infinite line through a and b."""
        ap = (p[0] - a[0], p[1] - a[1])
        ab = (b[0] - a[0], b[1] - a[1])
        ab_len = math.hypot(ab[0], ab[1])
        if ab_len == 0:
            return math.hypot(ap[0], ap[1])
        return abs(ap[0] * ab[1] - ap[1] * ab[0]) / ab_len
    
    def _point_to_segment_distance(self, p: Tuple[float, float], a: Tuple[float, float], b: Tuple[float, float]) -> float:
        """Distance from point p to line segment ab (closest point on segment)."""
        ab = (b[0] - a[0], b[1] - a[1])
        ap = (p[0] - a[0], p[1] - a[1])
        ab_len_sq = ab[0]*ab[0] + ab[1]*ab[1]
        if ab_len_sq == 0:
            return math.hypot(ap[0], ap[1])
        t = max(0.0, min(1.0, (ap[0]*ab[0] + ap[1]*ab[1]) / ab_len_sq))
        proj = (a[0] + t*ab[0], a[1] + t*ab[1])
        return math.hypot(p[0] - proj[0], p[1] - proj[1])
    
    def _on_segment_span(self, p: Tuple[float, float], a: Tuple[float, float], b: Tuple[float, float], tol: float) -> bool:
        """Check if point p is within the span of segment ab (with tolerance) along dominant axis."""
        if abs(a[0] - b[0]) >= abs(a[1] - b[1]):
            mn = min(a[0], b[0]) - tol
            mx = max(a[0], b[0]) + tol
            return mn <= p[0] <= mx
        else:
            mn = min(a[1], b[1]) - tol
            mx = max(a[1], b[1]) + tol
            return mn <= p[1] <= mx
    
    def _projection_overlap_1d(self, a0: float, a1: float, b0: float, b1: float) -> float:
        """Compute overlap length of two 1D intervals [a0,a1] and [b0,b1]."""
        lo = max(min(a0, a1), min(b0, b1))
        hi = min(max(a0, a1), max(b0, b1))
        return max(0.0, hi - lo)
    
    def _is_colinear(self, seg1: Tuple[Tuple[float, float], Tuple[float, float]], 
                     seg2: Tuple[Tuple[float, float], Tuple[float, float]], 
                     tol: float = None) -> bool:
        """Check if two segments are colinear (normalized cross product test)."""
        if tol is None:
            tol = self.tol_colinear
        a, b = seg1
        c, d = seg2
        u = (b[0] - a[0], b[1] - a[1])
        v = (d[0] - c[0], d[1] - c[1])
        u_len = math.hypot(u[0], u[1])
        v_len = math.hypot(v[0], v[1])
        if u_len == 0 or v_len == 0:
            return False
        cross = abs(u[0] * v[1] - u[1] * v[0]) / (u_len * v_len)
        return cross <= tol
    
    def _wall_midpoint(self, p0: Tuple[float, float, float], p1: Tuple[float, float, float]) -> Tuple[float, float]:
        """Return 2D midpoint of wall segment."""
        return ((p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0)
    
    def _polygon_centroid(self, poly: List[Tuple[float, float]]) -> Tuple[float, float]:
        """Compute centroid of polygon vertices."""
        n = len(poly)
        if n == 0:
            return (0.0, 0.0)
        cx_sum = sum(p[0] for p in poly)
        cy_sum = sum(p[1] for p in poly)
        return (cx_sum / n, cy_sum / n)
    
    def _remove_duplicate_coords_3d(self, coords: List[Tuple[float, float, float]], 
                                     tol: Optional[float] = None) -> List[Tuple[float, float, float]]:
        """Remove duplicate 3D coordinates within tolerance.
        
        Used for deduplicating vertices within a polygon (e.g., removing duplicate
        vertices from slab geometry before processing).
        """
        if tol is None:
            tol = self.tol_equal
        unique_coords = []
        for coord in coords:
            is_duplicate = False
            for unique_coord in unique_coords:
                if (abs(coord[0] - unique_coord[0]) < tol and 
                    abs(coord[1] - unique_coord[1]) < tol and 
                    abs(coord[2] - unique_coord[2]) < tol):
                    is_duplicate = True
                    break
            if not is_duplicate:
                unique_coords.append(coord)
        return unique_coords
    
    def _remove_duplicate_coords_2d(self, coords: List[Tuple[float, float, float]], 
                                     tol: Optional[float] = None) -> List[Tuple[float, float, float]]:
        """Remove duplicate 2D coordinates (X,Y only) within tolerance.
        
        Used for deduplicating corners after finding them (e.g., when rectangular
        boundary extraction finds overlapping corners).
        """
        if tol is None:
            tol = self.tol_equal
        unique_coords = []
        for coord in coords:
            is_duplicate = False
            for unique_coord in unique_coords:
                if (abs(coord[0] - unique_coord[0]) < tol and 
                    abs(coord[1] - unique_coord[1]) < tol):
                    is_duplicate = True
                    break
            if not is_duplicate:
                unique_coords.append(coord)
        return unique_coords
    
    def _find_corner(self, coords: List[Tuple[float, float, float]], 
                     target_x: float, target_y: float) -> Tuple[float, float, float]:
        """Find the coordinate closest to a target (x, y) position."""
        return min(coords, key=lambda c: 
                   ((c[0] - target_x)**2 + (c[1] - target_y)**2)**0.5)

    def _compute_bbox_spans(self, element) -> Optional[Tuple[float, float, float]]:
        """Return (x_span, y_span, z_span) in meters for an element; None if unavailable."""
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, element)
            if not shape:
                return None
            verts = shape.geometry.verts
            if not verts:
                return None
            xs = [verts[i] for i in range(0, len(verts), 3)]
            ys = [verts[i+1] for i in range(0, len(verts), 3)]
            zs = [verts[i+2] for i in range(0, len(verts), 3)]
            if not xs or not ys or not zs:
                return None
            return (max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs))
        except Exception:
            return None

    def _proxy_classification_preview(self) -> Dict[str, int]:
        """Classify IfcBuildingElementProxy elements via simple bbox heuristics (preview only)."""
        try:
            proxies = self.model.by_type('IfcBuildingElementProxy') or []
        except Exception:
            proxies = []
        counts = { 'wall_like': 0, 'floor_like': 0, 'roof_like': 0, 'unknown': 0, 'total_proxies': len(proxies) }
        if not proxies:
            return counts
        # Sample up to first 200 proxies for speed
        sample = proxies[:200]
        for p in sample:
            spans = self._compute_bbox_spans(p)
            if not spans:
                counts['unknown'] += 1
                continue
            xspan, yspan, zspan = spans
            plan_min = min(xspan, yspan)
            plan_max = max(xspan, yspan)
            plan_area = plan_max * plan_min
            # Heuristics
            if zspan >= 1.8 and plan_min <= 0.30 and plan_max >= 1.0:
                counts['wall_like'] += 1
            elif zspan <= 0.25 and plan_area >= 1.0:
                counts['floor_like'] += 1
            elif zspan <= 0.40 and plan_area >= 0.5 and 0.25 < zspan <= 0.40:
                counts['roof_like'] += 1
            else:
                counts['unknown'] += 1
        return counts

    # ===== Phase 3: Internal (negative spaces) pipeline helpers =====
    def _estimate_adaptive_wall_thresholds(self) -> Tuple[float, float, float]:
        """Derive (min_height, max_thickness, min_length) from proxy stats to adapt heuristics."""
        try:
            proxies = self.model.by_type('IfcBuildingElementProxy') or []
        except Exception:
            proxies = []
        heights = []
        plan_mins = []
        plan_maxs = []
        for p in proxies[:500]:
            spans = self._compute_bbox_spans(p)
            if not spans:
                continue
            xspan, yspan, zspan = spans
            heights.append(zspan)
            plan_mins.append(min(xspan, yspan))
            plan_maxs.append(max(xspan, yspan))
        # Defaults if insufficient data
        if len(heights) < 5:
            return (1.5, 0.5, 1.0)
        heights.sort(); plan_mins.sort(); plan_maxs.sort()
        def q(vals, r):
            idx = min(len(vals)-1, max(0, int(r*(len(vals)-1))))
            return vals[idx]
        min_height = max(1.5, q(heights, 0.6))  # 60th percentile or 1.5m
        max_thickness = max(0.25, q(plan_mins, 0.5))  # median min-plan as thickness cap
        min_length = max(1.0, q(plan_maxs, 0.5))  # median of max plan
        # Clamp sane bounds
        max_thickness = min(max_thickness, 0.7)
        return (min_height, max_thickness, min_length)

    def _has_dominant_vertical_faces(self, element, nz_tol: float = 0.2, min_ratio: float = 0.6) -> bool:
        """Check if a mesh has a dominant set of near-vertical faces (|nz| < nz_tol)."""
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, element)
            if not shape:
                return False
            verts = shape.geometry.verts
            faces = shape.geometry.faces
            if not verts or not faces:
                return False
            import math
            v = verts
            total = 0
            vertical = 0
            # faces is a flat list of indices; each triple forms a triangle
            for i in range(0, len(faces), 3):
                try:
                    i0 = faces[i] * 3; i1 = faces[i+1] * 3; i2 = faces[i+2] * 3
                    p0 = (v[i0], v[i0+1], v[i0+2])
                    p1 = (v[i1], v[i1+1], v[i1+2])
                    p2 = (v[i2], v[i2+1], v[i2+2])
                    ux, uy, uz = (p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2])
                    vx, vy, vz = (p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2])
                    # cross product u x v
                    nx = uy*vz - uz*vy
                    ny = uz*vx - ux*vz
                    nz = ux*vy - uy*vx
                    norm = math.sqrt(nx*nx + ny*ny + nz*nz)
                    if norm == 0:
                        continue
                    nz_unit = abs(nz / norm)
                    total += 1
                    if nz_unit < nz_tol:
                        vertical += 1
                except Exception:
                    continue
            if total == 0:
                return False
            return (vertical / total) >= min_ratio
        except Exception:
            return False
    def _extract_faces_from_element(self, element) -> List[Dict[str, Any]]:
        """Extract all faces from an element's geometry with computed normals.
        Returns list of face dicts: {'vertices': [(x,y,z), ...], 'normal': (nx,ny,nz), 'area': float}
        """
        faces = []
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, element)
            if not shape:
                return faces
            verts = shape.geometry.verts
            faces_indices = shape.geometry.faces
            if not verts or not faces_indices:
                return faces
            
            # Extract all triangular faces
            for i in range(0, len(faces_indices), 3):
                try:
                    idx0 = faces_indices[i] * 3
                    idx1 = faces_indices[i+1] * 3
                    idx2 = faces_indices[i+2] * 3
                    p0 = (verts[idx0], verts[idx0+1], verts[idx0+2])
                    p1 = (verts[idx1], verts[idx1+1], verts[idx1+2])
                    p2 = (verts[idx2], verts[idx2+1], verts[idx2+2])
                    # Compute face normal (u x v)
                    ux, uy, uz = p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]
                    vx, vy, vz = p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]
                    nx = uy*vz - uz*vy
                    ny = uz*vx - ux*vz
                    nz = ux*vy - uy*vx
                    norm = math.sqrt(nx*nx + ny*ny + nz*nz)
                    if norm < 1e-9:
                        continue
                    # Normalize
                    nx, ny, nz = nx/norm, ny/norm, nz/norm
                    # Compute area
                    area = 0.5 * norm
                    faces.append({
                        'vertices': [p0, p1, p2],
                        'normal': (nx, ny, nz),
                        'area': area,
                        'element': element
                    })
                except Exception:
                    continue
        except Exception:
            pass
        return faces

    def _classify_face(self, face: Dict[str, Any]) -> Optional[str]:
        """Classify a face by its normal direction.
        Returns 'wall', 'floor', 'ceiling', or None.
        """
        nx, ny, nz = face['normal']
        abs_nz = abs(nz)
        
        # Vertical face: normal is mostly horizontal (|nz| < 0.2)
        if abs_nz < 0.2:
            return 'wall'
        
        # Horizontal up-facing: nz > 0.7
        if nz > 0.7:
            return 'floor'
        
        # Horizontal down-facing: nz < -0.7
        if nz < -0.7:
            return 'ceiling'
        
        return None

    def _simplify_wall_face_to_line(self, face: Dict[str, Any]) -> Optional[Tuple[Tuple[float, float, float], Tuple[float, float, float]]]:
        """Simplify a vertical face to a two-point line segment.
        Uses the longest edge or projects to dominant axis.
        Returns ((x0,y0,z0), (x1,y1,z1)) or None.
        """
        vertices = face['vertices']
        if len(vertices) < 2:
            return None
        
        # For triangular faces, find the longest edge
        if len(vertices) == 3:
            edges = [
                (vertices[0], vertices[1]),
                (vertices[1], vertices[2]),
                (vertices[2], vertices[0])
            ]
            longest_edge = max(edges, key=lambda e: math.hypot(
                e[1][0]-e[0][0], e[1][1]-e[0][1], e[1][2]-e[0][2]
            ))
            # Use mid-Z for both points (average Z of the edge)
            z_mid = (longest_edge[0][2] + longest_edge[1][2]) / 2.0
            return (
                (longest_edge[0][0], longest_edge[0][1], z_mid),
                (longest_edge[1][0], longest_edge[1][1], z_mid)
            )
        
        # For polygon faces, find dominant axis and project
        xs = [v[0] for v in vertices]
        ys = [v[1] for v in vertices]
        zs = [v[2] for v in vertices]
        xspan = max(xs) - min(xs)
        yspan = max(ys) - min(ys)
        z_mid = sum(zs) / len(zs)
        
        if xspan >= yspan:
            # Dominant in X
            x1, x2 = min(xs), max(xs)
            y_mid = sum(ys) / len(ys)
            return ((x1, y_mid, z_mid), (x2, y_mid, z_mid))
        else:
            # Dominant in Y
            y1, y2 = min(ys), max(ys)
            x_mid = sum(xs) / len(xs)
            return ((x_mid, y1, z_mid), (x_mid, y2, z_mid))

    def _consolidate_colinear_segments(self, simplified_walls: List[Dict[str, Any]], 
                                        height_tol: float = None, colinear_tol: float = None,
                                        merge_tol: float = None, overlap_tol: float = None,
                                        use_all_pairs: bool = False, ignore_height: bool = False) -> List[Dict[str, Any]]:
        """Consolidate adjacent colinear wall segments with same height.
        
        Args:
            simplified_walls: List of wall dicts with 'line', 'face', 'element', 'floor_index', 'width'
            height_tol: Tolerance for height matching (meters, defaults to self.tol_height)
            colinear_tol: Distance to line for colinearity check (meters, defaults to self.tol_equal)
            merge_tol: Maximum gap between segments to merge (meters, defaults to self.tol_merge)
            overlap_tol: Minimum overlap to consider segments adjacent (meters, defaults to self.tol_overlap)
            
        Returns:
            Consolidated list of wall dicts with merged segments
        """
        # Use centralized tolerances if not specified
        if height_tol is None:
            height_tol = self.tol_height
        if colinear_tol is None:
            colinear_tol = self.tol_equal
        if merge_tol is None:
            merge_tol = self.tol_merge
        if overlap_tol is None:
            overlap_tol = self.tol_overlap
        
        if not simplified_walls:
            return []
        
        from collections import defaultdict
        
        # Step 1: Group segments by floor and height (unless ignore_height is True)
        # First, we need to extract height from faces
        if ignore_height:
            # Group only by floor, ignore height
            grouped_by_floor_height = defaultdict(list)
            for wall in simplified_walls:
                floor_index = wall['floor_index']
                key = (floor_index, 0.0)  # Use same height for all when ignoring
                grouped_by_floor_height[key].append(wall)
        else:
            grouped_by_floor_height = defaultdict(list)
            for wall in simplified_walls:
                floor_index = wall['floor_index']
                face = wall.get('face')
                # Extract height from face's vertical extent, or use stored height if available
                if face and 'vertices' in face:
                    face_zs = [v[2] for v in face['vertices']]
                    height = max(face_zs) - min(face_zs) if face_zs else 0.0
                elif 'height' in wall:
                    height = wall['height']
                else:
                    # Fallback: use a default height or extract from line segment Z coordinates
                    p0, p1 = wall['line']
                    height = abs(p1[2] - p0[2]) if len(p0) > 2 and len(p1) > 2 else 2.84  # Default 2.84m
                
                # Round height to nearest cm for grouping (within tolerance)
                height_rounded = round(height / height_tol) * height_tol
                key = (floor_index, height_rounded)
                grouped_by_floor_height[key].append(wall)
        
        consolidated = []
        consolidation_stats = defaultdict(lambda: {'before': 0, 'after': 0, 'merges': 0, 'merged_groups': []})
        
        # Step 2-4: Process each group
        for (floor_index, height), walls in grouped_by_floor_height.items():
            if len(walls) < 2:
                # No pairs possible, keep all
                consolidated.extend(walls)
                consolidation_stats[floor_index]['before'] += len(walls)
                consolidation_stats[floor_index]['after'] += len(walls)
                continue
            
            consolidation_stats[floor_index]['before'] += len(walls)
            
            # Build graph of colinear/adjacent segments
            # Choose algorithm: all-pairs (more thorough) or greedy (faster)
            if use_all_pairs:
                # All-pairs comparison: compare every segment with every other segment
                # Build adjacency graph first
                adjacency_graph = {}  # segment_index -> set of indices it can merge with
                pairs_compared = 0
                pairs_mergeable = 0
                
                # Initialize all indices first
                for i in range(len(walls)):
                    adjacency_graph[i] = set()
                
                for i in range(len(walls)):
                    for j in range(i + 1, len(walls)):
                        pairs_compared += 1
                        if self._can_merge_segments(walls[i], walls[j], colinear_tol, merge_tol, overlap_tol):
                            adjacency_graph[i].add(j)
                            adjacency_graph[j].add(i)
                            pairs_mergeable += 1
                
                # AUDIT: Log all-pairs comparison stats
                if self.audit_collector:
                    consolidation_stats[floor_index]['all_pairs_stats'] = {
                        'total_pairs_compared': pairs_compared,
                        'pairs_mergeable': pairs_mergeable,
                        'adjacency_graph_size': sum(len(adj) for adj in adjacency_graph.values()) // 2
                    }
                
                # Use union-find to group connected segments
                parent = list(range(len(walls)))
                
                def find(x):
                    if parent[x] != x:
                        parent[x] = find(parent[x])  # Path compression
                    return parent[x]
                
                def union(x, y):
                    px, py = find(x), find(y)
                    if px != py:
                        parent[px] = py
                
                # Union all connected segments
                for i in range(len(walls)):
                    for j in adjacency_graph[i]:
                        union(i, j)
                
                # Group segments by their root parent
                groups = defaultdict(list)
                for i in range(len(walls)):
                    root = find(i)
                    groups[root].append(i)
                
                # Merge each group
                for group_indices in groups.values():
                    if len(group_indices) == 1:
                        consolidated.append(walls[group_indices[0]])
                    else:
                        merge_group = [walls[i] for i in group_indices]
                        merged_segment = self._merge_segment_group(merge_group)
                        consolidated.append(merged_segment)
                        consolidation_stats[floor_index]['merges'] += len(group_indices) - 1
                        consolidation_stats[floor_index]['merged_groups'].append({
                            'segments_count': len(group_indices),
                            'merged_width': merged_segment['width']
                        })
            else:
                # Original greedy algorithm
                processed = set()
                merged_groups = []
                
                # DEBUG: Track comparisons for audit
                comparison_log = []
                missed_pairs = []  # Pairs that should merge but weren't compared correctly
                
                for i in range(len(walls)):
                    if i in processed:
                        continue
                    
                    # Start a new merge group
                    merge_group = [walls[i]]
                    processed.add(i)
                    
                    # Try to find all segments that can merge with this one
                    changed = True
                    iteration = 0
                    while changed:
                        changed = False
                        iteration += 1
                        for j in range(len(walls)):
                            if j in processed:
                                continue
                            
                            w1 = merge_group[0]  # Compare with first segment in group
                            w2 = walls[j]
                            
                            # Check if w2 can merge with any segment in merge_group
                            can_merge = False
                            merge_reason = None
                            for w in merge_group:
                                if self._can_merge_segments(w, w2, colinear_tol, merge_tol, overlap_tol):
                                    can_merge = True
                                    merge_reason = 'direct_match'
                                    break
                            
                            # CRITICAL FIX: Also check if w2 can merge with the merged extent of the group
                            # (not just individual segments) - this handles cases where segments overlap
                            # with the group's combined extent
                            if not can_merge and len(merge_group) > 1:
                                # Create a temporary merged segment from the group
                                temp_merged = self._merge_segment_group(merge_group)
                                if self._can_merge_segments(temp_merged, w2, colinear_tol, merge_tol, overlap_tol):
                                    can_merge = True
                                    merge_reason = 'merged_extent_match'
                            
                            # AUDIT: Log the comparison
                            if self.audit_collector:
                                comparison_log.append({
                                    'iteration': iteration,
                                    'group_size': len(merge_group),
                                    'compared_i': i,
                                    'compared_j': j,
                                    'can_merge': can_merge,
                                    'reason': merge_reason,
                                    'w1_coords': w1['line'],
                                    'w2_coords': w2['line']
                                })
                            
                            # AUDIT: Check if this pair should merge but didn't
                            # (This helps identify false negatives)
                            if not can_merge:
                                # Double-check: should these merge?
                                if self._can_merge_segments(w1, w2, colinear_tol, merge_tol, overlap_tol):
                                    # This shouldn't happen - indicates a bug in the algorithm
                                    missed_pairs.append({
                                        'iteration': iteration,
                                        'group_size': len(merge_group),
                                        'i': i,
                                        'j': j,
                                        'w1_coords': w1['line'],
                                        'w2_coords': w2['line'],
                                        'reason': 'should_merge_but_didnt'
                                    })
                            
                            if can_merge:
                                merge_group.append(w2)
                                processed.add(j)
                                changed = True
                    
                    # Merge the group into a single segment
                    if len(merge_group) > 1:
                        merged_segment = self._merge_segment_group(merge_group)
                        consolidated.append(merged_segment)
                        consolidation_stats[floor_index]['merges'] += len(merge_group) - 1
                        consolidation_stats[floor_index]['merged_groups'].append({
                            'segments_count': len(merge_group),
                            'merged_width': merged_segment['width']
                        })
                    else:
                        consolidated.append(merge_group[0])
                
                # Store comparison log and missed pairs for audit (verbose only)
                if self.audit_collector and self.audit_collector.level == 'verbose':
                    consolidation_stats[floor_index]['comparison_log'] = comparison_log[:100]  # Limit size
                    if missed_pairs:
                        consolidation_stats[floor_index]['missed_pairs'] = missed_pairs[:20]  # Limit size
            
            # Count after: number of consolidated segments for this floor
            # (will be recalculated below, but initialize here)
            consolidation_stats[floor_index]['after'] = 0
        
        # Recalculate after counts properly (count consolidated walls per floor)
        for floor_index in consolidation_stats:
            consolidation_stats[floor_index]['after'] = sum(1 for w in consolidated if w.get('floor_index') == floor_index)
        
        # Audit consolidation
        if self.audit_collector:
            try:
                for floor_index, stats in consolidation_stats.items():
                    if stats['merges'] > 0:
                        audit_record = {
                            'type': 'ColinearConsolidation',
                            'floor_index': floor_index,
                            'segments_before': stats['before'],
                            'segments_after': stats['after'],
                            'merges_performed': stats['merges'],
                            'merged_groups': stats['merged_groups'][:20]  # Limit for audit size
                        }
                        # Include detailed logs only in verbose mode
                        if self.audit_collector.level == 'verbose':
                            if 'comparison_log' in stats:
                                audit_record['comparison_log_sample'] = stats['comparison_log']
                            if 'missed_pairs' in stats:
                                audit_record['missed_pairs'] = stats['missed_pairs']
                            if 'all_pairs_stats' in stats:
                                audit_record['all_pairs_stats'] = stats['all_pairs_stats']
                        self.audit_collector.records.append(audit_record)
            except Exception:
                pass
        
        return consolidated
    
    def _can_merge_segments(self, w1: Dict[str, Any], w2: Dict[str, Any],
                            colinear_tol: float, merge_tol: float, overlap_tol: float) -> bool:
        """Check if two segments can be merged (colinear and adjacent/overlapping).
        
        Args:
            w1, w2: Wall dicts with 'line' key
            colinear_tol: Distance to line for colinearity check
            merge_tol: Maximum gap between segments
            overlap_tol: Minimum overlap to consider adjacent
            
        Returns:
            True if segments can be merged
        """
        p1_0, p1_1 = w1['line']
        p2_0, p2_1 = w2['line']
        
        # Check for exact duplicates (same endpoints, same or reversed order)
        if ((abs(p1_0[0] - p2_0[0]) < 1e-6 and abs(p1_0[1] - p2_0[1]) < 1e-6 and
             abs(p1_1[0] - p2_1[0]) < 1e-6 and abs(p1_1[1] - p2_1[1]) < 1e-6) or
            (abs(p1_0[0] - p2_1[0]) < 1e-6 and abs(p1_0[1] - p2_1[1]) < 1e-6 and
             abs(p1_1[0] - p2_0[0]) < 1e-6 and abs(p1_1[1] - p2_0[1]) < 1e-6)):
            return True  # Exact duplicate or reversed duplicate
        
        # Compute direction vectors
        dx1 = p1_1[0] - p1_0[0]
        dy1 = p1_1[1] - p1_0[1]
        len1 = math.hypot(dx1, dy1)
        if len1 < 1e-9:
            return False
        
        dx2 = p2_1[0] - p2_0[0]
        dy2 = p2_1[1] - p2_0[1]
        len2 = math.hypot(dx2, dy2)
        if len2 < 1e-9:
            return False
        
        # Normalize direction vectors
        dx1_norm, dy1_norm = dx1 / len1, dy1 / len1
        dx2_norm, dy2_norm = dx2 / len2, dy2 / len2
        
        # Check if parallel (same direction) or anti-parallel (opposite direction)
        dot = dx1_norm * dx2_norm + dy1_norm * dy2_norm
        is_parallel = abs(dot) > 0.999  # Within ~0.5°
        
        if not is_parallel:
            return False
        
        # If anti-parallel, reverse one segment for comparison
        if dot < 0:
            p2_0, p2_1 = p2_1, p2_0
            dx2 = p2_1[0] - p2_0[0]
            dy2 = p2_1[1] - p2_0[1]
            dx2_norm, dy2_norm = dx2 / len2, dy2 / len2
        
        # Check if segments are on same line (distance from endpoint to line < colinear_tol)
        dist_p2_0_to_line1 = self._point_line_perp_distance((p2_0[0], p2_0[1]), p1_0, p1_1)
        dist_p2_1_to_line1 = self._point_line_perp_distance((p2_1[0], p2_1[1]), p1_0, p1_1)
        
        if dist_p2_0_to_line1 > colinear_tol or dist_p2_1_to_line1 > colinear_tol:
            return False
        
        # Check adjacency/overlap by projecting to dominant axis
        if abs(dx1) >= abs(dy1):
            overlap_length = self._projection_overlap_1d(p1_0[0], p1_1[0], p2_0[0], p2_1[0])
            a_min, a_max = min(p1_0[0], p1_1[0]), max(p1_0[0], p1_1[0])
            b_min, b_max = min(p2_0[0], p2_1[0]), max(p2_0[0], p2_1[0])
        else:
            overlap_length = self._projection_overlap_1d(p1_0[1], p1_1[1], p2_0[1], p2_1[1])
            a_min, a_max = min(p1_0[1], p1_1[1]), max(p1_0[1], p1_1[1])
            b_min, b_max = min(p2_0[1], p2_1[1]), max(p2_0[1], p2_1[1])
        
        # Check gap (distance between segments if not overlapping)
        gap = max(a_min, b_min) - min(a_max, b_max)
        if gap < 0:
            gap = 0  # Overlapping, no gap
        
        # CRITICAL FIX: Also check if segments are adjacent (endpoints close)
        # Even if no overlap, if endpoints are within merge_tol, they should merge
        endpoint_distances = [
            math.hypot(p1_0[0] - p2_0[0], p1_0[1] - p2_0[1]),
            math.hypot(p1_0[0] - p2_1[0], p1_0[1] - p2_1[1]),
            math.hypot(p1_1[0] - p2_0[0], p1_1[1] - p2_0[1]),
            math.hypot(p1_1[0] - p2_1[0], p1_1[1] - p2_1[1])
        ]
        min_endpoint_dist = min(endpoint_distances)
        
        # CRITICAL FIX: For overlapping subsets, check if one segment is contained within the other
        # If segment b is completely contained in segment a (or vice versa), they should merge
        b_contained_in_a = (b_min >= a_min - merge_tol and b_max <= a_max + merge_tol)
        a_contained_in_b = (a_min >= b_min - merge_tol and a_max <= b_max + merge_tol)
        
        if (overlap_length > overlap_tol or gap < merge_tol or min_endpoint_dist < merge_tol or 
            b_contained_in_a or a_contained_in_b):
            return True
        
        return False
    
    def _merge_segment_group(self, merge_group: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge a group of colinear segments into a single segment.
        
        Args:
            merge_group: List of wall dicts to merge
            
        Returns:
            Single merged wall dict
        """
        if len(merge_group) == 1:
            return merge_group[0]
        
        # Collect all endpoints
        all_points = []
        for wall in merge_group:
            p0, p1 = wall['line']
            all_points.append(p0)
            all_points.append(p1)
        
        # Find dominant direction from first segment
        p0_first, p1_first = merge_group[0]['line']
        dx = p1_first[0] - p0_first[0]
        dy = p1_first[1] - p0_first[1]
        
        # Project all points to the line direction
        if abs(dx) >= abs(dy):
            # X-dominant
            projections = [(p[0], i) for i, p in enumerate(all_points)]
            projections.sort()
            min_point = all_points[projections[0][1]]
            max_point = all_points[projections[-1][1]]
        else:
            # Y-dominant
            projections = [(p[1], i) for i, p in enumerate(all_points)]
            projections.sort()
            min_point = all_points[projections[0][1]]
            max_point = all_points[projections[-1][1]]
        
        # Ensure min_point comes before max_point along the line direction
        # Compute which endpoint is "first" along the direction
        vec_to_min = (min_point[0] - p0_first[0], min_point[1] - p0_first[1])
        vec_to_max = (max_point[0] - p0_first[0], max_point[1] - p0_first[1])
        
        dot_min = vec_to_min[0] * dx + vec_to_min[1] * dy
        dot_max = vec_to_max[0] * dx + vec_to_max[1] * dy
        
        if dot_min > dot_max:
            # Swap so min_point is first along direction
            min_point, max_point = max_point, min_point
        
        # Create merged segment
        merged_line = (min_point, max_point)
        merged_width = math.hypot(max_point[0] - min_point[0], max_point[1] - min_point[1])
        
        # Use first wall's metadata (or combine)
        merged_wall = merge_group[0].copy()
        merged_wall['line'] = merged_line
        merged_wall['width'] = merged_width
        
        # CRITICAL FIX: Merge all faces' vertices to preserve correct Z-extent
        # When multiple segments are merged, we need to combine their face vertices
        # so the Z span (height_z_min/max) is computed correctly
        all_face_vertices = []
        if 'face' in merged_wall and merged_wall['face'] and 'vertices' in merged_wall['face']:
            all_face_vertices.extend(merged_wall['face']['vertices'])
        
        # Collect vertices from all merged segments
        for wall in merge_group[1:]:
            if 'face' in wall and wall['face'] and 'vertices' in wall['face']:
                all_face_vertices.extend(wall['face']['vertices'])
        
        # Update the merged face with combined vertices
        if all_face_vertices and 'face' in merged_wall:
            merged_wall['face'] = merged_wall['face'].copy()
            merged_wall['face']['vertices'] = all_face_vertices
        
        return merged_wall

    def _cluster_faces_by_storey(self, faces: List[Dict[str, Any]], storeys: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        """Group faces by storey based on Z position.
        Returns dict: {floor_index: [faces]}
        """
        if not storeys:
            # No storeys: assign all to floor 0
            return {0: faces}
        
        # Get storey Z bands
        storey_z_bands = []
        for s in storeys:
            elevation = s.get('elevation', 0.0)
            storey_z_bands.append((elevation, s.get('floor_index', 0)))
        storey_z_bands.sort(key=lambda x: x[0])
        
        # Assign faces to storeys
        floor_to_faces: Dict[int, List[Dict[str, Any]]] = {}
        for face in faces:
            # Use centroid Z of face
            zs = [v[2] for v in face['vertices']]
            z_centroid = sum(zs) / len(zs)
            
            # Find nearest storey
            floor_index = 0
            min_dist = float('inf')
            for elev, fidx in storey_z_bands:
                dist = abs(z_centroid - elev)
                if dist < min_dist:
                    min_dist = dist
                    floor_index = fidx
            
            floor_to_faces.setdefault(floor_index, []).append(face)
        
        return floor_to_faces

    # ===== Consolidated Orientation Helpers (All Modes) =====
    
    def _point_in_polygon(self, px: float, py: float, poly: List[Tuple[float, float]]) -> bool:
        """Point-in-polygon test using ray casting. Returns True if inside or on edge.
        
        Args:
            px, py: Point coordinates
            poly: List of (x, y) tuples forming a closed polygon
            
        Returns:
            True if point is inside polygon or on edge, False otherwise
        """
        n = len(poly)
        if n == 0:
            return True
        inside = False
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i+1) % n]
            # Check if point is on edge (within tolerance)
            if min(x1, x2) - 1e-9 <= px <= max(x1, x2) + 1e-9 and min(y1, y2) - 1e-9 <= py <= max(y1, y2) + 1e-9:
                # Colinear check
                dx, dy = (x2 - x1), (y2 - y1)
                if abs(dx * (py - y1) - dy * (px - x1)) <= 1e-9:
                    return True  # On edge = inside
            # Ray casting: check for crossings
            if ((y1 > py) != (y2 > py)):
                xin = x1 + (py - y1) * (x2 - x1) / (y2 - y1 + 1e-18)
                if px <= xin:
                    inside = not inside
        return inside
    
    def _build_floor_polygon_index(self, model: IfcModel) -> Dict[int, List[Tuple[List[Tuple[float, float]], str]]]:
        """Build an index of floor polygons by floor_index, including polygon names.
        
        Args:
            model: IfcModel with floors already extracted
            
        Returns:
            Dict mapping floor_index -> list of (polygon, floor_name) tuples
            Each polygon is a list of (x, y) tuples
        """
        index = {}
        for floor in model.floors:
            if not floor.coordinates or len(floor.coordinates) < 3:
                continue
            # Get floor_index from storey
            floor_index = 0
            if floor.storey:
                try:
                    floor_index = int(floor.storey.get('floor_index', 0))
                except (ValueError, AttributeError):
                    floor_index = 0
            # Convert 3D coordinates to 2D (x, y) for polygon test
            poly_2d = [(v[0], v[1]) for v in floor.coordinates]
            floor_name = floor.name or f"Floor_{floor_index}"
            if floor_index not in index:
                index[floor_index] = []
            index[floor_index].append((poly_2d, floor_name))
        return index
    
    def _find_adjacent_floor_polygons(self, wall_p0: Tuple[float, float, float], wall_p1: Tuple[float, float, float], 
                                       floor_index: int, floor_polygons: Dict[int, List[Tuple[List[Tuple[float, float]], str]]],
                                       tol: float = 0.01) -> tuple:
        """Find floor polygons near this wall and detect STRICT Full-2V edge sharing.

        STRICT definition (Full-2V only): both wall endpoints lie on the SAME polygon edge within a
        very tight perpendicular tolerance (equal_tol = 0.001 m), and projections overlap along the
        dominant axis. Everything else is NOT considered edge sharing.

        Args:
            wall_p0, wall_p1: Wall segment endpoints (x, y, z)
            floor_index: Floor index for this wall
            floor_polygons: Dict mapping floor_index -> list of (polygon, floor_name) tuples
            tol: General tolerance for adjacency checks (meters)

        Returns:
            Tuple of (all_adjacent_polygons, edge_sharing_polygons, edge_sharing_details)
            - all_adjacent_polygons: List of (polygon, floor_name) tuples (midpoint-inside or near) – used for epsilon fallback
            - edge_sharing_polygons: STRICT Full-2V only
            - edge_sharing_details: Details for STRICT matches
        """
        all_adjacent = []
        edge_sharing = []
        edge_sharing_details = []  # STRICT Full-2V only
        wx0, wy0 = wall_p0[0], wall_p0[1]
        wx1, wy1 = wall_p1[0], wall_p1[1]
        mx, my = self._wall_midpoint(wall_p0, wall_p1)
        
        # Wall direction vector
        wall_dx = wx1 - wx0
        wall_dy = wy1 - wy0
        wall_len = math.hypot(wall_dx, wall_dy)
        
        # Check ALL floor_indexes (walls can share edges with polygons on any floor level)
        for fidx in floor_polygons.keys():
            for poly_tuple in floor_polygons[fidx]:
                poly, floor_name = poly_tuple
                # Track midpoint-inside for epsilon fallback adjacency
                if self._point_in_polygon(mx, my, poly):
                    all_adjacent.append((poly, floor_name))

                # STRICT Full-2V detection: both polygon edge vertices lie on wall line
                best_edge_distance = float('inf')
                best_edge_info = None
                matched = False
                for i in range(len(poly)):
                    px1, py1 = poly[i]
                    px2, py2 = poly[(i+1) % len(poly)]
                    edge_len = math.hypot(px2 - px1, py2 - py1)
                    if edge_len <= 1e-12:
                        continue
                    
                    # Colinearity test: check if polygon edge is colinear with wall
                    edge_vec = (px2 - px1, py2 - py1)
                    if not self._is_colinear(((wx0, wy0), (wx1, wy1)), ((px1, py1), (px2, py2))):
                        continue
                    
                    # Overlap on dominant axis
                    if abs(wall_dx) >= abs(wall_dy):
                        overlap = self._projection_overlap_1d(wx0, wx1, px1, px2)
                    else:
                        overlap = self._projection_overlap_1d(wy0, wy1, py1, py2)
                    if overlap <= 0.0:
                        continue
                    
                    # Full-2V: both polygon edge vertices lie on wall line within tol_equal
                    d_a = self._point_line_perp_distance((px1, py1), (wx0, wy0), (wx1, wy1))
                    d_b = self._point_line_perp_distance((px2, py2), (wx0, wy0), (wx1, wy1))
                    
                    if d_a <= self.tol_equal and d_b <= self.tol_equal and \
                       self._on_segment_span((px1, py1), (wx0, wy0), (wx1, wy1), self.tol_span) and \
                       self._on_segment_span((px2, py2), (wx0, wy0), (wx1, wy1), self.tol_span):
                        matched = True
                        # Edge distance: max perpendicular distance from wall endpoints to polygon edge
                        edge_distance = max(
                            self._point_to_segment_distance((wx0, wy0), (px1, py1), (px2, py2)),
                            self._point_to_segment_distance((wx1, wy1), (px1, py1), (px2, py2))
                        )
                        if edge_distance < best_edge_distance:
                            best_edge_distance = edge_distance
                            best_edge_info = {
                                'edge_index': i,
                                'max_perp_dist': max(d_a, d_b),
                                'edge_distance': edge_distance,
                                'overlap_length': overlap
                            }
                if matched:
                    edge_sharing.append((poly, floor_name))
                    edge_sharing_details.append({
                        'floor_name': floor_name,
                        'match_type': 'full2v_strict',
                        'edge_distance': best_edge_distance if best_edge_info else 0.0,
                        'edge_info': best_edge_info
                    })
        
        # Sort STRICT matches by edge_distance (best first)
        if edge_sharing and edge_sharing_details:
            detail_map = {d['floor_name']: d for d in edge_sharing_details}
            edge_sharing.sort(key=lambda p: detail_map.get(p[1], {}).get('edge_distance', float('inf')))
            edge_sharing_details.sort(key=lambda d: d.get('edge_distance', float('inf')))

        return (all_adjacent, edge_sharing, edge_sharing_details)
    
    def _epsilon_inside_outside_test(self, wall_p0: Tuple[float, float, float], wall_p1: Tuple[float, float, float],
                                     adjacent_polygons: List[List[Tuple[float, float]]],
                                     epsilon: float = None) -> Dict[str, Any]:
        """Perform epsilon step test to determine inside/outside.
        
        Args:
            wall_p0, wall_p1: Wall segment endpoints
            adjacent_polygons: List of polygons to test against
            epsilon: Step distance for epsilon test (meters, defaults to self.epsilon_step)
            
        Returns:
            Dict with 'pos_inside', 'neg_inside', 'decision' ('+normal', '-normal', 'ambiguous')
        """
        if epsilon is None:
            epsilon = self.epsilon_step
        # Compute wall midpoint
        mx, my = self._wall_midpoint(wall_p0, wall_p1)
        
        # Compute wall direction vector
        dx = wall_p1[0] - wall_p0[0]
        dy = wall_p1[1] - wall_p0[1]
        norm = math.hypot(dx, dy)
        
        if norm < 1e-9:
            return {'pos_inside': False, 'neg_inside': False, 'decision': 'ambiguous', 'reason': 'degenerate_wall'}
        
        # Normalize direction
        dx_norm = dx / norm
        dy_norm = dy / norm
        
        # Compute perpendicular normals (±90° from wall direction)
        # +normal: counter-clockwise (-dy, dx)
        nx_pos, ny_pos = -dy_norm, dx_norm
        # -normal: clockwise (dy, -dx)
        nx_neg, ny_neg = dy_norm, -dx_norm
        
        # Epsilon step points
        eps_pos_x = mx + nx_pos * epsilon
        eps_pos_y = my + ny_pos * epsilon
        eps_neg_x = mx + nx_neg * epsilon
        eps_neg_y = my + ny_neg * epsilon
        
        # Test point-in-polygon for each epsilon point
        pos_inside = False
        neg_inside = False
        pos_poly_count = 0  # Count how many polygons contain pos epsilon
        neg_poly_count = 0  # Count how many polygons contain neg epsilon
        
        for poly in adjacent_polygons:
            if self._point_in_polygon(eps_pos_x, eps_pos_y, poly):
                pos_inside = True
                pos_poly_count += 1
            if self._point_in_polygon(eps_neg_x, eps_neg_y, poly):
                neg_inside = True
                neg_poly_count += 1
        
        # Decision logic
        # Polygons represent INTERIOR space (floor segments)
        # If pos_inside=true, then +normal points INTO polygon (inward, into interior)
        # If neg_inside=true, then -normal points INTO polygon (inward, into interior)
        # We want outward-facing, so choose the normal that points OUT OF polygon (away from interior)
        # CRITICAL FIX: After choosing outward-facing normal, we'll flip orientation360 by 180°
        # because the normal points AWAY from interior, but we need it to point AWAY from wall surface
        
        # Case 1: One side clearly inside, one clearly outside
        if pos_inside and not neg_inside:
            return {'pos_inside': True, 'neg_inside': False, 'decision': '-normal', 'reason': 'pos_inside_neg_outside'}
        elif neg_inside and not pos_inside:
            return {'pos_inside': False, 'neg_inside': True, 'decision': '+normal', 'reason': 'neg_inside_pos_outside'}
        elif pos_inside and neg_inside:
            # Both inside: wall is on boundary or inside large polygon
            # Strategy 1: Use the side with FEWER polygons as outward (more polygons = deeper into interior)
            if pos_poly_count < neg_poly_count:
                return {'pos_inside': True, 'neg_inside': True, 'decision': '+normal', 'reason': 'both_inside_pos_fewer_polygons'}
            elif neg_poly_count < pos_poly_count:
                return {'pos_inside': True, 'neg_inside': True, 'decision': '-normal', 'reason': 'both_inside_neg_fewer_polygons'}
            else:
                # Same number of polygons - use distance to polygon centroids
                # Closer centroid = more adjacent = interior side
                pos_dist_sum = 0.0
                neg_dist_sum = 0.0
                pos_poly_with_dist = 0
                neg_poly_with_dist = 0
                
                for poly in adjacent_polygons:
                    # Compute polygon centroid
                    cx, cy = self._polygon_centroid(poly)
                    
                    # Check which epsilon point is inside this polygon
                    pos_in = self._point_in_polygon(eps_pos_x, eps_pos_y, poly)
                    neg_in = self._point_in_polygon(eps_neg_x, eps_neg_y, poly)
                    
                    if pos_in:
                        dist = math.hypot(eps_pos_x - cx, eps_pos_y - cy)
                        pos_dist_sum += dist
                        pos_poly_with_dist += 1
                    if neg_in:
                        dist = math.hypot(eps_neg_x - cx, eps_neg_y - cy)
                        neg_dist_sum += dist
                        neg_poly_with_dist += 1
                
                # Compare average distances - closer = interior side
                if pos_poly_with_dist > 0 and neg_poly_with_dist > 0:
                    pos_avg_dist = pos_dist_sum / pos_poly_with_dist
                    neg_avg_dist = neg_dist_sum / neg_poly_with_dist
                    if pos_avg_dist < neg_avg_dist:
                        # Pos side is closer = interior = choose neg (outward)
                        return {'pos_inside': True, 'neg_inside': True, 'decision': '-normal', 'reason': 'both_inside_neg_closer_to_centroids', 'pos_avg_dist': pos_avg_dist, 'neg_avg_dist': neg_avg_dist}
                    elif neg_avg_dist < pos_avg_dist:
                        # Neg side is closer = interior = choose pos (outward)
                        return {'pos_inside': True, 'neg_inside': True, 'decision': '+normal', 'reason': 'both_inside_pos_closer_to_centroids', 'pos_avg_dist': pos_avg_dist, 'neg_avg_dist': neg_avg_dist}
                
                # Still ambiguous - use fallback
                return {'pos_inside': pos_inside, 'neg_inside': neg_inside, 'decision': 'ambiguous', 'reason': 'both_inside_same_polygon_count_and_distance'}
        else:
            # Neither inside - wall is outside all polygons (edge case)
            return {'pos_inside': False, 'neg_inside': False, 'decision': 'ambiguous', 'reason': 'neither_inside'}
    
    def _free_space_fallback(self, wall_p0: Tuple[float, float, float], wall_p1: Tuple[float, float, float],
                              floor_index: int, all_walls: List[Any], epsilon: float = 0.15,
                              sample_dist: float = 0.5, neighbor_radius: float = 0.2) -> str:
        """Free-space density fallback: choose direction with fewer neighbors.
        
        Args:
            wall_p0, wall_p1: Wall segment endpoints
            floor_index: Floor index
            all_walls: List of all wall elements (for neighbor counting)
            epsilon: Epsilon for normal computation
            sample_dist: Distance to sample along normal
            neighbor_radius: Radius for neighbor counting
            
        Returns:
            '+normal' or '-normal' based on fewer neighbors
        """
        mx, my = self._wall_midpoint(wall_p0, wall_p1)
        
        dx = wall_p1[0] - wall_p0[0]
        dy = wall_p1[1] - wall_p0[1]
        norm = math.hypot(dx, dy)
        if norm < 1e-9:
            return '+normal'
        
        dx_norm = dx / norm
        dy_norm = dy / norm
        nx_pos, ny_pos = -dy_norm, dx_norm
        nx_neg, ny_neg = dy_norm, -dx_norm
        
        # Sample points along each normal
        px_pos = mx + nx_pos * sample_dist
        py_pos = my + ny_pos * sample_dist
        px_neg = mx + nx_neg * sample_dist
        py_neg = my + ny_neg * sample_dist
        
        # Count neighbors
        count_pos = 0
        count_neg = 0
        radius2 = neighbor_radius * neighbor_radius
        
        for w in all_walls:
            if not w.coordinates or len(w.coordinates) < 2:
                continue
            # Check if wall is on same floor
            w_floor_index = 0
            if w.storey:
                try:
                    w_floor_index = int(w.storey.get('floor_index', 0))
                except (ValueError, AttributeError):
                    pass
            if w_floor_index != floor_index:
                continue
            
            ax, ay, _ = w.coordinates[0]
            bx, by, _ = w.coordinates[1]
            vx, vy = (bx - ax), (by - ay)
            vlen2 = vx * vx + vy * vy
            if vlen2 <= 1e-9:
                continue
            
            # Check distance to +normal sample point
            t = ((px_pos - ax) * vx + (py_pos - ay) * vy) / vlen2
            t = max(0.0, min(1.0, t))
            cx, cy = ax + t * vx, ay + t * vy
            dx_test, dy_test = px_pos - cx, py_pos - cy
            if dx_test * dx_test + dy_test * dy_test <= radius2:
                count_pos += 1
            
            # Check distance to -normal sample point
            t = ((px_neg - ax) * vx + (py_neg - ay) * vy) / vlen2
            t = max(0.0, min(1.0, t))
            cx, cy = ax + t * vx, ay + t * vy
            dx_test, dy_test = px_neg - cx, py_neg - cy
            if dx_test * dx_test + dy_test * dy_test <= radius2:
                count_neg += 1
        
        # Fewer neighbors = outward (away from building interior)
        # If count_pos < count_neg: pos side has fewer neighbors → outward direction
        # So we want +normal (pointing in pos direction = outward)
        # If count_neg < count_pos: neg side has fewer neighbors → outward direction  
        # So we want -normal (pointing in neg direction = outward)
        return '+normal' if count_pos < count_neg else '-normal'
    
    def _hull_fallback(self, wall_p0: Tuple[float, float, float], wall_p1: Tuple[float, float, float],
                       floor_index: int, floor_polygons: Dict[int, List[List[Tuple[float, float]]]],
                       epsilon: float = 0.15) -> str:
        """Hull/AABB fallback: build convex hull and test which epsilon is outside.
        
        Args:
            wall_p0, wall_p1: Wall segment endpoints
            floor_index: Floor index
            floor_polygons: Floor polygon index
            epsilon: Epsilon for normal computation
            
        Returns:
            '+normal' or '-normal' based on which is outside hull
        """
        if floor_index not in floor_polygons or not floor_polygons[floor_index]:
            return '+normal'
        
        # Collect all points from polygons on this floor
        all_points = []
        for poly_tuple in floor_polygons[floor_index]:
            poly, _ = poly_tuple
            all_points.extend(poly)
        
        if len(all_points) < 3:
            return '+normal'
        
        # Build convex hull (simple approach: use AABB for speed)
        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        
        # Expand AABB slightly
        margin = epsilon * 2
        hull_poly = [
            (x_min - margin, y_min - margin),
            (x_max + margin, y_min - margin),
            (x_max + margin, y_max + margin),
            (x_min - margin, y_max + margin)
        ]
        
        mx, my = self._wall_midpoint(wall_p0, wall_p1)
        
        dx = wall_p1[0] - wall_p0[0]
        dy = wall_p1[1] - wall_p0[1]
        norm = math.hypot(dx, dy)
        if norm < 1e-9:
            return '+normal'
        
        dx_norm = dx / norm
        dy_norm = dy / norm
        nx_pos, ny_pos = -dy_norm, dx_norm
        nx_neg, ny_neg = dy_norm, -dx_norm
        
        eps_pos_x = mx + nx_pos * epsilon
        eps_pos_y = my + ny_pos * epsilon
        eps_neg_x = mx + nx_neg * epsilon
        eps_neg_y = my + ny_neg * epsilon
        
        pos_outside = not self._point_in_polygon(eps_pos_x, eps_pos_y, hull_poly)
        neg_outside = not self._point_in_polygon(eps_neg_x, eps_neg_y, hull_poly)
        
        if pos_outside and not neg_outside:
            return '+normal'
        elif neg_outside and not pos_outside:
            return '-normal'
        else:
            return '+normal'  # Default
    
    def _centroid_fallback(self, wall_p0: Tuple[float, float, float], wall_p1: Tuple[float, float, float],
                           adjacent_polygons: List[List[Tuple[float, float]]]) -> str:
        """Centroid fallback: choose normal pointing away from polygon centroid.
        
        Args:
            wall_p0, wall_p1: Wall segment endpoints
            adjacent_polygons: List of adjacent polygons
            
        Returns:
            '+normal' or '-normal' based on direction away from centroid
        """
        if not adjacent_polygons:
            return '+normal'
        
        # Compute centroid of all adjacent polygons
        cx_sum = cy_sum = 0.0
        point_count = 0
        for poly in adjacent_polygons:
            for px, py in poly:
                cx_sum += px
                cy_sum += py
                point_count += 1
        
        if point_count == 0:
            return '+normal'
        
        cx = cx_sum / point_count
        cy = cy_sum / point_count
        
        mx, my = self._wall_midpoint(wall_p0, wall_p1)
        
        dx = wall_p1[0] - wall_p0[0]
        dy = wall_p1[1] - wall_p0[1]
        norm = math.hypot(dx, dy)
        if norm < 1e-9:
            return '+normal'
        
        dx_norm = dx / norm
        dy_norm = dy / norm
        nx_pos, ny_pos = -dy_norm, dx_norm
        nx_neg, ny_neg = dy_norm, -dx_norm
        
        # Vector from centroid to wall midpoint
        dcx, dcy = mx - cx, my - cy
        
        # Dot products: positive = pointing away from centroid
        dot_pos = nx_pos * dcx + ny_pos * dcy
        dot_neg = nx_neg * dcx + ny_neg * dcy
        
        return '+normal' if dot_pos > dot_neg else '-normal'
    
    def _determine_wall_orientation(self, wall: Any, floor_polygons: Dict[int, List[List[Tuple[float, float]]]],
                                    all_walls: List[Any], epsilon: float = 0.15) -> Dict[str, Any]:
        """Determine wall orientation using polygon-based test with fallbacks.
        
        Args:
            wall: Wall element (IfcElement or dict with 'line' key)
            floor_polygons: Floor polygon index
            all_walls: All walls for neighbor counting
            epsilon: Epsilon step distance
            
        Returns:
            Dict with 'orientation360', 'coords_swapped', 'approach', 'epsilon_results', 'fallback_details'
        """
        # Extract wall coordinates
        if isinstance(wall, dict) and 'line' in wall:
            # Simplified wall dict format
            p0, p1 = wall['line']
            floor_index = wall.get('floor_index', 0)
            wall_name = wall.get('name', 'Unknown')
        else:
            # IfcElement format
            if not wall.coordinates or len(wall.coordinates) < 2:
                return {'orientation360': 0.0, 'coords_swapped': False, 'approach': 'invalid', 'epsilon_results': {}, 'fallback_details': {}}
            p0, p1 = wall.coordinates[0], wall.coordinates[1]
            floor_index = 0
            if wall.storey:
                try:
                    floor_index = int(wall.storey.get('floor_index', 0))
                except (ValueError, AttributeError):
                    pass
            wall_name = getattr(wall, 'name', 'Unknown')
        
        # Find adjacent floor polygons
        adjacent_polys, edge_sharing_polys, edge_sharing_details = self._find_adjacent_floor_polygons(p0, p1, floor_index, floor_polygons)
        
        # Extract polygon names for audit
        edge_sharing_names = [name for _, name in edge_sharing_polys]
        adjacent_names = [name for _, name in adjacent_polys]
        
        # CRITICAL: Prefer edge-sharing polygons for epsilon test (more reliable)
        # If we have edge-sharing polygons, use ONLY those; otherwise use all adjacent
        # This prevents false positives from overlapping polygons that contain the midpoint
        
        # When multiple edge-sharing polygons are detected, filter using edge_distance metric
        # This prioritizes polygons where the wall aligns best with the polygon edge
        if edge_sharing_polys and len(edge_sharing_polys) > 1:
            # Compute wall length for tolerance scaling
            wall_len = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            # Use edge_distance from details (already computed during matching)
            poly_with_distances = []
            detail_map = {d['floor_name']: d for d in edge_sharing_details}
            
            for poly_tuple in edge_sharing_polys:
                poly, floor_name = poly_tuple
                detail = detail_map.get(floor_name, {})
                edge_dist = detail.get('edge_distance', float('inf'))
                poly_with_distances.append((poly_tuple, edge_dist))
            
            # Sort by edge_distance (best match first)
            poly_with_distances.sort(key=lambda x: x[1])
            
            # Keep only polygons with edge_distance within tolerance of best match
            best_edge_dist = poly_with_distances[0][1]
            tolerance = max(0.05, wall_len * 0.05)  # 5% of wall length or 5cm
            
            filtered_edge_sharing = [p for p, d in poly_with_distances if d <= best_edge_dist + tolerance]
            filtered_details = [detail_map.get(name, {}) for _, name in filtered_edge_sharing]
            
            if len(filtered_edge_sharing) < len(edge_sharing_polys):
                edge_sharing_polys = filtered_edge_sharing
                edge_sharing_details = filtered_details
                edge_sharing_names = [name for _, name in edge_sharing_polys]
            
            # If still multiple, prefer the one with smallest edge_distance (already sorted)
            if len(filtered_edge_sharing) > 1:
                edge_sharing_polys = [filtered_edge_sharing[0]]  # Keep only the best match
                edge_sharing_details = [filtered_details[0]]
                edge_sharing_names = [name for _, name in edge_sharing_polys]
        
        # When no edge-sharing polygons are found, filter by distance to wall edge
        # Only include polygons that are actually close to the wall (not just containing midpoint)
        if not edge_sharing_polys and len(adjacent_polys) > 1:
            # Filter: only keep polygons where wall is close to polygon edge
            filtered_adjacent = []
            wall_len = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            max_dist = wall_len * 0.1  # Wall must be within 10% of wall length from polygon edge
            
            for poly_tuple in adjacent_polys:
                poly, floor_name = poly_tuple
                min_dist_to_edge = float('inf')
                # Check distance from wall segment to each polygon edge
                for i in range(len(poly)):
                    px1, py1 = poly[i]
                    px2, py2 = poly[(i+1) % len(poly)]
                    
                    # Distance from wall midpoint to polygon edge
                    seg_len_sq = (px2 - px1) ** 2 + (py2 - py1) ** 2
                    if seg_len_sq > 1e-12:
                        mx, my = self._wall_midpoint(p0, p1)
                        t = max(0, min(1, ((mx - px1) * (px2 - px1) + (my - py1) * (py2 - py1)) / seg_len_sq))
                        proj_x = px1 + t * (px2 - px1)
                        proj_y = py1 + t * (py2 - py1)
                        dist = math.hypot(mx - proj_x, my - proj_y)
                        min_dist_to_edge = min(min_dist_to_edge, dist)
                
                if min_dist_to_edge < max_dist:
                    filtered_adjacent.append(poly_tuple)
            
            # Use filtered list if we found any, otherwise use all
            if filtered_adjacent:
                test_polygons = filtered_adjacent
            else:
                test_polygons = adjacent_polys
        else:
            test_polygons = edge_sharing_polys if edge_sharing_polys else adjacent_polys
        
        # Extract polygons for epsilon test (names tracked separately)
        test_polygons_only = [poly for poly, _ in test_polygons]
        test_polygon_names = [name for _, name in test_polygons]
        
        # Diagnostics: compute strict Full-2V side votes and overlap metrics for edge-sharing polygons
        # We consider edge_sharing_details entries with a concrete edge_info as strict Full-2V
        full2v_matches = []
        plus_side_count = 0
        minus_side_count = 0
        if edge_sharing_polys:
            # Recompute normals and midpoint for side test
            mx, my = self._wall_midpoint(p0, p1)
            dx_wall = p1[0] - p0[0]
            dy_wall = p1[1] - p0[1]
            norm_wall = math.hypot(dx_wall, dy_wall)
            if norm_wall > 1e-9:
                dxw_n = dx_wall / norm_wall
                dyw_n = dy_wall / norm_wall
                nx_pos_d, ny_pos_d = -dyw_n, dxw_n
                # Map floor_name -> (poly, detail)
                detail_map = {d.get('floor_name'): d for d in edge_sharing_details}
                for poly, floor_name in edge_sharing_polys:
                    detail = detail_map.get(floor_name) or {}
                    edge_info = detail.get('edge_info') or {}
                    edge_index = edge_info.get('edge_index')
                    # Compute centroid for side vote
                    if poly:
                        cx = sum(pt[0] for pt in poly) / len(poly)
                        cy = sum(pt[1] for pt in poly) / len(poly)
                        side_sign = (nx_pos_d * (cx - mx) + ny_pos_d * (cy - my))
                        side = '+' if side_sign > 0 else ('-' if side_sign < 0 else '0')
                    else:
                        side = '0'
                        side_sign = 0.0
                    # Overlap length using dominant axis, if we can identify the edge
                    overlap_len = None
                    if edge_index is not None and poly:
                        a = poly[edge_index]
                        b = poly[(edge_index + 1) % len(poly)]
                        if abs(p0[0] - p1[0]) >= abs(p0[1] - p1[1]):
                            # X-dominant
                            wall_min, wall_max = min(p0[0], p1[0]), max(p0[0], p1[0])
                            edge_min, edge_max = min(a[0], b[0]), max(a[0], b[0])
                            overlap_len = max(0.0, min(wall_max, edge_max) - max(wall_min, edge_min))
                        else:
                            wall_min, wall_max = min(p0[1], p1[1]), max(p0[1], p1[1])
                            edge_min, edge_max = min(a[1], b[1]), max(a[1], b[1])
                            overlap_len = max(0.0, min(wall_max, edge_max) - max(wall_min, edge_min))
                    # Record Full-2V match: if polygon is in edge_sharing_polys, it's Full-2V evidence
                    # For clean meshes, edge-sharing = Full-2V (both endpoints match polygon edge)
                    full2v_matches.append({
                        'floor_name': floor_name,
                        'edge_index': edge_index,
                        'side': side,
                        'side_sign': side_sign,
                        'overlap_length': overlap_len,
                        'edge_distance': detail.get('edge_distance', 0.0),
                        'max_perp_dist': (edge_info.get('max_perp_dist') if isinstance(edge_info, dict) and edge_info else None)
                    })
                    if side == '+':
                        plus_side_count += 1
                    elif side == '-':
                        minus_side_count += 1

        # Centroid analysis for audit: compute wall normals and centroid dot products
        mx, my = self._wall_midpoint(p0, p1)
        dx_wall = p1[0] - p0[0]
        dy_wall = p1[1] - p0[1]
        norm_wall = math.hypot(dx_wall, dy_wall)
        centroid_analysis = []
        nx_pos = ny_pos = nx_neg = ny_neg = 0.0
        if norm_wall > 1e-9:
            dxw_n = dx_wall / norm_wall
            dyw_n = dy_wall / norm_wall
            nx_pos, ny_pos = -dyw_n, dxw_n
            nx_neg, ny_neg = dyw_n, -dxw_n
            for poly_tuple in test_polygons:
                poly, floor_name = poly_tuple
                if not poly:
                    continue
                cx = sum(pt[0] for pt in poly) / len(poly)
                cy = sum(pt[1] for pt in poly) / len(poly)
                dcx, dcy = mx - cx, my - cy
                dot_pos = nx_pos * dcx + ny_pos * dcy
                dot_neg = nx_neg * dcx + ny_neg * dcy
                # Area via shoelace
                area = 0.0
                for j in range(len(poly)):
                    x0, y0 = poly[j]
                    x1, y1 = poly[(j+1) % len(poly)]
                    area += x0 * y1 - x1 * y0
                area = abs(area) * 0.5
                centroid_analysis.append({
                    'centroid': (cx, cy),
                    'dot_pos': dot_pos,
                    'dot_neg': dot_neg,
                    'area': area,
                    'floor_name': floor_name
                })

        
        # Simplified logic: If Full-2V matches exist, use them directly (deterministic)
        approach = 'polygon_inside_test'
        chosen_normal = 'ambiguous'
        selection_reason = None
        interior_side = None
        outward_side = None
        
        if full2v_matches:
            # Determine interior side from Full-2V evidence
            if plus_side_count > minus_side_count:
                interior_side = '+'
                outward_side = '-'  # Opposite of interior
                chosen_normal = '-normal'  # Outward = opposite of interior
                approach = 'full2v_majority'
                selection_reason = 'full2v_side_majority_inverted'
            elif minus_side_count > plus_side_count:
                interior_side = '-'
                outward_side = '+'  # Opposite of interior
                chosen_normal = '+normal'  # Outward = opposite of interior
                approach = 'full2v_majority'
                selection_reason = 'full2v_side_majority_inverted'
            else:
                # Tie: choose best match by edge_distance then overlap, then invert
                sorted_full2v = sorted(
                    full2v_matches,
                    key=lambda m: (
                        float('inf') if m.get('edge_distance') is None else m.get('edge_distance'),
                        -(0.0 if m.get('overlap_length') is None else m.get('overlap_length'))
                    )
                )
                if sorted_full2v:
                    best_match_side = sorted_full2v[0].get('side')
                    interior_side = best_match_side
                    outward_side = '+' if best_match_side == '-' else '-'
                    chosen_normal = '+normal' if outward_side == '+' else '-normal'
                    approach = 'full2v_tiebreak'
                    selection_reason = 'edge_distance_then_overlap_inverted'
        
        # Only run epsilon test if NO Full-2V matches (fallback for edge cases)
        eps_result = None
        fallback_details = {}
        if chosen_normal == 'ambiguous':
            eps_result = self._epsilon_inside_outside_test(p0, p1, test_polygons_only, epsilon)
            chosen_normal = eps_result['decision']
            approach = 'polygon_inside_test'
        else:
            # Still create eps_result for audit (but decision already made)
            eps_result = {'decision': chosen_normal, 'reason': 'skipped_full2v_used'}

        # Attach centroid analysis and normal vectors to eps_result for audit
        if eps_result is None:
            eps_result = {}
        eps_result['centroid_analysis'] = centroid_analysis
        eps_result['wall_midpoint'] = (mx, my)
        eps_result['normals'] = {
            'nx_pos': nx_pos,
            'ny_pos': ny_pos,
            'nx_neg': nx_neg,
            'ny_neg': ny_neg
        }
        
        # Apply fallbacks only if still ambiguous (no Full-2V matches found)
        if chosen_normal == 'ambiguous':
            approach = 'free_space_fallback'
            chosen_normal = self._free_space_fallback(p0, p1, floor_index, all_walls, epsilon)
            fallback_details['free_space'] = chosen_normal
            
            if chosen_normal == 'ambiguous':  # Still ambiguous
                approach = 'hull_fallback'
                chosen_normal = self._hull_fallback(p0, p1, floor_index, floor_polygons, epsilon)
                fallback_details['hull'] = chosen_normal
                
                if chosen_normal == 'ambiguous':  # Still ambiguous
                    approach = 'centroid_fallback'
                    chosen_normal = self._centroid_fallback(p0, p1, adjacent_polys)
                    fallback_details['centroid'] = chosen_normal
        
        # Compute orientation360 from chosen normal
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]
        norm = math.hypot(dx, dy)
        
        if norm < 1e-9:
            return {'orientation360': 0.0, 'coords_swapped': False, 'approach': approach, 'epsilon_results': eps_result, 'fallback_details': fallback_details}
        
        dx_norm = dx / norm
        dy_norm = dy / norm
        
        # Compute both normals
        nx_pos, ny_pos = -dy_norm, dx_norm
        nx_neg, ny_neg = dy_norm, -dx_norm
        
        # Choose which normal to use
        if chosen_normal == '+normal':
            nx, ny = nx_pos, ny_pos
        else:
            nx, ny = nx_neg, ny_neg
        
        # Compute orientation360 from normal (geographical: 0°=N, 90°=E)
        # Convert from mathematical angle to geographical azimuth
        # CRITICAL FIX: The chosen_normal points OUTWARD (away from interior polygons)
        # But orientation360 represents the OUTWARD-facing surface normal direction
        # Since polygons represent INTERIOR space, the normal pointing AWAY from interior
        # is correct for outward-facing. However, we need to ensure orientation360
        # represents the direction FROM the wall OUTWARD (away from building interior)
        normal_angle = math.atan2(ny, nx) * 180 / math.pi
        orientation360 = (normal_angle - 90 + 360) % 360
        # Flip by 180° to get true outward direction (away from interior)
        orientation360 = (orientation360 + 180) % 360
        
        # Check if we need to swap coordinates
        # Current wall direction from p0->p1
        wall_angle = math.atan2(dy, dx) * 180 / math.pi
        wall_normal_angle = (wall_angle + 90) % 360
        wall_normal_geo = (wall_normal_angle - 90 + 360) % 360
        
        # Check if current orientation matches chosen normal
        coords_swapped = False
        angle_diff = abs((orientation360 - wall_normal_geo + 180) % 360 - 180)
        if angle_diff > 45:  # More than 45° difference means we should swap
            coords_swapped = True
        
        return {
            'orientation360': orientation360,
            'coords_swapped': coords_swapped,
            'approach': approach,
            'epsilon_results': eps_result,
            'fallback_details': fallback_details,
            'adjacent_polygons_count': len(adjacent_polys),
            'edge_sharing_polygons_count': len(edge_sharing_polys),
            'edge_sharing_polygon_names': edge_sharing_names,
            'edge_sharing_details': edge_sharing_details[:1] if edge_sharing_details else [],  # Include details for selected polygon
            'test_polygon_names': test_polygon_names,
            'chosen_normal': chosen_normal,
            'centroid_analysis': centroid_analysis,
            # Diagnostics (no behavior change): strict Full-2V evidence
            'matched_polygons_full2v': full2v_matches,
            'full2v_side_counts': {'plus': plus_side_count, 'minus': minus_side_count},
            'selection_reason': selection_reason,
            'interior_side': interior_side,
            'outward_side': outward_side
        }

    def _delayering_internal_walls(self, simplified_walls: List[Dict[str, Any]], model: IfcModel,
                                    floor_polygons: Dict[int, List[Tuple[List[Tuple[float, float]], str]]]) -> List[Dict[str, Any]]:
        """Apply delayering to Internal mode walls: detect and filter direction pairs.
        For each pair of walls with reversed coordinates (same endpoints, opposite order),
        keep only the outward-facing one using polygon-based orientation logic.
        
        Args:
            simplified_walls: List of dicts with 'line', 'face', 'element', 'element_id', 'floor_index', 'width'
            model: IfcModel for storey access
            floor_polygons: Floor polygon index for orientation determination
            
        Returns:
            Filtered list of wall dicts with duplicates removed
        """
        if not simplified_walls:
            return []
        
        # Group by floor and element for efficient pair detection
        from collections import defaultdict
        grouped = defaultdict(list)  # (floor_index, element_id) -> [walls]
        for wall in simplified_walls:
            key = (wall['floor_index'], wall.get('element_id'))
            grouped[key].append(wall)
        
        # Build temporary wall list for neighbor counting in fallbacks
        temp_walls = []
        for w in simplified_walls:
            temp_el = IfcElement(id=0, type='IfcWall', name='temp')
            temp_el.coordinates = w['line']
            temp_el.storey = {'floor_index': w['floor_index']}
            temp_walls.append(temp_el)
        
        filtered = []
        processed_pairs = set()  # Track which walls have been processed as pairs
        delayering_pairs = []  # Track pairs for audit
        
        for (floor_index, element_id), walls in grouped.items():
            if len(walls) < 2:
                # No pairs possible, keep all
                filtered.extend(walls)
                continue
            
            # Detect direction pairs (reversed coordinates)
            for i in range(len(walls)):
                if i in processed_pairs:
                    continue
                w1 = walls[i]
                p1_0, p1_1 = w1['line']
                
                # Look for a reversed pair
                pair_found = False
                for j in range(i + 1, len(walls)):
                    if j in processed_pairs:
                        continue
                    w2 = walls[j]
                    p2_0, p2_1 = w2['line']
                    
                    # Check if coordinates are reversed (within tolerance)
                    tol = 0.01  # 1cm tolerance
                    if (abs(p1_0[0] - p2_1[0]) < tol and abs(p1_0[1] - p2_1[1]) < tol and
                        abs(p1_1[0] - p2_0[0]) < tol and abs(p1_1[1] - p2_0[1]) < tol):
                        # Found a direction pair - use polygon-based orientation to determine outward-facing
                        orient1 = self._determine_wall_orientation(w1, floor_polygons, temp_walls)
                        orient2 = self._determine_wall_orientation(w2, floor_polygons, temp_walls)
                        
                        # Compare orientations: keep the one that's more clearly outward-facing
                        # Since they're reversed, one should be clearly outward, one inward
                        # We want the one with orientation360 pointing away from interior
                        
                        # Check if one is clearly outward (not ambiguous)
                        if orient1['approach'] == 'polygon_inside_test' and orient2['approach'] != 'polygon_inside_test':
                            # orient1 is more reliable
                            if orient1['epsilon_results'].get('decision') != 'ambiguous':
                                filtered.append(w1)
                                processed_pairs.add(i)
                                processed_pairs.add(j)
                                delayering_pairs.append({'kept': 'w1', 'removed': 'w2', 'reason': 'w1_polygon_based'})
                                pair_found = True
                                break
                        elif orient2['approach'] == 'polygon_inside_test' and orient1['approach'] != 'polygon_inside_test':
                            # orient2 is more reliable
                            if orient2['epsilon_results'].get('decision') != 'ambiguous':
                                filtered.append(w2)
                                processed_pairs.add(i)
                                processed_pairs.add(j)
                                delayering_pairs.append({'kept': 'w2', 'removed': 'w1', 'reason': 'w2_polygon_based'})
                                pair_found = True
                                break
                        else:
                            # Both same approach or both ambiguous - compare orientation360 values
                            # Since they're reversed, one should point outward, one inward
                            # For Internal mode, we want outward-facing (away from interior)
                            # Compare epsilon results: if one is inside and one is outside, keep the outward one
                            eps1 = orient1['epsilon_results']
                            eps2 = orient2['epsilon_results']
                            
                            if eps1.get('pos_inside') and not eps1.get('neg_inside') and not eps2.get('pos_inside') and eps2.get('neg_inside'):
                                # w1: +normal inside, -normal outside → -normal is outward → keep w1
                                filtered.append(w1)
                                processed_pairs.add(i)
                                processed_pairs.add(j)
                                delayering_pairs.append({'kept': 'w1', 'removed': 'w2', 'reason': 'w1_outward_epsilon'})
                                pair_found = True
                                break
                            elif eps2.get('pos_inside') and not eps2.get('neg_inside') and not eps1.get('pos_inside') and eps1.get('neg_inside'):
                                # w2: +normal inside, -normal outside → -normal is outward → keep w2
                                filtered.append(w2)
                                processed_pairs.add(i)
                                processed_pairs.add(j)
                                delayering_pairs.append({'kept': 'w2', 'removed': 'w1', 'reason': 'w2_outward_epsilon'})
                                pair_found = True
                                break
                            else:
                                # Both ambiguous - fallback: keep the one with orientation360 pointing away from polygon centroid
                                # (This is a heuristic when polygon test fails)
                                centroid = (0.0, 0.0)
                                if floor_index in floor_polygons and floor_polygons[floor_index]:
                                    all_points = []
                                    for poly_tuple in floor_polygons[floor_index]:
                                        poly, _ = poly_tuple
                                        all_points.extend(poly)
                                    if all_points:
                                        centroid = self._polygon_centroid(all_points)
                                
                                mx1, my1 = self._wall_midpoint(p1_0, p1_1)
                                mx2, my2 = self._wall_midpoint(p2_0, p2_1)
                                
                                # Vector from centroid to wall midpoint
                                dx1, dy1 = mx1 - centroid[0], my1 - centroid[1]
                                dx2, dy2 = mx2 - centroid[0], my2 - centroid[1]
                                
                                # Wall direction vectors
                                vx1, vy1 = p1_1[0] - p1_0[0], p1_1[1] - p1_0[1]
                                vx2, vy2 = p2_1[0] - p2_0[0], p2_1[1] - p2_0[1]
                                
                                norm1 = math.hypot(vx1, vy1)
                                norm2 = math.hypot(vx2, vy2)
                                
                                if norm1 > 1e-6 and norm2 > 1e-6:
                                    dir1_x, dir1_y = vx1 / norm1, vy1 / norm1
                                    dir2_x, dir2_y = vx2 / norm2, vy2 / norm2
                                    
                                    dist1 = math.hypot(dx1, dy1)
                                    dist2 = math.hypot(dx2, dy2)
                                    
                                    if dist1 > 1e-6 and dist2 > 1e-6:
                                        cent_to_wall1_x, cent_to_wall1_y = dx1 / dist1, dy1 / dist1
                                        cent_to_wall2_x, cent_to_wall2_y = dx2 / dist2, dy2 / dist2
                                        
                                        dot1 = dir1_x * cent_to_wall1_x + dir1_y * cent_to_wall1_y
                                        dot2 = dir2_x * cent_to_wall2_x + dir2_y * cent_to_wall2_y
                                        
                                        # Keep wall with larger positive dot (more outward-facing)
                                        if dot1 >= dot2:
                                            filtered.append(w1)
                                            processed_pairs.add(i)
                                            processed_pairs.add(j)
                                            delayering_pairs.append({'kept': 'w1', 'removed': 'w2', 'reason': 'centroid_fallback'})
                                        else:
                                            filtered.append(w2)
                                            processed_pairs.add(i)
                                            processed_pairs.add(j)
                                            delayering_pairs.append({'kept': 'w2', 'removed': 'w1', 'reason': 'centroid_fallback'})
                                        pair_found = True
                                        break
                
                # If no pair found, keep this wall
                if not pair_found and i not in processed_pairs:
                    filtered.append(w1)
        
        # Log delayering results in audit
        removed_count = len(simplified_walls) - len(filtered)
        if removed_count > 0 and self.audit_collector:
            try:
                self.audit_collector.records.append({
                    "type": "InternalModeDelayering",
                    "walls_before": len(simplified_walls),
                    "walls_after": len(filtered),
                    "duplicates_removed": removed_count,
                    "pairs_detected": len(delayering_pairs),
                    "note": "Removed inward-facing duplicates from direction pairs using polygon-based orientation",
                    "pairs": delayering_pairs[:50]  # Limit to first 50 pairs for audit size
                })
            except Exception:
                pass
        
        return filtered

    def _extract_faces_to_elements_common(self) -> IfcModel:
        """Common pipeline for extracting faces to model elements.
        
        Handles the shared processing steps for both internal and external modes:
        - Extract faces, classify, group by storey
        - Convert walls to simplified lines, consolidate colinear
        - Convert floors/roofs to elements (for floor polygon index)
        - Build floor polygon index
        - Delayering and consolidation
        - Create wall elements with orientation determination
        
        Note: This uses ORIGINAL faces (no offset). External mode should offset
        elements AFTER calling this helper.
        
        Returns:
            IfcModel with walls, floors, roofs extracted and oriented (but not merged/snipped yet)
        """
        model = IfcModel()
        
        # Extract storeys first (may be empty)
        self._extract_storeys(model)
        
        # Collect all elements with geometry (proxies + any other solid elements)
        all_elements = []
        try:
            # Get proxies
            proxies = self.model.by_type('IfcBuildingElementProxy') or []
            all_elements.extend(proxies)
            
            # Also try to get any other elements that might have geometry
            for elem_type in ['IfcWall', 'IfcSlab', 'IfcRoof', 'IfcSpace']:
                try:
                    elems = self.model.by_type(elem_type) or []
                    all_elements.extend(elems)
                except Exception:
                    pass
        except Exception:
            pass
        
        if not all_elements:
            return model
        
        # Extract all faces from all elements
        all_faces = []
        for element in all_elements:
            faces = self._extract_faces_from_element(element)
            all_faces.extend(faces)
        
        if not all_faces:
            return model
        
        # Classify faces
        wall_faces = []
        floor_faces = []
        ceiling_faces = []
        for face in all_faces:
            face_type = self._classify_face(face)
            if face_type == 'wall':
                wall_faces.append(face)
            elif face_type == 'floor':
                floor_faces.append(face)
            elif face_type == 'ceiling':
                ceiling_faces.append(face)
        
        # Group by storey
        wall_faces_by_floor = self._cluster_faces_by_storey(wall_faces, model.storeys)
        floor_faces_by_floor = self._cluster_faces_by_storey(floor_faces, model.storeys)
        ceiling_faces_by_floor = self._cluster_faces_by_storey(ceiling_faces, model.storeys)
        
        # Assign all roofs/ceilings to a separate floor above all other elements
        max_floor_index = 0
        if wall_faces_by_floor:
            max_floor_index = max(max_floor_index, max(wall_faces_by_floor.keys()))
        if floor_faces_by_floor:
            max_floor_index = max(max_floor_index, max(floor_faces_by_floor.keys()))
        roof_floor_index = max_floor_index + 1
        
        # Reassign all ceiling faces to roof floor
        if ceiling_faces_by_floor:
            all_ceiling_faces = []
            for faces in ceiling_faces_by_floor.values():
                all_ceiling_faces.extend(faces)
            ceiling_faces_by_floor = {roof_floor_index: all_ceiling_faces}
            # Create a storey entry for the roof floor if needed
            if roof_floor_index >= len(model.storeys):
                model.storeys.append({'name': f'Roof_{roof_floor_index}', 'floor_index': roof_floor_index})
        
        # Convert wall faces to simplified line segments
        simplified_walls = []
        for floor_index, faces in wall_faces_by_floor.items():
            for face in faces:
                line = self._simplify_wall_face_to_line(face)
                if not line:
                    continue
                p0, p1 = line
                # Check for degenerate walls (zero width)
                width = math.hypot(p1[0]-p0[0], p1[1]-p0[1])
                if width < 0.01:  # Skip degenerate walls < 1cm
                    continue
                
                element = face.get('element')
                element_id = getattr(element, 'id', lambda: 0)() if element else None
                
                simplified_walls.append({
                    'line': line,
                    'face': face,
                    'element': element,
                    'element_id': element_id,
                    'floor_index': floor_index,
                    'width': width
                })
        
        # Consolidate colinear segments
        consolidated_walls = self._consolidate_colinear_segments(simplified_walls)
        
        # Convert floor faces to floor elements (polygons) BEFORE delayering
        # (needed for polygon-based orientation)
        floor_id_counter = 1
        for floor_index, faces in floor_faces_by_floor.items():
            for face in faces:
                vertices = face['vertices']
                if len(vertices) < 3:
                    continue
                
                element = face.get('element')
                name = None
                if element:
                    element_id = getattr(element, 'id', lambda: 0)()
                    base_name = getattr(element, 'Name', None) or f"Floor_{element_id}"
                    name = f"{base_name}_F{floor_id_counter}"
                else:
                    name = f"Floor_{floor_id_counter}"
                
                floor_el = IfcElement(
                    id=floor_id_counter,
                    type='IfcSlab',
                    name=name
                )
                floor_el.coordinates = vertices
                # Compute area from vertices (Shoelace formula)
                area = 0.0
                n = len(vertices)
                for i in range(n):
                    v0 = vertices[i]
                    v1 = vertices[(i+1) % n]
                    area += v0[0]*v1[1] - v1[0]*v0[1]
                floor_el.area = abs(area) * 0.5
                # CRITICAL FIX: Force floor_index to match the key from floor_faces_by_floor
                floor_el.storey = {'name': f'Floor_{floor_index}', 'floor_index': floor_index}
                if floor_index < len(model.storeys):
                    storey_name = model.storeys[floor_index].get('name', f'Floor_{floor_index}')
                    if 'Roof' not in storey_name:
                        floor_el.storey['name'] = storey_name
                model.floors.append(floor_el)
                floor_id_counter += 1
        
        # Build floor polygon index for orientation determination
        floor_polygons = self._build_floor_polygon_index(model)
        
        # Apply delayering: detect and filter direction pairs (using polygon-based orientation)
        filtered_walls = self._delayering_internal_walls(consolidated_walls, model, floor_polygons)
        
        # CRITICAL FIX: Run consolidation again after delayering
        final_walls = self._consolidate_colinear_segments(filtered_walls, use_all_pairs=True)
        
        # AUDIT: Log second consolidation pass
        if self.audit_collector:
            try:
                self.audit_collector.records.append({
                    'type': 'PostDelayeringConsolidation',
                    'walls_before': len(filtered_walls),
                    'walls_after': len(final_walls),
                    'additional_merges': len(filtered_walls) - len(final_walls),
                    'note': 'Second consolidation pass after delayering (all-pairs algorithm)',
                    'algorithm': 'all_pairs'
                })
            except Exception:
                pass
        
        # CRITICAL FIX: Deduplicate exact duplicates after consolidation
        deduplicated_walls = []
        seen_coords = set()
        for wall in final_walls:
            p0, p1 = wall['line']
            coord_key = tuple(sorted([(round(p0[0], 3), round(p0[1], 3)), (round(p1[0], 3), round(p1[1], 3))]))
            if coord_key not in seen_coords:
                seen_coords.add(coord_key)
                deduplicated_walls.append(wall)
        
        duplicates_removed = len(final_walls) - len(deduplicated_walls)
        
        # FINAL PASS: One more all-pairs consolidation on deduplicated walls
        final_consolidated = self._consolidate_colinear_segments(deduplicated_walls, use_all_pairs=True, ignore_height=True)
        
        final_merges = len(deduplicated_walls) - len(final_consolidated)
        
        if duplicates_removed > 0 or final_merges > 0:
            if self.audit_collector:
                try:
                    self.audit_collector.records.append({
                        'type': 'PostDelayeringConsolidation',
                        'walls_before': len(filtered_walls),
                        'walls_after': len(final_consolidated),
                        'additional_merges': len(filtered_walls) - len(final_consolidated),
                        'deduplication_removed': duplicates_removed,
                        'final_pass_merges': final_merges,
                        'note': 'Second consolidation pass + deduplication + final all-pairs pass'
                    })
                except Exception:
                    pass
        
        final_walls = final_consolidated
        
        # Create IfcElement objects from filtered walls with orientation determination
        wall_id_counter = 1
        element_face_counters = {}
        orientation_decisions = []
        orientation_by_floor = {}
        
        # Build temporary wall list for neighbor counting
        temp_walls = []
        for w in final_walls:
            temp_el = IfcElement(id=0, type='IfcWall', name='temp')
            temp_el.coordinates = w['line']
            temp_el.storey = {'floor_index': w['floor_index']}
            temp_walls.append(temp_el)
        
        for wall_data in final_walls:
            line = wall_data['line']
            face = wall_data['face']
            element = wall_data['element']
            floor_index = wall_data['floor_index']
            p0, p1 = line
            
            # Get element info for naming
            name = None
            global_id = None
            if element:
                element_id = getattr(element, 'id', lambda: 0)()
                base_name = getattr(element, 'Name', None) or f"Wall_{element_id}"
                if element_id not in element_face_counters:
                    element_face_counters[element_id] = 0
                element_face_counters[element_id] += 1
                face_num = element_face_counters[element_id]
                name = f"{base_name}_F{face_num}"
                global_id = getattr(element, 'GlobalId', None)
            else:
                name = f"WallFace_{wall_id_counter}"
            
            # Determine orientation using polygon-based test
            orient_result = self._determine_wall_orientation(wall_data, floor_polygons, temp_walls)
            
            # Apply coordinate swap if needed
            if orient_result['coords_swapped']:
                p0, p1 = p1, p0
                line = (p0, p1)
            
            wall_el = IfcElement(
                id=wall_id_counter,
                type='IfcWall',
                name=name
            )
            wall_el.coordinates = [p0, p1]
            # Height from face's vertical extent (Z span of all vertices)
            face_zs = [v[2] for v in face['vertices']]
            height_z_min = min(face_zs) if face_zs else min(p0[2], p1[2]) if len(p0) > 2 and len(p1) > 2 else 0.0
            height_z_max = max(face_zs) if face_zs else max(p0[2], p1[2]) if len(p0) > 2 and len(p1) > 2 else 0.0
            wall_el.height = (height_z_max - height_z_min) if face_zs else abs(p1[2] - p0[2])
            try:
                wall_el.height_z_min = height_z_min
                wall_el.height_z_max = height_z_max
            except Exception:
                pass
            wall_el.width = wall_data['width']
            wall_el.orientation = orient_result['orientation360']
            # Store chosen_normal for reuse in offsetting (avoids recomputing orientation)
            # chosen_normal points OUTWARD, so opposite points INWARD
            try:
                wall_el.chosen_normal = orient_result['chosen_normal']
            except Exception:
                wall_el.chosen_normal = None
            wall_el.storey = model.storeys[floor_index] if floor_index < len(model.storeys) else {'name': 'Unknown', 'floor_index': floor_index}
            wall_el.global_id = global_id
            wall_el.properties = {'is_external': True}
            model.walls.append(wall_el)
            
            # Collect orientation decision for audit
            orientation_decisions.append({
                'wall_name': name,
                'floor_index': floor_index,
                'approach': orient_result['approach'],
                'epsilon_results': orient_result['epsilon_results'],
                'chosen_normal': orient_result['chosen_normal'],
                'orientation360': orient_result['orientation360'],
                'coords_swapped': orient_result['coords_swapped'],
                'adjacent_polygons_count': orient_result.get('adjacent_polygons_count', 0),
                'edge_sharing_polygons_count': orient_result.get('edge_sharing_polygons_count', 0),
                'edge_sharing_polygon_names': orient_result.get('edge_sharing_polygon_names', []),
                'edge_sharing_details': orient_result.get('edge_sharing_details', []),
                'matched_polygons_full2v': orient_result.get('matched_polygons_full2v', []),
                'full2v_side_counts': orient_result.get('full2v_side_counts', {}),
                'selection_reason': orient_result.get('selection_reason'),
                'interior_side': orient_result.get('interior_side'),
                'outward_side': orient_result.get('outward_side'),
                'test_polygon_names': orient_result.get('test_polygon_names', []),
                'fallback_details': orient_result.get('fallback_details', {}),
                'height_z_min': height_z_min,
                'height_z_max': height_z_max,
                'centroid_analysis': orient_result.get('centroid_analysis', [])
            })
            
            # Track stats by floor
            if floor_index not in orientation_by_floor:
                orientation_by_floor[floor_index] = {'total': 0, 'oriented_ok': 0, 'ambiguous': 0, 'fallback_breakdown': {'free_space': 0, 'hull': 0, 'centroid': 0}}
            orientation_by_floor[floor_index]['total'] += 1
            if orient_result['approach'] == 'polygon_inside_test' and orient_result['epsilon_results'].get('decision') != 'ambiguous':
                orientation_by_floor[floor_index]['oriented_ok'] += 1
            else:
                orientation_by_floor[floor_index]['ambiguous'] += 1
                if orient_result['approach'] == 'free_space_fallback':
                    orientation_by_floor[floor_index]['fallback_breakdown']['free_space'] += 1
                elif orient_result['approach'] == 'hull_fallback':
                    orientation_by_floor[floor_index]['fallback_breakdown']['hull'] += 1
                elif orient_result['approach'] == 'centroid_fallback':
                    orientation_by_floor[floor_index]['fallback_breakdown']['centroid'] += 1
            
            wall_id_counter += 1
        
        # Log orientation decisions in audit
        if self.audit_collector:
            try:
                # Per-wall decisions
                for decision in orientation_decisions:
                    self.audit_collector.records.append({
                        'type': 'OrientationDecision',
                        'wall_name': decision['wall_name'],
                        'floor_index': decision['floor_index'],
                        'approach': decision['approach'],
                        'epsilon_results': decision['epsilon_results'],
                        'chosen_normal': decision['chosen_normal'],
                        'orientation360': decision['orientation360'],
                        'coords_swapped': decision['coords_swapped'],
                        'adjacent_polygons_count': decision['adjacent_polygons_count'],
                        'edge_sharing_polygons_count': decision.get('edge_sharing_polygons_count', 0),
                        'edge_sharing_polygon_names': decision.get('edge_sharing_polygon_names', []),
                        'edge_sharing_details': decision.get('edge_sharing_details', []),
                        'matched_polygons_full2v': decision.get('matched_polygons_full2v', []),
                        'full2v_side_counts': decision.get('full2v_side_counts', {}),
                        'selection_reason': decision.get('selection_reason'),
                        'interior_side': decision.get('interior_side'),
                        'outward_side': decision.get('outward_side'),
                        'test_polygon_names': decision.get('test_polygon_names', []),
                        'fallback_details': decision['fallback_details'],
                        'height_z_min': decision.get('height_z_min'),
                        'height_z_max': decision.get('height_z_max'),
                        'centroid_analysis': decision.get('centroid_analysis', [])
                    })
                
                # Per-floor rollups
                for floor_index, stats in orientation_by_floor.items():
                    self.audit_collector.records.append({
                        'type': 'OrientationRollup',
                        'floor_index': floor_index,
                        'total_walls': stats['total'],
                        'oriented_ok': stats['oriented_ok'],
                        'ambiguous_normals': stats['ambiguous'],
                        'fallback_breakdown': stats['fallback_breakdown']
                    })
            except Exception:
                pass
        
        # Convert ceiling faces to roof elements (polygons)
        roof_id_counter = 1
        for floor_index, faces in ceiling_faces_by_floor.items():
            for face in faces:
                vertices = face['vertices']
                if len(vertices) < 3:
                    continue
                element = face.get('element')
                name = None
                if element:
                    name = getattr(element, 'Name', None) or f"RoofFace_{getattr(element, 'id', lambda: 0)()}"
                else:
                    name = f"RoofFace_{roof_id_counter}"
                
                roof_el = IfcElement(
                    id=roof_id_counter,
                    type='IfcRoof',
                    name=name
                )
                roof_el.coordinates = vertices
                # Compute area
                area = 0.0
                n = len(vertices)
                for i in range(n):
                    v0 = vertices[i]
                    v1 = vertices[(i+1) % n]
                    area += v0[0]*v1[1] - v1[0]*v0[1]
                roof_el.area = abs(area) * 0.5
                roof_el.storey = model.storeys[floor_index] if floor_index < len(model.storeys) else {'name': f'Roof_{floor_index}', 'floor_index': floor_index}
                model.roofs.append(roof_el)
                roof_id_counter += 1
        
        return model

    def _extract_internal_negative_spaces_model(self) -> IfcModel:
        """Build an IfcModel using face-based extraction from negative-space solids (no trims).
        Extracts vertical perimeter faces as walls, up-facing horizontal faces as floors,
        down-facing horizontal faces as ceilings/roofs.
        """
        # Use common pipeline to extract faces and create elements with orientation
        model = self._extract_faces_to_elements_common()
        
        # Merge adjacent floor polygons (by floor_index)
        if model.floors:
            floors_before = len(model.floors)
            merged_floors = self._merge_adjacent_polygons(model.floors, 'floor')
            floors_after = len(merged_floors)
            if floors_before != floors_after and self.audit_collector:
                try:
                    self.audit_collector.records.append({
                        'type': 'FloorMergingResult',
                        'before': floors_before,
                        'after': floors_after,
                        'merged': floors_before - floors_after
                    })
                except Exception:
                    pass
            model.floors = merged_floors
        
        # Merge adjacent roof polygons (by floor_index)
        if model.roofs:
            roofs_before = len(model.roofs)
            merged_roofs = self._merge_adjacent_polygons(model.roofs, 'roof')
            roofs_after = len(merged_roofs)
            if roofs_before != roofs_after and self.audit_collector:
                try:
                    self.audit_collector.records.append({
                        'type': 'RoofMergingResult',
                        'before': roofs_before,
                        'after': roofs_after,
                        'merged': roofs_before - roofs_after
                    })
                except Exception:
                    pass
            model.roofs = merged_roofs
        
        return model

    def _offset_wall_element(self, wall_el: IfcElement, thickness_m: float, 
                             floor_polygons: Optional[Dict[int, List[Tuple[List[Tuple[float, float]], str]]]] = None) -> bool:
        """Offset a wall element's coordinates inward perpendicular to the wall line.
        
        Uses edge-facing polygon epsilon test to determine interior direction directly,
        avoiding reliance on stale chosen_normal that may be incorrect after coordinate swaps.
        
        Args:
            wall_el: Wall element with two-point coordinates
            thickness_m: Thickness to offset inward (meters)
            floor_polygons: Floor polygon index for epsilon test (optional, but recommended)
        
        Returns:
            True if offset succeeded, False otherwise
        """
        if not wall_el.coordinates or len(wall_el.coordinates) != 2:
            return False
        
        p0, p1 = wall_el.coordinates[0], wall_el.coordinates[1]
        wall_name = getattr(wall_el, 'name', 'Unknown')
        
        # Calculate wall direction vector
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]
        length = math.hypot(dx, dy)
        
        if length < 1e-9:
            return False  # Degenerate wall
        
        # Normalize direction vector
        dx_norm = dx / length
        dy_norm = dy / length
        
        # Calculate perpendicular vectors (candidates)
        perp_x1, perp_y1 = -dy_norm, dx_norm   # +normal (counter-clockwise)
        perp_x2, perp_y2 = dy_norm, -dx_norm   # -normal (clockwise)
        
        # Debug logging
        debug_info = {
            'wall_name': wall_name,
            'p0_before': p0,
            'p1_before': p1,
            'thickness_m': thickness_m,
            'wall_direction': (dx_norm, dy_norm),
            'perp_x1': (perp_x1, perp_y1),
            'perp_x2': (perp_x2, perp_y2),
        }
        
        # Re-run orientation logic with CURRENT coordinates to determine interior direction
        # This avoids using stale chosen_normal that may be incorrect after coordinate swaps
        # Use the same logic as orientation determination: prefer edge-sharing (Full-2V) over epsilon test
        perp_x, perp_y = None, None
        epsilon_used = False
        
        if floor_polygons is not None:
            # Get wall's floor_index
            floor_index = 0
            if wall_el.storey:
                try:
                    floor_index = int(wall_el.storey.get('floor_index', 0))
                except (ValueError, AttributeError):
                    floor_index = 0
            
            # Find adjacent floor polygons (same as orientation determination)
            adjacent_polys, edge_sharing_polys, edge_sharing_details = self._find_adjacent_floor_polygons(
                p0, p1, floor_index, floor_polygons
            )
            
            # Prefer edge-sharing (Full-2V) logic - same as orientation determination
            if edge_sharing_polys:
                # Use centroid-based side determination (deterministic, no epsilon needed)
                mx, my = self._wall_midpoint(p0, p1)
                plus_side_count = 0
                minus_side_count = 0
                
                # Compute wall normals
                nx_pos_d, ny_pos_d = perp_x1, perp_y1  # +normal
                
                # Check which side each edge-sharing polygon centroid is on
                for poly, floor_name in edge_sharing_polys:
                    if not poly:
                        continue
                    # Compute polygon centroid
                    cx = sum(pt[0] for pt in poly) / len(poly)
                    cy = sum(pt[1] for pt in poly) / len(poly)
                    # Compute side: positive = +normal side, negative = -normal side
                    side_sign = (nx_pos_d * (cx - mx) + ny_pos_d * (cy - my))
                    if side_sign > 0:
                        plus_side_count += 1
                    elif side_sign < 0:
                        minus_side_count += 1
                
                # Determine interior direction from side counts
                # Polygon represents INTERIOR space
                # If polygon centroid is on +normal side → interior is on +normal side → use +normal for inward offset
                # If polygon centroid is on -normal side → interior is on -normal side → use -normal for inward offset
                if plus_side_count > minus_side_count:
                    # Polygon centroids on +normal side → interior is on +normal side → use +normal (perp_x1) for inward offset
                    perp_x, perp_y = perp_x1, perp_y1
                    debug_info['offset_direction'] = '+normal (perp_x1, full2v_plus_side)'
                    debug_info['full2v_used'] = True
                    debug_info['full2v_side_counts'] = {'plus': plus_side_count, 'minus': minus_side_count}
                elif minus_side_count > plus_side_count:
                    # Polygon centroids on -normal side → interior is on -normal side → use -normal (perp_x2) for inward offset
                    perp_x, perp_y = perp_x2, perp_y2
                    debug_info['offset_direction'] = '-normal (perp_x2, full2v_minus_side)'
                    debug_info['full2v_used'] = True
                    debug_info['full2v_side_counts'] = {'plus': plus_side_count, 'minus': minus_side_count}
                else:
                    # Tie - use best match by edge_distance (same as orientation determination)
                    detail_map = {d.get('floor_name'): d for d in edge_sharing_details}
                    sorted_full2v = sorted(
                        [(poly, name) for poly, name in edge_sharing_polys],
                        key=lambda x: detail_map.get(x[1], {}).get('edge_distance', float('inf'))
                    )
                    if sorted_full2v:
                        best_poly, best_name = sorted_full2v[0]
                        if best_poly:
                            cx = sum(pt[0] for pt in best_poly) / len(best_poly)
                            cy = sum(pt[1] for pt in best_poly) / len(best_poly)
                            side_sign = (nx_pos_d * (cx - mx) + ny_pos_d * (cy - my))
                            if side_sign > 0:
                                # Polygon centroid on +normal side → interior on +normal side → use +normal
                                perp_x, perp_y = perp_x1, perp_y1
                                debug_info['offset_direction'] = '+normal (perp_x1, full2v_tiebreak_plus)'
                            else:
                                # Polygon centroid on -normal side → interior on -normal side → use -normal
                                perp_x, perp_y = perp_x2, perp_y2
                                debug_info['offset_direction'] = '-normal (perp_x2, full2v_tiebreak_minus)'
                            debug_info['full2v_used'] = True
                            debug_info['full2v_tiebreak'] = True
            
            # Fallback to epsilon test only if no edge-sharing polygons found
            if perp_x is None or perp_y is None:
                # Extract just the polygon coordinates (not names) for epsilon test
                adjacent_poly_coords = [poly for poly, _ in adjacent_polys]
                
                if adjacent_poly_coords:
                    # Re-run epsilon test with CURRENT coordinates
                    epsilon_result = self._epsilon_inside_outside_test(p0, p1, adjacent_poly_coords)
                    pos_inside = epsilon_result.get('pos_inside', False)
                    neg_inside = epsilon_result.get('neg_inside', False)
                    decision = epsilon_result.get('decision', 'ambiguous')
                    
                    debug_info['epsilon_result'] = epsilon_result
                    debug_info['epsilon_used'] = True
                    epsilon_used = True
                    
                    # Determine interior direction directly from epsilon test results
                    # Polygons represent INTERIOR space
                    # If pos_inside = true → +normal points INTO interior → use +normal (perp_x1) for inward offset
                    # If neg_inside = true → -normal points INTO interior → use -normal (perp_x2) for inward offset
                    if pos_inside and not neg_inside:
                        # +normal points into interior → use +normal for inward offset
                        perp_x, perp_y = perp_x1, perp_y1
                        debug_info['offset_direction'] = '+normal (perp_x1, pos_inside)'
                    elif neg_inside and not pos_inside:
                        # -normal points into interior → use -normal for inward offset
                        perp_x, perp_y = perp_x2, perp_y2
                        debug_info['offset_direction'] = '-normal (perp_x2, neg_inside)'
                    elif pos_inside and neg_inside:
                        # Both inside - use decision from epsilon test
                        # Decision indicates OUTWARD direction, so we need to invert for INWARD
                        if decision == '+normal':
                            # Decision says +normal is outward, so -normal is inward
                            perp_x, perp_y = perp_x2, perp_y2
                            debug_info['offset_direction'] = '-normal (perp_x2, both_inside_decision_+normal)'
                        elif decision == '-normal':
                            # Decision says -normal is outward, so +normal is inward
                            perp_x, perp_y = perp_x1, perp_y1
                            debug_info['offset_direction'] = '+normal (perp_x1, both_inside_decision_-normal)'
                        else:
                            # Ambiguous - fall through to fallback
                            debug_info['epsilon_ambiguous'] = True
                    else:
                        # Neither inside - ambiguous, fall through to fallback
                        debug_info['epsilon_ambiguous'] = True
        
        # Fallback: use stored chosen_normal or orientation360 if epsilon test unavailable/ambiguous
        if perp_x is None or perp_y is None:
            chosen_normal = getattr(wall_el, 'chosen_normal', None)
            orientation = wall_el.orientation if hasattr(wall_el, 'orientation') and wall_el.orientation is not None else None
            
            debug_info['chosen_normal'] = chosen_normal
            debug_info['orientation360'] = orientation
            debug_info['fallback_used'] = True
            
            if chosen_normal == '+normal':
                # +normal points outward → use -normal (perp_x2, perp_y2) for inward offset
                perp_x, perp_y = perp_x2, perp_y2
                debug_info['offset_direction'] = '-normal (perp_x2, chosen_normal fallback)'
            elif chosen_normal == '-normal':
                # -normal points outward → use +normal (perp_x1, perp_y1) for inward offset
                perp_x, perp_y = perp_x1, perp_y1
                debug_info['offset_direction'] = '+normal (perp_x1, chosen_normal fallback)'
            elif orientation is not None:
                # Convert orientation360 (geographical azimuth) to radians
                # Orientation360: 0°=N, 90°=E, 180°=S, 270°=W
                # Convert to mathematical: subtract 90° (0°=E, 90°=N)
                orientation_math = (orientation - 90) * math.pi / 180.0
                
                # Outward normal direction
                outward_nx = math.sin(orientation_math)
                outward_ny = math.cos(orientation_math)
                
                # Inward normal is opposite
                inward_nx = -outward_nx
                inward_ny = -outward_ny
                
                # Choose the perpendicular vector closest to inward direction
                dot1 = perp_x1 * inward_nx + perp_y1 * inward_ny
                dot2 = perp_x2 * inward_nx + perp_y2 * inward_ny
                
                debug_info['inward_normal'] = (inward_nx, inward_ny)
                debug_info['dot1'] = dot1
                debug_info['dot2'] = dot2
                
                if dot2 > dot1:
                    perp_x, perp_y = perp_x2, perp_y2
                    debug_info['offset_direction'] = '-normal (perp_x2, orientation360 fallback)'
                else:
                    perp_x, perp_y = perp_x1, perp_y1
                    debug_info['offset_direction'] = '+normal (perp_x1, orientation360 fallback)'
            else:
                # Default: use first perpendicular (can be refined)
                perp_x, perp_y = perp_x1, perp_y1
                debug_info['offset_direction'] = '+normal (perp_x1, default fallback)'
        
        # Offset both endpoints inward
        offset_p0 = (
            p0[0] + perp_x * thickness_m,
            p0[1] + perp_y * thickness_m,
            p0[2] if len(p0) > 2 else 0.0
        )
        offset_p1 = (
            p1[0] + perp_x * thickness_m,
            p1[1] + perp_y * thickness_m,
            p1[2] if len(p1) > 2 else 0.0
        )
        
        debug_info['p0_after'] = offset_p0
        debug_info['p1_after'] = offset_p1
        debug_info['offset_vector'] = (perp_x * thickness_m, perp_y * thickness_m)
        
        # Log debug info to audit collector if available
        if self.audit_collector:
            try:
                self.audit_collector.records.append({
                    'type': 'WallOffsetDebug',
                    **debug_info
                })
            except Exception:
                pass
        
        # Update wall coordinates
        wall_el.coordinates = [offset_p0, offset_p1]
        
        # Recalculate width (should be unchanged, but recalculate for consistency)
        wall_el.width = math.hypot(offset_p1[0] - offset_p0[0], offset_p1[1] - offset_p0[1])
        
        return True
    
    def _offset_polygon_element(self, element: IfcElement, thickness_m: float) -> bool:
        """Offset a polygon element's vertices inward along face normal.
        
        Args:
            element: Floor or roof element with polygon coordinates
            thickness_m: Thickness to offset inward (meters)
        
        Returns:
            True if offset succeeded, False otherwise
        """
        if not element.coordinates or len(element.coordinates) < 3:
            return False
        
        vertices = element.coordinates
        
        # Calculate face normal from polygon vertices
        # Use first three vertices to compute normal
        v0 = vertices[0]
        v1 = vertices[1]
        v2 = vertices[2] if len(vertices) > 2 else vertices[0]
        
        # Calculate two edge vectors
        edge1 = (v1[0] - v0[0], v1[1] - v0[1], (v1[2] if len(v1) > 2 else v0[2]) - (v0[2] if len(v0) > 2 else 0.0))
        edge2 = (v2[0] - v0[0], v2[1] - v0[1], (v2[2] if len(v2) > 2 else v0[2]) - (v0[2] if len(v0) > 2 else 0.0))
        
        # Cross product to get normal
        nx = edge1[1] * edge2[2] - edge1[2] * edge2[1]
        ny = edge1[2] * edge2[0] - edge1[0] * edge2[2]
        nz = edge1[0] * edge2[1] - edge1[1] * edge2[0]
        
        # Normalize
        norm_length = math.sqrt(nx*nx + ny*ny + nz*nz)
        if norm_length < 1e-9:
            return False  # Degenerate polygon
        
        nx /= norm_length
        ny /= norm_length
        nz /= norm_length
        
        # For floors (upward normal), we want to offset downward (negative Z)
        # For roofs (downward normal), we want to offset upward (positive Z)
        # But in external mode, we're offsetting inward, so we offset opposite to normal
        offset_x = -nx * thickness_m
        offset_y = -ny * thickness_m
        offset_z = -nz * thickness_m
        
        # Offset all vertices
        offset_vertices = []
        for v in vertices:
            x = v[0]
            y = v[1]
            z = v[2] if len(v) > 2 else 0.0
            offset_vertices.append((
                x + offset_x,
                y + offset_y,
                z + offset_z
            ))
        
        # Update element coordinates
        element.coordinates = offset_vertices
        
        # Recalculate area using Shoelace formula
        area = 0.0
        n = len(offset_vertices)
        for i in range(n):
            v0 = offset_vertices[i]
            v1 = offset_vertices[(i+1) % n]
            area += v0[0]*v1[1] - v1[0]*v0[1]
        element.area = abs(area) * 0.5
        
        return True
    
    def _offset_elements(self, model: IfcModel, wall_thickness_m: float, 
                        floor_thickness_m: Optional[float] = None, 
                        roof_thickness_m: Optional[float] = None) -> Dict[str, int]:
        """Offset all elements in the model inward by specified thicknesses.
        
        Args:
            model: IfcModel with walls, floors, and roofs
            wall_thickness_m: Thickness to offset walls (meters)
            floor_thickness_m: Thickness to offset floors (meters, defaults to wall_thickness_m)
            roof_thickness_m: Thickness to offset roofs (meters, defaults to wall_thickness_m)
        
        Returns:
            Dict with counts: {'walls_offset': int, 'floors_offset': int, 'roofs_offset': int, 'failures': int}
        """
        if floor_thickness_m is None:
            floor_thickness_m = wall_thickness_m
        if roof_thickness_m is None:
            roof_thickness_m = wall_thickness_m
        
        results = {
            'walls_offset': 0,
            'floors_offset': 0,
            'roofs_offset': 0,
            'failures': 0
        }
        
        # Rebuild floor polygon index BEFORE offsetting (use original floor coordinates)
        # This is needed for the epsilon test in _offset_wall_element()
        floor_polygons = self._build_floor_polygon_index(model)
        
        # Offset walls (pass floor_polygons for epsilon test)
        for wall in model.walls:
            if self._offset_wall_element(wall, wall_thickness_m, floor_polygons):
                results['walls_offset'] += 1
            else:
                results['failures'] += 1
        
        # Offset floors
        for floor in model.floors:
            if self._offset_polygon_element(floor, floor_thickness_m):
                results['floors_offset'] += 1
            else:
                results['failures'] += 1
        
        # Offset roofs
        for roof in model.roofs:
            if self._offset_polygon_element(roof, roof_thickness_m):
                results['roofs_offset'] += 1
            else:
                results['failures'] += 1
        
        # Log offset results in audit
        if self.audit_collector:
            try:
                self.audit_collector.records.append({
                    'type': 'ExternalModeOffset',
                    'wall_thickness_m': wall_thickness_m,
                    'floor_thickness_m': floor_thickness_m,
                    'roof_thickness_m': roof_thickness_m,
                    'walls_offset': results['walls_offset'],
                    'floors_offset': results['floors_offset'],
                    'roofs_offset': results['roofs_offset'],
                    'failures': results['failures'],
                    'total_elements': len(model.walls) + len(model.floors) + len(model.roofs)
                })
            except Exception:
                pass
        
        return results

    def _extract_external_massing_model(self, wall_thickness_m: float, 
                                       floor_thickness_m: Optional[float] = None,
                                       roof_thickness_m: Optional[float] = None) -> IfcModel:
        """Build an IfcModel using face-based extraction from external massing solids.
        
        Uses the common pipeline to extract elements with orientation (on original geometry),
        then offsets elements inward and merges polygons. Snip/trim is not applied here
        (using canvas trim function instead to preserve offset calculation).
        
        Args:
            wall_thickness_m: Thickness to offset walls inward (meters)
            floor_thickness_m: Thickness to offset floors inward (meters, defaults to wall_thickness_m)
            roof_thickness_m: Thickness to offset roofs inward (meters, defaults to wall_thickness_m)
        
        Returns:
            IfcModel with offset elements (not trimmed - use canvas trim function)
        """
        if wall_thickness_m <= 0:
            raise ValueError(f"wall_thickness_m must be > 0, got {wall_thickness_m}")
        
        # Use common pipeline to extract faces and create elements with orientation (on original geometry)
        model = self._extract_faces_to_elements_common()
        
        # Offset all elements inward (preserves orientation)
        offset_results = self._offset_elements(model, wall_thickness_m, floor_thickness_m, roof_thickness_m)
        
        # Merge adjacent floor polygons (on offset polygons)
        if model.floors:
            floors_before = len(model.floors)
            merged_floors = self._merge_adjacent_polygons(model.floors, 'floor')
            floors_after = len(merged_floors)
            if floors_before != floors_after and self.audit_collector:
                try:
                    self.audit_collector.records.append({
                        'type': 'FloorMergingResult',
                        'before': floors_before,
                        'after': floors_after,
                        'merged': floors_before - floors_after,
                        'note': 'Merged after offset'
                    })
                except Exception:
                    pass
            model.floors = merged_floors
        
        # Merge adjacent roof polygons (on offset polygons)
        if model.roofs:
            roofs_before = len(model.roofs)
            merged_roofs = self._merge_adjacent_polygons(model.roofs, 'roof')
            roofs_after = len(merged_roofs)
            if roofs_before != roofs_after and self.audit_collector:
                try:
                    self.audit_collector.records.append({
                        'type': 'RoofMergingResult',
                        'before': roofs_before,
                        'after': roofs_after,
                        'merged': roofs_before - roofs_after,
                        'note': 'Merged after offset'
                    })
                except Exception:
                    pass
            model.roofs = merged_roofs
        
        # Snip/trim removed - using canvas trim function instead
        # This preserves the offset calculation without modifying coordinates
        
        return model
        
    def _merge_adjacent_polygons(self, polygons: List[IfcElement], element_type: str) -> List[IfcElement]:
        """Merge polygons that share edges (exact vertex matching).
        
        Polygons are merged within the same floor_index. Uses exact vertex matching
        first, leveraging the fact that vertex order comes from IFC face indices.
        
        Args:
            polygons: List of floor/roof elements with coordinates
            element_type: 'floor' or 'roof' for naming
            
        Returns:
            List of merged polygons with recalculated areas
        """
        if not polygons:
            return []
        
        # Group polygons by floor_index
        from collections import defaultdict
        polygons_by_floor = defaultdict(list)
        for poly in polygons:
            floor_index = poly.storey.get('floor_index', 0) if poly.storey else 0
            polygons_by_floor[floor_index].append(poly)
        
        merged_result = []
        debug_info = []
        
        for floor_index, floor_polygons in polygons_by_floor.items():
            if len(floor_polygons) <= 1:
                # No merging needed
                merged_result.extend(floor_polygons)
                continue
            
            debug_info.append(f"Floor {floor_index}: {len(floor_polygons)} {element_type}s")
            
            # Build edge-to-polygon map (exact matches only)
            # Edge is stored as tuple of (x,y) coordinates, normalized to handle both directions
            edge_to_polygons = defaultdict(list)
            polygon_edges = {}  # polygon_id -> list of edges
            
            for idx, poly in enumerate(floor_polygons):
                if not poly.coordinates or len(poly.coordinates) < 3:
                    continue
                
                # Extract 2D edges (x,y only, ignore z)
                edges = []
                coords_2d = [(c[0], c[1]) for c in poly.coordinates]
                n = len(coords_2d)
                
                for i in range(n):
                    v0 = coords_2d[i]
                    v1 = coords_2d[(i+1) % n]
                    # Normalize edge: always store as (min, max) tuple for direction independence
                    edge = tuple(sorted([v0, v1]))
                    edges.append((edge, v0, v1))  # Store normalized edge + original direction
                    edge_to_polygons[edge].append(idx)
                
                polygon_edges[idx] = edges
            
            # Count shared edges
            shared_edges_count = sum(1 for indices in edge_to_polygons.values() if len(indices) >= 2)
            debug_info.append(f"  Found {shared_edges_count} shared edges")
            
            # Find connected components using union-find
            parent = list(range(len(floor_polygons)))
            
            def find(x):
                if parent[x] != x:
                    parent[x] = find(parent[x])  # Path compression
                return parent[x]
            
            def union(x, y):
                px, py = find(x), find(y)
                if px != py:
                    parent[px] = py
            
            # Union polygons that share edges
            unions_made = 0
            for edge, poly_indices in edge_to_polygons.items():
                if len(poly_indices) >= 2:
                    # All polygons sharing this edge are connected
                    for i in range(len(poly_indices) - 1):
                        if find(poly_indices[i]) != find(poly_indices[i+1]):
                            union(poly_indices[i], poly_indices[i+1])
                            unions_made += 1
            
            debug_info.append(f"  Made {unions_made} unions")
            
            # Group polygons by component
            components = defaultdict(list)
            for idx, poly in enumerate(floor_polygons):
                root = find(idx)
                components[root].append(idx)
            
            debug_info.append(f"  Found {len(components)} components")
            
            # Merge each component
            merged_count = 0
            for component_indices in components.values():
                if len(component_indices) == 1:
                    # Single polygon, no merging needed
                    merged_result.append(floor_polygons[component_indices[0]])
                else:
                    debug_info.append(f"  Merging component with {len(component_indices)} polygons")
                    # Merge polygons in this component
                    merged_poly = self._merge_polygon_component(
                        [floor_polygons[i] for i in component_indices],
                        polygon_edges,
                        component_indices,
                        element_type
                    )
                    if merged_poly:
                        merged_result.append(merged_poly)
                        merged_count += 1
            
            debug_info.append(f"  Merged {merged_count} components")
        
        # Log debug info to audit collector (always log to verify function is called)
        if self.audit_collector:
            try:
                self.audit_collector.records.append({
                    'type': f'{element_type.capitalize()}PolygonMerging',
                    'debug': debug_info if debug_info else ['No polygons to process or no shared edges found'],
                    'input_count': len(polygons),
                    'output_count': len(merged_result),
                    'polygons_with_coords': sum(1 for p in polygons if p.coordinates and len(p.coordinates) >= 3),
                    'polygons_by_floor': {k: len(v) for k, v in polygons_by_floor.items()} if 'polygons_by_floor' in locals() else {}
                })
            except Exception:
                pass
        
        return merged_result
    
    def _merge_polygon_component(self, polygons: List[IfcElement], 
                                  polygon_edges: Dict[int, List], 
                                  polygon_indices: List[int],
                                  element_type: str) -> Optional[IfcElement]:
        """Merge a connected component of polygons.
        
        Args:
            polygons: List of polygons to merge
            polygon_edges: Dict mapping polygon index to list of (edge, v0, v1) tuples
            polygon_indices: Original indices of polygons in the component
            element_type: 'floor' or 'roof' for naming
            
        Returns:
            Merged polygon element or None if merge fails
        """
        if not polygons:
            return None
        
        if len(polygons) == 1:
            return polygons[0]
        
        # Start with the largest polygon (by area) as seed
        seed_idx = max(range(len(polygons)), key=lambda i: polygons[i].area or 0)
        seed_poly = polygons[seed_idx]
        merged_coords_2d = [(c[0], c[1]) for c in seed_poly.coordinates]
        merged_coords_3d = list(seed_poly.coordinates)
        
        # Track which polygons have been merged
        merged = {seed_idx}
        
        # Continue merging until all polygons are merged
        while len(merged) < len(polygons):
            progress_made = False
            
            for poly_idx, poly in enumerate(polygons):
                if poly_idx in merged:
                    continue
                
                # Find shared edge between merged polygon and this polygon
                shared_edge_info = self._find_shared_edge(
                    merged_coords_2d, 
                    polygon_edges[polygon_indices[poly_idx]]
                )
                
                if shared_edge_info:
                    # Merge this polygon into merged_coords
                    merged_coords_2d, merged_coords_3d = self._insert_polygon_at_edge(
                        merged_coords_2d,
                        merged_coords_3d,
                        poly.coordinates,
                        shared_edge_info
                    )
                    merged.add(poly_idx)
                    progress_made = True
                    break
            
            if not progress_made:
                # No more merges possible (shouldn't happen if component is connected)
                break
        
        # Deduplicate consecutive vertices (exact match)
        merged_coords_2d = self._deduplicate_consecutive_vertices_2d(merged_coords_2d)
        merged_coords_3d = self._deduplicate_consecutive_vertices_3d(merged_coords_3d)
        
        # Ensure we have at least 3 vertices
        if len(merged_coords_3d) < 3:
            return polygons[0]  # Return first polygon if merge failed
        
        # Create merged element
        merged_element = IfcElement(
            id=polygons[0].id,
            type=polygons[0].type,
            name=f"{element_type.capitalize()}_merged_{polygons[0].id}"
        )
        merged_element.coordinates = merged_coords_3d
        
        # Recalculate area using Shoelace formula
        area = 0.0
        n = len(merged_coords_3d)
        for i in range(n):
            v0 = merged_coords_3d[i]
            v1 = merged_coords_3d[(i+1) % n]
            area += v0[0]*v1[1] - v1[0]*v0[1]
        merged_element.area = abs(area) * 0.5
        
        merged_element.storey = polygons[0].storey
        
        return merged_element
    
    def _find_shared_edge(self, merged_coords_2d: List[Tuple[float, float]], 
                          polygon_edges: List) -> Optional[Dict]:
        """Find an edge shared between merged polygon and another polygon.
        
        Uses exact coordinate matching (no tolerance).
        
        Returns dict with:
        - 'merged_edge_idx': index of edge in merged_coords_2d
        - 'poly_edge': (edge, v0, v1) tuple from polygon_edges
        - 'direction_match': True if directions match, False if opposite
        """
        n = len(merged_coords_2d)
        for i in range(n):
            v0 = merged_coords_2d[i]
            v1 = merged_coords_2d[(i+1) % n]
            # Normalize edge for comparison (sorted tuple handles both directions)
            merged_edge_normalized = tuple(sorted([v0, v1]))
            
            for poly_edge_normalized, poly_v0, poly_v1 in polygon_edges:
                # Compare normalized edges (exact match)
                if poly_edge_normalized == merged_edge_normalized:
                    # Found shared edge - check direction
                    # direction_match: True if both go same direction (v0→v1 == poly_v0→poly_v1)
                    direction_match = (v0 == poly_v0 and v1 == poly_v1)
                    return {
                        'merged_edge_idx': i,
                        'poly_edge': (poly_edge_normalized, poly_v0, poly_v1),
                        'direction_match': direction_match
                    }
        return None
    
    def _insert_polygon_at_edge(self, merged_coords_2d: List[Tuple[float, float]],
                                merged_coords_3d: List[Tuple[float, float, float]],
                                poly_coords: List[Tuple[float, float, float]],
                                shared_edge_info: Dict) -> Tuple[List, List]:
        """Insert polygon's remaining vertex into merged polygon at shared edge.
        
        Args:
            merged_coords_2d: Current merged polygon (2D)
            merged_coords_3d: Current merged polygon (3D)
            poly_coords: Polygon to merge in
            shared_edge_info: Info about shared edge from _find_shared_edge
            
        Returns:
            (new_merged_coords_2d, new_merged_coords_3d)
        """
        merged_edge_idx = shared_edge_info['merged_edge_idx']
        poly_edge_normalized, poly_v0, poly_v1 = shared_edge_info['poly_edge']
        direction_match = shared_edge_info['direction_match']
        
        # Find the third vertex in poly_coords (the one not on the shared edge)
        poly_coords_2d = [(c[0], c[1]) for c in poly_coords]
        third_vertex_2d = None
        third_vertex_3d = None
        
        for i, coord_2d in enumerate(poly_coords_2d):
            if coord_2d != poly_v0 and coord_2d != poly_v1:
                third_vertex_2d = coord_2d
                third_vertex_3d = poly_coords[i]
                break
        
        if third_vertex_2d is None:
            # Shouldn't happen, but return original if it does
            return merged_coords_2d, merged_coords_3d
        
        # Insert third vertex after the second vertex of the shared edge
        # If directions match: insert after v1
        # If directions are opposite: insert after v0 (before v1)
        if direction_match:
            # Merged: A→B, Polygon: A→B, insert third vertex after B
            insert_idx = (merged_edge_idx + 1) % len(merged_coords_2d)
        else:
            # Merged: A→B, Polygon: B→A, insert third vertex after A (before B)
            insert_idx = merged_edge_idx + 1
        
        # Insert vertex
        new_merged_coords_2d = merged_coords_2d[:insert_idx] + [third_vertex_2d] + merged_coords_2d[insert_idx:]
        new_merged_coords_3d = merged_coords_3d[:insert_idx] + [third_vertex_3d] + merged_coords_3d[insert_idx:]
        
        return new_merged_coords_2d, new_merged_coords_3d
    
    def _deduplicate_consecutive_vertices_2d(self, coords: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        """Remove consecutive duplicate vertices (exact match)."""
        if not coords:
            return []
        result = [coords[0]]
        for coord in coords[1:]:
            if coord != result[-1]:
                result.append(coord)
        # Also check wrap-around (first and last)
        if len(result) > 1 and result[0] == result[-1]:
            result.pop()
        return result
    
    def _deduplicate_consecutive_vertices_3d(self, coords: List[Tuple[float, float, float]]) -> List[Tuple[float, float, float]]:
        """Remove consecutive duplicate vertices (exact match)."""
        if not coords:
            return []
        result = [coords[0]]
        for coord in coords[1:]:
            if coord != result[-1]:
                result.append(coord)
        # Also check wrap-around (first and last)
        if len(result) > 1 and result[0] == result[-1]:
            result.pop()
        return result

    # ===== Phase 5: Snip/Trim pass for walls (raw mode) =====
    def _snip_trim_walls(self, ifc_model: IfcModel, snap_tol_m: float = 0.02) -> Dict[str, int]:
        """Shorten overlapping/overrunning wall segments so endpoints meet cleanly.
        
        Process:
        1. Snap/Extend: Extend walls to intersections within snap_tol_m (for concave sections)
        2. Trim: Shorten overlapping colinear segments (pure translation, no tolerance)
        3. Orthogonal Extensions: Extend walls orthogonally to fill gaps (edges not touching)
        
        - Operates in 2D (x,y), preserves orientation (segment direction).
        - Snaps endpoints to nearby intersections within tolerance.
        - Trimming is pure translation (no snapping tolerance).
        Returns counters for audit.
        """
        def seg2d(w):
            if not w.coordinates or len(w.coordinates) < 2:
                return None
            (x1,y1,_),(x2,y2,_) = w.coordinates[0], w.coordinates[1]
            return [x1,y1,x2,y2]
        def length2(x1,y1,x2,y2):
            import math
            return math.hypot(x2-x1,y2-y1)
        # Use consolidated colinearity check
        def line_intersection(a,b):
            # Returns (ix,iy) or None if parallel; checks bbox hit separately
            ax,ay,bx,by = a
            cx,cy,dx,dy = b
            den = (ax-bx)*(cy-dy) - (ay-by)*(cx-dx)
            if abs(den) < 1e-9:
                return None
            t = ((ax-cx)*(cy-dy) - (ay-cy)*(cx-dx)) / den
            ix = ax + t*(bx-ax)
            iy = ay + t*(by-ay)
            return (ix,iy)
        def on_segment(a, p, tol=1e-6):
            ax,ay,bx,by = a
            ix,iy = p
            if min(ax,bx)-tol <= ix <= max(ax,bx)+tol and min(ay,by)-tol <= iy <= max(ay,by)+tol:
                return True
            return False
        def dist2(p,q):
            import math
            return math.hypot(p[0]-q[0], p[1]-q[1])

        # Group by floor_index to avoid cross-floor interactions
        floor_to_walls: Dict[int, List[Any]] = {}
        for w in ifc_model.walls:
            if seg2d(w) is None:
                continue
            floor_index = 0
            try:
                floor_index = self._get_floor_level_index(w.storey, ifc_model.storeys)
            except Exception:
                floor_index = 0
            floor_to_walls.setdefault(int(floor_index), []).append(w)

        snaps = trims = 0
        for floor_index, walls in floor_to_walls.items():
            # Pairwise snap/extend to intersections
            for i in range(len(walls)):
                for j in range(i+1, len(walls)):
                    a = seg2d(walls[i]); b = seg2d(walls[j])
                    if a is None or b is None: continue
                    inter = line_intersection(a,b)
                    if inter is None:
                        # log no_intersection
                        try:
                            self.audit_collector.records.append({
                                "type": "SnipTrimPair",
                                "floor": int(floor_index),
                                "a": getattr(walls[i], 'name', None) or str(getattr(walls[i], 'id', '')),
                                "b": getattr(walls[j], 'name', None) or str(getattr(walls[j], 'id', '')),
                                "decision": "skipped",
                                "reason": "no_intersection"
                            })
                        except Exception:
                            pass
                        continue
                    # Allow extend-to-intersection when within tolerance
                    ax,ay,bx,by = a; cx,cy,dx,dy = b
                    ends_a = [(ax,ay),(bx,by)]
                    ends_b = [(cx,cy),(dx,dy)]
                    ea = min(ends_a, key=lambda p: dist2(p,inter))
                    eb = min(ends_b, key=lambda p: dist2(p,inter))
                    snapped_a = False; snapped_b = False
                    # extend/snap side A
                    if dist2(ea, inter) <= snap_tol_m:
                        # Check if extending would make wall zero-width
                        new_p0 = (round(inter[0],3), round(inter[1],3), walls[i].coordinates[0][2]) if ea == (ax,ay) else walls[i].coordinates[0]
                        new_p1 = (round(inter[0],3), round(inter[1],3), walls[i].coordinates[1][2]) if ea != (ax,ay) else walls[i].coordinates[1]
                        new_width = length2(new_p0[0], new_p0[1], new_p1[0], new_p1[1])
                        
                        if new_width >= 0.01:  # Only extend if wall remains >= 1cm
                            if ea == (ax,ay):
                                walls[i].coordinates[0] = (round(inter[0],3), round(inter[1],3), walls[i].coordinates[0][2])
                            else:
                                walls[i].coordinates[1] = (round(inter[0],3), round(inter[1],3), walls[i].coordinates[1][2])
                            walls[i].width = new_width
                            snaps += 1; trims += 1; snapped_a = True
                    # extend/snap side B
                    if dist2(eb, inter) <= snap_tol_m:
                        # Check if extending would make wall zero-width
                        new_p0 = (round(inter[0],3), round(inter[1],3), walls[j].coordinates[0][2]) if eb == (cx,cy) else walls[j].coordinates[0]
                        new_p1 = (round(inter[0],3), round(inter[1],3), walls[j].coordinates[1][2]) if eb != (cx,cy) else walls[j].coordinates[1]
                        new_width = length2(new_p0[0], new_p0[1], new_p1[0], new_p1[1])
                        
                        if new_width >= 0.01:  # Only extend if wall remains >= 1cm
                            if eb == (cx,cy):
                                walls[j].coordinates[0] = (round(inter[0],3), round(inter[1],3), walls[j].coordinates[0][2])
                            else:
                                walls[j].coordinates[1] = (round(inter[0],3), round(inter[1],3), walls[j].coordinates[1][2])
                            walls[j].width = new_width
                            snaps += 1; trims += 1; snapped_b = True
                    # log decision
                    try:
                        self.audit_collector.records.append({
                            "type": "SnipTrimPair",
                            "floor": int(floor_index),
                            "a": getattr(walls[i], 'name', None) or str(getattr(walls[i], 'id', '')),
                            "b": getattr(walls[j], 'name', None) or str(getattr(walls[j], 'id', '')),
                            "intersection": {"x": round(inter[0],3), "y": round(inter[1],3)},
                            "distances": {
                                "a": round(dist2(ea, inter), 4),
                                "b": round(dist2(eb, inter), 4)
                            },
                            "snap_tol_m": snap_tol_m,
                            "snapped_a": snapped_a,
                            "snapped_b": snapped_b,
                            "decision": "snapped" if (snapped_a or snapped_b) else "skipped",
                            "reason": None if (snapped_a or snapped_b) else "endpoint_farther_than_tol"
                        })
                    except Exception:
                        pass

            # Colinear overlap trimming (simple): shorten the later wall to avoid overlap
            # BUT: Don't trim if it would make the wall zero-width
            for i in range(len(walls)):
                for j in range(i+1, len(walls)):
                    a = seg2d(walls[i]); b = seg2d(walls[j])
                    if a is None or b is None: continue
                    ax,ay,bx,by = a; cx,cy,dx,dy = b
                    if not self._is_colinear(((ax,ay),(bx,by)), ((cx,cy),(dx,dy))):
                        continue
                    use_x = abs(bx-ax) >= abs(by-ay)
                    if use_x:
                        a1,a2 = sorted([ax,bx]); b1,b2 = sorted([cx,dx])
                    else:
                        a1,a2 = sorted([ay,by]); b1,b2 = sorted([cy,dy])
                    overlap1 = max(a1,b1); overlap2 = min(a2,b2)
                    # Only trim if there's actual overlap (overlap2 > overlap1)
                    # No tolerance check - pure translation based on actual overlap
                    if overlap2 > overlap1:
                        # Calculate what the new wall length would be after trimming
                        # The trimmed wall should be the overlap region
                        new_length = overlap2 - overlap1
                        if new_length < 0.01:  # Don't trim if it would make wall < 1cm
                            continue
                        
                        # Calculate current wall length
                        current_length = length2(cx,cy,dx,dy)
                        
                        # Only trim if the new length is reasonable (at least 1cm and not more than 50% reduction)
                        # But also allow trimming if the overlap is significant (wall is mostly overlapping)
                        overlap_ratio = new_length / current_length if current_length > 0 else 0
                        
                        # Trim if: new length >= 1cm AND (overlap is > 50% of wall OR new length is > 50% of original)
                        if new_length >= 0.01 and (overlap_ratio > 0.5 or new_length >= current_length * 0.5):
                            if use_x:
                                if abs(cx - overlap2) < abs(dx - overlap2):
                                    walls[j].coordinates[0] = (round(overlap1,3), cy, walls[j].coordinates[0][2])
                                else:
                                    walls[j].coordinates[1] = (round(overlap2,3), dy, walls[j].coordinates[1][2])
                            else:
                                if abs(cy - overlap2) < abs(dy - overlap2):
                                    walls[j].coordinates[0] = (cx, round(overlap1,3), walls[j].coordinates[0][2])
                                else:
                                    walls[j].coordinates[1] = (dx, round(overlap2,3), walls[j].coordinates[1][2])
                            trims += 1
                            
                            # Recalculate width after trim
                            new_seg = seg2d(walls[j])
                            if new_seg:
                                nx1,ny1,nx2,ny2 = new_seg
                                walls[j].width = length2(nx1,ny1,nx2,ny2)
                                
                                # Final safety check: if width is now zero, revert the change
                                if walls[j].width < 0.01:
                                    # Revert by restoring original coordinates (approximate)
                                    walls[j].coordinates[0] = (cx, cy, walls[j].coordinates[0][2])
                                    walls[j].coordinates[1] = (dx, dy, walls[j].coordinates[1][2])
                                    walls[j].width = current_length
                                    trims -= 1

            # Second pass: Trim single extensions (where one wall extends beyond another)
            # This handles T-junctions and L-junctions where only one wall extends past another
            for i in range(len(walls)):
                for j in range(len(walls)):
                    if i == j: continue
                    a = seg2d(walls[i]); b = seg2d(walls[j])
                    if a is None or b is None: continue
                    ax,ay,bx,by = a; cx,cy,dx,dy = b
                    
                    # Skip if colinear (handled in previous pass)
                    if self._is_colinear(((ax,ay),(bx,by)), ((cx,cy),(dx,dy))):
                        continue
                    
                    # Find intersection
                    inter = line_intersection(a, b)
                    if inter is None:
                        continue
                    
                    # Check if intersection lies on wall B's segment (within tolerance)
                    if not on_segment(b, inter, tol=snap_tol_m):
                        continue
                    
                    # Check if wall A's endpoint extends beyond wall B's line segment
                    # We want to trim wall A if one of its endpoints extends past the intersection
                    ends_a = [(ax,ay),(bx,by)]
                    for endpoint_idx, endpoint in enumerate(ends_a):
                        dist_to_inter = dist2(endpoint, inter)
                        if dist_to_inter < snap_tol_m:
                            continue  # Already at intersection, skip
                        
                        # Check if endpoint extends beyond intersection along wall A's direction
                        # Vector from intersection to endpoint
                        vec_to_end = (endpoint[0] - inter[0], endpoint[1] - inter[1])
                        # Vector along wall A (from p0 to p1)
                        vec_a = (bx - ax, by - ay)
                        # Dot product: if positive, endpoint is in direction of wall A from intersection
                        dot = vec_to_end[0] * vec_a[0] + vec_to_end[1] * vec_a[1]
                        
                        if dot > 0:  # Endpoint extends in wall A's direction from intersection
                            # Verify endpoint is actually beyond wall B's segment
                            # Check distance from endpoint to wall B's line
                            # If endpoint is beyond intersection and beyond wall B's endpoints, trim it
                            dist_to_b_p0 = dist2(endpoint, (cx, cy))
                            dist_to_b_p1 = dist2(endpoint, (dx, dy))
                            dist_b_length = dist2((cx, cy), (dx, dy))
                            
                            # If endpoint is farther from both B endpoints than the intersection is,
                            # then endpoint extends beyond wall B
                            dist_inter_to_b_p0 = dist2(inter, (cx, cy))
                            dist_inter_to_b_p1 = dist2(inter, (dx, dy))
                            
                            if (dist_to_b_p0 > dist_inter_to_b_p0 + snap_tol_m or 
                                dist_to_b_p1 > dist_inter_to_b_p1 + snap_tol_m):
                                # Endpoint extends beyond wall B, trim wall A to intersection
                                other_end = ends_a[1 - endpoint_idx]
                                new_length = dist2(other_end, inter)
                                
                                if new_length >= 0.01:  # Only trim if wall remains >= 1cm
                                    # Trim wall A to intersection
                                    if endpoint_idx == 0:
                                        walls[i].coordinates[0] = (round(inter[0],3), round(inter[1],3), walls[i].coordinates[0][2])
                                    else:
                                        walls[i].coordinates[1] = (round(inter[0],3), round(inter[1],3), walls[i].coordinates[1][2])
                                    walls[i].width = new_length
                                    trims += 1
                                    
                                    # Log the trim
                                    try:
                                        self.audit_collector.records.append({
                                            "type": "SnipTrimSingle",
                                            "floor": int(floor_index),
                                            "wall": getattr(walls[i], 'name', None) or str(getattr(walls[i], 'id', '')),
                                            "trimmed_by": getattr(walls[j], 'name', None) or str(getattr(walls[j], 'id', '')),
                                            "intersection": {"x": round(inter[0],3), "y": round(inter[1],3)},
                                            "endpoint": {"x": round(endpoint[0],3), "y": round(endpoint[1],3)},
                                            "distance": round(dist_to_inter, 4),
                                            "new_length": round(new_length, 4)
                                        })
                                    except Exception:
                                        pass
                                    break  # Only trim one endpoint per wall per iteration

            # Endpoint coalescing within tolerance (stabilize junctions)
            # Also recalculate widths after all operations to catch any zero-width walls
            for w in walls:
                a = seg2d(w)
                if a is None: continue
                ax,ay,bx,by = a
                # Round to 3 decimals for stability
                w.coordinates[0] = (round(ax,3), round(ay,3), w.coordinates[0][2])
                w.coordinates[1] = (round(bx,3), round(by,3), w.coordinates[1][2])
                # Recalculate width after all operations
                w.width = length2(ax,ay,bx,by)

    def _validate_wall_graph(self, ifc_model: IfcModel, tol: float = 0.02) -> Dict[str, Any]:
        """Validate that trimmed walls meet cleanly and residual overlaps are minimal.
        Produces simple metrics suitable for audit: intersections_ok, residual_overlaps, isolated_endpoints.
        """
        def seg2d(w):
            if not w.coordinates or len(w.coordinates) < 2:
                return None
            (x1,y1,_),(x2,y2,_) = w.coordinates[0], w.coordinates[1]
            return [x1,y1,x2,y2]
        def line_intersection(a,b):
            ax,ay,bx,by = a; cx,cy,dx,dy = b
            den = (ax-bx)*(cy-dy) - (ay-by)*(cx-dx)
            if abs(den) < 1e-9:
                return None
            t = ((ax-cx)*(cy-dy) - (ay-cy)*(cx-dx)) / den
            ix = ax + t*(bx-ax)
            iy = ay + t*(by-ay)
            return (ix,iy)
        def on_segment(a, p, tol2=1e-6):
            ax,ay,bx,by = a; ix,iy = p
            return (min(ax,bx)-tol2 <= ix <= max(ax,bx)+tol2) and (min(ay,by)-tol2 <= iy <= max(ay,by)+tol2)
        def d2(p,q):
            import math
            return math.hypot(p[0]-q[0], p[1]-q[1])
        # Per-floor validation and top residuals
        floor_to_walls: Dict[int, List[Any]] = {}
        for w in ifc_model.walls:
            if seg2d(w) is None:
                continue
            try:
                floor_index = self._get_floor_level_index(w.storey, ifc_model.storeys)
            except Exception:
                floor_index = 0
            floor_to_walls.setdefault(int(floor_index), []).append(w)

        summary = {"intersections_ok": 0, "residual_overlaps": 0, "isolated_endpoints": 0, "exact_junctions": 0}
        per_floor = {}
        top = []
        for fi, walls in floor_to_walls.items():
            intersections_ok = residual_overlaps = exact_junctions = 0
            # Check pair intersections per floor
            for i in range(len(walls)):
                for j in range(i+1,len(walls)):
                    a = seg2d(walls[i]); b = seg2d(walls[j])
                    if a is None or b is None: continue
                    inter = line_intersection(a,b)
                    if inter and on_segment(a,inter) and on_segment(b,inter):
                        ax,ay,bx,by = a; cx,cy,dx,dy = b
                        ends_a = [(ax,ay),(bx,by)]; ends_b=[(cx,cy),(dx,dy)]
                        ea = min(ends_a, key=lambda p: d2(p,inter))
                        eb = min(ends_b, key=lambda p: d2(p,inter))
                        da, db = d2(ea,inter), d2(eb,inter)
                        if da <= tol and db <= tol:
                            intersections_ok += 1
                            # both endpoints coincide with intersection → exact junction
                            exact_junctions += 1
                        else:
                            residual_overlaps += 1
                            top.append({"floor": fi, "a": walls[i].name or str(walls[i].id), "b": walls[j].name or str(walls[j].id), "da": round(da,3), "db": round(db,3)})
            # Isolated endpoints per floor
            endpoints = []
            for w in walls:
                a = seg2d(w);
                if a is None: continue
                ax,ay,bx,by = a
                endpoints.append((ax,ay)); endpoints.append((bx,by))
            isolated = 0
            for i,p in enumerate(endpoints):
                if min(d2(p,q) for j,q in enumerate(endpoints) if j!=i) > tol:
                    isolated += 1
            per_floor[fi] = {"intersections_ok": intersections_ok, "residual_overlaps": residual_overlaps, "isolated_endpoints": isolated, "exact_junctions": exact_junctions}
            summary["intersections_ok"] += intersections_ok
            summary["residual_overlaps"] += residual_overlaps
            summary["isolated_endpoints"] += isolated
            summary["exact_junctions"] += exact_junctions
        # keep top 10 largest residuals
        top = sorted(top, key=lambda r: max(r["da"], r["db"]), reverse=True)[:10]
        return {"summary": summary, "per_floor": per_floor, "top_residuals": top}

    def load_model(self, ifc_file_path: str) -> bool:
        """Load IFC model from file path"""
        try:
            self.model = ifcopenshell.open(ifc_file_path)
            self.initialized = True
            return True
        except Exception:
            return False

    def load_model_from_string(self, ifc_content: str, pyodide_fs=None) -> bool:
        """
        Load IFC model from string content (for browser/Pyodide mode)
        
        Args:
            ifc_content: IFC file content as string
            pyodide_fs: Retained for backwards compatibility; unused
        """
        try:
            self.model = ifcopenshell.file.from_string(ifc_content)
            self.initialized = True
            return True
        except Exception:
            return False

    def _short_guid(self, element) -> str:
        try:
            gid = getattr(element, 'GlobalId', None)
            if gid:
                return str(gid)[:8]
        except Exception:
            pass
        return ""

    def extract_elements(self) -> IfcModel:
        """Extract all building elements from the model"""
        if not self.initialized or not self.model:
            raise RuntimeError("Model not loaded")

        ifc_model = IfcModel()
        
        
        # Progress: 0/6 - Reading IFC model
        if self.progress_callback:
            self.progress_callback("Reading IFC model...", 0, 6)
        
        # Extract units and storeys first
        self._extract_units(ifc_model)
        self._extract_storeys(ifc_model)
        
        # Extract walls with layer detection
        walls = self.model.by_type('IfcWall')
        
        # Progress: 1/6 - Extracting walls
        if self.progress_callback:
            self.progress_callback("Extracting walls...", 1, 6)
        
        # Detect overlapping wall assemblies (skippable via flag)
        overlapping_assemblies = {}
        if self.delayering_enabled:
            overlapping_assemblies = self._detect_overlapping_wall_assemblies(walls)
        
        # Calculate building centroid for spatial analysis (only needed if delayering)
        building_centroid = (0.0, 0.0)
        if self.delayering_enabled:
            building_centroid = self._calculate_building_centroid(walls)
        
        # Process walls with layer detection
        processed_walls = set()  # Track processed walls to avoid duplicates
        dropped_walls = []  # Track dropped external layers for auditing
        
        for assembly_key, assembly_walls in overlapping_assemblies.items():
            
            # Identify internal vs external layers
            layer_analysis = self._identify_internal_layer(assembly_walls, building_centroid)
            internal_layer = layer_analysis['internal']
            external_layers = layer_analysis.get('external', [])
            
            # Process internal layer
            internal_wall = internal_layer['wall']
            internal_id = getattr(internal_wall, 'GlobalId', 'NO_GLOBAL_ID')
            processed_walls.add(internal_id)
            
            # Mark external layers as processed (but don't add to CSV)
            for i, external_layer in enumerate(external_layers):
                external_wall = external_layer['wall']
                external_id = getattr(external_wall, 'GlobalId', 'NO_GLOBAL_ID')
                processed_walls.add(external_id)
            
            # Extract internal face coordinates instead of centerline
            coords = self._extract_internal_face_coordinates(internal_wall)
            if not coords:
                # Fallback to centerline if internal face extraction fails
                coords = self._extract_geometry(internal_wall)
            
            properties = self._extract_properties(internal_wall)
            properties['is_external'] = self._is_external_wall(internal_wall)
            properties['layer_type'] = 'internal'
            properties['assembly_size'] = len(assembly_walls)
            
            storey = self._get_element_storey(internal_wall)
            orientation = self._calculate_orientation(coords) if coords else None
            
            # Transform coordinates to Vulcan format
            if coords and storey:
                transformed_coords = coords
                coords_csv = self._format_coords_for_csv(transformed_coords)
            else:
                transformed_coords = coords
                coords_csv = ""
            
            # Extract dimensions from properties
            area = self._get_property_value(properties, 'Area', 'NetArea')
            height = self._get_property_value(properties, 'Height', 'Unconnected Height', 'AverageHeight')
            # geometry-based fallback for height if properties are missing
            if height is None:
                bw_m, bh_m = self._get_bbox_size_m(internal_wall)
                if bh_m is not None:
                    # store in meters (IFC native units)
                    height = bh_m
            elif height > 10.0:  # Normalize mm to meters for property values
                height = height / 1000.0
            width = self._get_property_value(properties, 'Width', 'Length')
            if width is not None and width > 10.0:  # Normalize mm to meters
                width = width / 1000.0
            
            name = getattr(internal_wall, 'Name', None) or f"Wall_{internal_wall.id()}"
            
            element = IfcElement(
                id=internal_wall.id(),
                type='IfcWall',
                name=f"{name}_{getattr(internal_wall, 'GlobalId', '')}",
                properties=properties
            )
            element.coordinates = transformed_coords
            element.coords_csv = coords_csv
            element.area = area
            element.height = height
            element.width = width
            element.orientation = orientation
            element.storey = storey
            element.global_id = getattr(internal_wall, 'GlobalId', None)
            
            # Store wall for audit logging during CSV generation
            if self.audit_collector:
                element._audit_wall_handle = internal_wall
                element._audit_logged = False
            
            ifc_model.walls.append(element)
            
            # Audit dropped external layers
            for external_layer in external_layers:
                external_wall = external_layer['wall']
                dropped_walls.append({
                    'wall': external_wall,
                    'reason': 'external_layer_dropped',
                    'assembly_size': len(assembly_walls),
                    'internal_wall_id': internal_wall.GlobalId,
                    'distance_to_centroid': external_layer.get('distance_to_centroid', 'unknown')
                })
        
        # Audit dropped external layers
        for i, dropped_wall in enumerate(dropped_walls):
            wall = dropped_wall['wall']
            reason = dropped_wall['reason']
            assembly_size = dropped_wall['assembly_size']
            internal_wall_id = dropped_wall['internal_wall_id']
            distance = dropped_wall['distance_to_centroid']
            
            wall_name = getattr(wall, 'Name', 'Unknown')
            wall_id = getattr(wall, 'GlobalId', 'Unknown')
            
            # Write to audit file
            if self.audit_collector:
                self.audit_collector.log_element(
                    element_id=wall_id,
                    ifc_type='IfcWall',
                    ifc_name=f"Basic Wall:{wall_name}_{wall_id}",
                    final_state='dropped',
                    reasons=[reason],
                    csv_fields={
                        'width_m': None,
                        'height_m': None,
                        'area_m2': None,
                        'orientation360': None,
                        'coords_preview': '[]',
                        'parent_element': None
                    },
                    sources={
                        'width': 'none',
                        'height': 'none',
                        'orientation': 'none',
                        'host': 'none'
                    },
                    classification={
                        'wall_external': True,
                        'layer_type': 'external',
                        'assembly_size': assembly_size,
                        'internal_wall_id': internal_wall_id,
                        'distance_to_centroid': distance
                    },
                    storey={
                        'name': 'Unknown',
                        'floor_index': 0
                    }
                )
        
        # Process remaining walls (not part of overlapping assemblies)
        total_walls = len(walls)
        for idx, wall in enumerate(walls, start=1):
            if self.progress_callback:
                try:
                    self.progress_callback("Extracting wall", idx, total_walls)
                except Exception:
                    pass
            wall_id = getattr(wall, 'GlobalId', 'NO_GLOBAL_ID')
            if wall_id not in processed_walls:
                name = getattr(wall, 'Name', None) or f"Wall_{wall.id()}"
            
                # Extract internal face coordinates for standalone walls
                coords = self._extract_internal_face_coordinates(wall)
                if not coords:
                    # Fallback to centerline if internal face extraction fails
                    coords = self._extract_geometry(wall)
                
                properties = self._extract_properties(wall)
                properties['is_external'] = self._is_external_wall(wall)
                properties['layer_type'] = 'standalone'
                properties['assembly_size'] = 1
                
                storey = self._get_element_storey(wall)
                # Calculate orientation from centerline for accurate orientation
                centerline_coords = self._extract_geometry(wall)
                orientation = self._calculate_orientation(centerline_coords) if centerline_coords else None
                
                # Transform coordinates to Vulcan format
                if coords and storey:
                    transformed_coords = coords
                    coords_csv = self._format_coords_for_csv(transformed_coords)
                else:
                    transformed_coords = coords
                    coords_csv = ""
                
                # Extract dimensions from properties
                area = self._get_property_value(properties, 'Area', 'NetArea')
                height = self._get_property_value(properties, 'Height', 'Unconnected Height', 'AverageHeight')
                if height is None:
                    bw_m, bh_m = self._get_bbox_size_m(wall)
                    if bh_m is not None:
                        height = bh_m
                elif height > 10.0:  # Normalize mm to meters for property values
                    height = height / 1000.0
                width = self._get_property_value(properties, 'Width', 'Length')
                if width is not None and width > 10.0:  # Normalize mm to meters
                    width = width / 1000.0
                
                element = IfcElement(
                    id=wall.id(),
                    type='IfcWall',
                    name=f"{name}_{getattr(wall, 'GlobalId', '')}",
                    properties=properties
                )
                element.coordinates = transformed_coords
                element.coords_csv = coords_csv
                element.area = area
                # Prefer geometry-derived Z span if available
                try:
                    if transformed_coords and len(transformed_coords) >= 2 and len(transformed_coords[0]) >= 3:
                        zs = [pt[2] for pt in transformed_coords]
                        zmin = min(zs)
                        zmax = max(zs)
                        if zmax > zmin:
                            element.height = zmax - zmin
                            element.height_z_min = zmin
                            element.height_z_max = zmax
                        else:
                            element.height = height
                    else:
                        element.height = height
                except Exception:
                    element.height = height
                element.width = width
                element.orientation = orientation
                element.storey = storey
                element.global_id = getattr(wall, 'GlobalId', None)
                
                # Store wall for audit logging during CSV generation
                if self.audit_collector:
                    element._audit_wall_handle = wall
                    element._audit_logged = False
                
                ifc_model.walls.append(element)
        
        # Log dropped walls for auditing
        if dropped_walls:
            for dropped_wall in dropped_walls:
                wall = dropped_wall['wall']
                

        # Extract windows (cold-start optimized: avoid meshing; use placement + properties)
        windows = self.model.by_type('IfcWindow')
        total_windows = len(windows)
        # Progress: 2/6 - Extracting windows (major step)
        if self.progress_callback:
            self.progress_callback("Extracting windows...", 2, 6)
        for i, window in enumerate(windows):
            # Per-element window progress
            if self.progress_callback:
                try:
                    self.progress_callback("Extracting window", i + 1, total_windows)
                except Exception:
                    pass
            
            name = getattr(window, 'Name', None) or f"Window_{window.id()}"

            properties = self._extract_properties(window)
            storey = self._get_element_storey(window)
            center_m = self._get_world_location_m(window) or self._get_local_placement_m(window)
            # Host wall parent and axis
            host_wall = self._get_host_wall(window)
            dirx, diry = self._get_wall_axis_dir_unit(host_wall) if host_wall else (1.0, 0.0)

            # Dimensions from properties; typical keys vary by export
            width = self._get_property_value(properties, 'OverallWidth', 'Width', 'Bredd')
            height = self._get_property_value(properties, 'OverallHeight', 'Height', 'Head Height')
            
            # Normalize property values to meters if they appear to be in millimeters (dimensions > 10)
            if width is not None and width > 10.0:
                width = width / 1000.0
            if height is not None and height > 10.0:
                height = height / 1000.0
            
            # Extract additional window properties for FHS schema
            pitch = self._get_property_value(properties, 'Pitch', 'Slope', 'Inclination')
            # If no pitch from properties, inherit from parent wall or try geometry-based detection
            if pitch is None:
                if host_wall:
                    # Extract pitch from raw IFC wall properties
                    wall_properties = self._extract_properties(host_wall)
                    wall_pitch = self._get_property_value(wall_properties, 'Pitch', 'Slope', 'Inclination')
                    if wall_pitch is not None:
                        pitch = wall_pitch
                        wall_name = getattr(host_wall, 'Name', 'Unknown') or 'Unknown'
                    else:
                        pitch = self._estimate_window_door_pitch_deg(element, "window")
                else:
                    pitch = self._estimate_window_door_pitch_deg(element, "window")
            frame_area_fraction = self._get_property_value(properties, 'FrameAreaFraction', 'FrameArea', 'FrameRatio')
            free_area_height = self._get_property_value(properties, 'FreeAreaHeight', 'OpeningHeight', 'ClearHeight')
            mid_height = self._get_property_value(properties, 'MidHeight', 'CenterHeight', 'SillHeight')

            # fallback: if no host_wall, snap to nearest wall axis within tolerance
            if not host_wall and center_m:
                best = (None, 1e9, (1.0,0.0))
                for w in ifc_model.walls:
                    if not w.coordinates or len(w.coordinates) < 2:
                        continue
                    (x1,y1,_),(x2,y2,_) = w.coordinates[0], w.coordinates[1]
                    vx, vy = (x2-x1), (y2-y1)
                    vlen2 = vx*vx + vy*vy
                    if vlen2 <= 1e-9:
                        continue
                    t = ((center_m[0]-x1)*vx + (center_m[1]-y1)*vy) / vlen2
                    t = max(0.0, min(1.0, t))
                    px, py = (x1 + t*vx), (y1 + t*vy)
                    dx, dy = (center_m[0]-px), (center_m[1]-py)
                    dist = (dx*dx + dy*dy) ** 0.5
                    if dist < best[1]:
                        dlen = (vlen2) ** 0.5
                        dir_unit = (vx/dlen, vy/dlen) if dlen > 1e-9 else (1.0,0.0)
                        best = (w, dist, dir_unit)
                tol = getattr(self, 'host_tol_m', 0.2)
                if best[0] is not None and best[1] <= tol:
                    host_wall = best[0]
                    dirx, diry = best[2]
                    if isinstance(properties, dict):
                        properties['parent_resolution_reason'] = 'projection_match'
                else:
                    if isinstance(properties, dict):
                        properties['parent_resolution_reason'] = 'unresolved'

            # Fallback: if properties are missing, try to get dimensions from window geometry
            if width is None or height is None:
                geom_width, geom_height = self._get_window_geometry_dimensions(window)
                if width is None and geom_width and geom_width > 0.1:
                    width = geom_width  # keep in meters
                if height is None and geom_height and geom_height > 0.1:
                    height = geom_height  # keep in meters

            coords = []
            if center_m and host_wall:
                # Generate coordinates based on window dimensions from properties
                if width and width > 0:
                    # Snap window to wall's internal face
                    snapped_center = self._snap_window_to_wall_internal_face(center_m, host_wall)
                    if snapped_center:
                        center_m = snapped_center
                    
                    half_w = width / 2.0  # width is already in meters
                    x0 = center_m[0] - dirx * half_w
                    y0 = center_m[1] - diry * half_w
                    x1 = center_m[0] + dirx * half_w
                    y1 = center_m[1] + diry * half_w
                    z = 0.0  # floor level per Vulcan
                    coords = [(x0, y0, z), (x1, y1, z)]
                # No coordinates generated - we don't have reliable dimension data

            coords_csv = self._format_coords_for_csv(coords) if coords else ""
            
            # Dimensions come from geometry extraction (lines 563-568)
            # Coordinate recalculation removed as dead code - geometry always provides dimensions
            # and coordinates are generated FROM dimensions, not extracted from them

            element = IfcElement(
                id=window.id(),
                type='IfcWindow',
                name=f"{name}_{self._short_guid(window)}",
                properties=properties
            )
            element.coordinates = coords
            element.coords_csv = coords_csv
            element.area = self._get_property_value(properties, 'Area', 'NetArea')
            element.height = height
            element.width = width
            element.pitch = pitch
            element.frame_area_fraction = frame_area_fraction
            element.free_area_height = free_area_height
            element.mid_height = mid_height
            # Extract base height from window placement (absolute height from ground level)
            window_sill_height_above_storey = center_m[2] if center_m and len(center_m) >= 3 else 0.0
            
            # Get storey elevation
            storey_elevation_m = 0.0
            if storey:
                for storey_info in ifc_model.storeys:
                    if storey_info['name'] == storey:
                        storey_elevation_m = storey_info['elevation'] * self.length_unit_factor  # Convert to meters
                        break
            
            # Calculate absolute base height from ground level
            element.base_height = storey_elevation_m + window_sill_height_above_storey
            # inherit wall orientation when available
            element.orientation = self._calculate_orientation(coords) if coords else None
            element.storey = storey
            element.global_id = getattr(window, 'GlobalId', None)
            # Prefer wall name for parent linking (canvas compatibility)
            if host_wall and isinstance(host_wall, IfcElement):
                element.parent_element = host_wall.name
            elif host_wall and hasattr(host_wall, 'Name'):
                element.parent_element = getattr(host_wall, 'Name')
            else:
                element.parent_element = None

            ifc_model.windows.append(element)
        
        # Windows major step already emitted before the loop
        
        # Extract doors (ensure coords via placement + host wall axis)
        doors = self.model.by_type('IfcDoor')
        
        # Progress: 3/6 - Extracting doors
        if self.progress_callback:
            self.progress_callback("Extracting doors...", 3, 6)
        total_doors = len(doors)
        for idx, door in enumerate(doors, start=1):
            if self.progress_callback:
                try:
                    self.progress_callback("Extracting door", idx, total_doors)
                except Exception:
                    pass
            name = getattr(door, 'Name', None) or f"Door_{door.id()}"
            props = self._extract_properties(door)
            # capture door externality from Pset_DoorCommon.IsExternal on raw IFC handle
            try:
                door_is_external = None
                for rel in getattr(door, 'IsDefinedBy', []) or []:
                    pd = getattr(rel, 'RelatingPropertyDefinition', None)
                    if pd and getattr(pd, 'Name', '') == 'Pset_DoorCommon':
                        for p in getattr(pd, 'HasProperties', []) or []:
                            if getattr(p, 'Name', '') == 'IsExternal' and getattr(p, 'NominalValue', None) is not None:
                                v = p.NominalValue
                                door_is_external = bool(getattr(v, 'wrappedValue', v))
                                break
            except Exception:
                door_is_external = None
            storey = self._get_element_storey(door)
            center_m = self._get_world_location_m(door) or self._get_local_placement_m(door)
            # try properties first, then geometry fallback for size while we still have raw IFC handle
            width = self._get_property_value(props, 'OverallWidth', 'Width')
            height_prop = self._get_property_value(props, 'OverallHeight', 'Height', 'AverageHeight')
            
            # Normalize property values from mm to m if they appear to be in millimeters (> 10)
            if width is not None and width > 10.0:
                width = width / 1000.0
            if height_prop is not None and height_prop > 10.0:
                height_prop = height_prop / 1000.0
            
            # Geometry fallback for size if properties failed (after normalization)
            if width is None or height_prop is None:
                try:
                    geom_size = self._get_element_size_mm(door)
                    if geom_size:
                        geom_width, geom_height = geom_size
                        if width is None:
                            width = geom_width / 1000.0  # Convert mm to m
                        if height_prop is None:
                            height_prop = geom_height / 1000.0  # Convert mm to m
                except Exception:
                    pass
            
            # Generate simple 2-point coordinates for doors (top-down view)
            coords = None
            # Use center-based coordinate generation for doors
            host_wall = None
            dirx, diry = (1.0, 0.0)
            if center_m:
                # attempt relation-based host
                host_wall = self._get_host_wall(door)
                dirx, diry = self._get_wall_axis_dir_unit(host_wall) if host_wall else (1.0, 0.0)
                if not host_wall:
                    # proximity fallback to wall axis, even if width is missing
                    best = (None, 1e9, (1.0,0.0))
                    for w in ifc_model.walls:
                        if not w.coordinates or len(w.coordinates) < 2:
                            continue
                        (x1,y1,_),(x2,y2,_) = w.coordinates[0], w.coordinates[1]
                        vx, vy = (x2-x1), (y2-y1)
                        vlen2 = vx*vx + vy*vy
                        if vlen2 <= 1e-9:
                            continue
                        t = ((center_m[0]-x1)*vx + (center_m[1]-y1)*vy) / vlen2
                        t = max(0.0, min(1.0, t))
                        px, py = (x1 + t*vx), (y1 + t*vy)
                        dx, dy = (center_m[0]-px), (center_m[1]-py)
                        dist = (dx*dx + dy*dy) ** 0.5
                        if dist < best[1]:
                            dlen = (vlen2) ** 0.5
                            dir_unit = (vx/dlen, vy/dlen) if dlen > 1e-9 else (1.0,0.0)
                            best = (w, dist, dir_unit)
                    if best[0] is not None and best[1] <= 0.5:
                        host_wall = best[0]
                        dirx, diry = best[2]
                if center_m and width:
                    half_w = (width or 1.0) / 2.0  # width is already in meters
                    x0 = center_m[0] - dirx * half_w
                    y0 = center_m[1] - diry * half_w
                    x1 = center_m[0] + dirx * half_w
                    y1 = center_m[1] + diry * half_w
                    coords = [(x0, y0, 0.0), (x1, y1, 0.0)]
            coords_csv = self._format_coords_for_csv(coords) if coords else ""
            el = IfcElement(
                id=door.id(),
                type='IfcDoor',
                name=f"{name}_{self._short_guid(door)}",
                properties=props
            )
            el.storey = storey
            el.coordinates = coords
            el.coords_csv = coords_csv
            # Fill size using bbox (already in meters)
            try:
                if (width is None) or (height_prop is None):
                    bw_m, bh_m = self._get_bbox_size_m(door)
                    if width is None and bw_m is not None:
                        width = bw_m
                    if height_prop is None and bh_m is not None:
                        height_prop = bh_m
            except Exception:
                pass
            # DO NOT normalize here - geometry fallback already converted from mm to m
            # Property values are in mm, but normalization needs to happen BEFORE
            # we call geometry fallback to avoid double conversion
            el.width = width
            el.height = height_prop
            el.orientation = self._calculate_orientation(coords) if coords else None
            # Store door pitch detection for later (after audit handle is stored)
            door_pitch = self._get_property_value(props, 'Pitch', 'Slope', 'Inclination')
            el.pitch = door_pitch  # Will be updated during CSV generation
            # set parent wall when known; prefer wall name for canvas compatibility
            if host_wall and isinstance(host_wall, IfcElement):
                el.properties['linked_wall'] = host_wall.name
                el.properties['parent_resolution_reason'] = el.properties.get('parent_resolution_reason') or 'fills_element'
            elif host_wall and hasattr(host_wall, 'Name'):
                el.properties['linked_wall'] = getattr(host_wall, 'Name')
                el.properties['parent_resolution_reason'] = el.properties.get('parent_resolution_reason') or 'fills_element'
            else:
                el.properties['linked_wall'] = None
                el.properties['parent_resolution_reason'] = el.properties.get('parent_resolution_reason') or 'unresolved'
            # persist externality flag for CSV classification
            el.properties['is_external'] = door_is_external
            # attach door GlobalId for logging
            try:
                el.global_id = getattr(door, 'GlobalId', None)
            except Exception:
                el.global_id = None
            
            # Store door for audit logging during CSV generation
            if self.audit_collector:
                el._audit_door_handle = door  # Store raw IFC handle for audit
                el._audit_logged = False  # Track if we've already logged this door
            
            ifc_model.doors.append(el)

        # Extract slabs and classify as floors vs roofs (no name-based rules)
        slabs = self.model.by_type('IfcSlab')
        roof_agg_ids = self._collect_roof_aggregate_ids()
        roof_count = 0
        floor_count = 0
        total_slabs = len(slabs)
        # Progress: 4/6 - Extracting floors and roofs (major step)
        if self.progress_callback:
            self.progress_callback("Extracting floors and roofs...", 4, 6)
        for idx, slab in enumerate(slabs, start=1):
            if self.progress_callback:
                try:
                    self.progress_callback("Extracting slab", idx, total_slabs)
                except Exception:
                    pass
            name = getattr(slab, 'Name', None) or f"Slab_{slab.id()}"
            props = self._extract_properties(slab)
            predef = self._get_slab_predefined_type(slab)
            if not predef:
                predef = self._get_slab_type_predefined_via_type(slab)

            is_roof_slab = False
            if predef:
                up = predef.upper()
                if up == 'ROOF':
                    is_roof_slab = True
                elif up in ('FLOOR', 'BASESLAB', 'LANDING'):
                    is_roof_slab = False
            elif slab.id() in roof_agg_ids:
                is_roof_slab = True
            # Pitch-based fallback (always considered)
            pitch = self._estimate_slab_pitch_deg(slab)
            if pitch is not None and pitch >= 6.0:
                is_roof_slab = True

            element = IfcElement(
                id=slab.id(),
                type='IfcSlab',
                name=name,
                properties=props
            )

            # Extract slab coordinates using universal method
            coords = self._extract_coordinates_with_fallback(slab)
            if coords and len(coords) >= 3:
                # Use universal coordinates (already in consistent coordinate system)
                element.coordinates = coords
                element.coords_csv = self._format_coords_for_csv(coords)
                
            else:
                # Fallback to bounding box if universal extraction fails
                bbox = self._extract_element_bounding_box(slab)
                if bbox and len(bbox) == 2:
                    (min_x, min_y, _), (max_x, max_y, _) = bbox
                    # Convert to meters using model units
                    unit_factor = ifc_model.units.get('length', 0.001)
                    z = 0.0
                    poly = [
                        (min_x*unit_factor, min_y*unit_factor, z),
                        (max_x*unit_factor, min_y*unit_factor, z),
                        (max_x*unit_factor, max_y*unit_factor, z),
                        (min_x*unit_factor, max_y*unit_factor, z),
                        (min_x*unit_factor, min_y*unit_factor, z)
                    ]
                    element.coordinates = poly
                    element.coords_csv = self._format_coords_for_csv(poly)
            
            # set storey for correct z indexing later
            element.storey = self._get_element_storey(slab)
            
            # Fix Z-coordinates using storey elevation instead of geometry Z-coordinate
            if element.coordinates and element.storey:
                storey_elevation = self._get_storey_elevation(element.storey)
                if storey_elevation is not None:
                    # Convert storey elevation from mm to meters
                    storey_z = storey_elevation * 0.001
                    
                    # Update all coordinates with correct Z-coordinate
                    corrected_coords = []
                    for coord in element.coordinates:
                        corrected_coords.append((coord[0], coord[1], storey_z))
                    
                    element.coordinates = corrected_coords
                    element.coords_csv = self._format_coords_for_csv(corrected_coords)
            # attach computed pitch
            element.pitch = pitch
            
            # Calculate area and perimeter from polygon coordinates
            if element.coordinates and len(element.coordinates) >= 3:
                area, perimeter = self._calculate_polygon_area_and_perimeter(element.coordinates)
                element.area = area
                element.width = perimeter  # Store perimeter in width field for ground elements
            else:
                element.area = None
            
            if is_roof_slab:
                ifc_model.roofs.append(element)
                roof_count += 1
            else:
                ifc_model.floors.append(element)
                floor_count += 1

        # Progress: 4/6 - Extracting floors and roofs
        if self.progress_callback:
            self.progress_callback("Extracting floors and roofs...", 4, 6)

        # Extract roofs (metadata only). Do not add bare IfcRoof as separate CSV rows unless it has geometry.
        roofs = self.model.by_type('IfcRoof')

        # Extract spaces
        spaces = self.model.by_type('IfcSpace')
        
        # Progress: 5/6 - Extracting spaces
        if self.progress_callback:
            self.progress_callback("Extracting spaces...", 5, 6)
        total_spaces = len(spaces)
        for idx, space in enumerate(spaces, start=1):
            if self.progress_callback:
                try:
                    self.progress_callback("Extracting space", idx, total_spaces)
                except Exception:
                    pass
            name = getattr(space, 'Name', None) or f"Space_{space.id()}"
            ifc_model.spaces.append(IfcElement(
                id=space.id(),
                type='IfcSpace',
                name=name,
                properties=self._extract_properties(space)
            ))
        
        # Progress: 6/6 - Complete
        if self.progress_callback:
            self.progress_callback("Extraction complete", 6, 6)

        return ifc_model

    def _extract_properties(self, element) -> Dict[str, Any]:
        """Extract properties from an IFC element"""
        properties = {}
        
        # Basic properties
        if hasattr(element, 'Name') and element.Name:
            properties['Name'] = element.Name
        if hasattr(element, 'Description') and element.Description:
            properties['Description'] = element.Description
            
        # Try to get property sets
        try:
            for pset in element.IsDefinedBy:
                if hasattr(pset, 'RelatingPropertyDefinition'):
                    prop_def = pset.RelatingPropertyDefinition
                    if hasattr(prop_def, 'HasProperties'):
                        for prop in prop_def.HasProperties:
                            if hasattr(prop, 'Name') and hasattr(prop, 'NominalValue'):
                                properties[prop.Name] = prop.NominalValue
        except:
            pass  # Property extraction is optional
            
        return properties

    def _normalize_enum(self, val: Optional[str]) -> Optional[str]:
        if not val:
            return None
        s = str(val)
        # Examples: 'ROOF', 'IfcSlabTypeEnum.ROOF'
        if '.' in s:
            s = s.split('.')[-1]
        return s.upper()

    def _get_slab_predefined_type(self, slab) -> Optional[str]:
        """Return slab predefined type from enum or Pset_SlabCommon.PredefinedType."""
        try:
            if hasattr(slab, 'PredefinedType') and slab.PredefinedType:
                return self._normalize_enum(slab.PredefinedType)
        except Exception:
            pass
        try:
            for pset in getattr(slab, 'IsDefinedBy', []) or []:
                prop_def = getattr(pset, 'RelatingPropertyDefinition', None)
                if prop_def and hasattr(prop_def, 'Name') and 'Pset_SlabCommon' in prop_def.Name:
                    for prop in getattr(prop_def, 'HasProperties', []) or []:
                        if getattr(prop, 'Name', '') == 'PredefinedType' and getattr(prop, 'NominalValue', None):
                            val = prop.NominalValue
                            raw = val.wrappedValue if hasattr(val, 'wrappedValue') else val
                            return self._normalize_enum(raw)
        except Exception:
            return None
        return None

    def _collect_roof_aggregate_ids(self) -> set:
        """Collect IDs of elements aggregated under IfcRoof via IfcRelAggregates."""
        ids = set()
        try:
            roofs = self.model.by_type('IfcRoof')
            for roof in roofs:
                for rel in getattr(roof, 'IsDecomposedBy', []) or []:
                    for obj in getattr(rel, 'RelatedObjects', []) or []:
                        try:
                            ids.add(obj.id())
                        except Exception:
                            pass
        except Exception:
            return ids
        return ids

    def _get_slab_type_predefined_via_type(self, slab) -> Optional[str]:
        """Lookup IfcRelDefinesByType → IfcSlabType.PredefinedType."""
        try:
            for rel in getattr(slab, 'IsDefinedBy', []) or []:
                # Some entries are IfcRelDefinesByProperties; filter for type
                if hasattr(rel, 'is_a') and rel.is_a('IfcRelDefinesByType'):
                    slab_type = getattr(rel, 'RelatingType', None)
                    if slab_type and hasattr(slab_type, 'is_a') and slab_type.is_a('IfcSlabType'):
                        if hasattr(slab_type, 'PredefinedType') and slab_type.PredefinedType:
                            return self._normalize_enum(slab_type.PredefinedType)
        except Exception:
            return None
        return None

    def _estimate_wall_pitch_deg(self, wall) -> Optional[float]:
        """Estimate wall pitch from placement orientation; returns degrees (0=vertical)."""
        try:
            # DEBUG: Starting pitch estimation - debug output moved to CLI
            
            # Get the raw IFC wall object by GlobalId
            ifc_wall = None
            if hasattr(wall, 'global_id') and wall.global_id:
                try:
                    ifc_wall = self.model.by_id(wall.global_id)
                except:
                    pass
            
            if not ifc_wall:
                return None
            
            # Method 1: Try to get pitch from placement/orientation data
            try:
                import ifcopenshell.util.placement
                import math
                
                # Get the wall's placement matrix
                matrix = ifcopenshell.util.placement.get_local_placement(ifc_wall.ObjectPlacement)
                
                # The Z-axis is the third column of the rotation part of the matrix
                # matrix[0:3, 2] gives us the local Z-axis direction
                local_z = matrix[0:3, 2]
                
                # Global Z-axis (vertical)
                global_z = [0, 0, 1]
                
                # Calculate the angle between the local Z-axis and global Z-axis
                dot_product = sum(lz * gz for lz, gz in zip(local_z, global_z))
                magnitude_local_z = math.sqrt(sum(lz ** 2 for lz in local_z))
                magnitude_global_z = math.sqrt(sum(gz ** 2 for gz in global_z))
                
                if magnitude_local_z > 1e-9 and magnitude_global_z > 1e-9:
                    angle_rad = math.acos(abs(dot_product) / (magnitude_local_z * magnitude_global_z))
                    angle_deg = math.degrees(angle_rad)
                    
                    # The pitch is the deviation from vertical (90°)
                    pitch = 90.0 - angle_deg
                    
                    if abs(pitch) > 1.0:  # Significant slope
                        return abs(pitch)
                    else:
                        return None
                        
            except Exception as e:
                pass
            
            # Method 2: Fallback to geometry analysis (simplified)
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, ifc_wall)
            if not shape:
                return None
                
            verts = shape.geometry.verts
            faces = shape.geometry.faces
            if not verts or not faces:
                return None
            
            import math
            # Analyze faces to find wall faces (those with horizontal normals)
            wall_face_slopes = []
            
            for i in range(0, len(faces), 3):
                i0 = faces[i] * 3
                i1 = faces[i+1] * 3
                i2 = faces[i+2] * 3
                x0,y0,z0 = verts[i0], verts[i0+1], verts[i0+2]
                x1,y1,z1 = verts[i1], verts[i1+1], verts[i1+2]
                x2,y2,z2 = verts[i2], verts[i2+1], verts[i2+2]
                
                # Calculate face normal
                ux,uy,uz = x1-x0, y1-y0, z1-z0
                vx,vy,vz = x2-x0, y2-y0, z2-z0
                nx = uy*vz - uz*vy
                ny = uz*vx - ux*vz
                nz = ux*vy - uy*vx
                nlen = math.sqrt(nx*nx + ny*ny + nz*nz)
                
                if nlen < 1e-9:
                    continue
                
                # Normalize
                nx, ny, nz = nx/nlen, ny/nlen, nz/nlen
                
                # Wall faces have normals that are mostly horizontal (perpendicular to vertical)
                # For a vertical wall: normal is horizontal (nz ≈ 0)
                # For a sloped wall: normal is tilted (nz ≠ 0)
                
                # Calculate angle between normal and horizontal plane
                # This gives us the wall's slope from vertical
                horizontal_component = math.sqrt(nx*nx + ny*ny)
                if horizontal_component > 1e-6:
                    # Angle from horizontal plane to normal
                    angle_from_horizontal = math.degrees(math.atan(abs(nz) / horizontal_component))
                    
                    # Wall faces should have normals mostly horizontal (angle ≈ 0°)
                    if angle_from_horizontal < 30:  # Mostly horizontal normal
                        # The wall's slope is the deviation from vertical
                        wall_slope = 90.0 - angle_from_horizontal
                        if wall_slope > 1.0:  # Significant slope
                            wall_face_slopes.append(wall_slope)
            
            if wall_face_slopes:
                avg_slope = sum(wall_face_slopes) / len(wall_face_slopes)
                return avg_slope
            else:
                return None
                
        except Exception as e:
            return None

    def _calculate_sloped_wall_average_height(self, wall) -> Optional[float]:
        """Calculate average height for sloped walls by analyzing geometry."""
        try:
            # Get the raw IFC wall object by GlobalId
            ifc_wall = None
            if hasattr(wall, 'global_id') and wall.global_id:
                try:
                    ifc_wall = self.model.by_id(wall.global_id)
                except:
                    pass
            
            if not ifc_wall:
                return wall.height  # Fallback to property
            
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, ifc_wall)
            if not shape:
                return wall.height  # Fallback to property
                
            verts = shape.geometry.verts
            if not verts:
                return wall.height
                
            # Extract all Z coordinates
            z_coords = [verts[i+2] for i in range(0, len(verts), 3)]
            if not z_coords:
                return wall.height
                
            # Calculate average height
            min_z = min(z_coords) / self.length_unit_factor
            max_z = max(z_coords) / self.length_unit_factor
            avg_height = (max_z - min_z)
            
            return avg_height if avg_height > 0 else wall.height
        except Exception:
            return wall.height

    def _get_roof_associated_slabs(self, roof) -> List:
        """Get slabs associated with a roof via IfcRelAggregates."""
        try:
            associated_slabs = []
            for rel in getattr(roof, 'IsDecomposedBy', []) or []:
                for obj in getattr(rel, 'RelatedObjects', []) or []:
                    if hasattr(obj, 'is_a') and obj.is_a('IfcSlab'):
                        associated_slabs.append(obj)
            return associated_slabs
        except Exception:
            return []

    def _estimate_window_door_pitch_deg(self, element, element_type="window") -> Optional[float]:
        """Estimate window/door pitch from placement orientation; returns degrees (0=vertical)."""
        try:
            # Get the raw IFC element object
            ifc_element = None
            
            # Try to get from stored audit handle first (for doors)
            if hasattr(element, '_audit_door_handle') and element._audit_door_handle:
                ifc_element = element._audit_door_handle
            
            # Try to get by GlobalId (for windows)
            elif hasattr(element, 'global_id') and element.global_id:
                try:
                    ifc_element = self.model.by_id(element.global_id)
                except:
                    pass
            
            if not ifc_element:
                return None
            
            # Method 1: Try to get pitch from placement/orientation data
            try:
                import ifcopenshell.util.placement
                import math
                
                # Get the element's placement matrix
                matrix = ifcopenshell.util.placement.get_local_placement(ifc_element.ObjectPlacement)
                
                # The Z-axis is the third column of the rotation part of the matrix
                # matrix[0:3, 2] gives us the local Z-axis direction
                local_z = matrix[0:3, 2]
                
                # Global Z-axis (vertical)
                global_z = [0, 0, 1]
                
                # Calculate the angle between the local Z-axis and global Z-axis
                dot_product = sum(lz * gz for lz, gz in zip(local_z, global_z))
                magnitude_local_z = math.sqrt(sum(lz ** 2 for lz in local_z))
                magnitude_global_z = math.sqrt(sum(gz ** 2 for gz in global_z))
                
                if magnitude_local_z > 1e-9 and magnitude_global_z > 1e-9:
                    angle_rad = math.acos(abs(dot_product) / (magnitude_local_z * magnitude_global_z))
                    angle_deg = math.degrees(angle_rad)
                    
                    # The pitch is the deviation from vertical (90°)
                    pitch = 90.0 - angle_deg
                    
                    if abs(pitch) > 1.0:  # Significant slope
                        return abs(pitch)
                    else:
                        return None
                        
            except Exception as e:
                pass
            
            # Method 2: Fallback to geometry analysis (simplified)
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, ifc_element)
            if not shape:
                return None
                
            verts = shape.geometry.verts
            faces = shape.geometry.faces
            if not verts or not faces:
                return None
            
            import math
            # Analyze faces to find element faces (those with horizontal normals)
            element_face_slopes = []
            
            for i in range(0, len(faces), 3):
                i0 = faces[i] * 3
                i1 = faces[i+1] * 3
                i2 = faces[i+2] * 3
                x0,y0,z0 = verts[i0], verts[i0+1], verts[i0+2]
                x1,y1,z1 = verts[i1], verts[i1+1], verts[i1+2]
                x2,y2,z2 = verts[i2], verts[i2+1], verts[i2+2]
                
                # Calculate face normal
                ux,uy,uz = x1-x0, y1-y0, z1-z0
                vx,vy,vz = x2-x0, y2-y0, z2-z0
                nx = uy*vz - uz*vy
                ny = uz*vx - ux*vz
                nz = ux*vy - uy*vx
                nlen = math.sqrt(nx*nx + ny*ny + nz*nz)
                
                if nlen < 1e-9:
                    continue
                
                # Normalize
                nx, ny, nz = nx/nlen, ny/nlen, nz/nlen
                
                # Element faces have normals that are mostly horizontal (perpendicular to vertical)
                # For a vertical element: normal is horizontal (nz ≈ 0)
                # For a sloped element: normal is tilted (nz ≠ 0)
                
                # Calculate angle between normal and horizontal plane
                # This gives us the element's slope from vertical
                horizontal_component = math.sqrt(nx*nx + ny*ny)
                if horizontal_component > 1e-6:
                    # Angle from horizontal plane to normal
                    angle_from_horizontal = math.degrees(math.atan(abs(nz) / horizontal_component))
                    
                    # Element faces should have normals mostly horizontal (angle ≈ 0°)
                    if angle_from_horizontal < 30:  # Mostly horizontal normal
                        # The element's slope is the deviation from vertical
                        element_slope = 90.0 - angle_from_horizontal
                        if element_slope > 1.0:  # Significant slope
                            element_face_slopes.append(element_slope)
            
            if element_face_slopes:
                avg_slope = sum(element_face_slopes) / len(element_face_slopes)
                return avg_slope
            else:
                return None
                
        except Exception as e:
            return None
    def _estimate_slab_pitch_deg(self, slab) -> Optional[float]:
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, slab)
            if not shape:
                return None
            verts = shape.geometry.verts
            faces = shape.geometry.faces
            if not verts or not faces:
                return None
            import math
            sz = len(faces)
            accum = 0.0
            wsum = 0.0
            for i in range(0, sz, 3):
                i0 = faces[i] * 3
                i1 = faces[i+1] * 3
                i2 = faces[i+2] * 3
                x0,y0,z0 = verts[i0], verts[i0+1], verts[i0+2]
                x1,y1,z1 = verts[i1], verts[i1+1], verts[i1+2]
                x2,y2,z2 = verts[i2], verts[i2+1], verts[i2+2]
                ux,uy,uz = x1-x0, y1-y0, z1-z0
                vx,vy,vz = x2-x0, y2-y0, z2-z0
                # normal = u x v
                nx = uy*vz - uz*vy
                ny = uz*vx - ux*vz
                nz = ux*vy - uy*vx
                nlen = math.sqrt(nx*nx + ny*ny + nz*nz)
                if nlen < 1e-9:
                    continue
                # area weight ~ 0.5*|n|
                w = 0.5 * nlen
                # cos(theta) = |nz|/|n| vs global Z
                cos_theta = abs(nz) / nlen
                cos_theta = max(0.0, min(1.0, cos_theta))
                theta = math.degrees(math.acos(cos_theta))
                accum += theta * w
                wsum += w
            if wsum <= 0.0:
                return None
            return accum / wsum
        except Exception:
            return None

    def _find_bottom_edge_coords(self, coords_list: List[Tuple[float, float, float]]) -> Optional[List[Tuple[float, float, float]]]:
        """
        Find the actual bottom edge coordinates from a polygon.
        
        The bottom edge is defined as the edge with the lowest Z coordinate (closest to ground).
        For flat roofs (all Z coordinates equal), use the edge that defines the primary direction.
        
        Args:
            coords_list: List of polygon coordinates
            
        Returns:
            List of two coordinates representing the bottom edge, or None if not found
        """
        try:
            if len(coords_list) < 3:
                return None
            
            # Check if this is a flat roof (all Z coordinates are the same)
            z_coords = [coord[2] for coord in coords_list]
            min_z = min(z_coords)
            max_z = max(z_coords)
            is_flat_roof = abs(max_z - min_z) < self.tol_equal
            
            if is_flat_roof:
                # For flat roofs, use the first two coordinates as they define the primary direction
                return coords_list[:2]
            
            # For sloped roofs, find the edge with the lowest Z coordinate
            min_z = min(coord[2] for coord in coords_list)
            
            # Find all points at the lowest elevation
            bottom_points = [coord for coord in coords_list if abs(coord[2] - min_z) < self.tol_equal]
            
            if len(bottom_points) < 2:
                # If we have only 1 point at the lowest level, find the actual edge that connects to it
                if len(bottom_points) == 1:
                    bottom_point = bottom_points[0]
                    # Find the point that is closest to the bottom point in Z-coordinate
                    # This should be the actual bottom edge of the polygon
                    other_points = [coord for coord in coords_list if coord != bottom_point]
                    if other_points:
                        # Find the point with the closest Z-coordinate to the bottom point
                        closest_z_point = min(other_points, key=lambda p: abs(p[2] - bottom_point[2]))
                        return [bottom_point, closest_z_point]
                return None
            
            # If we have exactly 2 bottom points, return them
            if len(bottom_points) == 2:
                return bottom_points
            
            # If we have more than 2 bottom points, find the two that form the longest edge
            # Sort by X coordinate to get leftmost and rightmost
            bottom_points.sort(key=lambda p: p[0])
            leftmost = bottom_points[0]
            rightmost = bottom_points[-1]
            
            return [leftmost, rightmost]
            
        except Exception:
            return None

    def _reorder_coords_bottom_edge_first(self, coords_list: List[Tuple[float, float, float]], bottom_edge_coords: List[Tuple[float, float, float]]) -> List[Tuple[float, float, float]]:
        """
        Reorder coordinates so the bottom edge comes first, maintaining proper polygon winding order.
        
        This ensures that after reordering, the polygon doesn't self-intersect (bow-tie effect).
        The coordinates are reordered to maintain the geometric winding order around the polygon perimeter.
        
        Args:
            coords_list: Original list of polygon coordinates
            bottom_edge_coords: The two coordinates that form the bottom edge
            
        Returns:
            Reordered list with bottom edge coordinates first, but maintaining proper winding
        """
        try:
            if len(coords_list) < 3 or len(bottom_edge_coords) != 2:
                return coords_list
            
            # Find the indices of the bottom edge coordinates in the original list
            bottom_indices = []
            for bottom_coord in bottom_edge_coords:
                for i, coord in enumerate(coords_list):
                    if (abs(coord[0] - bottom_coord[0]) < self.tol_equal and 
                        abs(coord[1] - bottom_coord[1]) < self.tol_equal and 
                        abs(coord[2] - bottom_coord[2]) < self.tol_equal):
                        bottom_indices.append(i)
                        break
            
            if len(bottom_indices) != 2:
                # If we can't find exact matches, return original order
                return coords_list
            
            # Sort bottom indices to get their order in the polygon
            bottom_indices_sorted = sorted(bottom_indices)
            
            # If we have exactly 4 points (common for rectangular polygons), we need special handling
            if len(coords_list) == 4:
                idx0, idx1 = bottom_indices_sorted
                other_indices = sorted([i for i in range(len(coords_list)) if i not in bottom_indices])
                
                # Check if bottom edge indices are adjacent (wrapping around)
                # For indices [0,1], [1,2], [2,3], or [3,0] (which wraps to [0,3])
                is_adjacent = (idx1 - idx0 == 1) or (idx0 == 0 and idx1 == 3)
                
                if is_adjacent:
                    # Bottom edge is adjacent - maintain correct polygon winding
                    # We need to find which "other" point comes AFTER idx1 in the original perimeter
                    other_idx0, other_idx1 = other_indices
                    
                    # Check which point comes after idx1 in the original perimeter (wrapping)
                    next_after_bottom_end = (idx1 + 1) % 4
                    
                    # Determine which "other" point should come first after the bottom edge
                    if next_after_bottom_end == other_idx0:
                        # other_idx0 comes after bottom edge, so order is: [idx0, idx1, other_idx0, other_idx1]
                        reordered = [
                            coords_list[idx0],
                            coords_list[idx1],
                            coords_list[other_idx0],
                            coords_list[other_idx1]
                        ]
                    elif next_after_bottom_end == other_idx1:
                        # other_idx1 comes after bottom edge, so order is: [idx0, idx1, other_idx1, other_idx0]
                        reordered = [
                            coords_list[idx0],
                            coords_list[idx1],
                            coords_list[other_idx1],
                            coords_list[other_idx0]
                        ]
                    else:
                        # next_after_bottom_end is idx0 (wraps back to start of bottom edge)
                        # This means we need to go in the opposite direction
                        # Use the point BEFORE the bottom edge
                        prev_before_bottom_start = (idx0 - 1) % 4
                        if prev_before_bottom_start == other_idx0:
                            reordered = [
                                coords_list[other_idx0],
                                coords_list[idx0],
                                coords_list[idx1],
                                coords_list[other_idx1]
                            ]
                        elif prev_before_bottom_start == other_idx1:
                            reordered = [
                                coords_list[other_idx1],
                                coords_list[idx0],
                                coords_list[idx1],
                                coords_list[other_idx0]
                            ]
                        else:
                            # Fallback: return original order
                            return coords_list
                    
                    return reordered
                else:
                    # Bottom edge is NOT adjacent (diagonal) - this indicates diagonal edge
                    # In this case, we just return original order to maintain valid polygon
                    return coords_list
            else:
                # For non-4-point polygons, use the original logic but try to maintain order
                # Find indices of all non-bottom-edge points
                non_bottom_indices = [i for i in range(len(coords_list)) if i not in bottom_indices]
                
                # If the bottom edge indices are not in order, we need to be careful
                if bottom_indices_sorted[1] == bottom_indices_sorted[0] + 1:
                    # Adjacent indices - we can use original order
                    reordered = []
                    # Add all coordinates in original order
                    for i in range(len(coords_list)):
                        reordered.append(coords_list[i])
                    return reordered
                else:
                    # Non-adjacent - try to maintain winding
                    start_idx = min(bottom_indices)
                    reordered = []
                    for i in range(len(coords_list)):
                        current_idx = (start_idx + i) % len(coords_list)
                        reordered.append(coords_list[current_idx])
            return reordered
            
        except Exception:
            return coords_list

    def _get_element_size_mm(self, element) -> Optional[Tuple[float, float]]:
        """Extract width and height from element geometry in millimeters"""
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            
            shape = ifcopenshell.geom.create_shape(settings, element)
            if shape:
                verts = shape.geometry.verts
                if len(verts) >= 3:
                    xs = [verts[i] for i in range(0, len(verts), 3)]
                    ys = [verts[i+1] for i in range(0, len(verts), 3)]
                    zs = [verts[i+2] for i in range(0, len(verts), 3)]
                    
                    # Calculate dimensions in meters (geometry already in meters from IfcOpenShell)
                    width_m = (max(xs) - min(xs))
                    height_m = (max(zs) - min(zs))
                    
                    if width_m > 0.01 and height_m > 0.01:  # Reasonable minimums
                        # Convert to millimeters
                        return (width_m * 1000.0, height_m * 1000.0)
        except Exception:
            return None

    def _get_window_geometry_dimensions(self, window) -> Tuple[Optional[float], Optional[float]]:
        """Extract actual width and height from window geometry"""
        try:
            # Try to get window opening geometry first
            opening_element = None
            fills_voids = getattr(window, 'FillsVoids', []) or []
            
            for rel_fill in fills_voids:
                opening = getattr(rel_fill, 'RelatingOpeningElement', None)
                if opening:
                    opening_element = opening
                    break
            
            if opening_element:
                # Get opening geometry
                settings = ifcopenshell.geom.settings()
                settings.set(settings.USE_WORLD_COORDS, True)
                settings.set(settings.WELD_VERTICES, True)
                
                shape = ifcopenshell.geom.create_shape(settings, opening_element)
                if shape:
                    verts = shape.geometry.verts
                    if len(verts) >= 3:
                        xs = [verts[i] for i in range(0, len(verts), 3)]
                        ys = [verts[i+1] for i in range(0, len(verts), 3)]
                        zs = [verts[i+2] for i in range(0, len(verts), 3)]
                        
                        # Calculate dimensions in meters (geometry already in meters from IfcOpenShell)
                        width_m = (max(xs) - min(xs))
                        height_m = (max(zs) - min(zs))
                        
                        if width_m > 0.01 and height_m > 0.01:  # Reasonable minimums
                            return (width_m, height_m)
            
            # Fallback: try window geometry directly
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            
            shape = ifcopenshell.geom.create_shape(settings, window)
            if shape:
                verts = shape.geometry.verts
                if len(verts) >= 3:
                    xs = [verts[i] for i in range(0, len(verts), 3)]
                    ys = [verts[i+1] for i in range(0, len(verts), 3)]
                    zs = [verts[i+2] for i in range(0, len(verts), 3)]
                    
                    # Calculate dimensions in meters (geometry already in meters from IfcOpenShell)
                    width_m = (max(xs) - min(xs))
                    height_m = (max(zs) - min(zs))
                    
                    if width_m > 0.01 and height_m > 0.01:  # Reasonable minimums
                        return (width_m, height_m)
                        
        except Exception:
            return None
        return (None, None)

    def _get_property_value(self, properties: Dict[str, Any], *keys) -> Optional[float]:
        """Get a property value by trying multiple keys"""
        for key in keys:
            if key in properties:
                value = properties[key]
                if isinstance(value, (int, float)):
                    return float(value)
                elif hasattr(value, 'wrappedValue'):
                    return float(value.wrappedValue)
        return None

    def _get_bbox_size_m(self, element) -> Tuple[Optional[float], Optional[float]]:
        """Return (plan_width_m, height_m) from world bbox; None if unavailable."""
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            shape = ifcopenshell.geom.create_shape(settings, element)
            if not shape:
                return (None, None)
            verts = shape.geometry.verts
            xs = [verts[i] for i in range(0, len(verts), 3)]
            ys = [verts[i+1] for i in range(0, len(verts), 3)]
            zs = [verts[i+2] for i in range(0, len(verts), 3)]
            if not xs:
                return (None, None)
            # plan width: take max of X-span and Y-span in meters
            # Geometry vertices are already in meters from IfcOpenShell
            plan = max((max(xs)-min(xs)), (max(ys)-min(ys)))
            height = (max(zs)-min(zs)) if zs else None
            return (plan if plan > 0 else None, height if (height and height > 0) else None)
        except Exception:
            return (None, None)

    def _get_local_placement_m(self, element) -> Optional[Tuple[float, float, float]]:
        """Get element local placement in meters (approximate world position)."""
        try:
            if hasattr(element, 'ObjectPlacement') and element.ObjectPlacement:
                placement = element.ObjectPlacement
                if placement.is_a('IfcLocalPlacement') and hasattr(placement, 'RelativePlacement'):
                    rel = placement.RelativePlacement
                    if rel and rel.is_a('IfcAxis2Placement3D') and rel.Location:
                        x = float(rel.Location.Coordinates[0]) * self.length_unit_factor
                        y = float(rel.Location.Coordinates[1]) * self.length_unit_factor
                        z = float(rel.Location.Coordinates[2]) * self.length_unit_factor
                        return (x, y, z)
        except Exception:
            return None
        return None

    def _get_world_location_m(self, element) -> Optional[Tuple[float, float, float]]:
        """Walk placement chain to approximate world-space location in meters (translation only)."""
        try:
            x = y = z = 0.0
            placement = getattr(element, 'ObjectPlacement', None)
            visited = 0
            while placement and placement.is_a('IfcLocalPlacement') and visited < 10:
                rel = getattr(placement, 'RelativePlacement', None)
                if rel and rel.is_a('IfcAxis2Placement3D') and getattr(rel, 'Location', None):
                    coords = rel.Location.Coordinates
                    x += float(coords[0]) * self.length_unit_factor
                    y += float(coords[1]) * self.length_unit_factor
                    z += float(coords[2]) * self.length_unit_factor
                placement = getattr(placement, 'PlacementRelTo', None)
                visited += 1
            return (x, y, z)
        except Exception:
            return None

    def _get_host_wall(self, opening_filler) -> Optional[Any]:
        """Given an IfcWindow/IfcDoor (filling), attempt to find its host wall via openings relations."""
        try:
            # IfcRelFillsElement -> OpeningElement
            for rel_fill in getattr(opening_filler, 'FillsVoids', []) or []:
                opening = getattr(rel_fill, 'RelatingOpeningElement', None)
                if opening:
                    # IfcRelVoidsElement -> RelatingBuildingElement (wall)
                    for rel_void in getattr(opening, 'VoidsElements', []) or []:
                        wall = getattr(rel_void, 'RelatingBuildingElement', None)
                        if wall and (wall.is_a('IfcWall') or wall.is_a('IfcWallStandardCase')):
                            return wall
        except Exception:
            return None
        return None

    def _get_wall_axis_dir_unit(self, wall) -> Tuple[float, float]:
        """Return unit direction (dx, dy) along wall axis in world space; fallback to (1,0)."""
        try:
            # Use universal coordinate extraction instead of deprecated _extract_wall_boundary
            endpoints = self._extract_universal_coordinates(wall)
            if endpoints and len(endpoints) >= 2:
                (x1, y1, _), (x2, y2, _) = endpoints[0], endpoints[1]
                dx = x2 - x1
                dy = y2 - y1
                norm = (dx*dx + dy*dy) ** 0.5
                if norm > 1e-9:
                    return (dx / norm, dy / norm)
        except Exception:
            pass
        return (1.0, 0.0)

    def _snap_window_to_wall_internal_face(self, window_center: Tuple[float, float, float], wall) -> Optional[Tuple[float, float, float]]:
        """Snap window center to wall's internal face while maintaining window dimensions"""
        try:
            # Get wall's internal face coordinates
            wall_internal_face = self._extract_internal_face_coordinates(wall)
            if not wall_internal_face or len(wall_internal_face) < 2:
                return None
            
            wall_start = wall_internal_face[0]
            wall_end = wall_internal_face[1]
            
            # Project window center onto wall's internal face line
            wall_dx = wall_end[0] - wall_start[0]
            wall_dy = wall_end[1] - wall_start[1]
            wall_length_sq = wall_dx**2 + wall_dy**2
            
            if wall_length_sq < 1e-9:
                return None
            
            # Calculate projection parameter t
            t = ((window_center[0] - wall_start[0]) * wall_dx + 
                 (window_center[1] - wall_start[1]) * wall_dy) / wall_length_sq
            
            # Clamp t to [0, 1] to stay within wall span
            t = max(0.0, min(1.0, t))
            
            # Calculate snapped position on wall's internal face
            snapped_x = wall_start[0] + t * wall_dx
            snapped_y = wall_start[1] + t * wall_dy
            snapped_z = window_center[2]  # Keep original Z coordinate
            
            return (snapped_x, snapped_y, snapped_z)
            
        except Exception:
            return None

    def _extract_units(self, ifc_model: IfcModel):
        """Extract units from the IFC model"""
        try:
            units = self.model.by_type('IfcUnitAssignment')
            if units:
                unit_assignment = units[0]
                for unit in unit_assignment.Units:
                    if unit.is_a('IfcSIUnit'):
                        if unit.UnitType == 'LENGTHUNIT':
                            if hasattr(unit, 'Prefix') and unit.Prefix == 'MILLI':
                                ifc_model.units['length'] = 0.001  # mm to m
                                self.length_unit_factor = 0.001
                            elif unit.Name == 'METRE':
                                ifc_model.units['length'] = 1.0  # m to m
                                self.length_unit_factor = 1.0
                    elif unit.is_a('IfcConversionBasedUnit'):
                        if unit.UnitType == 'LENGTHUNIT':
                            ifc_model.units['length'] = 0.001  # Default to mm
                            self.length_unit_factor = 0.001
            
            # Default to mm if not found
            if 'length' not in ifc_model.units:
                ifc_model.units['length'] = 0.001
                self.length_unit_factor = 0.001
                
        except Exception:
            ifc_model.units['length'] = 0.001
            self.length_unit_factor = 0.001

    def _extract_storeys(self, ifc_model: IfcModel):
        """Extract building storeys"""
        try:
            storeys = self.model.by_type('IfcBuildingStorey')
            for storey in storeys:
                storey_info = {
                    'id': storey.id(),
                    'name': getattr(storey, 'Name', f'Storey_{storey.id()}'),
                    'elevation': getattr(storey, 'Elevation', 0.0)
                }
                ifc_model.storeys.append(storey_info)
        except Exception:
            pass

    def _is_external_wall(self, wall) -> bool:
        """Check if a wall is external. No name-based logic."""
        # Check IsExternal property using wrappedValue
        try:
            for pset in wall.IsDefinedBy:
                if hasattr(pset, 'RelatingPropertyDefinition'):
                    prop_def = pset.RelatingPropertyDefinition
                    if hasattr(prop_def, 'HasProperties'):
                        for prop in prop_def.HasProperties:
                            if hasattr(prop, 'Name') and prop.Name == 'IsExternal':
                                if hasattr(prop, 'NominalValue') and prop.NominalValue:
                                    # Use wrappedValue to get the actual boolean value
                                    if hasattr(prop.NominalValue, 'wrappedValue'):
                                        return bool(prop.NominalValue.wrappedValue)
                                    else:
                                        return bool(prop.NominalValue)
        except:
            pass
        # Unknown → treat as internal (exclude from Exposed Elements)
        return False

    def _extract_geometry(self, element) -> Optional[List[Tuple[float, float, float]]]:
        """Extract simplified geometry coordinates from an IFC element"""
        try:
            # Use hybrid approach: internal faces for walls (if enabled), universal for others
            return self._extract_coordinates_with_fallback(element)
            
        except Exception:
            return None

    def _extract_coordinates_with_fallback(self, element) -> Optional[List[Tuple[float, float, float]]]:
        """
        Hybrid coordinate extraction: internal faces for walls, universal for others
        
        This method implements a hybrid approach that preserves internal face coordinates
        for walls (critical for HEM thermal modeling accuracy) while using universal
        coordinates for other elements to ensure consistent coordinate systems.
        
        Args:
            element: IFC element to extract coordinates from
            
        Returns:
            List of coordinate tuples (x, y, z) or None if extraction fails
        """
        try:
            # For walls, use internal face coordinates if enabled (for HEM accuracy)
            if hasattr(element, 'is_a') and element.is_a() == 'IfcWall' and self.use_internal_faces:
                # Try internal face extraction first
                internal_coords = self._extract_internal_face_coordinates(element)
                if internal_coords:
                    return internal_coords
                
                # Fallback to universal coordinates if internal face extraction fails
                centerline_coords = self._extract_universal_coordinates(element)
                if centerline_coords:
                    return centerline_coords
            
            # For all other elements, or walls with use_internal_faces=False, use universal method
            return self._extract_universal_coordinates(element)
            
        except Exception:
            return None

    def _extract_universal_coordinates(self, element) -> Optional[List[Tuple[float, float, float]]]:
        """
        Universal coordinate extraction using ifcopenshell.geom.create_shape()
        
        This method provides a consistent coordinate reference frame for all elements
        by using ifcopenshell's built-in coordinate transformation capabilities.
        It extracts triangulated mesh vertices and processes them based on element type.
        
        Args:
            element: IFC element to extract coordinates from
            
        Returns:
            List of coordinate tuples (x, y, z) or None if extraction fails
        """
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            
            shape = ifcopenshell.geom.create_shape(settings, element)
            if not shape:
                return None
                
            vertices = shape.geometry.verts
            if len(vertices) < 9:  # Need at least 3 vertices
                return None
            
            # Convert vertices to coordinate tuples
            coords = []
            for i in range(0, len(vertices), 3):
                if i + 2 < len(vertices):
                    x, y, z = vertices[i], vertices[i+1], vertices[i+2]
                    coords.append((x, y, z))
            
            # For walls, try to extract clean centerline from vertices
            if hasattr(element, 'is_a') and element.is_a() == 'IfcWall':
                centerline_coords = self._extract_centerline_from_vertices(coords)
                if centerline_coords:
                    return centerline_coords
            
            # For slabs, use rectangular boundary extraction instead of convex hull
            elif hasattr(element, 'is_a') and element.is_a() == 'IfcSlab':
                boundary_coords = self._extract_rectangular_boundary(coords)
                if boundary_coords:
                    return boundary_coords
            
            # For other elements, return all coordinates
            return coords
            
        except Exception:
            return None

    def _extract_centerline_from_vertices(self, coords: List[Tuple[float, float, float]]) -> Optional[List[Tuple[float, float, float]]]:
        """Extract clean centerline from wall vertices"""
        try:
            if len(coords) < 3:
                return None
            
            # Calculate bounding box
            x_coords = [c[0] for c in coords]
            y_coords = [c[1] for c in coords]
            z_coords = [c[2] for c in coords]
            
            min_x, max_x = min(x_coords), max(x_coords)
            min_y, max_y = min(y_coords), max(y_coords)
            avg_z = sum(z_coords) / len(z_coords)
            
            # Determine wall orientation
            dx = max_x - min_x
            dy = max_y - min_y
            
            if dx > dy:  # Horizontal wall
                # Use min/max X coordinates, average Y
                avg_y = sum(y_coords) / len(y_coords)
                return [(min_x, avg_y, avg_z), (max_x, avg_y, avg_z)]
            else:  # Vertical wall
                # Use min/max Y coordinates, average X
                avg_x = sum(x_coords) / len(x_coords)
                return [(avg_x, min_y, avg_z), (avg_x, max_y, avg_z)]
                
        except Exception:
            return None


    def _extract_rectangular_boundary(self, coords: List[Tuple[float, float, float]]) -> List[Tuple[float, float, float]]:
        """Extract rectangular boundary from slab coordinates"""
        try:
            if len(coords) < 3:
                return coords
            
            # Remove duplicates first
            unique_coords = self._remove_duplicate_coords_3d(coords)
            
            if len(unique_coords) < 3:
                return unique_coords
            
            # Get X,Y bounds
            xs = [coord[0] for coord in unique_coords]
            ys = [coord[1] for coord in unique_coords]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            
            # Find corner points (closest to min/max X,Y combinations)
            corners = [
                self._find_corner(unique_coords, min_x, min_y),  # bottom-left
                self._find_corner(unique_coords, max_x, min_y),  # bottom-right
                self._find_corner(unique_coords, max_x, max_y),   # top-right
                self._find_corner(unique_coords, min_x, max_y)    # top-left
            ]
            
            # Remove duplicates from corners
            final_corners = self._remove_duplicate_coords_2d(corners)
            
            return final_corners
            
        except Exception:
            return coords

    def _extract_element_bounding_box(self, element) -> Optional[List[Tuple[float, float, float]]]:
        """Extract element bounding box coordinates"""
        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            settings.set(settings.WELD_VERTICES, True)
            
            shape = ifcopenshell.geom.create_shape(settings, element)
            if not shape:
                return None
                
            # Get vertices and calculate bounding box
            verts = shape.geometry.verts
            if len(verts) < 3:
                return None
            
            x_coords = [verts[i] for i in range(0, len(verts), 3)]
            y_coords = [verts[i+1] for i in range(0, len(verts), 3)]
            z_coords = [verts[i+2] for i in range(0, len(verts), 3)]
            
            min_x, max_x = min(x_coords), max(x_coords)
            min_y, max_y = min(y_coords), max(y_coords)
            min_z, max_z = min(z_coords), max(z_coords)
            
            if self.audit_collector and self.audit_collector.level == 'verbose' and hasattr(element, 'is_a') and element.is_a() == 'IfcWall':
                element_id = getattr(element, 'GlobalId', 'unknown')
                self.audit_collector.records.append({
                    "type": "WallBoundingBox",
                    "element_id": element_id,
                    "total_vertices": len(verts)//3,
                    "x_range": {"min": min_x, "max": max_x, "span": max_x-min_x},
                    "y_range": {"min": min_y, "max": max_y, "span": max_y-min_y},
                    "z_range": {"min": min_z, "max": max_z, "span": max_z-min_z},
                    "first_6_vertices": [(x_coords[i], y_coords[i], z_coords[i]) for i in range(min(6, len(x_coords)))]
                })
            
            # Return bounding box corners in meters (IfcOpenShell already returns meters)
            return [
                (min_x, min_y, min_z),  # Bottom-left-back
                (max_x, max_y, max_z)   # Top-right-front
            ]
            
        except Exception:
            return None


    def _detect_overlapping_wall_assemblies(self, walls) -> Dict[Tuple, List]:
        """Detect overlapping wall assemblies by grouping walls with similar coordinates and properties"""
        try:
            # Group walls by spatial proximity and similar properties
            coordinate_groups = {}
            
            for wall in walls:
                centerline = self._extract_universal_coordinates(wall)
                if not centerline or len(centerline) < 2:
                    continue
                
                bbox = self._extract_element_bounding_box(wall)
                if not bbox:
                    continue
                
                floor = bbox[0][2]
                ceiling = bbox[1][2]
                height = ceiling - floor
                
                # Calculate orientation
                p1, p2 = centerline[0], centerline[1]
                dx = p2[0] - p1[0]
                dy = p2[1] - p1[1]
                length = (dx*dx + dy*dy) ** 0.5
                
                if length == 0:
                    continue
                
                import math
                angle_rad = math.atan2(dy, dx)
                angle_deg = math.degrees(angle_rad)
                if angle_deg < 0:
                    angle_deg += 360
                
                # Create grouping key: rounded coordinates + same floor level
                coord_key = (
                    round(p1[0], 0), round(p1[1], 0),  # Round to 1m precision
                    round(p2[0], 0), round(p2[1], 0),
                    round(floor, 3)  # Same floor level precision
                )
                
                if coord_key not in coordinate_groups:
                    coordinate_groups[coord_key] = []
                
                coordinate_groups[coord_key].append({
                    'wall': wall,
                    'centerline': centerline,
                    'floor': floor,
                    'height': height,
                    'angle': angle_deg,
                    'bbox': bbox
                })
            
            # Return only groups with multiple walls (overlapping assemblies)
            overlapping_assemblies = {k: v for k, v in coordinate_groups.items() if len(v) > 1}
            
            return overlapping_assemblies
            
        except Exception:
            return {}
    
    def _identify_internal_layer(self, assembly_walls, building_centroid) -> Dict:
        """Identify which wall in an assembly is the internal layer using spatial analysis"""
        try:
            if len(assembly_walls) < 2:
                return {'internal': assembly_walls[0], 'external': None}
            
            # Calculate distance from each wall center to building centroid
            wall_distances = []
            
            for wall_data in assembly_walls:
                centerline = wall_data['centerline']
                p1, p2 = centerline[0], centerline[1]
                
                # Calculate wall center point
                center_x = (p1[0] + p2[0]) / 2
                center_y = (p1[1] + p2[1]) / 2
                
                # Calculate distance to building centroid
                dx = center_x - building_centroid[0]
                dy = center_y - building_centroid[1]
                distance = math.sqrt(dx*dx + dy*dy)
                
                wall_distances.append({
                    'wall_data': wall_data,
                    'distance': distance,
                    'center': (center_x, center_y)
                })
            
            # Sort by distance to centroid
            wall_distances.sort(key=lambda w: w['distance'])
            
            # Closest to centroid = internal layer
            # Farthest from centroid = external layer
            internal_layer = wall_distances[0]['wall_data']
            external_layers = [w['wall_data'] for w in wall_distances[1:]]
            
            return {
                'internal': internal_layer,
                'external': external_layers,
                'distances': wall_distances
            }
            
        except Exception:
            return {'internal': assembly_walls[0], 'external': None}
    
    def _extract_internal_face_coordinates(self, wall) -> Optional[List[Tuple[float, float, float]]]:
        """Extract internal face coordinates using wall thickness + centerline offset"""
        try:
            # Get the centerline first using universal coordinate extraction
            centerline = self._extract_universal_coordinates(wall)
            if not centerline or len(centerline) < 2:
                return None
            
            # Calculate wall direction vector
            p1, p2 = centerline[0], centerline[1]
            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            length = (dx*dx + dy*dy) ** 0.5
            
            if length == 0:
                return None
            
            # Normalize direction vector
            dx_norm = dx / length
            dy_norm = dy / length
            
            # Calculate wall angle
            angle_rad = math.atan2(dy, dx)
            angle_deg = math.degrees(angle_rad)
            
            # Get wall thickness using hybrid approach
            thickness = self._get_wall_thickness_hybrid(wall, angle_deg)
            if thickness is None:
                return None
            
            # Calculate perpendicular vector (pointing inward)
            # Rotate 90 degrees counterclockwise: (x, y) -> (-y, x)
            perp_x = -dy_norm
            perp_y = dx_norm
            
            # Calculate offset distance (half thickness inward)
            offset_distance = thickness / 2.0
            
            # Calculate internal face endpoints
            internal_p1 = (
                p1[0] + perp_x * offset_distance,
                p1[1] + perp_y * offset_distance,
                p1[2]
            )
            internal_p2 = (
                p2[0] + perp_x * offset_distance,
                p2[1] + perp_y * offset_distance,
                p2[2]
            )
            
            return [internal_p1, internal_p2]
            
        except Exception:
            return None
    
    def _calculate_building_centroid(self, walls) -> Tuple[float, float]:
        """Calculate the building centroid from all wall center points"""
        try:
            if not walls:
                return (0.0, 0.0)
            
            total_x = 0.0
            total_y = 0.0
            count = 0
            
            for wall in walls:
                centerline = self._extract_universal_coordinates(wall)
                if centerline and len(centerline) >= 2:
                    p1, p2 = centerline[0], centerline[1]
                    center_x = (p1[0] + p2[0]) / 2
                    center_y = (p1[1] + p2[1]) / 2
                    total_x += center_x
                    total_y += center_y
                    count += 1
            
            if count == 0:
                return (0.0, 0.0)
            
            return (total_x / count, total_y / count)
            
        except Exception:
            return (0.0, 0.0)

    def _get_wall_thickness_hybrid(self, wall, angle_deg: float) -> Optional[float]:
        """Get wall thickness using hybrid approach for different wall orientations"""
        try:
            # Check if wall is axis-aligned (0°, 90°, 180°, 270°)
            axis_aligned = abs(angle_deg % 90) < 1.0 or abs(angle_deg % 90 - 90) < 1.0
            
            if axis_aligned:
                bbox = self._extract_element_bounding_box(wall)
                if bbox:
                    min_x, min_y, min_z = bbox[0]
                    max_x, max_y, max_z = bbox[1]
                    
                    x_span = max_x - min_x
                    y_span = max_y - min_y
                    thickness = min(x_span, y_span)
                    
                    self._store_reference_thickness(thickness)
                    return thickness
            else:
                properties = self._extract_properties(wall)
                thickness = self._get_property_value(properties, 'Width', 'Thickness', 'OverallWidth')
                
                if thickness is not None:
                    return thickness
                
                reference_thickness = self._get_reference_thickness()
                if reference_thickness is not None:
                    return reference_thickness
                
                bbox = self._extract_element_bounding_box(wall)
                if bbox:
                    min_x, min_y, min_z = bbox[0]
                    max_x, max_y, max_z = bbox[1]
                    
                    x_span = max_x - min_x
                    y_span = max_y - min_y
                    thickness = min(x_span, y_span)
                    return thickness
            
            return None
            
        except Exception:
            return None

    def _store_reference_thickness(self, thickness: float):
        """Store thickness from axis-aligned walls for use by diagonal walls"""
        if not hasattr(self, '_reference_thicknesses'):
            self._reference_thicknesses = []
        
        self._reference_thicknesses.append(thickness)

    def _get_reference_thickness(self) -> Optional[float]:
        """Get reference thickness from axis-aligned walls"""
        if not hasattr(self, '_reference_thicknesses') or not self._reference_thicknesses:
            return None
        
        # Use the most common thickness (mode) or average
        thicknesses = self._reference_thicknesses
        
        # Find the most common thickness (within 1cm tolerance)
        thickness_counts = {}
        for t in thicknesses:
            rounded = round(t, 2)  # Round to 1cm
            thickness_counts[rounded] = thickness_counts.get(rounded, 0) + 1
        
        most_common = max(thickness_counts.items(), key=lambda x: x[1])
        reference_thickness = most_common[0]
        
        return reference_thickness


    def _calculate_orientation(self, coords: List[Tuple[float, float, float]]) -> Optional[float]:
        """Calculate wall orientation from coordinates"""
        if len(coords) < 2:
            return None
            
        try:
            # Get first two points
            p1, p2 = coords[0], coords[1]
            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            
            # Calculate angle in degrees
            angle_rad = np.arctan2(dy, dx)
            angle_deg = np.degrees(angle_rad)
            
            # Normalize to 0-360
            if angle_deg < 0:
                angle_deg += 360
                
            # Round to 1 decimal place for cleaner output
            return round(angle_deg, 1)
            
        except Exception:
            return None

    def _reorient_walls_outward(self, ifc_model: IfcModel):
        """Ensure wall orientations face outward.
        Strategy:
          - Per-floor AABB footprint as a coarse exterior proxy
          - Edge-distance guard: only consider flipping for near-boundary walls
          - Two-normal test: evaluate epsilon steps for +n and -n; if one goes outside AABB and the other stays inside, choose the outside
          - Fallback when ambiguous: sample neighborhood density along ±n and prefer the direction with fewer nearby segments (more free space)
          - Emit OrientationDecision audit records per wall
        """
        # Build per-floor hull and bbox
        floor_bbox: Dict[int, Tuple[float,float,float,float]] = {}
        floor_points: Dict[int, List[Tuple[float,float]]] = {}
        def floor_idx(storey_name: Optional[str]) -> int:
            try:
                return int(self._get_floor_level_index(storey_name, ifc_model.storeys))
            except Exception:
                return 0
        for w in ifc_model.walls:
            if not w.coordinates or len(w.coordinates) < 2:
                continue
            fi = floor_idx(w.storey)
            xs = [w.coordinates[0][0], w.coordinates[1][0]]
            ys = [w.coordinates[0][1], w.coordinates[1][1]]
            if fi not in floor_bbox:
                floor_bbox[fi] = (min(xs), min(ys), max(xs), max(ys))
            else:
                x0,y0,x1,y1 = floor_bbox[fi]
                floor_bbox[fi] = (min(x0,min(xs)), min(y0,min(ys)), max(x1,max(xs)), max(y1,max(ys)))
            # collect midpoints for outline
            mx = (xs[0] + xs[1]) / 2.0
            my = (ys[0] + ys[1]) / 2.0
            floor_points.setdefault(fi, []).append((mx, my))
        # Build convex hulls per floor via monotone chain
        def convex_hull(points: List[Tuple[float,float]]) -> List[Tuple[float,float]]:
            pts = sorted(set(points))
            if len(pts) <= 2:
                return pts
            def cross(o,a,b):
                return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
            lower = []
            for p in pts:
                while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
                    lower.pop()
                lower.append(p)
            upper = []
            for p in reversed(pts):
                while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
                    upper.pop()
                upper.append(p)
            hull = lower[:-1] + upper[:-1]
            return hull
        floor_hull: Dict[int, List[Tuple[float,float]]] = {}
        for fi, pts in floor_points.items():
            try:
                floor_hull[fi] = convex_hull(pts)
            except Exception:
                floor_hull[fi] = []
        # point-in-polygon (ray casting), returns True if inside or on edge
        def point_in_poly(px: float, py: float, poly: List[Tuple[float,float]]) -> bool:
            n = len(poly)
            if n == 0:
                return True
            inside = False
            for i in range(n):
                x1,y1 = poly[i]
                x2,y2 = poly[(i+1)%n]
                # check on edge
                if min(x1,x2)-1e-9 <= px <= max(x1,x2)+1e-9 and min(y1,y2)-1e-9 <= py <= max(y1,y2)+1e-9:
                    # colinear check
                    dx,dy = (x2-x1),(y2-y1)
                    if abs(dx*(py-y1) - dy*(px-x1)) <= 1e-9:
                        return True
                # crossings
                if ((y1 > py) != (y2 > py)):
                    xin = x1 + (py - y1) * (x2 - x1) / (y2 - y1 + 1e-18)
                    if px <= xin:
                        inside = not inside
            return inside
        # Helper: compute min distance of point to bbox edges
        def point_to_bbox_edge_dist(mx: float, my: float, bbox: Tuple[float,float,float,float]) -> float:
            bx0,by0,bx1,by1 = bbox
            return min(abs(mx - bx0), abs(bx1 - mx), abs(my - by0), abs(by1 - my))
        # Helper: simple neighborhood density along a direction
        def direction_free_space(fi: int, mx: float, my: float, nx: float, ny: float, sample_dist: float = 0.75) -> float:
            px = mx + nx * sample_dist
            py = my + ny * sample_dist
            # count segments whose closest point lies within a small radius of (px,py)
            radius2 = 0.20 * 0.20
            count = 0
            for w2 in ifc_model.walls:
                if not w2.coordinates or len(w2.coordinates) < 2 or floor_idx(w2.storey) != fi:
                    continue
                (ax,ay,_),(bx,by,_) = w2.coordinates[0], w2.coordinates[1]
                vx, vy = (bx-ax), (by-ay)
                vlen2 = vx*vx + vy*vy
                if vlen2 <= 1e-9:
                    continue
                t = ((px-ax)*vx + (py-ay)*vy) / vlen2
                t = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
                cx, cy = (ax + t*vx), (ay + t*vy)
                dx, dy = (px - cx), (py - cy)
                if (dx*dx + dy*dy) <= radius2:
                    count += 1
            # larger free space means fewer neighbors; return inverse count as "score"
            return 1.0 / (1 + count)

        # Helpers for A/B simulation (non-mutating decisions)
        def decide_edge(fi_local: int, w) -> bool:
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx, ny = (-vy/norm, vx/norm)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            bbox = floor_bbox.get(fi_local)
            if not bbox:
                return False
            bx0,by0,bx1,by1 = bbox
            d_left = abs(mx - bx0); d_right = abs(bx1 - mx)
            d_bottom = abs(my - by0); d_top = abs(by1 - my)
            m = min(d_left, d_right, d_bottom, d_top)
            if m == d_left:
                ex, ey = (-1.0, 0.0)
            elif m == d_right:
                ex, ey = (1.0, 0.0)
            elif m == d_bottom:
                ex, ey = (0.0, -1.0)
            else:
                ex, ey = (0.0, 1.0)
            dot_pos = nx*ex + ny*ey
            dot_neg = (-nx)*ex + (-ny)*ey
            # flip if negative normal matches edge outward better
            return dot_neg > dot_pos + 1e-9

        def decide_hull(fi_local: int, w) -> bool:
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx, ny = (-vy/norm, vx/norm)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            eps_local = 0.05
            hull = floor_hull.get(fi_local) or []
            def outside_local(p):
                if len(hull) >= 3:
                    return not point_in_poly(p[0], p[1], hull)
                bbox = floor_bbox.get(fi_local)
                if not bbox:
                    return False
                bx0,by0,bx1,by1 = bbox
                return not (bx0-1e-6 <= p[0] <= bx1+1e-6 and by0-1e-6 <= p[1] <= by1+1e-6)
            step_pos_out = outside_local((mx+nx*eps_local, my+ny*eps_local))
            step_neg_out = outside_local((mx-nx*eps_local, my-ny*eps_local))
            if step_pos_out != step_neg_out:
                return not step_pos_out  # flip if negative is outside
            # fallback to free-space
            score_pos = direction_free_space(fi_local, mx, my, nx, ny)
            score_neg = direction_free_space(fi_local, mx, my, -nx, -ny)
            return score_neg > score_pos + 1e-9

        def decide_centroid(fi_local: int, w) -> bool:
            # Strategy: Compute floor centroid; outward normal should point away from centroid
            bbox = floor_bbox.get(fi_local)
            if not bbox:
                return False
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx, ny = (-vy/norm, vx/norm)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            # Compute floor centroid from all walls
            cx = cy = 0.0; n = 0
            for w2 in ifc_model.walls:
                if not w2.coordinates or len(w2.coordinates) < 2 or floor_idx(w2.storey) != fi_local:
                    continue
                (ax,ay,_),(bx2,by2,_) = w2.coordinates[0], w2.coordinates[1]
                cx += (ax + bx2) / 2.0
                cy += (ay + by2) / 2.0
                n += 1
            if n == 0:
                return False
            cx /= n; cy /= n
            # Vector from centroid to wall midpoint
            dx, dy = (mx - cx), (my - cy)
            # Dot product with normals: positive means pointing away from centroid
            dot_pos = nx*dx + ny*dy
            dot_neg = (-nx)*dx + (-ny)*dy
            return dot_neg > dot_pos + 1e-9

        def decide_axis_quadrant(fi_local: int, w) -> bool:
            # Strategy: Classify by dominant axis (N/S/E/W), then use quadrant-based logic
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx, ny = (-vy/norm, vx/norm)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            bbox = floor_bbox.get(fi_local)
            if not bbox:
                return False
            bx0,by0,bx1,by1 = bbox
            # Determine which axis dominates
            if abs(vx) >= abs(vy):
                # Horizontal wall: should face N or S
                # If near top edge, face N (+y normal); if near bottom, face S (-y normal)
                d_top = abs(by1 - my)
                d_bot = abs(my - by0)
                target_ny = 1.0 if d_top <= d_bot else -1.0
                return (target_ny > 0 and ny < 0) or (target_ny < 0 and ny > 0)
            else:
                # Vertical wall: should face E or W
                d_right = abs(bx1 - mx)
                d_left = abs(mx - bx0)
                target_nx = 1.0 if d_right <= d_left else -1.0
                return (target_nx > 0 and nx < 0) or (target_nx < 0 and nx > 0)

        def decide_both_normals(fi_local: int, w) -> bool:
            # Strategy: Test both normals explicitly, pick the one that points away from centroid better
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx1, ny1 = (-vy/norm, vx/norm)  # normal 1
            nx2, ny2 = (vy/norm, -vx/norm)  # normal 2 (opposite)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            # Compute floor centroid
            cx = cy = 0.0; n = 0
            for w2 in ifc_model.walls:
                if not w2.coordinates or len(w2.coordinates) < 2 or floor_idx(w2.storey) != fi_local:
                    continue
                (ax,ay,_),(bx2,by2,_) = w2.coordinates[0], w2.coordinates[1]
                cx += (ax + bx2) / 2.0
                cy += (ay + by2) / 2.0
                n += 1
            if n == 0:
                return False
            cx /= n; cy /= n
            # Vector from centroid to wall midpoint
            dx, dy = (mx - cx), (my - cy)
            # Test which normal points more "away" from centroid
            dot1 = nx1*dx + ny1*dy  # normal 1 awayness
            dot2 = nx2*dx + ny2*dy  # normal 2 awayness
            # If normal 2 points away more, we need to flip (use normal 2 = opposite of normal 1)
            return dot2 > dot1 + 1e-9

        def decide_neighbor_density(fi_local: int, w) -> bool:
            # Strategy: Compare neighbor wall density on each side (external = fewer neighbors)
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx, ny = (-vy/norm, vx/norm)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            # Sample points offset along each normal
            offset = 0.5
            px_pos, py_pos = (mx + nx*offset, my + ny*offset)
            px_neg, py_neg = (mx - nx*offset, my - ny*offset)
            radius = 1.0
            count_pos = count_neg = 0
            for w2 in ifc_model.walls:
                if not w2.coordinates or len(w2.coordinates) < 2 or floor_idx(w2.storey) != fi_local or w2 is w:
                    continue
                (ax,ay,_),(bx2,by2,_) = w2.coordinates[0], w2.coordinates[1]
                vx2, vy2 = (bx2-ax), (by2-ay)
                vlen2 = vx2*vx2 + vy2*vy2
                if vlen2 <= 1e-9:
                    continue
                # Distance from sampled point to wall segment
                for px, py in [(px_pos, py_pos), (px_neg, py_neg)]:
                    t = ((px-ax)*vx2 + (py-ay)*vy2) / vlen2
                    t = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
                    cx, cy = (ax + t*vx2), (ay + t*vy2)
                    dx, dy = (px - cx), (py - cy)
                    if (dx*dx + dy*dy) <= radius*radius:
                        if px == px_pos:
                            count_pos += 1
                        else:
                            count_neg += 1
            # Fewer neighbors = outside (external wall)
            return count_neg < count_pos

        def decide_vote(fi_local: int, w) -> bool:
            # Determine group outward directions, then check wall
            bbox = floor_bbox.get(fi_local)
            if not bbox:
                return False
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                return False
            nx, ny = (-vy/norm, vx/norm)
            # Build group tallies once
            # Horizontal group
            by0 = bbox[1]; by1 = bbox[3]
            top = bot = 0
            for w2 in ifc_model.walls:
                if not w2.coordinates or len(w2.coordinates) < 2 or floor_idx(w2.storey) != fi_local:
                    continue
                (ax,ay,_),(bx2,by2,_) = w2.coordinates[0], w2.coordinates[1]
                if abs((bx2-ax)) >= abs((by2-ay)):
                    my2 = (ay+by2)/2.0
                    if abs(by1 - my2) <= abs(my2 - by0):
                        top += 1
                    else:
                        bot += 1
            gy = 1.0 if top >= bot else -1.0
            # Vertical group
            bx0 = bbox[0]; bx1 = bbox[2]
            right = left = 0
            for w2 in ifc_model.walls:
                if not w2.coordinates or len(w2.coordinates) < 2 or floor_idx(w2.storey) != fi_local:
                    continue
                (ax,ay,_),(bx2,by2,_) = w2.coordinates[0], w2.coordinates[1]
                if abs((bx2-ax)) < abs((by2-ay)):
                    mx2 = (ax+bx2)/2.0
                    if abs(bx1 - mx2) <= abs(mx2 - bx0):
                        right += 1
                    else:
                        left += 1
            gx = 1.0 if right >= left else -1.0
            # If wall is horizontal, check ny sign; if vertical, check nx sign
            if abs(vx) >= abs(vy):
                return (gy > 0 and ny < 0) or (gy < 0 and ny > 0)
            else:
                return (gx > 0 and nx < 0) or (gx < 0 and nx > 0)

        # If requested, run A/B orientation comparison for reference walls
        try:
            orient_ab = getattr(self, 'orientation_ab', 'off')
        except Exception:
            orient_ab = 'off'
        if orient_ab == 'on':
            # Parse reference list: Name=deg pairs
            ref_arg = getattr(self, 'orient_ref', '') or ''
            ref_pairs: Dict[str, float] = {}
            for part in [p.strip() for p in ref_arg.split(',') if p.strip()]:
                if '=' in part:
                    k,v = part.split('=',1)
                    try:
                        ref_pairs[k.strip()] = float(v.strip())
                    except Exception:
                        pass
            # Build index by name for quick lookup (multiple variations)
            name_to_wall = {}
            for w in ifc_model.walls:
                nm = getattr(w, 'name', None) or getattr(w, 'global_id', None)
                if nm:
                    name_to_wall[nm] = w
                    name_to_wall[nm.replace(':', '_')] = w
                    name_to_wall[nm.replace(':', '_').replace(' ', '_')] = w
                    # Also index by trailing ID (most unique part)
                    if '_' in nm:
                        tail = nm.split('_')[-1]
                        if tail and len(tail) > 5:
                            name_to_wall[tail] = w
            # Wrapper to reverse any decision function
            def reversed_decider(fn):
                return lambda fi, w: not fn(fi, w)
            
            strategies = {
                'edge': decide_edge,
                'edge_rev': reversed_decider(decide_edge),
                'hull': decide_hull,
                'hull_rev': reversed_decider(decide_hull),
                'vote': decide_vote,
                'vote_rev': reversed_decider(decide_vote),
                'centroid': decide_centroid,
                'centroid_rev': reversed_decider(decide_centroid),
                'axis_quadrant': decide_axis_quadrant,
                'axis_quadrant_rev': reversed_decider(decide_axis_quadrant),
                'neighbor_density': decide_neighbor_density,
                'neighbor_density_rev': reversed_decider(decide_neighbor_density),
                'both_normals': decide_both_normals,
            }
            results = {}
            for strat, decider in strategies.items():
                correct = 0; total = 0
                details = []
                for ref_name, ref_deg in ref_pairs.items():
                    # Try multiple matching strategies
                    w = name_to_wall.get(ref_name)
                    if not w:
                        w = name_to_wall.get(ref_name.replace(':', '_'))
                    if not w and '_' in ref_name:
                        # Try by trailing ID
                        tail = ref_name.split('_')[-1]
                        if tail:
                            w = name_to_wall.get(tail)
                    if not w or not w.coordinates or len(w.coordinates) < 2:
                        continue
                    fi_local = floor_idx(w.storey)
                    flip = decider(fi_local, w)
                    (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
                    if flip:
                        x0,y0,z0,x1,y1,z1 = x1,y1,z1,x0,y0,z0
                    orient = self._calculate_orientation([(x0,y0,z0),(x1,y1,z1)])
                    total += 1
                    if orient is not None and abs(((orient - ref_deg + 540) % 360) - 180) <= 1.0:
                        correct += 1
                    details.append({
                        'name': ref_name,
                        'expected': ref_deg,
                        'predicted': orient,
                        'flip': flip
                    })
                results[strat] = {'correct': correct, 'total': total, 'details': details}
            try:
                if self.audit_collector:
                    self.audit_collector.records.append({
                        'type': 'OrientationAB',
                        'results': results
                    })
            except Exception:
                pass
        # Test for each wall
        for w in ifc_model.walls:
            if not w.coordinates or len(w.coordinates) < 2:
                continue
            fi = floor_idx(w.storey)
            bbox = floor_bbox.get(fi)
            if not bbox:
                continue
            (x0,y0,z0),(x1,y1,z1) = w.coordinates[0], w.coordinates[1]
            vx, vy = (x1-x0), (y1-y0)
            norm = (vx*vx + vy*vy) ** 0.5
            if norm <= 1e-9:
                continue
            nx, ny = (-vy/norm, vx/norm)
            mx, my = ((x0+x1)/2.0, (y0+y1)/2.0)
            eps = 0.05
            hull = floor_hull.get(fi) or []
            def outside(p):
                # prefer hull test when available; fallback to bbox if hull empty or too small
                if len(hull) >= 3:
                    return not point_in_poly(p[0], p[1], hull)
                bx0,by0,bx1,by1 = bbox
                return not (bx0-1e-6 <= p[0] <= bx1+1e-6 and by0-1e-6 <= p[1] <= by1+1e-6)
            # Per-edge rule with epsilon guard; fallback to two-normal/hull and free-space
            edge_tol = 0.50
            edge_dist = point_to_bbox_edge_dist(mx, my, bbox)
            decision = "skip_interior"
            flipped = False
            bx0,by0,bx1,by1 = bbox
            d_left = abs(mx - bx0); d_right = abs(bx1 - mx)
            d_bottom = abs(my - by0); d_top = abs(by1 - my)
            if edge_dist <= edge_tol:
                # nearest edge outward unit
                m = min(d_left, d_right, d_bottom, d_top)
                if m == d_left:
                    ex, ey = (-1.0, 0.0); edge_name = "left"
                elif m == d_right:
                    ex, ey = (1.0, 0.0); edge_name = "right"
                elif m == d_bottom:
                    ex, ey = (0.0, -1.0); edge_name = "bottom"
                else:
                    ex, ey = (0.0, 1.0); edge_name = "top"
                dot_pos = nx*ex + ny*ey
                dot_neg = (-nx)*ex + (-ny)*ey
                # Account for internal face coordinates: invert flip logic
                # (internal face normals point inward by default, so outward is opposite)
                if dot_neg > dot_pos + 1e-9:
                    decision = f"edge_rule_keep_{edge_name}"
                    w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
                elif dot_pos > dot_neg + 1e-9:
                    decision = f"edge_rule_flip_{edge_name}"
                    w.coordinates[0], w.coordinates[1] = (x1,y1,z1), (x0,y0,z0)
                    flipped = True
                    w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
                else:
                    # tie → two-normal hull outside test
                    # Account for internal face: invert logic (neg_out means outward for internal face)
                    step_pos_out = outside((mx+nx*eps, my+ny*eps))
                    step_neg_out = outside((mx-nx*eps, my-ny*eps))
                    if step_pos_out != step_neg_out:
                        if step_neg_out:  # inverted: neg_out means outward for internal face
                            decision = f"hull_keep_{edge_name}"
                            w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
                        else:
                            decision = f"hull_flip_{edge_name}"
                            w.coordinates[0], w.coordinates[1] = (x1,y1,z1), (x0,y0,z0)
                            flipped = True
                            w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
                    else:
                        # final fallback: free-space
                        # Account for internal face: invert logic (higher neg score means outward)
                        score_pos = direction_free_space(fi, mx, my, nx, ny)
                        score_neg = direction_free_space(fi, mx, my, -nx, -ny)
                        if score_neg > score_pos + 1e-9:  # inverted: neg score means outward
                            decision = f"space_keep_{edge_name}"
                            w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
                        elif score_pos > score_neg + 1e-9:
                            decision = f"space_flip_{edge_name}"
                            w.coordinates[0], w.coordinates[1] = (x1,y1,z1), (x0,y0,z0)
                            flipped = True
                            w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
                        else:
                            decision = f"edge_tie_leave_{edge_name}"
                            w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
            else:
                # interior: leave
                decision = "interior_leave"
                w.orientation = self._calculate_orientation([w.coordinates[0], w.coordinates[1]])
            # Audit record
            try:
                if self.audit_collector:
                    self.audit_collector.records.append({
                        "type": "OrientationDecision",
                        "wall": getattr(w, 'name', None) or getattr(w, 'global_id', None) or "unknown",
                        "storey": w.storey or "unknown",
                        "floor_index": fi,
                        "mx": round(mx,3),
                        "my": round(my,3),
                        "edge_dist_m": round(edge_dist,3),
                        "step_pos_out": bool(step_pos_out),
                        "step_neg_out": bool(step_neg_out),
                        "decision": decision,
                        "flipped": flipped,
                        "orientation360": w.orientation
                    })
            except Exception:
                pass
    
    def _calculate_polygon_area_and_perimeter(self, coords: List[Tuple[float, float, float]]) -> Tuple[float, float]:
        """
        Calculate polygon area and perimeter using Shoelace formula
        Returns: (area, perimeter) in square meters and meters
        """
        if len(coords) < 3:
            return (0.0, 0.0)
        
        try:
            # Area calculation using Shoelace formula
            area = 0.0
            perimeter = 0.0
            
            for i in range(len(coords)):
                x1, y1, _ = coords[i]
                x2, y2, _ = coords[(i + 1) % len(coords)]
                
                # Area using Shoelace formula
                area += x1 * y2 - x2 * y1
                
                # Perimeter
                dx = x2 - x1
                dy = y2 - y1
                perimeter += np.sqrt(dx**2 + dy**2)
            
            area = abs(area) / 2.0
            return (round(area, 3), round(perimeter, 3))
            
        except Exception:
            return (0.0, 0.0)

    def _get_element_storey(self, element) -> Optional[str]:
        """Get the storey name for an element"""
        try:
            # Check if element has a container
            if hasattr(element, 'ContainedInStructure'):
                for rel in element.ContainedInStructure:
                    if hasattr(rel, 'RelatingStructure'):
                        structure = rel.RelatingStructure
                        if structure.is_a('IfcBuildingStorey'):
                            return getattr(structure, 'Name', f'Storey_{structure.id()}')
            
            # Check if element has a placement with storey reference
            if hasattr(element, 'ObjectPlacement'):
                placement = element.ObjectPlacement
                if hasattr(placement, 'PlacementRelTo'):
                    rel_placement = placement.PlacementRelTo
                    if rel_placement and rel_placement.is_a('IfcBuildingStorey'):
                        return getattr(rel_placement, 'Name', f'Storey_{rel_placement.id()}')
            
            return None
            
        except Exception:
            return None
    
    def _get_storey_elevation(self, storey_name: str) -> Optional[float]:
        """Get the elevation of a storey by name"""
        try:
            storeys = self.model.by_type('IfcBuildingStorey')
            for storey in storeys:
                if hasattr(storey, 'Name') and storey.Name == storey_name:
                    if hasattr(storey, 'Elevation'):
                        return storey.Elevation
            return None
        except Exception:
            return None
    

    def _get_floor_level_index(self, storey_name: Optional[str], storeys: List[Dict[str, Any]]) -> int:
        """Return 0-based floor index by sorted elevation; 0 if unknown.
        
        For synthetic storeys (created in internal mode) with explicit floor_index,
        returns that value directly. For real IFC storeys, sorts by elevation.
        """
        try:
            if not storey_name or not storeys:
                return 0
            
            # First, check if storey has explicit floor_index (for synthetic storeys like roofs)
            for s in storeys:
                if s.get('name') == storey_name and 'floor_index' in s:
                    return int(s['floor_index'])
            
            # Otherwise, sort by elevation (for real IFC storeys)
            ordered = sorted(storeys, key=lambda s: float(s.get('elevation') or 0.0))
            for idx, s in enumerate(ordered):
                if s.get('name') == storey_name:
                    return idx
            return 0
        except Exception:
            return 0
    
    def _get_max_floor_index(self, ifc_model: IfcModel) -> int:
        """Return the maximum floor index from all elements with assigned storeys."""
        try:
            max_floor = 0
            # Check walls, windows, doors, floors for their storey assignments
            for element in ifc_model.walls + ifc_model.windows + ifc_model.doors + ifc_model.floors:
                if element.storey:
                    floor_idx = self._get_floor_level_index(element.storey, ifc_model.storeys)
                    max_floor = max(max_floor, floor_idx)
            return max_floor
        except Exception:
            return 0
    
    def _assign_roof_floor_index(self, roof: IfcElement, ifc_model: IfcModel) -> int:
        """
        Assign floor index to roofs. 
        If roof has no storey, assign it to the highest floor + 1 (roof space).
        Otherwise, use the normal storey-based floor index.
        """
        try:
            if roof.storey is None:
                # Roof without storey: assign to roof space (max floor + 1)
                max_floor = self._get_max_floor_index(ifc_model)
                roof_floor = max_floor + 1
                return roof_floor
            else:
                # Roof with storey: check if it's a dict with explicit floor_index
                if isinstance(roof.storey, dict) and 'floor_index' in roof.storey:
                    # Synthetic storey with explicit floor_index (internal mode)
                    return int(roof.storey['floor_index'])
                else:
                    # Real IFC storey: extract name and use normal calculation
                    storey_name = roof.storey if isinstance(roof.storey, str) else roof.storey.get('name') if isinstance(roof.storey, dict) else None
                    return self._get_floor_level_index(storey_name, ifc_model.storeys)
        except Exception:
            return 0

    def _format_coords_for_csv(self, coords: List[Tuple[float, float, float]]) -> str:
        """Format coordinates for CSV coords field"""
        if not coords:
            return ""
        
        try:
            # Format as "x1,y1,z1|x2,y2,z2|..." with quotes
            coord_strings = []
            for x, y, z in coords:
                coord_strings.append(f"{x:.3f},{y:.3f},{z:.3f}")
            
            return f'"{"|".join(coord_strings)}"'
            
        except Exception:
            return ""

    def generate_csv(self, ifc_model: IfcModel) -> str:
        """Generate CSV content from extracted IFC model"""
        csv_lines = []
        # door audit lines (written to sidecar file by caller after generation)
        self._door_audit = []
        
        # Zone section (single zone)
        csv_lines.append("Zone,,,,,,,,,,,,,")
        csv_lines.append("Name,Type,volume,floor_area,height,simplified thermal bridging")
        csv_lines.append("Living,Zone,,,,FALSE")
        
        csv_lines.append(",,,,,,,,,,,,,")
        
        # Exposed Elements section
        csv_lines.append("Exposed Elements,,,,,,,,,,,,,,")
        csv_lines.append("Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json")
        
        # Add walls (only external walls)
        for wall in ifc_model.walls:
            is_ext_wall = bool((wall.properties or {}).get('is_external'))
            if not is_ext_wall:
                # Audit: dropped non-external wall
                if self.audit_collector and not getattr(wall, '_audit_logged', False):
                    wall_audit = self._create_wall_audit_record(wall, getattr(wall, '_audit_wall_handle', None), ifc_model)
                    wall_audit['final_state'] = 'dropped'
                    wall_audit['reasons'] = ['not_external']
                    wall_audit['classification'] = {'wall_external': False}
                    self.audit_collector.log_element(**wall_audit)
                    wall._audit_logged = True
                continue
                
            zone_name = "Living"
            wall_name = wall.name.replace(',', '_').replace(':', '_')
            # derive length and height; width (thickness) not used, so leave blank or set to length if needed
            length_val = None
            if wall.coordinates and len(wall.coordinates) >= 2:
                (x1,y1,_),(x2,y2,_) = wall.coordinates[0], wall.coordinates[1]
                dx, dy = (x2-x1),(y2-y1)
                length_val = (dx*dx+dy*dy) ** 0.5
            # Calculate wall pitch with priority: IFC properties → geometry analysis
            wall_pitch = None
            
            # Priority 1: Check IFC properties first
            if hasattr(wall, 'properties') and wall.properties:
                wall_pitch = self._get_property_value(wall.properties, 'Pitch', 'Slope', 'Inclination', 'PitchAngle')
                if wall_pitch is not None:
                    wall_pitch = float(wall_pitch)
            
            # Priority 2: Geometry analysis fallback
            if wall_pitch is None:
                wall_pitch = self._estimate_wall_pitch_deg(wall)
            
            # CRITICAL FIX: Always prefer face-derived Z span when available, regardless of pitch
            from_zspan = False
            hzmin_attr = getattr(wall, 'height_z_min', None)
            hzmax_attr = getattr(wall, 'height_z_max', None)
            if hzmin_attr is not None and hzmax_attr is not None:
                height_val = float(hzmax_attr) - float(hzmin_attr)
                from_zspan = True
                # Use the zspan height even if wall is sloped
                pitch = f"{wall_pitch:.1f}" if wall_pitch is not None and wall_pitch >= 1.0 else ""
            elif wall_pitch is not None and wall_pitch >= 1.0 and wall_pitch < 90.0:  # Sloped wall (1+ degrees, but not vertical 90°)
                # For sloped walls, calculate average height across the slope
                height_val = self._calculate_sloped_wall_average_height(wall)
                pitch = f"{wall_pitch:.1f}"
            else:
                # Standard rectangular wall (including vertical 90° walls)
                # Fallback: try to compute Z-span from current wall coordinates (original Zs)
                height_val = None
                try:
                    if wall.coordinates and len(wall.coordinates) >= 2 and len(wall.coordinates[0]) >= 3:
                        zs = [pt[2] for pt in wall.coordinates]
                        zmin_c = min(zs)
                        zmax_c = max(zs)
                        if zmax_c > zmin_c:
                            height_val = zmax_c - zmin_c
                            from_zspan = True
                except Exception:
                    height_val = None
                if height_val is None:
                    height_val = wall.height if wall.height is not None else None
                pitch = ""
            # area removed - calculated in app from width x height
            # Note: walls are stored in mm (native IFC units), so we multiply by length_unit_factor to convert to m
            if height_val is None:
                height = ""
            else:
                # If we computed from Z span, treat as meters already; otherwise scale by unit factor
                use_zspan = False
                try:
                    use_zspan = bool(from_zspan)
                except Exception:
                    use_zspan = False
                height_m = height_val if use_zspan else (height_val * self.length_unit_factor)
                height = f"{height_m:.3f}"
            width = f"{length_val:.3f}" if length_val is not None else ""
            orientation = f"{wall.orientation:.1f}" if wall.orientation is not None else ""
            # set z to floor index for all coords
            if wall.coordinates:
                z = self._get_floor_level_index(wall.storey, ifc_model.storeys)
                coords_list = [(x, y, float(z)) for (x, y, _) in wall.coordinates]
                coords = self._format_coords_for_csv(coords_list)
            else:
                coords = ""
            # Exposed Elements columns:
            # area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
            # pitch already calculated above for sloped walls
            base_height = ""
            is_unheated = ""
            is_ext_door = ""
            parent = ""
            csv_lines.append(
                f"{wall_name},{zone_name},BuildingElementOpaque,,{pitch},{width},{height},{orientation},{base_height},{is_unheated},{is_ext_door},{parent},{coords},{{}}"
            )
            
            # Audit logging for kept wall
            if self.audit_collector and not getattr(wall, '_audit_logged', False):
                wall_audit = self._create_wall_audit_record(wall, getattr(wall, '_audit_wall_handle', None), ifc_model)
                wall_audit['final_state'] = 'kept'
                wall_audit['reasons'] = ['ok']
                wall_audit['classification'] = {'wall_external': True}
                self.audit_collector.log_element(**wall_audit)
                wall._audit_logged = True
        
        # Add external doors only (skip tiny hardware, e.g., handles)
        for door in ifc_model.doors:
            # Require non-zero size; host is optional for emission
            width_ok = door.width is not None and door.width > 0
            height_ok = door.height is not None and door.height > 0
            # determine host from extracted linkage
            linked_id = door.properties.get('linked_wall') if hasattr(door, 'properties') else None
            has_host = bool(linked_id)
            if not (width_ok and height_ok):
                # Audit logging for dropped door (missing size)
                if self.audit_collector and not getattr(door, '_audit_logged', False):
                    door_audit = self._create_door_audit_record(door, getattr(door, '_audit_door_handle', None), ifc_model, "dropped", ["missing_size"])
                    self.audit_collector.log_element(**door_audit)
                    door._audit_logged = True
                continue
            # drop tiny elements (likely hardware) using a size floor
            try:
                w_m = (door.width or 0.0) / self.length_unit_factor
                h_m = (door.height or 0.0) / self.length_unit_factor
                if (w_m < 0.3) or (h_m < 0.3):
                    # skip handle-like items
                    # Audit logging for dropped door (tiny)
                    if self.audit_collector and not getattr(door, '_audit_logged', False):
                        door_audit = self._create_door_audit_record(door, getattr(door, '_audit_door_handle', None), ifc_model, "dropped", ["tiny"])
                        self.audit_collector.log_element(**door_audit)
                        door._audit_logged = True
                    continue
            except Exception:
                pass
            # External flag: gate primarily by stored flag captured at extraction
            stored_flag = door.properties.get('is_external') if hasattr(door, 'properties') else None
            is_external = 'TRUE' if stored_flag is True else ('FALSE' if stored_flag is False else '')
            # if still unknown, infer from host wall externality when available
            if is_external == '' and has_host:
                try:
                    wall_external_map = {w.global_id: bool(w.properties.get('is_external')) for w in ifc_model.walls}
                    if linked_id in wall_external_map and wall_external_map[linked_id]:
                        is_external = 'TRUE'
                    elif linked_id in wall_external_map:
                        is_external = 'FALSE'
                except Exception:
                    pass
            # only emit external doors
            if is_external != 'TRUE':
                # Audit logging for dropped door
                if self.audit_collector and not getattr(door, '_audit_logged', False):
                    door_audit = self._create_door_audit_record(door, getattr(door, '_audit_door_handle', None), ifc_model, "dropped", ["not_external"])
                    self.audit_collector.log_element(**door_audit)
                    door._audit_logged = True
                continue
            
            zone_name = "Living"
            door_name = door.name.replace(',', '_').replace(':', '_')
            area = door.area if door.area is not None else ""
            # Note: doors are already stored in meters after extraction, so no conversion needed
            height = f"{door.height:.3f}" if door.height is not None else ""
            width = f"{door.width:.3f}" if door.width is not None else ""
            orientation = f"{door.orientation:.1f}" if door.orientation is not None else ""
            if door.coordinates:
                z = self._get_floor_level_index(door.storey, ifc_model.storeys)
                coords_list = [(x, y, float(z)) for (x, y, _) in door.coordinates]
                coords = self._format_coords_for_csv(coords_list)
            else:
                coords = ""
            
            # same Exposed Elements column order
            # Update door pitch if not set from properties
            if door.pitch is None:
                # Try to inherit from parent wall first
                if door.properties and door.properties.get('linked_wall'):
                    parent_wall_name = door.properties['linked_wall']
                    parent_wall = next((w for w in ifc_model.walls if w.name == parent_wall_name), None)
                    if parent_wall and hasattr(parent_wall, 'pitch') and parent_wall.pitch is not None:
                        door.pitch = parent_wall.pitch
                    else:
                        # Default to 90° for doors (vertical)
                        door.pitch = 90.0
                else:
                    # Default to 90° for doors (vertical)
                    door.pitch = 90.0
            pitch = f"{door.pitch:.0f}" if door.pitch is not None else ""
            base_height = ""
            is_unheated = ""
            is_ext_door = is_external
            parent = linked_id or ""
            csv_lines.append(
                f"{door_name},{zone_name},BuildingElementOpaque,{area},{pitch},{width},{height},{orientation},{base_height},{is_unheated},{is_ext_door},{parent},{coords},{{}}"
            )
            
            # Audit logging for kept door
            if self.audit_collector and not getattr(door, '_audit_logged', False):
                door_audit = self._create_door_audit_record(door, getattr(door, '_audit_door_handle', None), ifc_model, "kept", ["ok"])
                self.audit_collector.log_element(**door_audit)
                door._audit_logged = True
        
        # Add roofs here (Exposed Elements) as polygons
        for roof in ifc_model.roofs:
            zone_name = "Living"
            roof_name = roof.name.replace(',', '_').replace(':', '_')
            area = roof.area if roof.area is not None else ""
            # Calculate roof pitch with priority: IFC properties → geometry analysis
            roof_pitch = None
            
            # Priority 1: Check IFC properties first
            if hasattr(roof, 'properties') and roof.properties:
                roof_pitch = self._get_property_value(roof.properties, 'Pitch', 'Slope', 'Inclination', 'PitchAngle')
                if roof_pitch is not None:
                    roof_pitch = float(roof_pitch)
            
            # Priority 2: Geometry analysis fallback (use existing method)
            if roof_pitch is None:
                # For roofs, we need to get the actual slab geometry since roofs often have NULL representation
                # Try to find associated slabs via aggregation
                roof_slabs = self._get_roof_associated_slabs(roof)
                if roof_slabs:
                    # Use the first slab's pitch
                    roof_pitch = self._estimate_slab_pitch_deg(roof_slabs[0])
            
            pitch = f"{roof_pitch:.1f}" if roof_pitch is not None and roof_pitch >= 1.0 else ""
            if hasattr(roof, 'coordinates') and roof.coordinates:
                # Use original Z-coordinates to find bottom edge for orientation calculation
                original_coords = roof.coordinates
                
                bottom_edge_coords = self._find_bottom_edge_coords(original_coords)
                if bottom_edge_coords:
                    orientation = self._calculate_orientation(bottom_edge_coords)
                    
                    # 🔧 FIX: Reorder coordinates to put bottom edge first
                    reordered_coords = self._reorder_coords_bottom_edge_first(original_coords, bottom_edge_coords)
                else:
                    orientation = ""
                    reordered_coords = original_coords
                
                # Replace Z-coordinates with floor level for CSV output (consistent with other elements)
                # Use special roof floor assignment (roof space = max floor + 1 if no storey)
                z = self._assign_roof_floor_index(roof, ifc_model)
                coords_list = [(x, y, float(z)) for (x, y, _) in reordered_coords]
                coords = self._format_coords_for_csv(coords_list)
            else:
                coords = roof.coords_csv if hasattr(roof, 'coords_csv') and roof.coords_csv else ""
                orientation = ""
            # Calculate width and height from polygon dimensions (assuming flat projection)
            if hasattr(roof, 'coordinates') and roof.coordinates and len(roof.coordinates) >= 2:
                # Get bounding box of polygon
                xs = [coord[0] for coord in roof.coordinates]
                ys = [coord[1] for coord in roof.coordinates]
                width_m = max(xs) - min(xs)
                height_m = max(ys) - min(ys)
                width = f"{width_m:.3f}"
                height = f"{height_m:.3f}"
            else:
                width = ""
                height = ""
            base_height = ""
            is_unheated = ""
            is_ext_door = ""
            parent = ""
            csv_lines.append(
                f"{roof_name},{zone_name},BuildingElementOpaque,{area},{pitch},{width},{height},{orientation},{base_height},{is_unheated},{is_ext_door},{parent},{coords},{{}}"
            )

        csv_lines.append(",,,,,,,,,,,,,")
        
        # Window Elements section
        csv_lines.append("Window Elements,,,,,,,,,,,,,,")
        csv_lines.append("Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json")
        
        # Create GlobalId to wall name mapping for linked_wall
        wall_id_to_name = {}
        for wall in ifc_model.walls:
            if wall.global_id:
                wall_id_to_name[wall.global_id] = wall.name
        
        # Add windows
        for window in ifc_model.windows:
            zone_name = "Living"
            window_name = window.name.replace(',', '_').replace(':', '_')
            area = window.area if window.area is not None else ""
            height = f"{window.height:.3f}" if window.height is not None else ""
            width = f"{window.width:.3f}" if window.width is not None else ""
            orientation = f"{window.orientation:.2f}" if window.orientation is not None else ""
            # filter: require host present and valid dimensions
            has_host = bool(window.parent_element)
            if not has_host or window.width is None or window.width <= 0 or window.height is None or window.height <= 0:
                # Audit: dropped window
                if self.audit_collector and not getattr(window, '_audit_logged', False):
                    reasons = []
                    if not has_host:
                        reasons.append('missing_host')
                    if window.width is None or window.width <= 0 or window.height is None or window.height <= 0:
                        reasons.append('missing_size')
                    self.audit_collector.log_element(
                        element_id=window.global_id or f"window_{window.id}",
                        ifc_type='IfcWindow',
                        ifc_name=window.name,
                        final_state='dropped',
                        reasons=reasons or ['invalid'],
                        csv_fields={
                            'width_m': window.width if window.width else None,
                            'height_m': window.height if window.height else None,
                            'area_m2': window.area,
                            'orientation360': window.orientation,
                            'coords_preview': self._format_coords_preview(window.coordinates),
                            'parent_element': window.parent_element
                        },
                        sources={
                            'width': 'property' if 'OverallWidth' in (window.properties or {}) else 'bbox' if window.width else 'unknown',
                            'height': 'property' if 'OverallHeight' in (window.properties or {}) else 'bbox' if window.height else 'unknown',
                            'orientation': 'axis' if window.orientation else 'none',
                            'host': 'relation' if has_host else 'none'
                        },
                        classification={},
                        storey={'name': window.storey or 'unknown', 'floor_index': self._get_floor_level_index(window.storey, ifc_model.storeys)}
                    )
                    window._audit_logged = True
                continue
            if window.coordinates:
                z = self._get_floor_level_index(window.storey, ifc_model.storeys)
                coords_list = [(x, y, float(z)) for (x, y, _) in window.coordinates]
                coords = self._format_coords_for_csv(coords_list)
            else:
                coords = ""
            # Window Elements columns:
            # Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
            pitch = f"{window.pitch:.0f}" if window.pitch is not None else ""
            base_height = f"{window.base_height:.3f}" if window.base_height is not None else ""
            # Use wall name directly (already stored as parent_element)
            linked_wall = window.parent_element if window.parent_element else ""
            frame_area_fraction = f"{window.frame_area_fraction:.3f}" if window.frame_area_fraction is not None else ""
            free_area_height = f"{window.free_area_height:.3f}" if window.free_area_height is not None else ""
            mid_height = f"{window.mid_height:.3f}" if window.mid_height is not None else ""
            max_window_open_area = ""  # TODO: extract from IFC properties
            csv_lines.append(
                f"{window_name},{zone_name},BuildingElementTransparent,{area},{pitch},{width},{height},{orientation},{base_height},{linked_wall},{frame_area_fraction},{free_area_height},{mid_height},{max_window_open_area},{coords},{{}}"
            )
            # Audit: kept window
            if self.audit_collector and not getattr(window, '_audit_logged', False):
                self.audit_collector.log_element(
                    element_id=window.global_id or f"window_{window.id}",
                    ifc_type='IfcWindow',
                    ifc_name=window.name,
                    final_state='kept',
                    reasons=['ok'],
                    csv_fields={
                        'width_m': window.width if window.width else None,
                        'height_m': window.height if window.height else None,
                        'area_m2': window.area,
                        'orientation360': window.orientation,
                        'coords_preview': self._format_coords_preview(window.coordinates),
                        'parent_element': window.parent_element
                    },
                    sources={
                        'width': 'property' if 'OverallWidth' in (window.properties or {}) else 'bbox',
                        'height': 'property' if 'OverallHeight' in (window.properties or {}) else 'bbox',
                        'orientation': 'axis' if window.orientation else 'none',
                        'host': 'relation'
                    },
                    classification={},
                    storey={'name': window.storey or 'unknown', 'floor_index': self._get_floor_level_index(window.storey, ifc_model.storeys)}
                )
                window._audit_logged = True
        
        csv_lines.append(",,,,,,,,,,,,,")
        
        # Ground Elements section
        csv_lines.append("Ground Elements,,,,,,,,,,,,,,")
        csv_lines.append("Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json")
        
        # Add floors (emit polygon coords if available)
        for floor in ifc_model.floors:
            zone_name = "Living"
            floor_name = floor.name.replace(',', '_').replace(':', '_')
            
            # Use calculated area and perimeter
            area = f"{floor.area:.3f}" if floor.area is not None else ""
            
            # Calculate width and height from bounding box
            width = ""
            height = ""
            if hasattr(floor, 'coordinates') and floor.coordinates:
                xs = [coord[0] for coord in floor.coordinates]
                ys = [coord[1] for coord in floor.coordinates]
                width = f"{max(xs) - min(xs):.3f}"
                height = f"{max(ys) - min(ys):.3f}"
            
            # Calculate perimeter from coordinates
            perimeter = ""
            if hasattr(floor, 'coordinates') and floor.coordinates and len(floor.coordinates) >= 3:
                coords = floor.coordinates
                perim_sum = 0
                for i in range(len(coords)):
                    dx = coords[i][0] - coords[(i+1) % len(coords)][0]
                    dy = coords[i][1] - coords[(i+1) % len(coords)][1]
                    perim_sum += (dx*dx + dy*dy)**0.5
                perimeter = f"{perim_sum:.3f}"
            
            if hasattr(floor, 'coordinates') and floor.coordinates:
                z = self._get_floor_level_index(floor.storey, ifc_model.storeys)
                coords_list = [(x, y, float(z)) for (x, y, _) in floor.coordinates]
                coords = self._format_coords_for_csv(coords_list)
            else:
                coords = floor.coords_csv if hasattr(floor, 'coords_csv') and floor.coords_csv else ""
            
            # Ground Elements columns (new header):
            # Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
            floor_type = ""
            depth = ""
            thick = ""
            parent = ""
            csv_lines.append(
                f"{floor_name},{zone_name},BuildingElementGround,{area},{width},{height},{perimeter},{floor_type},{depth},{thick},{parent},{coords},{{}}"
            )
        
        # (Roofs already emitted in Exposed Elements)
        
        return "\n".join(csv_lines)

    def _create_wall_audit_record(self, element: IfcElement, raw_wall_handle, ifc_model: IfcModel) -> Dict[str, Any]:
        """Create audit record for wall processing"""
        # Determine sources
        sources = {
            "width": "property" if element.width else "none",
            "height": "property" if element.height else "bbox",
            "orientation": "axis" if element.orientation else "none",
            "host": "none"  # Walls don't have hosts
        }
        
        # CSV fields that would be generated
        # element.width/height are now stored in meters after normalization
        csv_fields = {
            "width_m": round(element.width, 3) if element.width is not None else None,
            "height_m": round(element.height, 3) if element.height is not None else None,
            "area_m2": round(element.area, 3) if element.area is not None else None,
            "orientation360": round(element.orientation, 2) if element.orientation is not None else None,
            "coords_preview": self._format_coords_preview(element.coordinates),
            "parent_element": None
        }
        
        # Classification
        classification = {
            "wall_external": "unknown"  # We don't currently classify wall externality in CSV
        }
        
        # Storey info
        storey_info = {
            "name": element.storey or "unknown",
            "floor_index": self._get_floor_level_index(element.storey, ifc_model.storeys)
        }
        
        return {
            "element_id": element.global_id or f"wall_{element.id}",
            "ifc_type": "IfcWall",
            "ifc_name": element.name,
            "final_state": "kept",  # All walls are kept for now
            "reasons": ["ok"],
            "csv_fields": csv_fields,
            "sources": sources,
            "classification": classification,
            "storey": storey_info
        }
    
    def _create_door_audit_record(self, element: IfcElement, raw_door_handle, ifc_model: IfcModel, 
                                 final_state: str, reasons: List[str]) -> Dict[str, Any]:
        """Create audit record for door processing"""
        # Determine sources
        sources = {
            "width": "property" if element.width else "bbox",
            "height": "property" if element.height else "bbox", 
            "orientation": "axis" if element.orientation else "none",
            "host": "relation" if element.properties.get('linked_wall') else "proximity" if element.parent_element else "none",
            "parent_resolution_reason": element.properties.get('parent_resolution_reason')
        }
        
        # CSV fields that would be generated
        csv_fields = {
            # element.width/height are stored in meters; log directly to match CSV
            "width_m": round(element.width, 3) if element.width is not None else None,
            "height_m": round(element.height, 3) if element.height is not None else None,
            "area_m2": round(element.area, 3) if element.area is not None else None,
            "orientation360": round(element.orientation, 2) if element.orientation is not None else None,
            "coords_preview": self._format_coords_preview(element.coordinates),
            "parent_element": element.properties.get('linked_wall') or element.parent_element
        }
        
        # Classification
        stored_external = element.properties.get('is_external')
        if stored_external is True:
            door_external = "pset_true"
        elif stored_external is False:
            door_external = "pset_false"
        else:
            door_external = "unknown"
            
        classification = {
            "door_external": door_external
        }
        
        # Storey info
        storey_info = {
            "name": element.storey or "unknown",
            "floor_index": self._get_floor_level_index(element.storey, ifc_model.storeys)
        }
        
        return {
            "element_id": element.global_id or f"door_{element.id}",
            "ifc_type": "IfcDoor",
            "ifc_name": element.name,
            "final_state": final_state,
            "reasons": reasons,
            "csv_fields": csv_fields,
            "sources": sources,
            "classification": classification,
            "storey": storey_info
        }
    
    def _format_coords_preview(self, coords: Optional[List[Tuple[float, float, float]]]) -> Optional[str]:
        """Format coordinates preview for audit (first 2 points)"""
        if not coords or len(coords) < 2:
            return None
        try:
            return f"[[{coords[0][0]:.3f},{coords[0][1]:.3f},{coords[0][2]:.3f}],[{coords[1][0]:.3f},{coords[1][1]:.3f},{coords[1][2]:.3f}]]"
        except Exception:
            return None

    def close_model(self):
        """Close the model and free memory"""
        if self.model:
            self.model = None
            self.initialized = False
        if self.audit_collector:
            self.audit_collector.finalize()


def convert_ifc_to_csv_browser(ifc_content: str, pyodide_fs=None, progress_callback=None, audit_level: str = 'standard', delayering_enabled: bool = True, import_mode: str = None, wall_thickness_m: Optional[float] = None):
    """
    Convert IFC file to CSV format in browser/Pyodide environment
    
    Args:
        ifc_content: IFC file content as string
        pyodide_fs: Pyodide FS module (for virtual filesystem access)
        progress_callback: Optional callback function(status: str, current: int, total: int)
        audit_level: Audit logging level ('standard', 'verbose', or None)
        delayering_enabled: Whether to enable wall delayering
        import_mode: Import mode ('internal', 'external', 'raw', or None for default/raw)
        wall_thickness_m: Wall thickness in meters (required for 'external' mode, ignored otherwise)
    
    Returns:
        Tuple of (csv_content: str, audit_content: str)
    
    Example:
        csv, audit = convert_ifc_to_csv_browser(ifc_string, pyodide.FS, progress_cb, import_mode='internal')
        csv, audit = convert_ifc_to_csv_browser(ifc_string, pyodide.FS, progress_cb, import_mode='external', wall_thickness_m=0.2)
    """
    # Create parser with progress callback support
    parser = IfcParser(audit_level=audit_level, audit_path=None, progress_callback=progress_callback, delayering_enabled=delayering_enabled)
    
    # Load the content supplied by the browser worker.
    if parser.load_model_from_string(ifc_content, pyodide_fs):
        try:
            # Write audit metadata when enabled
            if parser.audit_collector:
                try:
                    # Phase 1: advisory auto-detect of standard IFC types (browser path)
                    try:
                        _walls = len(parser.model.by_type('IfcWall') or [])
                        _windows = len(parser.model.by_type('IfcWindow') or [])
                        _doors = len(parser.model.by_type('IfcDoor') or [])
                        _slabs = len(parser.model.by_type('IfcSlab') or [])
                        _spaces = len(parser.model.by_type('IfcSpace') or [])
                        has_std = (_walls + _windows + _doors + _slabs + _spaces) > 0
                        suggestion = 'raw' if has_std else 'proxy'
                        autodetect = {
                            "has_standard_ifc_types": has_std,
                            "counts": {
                                "IfcWall": _walls,
                                "IfcWindow": _windows,
                                "IfcDoor": _doors,
                                "IfcSlab": _slabs,
                                "IfcSpace": _spaces
                            },
                            "suggestion": suggestion
                        }
                    except Exception:
                        autodetect = {"has_standard_ifc_types": None, "suggestion": None}
                    # Phase 2: proxy classification preview (counts only) for browser path
                    try:
                        proxy_preview = parser._proxy_classification_preview()
                    except Exception:
                        proxy_preview = { 'total_proxies': 0 }
                    metadata = {
                        "schema": str(getattr(parser.model, 'schema', 'unknown')),
                        "units": {"length": parser.model.by_type('IfcUnitAssignment')[0].Units[0].Name if parser.model.by_type('IfcUnitAssignment') else "unknown"},
                        "storeys_count": len(parser.model.by_type('IfcBuildingStorey') or []),
                        "source": "browser_upload",
                        "delayering_enabled": parser.delayering_enabled,
                        "import_mode": import_mode,
                        "wall_thickness_m": wall_thickness_m,
                        "autodetect": autodetect,
                        "proxy_classification_preview": proxy_preview
                    }
                    parser.audit_collector.write_metadata(metadata)
                except Exception:
                    parser.audit_collector.write_metadata({
                        "schema": str(getattr(parser.model, 'schema', 'unknown')),
                        "source": "browser_upload",
                        "delayering_enabled": parser.delayering_enabled,
                        "import_mode": import_mode,
                        "wall_thickness_m": wall_thickness_m,
                        "autodetect": {"has_standard_ifc_types": None, "suggestion": None}
                    })
            
            # Extract elements based on import_mode
            if import_mode == 'internal':
                ifc_model = parser._extract_internal_negative_spaces_model()
            elif import_mode == 'external':
                # External mode requires wall thickness
                if wall_thickness_m is None or wall_thickness_m <= 0:
                    raise ValueError("wall_thickness_m is required for external mode and must be > 0")
                ifc_model = parser._extract_external_massing_model(wall_thickness_m=wall_thickness_m)
            else:
                # Raw mode (or None/default) - use legacy extract_elements()
                ifc_model = parser.extract_elements()
            
            # Generate CSV
            csv_content = parser.generate_csv(ifc_model)
            
            # Get audit content
            audit_content = ""
            if parser.audit_collector:
                parser.audit_collector.finalize()  # Flush any pending records
                audit_content = parser.audit_collector.get_content()
            
            return (csv_content, audit_content)
            
        finally:
            parser.close_model()
    else:
        raise RuntimeError("Failed to load IFC model")


def main():
    """Test the parser"""
    parser_args = argparse.ArgumentParser(description='Convert IFC files to Vulcan CSV format')
    parser_args.add_argument('ifc_file', help='Path to IFC file')
    parser_args.add_argument('--audit', nargs='?', const='', help='Generate audit file (default: <csv>.audit.jsonl)')
    parser_args.add_argument('--audit-level', choices=['standard', 'verbose'], default='standard', 
                           help='Audit detail level (default: standard)')
    parser_args.add_argument('--no-delayering', action='store_true', help='Disable wall delayering (keep all wall layers)')
    # Phase 0: accept new flags (no behavior changes yet; record in audit only)
    parser_args.add_argument('--import-mode', choices=['internal', 'external', 'raw'], help='Import pipeline mode (no-op for now; recorded in audit)')
    parser_args.add_argument('--proxy-classify', choices=['auto', 'on', 'off'], default='auto', help='Proxy classification policy (no-op for now; recorded in audit)')
    parser_args.add_argument('--wall-thickness-m', type=float, help='Wall thickness in meters (external mode; recorded in audit)')
    parser_args.add_argument('--snip-trim', choices=['on', 'off'], help='Enable snapping/trimming')
    parser_args.add_argument('--snap-tol-m', type=float, default=0.02, help='Snap/extension tolerance in meters (default: 0.02)')
    parser_args.add_argument('--host-tol-m', type=float, default=0.2, help='Host assignment tolerance for doors/windows in meters (default: 0.2)')
    parser_args.add_argument('--orientation-ab', choices=['on','off'], default='off', help='Run orientation A/B strategies and log scores (no CSV mutation)')
    parser_args.add_argument('--orient-ref', type=str, default='', help='Comma list of name=deg pairs for reference bearings (e.g. "Name1=270,Name2=0")')
    parser_args.add_argument('--self-test', choices=['on', 'off'], help='Enable CSV self-tests (no-op for now; recorded in audit)')
    parser_args.add_argument('--use-full2v-selection', choices=['on','off'], default='on',
                           help='If on, prefer strict Full-2V polygon matches with side majority for orientation (Internal mode)')
    
    args = parser_args.parse_args()
    
    ifc_file = args.ifc_file
    
    # Determine audit path
    audit_path = None
    if args.audit is not None:
        if args.audit == '':
            # Default audit path
            audit_path = ifc_file.replace('.ifc.txt', '.audit.jsonl').replace('.ifc', '.audit.jsonl')
        else:
            # Custom audit path
            audit_path = args.audit
    
    if audit_path:
        print(f"🧪 Audit enabled: {audit_path} (level: {args.audit_level})")
    
    parser = IfcParser(
        audit_level=args.audit_level if audit_path else None,
        audit_path=audit_path,
        delayering_enabled=(not args.no_delayering)
    )
    # Thread tolerances to parser instance
    parser.host_tol_m = getattr(args, 'host_tol_m', 0.2)
    parser.orientation_ab = getattr(args, 'orientation_ab', 'off')
    parser.orient_ref = getattr(args, 'orient_ref', '')
    parser.use_full2v_selection = (getattr(args, 'use_full2v_selection', 'off') == 'on')
    
    if parser.load_model(ifc_file):
        try:
            # Write audit metadata record when enabled
            if parser.audit_collector:
                try:
                    # Phase 1: advisory auto-detect of standard IFC types
                    try:
                        _walls = len(parser.model.by_type('IfcWall') or [])
                        _windows = len(parser.model.by_type('IfcWindow') or [])
                        _doors = len(parser.model.by_type('IfcDoor') or [])
                        _slabs = len(parser.model.by_type('IfcSlab') or [])
                        _spaces = len(parser.model.by_type('IfcSpace') or [])
                        has_std = (_walls + _windows + _doors + _slabs + _spaces) > 0
                        suggestion = 'raw' if has_std else 'proxy'
                        autodetect = {
                            "has_standard_ifc_types": has_std,
                            "counts": {
                                "IfcWall": _walls,
                                "IfcWindow": _windows,
                                "IfcDoor": _doors,
                                "IfcSlab": _slabs,
                                "IfcSpace": _spaces
                            },
                            "suggestion": suggestion
                        }
                    except Exception:
                        autodetect = {"has_standard_ifc_types": None, "suggestion": None}
                    # Phase 2: proxy classification preview (counts only)
                    try:
                        proxy_preview = parser._proxy_classification_preview()
                    except Exception:
                        proxy_preview = { 'total_proxies': 0 }
                    meta = {
                        "schema": str(getattr(parser.model, 'schema', 'unknown')),
                        "units": {"length": parser.model.by_type('IfcUnitAssignment')[0].Units[0].Name if parser.model.by_type('IfcUnitAssignment') else "unknown"},
                        "storeys_count": len(parser.model.by_type('IfcBuildingStorey') or []),
                        "file": ifc_file,
                        "delayering_enabled": parser.delayering_enabled,
                        "autodetect": autodetect,
                        "proxy_classification_preview": proxy_preview,
                        # Phase 0: echo flags into audit meta (advisory only)
                        "import_mode": getattr(args, 'import_mode', None),
                        "proxy_classify": getattr(args, 'proxy_classify', None),
                        "wall_thickness_m": getattr(args, 'wall_thickness_m', None),
                        "snip_trim": getattr(args, 'snip_trim', None),
                        "self_test": getattr(args, 'self_test', None),
                        "host_tol_m": getattr(args, 'host_tol_m', None)
                    }
                    parser.audit_collector.write_metadata(meta)
                except Exception:
                    parser.audit_collector.write_metadata({
                        "schema": str(getattr(parser.model, 'schema', 'unknown')),
                        "file": ifc_file,
                        "delayering_enabled": parser.delayering_enabled,
                        "autodetect": {"has_standard_ifc_types": None, "suggestion": None},
                        "import_mode": getattr(args, 'import_mode', None),
                        "proxy_classify": getattr(args, 'proxy_classify', None),
                        "wall_thickness_m": getattr(args, 'wall_thickness_m', None),
                        "snip_trim": getattr(args, 'snip_trim', None),
                        "self_test": getattr(args, 'self_test', None)
                    })
            # Extract elements (respect import_mode)
            if getattr(args, 'import_mode', None) == 'internal':
                ifc_model = parser._extract_internal_negative_spaces_model()
                # Diagnostic validation only (no mutation): report "snaps possible" for Internal mode
                # Since Internal mode uses exact surfaces, vertices should align perfectly
                if len(ifc_model.walls) > 0:
                    validation = parser._validate_wall_graph(ifc_model, tol=getattr(args, 'snap_tol_m', 0.02))
                    try:
                        parser.audit_collector.records.append({
                            "type": "Validation",
                            "import_mode": "internal",
                            "final_state": "diagnostic_only",
                            "reasons": ["exact_surfaces_no_trims"],
                            "validation": validation,
                            "note": "Diagnostic validation only - no walls modified. Internal mode uses exact face surfaces."
                        })
                        parser.audit_collector._flush_batch()
                    except Exception:
                        pass
            elif getattr(args, 'import_mode', None) == 'external':
                # External mode: requires wall thickness
                wall_thickness = getattr(args, 'wall_thickness_m', None)
                if wall_thickness is None or wall_thickness <= 0:
                    print("❌ Error: --wall-thickness-m is required for external mode")
                    sys.exit(1)
                
                ifc_model = parser._extract_external_massing_model(wall_thickness_m=wall_thickness)
                
                # Snip/trim removed - using canvas trim function instead
                # This preserves the offset calculation without modifying coordinates
            else:
                ifc_model = parser.extract_elements()
                # Outward orientation pass (per-floor footprint bbox)
                try:
                    parser._reorient_walls_outward(ifc_model)
                except Exception:
                    pass
                # Raw mode proxy fallback: if no walls and proxy classification is enabled
                if (getattr(args, 'import_mode', None) in (None, 'raw')):
                    policy = getattr(args, 'proxy_classify', 'auto')
                    enable_proxy = (policy == 'on') or (policy == 'auto' and len(parser.model.by_type('IfcWall') or []) == 0)
                    if enable_proxy and len(ifc_model.walls) == 0:
                        proxy_model = parser._extract_internal_negative_spaces_model()
                        ifc_model.walls.extend(proxy_model.walls)
                    # Optional snip/trim for raw mode
                    if getattr(args, 'snip_trim', None) == 'on' and len(ifc_model.walls) > 0:
                        stats = parser._snip_trim_walls(ifc_model, snap_tol_m=getattr(args, 'snap_tol_m', 0.02))
                        validation = parser._validate_wall_graph(ifc_model, tol=getattr(args, 'snap_tol_m', 0.02))
                        try:
                            # Append a standard audit record so it appears in JSONL after _meta
                            parser.audit_collector.records.append({
                                "type": "Validation",
                                "final_state": "kept",
                                "reasons": ["snip_trim"],
                                "stats": stats,
                                "validation": validation
                            })
                            parser.audit_collector._flush_batch()
                        except Exception:
                            pass
            
            print(f"\n📋 Extracted elements:")
            print(f"   Walls: {len(ifc_model.walls)}")
            print(f"   Windows: {len(ifc_model.windows)}")
            print(f"   Doors: {len(ifc_model.doors)}")
            print(f"   Floors: {len(ifc_model.floors)}")
            print(f"   Roofs: {len(ifc_model.roofs)}")
            print(f"   Spaces: {len(ifc_model.spaces)}")
            
            # Generate CSV
            print("\n🔧 Generating CSV...")
            csv_content = parser.generate_csv(ifc_model)
            
            # Save CSV file
            csv_filename = ifc_file.replace('.ifc.txt', '.csv').replace('.ifc', '.csv')
            with open(csv_filename, 'w') as f:
                f.write(csv_content)
            
            print(f"✅ CSV generated: {csv_filename}")
            print(f"📊 CSV size: {len(csv_content)} characters")
            
            # Show preview
            print("\n📋 CSV Preview:")
            lines = csv_content.split('\n')
            for i, line in enumerate(lines[:15]):
                print(f"  {i+1:2d}: {line}")
            if len(lines) > 15:
                print(f"  ... ({len(lines) - 15} more lines)")
                
        finally:
            parser.close_model()
    else:
        sys.exit(1)


if __name__ == "__main__" and sys.platform != "emscripten":
    # Pyodide's runPython() executes source with __name__ set to "__main__".
    # Keep the native CLI available without parsing browser-worker arguments.
    try:
        main()
    except SystemExit:
        # main() calls sys.exit() which raises SystemExit
        # If we catch this, the script was likely imported as a module
        # (e.g., in Pyodide browser environment)
        pass
