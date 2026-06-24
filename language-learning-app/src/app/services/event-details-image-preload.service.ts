import { Injectable } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import {
  collectEventDetailsImageUrls,
  parseEventDetailsLessonId,
} from '../tutor-calendar/event-details/event-details-image-preload.util';
import { EVENT_DETAILS_STATIC_IMAGES } from '../journey/journey-map-preview-assets';
import { ImagePreloadService } from './image-preload.service';
import { LessonService } from './lesson.service';

/**
 * Warms the browser cache for /tabs/lessons/:id before the detail page paints.
 * Static journey/trial art is warmed at app start; per-lesson avatars and map
 * backgrounds are warmed on navigation and when the detail cache grows.
 */
@Injectable({ providedIn: 'root' })
export class EventDetailsImagePreloadService {
  constructor(
    private router: Router,
    private imagePreload: ImagePreloadService,
    private lessonService: LessonService,
  ) {
    this.router.events.pipe(
      filter((e): e is NavigationStart => e instanceof NavigationStart),
    ).subscribe((e) => {
      const lessonId = parseEventDetailsLessonId(e.url);
      if (lessonId) {
        this.warmForLesson(lessonId, true);
      }
    });
  }

  /** Warm static event-details art during idle time (deduped). */
  warmStaticAssets(idle = true): void {
    const urls = [...EVENT_DETAILS_STATIC_IMAGES];
    if (idle) {
      this.imagePreload.preloadWhenIdle(urls);
    } else {
      this.imagePreload.preloadMany(urls);
    }
  }

  /** Warm all known images for a lesson detail view. */
  warmForLesson(lessonId: string, urgent = false, listLesson?: unknown): void {
    if (!lessonId) return;
    const feedLesson = listLesson ?? this.lessonService.findLessonInFeed(lessonId);
    // Read-only: never pass `feedLesson` here. getCachedLessonDetail evicts the
    // entry (memory + sessionStorage) on a fingerprint mismatch, and the lighter
    // list-feed lesson fingerprints differently than the populated detail lesson
    // — so passing it would nuke a valid cache on every navigation, forcing the
    // skeleton + a full refetch each visit.
    const bundle = this.lessonService.getCachedLessonDetail(lessonId);
    const urls = collectEventDetailsImageUrls(bundle, feedLesson ?? bundle?.lesson);
    if (urgent) {
      this.imagePreload.preloadMany(urls);
    } else {
      this.imagePreload.preloadWhenIdle(urls);
    }
  }
}
