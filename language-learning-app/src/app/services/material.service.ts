import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, take, switchMap, filter } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface QuizOption {
  _id?: string;
  text: string;
  isCorrect?: boolean;
}

export interface QuizQuestion {
  _id?: string;
  question: string;
  options: QuizOption[];
  explanation?: string;
}

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
  whyTakeThis?: string;
  pricingType: 'free' | 'paid';
  price: number;
  quiz: QuizQuestion[];
  quizLocked?: boolean;
  purchased?: boolean;
  purchasedAt?: string;
  purchaseAmount?: number;
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
  mediaUnavailableSince?: string;
  purchaseStatus?: 'completed' | 'refunded';
  refundedAt?: string;
  refundReason?: string;
  contentAttested?: boolean;
  contentAttestedAt?: string;
  reviewStatus?: 'auto_approved' | 'pending_review' | 'approved' | 'rejected';
  reviewNote?: string;
  channelVerified?: boolean;
}

export interface CreateMaterialPayload {
  title: string;
  description?: string;
  language: string;
  level?: string;
  materialType: MaterialType;
  videoUrl?: string;
  passage?: string;
  audioUrl?: string;
  whyTakeThis?: string;
  thumbnailUrl?: string;
  pricingType: 'free' | 'paid';
  price?: number;
  quiz: QuizQuestion[];
  status?: string;
  contentAttested?: boolean;
}

export interface LinkedChannels {
  youtubeChannelId?: string | null;
  youtubeChannelUrl?: string | null;
  youtubeChannelName?: string | null;
  youtubeChannelAvatar?: string | null;
  youtubeSubscriberCount?: string | null;
  youtubeVerified?: boolean;
  vimeoChannelUrl?: string | null;
  vimeoChannelName?: string | null;
  vimeoChannelAvatar?: string | null;
  soundcloudProfileUrl?: string | null;
  soundcloudProfileName?: string | null;
  soundcloudProfileAvatar?: string | null;
}

export interface QuizResult {
  score: number;
  totalQuestions: number;
  correctCount: number;
  results: Array<{
    questionId: string;
    question: string;
    userAnswer: string;
    correctAnswer: string;
    correctAnswerText: string;
    isCorrect: boolean;
    explanation: string | null;
  }>;
}

@Injectable({ providedIn: 'root' })
export class MaterialService {
  private apiUrl = `${environment.backendUrl}/api/materials`;

  constructor(private http: HttpClient, private userService: UserService) {}

  createMaterial(payload: CreateMaterialPayload): Observable<{ success: boolean; material: TutorMaterial }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; material: TutorMaterial }>(this.apiUrl, payload, { headers });
      })
    );
  }

  getMyMaterials(): Observable<{ success: boolean; materials: TutorMaterial[] }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; materials: TutorMaterial[] }>(`${this.apiUrl}/my`, { headers });
      })
    );
  }

  getTutorMaterials(tutorId: string): Observable<{ success: boolean; materials: TutorMaterial[] }> {
    return this.http.get<{ success: boolean; materials: TutorMaterial[] }>(`${this.apiUrl}/tutor/${tutorId}`);
  }

  getMaterial(id: string, ref?: string): Observable<{ success: boolean; material: TutorMaterial }> {
    const params: any = {};
    if (ref) params.ref = ref;

    const headers = this.userService.getAuthHeadersSync();
    if (headers && headers.get('Authorization')) {
      return this.http.get<{ success: boolean; material: TutorMaterial }>(`${this.apiUrl}/${id}`, { headers, params });
    }
    return this.http.get<{ success: boolean; material: TutorMaterial }>(`${this.apiUrl}/${id}`, { params });
  }

  updateMaterial(id: string, payload: Partial<CreateMaterialPayload>): Observable<{ success: boolean; material: TutorMaterial }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; material: TutorMaterial }>(`${this.apiUrl}/${id}`, payload, { headers });
      })
    );
  }

  getMyPurchases(): Observable<{ success: boolean; materials: TutorMaterial[] }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; materials: TutorMaterial[] }>(`${this.apiUrl}/my-purchases`, { headers });
      })
    );
  }

  deleteMaterial(id: string): Observable<{ success: boolean; message: string; softDeleted?: boolean }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.delete<{ success: boolean; message: string; softDeleted?: boolean }>(`${this.apiUrl}/${id}`, { headers });
      })
    );
  }

  purchaseMaterial(materialId: string, stripePaymentMethodId: string): Observable<{ success: boolean; message: string }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; message: string }>(
          `${this.apiUrl}/${materialId}/purchase`,
          { stripePaymentMethodId },
          { headers }
        );
      })
    );
  }

  checkMediaAvailability(materialId: string): Observable<{ success: boolean; available: boolean; reason?: string }> {
    return this.http.get<{ success: boolean; available: boolean; reason?: string }>(
      `${this.apiUrl}/${materialId}/check-media`
    );
  }

  submitQuiz(materialId: string, answers: string[]): Observable<{ success: boolean } & QuizResult> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean } & QuizResult>(
          `${this.apiUrl}/${materialId}/quiz/submit`,
          { answers },
          { headers }
        );
      })
    );
  }

  reportMaterial(materialId: string, reason: string, details: string, copyrightDetails?: any): Observable<{ success: boolean; report: any }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        const body: any = { reason, details };
        if (copyrightDetails) body.copyrightDetails = copyrightDetails;
        return this.http.post<{ success: boolean; report: any }>(
          `${this.apiUrl}/${materialId}/report`,
          body,
          { headers }
        );
      })
    );
  }

  getLinkedChannels(): Observable<{ success: boolean; linkedChannels: LinkedChannels }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; linkedChannels: LinkedChannels }>(
          `${this.apiUrl}/linked-channels`,
          { headers }
        );
      })
    );
  }

  updateLinkedChannels(channels: LinkedChannels): Observable<{ success: boolean; linkedChannels: LinkedChannels }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; linkedChannels: LinkedChannels }>(
          `${this.apiUrl}/linked-channels`,
          channels,
          { headers }
        );
      })
    );
  }

  getYouTubeAuthUrl(): Observable<{ url: string }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ url: string }>(
          `${environment.apiUrl}/auth/youtube/url`,
          { headers }
        );
      })
    );
  }

  unlinkYouTube(): Observable<{ success: boolean }> {
    return this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean }>(
          `${environment.apiUrl}/auth/youtube/unlink`,
          {},
          { headers }
        );
      })
    );
  }
}
