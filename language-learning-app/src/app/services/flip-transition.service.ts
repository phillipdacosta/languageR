import { Injectable } from '@angular/core';

export interface FlipCloneEntry {
  key: string;
  cloneElement: HTMLElement;
  destSelector: string;
}

export interface FlipTransitionData {
  clones: FlipCloneEntry[];
}

@Injectable({ providedIn: 'root' })
export class FlipTransitionService {
  private pending: FlipTransitionData | null = null;

  store(data: FlipTransitionData): void {
    this.pending = data;
  }

  consume(): FlipTransitionData | null {
    const data = this.pending;
    this.pending = null;
    return data;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  cleanup(): void {
    if (this.pending?.clones) {
      for (const entry of this.pending.clones) {
        if (entry.cloneElement?.parentNode) entry.cloneElement.remove();
      }
    }
    this.pending = null;
  }
}
