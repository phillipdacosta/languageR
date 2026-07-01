import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';

type VideoLayer = 'a' | 'b';

/**
 * Double-buffered map background: incoming clip fades in over the outgoing one
 * (outgoing stays full opacity) so the loop never dips through black.
 */
@Component({
  selector: 'app-journey-map-video-loop',
  standalone: true,
  template: `
    <video
      #videoA
      class="jmvl-video"
      [src]="src"
      [attr.poster]="showPoster ? poster : null"
      muted
      playsinline
      disablePictureInPicture
      preload="auto"
      aria-hidden="true"
      (loadedmetadata)="onLoaded('a')"
      (error)="onVideoError()"></video>
    <video
      #videoB
      class="jmvl-video"
      [src]="src"
      muted
      playsinline
      disablePictureInPicture
      preload="auto"
      aria-hidden="true"
      (loadedmetadata)="onLoaded('b')"
      (error)="onVideoError()"></video>
  `,
  styles: [`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .jmvl-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
      object-position: center;
      opacity: 0;
      z-index: 1;
      pointer-events: none;
      user-select: none;
      -webkit-user-drag: none;
      will-change: opacity;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JourneyMapVideoLoopComponent implements OnChanges, OnInit, OnDestroy {
  @Input() src = '';
  @Input() poster = '';
  /** When false, decode/loop pauses (e.g. journey map off-screen). */
  @Input() playing = true;
  @Output() videoError = new EventEmitter<void>();

  @ViewChild('videoA') private videoARef?: ElementRef<HTMLVideoElement>;
  @ViewChild('videoB') private videoBRef?: ElementRef<HTMLVideoElement>;

  showPoster = true;
  private activeLayer: VideoLayer = 'a';
  private loopArmed = false;
  private crossfadeMs = 600;
  private monitorRafId = 0;
  private crossfadeRafId = 0;
  private started = false;
  private documentVisible = true;
  private visibilityHandler = () => this.onDocumentVisibilityChange();

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    if (typeof document !== 'undefined') {
      this.documentVisible = !document.hidden;
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src'] && !changes['src'].firstChange) {
      this.resetLoopState();
      return;
    }
    if (changes['playing']) {
      this.syncPlaybackState();
    }
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.cancelMonitors();
  }

  private onDocumentVisibilityChange(): void {
    this.documentVisible = typeof document === 'undefined' ? true : !document.hidden;
    this.syncPlaybackState();
    this.cdr.markForCheck();
  }

  private shouldRun(): boolean {
    return this.playing && this.documentVisible;
  }

  private syncPlaybackState(): void {
    if (this.shouldRun()) {
      void this.resumePlayback();
    } else {
      this.pausePlayback();
    }
  }

  private pausePlayback(): void {
    this.cancelMonitors();
    this.loopArmed = false;
    this.videoARef?.nativeElement?.pause();
    this.videoBRef?.nativeElement?.pause();
  }

  private async resumePlayback(): Promise<void> {
    if (!this.shouldRun()) return;

    const active = this.videoEl(this.activeLayer);
    if (!active) return;

    if (!this.started) {
      this.syncOpacity(active, 1);
      this.syncStackOrder(this.activeLayer);
      await this.startActive(active);
      return;
    }

    const ok = await this.safePlay(active);
    if (!ok) return;

    this.showPoster = false;
    this.startMonitorLoop();
    this.cdr.markForCheck();
  }

  onLoaded(layer: VideoLayer): void {
    const video = this.videoEl(layer);
    if (!video) return;

    if (Number.isFinite(video.duration) && video.duration > 0) {
      this.crossfadeMs = this.crossfadeLeadMs(video.duration);
    }

    if (layer === this.activeLayer && !this.started) {
      this.syncOpacity(video, 1);
      this.syncStackOrder(layer);
      if (this.shouldRun()) {
        void this.startActive(video);
      }
    } else if (layer !== this.activeLayer) {
      this.syncOpacity(video, 0);
      video.pause();
      video.currentTime = 0;
    }
  }

  onVideoError(): void {
    this.videoError.emit();
  }

  private async startActive(video: HTMLVideoElement): Promise<void> {
    if (!this.shouldRun()) return;
    this.started = true;
    const ok = await this.safePlay(video);
    if (!ok) return;

    await this.waitFirstFrame(video);
    this.showPoster = false;
    this.cdr.markForCheck();
    this.startMonitorLoop();
  }

  private startMonitorLoop(): void {
    cancelAnimationFrame(this.monitorRafId);

    const tick = (): void => {
      this.monitorRafId = requestAnimationFrame(tick);

      if (this.loopArmed || !this.shouldRun()) return;

      const video = this.videoEl(this.activeLayer);
      if (!video || video.paused || video.ended) return;

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const leadSec = this.crossfadeLeadMs(duration) / 1000;
      if (video.currentTime >= duration - leadSec) {
        void this.beginCrossfade(this.activeLayer);
      }
    };

    this.monitorRafId = requestAnimationFrame(tick);
  }

  private async beginCrossfade(fromLayer: VideoLayer): Promise<void> {
    if (this.loopArmed || !this.shouldRun()) return;

    const from = this.videoEl(fromLayer);
    const toLayer: VideoLayer = fromLayer === 'a' ? 'b' : 'a';
    const to = this.videoEl(toLayer);
    if (!from || !to) return;

    this.loopArmed = true;

    to.pause();
    to.currentTime = 0;
    await this.waitSeek(to);
    this.syncOpacity(to, 0);

    const played = await this.safePlay(to);
    if (!played) {
      this.loopArmed = false;
      return;
    }

    await this.waitFirstFrame(to);
    this.syncStackOrder(toLayer);
    this.syncOpacity(from, 1);
    this.syncOpacity(to, 0);

    const fadeMs = this.crossfadeMs;
    const start = performance.now();

    const animate = (now: number): void => {
      const t = Math.min(1, (now - start) / fadeMs);
      const eased = t * t * (3 - 2 * t);
      // Outgoing stays fully visible; incoming fades in on top — no black dip.
      this.syncOpacity(from, 1);
      this.syncOpacity(to, eased);

      if (t < 1) {
        this.crossfadeRafId = requestAnimationFrame(animate);
        return;
      }

      from.pause();
      from.currentTime = 0;
      this.syncOpacity(from, 0);
      this.syncOpacity(to, 1);
      this.syncStackOrder(toLayer);
      this.activeLayer = toLayer;
      this.loopArmed = false;
    };

    cancelAnimationFrame(this.crossfadeRafId);
    this.crossfadeRafId = requestAnimationFrame(animate);
  }

  private resetLoopState(): void {
    this.cancelMonitors();
    this.activeLayer = 'a';
    this.loopArmed = false;
    this.started = false;
    this.showPoster = true;

    const a = this.videoARef?.nativeElement;
    const b = this.videoBRef?.nativeElement;

    if (a) {
      a.pause();
      a.currentTime = 0;
      this.syncOpacity(a, 1);
      this.syncStackOrder('a');
    }
    if (b) {
      b.pause();
      b.currentTime = 0;
      this.syncOpacity(b, 0);
    }

    if (a) {
      void this.startActive(a);
    } else if (!this.shouldRun()) {
      this.pausePlayback();
    }
    this.cdr.markForCheck();
  }

  private cancelMonitors(): void {
    cancelAnimationFrame(this.monitorRafId);
    cancelAnimationFrame(this.crossfadeRafId);
    this.monitorRafId = 0;
    this.crossfadeRafId = 0;
  }

  private videoEl(layer: VideoLayer): HTMLVideoElement | null {
    return layer === 'a'
      ? this.videoARef?.nativeElement ?? null
      : this.videoBRef?.nativeElement ?? null;
  }

  private syncOpacity(el: HTMLVideoElement, opacity: number): void {
    el.style.opacity = String(opacity);
  }

  private syncStackOrder(topLayer: VideoLayer): void {
    const a = this.videoARef?.nativeElement;
    const b = this.videoBRef?.nativeElement;
    if (!a || !b) return;
    a.style.zIndex = topLayer === 'a' ? '2' : '1';
    b.style.zIndex = topLayer === 'b' ? '2' : '1';
  }

  private waitSeek(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= 2 && video.currentTime < 0.05) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    });
  }

  private waitFirstFrame(video: HTMLVideoElement): Promise<void> {
    const rvfc = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }).requestVideoFrameCallback;

    if (typeof rvfc === 'function') {
      return new Promise(resolve => {
        rvfc.call(video, () => resolve());
      });
    }

    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  /** Longer overlap hides loop seams; cap so short clips still behave. */
  private crossfadeLeadMs(durationSec: number): number {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return 600;
    return Math.min(700, Math.max(400, durationSec * 1000 * 0.14));
  }

  private safePlay(video: HTMLVideoElement): Promise<boolean> {
    return video.play().then(() => true).catch(() => false);
  }
}
