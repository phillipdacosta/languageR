import { Image as ExpoImage } from 'expo-image';
import { api } from './api';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type MaterialType = 'video_quiz' | 'reading' | 'listening';

export interface TutorMaterial {
  _id: string;
  tutorId: any;
  title: string;
  description: string;
  language: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'any';
  materialType: MaterialType;
  videoUrl?: string;
  videoProvider?: 'youtube' | 'vimeo';
  videoEmbedUrl?: string;
  thumbnailUrl?: string;
  passage?: string;
  audioUrl?: string;
  audioProvider?: 'soundcloud' | 'spotify' | 'direct';
  audioEmbedUrl?: string;
  topics?: string[];
  structuredTags?: string[];
  whyTakeThis?: string;
  pricingType: 'free' | 'paid';
  price: number;
  quiz: { _id?: string; question: string }[];
  quizLocked?: boolean;
  status: 'draft' | 'published' | 'archived' | 'deleted';
  stats: {
    views: number;
    quizAttempts: number;
    purchases: number;
    averageScore: number;
  };
  createdAt: string;
  updatedAt: string;
  mediaUnavailable?: boolean;
  purchaseStatus?: 'purchased' | 'refunded' | null;
  refundReason?: string;
  reviewStatus?: 'auto_approved' | 'pending_review' | 'approved' | 'rejected';
  channelVerified?: boolean;
}

export interface BundleItem {
  materialId: TutorMaterial | string;
  sortOrder: number;
}

