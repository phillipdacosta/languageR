import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ModalController, AlertController, NavController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { trigger, transition, style, animate, state } from '@angular/animations';
import { MaterialService, TutorMaterial, QuizResult, QuestionType } from '../services/material.service';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { SharedModule } from '../shared/shared.module';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';
import { take } from 'rxjs';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-material-detail',
  templateUrl: './material-detail.page.html',
  styleUrls: ['./material-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, SharedModule],
  animations: [
    trigger('collapseLeft', [
      state('visible', style({ opacity: 1, transform: 'translate3d(0,0,0)' })),
      state('hidden', style({ opacity: 0, transform: 'translate3d(-30px,0,0)' })),
      transition('visible => hidden', [
        animate('280ms cubic-bezier(0.32, 0.72, 0, 1)')
      ]),
      transition('hidden => visible', [
        animate('350ms cubic-bezier(0.32, 0.72, 0, 1)')
      ])
    ])
  ]
})
export class MaterialDetailPage implements OnInit, OnDestroy {
  material: TutorMaterial | null = null;
  isLoading = true;
  pageReady = false;
  error: string | null = null;

  videoEmbedUrl: SafeResourceUrl | null = null;
  videoAutoplayUrl: SafeResourceUrl | null = null;
  audioEmbedUrl: SafeResourceUrl | null = null;
  currentUser: any = null;
  isTutorOwner = false;
  channelInfo: { name: string; avatar: string | null; url: string; subs?: string } | null = null;
  /** First 2 letters of channel name for avatar fallback (YouTube-style). */
  channelInitials = '';

  // Quiz state
  quizMode: 'idle' | 'taking' | 'results' = 'idle';
  selectedAnswers: any[] = [];
  currentQuestionIndex = 0;
  quizResult: QuizResult | null = null;
  isSubmittingQuiz = false;
  isPurchasing = false;

  // Ordering question state: shuffled items for each ordering question
  orderingItems: string[][] = [];

  // Fill-in-the-blank text input binding
  fillBlankInput = '';

