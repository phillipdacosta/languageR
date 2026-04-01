import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, take, switchMap, filter, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';
import { TutorMaterial } from './material.service';

export interface BundleItem {
  materialId: TutorMaterial | string;
  sortOrder: number;
}

export interface ContentBundle {
  _id: string;
  tutorId: any;
  title: string;
  description: string;
  coverImageUrl?: string;
  language: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'any';
  structuredTags: string[];
  items: BundleItem[];
  pricingType: 'free' | 'paid';
  price: number;
  status: 'draft' | 'published' | 'archived';
  stats: { views: number; purchases: number };
  purchased?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBundlePayload {
  title: string;
  description?: string;
  coverImageUrl?: string;
  language: string;
  level?: string;
  structuredTags?: string[];
  items?: Array<{ materialId: string; sortOrder: number }>;
  pricingType?: 'free' | 'paid';
  price?: number;
  status?: string;
}

export interface BundlePurchase {
  _id: string;
  studentId: string;
  bundleId: ContentBundle;
  tutorId: string;
  amount: number;
  createdAt: string;
}

export interface BrowseParams {
  language?: string;
  level?: string;
  tags?: string[];
  search?: string;
  sort?: 'newest' | 'popular' | 'price-low' | 'price-high';
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  bundles?: T[];
  materials?: T[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}

@Injectable({ providedIn: 'root' })
export class BundleService {
  private apiUrl = `${environment.backendUrl}/api/bundles`;

  constructor(private http: HttpClient, private userService: UserService) {}

  private withAuth<T>(request: (headers: any) => Observable<T>): Observable<T> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return request(headers);
      })
    );
  }

  createBundle(payload: CreateBundlePayload): Observable<{ success: boolean; bundle: ContentBundle }> {
    return this.withAuth(headers =>
      this.http.post<{ success: boolean; bundle: ContentBundle }>(this.apiUrl, payload, { headers })
    );
  }

  getMyBundles(): Observable<ContentBundle[]> {
    return this.withAuth(headers =>
      this.http.get<{ success: boolean; bundles: ContentBundle[] }>(`${this.apiUrl}/my`, { headers })
    ).pipe(map(res => res.bundles));
  }

  getBundle(id: string): Observable<ContentBundle> {
    return this.http.get<{ success: boolean; bundle: ContentBundle }>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.bundle)
    );
  }

  getBundleAuth(id: string): Observable<ContentBundle> {
    return this.withAuth(headers =>
      this.http.get<{ success: boolean; bundle: ContentBundle }>(`${this.apiUrl}/${id}`, { headers })
    ).pipe(map(res => res.bundle));
  }

  updateBundle(id: string, payload: Partial<CreateBundlePayload>): Observable<{ success: boolean; bundle: ContentBundle }> {
    return this.withAuth(headers =>
      this.http.put<{ success: boolean; bundle: ContentBundle }>(`${this.apiUrl}/${id}`, payload, { headers })
    );
  }

  deleteBundle(id: string): Observable<{ success: boolean }> {
    return this.withAuth(headers =>
      this.http.delete<{ success: boolean }>(`${this.apiUrl}/${id}`, { headers })
    );
  }

  getTutorBundles(tutorId: string): Observable<ContentBundle[]> {
    return this.http.get<{ success: boolean; bundles: ContentBundle[] }>(`${this.apiUrl}/tutor/${tutorId}`).pipe(
      map(res => res.bundles)
    );
  }

  browse(params: BrowseParams): Observable<PaginatedResponse<ContentBundle>> {
    let httpParams = new HttpParams();
    if (params.language) httpParams = httpParams.set('language', params.language);
    if (params.level) httpParams = httpParams.set('level', params.level);
    if (params.tags?.length) httpParams = httpParams.set('tags', params.tags.join(','));
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.sort) httpParams = httpParams.set('sort', params.sort);
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.limit) httpParams = httpParams.set('limit', params.limit.toString());

    return this.http.get<PaginatedResponse<ContentBundle>>(`${this.apiUrl}/browse`, { params: httpParams });
  }

  getRecommended(language: string): Observable<ContentBundle[]> {
    return this.withAuth(headers =>
      this.http.get<{ success: boolean; bundles: ContentBundle[] }>(`${this.apiUrl}/recommended/${language}`, { headers })
    ).pipe(map(res => res.bundles));
  }

  getMyPurchases(): Observable<BundlePurchase[]> {
    return this.withAuth(headers =>
      this.http.get<{ success: boolean; purchases: BundlePurchase[] }>(`${this.apiUrl}/my-purchases`, { headers })
    ).pipe(map(res => res.purchases));
  }

  purchaseBundle(bundleId: string, stripePaymentMethodId: string): Observable<{ success: boolean; message: string }> {
    return this.withAuth(headers =>
      this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/${bundleId}/purchase`, { stripePaymentMethodId }, { headers })
    );
  }

  uploadCover(file: File): Observable<{ success: boolean; url: string }> {
    return this.withAuth(headers => {
      const formData = new FormData();
      formData.append('cover', file);
      return this.http.post<{ success: boolean; url: string }>(`${this.apiUrl}/upload-cover`, formData, { headers });
    });
  }
}
