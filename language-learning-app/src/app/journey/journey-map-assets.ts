import layoutsJson from '../../assets/journey-backgrounds/map-layouts.json';

export interface MapLayoutWaypoint {
  x: number;
  y: number;
  z?: number;
  labelAlign?: 'start' | 'center' | 'end';
  labelOffsetX?: number;
}

export const JOURNEY_MAP_LAYOUTS = layoutsJson as Record<string, MapLayoutWaypoint[]>;

export type MapPhaseVariant = 3 | 4 | 5;

const DEFAULT_PLATFORM_PTS: MapLayoutWaypoint[] = [
  { x: 21.0, y: 88.0, z: 1.00 },
  { x: 37.0, y: 76.0, z: 0.88 },
  { x: 53.0, y: 68.0, z: 0.76 },
  { x: 69.0, y: 60.0, z: 0.64 },
  { x: 82.0, y: 48.0, z: 0.52 }
];

/** Map plan phase count to artwork variant (3 / 4 / 5 empty platforms). */
export function resolveMapVariant(phaseCount: number): MapPhaseVariant {
  const n = Math.max(1, phaseCount || 4);
  if (n <= 3) return 3;
  if (n >= 5) return 5;
  return 4;
}

export function mapLayoutKey(theme: string, phaseCount: number): string {
  return `${theme}-${resolveMapVariant(phaseCount)}`;
}

export function journeyBackgroundFilename(theme: string, phaseCount: number): string {
  return `${mapLayoutKey(theme, phaseCount)}.png`;
}

export function journeyBackgroundUrl(theme: string, phaseCount: number): string {
  return `assets/journey-backgrounds/${journeyBackgroundFilename(theme, phaseCount)}`;
}

/** Keys with a real `@2x` downscale asset. Add more as upscaled variants are created. */
const RETINA_BACKGROUND_KEYS = new Set<string>(['a1-desert-3', 'a1-desert-4', 'a1-desert-5']);

export function journeyBackgroundSrcSet(theme: string, phaseCount: number): string {
  const key = mapLayoutKey(theme, phaseCount);
  if (!RETINA_BACKGROUND_KEYS.has(key)) return '';
  const base = `assets/journey-backgrounds/${key}`;
  return `${base}.png 1024w, ${base}@2x.png 2048w, ${base}@4x.png 1672w`;
}

export function journeyBackgroundSrcSetFromUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/([^/]+)\.png$/);
  if (!m || !RETINA_BACKGROUND_KEYS.has(m[1])) return '';
  const base = url.replace(/\.png$/, '');
  return `${url} 1024w, ${base}@2x.png 2048w, ${base}@4x.png 1672w`;
}

/** Highest-res asset URL — used as img src so the browser always downscales (sharp). */
export function journeyBackgroundUrlHiRes(url: string): string {
  const m = url.match(/([^/]+)\.png$/);
  if (!m || !RETINA_BACKGROUND_KEYS.has(m[1])) return url;
  return url.replace(/\.png$/, '@4x.png');
}

