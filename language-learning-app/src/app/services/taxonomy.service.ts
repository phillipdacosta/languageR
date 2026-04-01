import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, map } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ContentTag {
  tagId: string;
  category: 'grammar' | 'vocabulary' | 'skills' | 'topics';
  parent: string | null;
  depth: 'category' | 'subcategory' | 'leaf';
  labels: Record<string, string>;
  sortOrder: number;
  children?: ContentTag[];
}

export interface TaxonomyTree {
  grammar?: ContentTag[];
  vocabulary?: ContentTag[];
  skills?: ContentTag[];
  topics?: ContentTag[];
}

@Injectable({ providedIn: 'root' })
export class TaxonomyService {
  private apiUrl = `${environment.backendUrl}/api/taxonomy`;
  private flatCache$?: Observable<ContentTag[]>;
  private treeCache$?: Observable<TaxonomyTree>;

  constructor(private http: HttpClient) {}

  getFlat(): Observable<ContentTag[]> {
    if (!this.flatCache$) {
      this.flatCache$ = this.http.get<{ success: boolean; tags: ContentTag[] }>(`${this.apiUrl}/flat`).pipe(
        map(res => res.tags),
        shareReplay(1)
      );
    }
    return this.flatCache$;
  }

  getTree(): Observable<TaxonomyTree> {
    if (!this.treeCache$) {
      this.treeCache$ = this.http.get<{ success: boolean; taxonomy: TaxonomyTree }>(this.apiUrl).pipe(
        map(res => res.taxonomy),
        shareReplay(1)
      );
    }
    return this.treeCache$;
  }

  getLabel(tag: ContentTag, locale: string = 'en'): string {
    return tag.labels[locale] || tag.labels['en'] || tag.tagId;
  }

  clearCache(): void {
    this.flatCache$ = undefined;
    this.treeCache$ = undefined;
  }
}
