import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class TokenGeneratorService {

  // For testing purposes only - in production, generate tokens on your server
  generateTestToken(channelName: string, uid: number = 0): string | null {
    // Use the token from environment if available
    if (environment.agora.token) {
      console.log('Using token from environment');
      return environment.agora.token;
    }
    
    // If no token in environment, return null
    console.log('No token found in environment');
    return null;
  }

  // Alternative: Use Agora's testing mode
  // Go to your Agora console -> Project Management -> Your Project -> Edit
  // Enable "Testing" mode to allow connections without tokens
  isTestingModeEnabled(): boolean {
    // Use token generation instead of testing mode
    return false; // We'll use the token from environment
  }
}
