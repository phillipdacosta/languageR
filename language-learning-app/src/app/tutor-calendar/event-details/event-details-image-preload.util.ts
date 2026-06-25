import { journeyBackgroundPreloadUrls } from '../../journey/journey-map-assets';
import { EVENT_DETAILS_STATIC_IMAGES } from '../../journey/journey-map-preview-assets';
import { CachedLessonDetailBundle } from '../../services/lesson.service';

const MAP_PLAN_STATUSES = new Set(['draft', 'active', 'completed', 'mastery_mode']);

function pushPersonPicture(urls: Set<string>, person: unknown): void {
  if (!person || typeof person !== 'object') return;
  const p = person as { picture?: string; profilePicture?: string };
  if (p.picture) urls.add(p.picture);
  if (p.profilePicture) urls.add(p.profilePicture);
}

function pushMaterialThumbnails(urls: Set<string>, materials: unknown[] | undefined): void {
  for (const mat of materials ?? []) {
    const thumb = (mat as { thumbnailUrl?: string })?.thumbnailUrl;
    if (thumb) urls.add(thumb);
  }
}

function pickPlanSummary(
  summaries: unknown[] | undefined,
  lessonLanguage: string
): Record<string, unknown> | null {
  if (!summaries?.length) return null;
  const normalized = lessonLanguage.trim().toLowerCase();
  if (normalized) {
    const match = summaries.find(
      (s) => String((s as { language?: string })?.language || '').trim().toLowerCase() === normalized
    );
    if (match) return match as Record<string, unknown>;
  }
  return summaries[0] as Record<string, unknown>;
}

function addJourneyMapImage(urls: Set<string>, summary: Record<string, unknown> | null, isTrial: boolean): void {
  if (isTrial || !summary) return;

  const status = String(summary['status'] || '');
  const phases = summary['phases'] as unknown[] | undefined;
  const totalPhases = Number(summary['totalPhases'] || 0);
  const phaseCount = phases?.length || totalPhases;

  if (MAP_PLAN_STATUSES.has(status) && phaseCount > 0) {
    const theme = String(summary['chapterTheme'] || 'a1-desert');
    for (const url of journeyBackgroundPreloadUrls(theme, phaseCount)) {
      urls.add(url);
    }
  }
}

/** Collect every image URL that may appear on /tabs/lessons/:id. */
export function collectEventDetailsImageUrls(
  bundle: CachedLessonDetailBundle | null | undefined,
  listLesson?: unknown
): string[] {
  const urls = new Set<string>(EVENT_DETAILS_STATIC_IMAGES);
  const lesson = (bundle?.lesson ?? listLesson) as Record<string, unknown> | undefined;
  const classData = (bundle?.classData ?? lesson?.['classData']) as { thumbnail?: string } | undefined;

  if (classData?.thumbnail) urls.add(classData.thumbnail);

  if (lesson) {
    pushPersonPicture(urls, lesson['tutorId']);
    pushPersonPicture(urls, lesson['studentId']);
    if (typeof lesson['thumbnail'] === 'string') urls.add(lesson['thumbnail']);
  }

  pushMaterialThumbnails(urls, bundle?.recommendedMaterials);
  pushMaterialThumbnails(urls, bundle?.tutorMaterials);

  const lessonLanguage = String(lesson?.['language'] || lesson?.['subject'] || '');
  const summary = pickPlanSummary(bundle?.planSummaries, lessonLanguage);
  addJourneyMapImage(urls, summary, !!lesson?.['isTrialLesson']);

  return [...urls];
}

/** Match /tabs/lessons/:id (and legacy /lessons/:id) navigation targets. */
export function parseEventDetailsLessonId(url: string): string | null {
  const path = url.split('?')[0].split('#')[0];
  const match = path.match(/(?:^|\/)lessons\/([^/]+)$/);
  return match?.[1] ?? null;
}
