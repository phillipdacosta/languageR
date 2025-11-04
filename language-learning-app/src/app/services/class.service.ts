import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, take, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface CreateClassRequest {
  name: string;
  capacity: number;
  isPublic: boolean;
  startTime: string; // ISO
  endTime: string;   // ISO
  recurrence?: { type: 'none' | 'daily' | 'weekly' | 'monthly'; count: number };
}

@Injectable({ providedIn: 'root' })
export class ClassService {
  private apiUrl = `${environment.backendUrl}/api`;

  constructor(private http: HttpClient, private userService: UserService) {}

  createClass(payload: CreateClassRequest): Observable<{ success: boolean; classes: any[] }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; classes: any[] }>(`${this.apiUrl}/classes`, payload, { headers });
      })
    );
  }
}


