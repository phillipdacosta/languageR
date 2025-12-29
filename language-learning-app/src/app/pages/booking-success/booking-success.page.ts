import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { trigger, state, style, transition, animate } from '@angular/animations';

@Component({
  selector: 'app-booking-success',
  templateUrl: './booking-success.page.html',
  styleUrls: ['./booking-success.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  animations: [
    trigger('fadeInUp', [
      state('void', style({
        opacity: 0,
        transform: 'translateY(30px)'
      })),
      transition(':enter', [
        animate('600ms cubic-bezier(0.4, 0, 0.2, 1)', style({
          opacity: 1,
          transform: 'translateY(0)'
        }))
      ])
    ]),
    trigger('scaleIn', [
      state('void', style({
        opacity: 0,
        transform: 'scale(0.8)'
      })),
      transition(':enter', [
        animate('500ms 200ms cubic-bezier(0.4, 0, 0.2, 1)', style({
          opacity: 1,
          transform: 'scale(1)'
        }))
      ])
    ]),
    trigger('checkmark', [
      state('void', style({
        opacity: 0,
        transform: 'scale(0) rotate(-45deg)'
      })),
      transition(':enter', [
        animate('400ms 600ms cubic-bezier(0.68, -0.55, 0.265, 1.55)', style({
          opacity: 1,
          transform: 'scale(1) rotate(0deg)'
        }))
      ])
    ])
  ]
})
export class BookingSuccessPage implements OnInit {
  lessonDetails: any = null;
  tutorName: string = '';
  tutorAvatar: string = '';
  formattedDate: string = '';
  formattedTime: string = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    // Get lesson details from navigation state
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state || history.state;
    
    if (state?.lessonDetails) {
      this.lessonDetails = state.lessonDetails;
      this.setupLessonInfo();
    } else {
      // Fallback if no data - redirect to home
      console.warn('No lesson details found, redirecting to home');
      setTimeout(() => this.close(), 1000);
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
      this.formattedDate = startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      this.formattedTime = startDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
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
    return emojiMap[subject] || '🌍';
  }
}

