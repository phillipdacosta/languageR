import { api } from './api';
import { User } from '../types/user';

interface MeResponse {
  success: boolean;
  user: User;
}

interface SessionResponse {
  authenticated: boolean;
  user: User;
}

export const authService = {
  async getMe(token: string): Promise<User> {
    const data = await api.requestWithToken<MeResponse>('/users/me', token);
    return data.user;
  },

  async establishSession(email: string, auth0Id: string): Promise<User | null> {
    try {
      const data = await api.post<{ user: User }>('/auth/establish-session', { email, auth0Id });
      return data.user;
    } catch {
      return null;
    }
  },
};
