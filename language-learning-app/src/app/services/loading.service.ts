import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private readonly defaultMessageKey = 'COMMON.LOADING';
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private messageKeySubject = new BehaviorSubject<string>(this.defaultMessageKey);
  public loading$ = this.loadingSubject.asObservable();
  public messageKey$ = this.messageKeySubject.asObservable();

  show(messageKey = this.defaultMessageKey) {
    this.messageKeySubject.next(messageKey);
    this.loadingSubject.next(true);
  }

  hide() {
    this.loadingSubject.next(false);
    this.messageKeySubject.next(this.defaultMessageKey);
  }

  isLoading(): boolean {
    return this.loadingSubject.value;
  }
}
