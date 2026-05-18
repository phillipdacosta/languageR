import { Component, Input, Output, EventEmitter } from '@angular/core';
import { AlertController, IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-early-exit-modal',
  templateUrl: './early-exit-modal.component.html',
  styleUrls: ['./early-exit-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule]
})
export class EarlyExitModalComponent {
  @Input() lessonId!: string;
  @Input() minutesRemaining!: number;
  @Input() userRole!: 'tutor' | 'student';
  @Input() isClass: boolean = false;
  @Output() modalDismissed = new EventEmitter<{ action: string }>();

  constructor(
    private alertController: AlertController,
    private router: Router,
    private http: HttpClient,
    private userService: UserService,
    private translate: TranslateService
  ) {}

  private t(key: string): string {
    return this.translate.instant(key);
  }

  /**
   * Close modal without taking any action
   * Lesson continues until scheduled end time
   */
  dismiss() {
    console.log('🚪 User dismissed early exit modal - lesson continues until scheduled end');
    this.modalDismissed.emit({ action: 'dismissed' });
  }

  /**
   * Handle "Rejoin Call" - navigate back to the lesson
   */
  async rejoinCall() {
    console.log('🔄 Attempting to rejoin call for lesson:', this.lessonId);
    
    // First, check if lesson is still joinable
    try {
      const headers = this.userService.getAuthHeadersSync();
      const response = await firstValueFrom(
        this.http.get(`${environment.backendUrl}/api/lessons/${this.lessonId}`, { headers })
      );
      
      const lesson = (response as any)?.lesson;
      
      if (lesson?.status === 'completed') {
        // Lesson was ended, cannot rejoin
        this.modalDismissed.emit({ action: 'dismissed' });
        
        const alert = await this.alertController.create({
          header: this.t('ALERTS.EARLY_EXIT.ENDED_HEADER'),
          message: this.t('ALERTS.EARLY_EXIT.ENDED_MESSAGE'),
          buttons: [this.t('COMMON.OK')]
        });
        await alert.present();
        return;
      }
      
      // Lesson is still active, proceed with rejoin
      this.modalDismissed.emit({ action: 'rejoin' });

      // Navigate to pre-call page with minimal params
      // SECURITY: role is determined from lesson data + auth, not passed in URL
      await this.router.navigate(['/pre-call'], {
        queryParams: {
          lessonId: this.lessonId,
          lessonMode: 'true',
          isClass: this.isClass ? 'true' : 'false'
        }
      });
    } catch (error) {
      console.error('❌ Error checking lesson status:', error);
      
      const errorAlert = await this.alertController.create({
        header: this.t('ALERTS.EARLY_EXIT.REJOIN_ERROR_HEADER'),
        message: this.t('ALERTS.EARLY_EXIT.REJOIN_ERROR_MESSAGE'),
        buttons: [this.t('COMMON.OK')]
      });
      await errorAlert.present();
    }
  }
}
