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
  reviewStatus?: 'auto_approved' | 'pending_review' | 'approved' | 'rejected';
  channelVerified?: boolean;
}

export interface BundleItem {
  materialId: TutorMaterial | string;
  sortOrder: number;
}

export interface MaterialBundle {
  _id: string;
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
  timestamp: number;
}

const cache: MaterialsCache = {
  materials: null,
  bundles: null,
  timestamp: 0,
};

const STALE_MS = 60_000;

export function getMaterialsCache() {
  return {
    materials: cache.materials,
    bundles: cache.bundles,
    hasCachedData: cache.materials !== null,
    isStale: cache.materials === null || Date.now() - cache.timestamp > STALE_MS,
  };
}

export const materialService = {
  async getMyMaterials(): Promise<TutorMaterial[]> {
    try {
      const data = await api.get<{ success: boolean; materials: TutorMaterial[] }>('/materials/my');
      const materials = data.materials || [];
      cache.materials = materials;
      cache.timestamp = Date.now();
      return materials;
    } catch (err: any) {
      console.warn('[Materials] getMyMaterials failed:', err?.message || err);
      return cache.materials || [];
    }
  },

  async getMyBundles(): Promise<MaterialBundle[]> {
    try {
      const data = await api.get<{ success: boolean; bundles: MaterialBundle[] }>('/bundles/my');
      const bundles = data.bundles || [];
      cache.bundles = bundles;
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

  async getLinkedChannels(): Promise<LinkedChannels> {
    try {
      const data = await api.get<{ success: boolean; linkedChannels: LinkedChannels }>('/materials/linked-channels');
      return data.linkedChannels || {};
    } catch (err: any) {
      console.warn('[Materials] getLinkedChannels failed:', err?.message || err);
      return {};
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
};