  isAuthenticated = false;
  /** True when the right sidebar (quiz panel) is shown, so we hide duplicate info on the left. */
  hasQuizSidebar = false;
  /** True when the left column is collapsed. */
  leftPanelHidden = false;
  private referrerUrl: string = '/tabs/home';

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
    private cdr: ChangeDetectorRef,
    private navCtrl: NavController
  ) {
    this.referrerUrl = sessionStorage.getItem('materialReferrer') || '/tabs/home';
  }

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

  ionViewWillEnter() {
    this.referrerUrl = sessionStorage.getItem('materialReferrer') || '/tabs/home';
    this.videoCoverVisible = true;
    this.pageReady = false;
  }

  loadMaterial(id: string, ref?: string) {
    this.isLoading = true;
    this.materialService.getMaterial(id, ref).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success && res.material) {
          this.material = res.material;
          this.hasQuizSidebar = !!(this.material.quiz && this.material.quiz.length > 0);
          if (this.material.videoEmbedUrl) {
            let url = this.material.videoEmbedUrl;
            const ytMatch = url.match(/(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{11})/);
            if (Capacitor.isNativePlatform() && ytMatch) {
              url = `${environment.backendUrl}/api/materials/embed/youtube/${ytMatch[1]}`;
            } else {
              url = url.replace('https://www.youtube.com/embed/', 'https://www.youtube-nocookie.com/embed/');
              const sep = url.includes('?') ? '&' : '?';
              url += sep + 'playsinline=1';
            }
            this.videoEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
          }
          if (this.material.audioEmbedUrl) {
            this.audioEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.material.audioEmbedUrl);
          }
          const tutorId = typeof this.material.tutorId === 'object' ? this.material.tutorId._id : this.material.tutorId;
          this.isTutorOwner = this.currentUser?.id === tutorId || this.currentUser?._id === tutorId;
          this.channelInfo = this.resolveChannelInfo();
          this.channelInitials = this.channelInfo && !this.channelInfo.avatar
            ? (this.channelInfo.name || '').slice(0, 2).toUpperCase()
            : '';
          this.selectedAnswers = new Array(this.material.quiz?.length || 0).fill(null);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.pageReady = true;
              this.cdr.detectChanges();
            });
          });
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
    const isTabRoute = this.referrerUrl.startsWith('/tabs/');
    this.navCtrl.navigateBack(this.referrerUrl, { animated: !isTabRoute });
  }

  ngOnDestroy() {
    this.destroyEmbeds();
  }

  private destroyEmbeds() {
    this.videoEmbedUrl = null;
    this.videoAutoplayUrl = null;
    this.audioEmbedUrl = null;
  }

  toggleLeftPanel() {
    this.leftPanelHidden = !this.leftPanelHidden;
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

  get tutorId(): string | null {
    if (!this.material?.tutorId) return null;
    const t = this.material.tutorId;
    return typeof t === 'object' && t._id ? t._id : typeof t === 'string' ? t : null;
  }

  get tutorName(): string {
    if (!this.material?.tutorId) return 'Tutor';
    const t = this.material.tutorId;
    if (typeof t === 'string') return 'Tutor';
    const first = (t.firstName || '').trim();
    const last = (t.lastName || '').trim();
    if (first && last) return `${first} ${last.charAt(0).toUpperCase()}.`;
    if (first) return first;
    return t.name || 'Tutor';
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

  goToTutorProfile(): void {
    const id = this.tutorId;
    if (id) this.router.navigate(['/tutor', id]);
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
  videoCoverVisible = true;
  leftHidden = false;
  rightHidden = false;

  playVideo() {
    this.videoCoverVisible = false;
  }

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

    const confirm = await this.alertCtrl.create({
      header: 'Ready to start?',
      message: `This quiz has ${this.material?.quiz?.length || 0} question${(this.material?.quiz?.length || 0) !== 1 ? 's' : ''}. You can review the content while answering. Good luck!`,
      cssClass: 'md-quiz-confirm-alert',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Start Quiz', cssClass: 'alert-button-confirm', handler: () => true }
      ]
    });
    await confirm.present();
    const { role } = await confirm.onDidDismiss();
    if (role === 'cancel' || role === 'backdrop') return;

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
    this.fillBlankInput = '';
    this.quizResult = null;

    this.initOrderingState();
    this.syncFillBlankInput();
  }

  async exitQuiz() {
    if (this.quizMode === 'taking') {
      const alert = await this.alertCtrl.create({
        header: 'Exit quiz?',
        message: 'Your progress will be lost.',
        buttons: [
          { text: 'Continue Quiz', role: 'cancel' },
          {
            text: 'Exit',
            role: 'destructive',
            handler: () => {
              this.quizMode = 'idle';
              this.quizResult = null;
              this.selectedAnswers = [];
              this.currentQuestionIndex = 0;
              this.fillBlankInput = '';
              this.cdr.detectChanges();
            }
          }
        ]
      });
      await alert.present();
    } else {
      this.retakeQuiz();
    }
  }

  private initOrderingState() {
    if (!this.material?.quiz) return;
    this.orderingItems = [];

    for (let qi = 0; qi < this.material.quiz.length; qi++) {
      const q = this.material.quiz[qi];
      if ((q.type || 'multiple_choice') === 'ordering' && q.correctOrder?.length) {
        const shuffled = [...q.correctOrder];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        this.orderingItems.push(shuffled);
        this.selectedAnswers[qi] = [...shuffled];
      } else {
        this.orderingItems.push([]);
      }
    }
  }

  private syncFillBlankInput() {
    const q = this.currentQuestion;
    if (!q) return;
    if ((q.type || 'multiple_choice') === 'fill_blank') {
      this.fillBlankInput = this.selectedAnswers[this.currentQuestionIndex] || '';
    }
  }

  selectAnswer(optionId: string) {
    this.selectedAnswers[this.currentQuestionIndex] = optionId;
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }

  selectTrueFalse(val: boolean) {
    this.selectedAnswers[this.currentQuestionIndex] = val;
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }

  onFillBlankChange(text: string) {
    this.fillBlankInput = text;
    this.selectedAnswers[this.currentQuestionIndex] = text.trim() || null;
  }

  onOrderingReorder(event: any) {
    const qi = this.currentQuestionIndex;
    const items = this.orderingItems[qi];
    const movedItem = items.splice(event.detail.from, 1)[0];
    items.splice(event.detail.to, 0, movedItem);
    this.orderingItems[qi] = [...items];
    this.selectedAnswers[qi] = [...items];
    event.detail.complete(false);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }

  get currentQuestionType(): QuestionType {
    return this.currentQuestion?.type || 'multiple_choice';
  }

  nextQuestion() {
    if (this.currentQuestionIndex < (this.material?.quiz?.length || 0) - 1) {
      this.currentQuestionIndex++;
      this.syncFillBlankInput();
    }
  }

  prevQuestion() {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
      this.syncFillBlankInput();
    }
  }

  get canSubmitQuiz(): boolean {
    return this.selectedAnswers.every(a => a !== null && a !== '');
  }

  get currentQuestion(): any {
    return this.material?.quiz?.[this.currentQuestionIndex] || null;
  }

  get isLastQuizQuestion(): boolean {
    if (!this.material?.quiz?.length) return false;
    return this.currentQuestionIndex === this.material.quiz.length - 1;
  }

  get answeredCount(): number {
    return this.selectedAnswers.filter(a => a !== null && a !== '').length;
  }

  async confirmSubmit() {
    if (!this.material) return;
    const total = this.material.quiz?.length || 0;
    const answered = this.answeredCount;
    const unanswered = total - answered;

    let header = 'Submit Quiz?';
    let message = 'You\'ve answered all questions. Ready to see your results?';

    if (unanswered > 0) {
      header = 'Incomplete Quiz';
      message = `You have ${unanswered} of ${total} question${unanswered !== 1 ? 's' : ''} unanswered. Submit anyway?`;
    }

    const alert = await this.alertCtrl.create({
      header,
      message,
      cssClass: 'md-quiz-confirm-alert',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Submit', cssClass: 'alert-button-confirm', handler: () => true }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'cancel' || role === 'backdrop') return;

    this.submitQuiz();
  }

  displayScore = 0;
  rankPercentile = 0;

  submitQuiz() {
    if (!this.material || this.isSubmittingQuiz) return;
    this.isSubmittingQuiz = true;
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});

    const answers = this.selectedAnswers.map((a, i) => {
      const qType = this.material!.quiz[i]?.type || 'multiple_choice';
      if (qType === 'multiple_choice') return a || '';
      if (qType === 'fill_blank') return a || '';
      if (qType === 'true_false') return a;
      if (qType === 'ordering') return a || [];
      return a;
    });

    this.materialService.submitQuiz(this.material._id, answers).subscribe({
      next: (res) => {
        this.isSubmittingQuiz = false;
        if (res.success) {
          this.quizResult = res;
          this.quizMode = 'results';
          this.animateScore(res.score);
          this.computeRank(res.score, res.averageScore);
        }
      },
      error: async (err) => {
        this.isSubmittingQuiz = false;
        await this.showToast(err?.error?.message || 'Failed to submit quiz');
      }
    });
  }

  private animateScore(target: number) {
    this.displayScore = 0;
    const duration = 1200;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.displayScore = Math.round(eased * target);
      this.cdr.detectChanges();
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private computeRank(score: number, avgScore?: number) {
    if (avgScore == null || avgScore === 0) {
      this.rankPercentile = score >= 50 ? 75 : 40;
      return;
    }
    const raw = 50 + (score - avgScore);
    this.rankPercentile = Math.max(1, Math.min(99, Math.round(raw)));
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
    this.fillBlankInput = '';
    this.initOrderingState();
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
