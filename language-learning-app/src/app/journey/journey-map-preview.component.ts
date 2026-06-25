import {
  Component,
  Input,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnChanges,
  SimpleChanges,
  AfterViewInit,
  OnDestroy,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import {
  journeyBackgroundSrcSet,
  journeyBackgroundUrl,
  journeyBackgroundUrlHiRes
} from './journey-map-assets';
import {
  buildJourneySvgPathD,
  depthToOpacity,
  depthToScale,
  resolveJourneyPathPts,
  resolveJourneyPlatformPts,
  sampleJourneyPathFromPts,
  waypointDepth
} from './journey-map-path.util';
import {
  JOURNEY_MAP_PREVIEW_ILLUSTRATION_DARK,
  JOURNEY_MAP_PREVIEW_ILLUSTRATION_LIGHT,
  JourneyMapPreviewIllustrationKind,
} from './journey-map-preview-assets';

export type JourneyMapPreviewIllustration = JourneyMapPreviewIllustrationKind;

const ILLUSTRATION_ART = JOURNEY_MAP_PREVIEW_ILLUSTRATION_LIGHT;
const ILLUSTRATION_ART_DARK = JOURNEY_MAP_PREVIEW_ILLUSTRATION_DARK;

export interface JourneyMapPreviewPhase {
  title: string;
  status: 'completed' | 'active' | 'locked';
  isRecovery?: boolean;
  isSplit?: boolean;
}

interface PreviewMapNode {
  index: number;
  xPct: number;
  yPct: number;
  depthScale: number;
  depthOpacity: number;
  depthZIndex: number;
  status: JourneyMapPreviewPhase['status'];
  isRecovery: boolean;
  isSplit: boolean;
}

@Component({
  selector: 'app-journey-map-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule],
  templateUrl: './journey-map-preview.component.html',
  styleUrls: ['./journey-map-preview.component.scss']
})
export class JourneyMapPreviewComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() chapterTheme = 'a1-desert';
  @Input() chapterLevel = 'A1';
  @Input() phases: JourneyMapPreviewPhase[] = [];
  @Input() currentPhaseIndex = 0;
  @Input() caption = '';
  @Input() planStateLabel = '';
  @Input() illustration: JourneyMapPreviewIllustration | null = null;
  /** `large` — taller preview; `sidebar` — fills parent column in lessons/:id. */
  @Input() size: 'default' | 'large' | 'sidebar' = 'default';

  backgroundUrl = '';
  backgroundSrcSet = '';
  backgroundSrcHiRes = '';
  backgroundDisplaySrc = '';
  backgroundDisplaySrcSet = '';
  backgroundSizes = '480px';
  backgroundFailed = false;
  backgroundLoaded = false;
  illustrationLoaded = false;
  mapPathD = '';
  mapNodes: PreviewMapNode[] = [];

  private stageResizeObserver: ResizeObserver | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private el: ElementRef<HTMLElement>
  ) {}

  get showIllustration(): boolean {
    return this.illustration === 'paused' || this.illustration === 'empty';
  }

  get illustrationArtUrl(): string {
    return this.illustration ? ILLUSTRATION_ART[this.illustration] : '';
  }

  get illustrationArtUrlDark(): string {
    if (!this.illustration) return '';
    return ILLUSTRATION_ART_DARK[this.illustration] || ILLUSTRATION_ART[this.illustration];
  }

  get illustrationHasDarkArt(): boolean {
    return !!this.illustration && !!ILLUSTRATION_ART_DARK[this.illustration];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['illustration']) {
      this.illustrationLoaded = false;
    }
    if (
      changes['chapterTheme'] ||
      changes['chapterLevel'] ||
      changes['phases'] ||
      changes['currentPhaseIndex'] ||
      changes['size']
    ) {
      this.recomputeMap();
    }
  }

  ngAfterViewInit(): void {
    this.observeStageSize();
    this.syncBackgroundFromDom();
    this.syncIllustrationFromDom();
  }

  ngOnDestroy(): void {
    this.stageResizeObserver?.disconnect();
  }

  onBackgroundLoad(): void {
    this.backgroundLoaded = true;
    this.cdr.markForCheck();
  }

  onBackgroundError(): void {
    this.backgroundFailed = true;
    this.backgroundLoaded = true;
    this.cdr.markForCheck();
  }

  onIllustrationLoad(): void {
    this.illustrationLoaded = true;
    this.cdr.markForCheck();
  }

  trackByMapNode(_index: number, node: PreviewMapNode): number {
    return node.index;
  }

  private recomputeMap(): void {
    const phases = this.phases || [];
    const n = phases.length;
    if (n === 0) {
      this.mapNodes = [];
      this.mapPathD = '';
      this.backgroundUrl = '';
      this.backgroundSrcSet = '';
      this.backgroundSrcHiRes = '';
      this.backgroundDisplaySrc = '';
      this.backgroundDisplaySrcSet = '';
      this.backgroundLoaded = false;
      this.backgroundFailed = false;
      this.cdr.markForCheck();
      return;
    }

    this.backgroundLoaded = false;
    this.backgroundFailed = false;

    this.backgroundUrl = journeyBackgroundUrl(this.chapterTheme, n);
    this.backgroundSrcSet = journeyBackgroundSrcSet(this.chapterTheme, n);
    this.backgroundSrcHiRes = journeyBackgroundUrlHiRes(this.backgroundUrl);
    this.applyBackgroundDisplaySources();

    const pathPts = resolveJourneyPathPts(this.chapterTheme, n);
    const nodePts = resolveJourneyPlatformPts(this.chapterTheme, n);
    this.mapPathD = buildJourneySvgPathD(pathPts);

    this.mapNodes = phases.map((phase, i) => {
      const layoutPt = n === nodePts.length ? nodePts[i] : null;
      const pt = layoutPt
        ? {
            x: layoutPt.x,
            y: layoutPt.y,
            z: typeof layoutPt.z === 'number' ? layoutPt.z : waypointDepth(layoutPt, pathPts)
          }
        : (() => {
            const sampled = sampleJourneyPathFromPts(pathPts, n > 1 ? i / (n - 1) : 0.5);
            return { x: sampled.x, y: sampled.y, z: sampled.z ?? 0.8 };
          })();
      const depthZIndex =
        phase.status === 'active' ? 24 : 2 + Math.round((pt.z ?? 0.8) * 20);
      return {
        index: i,
        xPct: pt.x,
        yPct: pt.y,
        depthScale: depthToScale(pt.z ?? 0.8),
        depthOpacity: depthToOpacity(pt.z ?? 0.8),
        depthZIndex,
        status: phase.status,
        isRecovery: !!phase.isRecovery,
        isSplit: !!phase.isSplit
      };
    });

    this.cdr.markForCheck();
    queueMicrotask(() => this.syncBackgroundFromDom());
  }

  /** Sidebar previews are small — use 1x + srcset instead of forcing @4x src. */
  private applyBackgroundDisplaySources(): void {
    if (this.size === 'sidebar' || this.size === 'default') {
      this.backgroundDisplaySrc = this.backgroundUrl;
      this.backgroundDisplaySrcSet = this.backgroundSrcSet;
      return;
    }
    this.backgroundDisplaySrc = this.backgroundSrcHiRes;
    this.backgroundDisplaySrcSet = this.backgroundSrcSet;
  }

  private syncBackgroundFromDom(): void {
    const img = this.el.nativeElement.querySelector('.jmp-bg--sharp') as HTMLImageElement | null;
    if (!img?.complete || img.naturalWidth <= 0) return;
    this.backgroundLoaded = true;
    this.cdr.markForCheck();
  }

  private syncIllustrationFromDom(): void {
    const img = this.el.nativeElement.querySelector('.jmp-illustration-art--theme-light') as HTMLImageElement | null;
    if (!img?.complete || img.naturalWidth <= 0) return;
    this.illustrationLoaded = true;
    this.cdr.markForCheck();
  }

  private observeStageSize(): void {
    const stage = this.el.nativeElement.querySelector('.jmp-stage') as HTMLElement | null;
    if (!stage || typeof ResizeObserver === 'undefined') return;

    const update = (width: number) => {
      if (width <= 0) return;
      const next = `${Math.ceil(width)}px`;
      if (this.backgroundSizes !== next) {
        this.backgroundSizes = next;
        this.cdr.markForCheck();
      }
    };

    update(stage.getBoundingClientRect().width);

    this.stageResizeObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) update(w);
    });
    this.stageResizeObserver.observe(stage);
  }
}
