import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  show() {
    console.log('🔄 LoadingService: Showing loading');
    this.loadingSubject.next(true);
  }

  hide() {
    console.log('🔄 LoadingService: Hiding loading');
    this.loadingSubject.next(false);
  }

  isLoading(): boolean {
    return this.loadingSubject.value;
  }
}
