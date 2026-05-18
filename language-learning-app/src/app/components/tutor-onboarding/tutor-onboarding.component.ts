import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, AlertController, ToastController, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { SharedModule } from '../../shared/shared.module';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PayoutSelectionModalComponent } from '../payout-selection-modal/payout-selection-modal.component';
import { FileUploadService } from '../../services/file-upload.service';
import { ImageCropperComponent } from '../image-cropper/image-cropper.component';
import { isStripeSupportedCountry } from '../../data/stripe-supported-countries';

type ApprovalStepId = 'photo' | 'video' | 'stripe' | 'identity' | 'qualifications' | 'tos';

interface OnboardingStep {
  id: ApprovalStepId;
  titleKey: string;
  descriptionKey: string;
  completed: boolean;
  icon: string;
  action?: string;
  /**
   * Steps can be hidden dynamically — currently used to skip the manual
   * `identity` step when Stripe has already KYC'd the tutor. Hidden steps are
   * excluded from progress, the step indicator, prev/next navigation, and the
   * "all complete" check.
   */
  visible: boolean;
}

@Component({
  selector: 'app-tutor-onboarding',
  templateUrl: './tutor-onboarding.component.html',
  styleUrls: ['./tutor-onboarding.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, SharedModule]
})
export class TutorOnboardingComponent implements OnInit {
  /** When true, close/skip dismiss a parent modal instead of routing home. */
  @Input() presentAsModal = false;
  /** After first load, jump to this wizard step id (e.g. photo, credentials, stripe). */
  @Input() initialApprovalStepId: string | null = null;
  @Output() dismissed = new EventEmitter<void>();

  currentUser: any = null;
  currentStepIndex = 0;
  loading = true;

  /** Cached step surface for templates (no getters / method calls in HTML). */
  approvalStepId = 'photo';
  approvalStepIcon = 'person-circle';
  approvalStepTitleKey = '';
  approvalStepDescriptionKey = '';
  approvalStepCompleted = false;
  approvalWizardProgressPercent = 0;
  /** Params for `ONBOARDING.STEP_INDICATOR` (matches student / tutor onboarding wizard). */
  approvalStepIndicatorI18nParams: { current: number; total: number } = { current: 1, total: 1 };

  /** Top bar + footer (avoid getters in template). */
  approvalWizardIsFirstStep = true;
  approvalWizardIsLastStep = false;
  approvalWizardAllStepsComplete = false;
  approvalWizardTopBackVisible = false;
  approvalWizardPreviousStepTitleKey = '';
  /** Widen shell + panel (photo, video, payout, credentials) to use modal width. */
  approvalWizardWideContentLayout = false;
  
  // Subscribe to approval status from UserService
  approvalStatus$ = this.userService.tutorApprovalStatus$;
  approvalStatus: any = null;

  /**
   * Wizard order — payout BEFORE identity so we can hide the manual gov-ID
   * step when Stripe Connect has already KYC'd the tutor.
   *
   * 1. photo            – profile picture
   * 2. video            – introduction video
   * 3. stripe           – payout setup (Stripe Connect or PayPal)
   * 4. identity         – manual government-ID upload (skipped when Stripe-verified)
   * 5. qualifications   – teaching certifications + optional documents
   * 6. tos              – terms of service
   */
  steps: OnboardingStep[] = [
    {
      id: 'photo',
      titleKey: 'TUTOR_APPROVAL.STEP_PHOTO_TITLE',
      descriptionKey: 'TUTOR_APPROVAL.STEP_PHOTO_DESC',
      completed: false,
      icon: 'person-circle',
      action: 'upload-photo',
      visible: true
    },
    {
      id: 'video',
      titleKey: 'TUTOR_APPROVAL.STEP_VIDEO_TITLE',
      descriptionKey: 'TUTOR_APPROVAL.STEP_VIDEO_DESC',
      completed: false,
      icon: 'videocam',
      action: 'upload-video',
      visible: true
    },
    {
      id: 'stripe',
      titleKey: 'TUTOR_APPROVAL.STEP_PAYMENT_TITLE',
      descriptionKey: 'TUTOR_APPROVAL.STEP_PAYMENT_DESC',
      completed: false,
      icon: 'card',
      action: 'stripe-onboard',
      visible: true
    },
    {
      id: 'identity',
      titleKey: 'TUTOR_APPROVAL.STEP_IDENTITY_TITLE',
      descriptionKey: 'TUTOR_APPROVAL.STEP_IDENTITY_DESC',
      completed: false,
      icon: 'id-card',
      action: 'upload-identity',
      visible: true
    },
    {
      id: 'qualifications',
      titleKey: 'TUTOR_APPROVAL.STEP_QUALIFICATIONS_TITLE',
      descriptionKey: 'TUTOR_APPROVAL.STEP_QUALIFICATIONS_DESC',
      completed: false,
      icon: 'ribbon',
      action: 'upload-qualifications',
      visible: true
    },
    {
      id: 'tos',
      titleKey: 'TUTOR_APPROVAL.STEP_TOS_TITLE',
      descriptionKey: 'TUTOR_APPROVAL.STEP_TOS_DESC',
      completed: false,
      icon: 'document-text',
      action: 'accept-tos',
      visible: true
    }
  ];

  /** Computed: only the steps that should appear in nav, progress, indicator. */
  visibleSteps: OnboardingStep[] = [];

  /** Convenience flags for the template (avoid steps[N] by index in HTML). */
  photoStepCompleted = false;
  videoStepCompleted = false;
  payoutStepCompleted = false;
  identityStepCompleted = false;
  identityStepVisible = true;
  qualificationsStepCompleted = false;
  tosStepCompleted = false;

  // Credential upload state
  uploadedCertifications: any[] = [];
  uploadedAdditionalDocs: any[] = [];
  governmentIdStatus: string = 'not_uploaded';
  governmentIdStatusLabelKey = 'TUTOR_APPROVAL.GOV_ID_STATUS_NOT_UPLOADED';
  certificationNameInput: string = '';
  isUploadingCredential: boolean = false;

  // Video player modal
  isVideoPlayerModalOpen = false;
  isVideoPlaying = false;
  videoPlayerData: { videoUrl: string; safeVideoUrl: any; videoType: string } | null = null;

  // Payment setup flow state
  paymentSetupStep: 'tax-status' | 'bank-account' | 'setup-method' = 'tax-status';
  isUSPersonForTax: boolean | null = null;
  hasUSBankAccount: boolean | null = null;
  determinedPayoutMethod: 'stripe' | 'paypal' | null = null;
  paypalEmail = '';
  paypalEmailError = '';
  /** When true, completed PayPal screen shows the edit form instead of the success card. */
  editingPayoutEmail = false;
  /** True when payout routing is driven by `residenceCountry` (post-onboarding). */
  isCountryDrivenPayoutRouting = false;
  /** Plain-English explanation of why a payout method was chosen ("Spain → Stripe Connect"). */
  payoutMethodReasonKey = '';
  payoutMethodReasonParams: Record<string, string> = {};

  // TOS state
  tosChecked = false;
  tosAcceptedAt: Date | null = null;
  isAcceptingTos = false;

  constructor(
    private userService: UserService,
    private router: Router,
    private http: HttpClient,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController,
    private sanitizer: DomSanitizer,
    private modalController: ModalController,
    private fileUploadService: FileUploadService,
    private readonly elRef: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    // Initialize the visible-step cache so the wizard renders cleanly before
    // the first status emission lands.
    this.recomputeVisibleSteps();

    // Subscribe to approval status from service
    this.approvalStatus$.subscribe(status => {
      if (status) {
        this.approvalStatus = status;
        this.updateStepsFromStatus(status);
      }
    });

    // Subscribe to user data changes (e.g. from WebSocket-triggered refreshes)
    // This keeps credential lists in sync when admin approves/rejects
    this.userService.currentUser$.subscribe(user => {
      if (user && this.currentUser) {
        this.currentUser = user;
        const creds = user.tutorCredentials;
        this.uploadedCertifications = creds?.teachingCertifications || [];
        this.uploadedAdditionalDocs = creds?.additionalDocuments || [];
      }
    });
    
    const shouldAutoAdvance = !this.initialApprovalStepId;
    await this.loadOnboardingStatus(shouldAutoAdvance);
    if (this.initialApprovalStepId) {
      this.seekToApprovalStepById(this.initialApprovalStepId);
    }
  }

  /**
   * Jump wizard to a step by id. Accepts legacy aliases:
   *   - 'credentials' → 'identity'  (split: identity first, then qualifications)
   *   - 'payout'      → 'stripe'
   * If the resolved step is hidden, falls through to the next visible step.
   */
  private seekToApprovalStepById(stepId: string): void {
    const aliasMap: Record<string, ApprovalStepId> = {
      credentials: 'identity',
      payout: 'stripe'
    };
    const target = (aliasMap[stepId] ?? stepId) as ApprovalStepId;
    let idx = this.steps.findIndex(s => s.id === target && s.visible);
    if (idx < 0) {
      // Target hidden — jump to the next visible step after the requested one,
      // or the first visible step as a last resort.
      const declaredIdx = this.steps.findIndex(s => s.id === target);
      idx = declaredIdx >= 0
        ? this.steps.findIndex((s, i) => i > declaredIdx && s.visible)
        : -1;
      if (idx < 0) {
        idx = this.steps.findIndex(s => s.visible);
      }
    }
    if (idx >= 0) {
      this.currentStepIndex = idx;
      this.syncApprovalWizardDisplay();
    }
  }

  private exitModalOrNavigateHome(): void {
    if (this.presentAsModal) {
      this.dismissed.emit();
      return;
    }
    this.router.navigate(['/tabs/home']);
  }

  // Ionic lifecycle hook - refresh data when page becomes active
  ionViewWillEnter() {
    if (this.presentAsModal) {
      return;
    }
    console.log('🔄 [TUTOR-APPROVAL] ionViewWillEnter - refreshing onboarding status');
    this.loadOnboardingStatus();
  }

  /** Look up a step by id (only across all steps, not just visible). */
  private getStep(id: ApprovalStepId): OnboardingStep | undefined {
    return this.steps.find(s => s.id === id);
  }

  /** Re-derive `visibleSteps` and convenience flags from raw `steps`. */
  private recomputeVisibleSteps(): void {
    this.visibleSteps = this.steps.filter(s => s.visible);
    this.photoStepCompleted = !!this.getStep('photo')?.completed;
    this.videoStepCompleted = !!this.getStep('video')?.completed;
    this.payoutStepCompleted = !!this.getStep('stripe')?.completed;
    const identity = this.getStep('identity');
    this.identityStepCompleted = !!identity?.completed;
    this.identityStepVisible = !!identity?.visible;
    this.qualificationsStepCompleted = !!this.getStep('qualifications')?.completed;
    this.tosStepCompleted = !!this.getStep('tos')?.completed;
  }

  private updateStepsFromStatus(status: any) {
    // The manual gov-ID step is hidden whenever the tutor is on a healthy
    // Stripe path (country supported + account not disabled) OR Stripe has
    // already verified them. UserService computes this for us as
    // `status.identityRequired` so frontend + backend agree.
    const stripeIdentityVerified = status.stripeIdentityVerified === true;
    const identitySatisfied = status.identitySatisfied === true;
    const identityRequired = status.identityRequired === true;

    const photo = this.getStep('photo');
    if (photo) photo.completed = status.photoComplete;

    const video = this.getStep('video');
    if (video) video.completed = status.videoApproved;

    const stripe = this.getStep('stripe');
    if (stripe) stripe.completed = status.stripeComplete;

    const identity = this.getStep('identity');
    if (identity) {
      // When the step is hidden, mark it complete so it doesn't drag down the
      // "all steps complete" check or the credentials-approved gate.
      identity.completed = identitySatisfied || !identityRequired;
      identity.visible = identityRequired;
    }

    const qualifications = this.getStep('qualifications');
    if (qualifications) qualifications.completed = !!status.certificationsApproved;

    const tos = this.getStep('tos');
    if (tos) tos.completed = !!status.tosComplete;

    this.recomputeVisibleSteps();

    // If the current step just became hidden (e.g. Stripe verified mid-flow),
    // slide forward to the next visible step so the wizard never strands the
    // user on an invisible step.
    const currentStep = this.steps[this.currentStepIndex];
    if (currentStep && !currentStep.visible) {
      const nextIdx = this.steps.findIndex(
        (s, i) => i > this.currentStepIndex && s.visible
      );
      this.currentStepIndex = nextIdx >= 0 ? nextIdx : Math.max(0, this.steps.findIndex(s => s.visible));
    }

    this.syncApprovalWizardDisplay();

    // Update credential display state
    this.governmentIdStatus = status.governmentIdApproved ? 'approved'
      : status.governmentIdRejected ? 'rejected'
      : status.governmentIdUploaded ? 'pending'
      : 'not_uploaded';
    this.governmentIdStatusLabelKey =
      this.governmentIdStatus === 'approved'
        ? 'TUTOR_APPROVAL.GOV_ID_STATUS_APPROVED'
        : this.governmentIdStatus === 'rejected'
          ? 'TUTOR_APPROVAL.GOV_ID_STATUS_REJECTED'
          : this.governmentIdStatus === 'pending'
            ? 'TUTOR_APPROVAL.GOV_ID_STATUS_PENDING'
            : 'TUTOR_APPROVAL.GOV_ID_STATUS_NOT_UPLOADED';

    console.log('📊 [TUTOR-APPROVAL] Updated steps from status:', {
      photo: status.photoComplete,
      video: status.videoApproved,
      stripe: status.stripeComplete,
      identityVisible: identity?.visible,
      identityCompleted: identity?.completed,
      identityRequired,
      qualifications: status.certificationsApproved,
      tos: status.tosComplete,
      stripeIdentityVerified
    });
  }

  async loadOnboardingStatus(autoAdvanceStep = true) {
    this.loading = true;
    try {
      // Force refresh from server, not cache
      const user = await firstValueFrom(this.userService.getCurrentUser(true));
      this.currentUser = user;

      console.log('📹 [TUTOR-APPROVAL] Full onboardingData:', user.onboardingData);
      console.log('📹 [TUTOR-APPROVAL] tutorOnboarding:', user.tutorOnboarding);
      console.log('💰 [TUTOR-APPROVAL] payoutProvider:', user.payoutProvider);
      console.log('💰 [TUTOR-APPROVAL] payoutDetails:', user.payoutDetails);
      
      // For display purposes, use pendingVideo if available (new tutor), otherwise use approved video
      const videoUrl = user.onboardingData?.pendingVideo || user.onboardingData?.introductionVideo || '';
      const thumbnailUrl = user.onboardingData?.pendingVideoThumbnail || user.onboardingData?.videoThumbnail || '';
      
      console.log('📹 [TUTOR-APPROVAL] Video URL (pending or approved):', videoUrl);
      console.log('📹 [TUTOR-APPROVAL] Thumbnail URL:', thumbnailUrl);
      console.log('🖼️ [CUSTOM-THUMBNAIL-CHECK] videoThumbnail value:', thumbnailUrl);
      console.log('🖼️ [CUSTOM-THUMBNAIL-CHECK] Is GCS URL?', thumbnailUrl?.includes('storage.googleapis.com'));
      console.log('🖼️ [CUSTOM-THUMBNAIL-CHECK] Is Vimeo CDN?', thumbnailUrl?.includes('vimeocdn.com'));
      console.log('📹 [TUTOR-APPROVAL] Video approved:', user.tutorOnboarding?.videoApproved);
      console.log('📹 [TUTOR-APPROVAL] Video rejected:', user.tutorOnboarding?.videoRejected);

      // Load existing tax info (legacy fallback for users without residenceCountry)
      if (user.isUSPersonForTax !== null && user.isUSPersonForTax !== undefined) {
        this.isUSPersonForTax = user.isUSPersonForTax;
        console.log('📋 [TUTOR-APPROVAL] Loaded isUSPersonForTax:', this.isUSPersonForTax);
      }
      if (user.hasUSBankAccount !== null && user.hasUSBankAccount !== undefined) {
        this.hasUSBankAccount = user.hasUSBankAccount;
      }

      // Country-driven payout routing (primary path).
      // residenceCountry is collected during initial tutor onboarding, so almost
      // every tutor will hit this branch. We only fall back to the US-centric
      // tax/bank questions for legacy users who completed onboarding before the
      // residenceCountry field existed.
      const residence = (user.residenceCountry || '').trim();
      if (residence) {
        this.isCountryDrivenPayoutRouting = true;
        if (isStripeSupportedCountry(residence)) {
          this.determinedPayoutMethod = 'stripe';
          this.payoutMethodReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_STRIPE_COUNTRY';
        } else {
          this.determinedPayoutMethod = 'paypal';
          this.payoutMethodReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_PAYPAL_COUNTRY';
        }
        this.payoutMethodReasonParams = { country: residence };
        this.paymentSetupStep = 'setup-method';
        console.log(`💰 [TUTOR-APPROVAL] Country-driven routing: ${residence} → ${this.determinedPayoutMethod}`);
      } else if (this.isUSPersonForTax !== null) {
        this.isCountryDrivenPayoutRouting = false;
        // Legacy fallback: tax info answered but no residenceCountry stored
        if (this.isUSPersonForTax === false) {
          this.determinedPayoutMethod = 'paypal';
          this.paymentSetupStep = 'setup-method';
        } else if (this.hasUSBankAccount !== null) {
          this.determinedPayoutMethod = this.hasUSBankAccount ? 'stripe' : 'paypal';
          this.paymentSetupStep = 'setup-method';
        } else {
          this.paymentSetupStep = 'bank-account';
        }
      }

      // Load credential data
      const creds = user.tutorCredentials;
      this.uploadedCertifications = creds?.teachingCertifications || [];
      this.uploadedAdditionalDocs = creds?.additionalDocuments || [];
      
      console.log('📄 [TUTOR-APPROVAL] Credentials loaded:', {
        governmentId: creds?.governmentId?.status,
        certifications: this.uploadedCertifications.length,
        additionalDocs: this.uploadedAdditionalDocs.length
      });

      // Load TOS acceptance state
      if (user.tosAcceptedAt) {
        this.tosAcceptedAt = new Date(user.tosAcceptedAt);
        this.tosChecked = true;
      }

      // Update payout step title/description based on chosen provider
      const payoutStep = this.getStep('stripe');
      if (payoutStep) {
        if (user.payoutProvider === 'paypal') {
          payoutStep.titleKey = 'TUTOR_APPROVAL.STEP_PAYMENT_TITLE_PAYPAL';
          payoutStep.descriptionKey = 'TUTOR_APPROVAL.STEP_PAYMENT_DESC_PAYPAL';
        } else if (user.payoutProvider === 'manual') {
          payoutStep.titleKey = 'TUTOR_APPROVAL.STEP_PAYMENT_TITLE_MANUAL';
          payoutStep.descriptionKey = 'TUTOR_APPROVAL.STEP_PAYMENT_DESC_MANUAL';
        } else if (user.stripeConnectOnboarded) {
          payoutStep.titleKey = 'TUTOR_APPROVAL.STEP_PAYMENT_TITLE_STRIPE';
          payoutStep.descriptionKey = 'TUTOR_APPROVAL.STEP_PAYMENT_DESC_STRIPE';
        } else {
          payoutStep.titleKey = 'TUTOR_APPROVAL.STEP_PAYMENT_TITLE';
          payoutStep.descriptionKey = 'TUTOR_APPROVAL.STEP_PAYMENT_DESC';
        }
      }

      // Recompute visible-step cache so step indicator + nav reflect any new
      // visibility (e.g. Stripe-verified tutors don't see the identity step).
      this.recomputeVisibleSteps();

      // Auto-fetch Vimeo thumbnail if missing
      if (videoUrl && 
          !thumbnailUrl && 
          videoUrl.includes('vimeo.com')) {
        console.log('📹 [TUTOR-APPROVAL] Attempting to auto-fetch Vimeo thumbnail...');
        await this.fetchVimeoThumbnail(videoUrl);
      }

      // The UserService will automatically update tutorApprovalStatus$
      // which we're subscribed to in ngOnInit, so no need to manually set steps here

      // Only auto-advance to first incomplete VISIBLE step on initial load.
      // Don't change step when refreshing after an upload (user should stay on
      // their current step).
      if (autoAdvanceStep) {
        const firstIncompleteIdx = this.steps.findIndex(step => step.visible && !step.completed);
        if (firstIncompleteIdx >= 0) {
          this.currentStepIndex = firstIncompleteIdx;
        } else {
          // All visible steps complete → land on the last visible step.
          const lastVisibleIdx = (() => {
            for (let i = this.steps.length - 1; i >= 0; i--) {
              if (this.steps[i].visible) return i;
            }
            return 0;
          })();
          this.currentStepIndex = lastVisibleIdx;
        }
      }

      console.log('📋 [TUTOR-APPROVAL] Current step index:', this.currentStepIndex);

    } catch (error) {
      console.error('Error loading onboarding status:', error);
      this.showToast('Failed to load onboarding status', 'danger');
    } finally {
      this.loading = false;
      this.syncApprovalWizardDisplay();
    }
  }

  async fetchVimeoThumbnail(videoUrl: string) {
    try {
      // Extract Vimeo video ID from URL
      const videoId = videoUrl.split('/video/')[1]?.split('?')[0];
      if (!videoId) return;

      // Fetch thumbnail from Vimeo oEmbed API
      const response = await firstValueFrom(
        this.http.get<any>(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`)
      );

      if (response.thumbnail_url) {
        console.log('📹 [TUTOR-APPROVAL] Vimeo thumbnail fetched:', response.thumbnail_url);
        // Update the currentUser object so it displays immediately
        if (this.currentUser.onboardingData) {
          this.currentUser.onboardingData.videoThumbnail = response.thumbnail_url;
        }
      }
    } catch (error) {
      console.error('📹 [TUTOR-APPROVAL] Error fetching Vimeo thumbnail:', error);
    }
  }

  get currentStep(): OnboardingStep {
    return this.steps[this.currentStepIndex];
  }

  private syncApprovalWizardDisplay(): void {
    const s = this.steps[this.currentStepIndex];
    if (!s) {
      return;
    }
    this.approvalStepId = s.id;
    this.approvalWizardWideContentLayout =
      this.approvalStepId === 'photo' ||
      this.approvalStepId === 'video' ||
      this.approvalStepId === 'stripe' ||
      this.approvalStepId === 'identity' ||
      this.approvalStepId === 'qualifications';
    this.approvalStepIcon = s.icon;
    this.approvalStepTitleKey = s.titleKey;
    this.approvalStepDescriptionKey = s.descriptionKey;
    this.approvalStepCompleted = s.completed;

    // Step indicator + progress operate on VISIBLE steps so hiding the manual
    // identity step (Stripe-verified tutors) cleanly removes it from the
    // "Step 3 of 5" affordance.
    const visible = this.visibleSteps;
    const visibleIdx = visible.indexOf(s);
    const total = visible.length;
    this.approvalWizardProgressPercent = total > 0 && visibleIdx >= 0
      ? ((visibleIdx + 1) / total) * 100
      : 0;
    this.approvalStepIndicatorI18nParams = total > 0 && visibleIdx >= 0
      ? { current: visibleIdx + 1, total }
      : { current: 1, total: 1 };

    this.approvalWizardIsFirstStep = visibleIdx === 0;
    this.approvalWizardIsLastStep = total > 0 && visibleIdx >= total - 1;
    this.approvalWizardAllStepsComplete = visible.every(step => step.completed);
    this.approvalWizardTopBackVisible = visibleIdx > 0;
    const prevVisible = visibleIdx > 0 ? visible[visibleIdx - 1] : null;
    this.approvalWizardPreviousStepTitleKey = prevVisible?.titleKey ?? '';
  }

  get progressPercentage(): number {
    const total = this.visibleSteps.length;
    if (total === 0) return 0;
    const completed = this.visibleSteps.filter(step => step.completed).length;
    return (completed / total) * 100;
  }

  get completedStepsCount(): number {
    return this.visibleSteps.filter(step => step.completed).length;
  }

  /** Move to the previous VISIBLE step. */
  previousStep() {
    for (let i = this.currentStepIndex - 1; i >= 0; i--) {
      if (this.steps[i].visible) {
        this.currentStepIndex = i;
        this.syncApprovalWizardDisplay();
        return;
      }
    }
  }

  /** Move to the next VISIBLE step. */
  nextStep() {
    for (let i = this.currentStepIndex + 1; i < this.steps.length; i++) {
      if (this.steps[i].visible) {
        this.currentStepIndex = i;
        this.syncApprovalWizardDisplay();
        return;
      }
    }
  }

  // Payment setup flow methods
  setUSPersonStatus(isUSPerson: boolean) {
    this.isUSPersonForTax = isUSPerson;
  }

  setUSBankStatus(hasUSBank: boolean) {
    this.hasUSBankAccount = hasUSBank;
  }

  /** Legacy US-tax flow — only used when `residenceCountry` is not yet set. */
  nextPaymentStep() {
    if (this.paymentSetupStep === 'tax-status') {
      if (this.isUSPersonForTax === false) {
        // Non-US Person → PayPal
        this.determinedPayoutMethod = 'paypal';
        this.paymentSetupStep = 'setup-method';
      } else {
        // US Person → ask about bank account
        this.paymentSetupStep = 'bank-account';
      }
    } else if (this.paymentSetupStep === 'bank-account') {
      this.determinedPayoutMethod = this.hasUSBankAccount ? 'stripe' : 'paypal';
      this.paymentSetupStep = 'setup-method';
    }
  }

  previousPaymentStep() {
    if (this.paymentSetupStep === 'bank-account') {
      this.paymentSetupStep = 'tax-status';
    } else if (this.paymentSetupStep === 'setup-method') {
      // From the summary screen, the back button only matters for the legacy
      // tax-question flow. Country-driven users have no prior sub-step here.
      const residence = (this.currentUser?.residenceCountry || '').trim();
      if (residence) {
        return;
      }
      this.paymentSetupStep = this.isUSPersonForTax ? 'bank-account' : 'tax-status';
    }
  }


  editTaxInfo() {
    this.paymentSetupStep = 'tax-status';
    this.determinedPayoutMethod = null;
  }

  async startEditPayoutEmail() {
    const modal = await this.modalController.create({
      component: PayoutSelectionModalComponent,
      cssClass: 'payout-selection-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (!data) return;

    switch (data.provider) {
      case 'stripe':
        await this.setupStripeConnect(data.isUSPersonForTax, data.hasUSBankAccount);
        break;
      case 'paypal':
        await this.setupPayPal(data.paypalEmail, data.isUSPersonForTax, data.hasUSBankAccount);
        break;
      case 'manual':
        await this.setupManualPayout(data.isUSPersonForTax, data.hasUSBankAccount);
        break;
    }
  }

  cancelEditPayoutEmail() {
    this.editingPayoutEmail = false;
    this.paypalEmail = '';
    this.paypalEmailError = '';
  }

  validatePayPalEmail() {
    this.paypalEmailError = '';
    
    if (!this.paypalEmail.trim()) {
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.paypalEmail.trim())) {
      this.paypalEmailError = 'TUTOR_APPROVAL.ERR_PAYPAL_EMAIL_INVALID';
    }
  }

  canSetupPayment(): boolean {
    if (this.determinedPayoutMethod === 'paypal') {
      return this.paypalEmail.trim().length > 0 && !this.paypalEmailError;
    }
    return this.determinedPayoutMethod !== null;
  }

  async setupPaymentMethod() {
    if (!this.canSetupPayment()) {
      return;
    }

    if (this.determinedPayoutMethod === 'stripe') {
      await this.setupStripeConnect(this.isUSPersonForTax, this.hasUSBankAccount);
    } else if (this.determinedPayoutMethod === 'paypal') {
      await this.setupPayPal(this.paypalEmail, this.isUSPersonForTax, this.hasUSBankAccount);
    }
  }

  async handleStepAction() {
    const step = this.currentStep;

    switch (step.action) {
      case 'upload-photo':
        this.triggerPictureUpload();
        break;
      case 'upload-video':
        if (!this.presentAsModal) {
          this.router.navigate(['/tabs/profile'], { queryParams: { action: 'upload-video' } });
        }
        break;
      case 'stripe-onboard':
        await this.startStripeOnboarding();
        break;
      case 'accept-tos':
        await this.acceptTos();
        break;
    }
  }

  async acceptTos() {
    if (!this.tosChecked || this.isAcceptingTos) return;

    this.isAcceptingTos = true;
    const loading = await this.loadingController.create({
      message: 'Saving...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const result = await firstValueFrom(this.userService.acceptTos('1.0'));
      if (result?.success) {
        this.tosAcceptedAt = new Date(result.tosAcceptedAt);
        this.showToast('Terms accepted successfully!', 'success');
        await this.loadOnboardingStatus(false);
      } else {
        this.showToast('Failed to accept terms', 'danger');
      }
    } catch (error: any) {
      console.error('Error accepting TOS:', error);
      this.showToast(error.error?.message || 'Failed to accept terms', 'danger');
    } finally {
      this.isAcceptingTos = false;
      await loading.dismiss();
    }
  }

  /**
   * Trigger file picker for profile picture upload
   */
  triggerPictureUpload() {
    const fileInput = document.getElementById('tutor-onboarding-photo-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    } else {
      console.error('❌ File input element not found in DOM');
    }
  }

  /**
   * Handle profile picture file selection
   */
  async onPictureSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate image
    const validation = this.fileUploadService.validateImage(file);
    if (!validation.valid) {
      const alert = await this.alertController.create({
        header: 'Invalid Image',
        message: validation.error,
        buttons: ['OK']
      });
      await alert.present();
      // Reset file input
      event.target.value = '';
      return;
    }

    // Open cropper modal
    const modal = await this.modalController.create({
      component: ImageCropperComponent,
      componentProps: {
        imageChangedEvent: event
      },
      cssClass: 'image-cropper-modal'
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'crop' && data) {
      // Convert blob to file
      const croppedFile = new File([data], file.name, { type: 'image/png' });
      await this.uploadProfilePicture(croppedFile, event);
    } else {
      // Reset file input if cancelled
      event.target.value = '';
    }
  }

  /**
   * Upload profile picture to server
   */
  async uploadProfilePicture(file: File, event: any) {
    const loading = await this.loadingController.create({
      message: 'Uploading image...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Upload image using FileUploadService (handles headers correctly)
      const uploadResult = await firstValueFrom(this.fileUploadService.uploadImage(file));
      
      if (uploadResult?.success && uploadResult?.imageUrl) {
        // Update user picture in database
        const updateResult = await firstValueFrom(this.userService.updatePicture(uploadResult.imageUrl));
        
        if (updateResult?.success) {
          // Refresh onboarding status to update the photo step
          await this.loadOnboardingStatus();
          this.showToast('Profile photo uploaded successfully!', 'success');
        } else {
          this.showToast('Failed to update profile picture', 'danger');
        }
      } else {
        this.showToast('Failed to upload image', 'danger');
      }
    } catch (error: any) {
      console.error('Error uploading profile picture:', error);
      this.showToast(error.error?.message || 'Failed to upload photo', 'danger');
    } finally {
      await loading.dismiss();
      // Reset file input
      event.target.value = '';
    }
  }

  // ============================================================
  // CREDENTIAL UPLOAD METHODS
  // ============================================================

  triggerCredentialUpload(type: 'governmentId' | 'certification' | 'additionalDocument') {
    const inputId = type === 'governmentId' ? 'gov-id-input' 
      : type === 'certification' ? 'cert-input'
      : 'additional-doc-input';
    const fileInput = document.getElementById(inputId) as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  async onCredentialSelected(event: any, credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument') {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      this.showToast('File is too large. Maximum size is 10MB.', 'danger');
      event.target.value = '';
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      this.showToast('Invalid file type. Please upload a JPG, PNG, or PDF.', 'danger');
      event.target.value = '';
      return;
    }

    this.isUploadingCredential = true;
    const loading = await this.loadingController.create({
      message: 'Uploading document...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const metadata: any = {};
      if (credentialType === 'teachingCertification') {
        metadata.certificationName = this.certificationNameInput || '';
      }

      const result = await firstValueFrom(
        this.userService.uploadCredential(file, credentialType, metadata)
      );

      if (result?.success) {
        this.showToast('Document uploaded successfully!', 'success');
        this.certificationNameInput = ''; // Reset
        // Refresh data but stay on credentials step (don't auto-advance)
        await this.loadOnboardingStatus(false);
        this.scheduleScrollLatestCredentialIntoView(credentialType);
      } else {
        this.showToast('Failed to upload document', 'danger');
      }
    } catch (error: any) {
      console.error('❌ Error uploading credential:', error);
      this.showToast(error.error?.message || 'Failed to upload document', 'danger');
    } finally {
      this.isUploadingCredential = false;
      await loading.dismiss();
      event.target.value = '';
    }
  }

  async onCertificationSelected(event: any) {
    await this.onCredentialSelected(event, 'teachingCertification');
  }

  async onAdditionalDocSelected(event: any) {
    await this.onCredentialSelected(event, 'additionalDocument');
  }

  private scheduleScrollLatestCredentialIntoView(
    credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument'
  ): void {
    const onIdentity = credentialType === 'governmentId' && this.approvalStepId === 'identity';
    const onQualifications = credentialType !== 'governmentId' && this.approvalStepId === 'qualifications';
    if (!onIdentity && !onQualifications) {
      return;
    }
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.scrollLatestCredentialIntoView(credentialType);
      });
    });
  }

  private scrollLatestCredentialIntoView(
    credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument'
  ): void {
    const anchorId =
      credentialType === 'teachingCertification'
        ? 'tutor-cred-cert-last-anchor'
        : credentialType === 'additionalDocument'
          ? 'tutor-cred-doc-last-anchor'
          : 'tutor-cred-gov-anchor';
    const el = this.elRef.nativeElement.querySelector(`#${anchorId}`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  async removeCredential(credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument', credentialId?: string) {
    const alert = await this.alertController.create({
      header: 'Remove Document',
      message: 'Are you sure you want to remove this document?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            try {
              const result = await firstValueFrom(
                this.userService.deleteCredential(credentialType, credentialId)
              );
              if (result?.success) {
                this.showToast('Document removed', 'medium');
                await this.loadOnboardingStatus();
              }
            } catch (error: any) {
              console.error('❌ Error removing credential:', error);
              this.showToast(error.error?.message || 'Failed to remove document', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async removeCertification(index: number) {
    const cert = this.uploadedCertifications[index];
    if (cert?._id) {
      await this.removeCredential('teachingCertification', cert._id);
    }
  }

  async removeAdditionalDoc(index: number) {
    const doc = this.uploadedAdditionalDocs[index];
    if (doc?._id) {
      await this.removeCredential('additionalDocument', doc._id);
    }
  }

  async startStripeOnboarding() {
    console.log('🏦 [PAYMENT-SETUP] Starting payment setup...');
    
    // First, show payout selection modal
    const modal = await this.modalController.create({
      component: PayoutSelectionModalComponent,
      cssClass: 'payout-selection-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (!data) {
      console.log('🏦 [PAYMENT-SETUP] User cancelled payout selection');
      return;
    }

    console.log('🏦 [PAYMENT-SETUP] User selected:', data.provider, 'Tax info:', {
      isUSPersonForTax: data.isUSPersonForTax,
      hasUSBankAccount: data.hasUSBankAccount
    });

    // Handle based on selected provider - pass tax info along
    switch (data.provider) {
      case 'stripe':
        await this.setupStripeConnect(data.isUSPersonForTax, data.hasUSBankAccount);
        break;
      case 'paypal':
        await this.setupPayPal(data.paypalEmail, data.isUSPersonForTax, data.hasUSBankAccount);
        break;
      case 'manual':
        await this.setupManualPayout(data.isUSPersonForTax, data.hasUSBankAccount);
        break;
    }
  }

  private async setupStripeConnect(isUSPersonForTax?: boolean | null, hasUSBankAccount?: boolean | null) {
    const residenceCountry = (this.currentUser?.residenceCountry || '').trim();

    // Defensive: bail early if we know Stripe can't support this country.
    if (residenceCountry && !isStripeSupportedCountry(residenceCountry)) {
      this.showToast(`Stripe Connect is not available in ${residenceCountry}. Please choose PayPal.`, 'danger');
      this.determinedPayoutMethod = 'paypal';
      return;
    }
    if (!residenceCountry && isUSPersonForTax !== true) {
      // No country + claimed non-US-person → can't use Stripe Connect via the
      // legacy flow either. Route the user to PayPal instead.
      this.showToast('Please choose PayPal — your country of residence has not been set.', 'danger');
      this.determinedPayoutMethod = 'paypal';
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Setting up Stripe...'
    });
    await loading.present();

    try {
      console.log('🏦 [STRIPE] Making API request to:', `${environment.apiUrl}/payments/stripe-connect/onboard`);

      const body: Record<string, unknown> = { isUSPersonForTax, hasUSBankAccount };
      if (residenceCountry) {
        body['residenceCountry'] = residenceCountry;
      }

      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/stripe-connect/onboard`,
          body,
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      console.log('🏦 [STRIPE] Response:', response);
      await loading.dismiss();

      if (response.success && (response.url || response.onboardingUrl)) {
        const redirectUrl = response.url || response.onboardingUrl;
        console.log('🏦 [STRIPE] Redirecting to:', redirectUrl);
        window.location.href = redirectUrl; // Redirect to Stripe
      } else {
        console.error('🏦 [STRIPE] Invalid response:', response);
        this.showToast('Failed to start Stripe onboarding: ' + (response.message || 'No URL returned'), 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('🏦 [STRIPE] Error:', error);
      console.error('🏦 [STRIPE] Error details:', {
        status: error.status,
        statusText: error.statusText,
        message: error.error?.message,
        error: error.error
      });
      
      const errorMessage = error.error?.message || error.message || 'Failed to start Stripe onboarding';
      this.showToast(errorMessage, 'danger');
    }
  }

  async completeOnboarding() {
    const alert = await this.alertController.create({
      header: 'Complete Onboarding',
      message: 'Submit your profile for review? You\'ll be notified once your video is approved.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Submit',
          handler: async () => {
            await this.submitForReview();
          }
        }
      ]
    });
    await alert.present();
  }

  async submitForReview() {
    const loading = await this.loadingController.create({
      message: 'Submitting for review...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/users/tutor/submit-for-review`,
          {},
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        const successAlert = await this.alertController.create({
          header: 'Submitted Successfully!',
          message: 'Your profile has been submitted for review. We\'ll notify you once it\'s approved.',
          buttons: [
            {
              text: 'OK',
              handler: () => {
                this.exitModalOrNavigateHome();
              }
            }
          ]
        });
        await successAlert.present();
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Submit for review error:', error);
      this.showToast(error.error?.message || 'Failed to submit for review', 'danger');
    }
  }

  skipForNow() {
    this.exitModalOrNavigateHome();
  }

  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  closeOnboarding() {
    this.exitModalOrNavigateHome();
  }

  getVideoType(videoUrl?: string): 'upload' | 'youtube' | 'vimeo' {
    if (!videoUrl) return 'upload';
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) return 'youtube';
    if (videoUrl.includes('vimeo.com')) return 'vimeo';
    return 'upload';
  }

  // Helper method to get the current video URL (pending or approved)
  getCurrentVideoUrl(): string {
    return this.currentUser?.onboardingData?.pendingVideo || 
           this.currentUser?.onboardingData?.introductionVideo || 
           '';
  }

  // Helper method to get the current thumbnail URL (pending or approved)
  getCurrentThumbnailUrl(): string {
    return this.currentUser?.onboardingData?.pendingVideoThumbnail || 
           this.currentUser?.onboardingData?.videoThumbnail || 
           '';
  }

  // Helper method to get the current video type (pending or approved)
  getCurrentVideoType(): 'upload' | 'youtube' | 'vimeo' {
    const videoUrl = this.getCurrentVideoUrl();
    return this.getVideoType(videoUrl);
  }

  async onVideoUploaded(videoData: { url: string; thumbnail: string; type: 'upload' | 'youtube' | 'vimeo' }) {
    console.log('📹 Video uploaded in tutor-approval flow:', videoData);
    console.log('🖼️ Thumbnail URL to save:', videoData.thumbnail);
    
    // Save the video and thumbnail to the database
    try {
      const result = await this.userService.updateTutorVideo(
        videoData.url, 
        videoData.thumbnail, 
        videoData.type
      ).toPromise();
      
      console.log('✅ Video and thumbnail saved to DB:', result);
      
      // Refresh user data to show updated video
      this.userService.getCurrentUser(true).subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.loadOnboardingStatus();
          this.showToast('Video uploaded successfully!', 'success');
        }
      });
    } catch (error) {
      console.error('❌ Error saving video to DB:', error);
      this.showToast('Failed to save video. Please try again.', 'danger');
    }
  }

  async onVideoRemoved() {
    console.log('📹 Video removed in tutor-approval flow');
    
    // Remove video and thumbnail from the database
    try {
      const result = await this.userService.updateTutorVideo('', '', 'upload').toPromise();
      console.log('✅ Video removed from DB:', result);
      
      // Refresh user data
      this.userService.getCurrentUser(true).subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.loadOnboardingStatus();
          this.showToast('Video removed', 'medium');
        }
      });
    } catch (error) {
      console.error('❌ Error removing video from DB:', error);
      this.showToast('Failed to remove video. Please try again.', 'danger');
    }
  }

  changeVideo() {
    // Simply call onVideoRemoved to clear the current video
    // The upload component will automatically show when no video exists
    this.onVideoRemoved();
  }

  openVideoPlayerModal() {
    const videoUrl = this.getCurrentVideoUrl();
    if (!videoUrl) return;
    
    const videoType = this.getVideoType(videoUrl);
    let displayUrl = videoUrl;
    
    // Add autoplay parameter for external videos
    if (videoType === 'youtube' || videoType === 'vimeo') {
      const separator = videoUrl.includes('?') ? '&' : '?';
      if (!videoUrl.includes('autoplay=')) {
        displayUrl = videoUrl + separator + 'autoplay=1';
      }
    }
    
    this.videoPlayerData = {
      videoUrl: displayUrl,
      safeVideoUrl: this.sanitizer.bypassSecurityTrustResourceUrl(displayUrl),
      videoType: videoType
    };
    this.isVideoPlaying = false; // Start with thumbnail showing
    this.isVideoPlayerModalOpen = true;
    console.log('🎬 Opening video player modal');
    
    // Auto-start video after brief thumbnail display (500ms)
    setTimeout(() => {
      this.startVideoPlayback();
    }, 500);
  }

  startVideoPlayback() {
    console.log('▶️ Starting video playback');
    this.isVideoPlaying = true;
  }

  onVideoPlayerModalDismiss() {
    this.isVideoPlayerModalOpen = false;
    this.isVideoPlaying = false;
    this.videoPlayerData = null;
  }

  onVideoReady(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
  }

  private async setupPayPal(paypalEmail: string, isUSPersonForTax?: boolean | null, hasUSBankAccount?: boolean | null) {
    const loading = await this.loadingController.create({
      message: 'Setting up PayPal...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/setup-paypal`,
          { paypalEmail, isUSPersonForTax, hasUSBankAccount },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast('PayPal setup complete! You can now receive payments.', 'success');
        this.editingPayoutEmail = false;
        await this.loadOnboardingStatus(); // Refresh status
      } else {
        this.showToast('Failed to setup PayPal: ' + (response.message || 'Unknown error'), 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ PayPal setup error:', error);
      this.showToast('Failed to setup PayPal. Please try again.', 'danger');
    }
  }

  private async setupManualPayout(isUSPersonForTax?: boolean | null, hasUSBankAccount?: boolean | null) {
    const alert = await this.alertController.create({
      header: 'Manual Bank Transfer',
      message: 'Your payout method has been set to manual bank transfer. You\'ll be able to request withdrawals from your earnings page, and our team will process them manually.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Continue',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Setting up manual payout...'
            });
            await loading.present();

            try {
              const response = await firstValueFrom(
                this.http.post<any>(
                  `${environment.apiUrl}/payments/setup-manual`,
                  { isUSPersonForTax, hasUSBankAccount },
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              await loading.dismiss();

              if (response.success) {
                this.showToast('Manual payout method configured successfully!', 'success');
                await this.loadOnboardingStatus(); // Refresh status
              } else {
                this.showToast('Failed to setup manual payout: ' + (response.message || 'Unknown error'), 'danger');
              }
            } catch (error: any) {
              await loading.dismiss();
              console.error('❌ Manual payout setup error:', error);
              this.showToast('Failed to setup manual payout. Please try again.', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }
}