export interface MaterialBundle {
  _id: string;
  tutorId?: any;
  title: string;
  description?: string;
  language: string;
  level?: 'beginner' | 'intermediate' | 'advanced' | 'any';
  coverImageUrl?: string;
  pricingType: 'free' | 'paid';
  price: number;
  status: 'draft' | 'published' | 'archived';
  items: BundleItem[];
  structuredTags?: string[];
  stats: {
    views: number;
    purchases: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface QuizResultItem {
  questionId: string;
  question: string;
  type: string;
  userAnswer: any;
  correctAnswer: any;
  correctAnswerText: string;
  isCorrect: boolean;
  explanation?: string | null;
}

export interface QuizSubmitResult {
  score: number;
  totalQuestions: number;
  correctCount: number;
  results: QuizResultItem[];
  averageScore: number;
  totalAttempts: number;
}

export interface SavedCard {
  stripePaymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault?: boolean;
}

export interface RecommendedMaterial extends TutorMaterial {
  isSaved?: boolean;
  _matchedStruggles?: string[];
  _isCurrentTutor?: boolean;
  _topicScore?: number;
}

export interface RecommendedMaterialsResponse {
  success: boolean;
  materials: RecommendedMaterial[];
  struggles: string[];
  studentLevel?: string;
  isLessonSpecific?: boolean;
}

export interface LinkedChannels {
  youtubeChannelId?: string | null;
  youtubeChannelUrl?: string | null;
  youtubeChannelName?: string | null;
  youtubeChannelAvatar?: string | null;
  youtubeSubscriberCount?: string | null;
  youtubeVerified?: boolean;
  vimeoChannelId?: string | null;
  vimeoChannelUrl?: string | null;
  vimeoChannelName?: string | null;
  vimeoChannelAvatar?: string | null;
  vimeoVerified?: boolean;
  soundcloudProfileUrl?: string | null;
  soundcloudProfileName?: string | null;
  soundcloudProfileAvatar?: string | null;
}

interface MaterialsCache {
  materials: TutorMaterial[] | null;
  bundles: MaterialBundle[] | null;
  channels: LinkedChannels | null;
  materialsTs: number;
  bundlesTs: number;
  channelsTs: number;
}

const cache: MaterialsCache = {
  materials: null,
  bundles: null,
  channels: null,
  materialsTs: 0,
  bundlesTs: 0,
  channelsTs: 0,
};

const STALE_MS = 2 * 60_000;

export function getMaterialsCache() {
  return {
    materials: cache.materials,
    bundles: cache.bundles,
    channels: cache.channels,
    hasCachedData: cache.materials !== null,
    isStale: cache.materials === null || Date.now() - cache.materialsTs > STALE_MS,
  };
}

let _preloadPromise: Promise<void> | null = null;

const HTTP_URL = /^https?:\/\//i;

function collectLibraryImageUrls(materials: TutorMaterial[], bundles: MaterialBundle[]): string[] {
  const urls = new Set<string>();
  for (const m of materials) {
    const u = m.thumbnailUrl?.trim();
    if (u && HTTP_URL.test(u)) urls.add(u);
  }
  for (const b of bundles) {
    const u = b.coverImageUrl?.trim();
    if (u && HTTP_URL.test(u)) urls.add(u);
  }
  return [...urls];
}

function collectChannelAvatarUrls(ch: LinkedChannels | null | undefined): string[] {
  if (!ch) return [];
  const urls: string[] = [];
  for (const u of [ch.youtubeChannelAvatar, ch.vimeoChannelAvatar, ch.soundcloudProfileAvatar]) {
    const t = u?.trim();
    if (t && HTTP_URL.test(t)) urls.push(t);
  }
  return urls;
}

/** Prefetch remote covers so list rows don't flash in when opening My Materials. */
export async function prefetchLibraryCoverImages(materials: TutorMaterial[], bundles: MaterialBundle[], channels?: LinkedChannels): Promise<void> {
  const all = [...collectLibraryImageUrls(materials, bundles), ...collectChannelAvatarUrls(channels)];
  if (all.length === 0) return;
  await ExpoImage.prefetch(all).catch(() => {});
}

function schedulePrefetchFromCache() {
  void prefetchLibraryCoverImages(cache.materials || [], cache.bundles || [], cache.channels || undefined);
}

/** Fire-and-forget from HomeScreen so data is ready before user opens My Materials. */
export function preloadMaterials() {
  if (_preloadPromise) return _preloadPromise;
  _preloadPromise = (async () => {
    try {
      await Promise.all([
        materialService.getMyMaterials(),
        materialService.getMyBundles(),
        materialService.getLinkedChannels(),
      ]);
      await prefetchLibraryCoverImages(cache.materials || [], cache.bundles || [], cache.channels || undefined);
    } catch { /* swallow — best-effort */ }
    _preloadPromise = null;
  })();
  return _preloadPromise;
}

export const materialService = {
  async getMyMaterials(forceRefresh = false): Promise<TutorMaterial[]> {
    if (!forceRefresh && cache.materials && Date.now() - cache.materialsTs < STALE_MS) {
      schedulePrefetchFromCache();
      return cache.materials;
    }
    try {
      const data = await api.get<{ success: boolean; materials: TutorMaterial[] }>('/materials/my');
      const materials = data.materials || [];
      cache.materials = materials;
      cache.materialsTs = Date.now();
      schedulePrefetchFromCache();
      return materials;
    } catch (err: any) {
      console.warn('[Materials] getMyMaterials failed:', err?.message || err);
      return cache.materials || [];
    }
  },

  async getMyBundles(forceRefresh = false): Promise<MaterialBundle[]> {
    if (!forceRefresh && cache.bundles && Date.now() - cache.bundlesTs < STALE_MS) {
      schedulePrefetchFromCache();
      return cache.bundles;
    }
    try {
      const data = await api.get<{ success: boolean; bundles: MaterialBundle[] }>('/bundles/my');
      const bundles = data.bundles || [];
      cache.bundles = bundles;
      cache.bundlesTs = Date.now();
      schedulePrefetchFromCache();
      return bundles;
    } catch (err: any) {
      console.warn('[Materials] getMyBundles failed:', err?.message || err);
      return cache.bundles || [];
    }
  },

  async deleteMaterial(id: string): Promise<boolean> {
    try {
      await api.delete(`/materials/${id}`);
      if (cache.materials) {
        cache.materials = cache.materials.filter(m => m._id !== id);
      }
      return true;
    } catch (err: any) {
      console.warn('[Materials] deleteMaterial failed:', err?.message || err);
      return false;
    }
  },

  async getLinkedChannels(forceRefresh = false): Promise<LinkedChannels> {
    if (!forceRefresh && cache.channels && Date.now() - cache.channelsTs < STALE_MS) {
      schedulePrefetchFromCache();
      return cache.channels;
    }
    try {
      const data = await api.get<{ success: boolean; linkedChannels: LinkedChannels }>('/materials/linked-channels');
      const ch = data.linkedChannels || {};
      cache.channels = ch;
      cache.channelsTs = Date.now();
      schedulePrefetchFromCache();
      return ch;
    } catch (err: any) {
      console.warn('[Materials] getLinkedChannels failed:', err?.message || err);
      return cache.channels || {};
    }
  },

  async updateLinkedChannels(channels: LinkedChannels): Promise<LinkedChannels> {
    try {
      const data = await api.put<{ success: boolean; linkedChannels: LinkedChannels }>('/materials/linked-channels', channels);
      return data.linkedChannels || channels;
    } catch (err: any) {
      console.warn('[Materials] updateLinkedChannels failed:', err?.message || err);
      throw err;
    }
  },

  async unlinkYouTube(): Promise<boolean> {
    try {
      await api.post('/auth/youtube/unlink');
      return true;
    } catch (err: any) {
      console.warn('[Materials] unlinkYouTube failed:', err?.message || err);
      return false;
    }
  },

  async unlinkVimeo(): Promise<boolean> {
    try {
      await api.post('/auth/vimeo/unlink');
      return true;
    } catch (err: any) {
      console.warn('[Materials] unlinkVimeo failed:', err?.message || err);
      return false;
    }
  },

  async uploadThumbnail(localUri: string): Promise<string> {
    console.log('[uploadThumbnail] 1. Input URI:', localUri.substring(0, 80));
    const processed = await manipulateAsync(localUri, [], { compress: 0.8, format: SaveFormat.JPEG });
    console.log('[uploadThumbnail] 2. Processed URI:', processed.uri.substring(0, 80));
    const formData = new FormData();
    formData.append('thumbnail', { uri: processed.uri, name: 'cover.jpg', type: 'image/jpeg' } as any);
    console.log('[uploadThumbnail] 3. Calling api.upload /materials/upload-thumbnail ...');
    const data = await api.upload<{ success: boolean; imageUrl: string }>('/materials/upload-thumbnail', formData);
    console.log('[uploadThumbnail] 4. Response:', JSON.stringify(data).substring(0, 200));
    return data.imageUrl;
  },

  async createMaterial(payload: Record<string, any>): Promise<TutorMaterial> {
    const data = await api.post<{ success: boolean; material: TutorMaterial }>('/materials', payload);
    if (cache.materials) {
      cache.materials = [data.material, ...cache.materials];
    }
    schedulePrefetchFromCache();
    return data.material;
  },

  async updateMaterial(id: string, payload: Record<string, any>): Promise<TutorMaterial> {
    const data = await api.put<{ success: boolean; material: TutorMaterial }>(`/materials/${id}`, payload);
    if (cache.materials) {
      const idx = cache.materials.findIndex(m => m._id === id);
      if (idx >= 0) {
        cache.materials = cache.materials.map(m => (m._id === id ? data.material : m));
      } else {
        cache.materials = [data.material, ...cache.materials];
      }
    }
    schedulePrefetchFromCache();
    return data.material;
  },

  async toggleArchive(id: string, currentStatus: string): Promise<TutorMaterial | null> {
    const newStatus = currentStatus === 'archived' ? 'published' : 'archived';
    try {
      const data = await api.put<{ success: boolean; material: TutorMaterial }>(`/materials/${id}`, { status: newStatus });
      if (cache.materials) {
        cache.materials = cache.materials.map(m => m._id === id ? data.material : m);
      }
      return data.material;
    } catch (err: any) {
      console.warn('[Materials] toggleArchive failed:', err?.message || err);
      return null;
    }
  },

  async getMaterial(id: string): Promise<TutorMaterial | null> {
    try {
      const data = await api.get<{ success: boolean; material: TutorMaterial }>(`/materials/${id}`);
      return data.material || null;
    } catch (err: any) {
      console.warn('[Materials] getMaterial failed:', err?.message || err);
      return null;
    }
  },

  async submitQuiz(materialId: string, answers: any[]): Promise<QuizSubmitResult | null> {
    try {
      const data = await api.post<QuizSubmitResult & { success: boolean }>(`/materials/${materialId}/quiz/submit`, { answers });
      return data;
    } catch (err: any) {
      console.warn('[Materials] submitQuiz failed:', err?.message || err);
      return null;
    }
  },

  async reportMaterial(materialId: string, reason: string, details?: string): Promise<boolean> {
    try {
      await api.post(`/materials/${materialId}/report`, { reason, details });
      return true;
    } catch (err: any) {
      console.warn('[Materials] reportMaterial failed:', err?.message || err);
      return false;
    }
  },

  async getSavedCards(): Promise<SavedCard[]> {
    try {
      const data = await api.get<{ success: boolean; paymentMethods: SavedCard[] }>('/payments/payment-methods');
      return data.paymentMethods || [];
    } catch (err: any) {
      console.warn('[Materials] getSavedCards failed:', err?.message || err);
      return [];
    }
  },

  async purchaseMaterial(materialId: string, stripePaymentMethodId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const data = await api.post<{ success: boolean; message: string }>(`/materials/${materialId}/purchase`, { stripePaymentMethodId });
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Purchase failed' };
    }
  },

  async checkMediaAvailability(materialId: string): Promise<{ available: boolean; reason?: string }> {
    try {
      const data = await api.get<{ success: boolean; available: boolean; reason?: string }>(`/materials/${materialId}/check-media`);
      return { available: data.available !== false };
    } catch {
      return { available: true };
    }
  },

  /* ── Bundles ── */

  async getBundle(id: string): Promise<{ bundle: MaterialBundle | null; hasPurchased: boolean }> {
    try {
      const data = await api.get<{ success: boolean; bundle: MaterialBundle; hasPurchased?: boolean }>(`/bundles/${id}`);
      return { bundle: data.bundle || null, hasPurchased: !!data.hasPurchased };
    } catch (err: any) {
      console.warn('[Materials] getBundle failed:', err?.message || err);
      return { bundle: null, hasPurchased: false };
    }
  },

  async createBundle(payload: Record<string, any>): Promise<MaterialBundle> {
    const data = await api.post<{ success: boolean; bundle: MaterialBundle }>('/bundles', payload);
    if (cache.bundles) {
      cache.bundles = [data.bundle, ...cache.bundles];
    }
    return data.bundle;
  },

  async updateBundle(id: string, payload: Record<string, any>): Promise<MaterialBundle | null> {
    try {
      const data = await api.put<{ success: boolean; bundle: MaterialBundle }>(`/bundles/${id}`, payload);
      if (cache.bundles) {
        cache.bundles = cache.bundles.map(b => b._id === id ? data.bundle : b);
      }
      return data.bundle;
    } catch (err: any) {
      console.warn('[Materials] updateBundle failed:', err?.message || err);
      return null;
    }
  },

  async deleteBundle(id: string): Promise<boolean> {
    try {
      await api.delete(`/bundles/${id}`);
      if (cache.bundles) {
        cache.bundles = cache.bundles.filter(b => b._id !== id);
      }
      return true;
    } catch (err: any) {
      console.warn('[Materials] deleteBundle failed:', err?.message || err);
      return false;
    }
  },

  async uploadBundleCover(localUri: string): Promise<string> {
    const processed = await manipulateAsync(localUri, [], { compress: 0.8, format: SaveFormat.JPEG });
    const formData = new FormData();
    formData.append('cover', { uri: processed.uri, name: 'cover.jpg', type: 'image/jpeg' } as any);
    const data = await api.upload<{ success: boolean; imageUrl: string }>('/bundles/upload-cover', formData);
    return data.imageUrl;
  },

  async purchaseBundle(bundleId: string, stripePaymentMethodId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const data = await api.post<{ success: boolean; message: string }>(`/bundles/${bundleId}/purchase`, { stripePaymentMethodId });
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Purchase failed' };
    }
  },