/** All bitmap URLs worth warming for a map preview (matches displayed src/srcset). */
export function journeyBackgroundPreloadUrls(theme: string, phaseCount: number): string[] {
  const base = journeyBackgroundUrl(theme, phaseCount);
  const urls = new Set<string>([base, journeyBackgroundUrlHiRes(base)]);
  const srcset = journeyBackgroundSrcSet(theme, phaseCount);
  if (srcset) {
    for (const entry of srcset.split(',')) {
      const url = entry.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

// ── Map hotspots (roadblocks + treasure chests) ──────────────────────
// Baked into the background art, so we overlay invisible tappable hotspots
// at the same screen positions (percentages of the 16:9 stage). Coordinates
// are hand-tuned per map key, same workflow as platform waypoints.

export interface RoadblockHotspot {
  /** Center on the stage, 0–100 %. */
  x: number;
  y: number;
  /** Index of the phase that must be completed before this gate is live. */
  afterPhase: number;
}

export interface ChestHotspot {
  x: number;
  y: number;
  /** The chest unlocks when this phase is completed; tier scales with its mastery. */
  phaseIndex: number;
  /** Which painted chest on the map (matches sprite set). */
  side: 'left' | 'right';
  /** Chest is painted into the background — use invisible tap target only. */
  bakedIn?: boolean;
}

export interface MapHotspots {
  roadblocks: RoadblockHotspot[];
  chests: ChestHotspot[];
}

const JOURNEY_MAP_HOTSPOTS: Record<string, MapHotspots> = {
  'a1-desert-3': {
    roadblocks: [
      { x: 41.7, y: 71.5, afterPhase: 0 }
    ],
    chests: []
  },
  'a1-desert-4': {
    roadblocks: [
      { x: 46.8, y: 74.5, afterPhase: 0 }
    ],
    chests: []
  },
  'a1-desert-5': {
    roadblocks: [
      { x: 44, y: 80, afterPhase: 0 },
      { x: 52, y: 55, afterPhase: 2 },
      { x: 60, y: 35, afterPhase: 3 }
    ],
    chests: [
      { x: 10, y: 72, phaseIndex: 0, side: 'left', bakedIn: true },
      { x: 89, y: 69, phaseIndex: 2, side: 'right', bakedIn: true }
    ]
  }
};

/** Stable per-map chest id so a chest can only be claimed once, ever. */
export function chestId(theme: string, phaseCount: number, chestIndex: number): string {
  return `${mapLayoutKey(theme, phaseCount)}-chest-${chestIndex}`;
}

/** Hotspots (roadblocks + chests) for the theme + phase-count variant, or null. */
export function resolveJourneyHotspots(theme: string, phaseCount: number): MapHotspots | null {
  return JOURNEY_MAP_HOTSPOTS[mapLayoutKey(theme, phaseCount)] || null;
}

/** Per-side chest sprites (closed + open). */
export const JOURNEY_CHEST_SPRITES = {
  left: {
    closed: 'assets/journey/sprites/chest1-left-closed.png',
    open: 'assets/journey/sprites/chest1-left-open.png'
  },
  right: {
    closed: 'assets/journey/sprites/chest1-right-closed.png',
    open: 'assets/journey/sprites/chest1-right-open.png'
  }
} as const;

export type JourneyChestSide = keyof typeof JOURNEY_CHEST_SPRITES;

/** Closed → open frame URLs for a map chest side. */
export function resolveChestFrameUrls(side: JourneyChestSide): readonly [string, string] {
  const s = JOURNEY_CHEST_SPRITES[side];
  return [s.closed, s.open];
}

/** All chest sprite URLs (for preload). */
export const ALL_JOURNEY_CHEST_FRAME_URLS: readonly string[] = [
  JOURNEY_CHEST_SPRITES.left.closed,
  JOURNEY_CHEST_SPRITES.left.open,
  JOURNEY_CHEST_SPRITES.right.closed,
  JOURNEY_CHEST_SPRITES.right.open
];

/** Detected platform centres for the theme + phase-count variant. */
export function resolvePlatformLayout(theme: string, phaseCount: number): MapLayoutWaypoint[] {
  const key = mapLayoutKey(theme, phaseCount);
  const layout = JOURNEY_MAP_LAYOUTS[key];
  if (layout?.length) return layout;
  const fallback4 = JOURNEY_MAP_LAYOUTS[`${theme}-4`];
  if (fallback4?.length) return fallback4;
  const variant = resolveMapVariant(phaseCount);
  return DEFAULT_PLATFORM_PTS.slice(0, variant);
}

// ── Path kinks (trail-only bends through roadblocks etc.) ─────────────
// Inserted between platform waypoints so the dotted line follows the
// painted path without moving phase nodes off their pedestals.

export interface PathKink {
  /** Insert after this platform index (0-based). */
  afterPlatform: number;
  x: number;
  y: number;
  z?: number;
}

const JOURNEY_MAP_PATH_KINKS: Record<string, PathKink[]> = {
  'a1-desert-3': [
    { afterPlatform: 0, x: 41.7, y: 71.5 }
  ],
  'a1-desert-4': [
    { afterPlatform: 0, x: 46.8, y: 74.5 }
  ],
  'a1-desert-5': [
    { afterPlatform: 0, x: 44, y: 80 }
  ]
};

function kinkDepth(kink: PathKink, before: MapLayoutWaypoint, after: MapLayoutWaypoint): number {
  if (typeof kink.z === 'number') return kink.z;
  const z0 = typeof before.z === 'number' ? before.z : 0.85;
  const z1 = typeof after.z === 'number' ? after.z : 0.75;
  const span = before.y - after.y;
  if (!span) return (z0 + z1) / 2;
  const t = Math.max(0, Math.min(1, (before.y - kink.y) / span));
  return z0 + (z1 - z0) * t;
}

/** Platform centres + per-map kinks — used only for the dust/dotted trail. */
export function resolvePathLayout(theme: string, phaseCount: number): MapLayoutWaypoint[] {
  const count = Math.max(1, phaseCount);
  const platforms = resolvePlatformLayout(theme, phaseCount).slice(0, count);
  const kinks = JOURNEY_MAP_PATH_KINKS[mapLayoutKey(theme, phaseCount)] || [];
  if (!kinks.length) return platforms;

  const out: MapLayoutWaypoint[] = [];
  for (let i = 0; i < platforms.length; i++) {
    out.push(platforms[i]);
    if (i >= platforms.length - 1) continue;
    for (const kink of kinks.filter(k => k.afterPlatform === i)) {
      out.push({
        x: kink.x,
        y: kink.y,
        z: kinkDepth(kink, platforms[i], platforms[i + 1])
      });
    }
  }
  return out;
}

/** Waypoints for the traveler dot: completed platform → kinks → roadblock. */
export function resolveRoadblockTravelWaypoints(
  theme: string,
  phaseCount: number,
  afterPhase: number
): { x: number; y: number }[] | null {
  const key = mapLayoutKey(theme, phaseCount);
  const rb = JOURNEY_MAP_HOTSPOTS[key]?.roadblocks.find(r => r.afterPhase === afterPhase);
  if (!rb) return null;
  const platforms = resolvePlatformLayout(theme, phaseCount);
  const from = platforms[afterPhase];
  if (!from) return null;
  const kinks = (JOURNEY_MAP_PATH_KINKS[key] || [])
    .filter(k => k.afterPlatform === afterPhase)
    .map(k => ({ x: k.x, y: k.y }));
  return [{ x: from.x, y: from.y }, ...kinks, { x: rb.x, y: rb.y }];
}

/** Index of a platform waypoint inside resolvePathLayout() output. */
export function pathLayoutIndexForPlatform(
  theme: string,
  phaseCount: number,
  platformIndex: number
): number {
  const kinks = JOURNEY_MAP_PATH_KINKS[mapLayoutKey(theme, phaseCount)] || [];
  let idx = 0;
  for (let i = 0; i < platformIndex; i++) {
    idx += 1 + kinks.filter(k => k.afterPlatform === i).length;
  }
  return idx;
}

/** Index of the path kink inserted after a platform (roadblock gate), if any. */
export function pathLayoutIndexForGateKink(
  theme: string,
  phaseCount: number,
  afterPhase: number
): number | null {
  const kinks = JOURNEY_MAP_PATH_KINKS[mapLayoutKey(theme, phaseCount)] || [];
  if (!kinks.some(k => k.afterPlatform === afterPhase)) return null;
  return pathLayoutIndexForPlatform(theme, phaseCount, afterPhase) + 1;
}

/** Path-layout indices for pre-quiz travel: platform → gate kink. */
export function resolveRoadblockTravelPathIndices(
  theme: string,
  phaseCount: number,
  afterPhase: number
): { fromIndex: number; toIndex: number } | null {
  const fromIndex = pathLayoutIndexForPlatform(theme, phaseCount, afterPhase);
  const toIndex = pathLayoutIndexForGateKink(theme, phaseCount, afterPhase);
  if (toIndex == null || toIndex <= fromIndex) return null;
  return { fromIndex, toIndex };
}

/** Path-layout indices for post-quiz travel: gate kink → next platform. */
export function resolvePostRoadblockPathIndices(
  theme: string,
  phaseCount: number,
  afterPhase: number
): { fromIndex: number; toIndex: number } | null {
  const kinkIdx = pathLayoutIndexForGateKink(theme, phaseCount, afterPhase);
  const fromIndex = kinkIdx ?? pathLayoutIndexForPlatform(theme, phaseCount, afterPhase);
  const toIndex = pathLayoutIndexForPlatform(theme, phaseCount, afterPhase + 1);
  if (toIndex <= fromIndex) return null;
  return { fromIndex, toIndex };
}

/** After clearing a gate: roadblock/kink → next platform (phase afterPhase + 2). */
export function resolvePostRoadblockTravelWaypoints(
  theme: string,
  phaseCount: number,
  afterPhase: number
): { x: number; y: number }[] | null {
  const key = mapLayoutKey(theme, phaseCount);
  const rb = JOURNEY_MAP_HOTSPOTS[key]?.roadblocks.find(r => r.afterPhase === afterPhase);
  if (!rb) return null;
  const platforms = resolvePlatformLayout(theme, phaseCount);
  const to = platforms[afterPhase + 1];
  if (!to) return null;
  const kink = (JOURNEY_MAP_PATH_KINKS[key] || []).find(k => k.afterPlatform === afterPhase);
  const from = kink ? { x: kink.x, y: kink.y } : { x: rb.x, y: rb.y };
  return [from, { x: to.x, y: to.y }];
}
