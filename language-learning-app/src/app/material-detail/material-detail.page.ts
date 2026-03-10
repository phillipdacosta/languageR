import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ModalController, AlertController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialService, TutorMaterial, QuizResult } from '../services/material.service';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { SharedModule } from '../shared/shared.module';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';
import { take } from 'rxjs';

@Component({
  selector: 'app-material-detail',
  templateUrl: './material-detail.page.html',
  styleUrls: ['./material-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, SharedModule]
})
export class MaterialDetailPage implements OnInit {
  material: TutorMaterial | null = null;
  isLoading = true;
  error: string | null = null;

  videoEmbedUrl: SafeResourceUrl | null = null;
  audioEmbedUrl: SafeResourceUrl | null = null;
  currentUser: any = null;
  isTutorOwner = false;
  channelInfo: { name: string; avatar: string | null; url: string; subs?: string } | null = null;

  // Quiz state
  quizMode: 'idle' | 'taking' | 'results' = 'idle';
  selectedAnswers: (string | null)[] = [];
  currentQuestionIndex = 0;
  quizResult: QuizResult | null = null;
  isSubmittingQuiz = false;
  isPurchasing = false;

  isAuthenticated = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private materialService: MaterialService,
    private userService: UserService,
    private authService: AuthService,
    private sanitizer: DomSanitizer,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.userService.currentUser$.subscribe(u => {
      this.currentUser = u;
      if (u) this.isAuthenticated = true;
    });

    this.authService.isAuthenticated$.pipe(take(1)).subscribe(auth => {
      this.isAuthenticated = auth;
    });

    const id = this.route.snapshot.paramMap.get('id');
    const ref = this.route.snapshot.queryParamMap.get('ref') || undefined;
    if (id) {
      this.loadMaterial(id, ref);
    }
  }

  loadMaterial(id: string, ref?: string) {
    this.isLoading = true;
    this.materialService.getMaterial(id, ref).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success && res.material) {
          this.material = res.material;
          if (this.material.videoEmbedUrl) {
            this.videoEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.material.videoEmbedUrl);
          }
          if (this.material.audioEmbedUrl) {
            this.audioEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.material.audioEmbedUrl);
          }
          const tutorId = typeof this.material.tutorId === 'object' ? this.material.tutorId._id : this.material.tutorId;
          this.isTutorOwner = this.currentUser?.id === tutorId || this.currentUser?._id === tutorId;
          this.channelInfo = this.resolveChannelInfo();
          this.selectedAnswers = new Array(this.material.quiz?.length || 0).fill(null);
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'Failed to load material';
      }
    });
  }

  private resolveChannelInfo(): { name: string; avatar: string | null; url: string; subs?: string } | null {
    if (!this.material?.tutorId || typeof this.material.tutorId === 'string') return null;
    const ch = (this.material.tutorId as any).linkedChannels;
    if (!ch) return null;

    if (this.material.materialType === 'video_quiz') {
      if (ch.youtubeChannelName && ch.youtubeChannelUrl) {
        return { name: ch.youtubeChannelName, avatar: ch.youtubeChannelAvatar, url: ch.youtubeChannelUrl, subs: ch.youtubeSubscriberCount };
      }
      if (ch.vimeoChannelName && ch.vimeoChannelUrl) {
        return { name: ch.vimeoChannelName, avatar: ch.vimeoChannelAvatar, url: ch.vimeoChannelUrl };
      }
    }
    if (this.material.materialType === 'listening') {
      if (ch.soundcloudProfileName && ch.soundcloudProfileUrl) {
        return { name: ch.soundcloudProfileName, avatar: ch.soundcloudProfileAvatar, url: ch.soundcloudProfileUrl };
      }
    }
    return null;
  }

  goBack() {
    this.location.back();
  }

  goHome() {
    this.router.navigate(['/tabs/home']);
  }

  private async promptLogin() {
    const materialUrl = this.router.url;
    localStorage.setItem('returnUrl', materialUrl);

    const alert = await this.alertCtrl.create({
      header: 'Log in to continue',
      message: 'Create a free account or log in to access this material.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Log In',
          handler: () => {
            this.router.navigate(['/login']);
          }
        }
      ]
    });
    await alert.present();
  }

  get tutorName(): string {
    if (!this.material?.tutorId) return 'Tutor';
    const t = this.material.tutorId;
    if (typeof t === 'string') return 'Tutor';
    return t.firstName || t.name || 'Tutor';
  }

  get tutorPicture(): string | null {
    if (!this.material?.tutorId || typeof this.material.tutorId === 'string') return null;
    return this.material.tutorId.picture || null;
  }

  get levelLabel(): string {
    const map: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', any: 'All Levels' };
    return map[this.material?.level || 'any'] || 'All Levels';
  }

  get addedDate(): string {
    if (!this.material?.createdAt) return '';
    const d = new Date(this.material.createdAt);
    return 'Added ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  get typeLabel(): string {
    switch (this.material?.materialType) {
      case 'video_quiz': return 'Video Quiz';
      case 'reading': return 'Reading Comprehension';
      case 'listening': return 'Listening Exercise';
      default: return 'Video Quiz';
    }
  }

  // ── Quiz flow ──────────────────────────────────────────

  isCheckingMedia = false;
  leftHidden = false;
  rightHidden = false;

  togglePanel(panel: 'left' | 'right') {
    if (panel === 'left') {
      this.leftHidden = !this.leftHidden;
      if (this.leftHidden && this.rightHidden) this.rightHidden = false;
    } else {
      this.rightHidden = !this.rightHidden;
      if (this.rightHidden && this.leftHidden) this.leftHidden = false;
    }

    

  }

  async startQuiz() {
    if (!this.isAuthenticated) {
      await this.promptLogin();
      return;
    }
    if (this.material?.quizLocked) {
      this.showToast('Purchase access to take this quiz');
      return;
    }

    if (this.material?.materialType === 'video_quiz' && this.material?.pricingType === 'paid') {
      this.isCheckingMedia = true;
      this.cdr.detectChanges();
      try {
        const check = await new Promise<{ available: boolean }>((resolve, reject) => {
          this.materialService.checkMediaAvailability(this.material!._id).subscribe({
            next: (res) => resolve(res),
            error: () => resolve({ available: true })
          });
        });

        this.isCheckingMedia = false;
        if (!check.available) {
          const alert = await this.alertCtrl.create({
            header: 'Video Unavailable',
            message: 'The video for this material has been removed by the tutor. We\'ve been notified and will process a refund if you purchased this quiz.',
            buttons: [
              { text: 'OK', role: 'cancel' },
              {
                text: 'Report Problem',
                handler: () => { this.reportProblem(); }
              }
            ]
          });
          await alert.present();
          return;
        }
      } catch {
        this.isCheckingMedia = false;
      }
    }

    this.quizMode = 'taking';
    this.currentQuestionIndex = 0;
    this.selectedAnswers = new Array(this.material?.quiz?.length || 0).fill(null);
    this.quizResult = null;
  }

  selectAnswer(optionId: string) {
    this.selectedAnswers[this.currentQuestionIndex] = optionId;
  }

  nextQuestion() {
    if (this.currentQuestionIndex < (this.material?.quiz?.length || 0) - 1) {
      this.currentQuestionIndex++;
    }
  }

  prevQuestion() {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
    }
  }

  get canSubmitQuiz(): boolean {
    return this.selectedAnswers.every(a => a !== null);
  }

  get currentQuestion(): any {
    return this.material?.quiz?.[this.currentQuestionIndex] || null;
  }

  get answeredCount(): number {
    return this.selectedAnswers.filter(a => a !== null).length;
  }

  submitQuiz() {
    if (!this.material || this.isSubmittingQuiz) return;
    this.isSubmittingQuiz = true;

    const answers = this.selectedAnswers.map(a => a || '');
    this.materialService.submitQuiz(this.material._id, answers).subscribe({
      next: (res) => {
        this.isSubmittingQuiz = false;
        if (res.success) {
          this.quizResult = res;
          this.quizMode = 'results';
        }
      },
      error: async (err) => {
        this.isSubmittingQuiz = false;
        await this.showToast(err?.error?.message || 'Failed to submit quiz');
      }
    });
  }

  async purchaseQuiz() {
    if (!this.isAuthenticated) {
      await this.promptLogin();
      return;
    }
    if (!this.material || this.isPurchasing) return;

    const modal = await this.modalCtrl.create({
      component: CardManagementModalComponent,
      cssClass: 'card-management-modal',
      componentProps: {
        purchaseMode: true,
        purchaseAmount: this.material.price,
        purchaseTitle: this.material.title
      }
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (!data?.confirmed || !data?.selectedCard?.stripePaymentMethodId) return;

    this.isPurchasing = true;
    this.materialService.purchaseMaterial(this.material._id, data.selectedCard.stripePaymentMethodId).subscribe({
      next: async (res) => {
        this.isPurchasing = false;
        if (res.success) {
          await this.showToast('Purchase successful! You can now take the quiz.');
          this.loadMaterial(this.material!._id);
        }
      },
      error: async (err) => {
        this.isPurchasing = false;
        await this.showToast(err?.error?.message || 'Purchase failed');
      }
    });
  }

  retakeQuiz() {
    this.quizMode = 'idle';
    this.quizResult = null;
    this.selectedAnswers = new Array(this.material?.quiz?.length || 0).fill(null);
    this.currentQuestionIndex = 0;
  }

  async reportProblem() {
    if (!this.isAuthenticated) {
      await this.promptLogin();
      return;
    }
    if (!this.material) return;

    const alert = await this.alertCtrl.create({
      header: 'Report a Problem',
      message: 'Let us know what\'s wrong with this material.',
      inputs: [
        { name: 'reason', type: 'radio', label: 'Media unavailable', value: 'video_unavailable', checked: true },
        { name: 'reason', type: 'radio', label: 'Missing content', value: 'content_missing' },
        { name: 'reason', type: 'radio', label: 'Incorrect content', value: 'incorrect_content' },
        { name: 'reason', type: 'radio', label: 'Copyright issue', value: 'copyright_infringement' },
        { name: 'reason', type: 'radio', label: 'Other', value: 'other' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          handler: async (reason) => {
            if (reason === 'copyright_infringement') {
              await this.showCopyrightForm(reason);
            } else {
              const detailAlert = await this.alertCtrl.create({
                header: 'Additional Details',
                message: 'Briefly describe the issue (optional).',
                inputs: [
                  { name: 'details', type: 'textarea', placeholder: 'Describe what happened...' }
                ],
                buttons: [
                  { text: 'Cancel', role: 'cancel' },
                  {
                    text: 'Submit Report',
                    handler: (data) => {
                      this.submitReport(reason, data.details || '');
                    }
                  }
                ]
              });
              await detailAlert.present();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  private async showCopyrightForm(reason: string) {
    const copyrightAlert = await this.alertCtrl.create({
      header: 'Copyright Claim',
      message: 'Provide details about the original content and the rights holder.',
      inputs: [
        { name: 'originalContentUrl', type: 'url', placeholder: 'Link to the original content' },
        { name: 'ownerName', type: 'text', placeholder: 'Rights holder name' },
        { name: 'ownerContact', type: 'email', placeholder: 'Rights holder email' },
        { name: 'details', type: 'textarea', placeholder: 'Describe the infringement...' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Submit Claim',
          handler: (data) => {
            this.submitReport(reason, data.details || '', {
              originalContentUrl: data.originalContentUrl || '',
              ownerName: data.ownerName || '',
              ownerContact: data.ownerContact || ''
            });
          }
        }
      ]
    });
    await copyrightAlert.present();
  }

  private submitReport(reason: string, details: string, copyrightDetails?: any) {
    if (!this.material) return;
    this.materialService.reportMaterial(this.material._id, reason, details, copyrightDetails).subscribe({
      next: async () => {
        await this.showToast('Report submitted. Our team will review it.');
      },
      error: async (err) => {
        await this.showToast(err?.error?.message || 'Failed to submit report');
      }
    });
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'bottom' });
    await toast.present();
  }
}
