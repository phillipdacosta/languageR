import { Component, OnInit } from '@angular/core';
import { LoadingService } from './services/loading.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(private loadingService: LoadingService) {}

  ngOnInit() {
    // Show loading immediately when app starts to prevent any flash
    console.log('🚀 AppComponent: Starting app, showing loading');
    this.loadingService.show();
    
    // Add a timeout to hide loading after 10 seconds as a safety net
    setTimeout(() => {
      if (this.loadingService.isLoading()) {
        console.log('🚀 AppComponent: Timeout reached, hiding loading as safety net');
        this.loadingService.hide();
      }
    }, 10000);
  }
}
