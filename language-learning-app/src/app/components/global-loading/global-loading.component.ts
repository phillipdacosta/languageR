import { Component, OnInit, OnDestroy } from '@angular/core';
import { LoadingService } from '../../services/loading.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-global-loading',
  template: `
    <div class="global-loading-overlay" *ngIf="isLoading">
      <div class="loading-content">
        <ion-spinner name="crescent"></ion-spinner>
        <p>Loading...</p>
      </div>
    </div>
  `,
  styles: [`
    .global-loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.98);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      animation: fadeIn 0.1s ease-in;
    }
    
    .loading-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    
    ion-spinner {
      margin-bottom: 1rem;
      --color: var(--ion-color-primary);
    }
    
    p {
      color: var(--ion-color-medium);
      font-size: 1.1rem;
      margin: 0;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `],
  standalone: false,
})
export class GlobalLoadingComponent implements OnInit, OnDestroy {
  isLoading = false;
  private subscription: Subscription = new Subscription();

  constructor(private loadingService: LoadingService) {}

  ngOnInit() {
    this.subscription = this.loadingService.loading$.subscribe(loading => {
      this.isLoading = loading;
    });
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }
}
