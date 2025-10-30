import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UserService } from '../services/user.service';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';

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
  @ViewChild('introVideo', { static: false }) introVideoRef?: ElementRef<HTMLVideoElement>;
  showOverlay = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {}

  ngOnInit() {
    this.tutorId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.tutorId) {
      this.router.navigate(['/tabs']);
      return;
    }
    this.userService.getTutorPublic(this.tutorId).subscribe({
      next: (res) => {
        this.tutor = res.tutor;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy() {}

  toggleIntroVideo() {
    const el = this.introVideoRef?.nativeElement;
    if (!el) return;
    // First click: reveal native controls and start playback
    el.controls = true;
    el.play();
    this.showOverlay = false;
  }

  ngAfterViewInit() {
    const el = this.introVideoRef?.nativeElement;
    if (!el) return;
    // start with controls hidden until user taps play overlay
    el.controls = false;
    el.addEventListener('pause', () => {
      // Show overlay only if not ended and not playing
      this.showOverlay = true;
    });
    el.addEventListener('ended', () => {
      this.showOverlay = true;
    });
    el.addEventListener('play', () => {
      this.showOverlay = false;
    });
  }
}


