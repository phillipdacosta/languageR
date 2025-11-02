import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule, ModalController, Platform } from '@ionic/angular';
import { ActivatedRoute, Router, RouterLink, NavigationEnd } from '@angular/router';
import { UserService } from '../services/user.service';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { TutorSearchPage } from '../tutor-search/tutor-search.page';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-tutor-page',
  templateUrl: './tutor.page.html',
  styleUrls: ['./tutor.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TutorAvailabilityViewerComponent, RouterLink]
})
export class TutorPage implements OnInit, OnDestroy, AfterViewInit {
  tutorId = '';
  tutor: any = null;
  isLoading = true;
  showVideo = false;
  @ViewChild('introVideo', { static: false }) introVideoRef?: ElementRef<HTMLVideoElement>;
  showOverlay = true;
  cameFromModal = false;
  availabilityRefreshTrigger = 0;
  private backButtonSubscription: any;
  private routerSubscription: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService,
    private modalController: ModalController,
    private platform: Platform,
    private location: Location
  ) {}

  ngOnInit() {
    this.tutorId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.tutorId) {
      this.router.navigate(['/tabs']);
      return;
    }
    
    // Check if we came from the modal (via query params)
    const fromModal = this.route.snapshot.queryParamMap.get('fromModal');
    this.cameFromModal = fromModal === 'true';
    
    this.userService.getTutorPublic(this.tutorId).subscribe({
      next: (res) => {
        this.tutor = res.tutor;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
    
    // Check for refresh trigger from query params (e.g., after booking conflict)
    const refreshAvailability = this.route.snapshot.queryParamMap.get('refreshAvailability');
    if (refreshAvailability === 'true') {
      // Trigger availability refresh
      this.availabilityRefreshTrigger = Date.now();
      // Clear the query param to avoid repeated refreshes
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { refreshAvailability: null },
        queryParamsHandling: 'merge'
      });
    }
    
    // Set up back button handler if we came from modal
    if (this.cameFromModal) {
      this.setupBackButtonHandler();
    }
  }
  
  private setupBackButtonHandler() {
    // Handle platform/hardware back button
    if (this.platform.is('mobile')) {
      this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(10, () => {
        this.reopenSearchModal();
      });
    }
    
    // Override browser back button via popstate
    const popStateHandler = () => {
      if (this.cameFromModal) {
        history.pushState(null, '', window.location.href); // Prevent actual navigation
        this.reopenSearchModal();
      }
    };
    
    history.pushState(null, '', window.location.href); // Add state for back button
    window.addEventListener('popstate', popStateHandler);
    this.routerSubscription = { unsubscribe: () => window.removeEventListener('popstate', popStateHandler) };
  }
  
  async handleBackClick(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    await this.reopenSearchModal();
  }
  
  async reopenSearchModal() {
    // Get the tutor ID from query params to restore scroll position
    const tutorIdToScroll = this.route.snapshot.queryParamMap.get('tutorId') || this.tutorId;
    
    // Navigate back to home tab first
    await this.router.navigate(['/tabs/home'], { replaceUrl: true });
    
    // Small delay to ensure navigation completes
    setTimeout(async () => {
      // Reopen the search modal with data to restore scroll position
      const modal = await this.modalController.create({
        component: TutorSearchPage,
        componentProps: {
          scrollToTutorId: tutorIdToScroll
        }
      });
      await modal.present();
    }, 100);
  }

  ngOnDestroy() {
    const el = this.introVideoRef?.nativeElement;
    if (el) {
      el.pause();
    }
    
    // Clean up back button subscription
    if (this.backButtonSubscription) {
      this.backButtonSubscription.unsubscribe();
    }
    
    // Clean up router/popstate subscription
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }

  toggleIntroVideo() {
    const el = this.introVideoRef?.nativeElement;
    if (!el) return;
    el.controls = true;
    el.play();
    this.showOverlay = false;
  }

  expandVideo() {
    this.showVideo = true;
  }

  ngAfterViewInit() {
    const el = this.introVideoRef?.nativeElement;
    if (!el) return;
    el.controls = false;
    el.addEventListener('pause', () => {
      this.showOverlay = true;
    });
    el.addEventListener('ended', () => {
      this.showOverlay = true;
    });
    el.addEventListener('play', () => {
      this.showOverlay = false;
    });
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}