  /* ── Recommendations ── */

  async getRecommendedMaterials(
    language: string,
    opts?: { lessonId?: string; tutorId?: string }
  ): Promise<RecommendedMaterialsResponse> {
    try {
      const params = new URLSearchParams();
      if (opts?.lessonId) params.set('lessonId', opts.lessonId);
      if (opts?.tutorId) params.set('tutorId', opts.tutorId);
      const qs = params.toString();
      const url = `/materials/recommended/${encodeURIComponent(language)}${qs ? `?${qs}` : ''}`;
      const data = await api.get<RecommendedMaterialsResponse>(url);
      return data;
    } catch (err: any) {
      console.warn('[Materials] getRecommendedMaterials failed:', err?.message || err);
      return { success: false, materials: [], struggles: [] };
    }
  },

  async toggleSaveMaterial(
    materialId: string,
    sourceLessonId?: string
  ): Promise<{ success: boolean; saved: boolean }> {
    try {
      const body: Record<string, string> = { source: 'recommendation' };
      if (sourceLessonId) body.sourceLessonId = sourceLessonId;
      const data = await api.post<{ success: boolean; saved: boolean }>(`/materials/${materialId}/save`, body);
      return data;
    } catch (err: any) {
      console.warn('[Materials] toggleSaveMaterial failed:', err?.message || err);
      return { success: false, saved: false };
    }
  },

  async getSavedMaterials(): Promise<TutorMaterial[]> {
    try {
      const data = await api.get<{ success: boolean; materials: TutorMaterial[] }>('/materials/saved');
      return data.materials || [];
    } catch (err: any) {
      console.warn('[Materials] getSavedMaterials failed:', err?.message || err);
      return [];
    }
  },
};
