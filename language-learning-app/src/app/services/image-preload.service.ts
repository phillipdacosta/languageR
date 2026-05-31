import { Injectable } from '@angular/core';

/**
 * Warms the browser image cache so pictures paint instantly when they finally
 * render (e.g. behind an *ngIf, or after a route change). On web there's no
 * equivalent of React Native's pre-fetch, so without this the user watches
 * images fetch + decode in front of them the first time; subsequent visits are
 * fine because the file is HTTP-cached. This service reproduces the "fetch
 * ahead" behaviour: kick off the request (and decode) while the user is still
 * on the previous screen.
 */
@Injectable({ providedIn: 'root' })
export class ImagePreloadService {
  /** URLs we've already started loading — avoids duplicate network requests. */
  private readonly requested = new Set<string>();
  /** Keep references alive until decode settles so GC can't cancel the fetch. */
  private readonly inFlight = new Set<HTMLImageElement>();

  /** Preload a single image URL. No-op for empty/duplicate URLs. */
  preload(url: string | null | undefined): void {
    if (!url || this.requested.has(url)) return;
    this.requested.add(url);

    const img = new Image();
    img.decoding = 'async';
    // Low priority so warming never competes with above-the-fold content.
    try { (img as any).fetchPriority = 'low'; } catch { /* not supported */ }
    this.inFlight.add(img);

    const done = () => this.inFlight.delete(img);
    const decodeThenDone = () => {
      // decode() forces the bitmap to be ready so the eventual paint is atomic.
      if (typeof img.decode === 'function') {
        img.decode().then(done).catch(done);
      } else {
        done();
      }
    };

    img.onload = decodeThenDone;
    img.onerror = done;
    img.src = url;
  }

  /** Preload many URLs at once (nulls/dupes are ignored). */
  preloadMany(urls: (string | null | undefined)[]): void {
    if (!urls?.length) return;
    for (const url of urls) this.preload(url);
  }

  /**
   * Schedule preloading for when the main thread is idle, so warming a large
   * batch never blocks the current screen's interactions.
   */
  preloadWhenIdle(urls: (string | null | undefined)[]): void {
    if (!urls?.length) return;
    const run = () => this.preloadMany(urls);
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (ric) {
      ric(run, { timeout: 2000 });
    } else {
      setTimeout(run, 200);
    }
  }
}
