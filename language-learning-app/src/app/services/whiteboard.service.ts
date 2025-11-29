import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

export interface WhiteboardRoomResponse {
  success: boolean;
  roomUUID: string;
  roomToken: string;
  appId: string;
}

export interface WhiteboardTokenResponse {
  success: boolean;
  roomToken: string;
  appId: string;
}

@Injectable({
  providedIn: 'root'
})
export class WhiteboardService {
  private apiUrl = environment.backendUrl;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private userService: UserService
  ) {}

  private getAuthHeaders(): HttpHeaders {
    const token = this.userService.getAuthHeadersSync().get('Authorization');
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': token || ''
    });
  }

  /**
   * Create a new whiteboard room
   * @param isRecord - Whether to record the whiteboard session
   * @returns Observable with room UUID, token, and app ID
   */
  createRoom(isRecord: boolean = false): Observable<WhiteboardRoomResponse> {
    const headers = this.getAuthHeaders();
    return this.http.post<WhiteboardRoomResponse>(`${this.apiUrl}/api/whiteboard/create-room`, {
      isRecord
    }, { headers });
  }

  /**
   * Generate a token for an existing whiteboard room
   * @param roomUUID - The UUID of the room
   * @param role - User role: 'admin', 'writer', or 'reader'
   * @returns Observable with room token and app ID
   */
  getRoomToken(roomUUID: string, role: 'admin' | 'writer' | 'reader' = 'writer'): Observable<WhiteboardTokenResponse> {
    const headers = this.getAuthHeaders();
    return this.http.post<WhiteboardTokenResponse>(`${this.apiUrl}/api/whiteboard/room-token`, {
      roomUUID,
      role
    }, { headers });
  }

  /**
   * Delete a whiteboard room (cleanup after session)
   * @param roomUUID - The UUID of the room to delete
   * @returns Observable with success status
   */
  deleteRoom(roomUUID: string): Observable<{ success: boolean; message: string }> {
    const headers = this.getAuthHeaders();
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/api/whiteboard/room/${roomUUID}`, { headers });
  }
}