import { Injectable } from '@angular/core';
import { UrlSerializer, UrlTree, DefaultUrlSerializer } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class CustomUrlSerializerService implements UrlSerializer {
  private defaultUrlSerializer: DefaultUrlSerializer = new DefaultUrlSerializer();

  parse(url: string): UrlTree {
    // Handle Auth0 callback URLs with special characters
    // Auth0 often includes characters like +, /, = in the state and code parameters
    // which can cause issues with the default URL parser
    
    try {
      // First try the default parser
      return this.defaultUrlSerializer.parse(url);
    } catch (error) {
      console.log('Default URL parser failed, trying custom parsing for:', url);
      
      // If default parsing fails, try to handle Auth0 callback URLs
      if (url.includes('/callback') && url.includes('code=')) {
        return this.parseAuth0Callback(url);
      }
      
      // For other URLs, try to clean them up
      return this.parseCleanedUrl(url);
    }
  }

  serialize(tree: UrlTree): string {
    return this.defaultUrlSerializer.serialize(tree);
  }

  private parseAuth0Callback(url: string): UrlTree {
    try {
      // Extract the base path and query parameters
      const [basePath, queryString] = url.split('?');
      
      if (!queryString) {
        return this.defaultUrlSerializer.parse(url);
      }

      // Parse query parameters manually to handle Auth0's special characters
      const params = new URLSearchParams(queryString);
      const cleanParams = new URLSearchParams();
      
      // Copy all parameters, ensuring they're properly encoded
      params.forEach((value, key) => {
        cleanParams.set(key, value);
      });
      
      // Reconstruct the URL with properly encoded parameters
      const cleanUrl = basePath + '?' + cleanParams.toString();
      console.log('Cleaned Auth0 callback URL:', cleanUrl);
      
      return this.defaultUrlSerializer.parse(cleanUrl);
    } catch (error) {
      console.error('Failed to parse Auth0 callback URL:', error);
      // Fallback to default parsing
      return this.defaultUrlSerializer.parse(url);
    }
  }

  private parseCleanedUrl(url: string): UrlTree {
    try {
      // Try to clean up the URL by properly encoding special characters
      const urlObj = new URL(url, window.location.origin);
      const cleanUrl = urlObj.pathname + urlObj.search;
      
      console.log('Cleaned URL:', cleanUrl);
      return this.defaultUrlSerializer.parse(cleanUrl);
    } catch (error) {
      console.error('Failed to clean URL:', error);
      // Last resort: try to parse as-is
      return this.defaultUrlSerializer.parse(url);
    }
  }
}
