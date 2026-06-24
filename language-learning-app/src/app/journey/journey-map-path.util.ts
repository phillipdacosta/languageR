import { resolvePathLayout, resolvePlatformLayout } from './journey-map-assets';

export interface MapPathWaypoint {
  x: number;
  y: number;
  z?: number;
  labelAlign?: 'start' | 'center' | 'end';
  labelOffsetX?: number;
}

export function resolveJourneyPlatformPts(theme: string, phaseCount: number): MapPathWaypoint[] {
  const platforms = resolvePlatformLayout(theme, phaseCount);
  const count = Math.max(1, phaseCount);
  if (count <= platforms.length) {
    return platforms.slice(0, count);
  }
  return Array.from({ length: count }, (_, i) =>
    sampleJourneyPathFromPts(platforms, count > 1 ? i / (count - 1) : 0.5)
  );
}

/** Trail waypoints — includes path kinks (roadblocks) between platforms. */
export function resolveJourneyPathPts(theme: string, phaseCount: number): MapPathWaypoint[] {
  return resolvePathLayout(theme, phaseCount);
}

export function sampleJourneyPathFromPts(
  pts: MapPathWaypoint[],
  t: number
): MapPathWaypoint {
  if (t <= 0) {
    return { x: pts[0].x, y: pts[0].y, z: waypointDepth(pts[0], pts) };
  }
  if (t >= 1) {
    const last = pts[pts.length - 1];
    return { x: last.x, y: last.y, z: waypointDepth(last, pts) };
  }
  const raw = (pts.length - 1) * t;
  const i = Math.floor(raw);
  const f = raw - i;
  const z0 = waypointDepth(pts[i], pts);
  const z1 = waypointDepth(pts[i + 1], pts);
  return {
    x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
    y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
    z: z0 + (z1 - z0) * f
  };
}

export function waypointDepth(pt: MapPathWaypoint, pts: MapPathWaypoint[]): number {
  if (typeof pt.z === 'number') return pt.z;
  const ys = pts.map(p => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (maxY === minY) return 0.85;
  return 0.55 + ((pt.y - minY) / (maxY - minY)) * 0.4;
}

export function depthToScale(z: number): number {
  const clamped = Math.max(0, Math.min(1, z));
  return 0.62 + clamped * 0.38;
}

export function depthToOpacity(z: number): number {
  const clamped = Math.max(0, Math.min(1, z));
  return 0.76 + clamped * 0.24;
}

export function buildJourneySvgPathD(pathPts: MapPathWaypoint[]): string {
  if (pathPts.length < 2) return '';
  const tension = 0.5;
  let d = `M ${pathPts[0].x} ${pathPts[0].y}`;
  for (let i = 0; i < pathPts.length - 1; i++) {
    const p0 = pathPts[i - 1] || pathPts[i];
    const p1 = pathPts[i];
    const p2 = pathPts[i + 1];
    const p3 = pathPts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * (tension / 3);
    const c1y = p1.y + (p2.y - p0.y) * (tension / 3);
    const c2x = p2.x - (p3.x - p1.x) * (tension / 3);
    const c2y = p2.y - (p3.y - p1.y) * (tension / 3);
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x} ${p2.y}`;
  }
  return d;
}
