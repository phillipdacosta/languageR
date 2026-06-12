import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import '@dotlottie/player-component';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { formatTimeInTz, formatDateInTz } from '../../shared/timezone.utils';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-booking-success',
  templateUrl: './booking-success.page.html',
  styleUrls: ['./booking-success.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class BookingSuccessPage implements OnInit, AfterViewInit {
  lessonDetails: any = null;
  tutorName: string = '';
  tutorAvatar: string = '';
  formattedDate: string = '';
  formattedTime: string = '';
  priceDisplay: string = '';
  revealed = false;

  @ViewChild('lottiePlayer', { read: ElementRef }) lottiePlayerRef?: ElementRef;

  constructor(
    private router: Router,
    private userService: UserService
  ) {}

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  ngOnInit() {
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state || history.state;
    
    if (state?.lessonDetails) {
      this.lessonDetails = state.lessonDetails;
      this.setupLessonInfo();
    } else {
      // Dev preview: show mock data so the page is viewable at /booking-success
      this.lessonDetails = {
        subject: 'Spanish',
        duration: 25,
        price: 15.00,
        startTime: new Date(Date.now() + 86400000).toISOString(),
        tutor: { firstName: 'Maria', lastName: 'Garcia' }
      };
      this.setupLessonInfo();
    }

  }

  ngAfterViewInit() {
    const el = this.lottiePlayerRef?.nativeElement;
    if (el) {
      // Wait for the lottie player to actually start playing before timing the reveal
      el.addEventListener('ready', () => {
        setTimeout(() => { this.revealed = true; }, 2800);
      });
      // Fallback if ready already fired or never fires
      setTimeout(() => { if (!this.revealed) this.revealed = true; }, 4500);
    } else {
      setTimeout(() => { this.revealed = true; }, 2800);
    }
  }

  setupLessonInfo() {
    if (!this.lessonDetails) return;

    // Format tutor name (First Name + Last Initial)
    const tutor = this.lessonDetails.tutor;
    if (tutor) {
      const firstName = tutor.firstName || tutor.name?.split(' ')[0] || '';
      const lastName = tutor.lastName || tutor.name?.split(' ')[1] || '';
      const lastInitial = lastName ? `${lastName.charAt(0).toUpperCase()}.` : '';
      this.tutorName = `${firstName} ${lastInitial}`.trim();
      this.tutorAvatar = tutor.picture || tutor.profilePicture || '';
    }

    // Format date and time
    if (this.lessonDetails.startTime) {
      const startDate = new Date(this.lessonDetails.startTime);
      this.formattedDate = formatDateInTz(startDate, this.userTz, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: undefined
      });
      this.formattedTime = formatTimeInTz(startDate, this.userTz);
    }

    // Prefer the actual charged amount/currency passed from checkout; fall back
    // to the USD lesson price for older navigations / dev preview.
    if (this.lessonDetails.chargeDisplay) {
      this.priceDisplay = this.lessonDetails.chargeDisplay;
    } else {
      this.priceDisplay = `$${this.formatPrice(this.lessonDetails.price)}`;
    }
  }

  close() {
    // Navigate to home page with replaceUrl to replace history
    // and pass a flag to force reload lessons
    this.router.navigate(['/tabs/home'], { 
      replaceUrl: true,
      state: { forceReload: true }
    });
  }

  getSubjectEmoji(subject: string): string {
    if (!subject) return '🌍';
    const emojiMap: { [key: string]: string } = {
      'Spanish': '🇪🇸',
      'French': '🇫🇷',
      'German': '🇩🇪',
      'Italian': '🇮🇹',
      'Portuguese': '🇵🇹',
      'English': '🇬🇧',
      'Chinese': '🇨🇳',
      'Japanese': '🇯🇵',
      'Korean': '🇰🇷',
      'Russian': '🇷🇺',
      'Arabic': '🇸🇦'
    };
    // Handle "Spanish Lesson" → "Spanish"
    const lang = subject.replace(/\s*Lesson$/i, '').trim();
    return emojiMap[lang] || '🌍';
  }

  formatPrice(price: number): string {
    return typeof price === 'number' ? price.toFixed(2) : '0.00';
  }
}

