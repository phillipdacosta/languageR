import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ChangeDetectorRef, HostBinding } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { IonicModule, ToastController, AlertController, ModalController } from '@ionic/angular';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { MaterialService, CreateMaterialPayload, QuizQuestion, QuestionType, MaterialType, TutorMaterial, LinkedChannels } from '../services/material.service';
import { BundleService, ContentBundle, CreateBundlePayload } from '../services/bundle.service';
import { UserService } from '../services/user.service';
import { SharedModule } from '../shared/shared.module';
import { ImageCropperComponent } from '../components/image-cropper/image-cropper.component';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { QuillEditorComponent } from 'ngx-quill';
import { TranslateService } from '@ngx-translate/core';
import { environment } from '../../environments/environment';
import { HomeInlineToolbarService } from '../services/home-inline-toolbar.service';
import { TagPickerComponent } from '../components/tag-picker/tag-picker.component';
import { PlatformService } from '../services/platform.service';

type Step = 'type' | 'pricing' | 'details' | 'quiz' | 'preview';

type DetailsWizardStepId =
  | 'title'
  | 'description'
  | 'whyTake'
  | 'languageLevel'
  | 'tags'
  | 'customTopics'
  | 'thumbnail'
  | 'videoUrl'
  | 'readingPassage'
  | 'listeningAudio'
  | 'price';

type BundleWizardStepId =
  | 'bundleShare'
  | 'bundleTitle'
  | 'bundleDescription'
  | 'bundleMaterials'
  | 'bundleCover'
  | 'bundleLanguageLevel'
  | 'bundleTags'
  | 'bundlePrice';

@Component({
  selector: 'app-create-material',
  templateUrl: './create-material.page.html',
  styleUrls: ['./create-material.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, ReactiveFormsModule, SharedModule, QuillEditorComponent, TagPickerComponent]
})
export class CreateMaterialPage implements OnInit, OnDestroy {
  @Input() inline = false;
  @Output() goBackEvent = new EventEmitter<void>();
  @Output() modalExpandEvent = new EventEmitter<boolean>();
  /** Desktop modal top bar: Save and exit vs Go back (inline / home modal only). */
  @Output() modalTopbarChromeEvent = new EventEmitter<{
    showSaveExit: boolean;
    showModalBack: boolean;
    showBundleShareGoBack?: boolean;
    /** Desktop bundle wizard: previous step (Name your bundle onward) — top bar only, no footer Back */
    showBundleWizardGoBack?: boolean;
    /** e.g. "3/9" — desktop modal topbar center, aligned with mobile wizard count */
    centerStepLabel: string | null;
    /** Translated label for material early/mid steps + bundle share exit (matches `navBackLabel`). */
    topbarNavBackLabel: string;
    /** Translated previous bundle wizard step title; empty when not on bundle wizard back. */
    topbarBundleWizardBackLabel: string;
  }>();
  /** Desktop modal footer: details wizard Back / Next (same slot as + New Material). */
  @Output() detailsModalFooterChromeEvent = new EventEmitter<{
    active: boolean;
    showBack: boolean;
    /** Desktop material details wizard: Save Draft / Save (published edit) instead of step Back. */
    showSaveDraft: boolean;
    footerSaveLabelKey: string | null;
    isLastStep: boolean;
    lastStepLabelKey?: string | null;
    footerBackLabel?: string | null;
  }>();
  /** Desktop modal sidebar + footer: tab1 must mirror the active library/create flow. */
  @Output() modalSidebarTabSync = new EventEmitter<'materials' | 'bundles'>();
  @HostBinding('class.cm-host-inline')
  get cmHostInlineClass(): boolean {
    return this.inline;
  }

  @HostBinding('class.cm-bundle-wizard-layout')
  get cmBundleWizardLayoutClass(): boolean {
    return this.inline && this.viewMode === 'bundle-create' && this.bundleWizardLayoutActive;
  }

  viewMode: 'library' | 'create' | 'bundle-create' = 'library';
  libraryTab: 'materials' | 'bundles' = 'materials';
  showMaterialsList = false;
  showBundlesList = false;
  myMaterials: TutorMaterial[] = [];
  isLoadingMaterials = true;
  editingMaterialId: string | null = null;
  /** Set when editing from library; used for draft save vs in-place save on published. */
  editingMaterialStatus: TutorMaterial['status'] | null = null;

  // Bundles
  myBundles: ContentBundle[] = [];
  isLoadingBundles = false;
  editingBundleId: string | null = null;
  bundleTitle = '';
  bundleDescription = '';
  bundleLanguage = '';
  bundleLevel = 'any';
  bundlePricingType: 'free' | 'paid' | null = null;
  bundlePrice: number = 0;
  bundleStructuredTags: string[] = [];
  bundleSelectedMaterialIds: string[] = [];
  bundleCoverFile: File | null = null;
  bundleCoverPreview: string | null = null;
  bundleCoverUrl: string | null = null;
  isUploadingBundleCover = false;
  isSavingBundle = false;
  justPublishedId: string | null = null;
  copiedLinkId: string | null = null;
  currentUserId: string | null = null;

  currentStep: Step = 'type';
  selectedType: MaterialType | null = null;
  selectedPricing: 'free' | 'paid' | null = null;

  navBackLabel = '';
  stepTitle = '';

  private toolbarBackSub?: Subscription;

  private stepTitleKeys: Record<Step, string> = {
    type: 'CREATE_MATERIAL.STEP_NEW_MATERIAL',
    pricing: 'CREATE_MATERIAL.STEP_PRICING',
    details: 'CREATE_MATERIAL.STEP_DETAILS',
    quiz: 'CREATE_MATERIAL.STEP_QUIZ_BUILDER',
    preview: 'CREATE_MATERIAL.STEP_PREVIEW'
  };

  materialForm!: FormGroup;
  isSubmitting = false;
  isSavingMaterialDraft = false;

  // Video quiz
  videoPreviewUrl: SafeResourceUrl | null = null;
  videoAutoplayUrl: SafeResourceUrl | null = null;
  videoThumbnail: string | null = null;

  // Listening
  audioPreviewUrl: SafeResourceUrl | null = null;
  audioProviderType: string | null = null;

  // Thumbnail
  thumbnailFile: File | null = null;
  thumbnailPreview: string | null = null;
  previewVideoPlaying = false;
  isUploadingThumbnail = false;
  existingThumbnailUrl: string | null = null;

  // Topics (legacy free-text)
  topicInput = '';
  selectedTopics: string[] = [];
  topicSuggestions = [
    'verb conjugation', 'subjunctive', 'past tense', 'articles',
    'prepositions', 'pronunciation', 'vocabulary', 'grammar',
    'conditional', 'passive voice', 'word order', 'listening',
    'reading comprehension', 'conversation', 'idioms', 'formal speech'
  ];

  // Structured taxonomy tags
  selectedStructuredTags: string[] = [];

  /** Desktop-only: one field per screen inside the details step. */
  detailsWizardLayoutActive = false;
  detailsWizardStepIds: DetailsWizardStepId[] = [];
  detailsWizardStepIndex = 0;
  detailsWizardStepId: DetailsWizardStepId = 'title';
  detailsWizardHeadlineKey = 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_H';
  detailsWizardSublineKey = 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_D';
  detailsWizardStepTotal = 0;
  detailsWizardProgressPercent = 100;

  /** Desktop modal: one bundle section per step (mirrors material details wizard). */
  bundleWizardLayoutActive = false;
  bundleWizardStepIds: BundleWizardStepId[] = [];
  bundleWizardStepIndex = 0;
  bundleWizardStepId: BundleWizardStepId = 'bundleTitle';
  bundleWizardHeadlineKey = 'CREATE_MATERIAL.BUNDLE_WIZ_TITLE_H';
  bundleWizardSublineKey = 'CREATE_MATERIAL.BUNDLE_WIZ_TITLE_D';
  bundleWizardStepTotal = 0;
  bundleWizardProgressPercent = 100;

  /** After "Create a material" from bundle (no materials), back from type step returns to bundle wizard. */
  private resumeBundleAfterMaterial = false;

  private readonly bundleWizardCopyKeys: Record<BundleWizardStepId, { h: string; d: string }> = {
    bundleShare: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_SHARE_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_SHARE_D' },
    bundleTitle: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_TITLE_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_TITLE_D' },
    bundleDescription: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_DESC_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_DESC_D' },
    bundleMaterials: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_MATERIALS_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_MATERIALS_D' },
    bundleCover: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_COVER_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_COVER_D' },
    bundleLanguageLevel: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_LANG_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_LANG_D' },
    bundleTags: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_TAGS_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_TAGS_D' },
    bundlePrice: { h: 'CREATE_MATERIAL.BUNDLE_WIZ_PRICE_H', d: 'CREATE_MATERIAL.BUNDLE_WIZ_PRICE_D' }
  };

  private readonly detailsWizardCopyKeys: Partial<Record<DetailsWizardStepId, { h: string; d: string }>> = {
    title: { h: 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_D' },
    description: { h: 'CREATE_MATERIAL.DETAILS_WIZ_DESCRIPTION_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_DESCRIPTION_D' },
    whyTake: { h: 'CREATE_MATERIAL.DETAILS_WIZ_WHY_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_WHY_D' },
    languageLevel: { h: 'CREATE_MATERIAL.DETAILS_WIZ_LANG_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_LANG_D' },
    tags: { h: 'CREATE_MATERIAL.DETAILS_WIZ_TAGS_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_TAGS_D' },
    customTopics: { h: 'CREATE_MATERIAL.DETAILS_WIZ_TOPICS_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_TOPICS_D' },
    videoUrl: { h: 'CREATE_MATERIAL.DETAILS_WIZ_VIDEO_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_VIDEO_D' },
    readingPassage: { h: 'CREATE_MATERIAL.DETAILS_WIZ_PASSAGE_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_PASSAGE_D' },
    listeningAudio: { h: 'CREATE_MATERIAL.DETAILS_WIZ_AUDIO_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_AUDIO_D' },
    price: { h: 'CREATE_MATERIAL.DETAILS_WIZ_PRICE_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_PRICE_D' }
  };

  quillConfig = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ 'header': [1, 2, 3, false] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['blockquote'],
      ['clean']
    ],
    placeholder: 'Write or paste the reading passage here...'
  };

  languages = [
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
    'Japanese', 'Korean', 'Chinese', 'Arabic', 'Russian', 'Hindi',
    'Turkish', 'Dutch', 'Polish', 'Swedish', 'Czech', 'Greek',
    'Hebrew', 'Thai', 'Vietnamese', 'Indonesian', 'Malay',
    'Finnish', 'Norwegian', 'Danish', 'Romanian', 'Ukrainian', 'Persian', 'Farsi'
  ];

  levels: { value: string; label: string }[] = [];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private materialService: MaterialService,
    private userService: UserService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private route: ActivatedRoute,
    private modalCtrl: ModalController,
    private translate: TranslateService,
    private homeInlineToolbar: HomeInlineToolbarService,
    private bundleService: BundleService,
    private platformService: PlatformService
  ) {}

  restoreSection() {
    const section = sessionStorage.getItem('cmReturnSection');
    if (section === 'bundles') {
      this.libraryTab = 'bundles';
      this.showBundlesList = true;
      this.loadBundles();
      this.emitModalSidebarTabSync('bundles');
      this.cdr.markForCheck();
    } else if (section === 'materials') {
      this.libraryTab = 'materials';
      this.showMaterialsList = true;
      this.emitModalSidebarTabSync('materials');
      this.cdr.markForCheck();
    }
    sessionStorage.removeItem('cmReturnSection');
  }

  private emitModalSidebarTabSync(tab: 'materials' | 'bundles'): void {
    if (!this.inline) return;
    this.modalSidebarTabSync.emit(tab);
  }

  ngOnInit() {
    this.initForm();
    this.rebuildTranslatedLabels();
    this.loadMyMaterials();
    this.loadBundles();
    this.loadLinkedChannels();
    this.updateNavState();

    this.userService.currentUser$.subscribe(u => {
      if (u) this.currentUserId = u.id;
    });
    this.translate.onLangChange.subscribe(() => {
      this.rebuildTranslatedLabels();
      this.updateNavState();
    });

    if (this.inline) {
      this.toolbarBackSub = this.homeInlineToolbar.onCloseMaterialsRequest$.subscribe(() => {
        this.handleNavBack();
      });
    }
  }

  ngOnDestroy(): void {
    this.toolbarBackSub?.unsubscribe();
    if (this.inline) {
      this.homeInlineToolbar.setMaterialsToolbarBackLabel('');
      this.detailsModalFooterChromeEvent.emit({
        active: false,
        showBack: false,
        showSaveDraft: false,
        footerSaveLabelKey: null,
        isLastStep: false,
        lastStepLabelKey: null,
        footerBackLabel: null,
      });
    }
  }

  private rebuildTranslatedLabels() {
    this.levels = [
      { value: 'beginner', label: this.translate.instant('CREATE_MATERIAL.LEVEL_BEGINNER') },
      { value: 'intermediate', label: this.translate.instant('CREATE_MATERIAL.LEVEL_INTERMEDIATE') },
      { value: 'advanced', label: this.translate.instant('CREATE_MATERIAL.LEVEL_ADVANCED') },
      { value: 'any', label: this.translate.instant('CREATE_MATERIAL.LEVEL_ALL') }
    ];
    this.questionTypes = [
      { value: 'multiple_choice', label: this.translate.instant('CREATE_MATERIAL.QUIZ_MC'), icon: 'list-outline' },
      { value: 'fill_blank', label: this.translate.instant('CREATE_MATERIAL.QUIZ_FILL_BLANK'), icon: 'text-outline' },
      { value: 'true_false', label: this.translate.instant('CREATE_MATERIAL.QUIZ_TRUE_FALSE'), icon: 'swap-horizontal-outline' },
      { value: 'ordering', label: this.translate.instant('CREATE_MATERIAL.QUIZ_ORDERING'), icon: 'reorder-four-outline' }
    ];
  }

  private initForm() {
    this.materialForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      whyTakeThis: ['', [Validators.maxLength(100)]],
      language: ['', Validators.required],
      level: ['any'],
      videoUrl: [''],
      passage: [''],
      audioUrl: [''],
      price: [0],
      quiz: this.fb.array([])
    });

    this.materialForm.get('videoUrl')?.valueChanges.subscribe(url => {
      this.parseVideoUrl(url);
      if (!this.thumbnailFile) {
        this.existingThumbnailUrl = null;
        this.thumbnailPreview = null;
      }
    });
    this.materialForm.get('audioUrl')?.valueChanges.subscribe(url => this.parseAudioUrl(url));
  }

  get quizArray(): FormArray {
    return this.materialForm.get('quiz') as FormArray;
  }

  // ── Library ─────────────────────────────────────────────

  loadMyMaterials() {
    this.isLoadingMaterials = true;
    this.materialService.getMyMaterials().subscribe({
      next: (res) => {
        this.isLoadingMaterials = false;
        this.myMaterials = res.success ? res.materials : [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingMaterials = false;
        this.myMaterials = [];
        this.cdr.markForCheck();
      }
    });
  }

  startCreate() {
    this.resumeBundleAfterMaterial = false;
    this.editingMaterialId = null;
    this.resetForm();
    this.viewMode = 'create';
    this.updateNavState();
    this.modalExpandEvent.emit(true);
    this.emitModalSidebarTabSync('materials');
  }

  backToLibrary() {
    this.resumeBundleAfterMaterial = false;
    this.resetForm();
    this.viewMode = 'library';
    this.showMaterialsList = false;
    this.showBundlesList = false;
    this.updateNavState();
    this.loadMyMaterials();
    if (this.inline) {
      this.modalExpandEvent.emit(false);
    }
    this.emitModalSidebarTabSync(this.libraryTab);
  }

  handleNavBack() {
    if (this.viewMode === 'library') {
      if (this.showMaterialsList || this.showBundlesList) {
        this.showMaterialsList = false;
        this.showBundlesList = false;
        this.updateNavState();
        if (this.inline) {
          this.modalExpandEvent.emit(false);
        }
        return;
      }
      this.goBackEvent.emit();
      return;
    }
    if (this.viewMode === 'bundle-create') {
      this.cancelBundleCreate();
      return;
    }
    if (this.viewMode === 'create' && this.resumeBundleAfterMaterial && this.currentStep === 'type') {
      this.resumeBundleAfterMaterial = false;
      this.viewMode = 'bundle-create';
      this.updateNavState();
      this.emitModalSidebarTabSync('bundles');
      return;
    }
    // In create/edit mode
    const idx = this.stepOrder.indexOf(this.currentStep);
    if (idx <= 0 || (this.editingMaterialId && this.currentStep === 'details')) {
      this.backToLibrary();
    } else {
      this.goBack();
    }
  }

  updateNavState() {
    if (this.viewMode === 'library') {
      this.navBackLabel = this.translate.instant('CREATE_MATERIAL.NAV_BACK_SHORT');
      this.stepTitle = '';
      if (this.inline) {
        this.homeInlineToolbar.setMaterialsToolbarBackLabel(this.navBackLabel);
        this.emitDetailsModalFooterChrome();
      }
      this.syncModalTopbarChrome();
      return;
    }
    if (this.viewMode === 'bundle-create') {
      this.navBackLabel = this.translate.instant('CREATE_MATERIAL.NAV_MY_MATERIALS');
      this.stepTitle = this.editingBundleId ? 'Edit Bundle' : 'Create Bundle';
      this.bundleWizardLayoutActive = this.inline && !this.platformService.isMobile();
      if (this.bundleWizardLayoutActive) {
        if (this.bundleWizardStepIds.length === 0) {
          this.initBundleWizard();
        } else {
          this.syncBundleWizardFromIndex();
        }
      }
      if (this.inline) {
        this.homeInlineToolbar.setMaterialsToolbarBackLabel(this.navBackLabel);
        this.emitDetailsModalFooterChrome();
      }
      this.syncModalTopbarChrome();
      return;
    }
    this.stepTitle = this.translate.instant(this.stepTitleKeys[this.currentStep]) || '';
    const idx = this.stepOrder.indexOf(this.currentStep);
    if (idx <= 0 || (this.editingMaterialId && this.currentStep === 'details')) {
      this.navBackLabel = this.translate.instant('CREATE_MATERIAL.NAV_MY_MATERIALS');
    } else {
      const prevStep = this.stepOrder[idx - 1];
      this.navBackLabel = this.translate.instant(this.stepTitleKeys[prevStep]) || this.translate.instant('CREATE_MATERIAL.NAV_BACK_SHORT');
    }

    if (this.inline) {
      this.homeInlineToolbar.setMaterialsToolbarBackLabel(this.navBackLabel);
    }

    const onDetails = this.currentStep === 'details';
    this.detailsWizardLayoutActive = !this.platformService.isMobile() && onDetails;
    if (!onDetails) {
      this.detailsWizardStepIndex = 0;
      this.detailsWizardStepIds = [];
      this.detailsWizardStepTotal = 0;
      this.detailsWizardProgressPercent = 100;
    } else if (this.detailsWizardLayoutActive && this.detailsWizardStepIds.length > 0) {
      this.syncDetailsWizardFromIndex();
    } else if (this.inline) {
      this.emitDetailsModalFooterChrome();
    }

    if (this.inline && !onDetails) {
      this.emitDetailsModalFooterChrome();
    }

    this.syncModalTopbarChrome();
  }

  initDetailsWizard(): void {
    if (this.platformService.isMobile() || this.currentStep !== 'details') return;
    this.detailsWizardStepIndex = 0;
    this.rebuildDetailsWizardStepIds();
    this.syncDetailsWizardFromIndex();
  }

  private rebuildDetailsWizardStepIds(): void {
    const steps: DetailsWizardStepId[] = [
      'title',
      'description',
      'whyTake',
      'languageLevel',
      'tags',
      'customTopics',
      'thumbnail'
    ];
    if (this.selectedType === 'video_quiz') {
      steps.push('videoUrl');
    } else if (this.selectedType === 'reading') {
      steps.push('readingPassage');
    } else if (this.selectedType === 'listening') {
      steps.push('listeningAudio');
    }
    if (this.selectedPricing === 'paid') {
      steps.push('price');
    }
    this.detailsWizardStepIds = steps;
    this.detailsWizardStepTotal = steps.length;
    this.syncDetailsWizardProgress();
  }

  private syncDetailsWizardProgress(): void {
    const t = this.detailsWizardStepTotal;
    if (t <= 0) {
      this.detailsWizardProgressPercent = 100;
      return;
    }
    this.detailsWizardProgressPercent = ((this.detailsWizardStepIndex + 1) / t) * 100;
  }

  private syncDetailsWizardFromIndex(): void {
    const id = this.detailsWizardStepIds[this.detailsWizardStepIndex] ?? 'title';
    this.detailsWizardStepId = id;
    if (id === 'thumbnail') {
      this.detailsWizardHeadlineKey = 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_H';
      if (this.selectedType === 'video_quiz') {
        this.detailsWizardSublineKey = 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_D_VIDEO';
      } else if (this.selectedType === 'reading') {
        this.detailsWizardSublineKey = 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_D_READING';
      } else {
        this.detailsWizardSublineKey = 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_D_LISTENING';
      }
    } else {
      const copy = this.detailsWizardCopyKeys[id];
      this.detailsWizardHeadlineKey = copy?.h ?? 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_H';
      this.detailsWizardSublineKey = copy?.d ?? 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_D';
    }
    this.syncDetailsWizardProgress();
    this.emitDetailsModalFooterChrome();
    this.syncModalTopbarChrome();
  }

  /** Back label for previous bundle wizard step (share step shows short “Pricing”, not the long headline). */
  private translateBundleWizardPrevStepHeadline(prevId: BundleWizardStepId): string {
    if (prevId === 'bundleShare') {
      return this.translate.instant('CREATE_MATERIAL.STEP_PRICING');
    }
    const key = this.bundleWizardCopyKeys[prevId]?.h;
    return key ? this.translate.instant(key) : this.translate.instant('CREATE_MATERIAL.NAV_BACK_SHORT');
  }

  private computeBundleWizardFooterBackLabel(): string {
    if (this.bundleWizardStepIndex <= 0 || !this.bundleWizardStepIds.length) {
      return this.translate.instant('COMMON.BACK');
    }
    const prevId = this.bundleWizardStepIds[this.bundleWizardStepIndex - 1];
    return this.translateBundleWizardPrevStepHeadline(prevId);
  }

  private emitDetailsModalFooterChrome(): void {
    if (!this.inline) return;

    const desktopMaterialPricing =
      this.viewMode === 'create' &&
      this.currentStep === 'pricing' &&
      !this.editingMaterialId &&
      !this.platformService.isMobile();
    if (desktopMaterialPricing) {
      this.detailsModalFooterChromeEvent.emit({
        active: true,
        showBack: false,
        showSaveDraft: false,
        footerSaveLabelKey: null,
        isLastStep: false,
        lastStepLabelKey: null,
        footerBackLabel: null,
      });
      return;
    }

    if (this.viewMode === 'bundle-create') {
      if (!this.bundleWizardLayoutActive || this.bundleWizardStepTotal <= 0) {
        this.detailsModalFooterChromeEvent.emit({
          active: false,
          showBack: false,
          showSaveDraft: false,
          footerSaveLabelKey: null,
          isLastStep: false,
          lastStepLabelKey: null,
          footerBackLabel: null,
        });
        return;
      }
      const bundleLast = this.bundleWizardStepIndex >= this.bundleWizardStepTotal - 1;
      const desktopBundleWizard = !this.platformService.isMobile() && this.bundleWizardLayoutActive;
      const showFooterBack = desktopBundleWizard ? false : this.bundleWizardStepId !== 'bundleShare';
      const showBundleSaveDraft =
        !!this.editingBundleId || this.bundleWizardStepIndex >= 2;
      this.detailsModalFooterChromeEvent.emit({
        active: true,
        showBack: showFooterBack,
        showSaveDraft: showBundleSaveDraft,
        footerSaveLabelKey: showBundleSaveDraft
          ? 'CREATE_MATERIAL.BUNDLE_SAVE_DRAFT'
          : null,
        isLastStep: bundleLast,
        lastStepLabelKey: bundleLast
          ? (this.editingBundleId ? 'CREATE_MATERIAL.BUNDLE_WIZ_UPDATE' : 'CREATE_MATERIAL.BUNDLE_WIZ_PUBLISH')
          : null,
        footerBackLabel: showFooterBack ? this.computeBundleWizardFooterBackLabel() : null,
      });
      return;
    }

    const desktopDetails =
      this.viewMode === 'create' &&
      this.currentStep === 'details' &&
      !this.platformService.isMobile();
    if (!desktopDetails || this.detailsWizardStepTotal <= 0) {
      this.detailsModalFooterChromeEvent.emit({
        active: false,
        showBack: false,
        showSaveDraft: false,
        footerSaveLabelKey: null,
        isLastStep: false,
        lastStepLabelKey: null,
        footerBackLabel: null,
      });
      return;
    }
    const t = this.detailsWizardStepTotal;
    const detailsLast = this.detailsWizardStepIndex >= t - 1;
    const showMaterialSaveDraft =
      this.detailsWizardStepIndex > 0 || !!this.editingMaterialId;
    this.detailsModalFooterChromeEvent.emit({
      active: true,
      showBack: false,
      showSaveDraft: showMaterialSaveDraft,
      footerSaveLabelKey: showMaterialSaveDraft ? this.materialFooterSaveLabelKey() : null,
      isLastStep: detailsLast,
      lastStepLabelKey: null,
      footerBackLabel: null,
    });
  }

  private materialFooterSaveLabelKey(): string {
    return this.editingMaterialId && this.editingMaterialStatus === 'published'
      ? 'COMMON.SAVE'
      : 'CREATE_MATERIAL.SAVE_DRAFT';
  }

  private validateCurrentDetailsWizardStep(): boolean {
    const id = this.detailsWizardStepId;
    switch (id) {
      case 'title': {
        const c = this.materialForm.get('title');
        c?.markAsTouched();
        if (c?.invalid) {
          this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
          return false;
        }
        return true;
      }
      case 'languageLevel': {
        const c = this.materialForm.get('language');
        c?.markAsTouched();
        if (c?.invalid) {
          this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
          return false;
        }
        return true;
      }
      case 'videoUrl':
        if (this.selectedType === 'video_quiz' && !this.videoPreviewUrl) {
          this.showTranslatedToast('CREATE_MATERIAL.TOAST_VALID_VIDEO');
          return false;
        }
        return true;
      case 'readingPassage': {
        if (this.selectedType !== 'reading') return true;
        const passageHtml = this.materialForm.value.passage || '';
        const stripped = passageHtml.replace(/<[^>]*>/g, '').trim();
        if (!stripped) {
          this.showTranslatedToast('CREATE_MATERIAL.TOAST_ENTER_PASSAGE');
          return false;
        }
        return true;
      }
      case 'listeningAudio':
        if (this.selectedType === 'listening' && !this.audioPreviewUrl) {
          this.showTranslatedToast('CREATE_MATERIAL.TOAST_VALID_AUDIO');
          return false;
        }
        return true;
      case 'thumbnail':
        if (!this.thumbnailPreview) {
          this.showTranslatedToast('CREATE_MATERIAL.TOAST_ADD_COVER');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  onDetailsWizardNext(): void {
    if (!this.validateCurrentDetailsWizardStep()) return;
    if (this.detailsWizardStepIndex >= this.detailsWizardStepIds.length - 1) {
      this.goToQuizStep();
      return;
    }
    this.detailsWizardStepIndex += 1;
    this.syncDetailsWizardFromIndex();
    this.scrollDetailsWizardIntoView();
    this.cdr.detectChanges();
  }

  onDetailsWizardBack(): void {
    if (this.detailsWizardStepIndex > 0) {
      this.detailsWizardStepIndex -= 1;
      this.syncDetailsWizardFromIndex();
      this.scrollDetailsWizardIntoView();
      this.cdr.detectChanges();
      return;
    }
    this.goBack();
  }

  private scrollDetailsWizardIntoView(): void {
    setTimeout(() => {
      document.querySelector('.cm-details-wizard-scroll')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  }

  private initBundleWizard(): void {
    if (this.platformService.isMobile() || this.viewMode !== 'bundle-create') return;
    this.bundleWizardStepIndex = 0;
    this.rebuildBundleWizardStepIds();
    this.syncBundleWizardFromIndex();
  }

  private rebuildBundleWizardStepIds(): void {
    const steps: BundleWizardStepId[] = [
      'bundleShare',
      'bundleTitle',
      'bundleDescription',
      'bundleMaterials',
      'bundleCover',
      'bundleLanguageLevel',
      'bundleTags'
    ];
    if (this.bundlePricingType === 'paid') {
      steps.push('bundlePrice');
    }
    this.bundleWizardStepIds = steps;
    this.bundleWizardStepTotal = steps.length;
    if (this.bundleWizardStepIndex >= this.bundleWizardStepTotal) {
      this.bundleWizardStepIndex = Math.max(0, this.bundleWizardStepTotal - 1);
    }
    this.syncBundleWizardProgress();
  }

  selectBundleSharePricing(pricing: 'free' | 'paid'): void {
    this.bundlePricingType = pricing;
    if (pricing === 'free') {
      this.bundlePrice = 0;
    }
    if (this.bundleWizardLayoutActive && this.bundleWizardStepId === 'bundleShare') {
      this.rebuildBundleWizardStepIds();
      this.syncBundleWizardFromIndex();
    } else if (this.inline) {
      this.emitDetailsModalFooterChrome();
    }
    this.cdr.markForCheck();
  }

  private syncBundleWizardProgress(): void {
    const t = this.bundleWizardStepTotal;
    if (t <= 0) {
      this.bundleWizardProgressPercent = 100;
      return;
    }
    this.bundleWizardProgressPercent = ((this.bundleWizardStepIndex + 1) / t) * 100;
  }

  private syncBundleWizardFromIndex(): void {
    const id = this.bundleWizardStepIds[this.bundleWizardStepIndex] ?? 'bundleShare';
    this.bundleWizardStepId = id;
    const copy = this.bundleWizardCopyKeys[id];
    this.bundleWizardHeadlineKey = copy.h;
    this.bundleWizardSublineKey = copy.d;
    this.syncBundleWizardProgress();
    this.emitDetailsModalFooterChrome();
    this.syncModalTopbarChrome();
  }

  private resetBundleWizardState(): void {
    this.resumeBundleAfterMaterial = false;
    this.bundleWizardStepIds = [];
    this.bundleWizardStepIndex = 0;
    this.bundleWizardStepTotal = 0;
    this.bundleWizardProgressPercent = 100;
    this.bundleWizardStepId = 'bundleShare';
    this.bundleWizardHeadlineKey = 'CREATE_MATERIAL.BUNDLE_WIZ_SHARE_H';
    this.bundleWizardSublineKey = 'CREATE_MATERIAL.BUNDLE_WIZ_SHARE_D';
  }

  private validateCurrentBundleWizardStep(): boolean {
    switch (this.bundleWizardStepId) {
      case 'bundleShare':
        if (this.bundlePricingType === null) {
          void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
          return false;
        }
        return true;
      case 'bundleTitle':
        if (!this.bundleTitle.trim()) {
          void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
          return false;
        }
        return true;
      case 'bundleDescription':
        return true;
      case 'bundleMaterials':
        if (this.bundleSelectedMaterialIds.length < 2) {
          void this.showTranslatedToast('CREATE_MATERIAL.BUNDLE_WIZ_TOAST_MATERIALS_MIN_TWO');
          return false;
        }
        return true;
      case 'bundleCover':
      case 'bundleTags':
        return true;
      case 'bundleLanguageLevel':
        if (!this.bundleLanguage?.trim()) {
          void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
          return false;
        }
        return true;
      case 'bundlePrice':
        if (this.bundlePrice <= 0) {
          void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  onBundleWizardNext(): void {
    if (!this.validateCurrentBundleWizardStep()) return;
    if (this.bundleWizardStepId === 'bundleShare') {
      this.rebuildBundleWizardStepIds();
    }
    if (this.bundleWizardStepIndex >= this.bundleWizardStepIds.length - 1) return;
    this.bundleWizardStepIndex += 1;
    this.syncBundleWizardFromIndex();
    this.scrollBundleWizardIntoView();
    this.cdr.detectChanges();
  }

  onBundleWizardBack(): void {
    if (this.bundleWizardStepIndex > 0) {
      this.bundleWizardStepIndex -= 1;
      this.syncBundleWizardFromIndex();
      this.scrollBundleWizardIntoView();
      this.cdr.detectChanges();
      return;
    }
    this.cancelBundleCreate();
  }

  private scrollBundleWizardIntoView(): void {
    setTimeout(() => {
      document.querySelector('.cm-bundle-wizard .cm-details-wizard-scroll')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  }

  /** Desktop modal footer: material details wizard or bundle wizard. */
  onWizardFooterNext(): void {
    if (
      this.viewMode === 'create' &&
      this.currentStep === 'pricing' &&
      !this.editingMaterialId &&
      this.inline &&
      !this.platformService.isMobile()
    ) {
      this.confirmMaterialPricingAndContinueToDetails();
      return;
    }
    if (this.viewMode === 'bundle-create' && this.bundleWizardLayoutActive) {
      if (this.bundleWizardStepIndex >= this.bundleWizardStepIds.length - 1) {
        void this.saveBundle();
      } else {
        this.onBundleWizardNext();
      }
      return;
    }
    this.onDetailsWizardNext();
  }

  onWizardFooterBack(): void {
    if (this.viewMode === 'bundle-create' && this.bundleWizardLayoutActive) {
      this.onBundleWizardBack();
      return;
    }
    this.onDetailsWizardBack();
  }

  /** Parent (tab1 desktop modal) can call after direct field updates. */
  refreshModalTopbarChrome(): void {
    this.syncModalTopbarChrome();
  }

  private syncModalTopbarChrome(): void {
    if (!this.inline) return;
    let showSaveExit = true;
    let showModalBack = false;
    let showBundleShareGoBack = false;
    let showBundleWizardGoBack = false;
    if (this.viewMode === 'library') {
      showSaveExit = true;
      showModalBack = false;
    } else if (this.viewMode === 'create') {
      const earlyStep = this.currentStep === 'type' || this.currentStep === 'pricing';
      const desktopMidCreate =
        !this.platformService.isMobile() &&
        (this.currentStep === 'details' || this.currentStep === 'quiz' || this.currentStep === 'preview');
      showSaveExit = !earlyStep;
      showModalBack = earlyStep || desktopMidCreate;
    } else if (this.viewMode === 'bundle-create') {
      showSaveExit = true;
      showModalBack = false;
      const desktopBundleWizard =
        !this.platformService.isMobile() &&
        this.bundleWizardLayoutActive &&
        this.bundleWizardStepTotal > 0;
      showBundleShareGoBack =
        desktopBundleWizard &&
        this.bundleWizardStepId === 'bundleShare';
      showBundleWizardGoBack =
        desktopBundleWizard &&
        this.bundleWizardStepIndex > 0;
    }
    const centerStepLabel = this.computeModalCenterStepLabel();
    let topbarBundleWizardBackLabel = '';
    if (
      showBundleWizardGoBack &&
      this.bundleWizardStepIndex > 0 &&
      this.bundleWizardStepIds?.length
    ) {
      const prevId = this.bundleWizardStepIds[this.bundleWizardStepIndex - 1];
      topbarBundleWizardBackLabel = this.translateBundleWizardPrevStepHeadline(prevId);
    }
    this.modalTopbarChromeEvent.emit({
      showSaveExit,
      showModalBack,
      showBundleShareGoBack,
      showBundleWizardGoBack,
      centerStepLabel,
      topbarNavBackLabel: this.navBackLabel,
      topbarBundleWizardBackLabel,
    });
  }

  /** Sub-step count for details + quiz + preview (matches mobile), or bundle wizard steps; null when N/A. */
  private computeModalCenterStepLabel(): string | null {
    if (this.editingMaterialId) return null;
    if (this.viewMode === 'bundle-create' && this.bundleWizardLayoutActive && this.bundleWizardStepTotal > 0) {
      if (this.bundleWizardStepIndex === 0) return null;
      const contentSteps = this.bundleWizardStepTotal - 1;
      if (contentSteps <= 0) return null;
      return `${this.bundleWizardStepIndex}/${contentSteps}`;
    }
    if (this.viewMode !== 'create') return null;
    if (this.currentStep === 'type' || this.currentStep === 'pricing') return null;
    if (!this.selectedType || !this.selectedPricing) return null;
    const dLen = this.detailsWizardStepTotal;
    const subtotal = dLen + 2;
    if (this.currentStep === 'details') {
      if (this.detailsWizardLayoutActive && dLen > 0) {
        return `${this.detailsWizardStepIndex + 1}/${subtotal}`;
      }
      return `${this.stepNumber}/${this.totalSteps}`;
    }
    if (this.currentStep === 'quiz') {
      if (this.detailsWizardLayoutActive && dLen > 0) {
        return `${dLen + 1}/${subtotal}`;
      }
      return `${this.stepNumber}/${this.totalSteps}`;
    }
    if (this.currentStep === 'preview') {
      if (this.detailsWizardLayoutActive && dLen > 0) {
        return `${dLen + 2}/${subtotal}`;
      }
      return `${this.stepNumber}/${this.totalSteps}`;
    }
    return null;
  }

  previewMaterial(m: TutorMaterial) {
    sessionStorage.setItem('materialReferrer', '/tabs/home');
    sessionStorage.setItem('cmReturnSection', 'materials');
    if (this.inline && !this.platformService.isMobile()) {
      this.router.navigate(['/tabs/home/material', m._id]);
      return;
    }
    this.router.navigate(['/material', m._id]);
  }

  editMaterial(m: TutorMaterial) {
    this.editingMaterialId = m._id;
    this.editingMaterialStatus = m.status;
    this.selectedType = m.materialType;
    this.selectedPricing = m.pricingType;
    this.currentStep = 'details';

    // Pre-populate thumbnail
    this.thumbnailFile = null;
    this.thumbnailPreview = m.thumbnailUrl || null;
    this.existingThumbnailUrl = m.thumbnailUrl || null;

    // Pre-populate topics
    this.selectedTopics = m.topics ? [...m.topics] : [];
    this.selectedStructuredTags = m.structuredTags ? [...m.structuredTags] : [];

    this.materialForm.patchValue({
      title: m.title,
      description: m.description,
      whyTakeThis: m.whyTakeThis || '',
      language: m.language,
      level: m.level,
      videoUrl: m.videoUrl || '',
      passage: m.passage || '',
      audioUrl: m.audioUrl || '',
      price: m.price || 0
    });

    this.quizArray.clear();
    if (m.quiz?.length) {
      for (const q of m.quiz) {
        const qType = q.type || 'multiple_choice';

        const opts = this.fb.array(
          (q.options || []).map(o => this.fb.group({ text: [o.text, Validators.required], isCorrect: [o.isCorrect || false] }))
        );

        const acceptedAnswers = this.fb.array(
          (q.acceptedAnswers || []).map(a => this.fb.control(a, Validators.required))
        );
        if (qType === 'fill_blank' && acceptedAnswers.length === 0) {
          acceptedAnswers.push(this.fb.control('', Validators.required));
        }

        const correctOrder = this.fb.array(
          (q.correctOrder || []).map(item => this.fb.control(item, Validators.required))
        );
        if (qType === 'ordering' && correctOrder.length < 2) {
          while (correctOrder.length < 2) {
            correctOrder.push(this.fb.control('', Validators.required));
          }
        }

        this.quizArray.push(this.fb.group({
          type: [qType],
          question: [q.question, Validators.required],
          explanation: [q.explanation || ''],
          options: opts,
          acceptedAnswers: acceptedAnswers,
          correctAnswer: [q.correctAnswer ?? null],
          correctOrder: correctOrder
        }));
      }
    }

    if (m.videoUrl) this.parseVideoUrl(m.videoUrl);
    if (m.audioUrl) this.parseAudioUrl(m.audioUrl);

    this.viewMode = 'create';
    this.initDetailsWizard();
    this.updateNavState();
  }

  async confirmDelete(m: TutorMaterial) {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CREATE_MATERIAL.ALERT_DELETE_TITLE'),
      message: this.translate.instant('CREATE_MATERIAL.ALERT_DELETE_MSG', { title: m.title }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: () => {
            this.materialService.deleteMaterial(m._id).subscribe({
              next: async (res) => {
                if (res.success) {
                  await this.showTranslatedToast(res.softDeleted ? 'CREATE_MATERIAL.TOAST_SOFT_DELETED' : 'CREATE_MATERIAL.TOAST_DELETED');
                  this.loadMyMaterials();
                }
              },
              error: async () => await this.showTranslatedToast('CREATE_MATERIAL.TOAST_DELETE_FAILED')
            });
          }
        }
      ]
    });
    await alert.present();
  }

  async toggleArchive(m: TutorMaterial) {
    const isArchiving = m.status !== 'archived';
    const alert = await this.alertCtrl.create({
      header: this.translate.instant(isArchiving ? 'CREATE_MATERIAL.ALERT_ARCHIVE_TITLE' : 'CREATE_MATERIAL.ALERT_PUBLISH_TITLE'),
      message: this.translate.instant(isArchiving ? 'CREATE_MATERIAL.ALERT_ARCHIVE_MSG' : 'CREATE_MATERIAL.ALERT_PUBLISH_MSG', { title: m.title }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant(isArchiving ? 'CREATE_MATERIAL.ALERT_ARCHIVE_BTN' : 'CREATE_MATERIAL.ALERT_PUBLISH_BTN'),
          handler: () => {
            const newStatus = isArchiving ? 'archived' : 'published';
            this.materialService.updateMaterial(m._id, { status: newStatus } as any).subscribe({
              next: async (res) => {
                if (res.success) {
                  await this.showTranslatedToast(isArchiving ? 'CREATE_MATERIAL.TOAST_ARCHIVED' : 'CREATE_MATERIAL.TOAST_PUBLISHED');
                  this.loadMyMaterials();
                }
              },
              error: async () => await this.showTranslatedToast('CREATE_MATERIAL.TOAST_UPDATE_FAILED')
            });
          }
        }
      ]
    });
    await alert.present();
  }

  getMaterialTypeIcon(type: string): string {
    switch (type) {
      case 'video_quiz': return 'videocam-outline';
      case 'reading': return 'book-outline';
      case 'listening': return 'headset-outline';
      default: return 'document-outline';
    }
  }

  getMaterialTypeLabel(type: string): string {
    switch (type) {
      case 'video_quiz': return this.translate.instant('CREATE_MATERIAL.TYPE_VIDEO_QUIZ');
      case 'reading': return this.translate.instant('CREATE_MATERIAL.TYPE_READING');
      case 'listening': return this.translate.instant('CREATE_MATERIAL.TYPE_LISTENING');
      default: return '';
    }
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    const lang = this.translate.currentLang || 'en';
    const dateStr = d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
    return this.translate.instant('CREATE_MATERIAL.CARD_ADDED_DATE', { date: dateStr });
  }

  // ── Share links ─────────────────────────────────────────

  getShareLink(materialId: string): string {
    const base = window.location.origin;
    const ref = this.currentUserId || '';
    return `${base}/material/${materialId}${ref ? '?ref=' + ref : ''}`;
  }

  async copyShareLink(materialId: string) {
    const link = this.getShareLink(materialId);
    try {
      await navigator.clipboard.writeText(link);
      this.copiedLinkId = materialId;
      await this.showTranslatedToast('CREATE_MATERIAL.TOAST_LINK_COPIED');
      setTimeout(() => { this.copiedLinkId = null; }, 2500);
    } catch {
      await this.showTranslatedToast('CREATE_MATERIAL.TOAST_COPY_FAILED');
    }
  }

  dismissPublishBanner() {
    this.justPublishedId = null;
  }

  // ── Thumbnail ─────────────────────────────────────────
  // Card thumb uses 16:10 aspect ratio; crop uploads to fit perfectly.

  async onThumbnailSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.showTranslatedToast('CREATE_MATERIAL.TOAST_IMAGE_ONLY');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showTranslatedToast('CREATE_MATERIAL.TOAST_IMAGE_SIZE');
      event.target.value = '';
      return;
    }

    const modal = await this.modalCtrl.create({
      component: ImageCropperComponent,
      componentProps: {
        imageChangedEvent: event,
        aspectRatio: 16 / 10,
        cropTitle: 'Crop cover image'
      },
      cssClass: 'image-cropper-modal'
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'crop' && data) {
      const croppedFile = new File([data], file.name, { type: 'image/png' });
      this.thumbnailFile = croppedFile;
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.thumbnailPreview = e.target.result;
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(croppedFile);
    }
    event.target.value = '';
  }

  removeThumbnail() {
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.existingThumbnailUrl = null;
  }

  // ── Topic Methods ──────────────────────────────────────

  get availableSuggestions(): string[] {
    return this.topicSuggestions.filter(s => !this.selectedTopics.includes(s.toLowerCase()));
  }

  addTopic(event?: Event) {
    event?.preventDefault();
    const val = this.topicInput?.trim().toLowerCase();
    if (val && !this.selectedTopics.includes(val)) {
      this.selectedTopics.push(val);
    }
    this.topicInput = '';
  }

  removeTopic(index: number) {
    this.selectedTopics.splice(index, 1);
  }

  addSuggestedTopic(topic: string) {
    const val = topic.toLowerCase();
    if (!this.selectedTopics.includes(val)) {
      this.selectedTopics.push(val);
    }
  }

  private async uploadThumbnailToGCS(): Promise<string> {
    if (!this.thumbnailFile) return '';

    const currentUser = this.userService.getCurrentUserValue();
    if (!currentUser?.email) throw new Error('Not authenticated');

    const formData = new FormData();
    formData.append('thumbnail', this.thumbnailFile);

    const token = `Bearer dev-token-${currentUser.email.replace('@', '-').replace(/\./g, '-')}`;
    const headers = new HttpHeaders({ Authorization: token });

    const res: any = await this.http.post(
      `${environment.backendUrl}/api/materials/upload-thumbnail`,
      formData,
      { headers }
    ).toPromise();

    if (!res?.success) throw new Error('Upload failed');
    return res.imageUrl;
  }

  // ── Step flow ──────────────────────────────────────────

  private readonly stepOrder: Step[] = ['type', 'pricing', 'details', 'quiz', 'preview'];

  get stepNumber(): number {
    return this.stepOrder.indexOf(this.currentStep) + 1;
  }

  get totalSteps(): number {
    return this.stepOrder.length;
  }

  showVideoPolicy = false;
  videoPolicyDismissed = false;

  // Content ownership
  contentAttested = false;
  linkedChannels: LinkedChannels = {};
  isLoadingChannels = false;
  isSavingChannels = false;
  showChannelLinking = false;
  editingYouTube = false;
  editingVimeo = false;
  editingSoundCloud = false;
  isLinkingYouTube = false;
  isLinkingVimeo = false;

  selectType(type: MaterialType) {
    this.resumeBundleAfterMaterial = false;
    this.selectedType = type;
    this.selectedPricing = null;
    this.currentStep = 'pricing';
    this.updateNavState();
  }

  dismissVideoPolicy(dontShowAgain: boolean) {
    this.showVideoPolicy = false;
    if (dontShowAgain) {
      localStorage.setItem('hideVideoPolicy', '1');
    }
  }

  onTypeCardClick(event: MouseEvent, type: MaterialType) {
    const card = (event.currentTarget as HTMLElement);
    const srcRect = card.getBoundingClientRect();
    const label = this.getMaterialTypeLabel(type);

    const clone = document.createElement('div');
    const iconDiv = document.createElement('div');
    const iconBg =
      type === 'video_quiz'
        ? 'linear-gradient(160deg, #e8ecf4 0%, #f4f5f7 55%, #eceef4 100%)'
        : type === 'reading'
          ? 'linear-gradient(160deg, #e3f0ff 0%, #f0f7ff 100%)'
          : 'linear-gradient(160deg, #efe5ff 0%, #f8f4ff 100%)';
    Object.assign(iconDiv.style, {
      width: '76px', height: '76px', borderRadius: '20px', background: iconBg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
      transition: 'all 400ms cubic-bezier(0.32, 0.72, 0, 1)',
      boxSizing: 'border-box',
      padding: '10px',
    });
    if (type === 'video_quiz') {
      iconDiv.innerHTML =
        `<img src="assets/create-material-type-video-quiz.png" alt="" style="width:100%;height:100%;object-fit:contain;display:block;transition:all 400ms cubic-bezier(0.32,0.72,0,1)"/>`;
    } else if (type === 'reading') {
      iconDiv.innerHTML =
        `<img src="assets/create-material-type-reading.png" alt="" style="width:100%;height:100%;object-fit:contain;display:block;transition:all 400ms cubic-bezier(0.32,0.72,0,1)"/>`;
    } else {
      iconDiv.innerHTML =
        `<img src="assets/create-material-type-listening.png" alt="" style="width:100%;height:100%;object-fit:contain;display:block;transition:all 400ms cubic-bezier(0.32,0.72,0,1)"/>`;
    }

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    Object.assign(labelSpan.style, {
      transition: 'font-size 400ms cubic-bezier(0.32, 0.72, 0, 1)',
      whiteSpace: 'nowrap',
      fontSize: '16px',
      fontWeight: '600'
    });

    clone.appendChild(iconDiv);
    clone.appendChild(labelSpan);

    Object.assign(clone.style, {
      position: 'fixed',
      zIndex: '9999',
      top: `${srcRect.top}px`,
      left: `${srcRect.left}px`,
      width: `${srcRect.width}px`,
      height: `${srcRect.height}px`,
      background: '#fff',
      border: '1.5px solid #e0e0e0',
      borderRadius: '20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      padding: '32px 20px',
      color: '#222',
      pointerEvents: 'none',
      transition: 'all 400ms cubic-bezier(0.32, 0.72, 0, 1)',
      overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(0,0,0,0.10)'
    });

    document.body.appendChild(clone);

    this.selectType(type);
    this.cdr.detectChanges();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const dest = document.getElementById('cm-type-dest');
        if (!dest) {
          clone.style.opacity = '0';
          setTimeout(() => clone.remove(), 400);
          return;
        }

        dest.style.opacity = '0';
        const destRect = dest.getBoundingClientRect();

        Object.assign(clone.style, {
          top: `${destRect.top}px`,
          left: `${destRect.left}px`,
          width: `${destRect.width}px`,
          height: `${destRect.height}px`,
          borderRadius: '28px',
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: '10px 22px 10px 14px',
          gap: '10px',
          border: '1px solid #e8e8e8',
          background: '#f5f5f5',
          boxShadow: 'none'
        });

        const iconInClone = clone.querySelector('div') as HTMLElement;
        if (iconInClone) {
          Object.assign(iconInClone.style, {
            width: '38px', height: '38px', borderRadius: '0', background: 'transparent', padding: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          });
          const ionIcon = iconInClone.querySelector('ion-icon') as HTMLElement;
          if (ionIcon) ionIcon.style.fontSize = '38px';
          const raster = iconInClone.querySelector('img') as HTMLImageElement | null;
          if (raster) {
            Object.assign(raster.style, {
              width: '38px',
              height: '38px',
              objectFit: 'contain',
            });
          }
        }

        labelSpan.style.fontSize = '15px';

        setTimeout(() => {
          dest.style.transition = 'opacity 150ms ease';
          dest.style.opacity = '1';
          clone.style.opacity = '0';

          setTimeout(() => {
            clone.remove();
            dest.style.transition = '';
            dest.style.opacity = '';
          }, 180);
        }, 400);
      });
    });
  }

  selectPricing(pricing: 'free' | 'paid') {
    this.selectedPricing = pricing;
    if (pricing === 'free') {
      this.materialForm.patchValue({ price: 0 });
    }

    const desktopModalPricing =
      this.inline &&
      !this.platformService.isMobile() &&
      this.viewMode === 'create' &&
      !this.editingMaterialId;
    if (desktopModalPricing) {
      this.showVideoPolicy = false;
      this.emitDetailsModalFooterChrome();
      this.cdr.markForCheck();
      return;
    }

    if (pricing === 'paid' && this.selectedType === 'video_quiz' && !localStorage.getItem('hideVideoPolicy')) {
      this.showVideoPolicy = true;
      this.videoPolicyDismissed = false;
    } else {
      this.showVideoPolicy = false;
    }

    this.currentStep = 'details';
    this.initDetailsWizard();
    this.updateNavState();
  }

  /** Desktop modal: after Free/Paid choice, footer Next continues to details (matches bundle share flow). */
  private confirmMaterialPricingAndContinueToDetails(): void {
    if (this.selectedPricing === null) {
      void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
      return;
    }
    if (this.selectedPricing === 'paid' && this.selectedType === 'video_quiz' && !localStorage.getItem('hideVideoPolicy')) {
      this.showVideoPolicy = true;
      this.videoPolicyDismissed = false;
    } else {
      this.showVideoPolicy = false;
    }
    this.currentStep = 'details';
    this.initDetailsWizard();
    this.updateNavState();
  }

  /** Tab1 footer: disable Next until Free or Paid is selected (desktop modal pricing step). */
  get isMaterialPricingNextDisabled(): boolean {
    return (
      this.inline &&
      !this.platformService.isMobile() &&
      this.viewMode === 'create' &&
      this.currentStep === 'pricing' &&
      !this.editingMaterialId &&
      this.selectedPricing === null
    );
  }

  /** Tab1 footer: disable Next until Free or Paid is selected on bundle share (desktop modal). */
  get isBundleShareNextDisabled(): boolean {
    return (
      this.inline &&
      !this.platformService.isMobile() &&
      this.viewMode === 'bundle-create' &&
      this.bundleWizardLayoutActive &&
      this.bundleWizardStepId === 'bundleShare' &&
      this.bundlePricingType === null
    );
  }

  /**
   * Desktop modal: expand create-material container like the details sub-wizard so the pricing step
   * can use the same `cm-details-wizard` column as bundle share.
   */
  get createMaterialContainerDetailsWizardLayout(): boolean {
    if (!this.inline) return false;
    if (this.detailsWizardLayoutActive) return true;
    return (
      this.viewMode === 'create' &&
      this.currentStep === 'pricing' &&
      !this.editingMaterialId &&
      !this.platformService.isMobile()
    );
  }

  /** Pricing step DOM matches bundle wizard `bundleShare` (desktop inline modal only). */
  get materialPricingDesktopInlineWizard(): boolean {
    return (
      this.inline &&
      !this.platformService.isMobile() &&
      this.viewMode === 'create' &&
      this.currentStep === 'pricing' &&
      !this.editingMaterialId
    );
  }

  /** Desktop: no top step progress on type picker or share/pricing (clean intro steps). */
  get showMaterialCreateTopProgressBar(): boolean {
    if (this.editingMaterialId) return false;
    if (this.detailsWizardLayoutActive && this.currentStep === 'details') return false;
    if (
      this.viewMode === 'create' &&
      !this.platformService.isMobile() &&
      !this.editingMaterialId &&
      (this.currentStep === 'type' || this.currentStep === 'pricing')
    ) {
      return false;
    }
    return true;
  }

  goToQuizStep() {
    const titleCtrl = this.materialForm.get('title');
    const langCtrl = this.materialForm.get('language');

    if (titleCtrl?.invalid || langCtrl?.invalid) {
      titleCtrl?.markAsTouched();
      langCtrl?.markAsTouched();
      this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
      return;
    }

    if (this.selectedType === 'video_quiz' && !this.videoPreviewUrl) {
      this.showTranslatedToast('CREATE_MATERIAL.TOAST_VALID_VIDEO');
      return;
    }
    if (this.selectedType === 'reading') {
      const passageHtml = this.materialForm.value.passage || '';
      const stripped = passageHtml.replace(/<[^>]*>/g, '').trim();
      if (!stripped) {
        this.showTranslatedToast('CREATE_MATERIAL.TOAST_ENTER_PASSAGE');
        return;
      }
    }
    if (this.selectedType === 'listening' && !this.audioPreviewUrl) {
      this.showTranslatedToast('CREATE_MATERIAL.TOAST_VALID_AUDIO');
      return;
    }

    if (!this.thumbnailPreview) {
      this.showTranslatedToast('CREATE_MATERIAL.TOAST_ADD_COVER');
      return;
    }

    this.currentStep = 'quiz';
    this.updateNavState();
  }

  goToPreview() {
    const quizData = this.quizArray.value;
    for (let i = 0; i < quizData.length; i++) {
      const q = quizData[i];
      const num = i + 1;
      if (!q.question?.trim()) {
        this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_TEXT', { num });
        return;
      }

      const qType = q.type || 'multiple_choice';

      switch (qType) {
        case 'multiple_choice': {
          const filled = (q.options || []).filter((o: any) => o.text.trim());
          if (filled.length < 2) {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_OPTIONS', { num });
            return;
          }
          if (!filled.some((o: any) => o.isCorrect)) {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_CORRECT', { num });
            return;
          }
          break;
        }
        case 'fill_blank': {
          const answers = (q.acceptedAnswers || []).filter((a: string) => a?.trim());
          if (answers.length === 0) {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_ANSWER', { num });
            return;
          }
          break;
        }
        case 'true_false': {
          if (typeof q.correctAnswer !== 'boolean') {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_TF', { num });
            return;
          }
          break;
        }
        case 'ordering': {
          const items = (q.correctOrder || []).filter((item: string) => item?.trim());
          if (items.length < 2) {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_ITEMS', { num });
            return;
          }
          break;
        }
      }
    }
    this.currentStep = 'preview';
    this.previewVideoPlaying = false;
    this.updateNavState();
  }

  playPreviewVideo() {
    this.previewVideoPlaying = true;
  }

  goBack() {
    const idx = this.stepOrder.indexOf(this.currentStep);
    if (idx > 0) {
      this.currentStep = this.stepOrder[idx - 1];
      this.updateNavState();
    }
  }

  // ── Video URL parsing ──────────────────────────────────

  parseVideoUrl(url: string) {
    if (!url) {
      this.videoPreviewUrl = null;
      this.videoAutoplayUrl = null;
      this.videoThumbnail = null;
      return;
    }

    const ytPatterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    ];
    for (const pat of ytPatterns) {
      const m = url.match(pat);
      if (m) {
        this.videoPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
          `https://www.youtube.com/embed/${m[1]}?modestbranding=1&rel=0&showinfo=0`
        );
        this.videoAutoplayUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
          `https://www.youtube.com/embed/${m[1]}?modestbranding=1&rel=0&showinfo=0&autoplay=1`
        );
        this.videoThumbnail = `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
        return;
      }
    }

    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      this.videoPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://player.vimeo.com/video/${vimeoMatch[1]}?title=0&byline=0&portrait=0`
      );
      this.videoAutoplayUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://player.vimeo.com/video/${vimeoMatch[1]}?title=0&byline=0&portrait=0&autoplay=1`
      );
      this.videoThumbnail = null;
      return;
    }

    this.videoPreviewUrl = null;
    this.videoAutoplayUrl = null;
    this.videoThumbnail = null;
  }

  // ── Audio URL parsing ──────────────────────────────────

  parseAudioUrl(url: string) {
    if (!url) {
      this.audioPreviewUrl = null;
      this.audioProviderType = null;
      return;
    }

    // Reject YouTube and Vimeo — those belong in Video Quiz
    if (/youtube\.com|youtu\.be/i.test(url) || /vimeo\.com/i.test(url)) {
      this.audioPreviewUrl = null;
      this.audioProviderType = null;
      return;
    }

    // SoundCloud
    if (url.includes('soundcloud.com/')) {
      this.audioProviderType = 'soundcloud';
      this.audioPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`
      );
      return;
    }

    // Spotify
    const spotifyMatch = url.match(/open\.spotify\.com\/(episode|track)\/([a-zA-Z0-9]+)/);
    if (spotifyMatch) {
      this.audioProviderType = 'spotify';
      this.audioPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}`
      );
      return;
    }

    // Direct audio files
    if (/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i.test(url)) {
      this.audioProviderType = 'direct';
      this.audioPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      return;
    }

    this.audioPreviewUrl = null;
    this.audioProviderType = null;
  }

  // ── Quiz builder ───────────────────────────────────────

  questionTypes: { value: QuestionType; label: string; icon: string }[] = [];

  addQuestion(type: QuestionType = 'multiple_choice') {
    let group: FormGroup;

    switch (type) {
      case 'fill_blank':
        group = this.fb.group({
          type: [type],
          question: ['', Validators.required],
          explanation: [''],
          options: this.fb.array([]),
          acceptedAnswers: this.fb.array([this.fb.control('', Validators.required)]),
          correctAnswer: [null],
          correctOrder: this.fb.array([])
        });
        break;

      case 'true_false':
        group = this.fb.group({
          type: [type],
          question: ['', Validators.required],
          explanation: [''],
          options: this.fb.array([]),
          acceptedAnswers: this.fb.array([]),
          correctAnswer: [true],
          correctOrder: this.fb.array([])
        });
        break;

      case 'ordering':
        group = this.fb.group({
          type: [type],
          question: ['', Validators.required],
          explanation: [''],
          options: this.fb.array([]),
          acceptedAnswers: this.fb.array([]),
          correctAnswer: [null],
          correctOrder: this.fb.array([
            this.fb.control('', Validators.required),
            this.fb.control('', Validators.required)
          ])
        });
        break;

      default:
        group = this.fb.group({
          type: ['multiple_choice'],
          question: ['', Validators.required],
          explanation: [''],
          options: this.fb.array([
            this.createOption(true),
            this.createOption()
          ]),
          acceptedAnswers: this.fb.array([]),
          correctAnswer: [null],
          correctOrder: this.fb.array([])
        });
        break;
    }

    this.quizArray.push(group);
  }

  getQuestionType(qi: number): QuestionType {
    return this.quizArray.at(qi).get('type')?.value || 'multiple_choice';
  }

  getQuestionTypeLabel(type: QuestionType): string {
    return this.questionTypes.find(t => t.value === type)?.label || this.translate.instant('CREATE_MATERIAL.QUIZ_MC');
  }

  getQuestionTypeIcon(type: QuestionType): string {
    return this.questionTypes.find(t => t.value === type)?.icon || 'list-outline';
  }

  private createOption(isCorrect = false): FormGroup {
    return this.fb.group({
      text: ['', Validators.required],
      isCorrect: [isCorrect]
    });
  }

  getOptions(questionIndex: number): FormArray {
    return this.quizArray.at(questionIndex).get('options') as FormArray;
  }

  addOption(questionIndex: number) {
    const opts = this.getOptions(questionIndex);
    if (opts.length >= 6) return;
    opts.push(this.createOption());
  }

  removeOption(questionIndex: number, optionIndex: number) {
    const opts = this.getOptions(questionIndex);
    if (opts.length <= 2) return;
    opts.removeAt(optionIndex);
  }

  removeQuestion(index: number) {
    this.quizArray.removeAt(index);
  }

  setCorrectAnswer(questionIndex: number, optionIndex: number) {
    const opts = this.getOptions(questionIndex);
    for (let i = 0; i < opts.length; i++) {
      opts.at(i).patchValue({ isCorrect: i === optionIndex });
    }
  }

  // Fill-in-the-blank helpers
  getAcceptedAnswers(qi: number): FormArray {
    return this.quizArray.at(qi).get('acceptedAnswers') as FormArray;
  }

  addAcceptedAnswer(qi: number) {
    this.getAcceptedAnswers(qi).push(this.fb.control('', Validators.required));
  }

  removeAcceptedAnswer(qi: number, ai: number) {
    const arr = this.getAcceptedAnswers(qi);
    if (arr.length <= 1) return;
    arr.removeAt(ai);
  }

  // True/false helper
  setTrueFalseAnswer(qi: number, val: boolean) {
    this.quizArray.at(qi).get('correctAnswer')?.setValue(val);
  }

  getTrueFalseAnswer(qi: number): boolean {
    return this.quizArray.at(qi).get('correctAnswer')?.value ?? true;
  }

  // Ordering helpers
  getOrderItems(qi: number): FormArray {
    return this.quizArray.at(qi).get('correctOrder') as FormArray;
  }

  addOrderItem(qi: number) {
    this.getOrderItems(qi).push(this.fb.control('', Validators.required));
  }

  removeOrderItem(qi: number, ii: number) {
    const arr = this.getOrderItems(qi);
    if (arr.length <= 2) return;
    arr.removeAt(ii);
  }

  moveOrderItem(qi: number, fromIndex: number, direction: 'up' | 'down') {
    const arr = this.getOrderItems(qi);
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= arr.length) return;
    const item = arr.at(fromIndex);
    const val = item.value;
    arr.removeAt(fromIndex);
    arr.insert(toIndex, this.fb.control(val, Validators.required));
  }

  reorderOrderItems(qi: number, event: any) {
    const arr = this.getOrderItems(qi);
    const from = event.detail.from;
    const to = event.detail.to;
    const val = arr.at(from).value;
    arr.removeAt(from);
    arr.insert(to, this.fb.control(val, Validators.required));
    event.detail.complete(false);
  }

  // ── Price slider ──────────────────────────────────────

  pricePin = (value: number) => `$${value}`;

  onPriceSliderChange(event: any) {
    const val = event.detail.value;
    this.materialForm.patchValue({ price: val });
  }

  // ── Channel Linking ────────────────────────────────────

  loadLinkedChannels() {
    this.isLoadingChannels = true;
    this.materialService.getLinkedChannels().subscribe({
      next: (res) => {
        this.isLoadingChannels = false;
        if (res.success) this.linkedChannels = res.linkedChannels || {};
        this.updateVideoChannelStatus();
        this.cdr.detectChanges();
      },
      error: () => { this.isLoadingChannels = false; this.cdr.detectChanges(); }
    });
  }

  saveLinkedChannels() {
    this.isSavingChannels = true;
    this.materialService.updateLinkedChannels(this.linkedChannels).subscribe({
      next: async (res) => {
        this.isSavingChannels = false;
        if (res.success) {
          this.linkedChannels = res.linkedChannels;
          this.editingYouTube = false;
          this.editingVimeo = false;
          this.editingSoundCloud = false;
          if (!this.linkedChannels.youtubeChannelName && this.linkedChannels.youtubeChannelUrl) {
            await this.showTranslatedToast('CREATE_MATERIAL.TOAST_YT_URL_WARNING');
          } else {
            await this.showTranslatedToast('CREATE_MATERIAL.TOAST_CHANNELS_SAVED');
          }
        }
      },
      error: async () => {
        this.isSavingChannels = false;
        await this.showTranslatedToast('CREATE_MATERIAL.TOAST_CHANNELS_SAVE_FAILED');
      }
    });
  }

  hasLinkedChannel(): boolean {
    return !!(this.linkedChannels.youtubeChannelUrl || this.linkedChannels.vimeoChannelUrl || this.linkedChannels.soundcloudProfileUrl);
  }

  hasVideoChannel = false;

  private updateVideoChannelStatus() {
    this.hasVideoChannel = !!(
      (this.linkedChannels.youtubeChannelName && this.linkedChannels.youtubeVerified) ||
      (this.linkedChannels.vimeoChannelName && this.linkedChannels.vimeoVerified)
    );
  }

  linkYouTube() {
    this.isLinkingYouTube = true;
    this.materialService.getYouTubeAuthUrl().subscribe({
      next: (res) => {
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.innerWidth - width) / 2;
        const top = window.screenY + (window.innerHeight - height) / 2;
        const popup = window.open(
          res.url,
          'youtube-auth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
        );

        let messageReceived = false;

        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'youtube_linked') return;
          messageReceived = true;
          window.removeEventListener('message', onMessage);
          this.isLinkingYouTube = false;

          if (event.data.success) {
            this.loadLinkedChannels();
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_YT_LINKED');
          } else {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_YT_LINK_FAILED');
          }
          this.cdr.detectChanges();
        };
        window.addEventListener('message', onMessage);

        const checkClosed = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', onMessage);
            this.isLinkingYouTube = false;
            if (!messageReceived) {
              this.loadLinkedChannels();
            }
            this.cdr.detectChanges();
          }
        }, 500);
      },
      error: async (err) => {
        this.isLinkingYouTube = false;
        console.error('YouTube auth URL error:', err);
        await this.showTranslatedToast('CREATE_MATERIAL.TOAST_YT_START_FAILED');
      }
    });
  }

  async unlinkYouTube() {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CREATE_MATERIAL.ALERT_UNLINK_YT_TITLE'),
      message: this.translate.instant('CREATE_MATERIAL.ALERT_UNLINK_YT_MSG'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CREATE_MATERIAL.ALERT_UNLINK_BTN'),
          role: 'destructive',
          handler: () => {
            this.materialService.unlinkYouTube().subscribe({
              next: () => {
                this.linkedChannels.youtubeChannelId = null;
                this.linkedChannels.youtubeChannelUrl = null;
                this.linkedChannels.youtubeChannelName = null;
                this.linkedChannels.youtubeChannelAvatar = null;
                this.linkedChannels.youtubeSubscriberCount = null;
                this.linkedChannels.youtubeVerified = false;
                this.updateVideoChannelStatus();
                this.showTranslatedToast('CREATE_MATERIAL.TOAST_YT_UNLINKED');
              },
              error: () => this.showTranslatedToast('CREATE_MATERIAL.TOAST_YT_UNLINK_FAILED')
            });
          }
        }
      ]
    });
    alert.present();
  }

  linkVimeo() {
    this.isLinkingVimeo = true;
    this.materialService.getVimeoAuthUrl().subscribe({
      next: (res) => {
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.innerWidth - width) / 2;
        const top = window.screenY + (window.innerHeight - height) / 2;
        const popup = window.open(
          res.url,
          'vimeo-auth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
        );

        let messageReceived = false;

        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'vimeo_linked') return;
          messageReceived = true;
          window.removeEventListener('message', onMessage);
          this.isLinkingVimeo = false;

          if (event.data.success) {
            this.loadLinkedChannels();
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_VIMEO_LINKED');
          } else {
            this.showTranslatedToast('CREATE_MATERIAL.TOAST_VIMEO_LINK_FAILED');
          }
          this.cdr.detectChanges();
        };
        window.addEventListener('message', onMessage);

        const checkClosed = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', onMessage);
            this.isLinkingVimeo = false;
            if (!messageReceived) {
              this.loadLinkedChannels();
            }
            this.cdr.detectChanges();
          }
        }, 500);
      },
      error: async () => {
        this.isLinkingVimeo = false;
        await this.showTranslatedToast('CREATE_MATERIAL.TOAST_VIMEO_START_FAILED');
      }
    });
  }

  async unlinkVimeo() {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CREATE_MATERIAL.ALERT_UNLINK_VIMEO_TITLE'),
      message: this.translate.instant('CREATE_MATERIAL.ALERT_UNLINK_VIMEO_MSG'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CREATE_MATERIAL.ALERT_UNLINK_BTN'),
          role: 'destructive',
          handler: () => {
            this.materialService.unlinkVimeo().subscribe({
              next: () => {
                this.linkedChannels.vimeoChannelId = null;
                this.linkedChannels.vimeoChannelUrl = null;
                this.linkedChannels.vimeoChannelName = null;
                this.linkedChannels.vimeoChannelAvatar = null;
                this.linkedChannels.vimeoVerified = false;
                this.updateVideoChannelStatus();
                this.showTranslatedToast('CREATE_MATERIAL.TOAST_VIMEO_UNLINKED');
              },
              error: () => this.showTranslatedToast('CREATE_MATERIAL.TOAST_VIMEO_UNLINK_FAILED')
            });
          }
        }
      ]
    });
    alert.present();
  }

  getReviewStatusLabel(status: string | undefined): string {
    switch (status) {
      case 'pending_review': return 'Pending Review';
      case 'approved': return 'Verified';
      case 'rejected': return 'Rejected';
      case 'auto_approved': return 'Auto-approved';
      default: return '';
    }
  }

  // ── Submit ─────────────────────────────────────────────

  /** Desktop modal footer: save progress without full publish validation. */
  async saveMaterialDraft(): Promise<void> {
    if (this.isSavingMaterialDraft || this.isSubmitting) return;
    if (!this.selectedType || this.selectedPricing === null) {
      void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
      return;
    }

    const savingPublishedEdit =
      !!this.editingMaterialId && this.editingMaterialStatus === 'published';
    const wasNew = !this.editingMaterialId;

    this.isSavingMaterialDraft = true;
    this.cdr.markForCheck();

    let thumbnailUrl = this.existingThumbnailUrl || '';
    if (this.thumbnailFile) {
      try {
        this.isUploadingThumbnail = true;
        this.cdr.markForCheck();
        thumbnailUrl = await this.uploadThumbnailToGCS();
        this.isUploadingThumbnail = false;
        this.existingThumbnailUrl = thumbnailUrl;
        this.thumbnailPreview = thumbnailUrl || this.thumbnailPreview;
        this.thumbnailFile = null;
      } catch {
        this.isUploadingThumbnail = false;
        this.isSavingMaterialDraft = false;
        this.cdr.markForCheck();
        await this.showTranslatedToast('CREATE_MATERIAL.TOAST_UPLOAD_FAILED');
        return;
      }
    }

    const quizData = this.quizArray.value as QuizQuestion[];
    const payload: CreateMaterialPayload = {
      title: (this.materialForm.value.title || '').trim() || 'Untitled draft',
      description: this.materialForm.value.description || '',
      whyTakeThis: this.materialForm.value.whyTakeThis || '',
      language: (this.materialForm.value.language || '').trim() || 'English',
      level: this.materialForm.value.level || 'any',
      topics: this.selectedTopics.length > 0 ? this.selectedTopics : undefined,
      structuredTags: this.selectedStructuredTags.length > 0 ? this.selectedStructuredTags : undefined,
      materialType: this.selectedType,
      pricingType: this.selectedPricing,
      price: this.selectedPricing === 'paid' ? Number(this.materialForm.value.price) || 0 : 0,
      quiz: Array.isArray(quizData) ? quizData : [],
      thumbnailUrl: thumbnailUrl?.trim() || undefined,
      status: 'draft'
    };
    payload.contentAttested = this.contentAttested;

    if (this.selectedType === 'video_quiz') {
      payload.videoUrl = this.materialForm.value.videoUrl;
    }
    if (this.selectedType === 'reading') {
      payload.passage = this.materialForm.value.passage;
    }
    if (this.selectedType === 'listening') {
      payload.audioUrl = this.materialForm.value.audioUrl;
    }

    if (savingPublishedEdit) {
      delete (payload as { status?: string }).status;
    }

    const request$ = this.editingMaterialId
      ? this.materialService.updateMaterial(this.editingMaterialId, payload as any)
      : this.materialService.createMaterial(payload);

    request$.subscribe({
      next: async (res: any) => {
        this.isSavingMaterialDraft = false;
        if (res.success) {
          if (wasNew && res.material?._id) {
            this.editingMaterialId = res.material._id;
            this.editingMaterialStatus =
              (res.material.status as TutorMaterial['status']) || 'draft';
          }
          this.loadMyMaterials();
          this.emitDetailsModalFooterChrome();
          await this.showTranslatedToast(
            savingPublishedEdit
              ? 'CREATE_MATERIAL.TOAST_MATERIAL_UPDATED'
              : 'CREATE_MATERIAL.TOAST_MATERIAL_DRAFT_SAVED'
          );
        }
        this.cdr.markForCheck();
      },
      error: async () => {
        this.isSavingMaterialDraft = false;
        this.cdr.markForCheck();
        await this.showTranslatedToast('CREATE_MATERIAL.TOAST_SAVE_FAILED');
      }
    });
  }

  async submit() {
    if (this.isSubmitting) return;

    // Auto-remove empty trailing options for multiple choice
    for (let qi = this.quizArray.length - 1; qi >= 0; qi--) {
      if (this.getQuestionType(qi) === 'multiple_choice') {
        const opts = this.getOptions(qi);
        for (let oi = opts.length - 1; oi >= 0; oi--) {
          const text = (opts.at(oi).get('text')?.value || '').trim();
          if (!text && opts.length > 2) {
            opts.removeAt(oi);
          }
        }
      }
    }

    const quizData = this.quizArray.value;
    for (let i = 0; i < quizData.length; i++) {
      const q = quizData[i];
      const num = i + 1;
      if (!q.question?.trim()) { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_TEXT', { num }); return; }

      const qType = q.type || 'multiple_choice';
      switch (qType) {
        case 'multiple_choice': {
          const filledOptions = (q.options || []).filter((o: any) => o.text.trim());
          if (filledOptions.length < 2) { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_OPTIONS', { num }); return; }
          if (!filledOptions.some((o: any) => o.isCorrect)) { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_CORRECT', { num }); return; }
          if ((q.options || []).some((o: any) => !o.text.trim())) { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_EMPTY_OPTION', { num }); return; }
          break;
        }
        case 'fill_blank': {
          const answers = (q.acceptedAnswers || []).filter((a: string) => a?.trim());
          if (answers.length === 0) { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_ANSWER', { num }); return; }
          break;
        }
        case 'true_false': {
          if (typeof q.correctAnswer !== 'boolean') { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_TF', { num }); return; }
          break;
        }
        case 'ordering': {
          const items = (q.correctOrder || []).filter((item: string) => item?.trim());
          if (items.length < 2) { this.showTranslatedToast('CREATE_MATERIAL.TOAST_Q_NEEDS_ITEMS', { num }); return; }
          break;
        }
      }
    }

    this.isSubmitting = true;

    // Upload thumbnail if a new file was selected
    let thumbnailUrl = this.existingThumbnailUrl || '';
    if (this.thumbnailFile) {
      try {
        this.isUploadingThumbnail = true;
        thumbnailUrl = await this.uploadThumbnailToGCS();
        this.isUploadingThumbnail = false;
      } catch (err) {
        this.isUploadingThumbnail = false;
        this.isSubmitting = false;
        await this.showTranslatedToast('CREATE_MATERIAL.TOAST_UPLOAD_FAILED');
        return;
      }
    }

    if (!thumbnailUrl?.trim()) {
      this.isSubmitting = false;
      await this.showTranslatedToast('CREATE_MATERIAL.TOAST_ADD_COVER');
      return;
    }

    const payload: CreateMaterialPayload = {
      title: this.materialForm.value.title,
      description: this.materialForm.value.description,
      whyTakeThis: this.materialForm.value.whyTakeThis || '',
      language: this.materialForm.value.language,
      level: this.materialForm.value.level,
      topics: this.selectedTopics.length > 0 ? this.selectedTopics : undefined,
      structuredTags: this.selectedStructuredTags.length > 0 ? this.selectedStructuredTags : undefined,
      materialType: this.selectedType!,
      pricingType: this.selectedPricing!,
      price: this.selectedPricing === 'paid' ? this.materialForm.value.price : 0,
      quiz: quizData,
      thumbnailUrl
    };

    payload.contentAttested = this.contentAttested;

    if (this.selectedType === 'video_quiz') {
      payload.videoUrl = this.materialForm.value.videoUrl;
    }
    if (this.selectedType === 'reading') {
      payload.passage = this.materialForm.value.passage;
    }
    if (this.selectedType === 'listening') {
      payload.audioUrl = this.materialForm.value.audioUrl;
    }

    const request$ = this.editingMaterialId
      ? this.materialService.updateMaterial(this.editingMaterialId, payload as any)
      : this.materialService.createMaterial(payload);

    const isEditing = !!this.editingMaterialId;

    // Capture preview card rect for FLIP animation
    let srcRect: DOMRect | null = null;
    if (!isEditing) {
      const previewCard = document.querySelector('.cm-preview-card') as HTMLElement;
      if (previewCard) {
        srcRect = previewCard.getBoundingClientRect();
      }
    }

    request$.subscribe({
      next: async (res: any) => {
        this.isSubmitting = false;
        if (res.success) {
          const publishedId = !isEditing && res.material?._id ? res.material._id : null;
          this.resetForm();
          this.viewMode = 'library';
          this.updateNavState();
          this.loadMyMaterials();
          if (publishedId) {
            this.justPublishedId = publishedId;
          }

          if (srcRect && !isEditing) {
            this.animatePublish(srcRect);
          } else {
            await this.showTranslatedToast(isEditing ? 'CREATE_MATERIAL.TOAST_MATERIAL_UPDATED' : 'CREATE_MATERIAL.TOAST_MATERIAL_PUBLISHED');
          }
        }
      },
      error: async (err) => {
        this.isSubmitting = false;
        await this.showToast(err?.error?.message || this.translate.instant('CREATE_MATERIAL.TOAST_SAVE_FAILED'));
      }
    });
  }

  private resetForm() {
    this.editingMaterialStatus = null;
    this.selectedType = null;
    this.selectedPricing = null;
    this.currentStep = 'type';
    this.materialForm.reset({ level: 'any', price: 0 });
    this.quizArray.clear();
    this.videoPreviewUrl = null;
    this.videoAutoplayUrl = null;
    this.videoThumbnail = null;
    this.audioPreviewUrl = null;
    this.audioProviderType = null;
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.existingThumbnailUrl = null;
    this.isUploadingThumbnail = false;
    this.contentAttested = false;
    this.selectedTopics = [];
    this.selectedStructuredTags = [];
    this.topicInput = '';
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'bottom' });
    await toast.present();
  }

  private async showTranslatedToast(key: string, params?: Record<string, any>) {
    const message = this.translate.instant(key, params);
    await this.showToast(message);
  }

  // ── Publish FLIP animation ─────────────────────────────

  private animatePublish(srcRect: DOMRect) {
    const clone = document.createElement('div');
    Object.assign(clone.style, {
      position: 'fixed',
      zIndex: '9999',
      top: `${srcRect.top}px`,
      left: `${srcRect.left}px`,
      width: `${srcRect.width}px`,
      height: `${srcRect.height}px`,
      background: '#fff',
      border: '1.5px solid #e5e5e5',
      borderRadius: '16px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
      pointerEvents: 'none',
      transition: 'all 500ms cubic-bezier(0.32, 0.72, 0, 1)',
      overflow: 'hidden',
      opacity: '1'
    });

    document.body.appendChild(clone);

    this.cdr.detectChanges();

    const pollForDest = (attempts: number) => {
      requestAnimationFrame(() => {
        const dest = document.querySelector('.cm-material-card') as HTMLElement;
        if (dest) {
          const destRect = dest.getBoundingClientRect();

          requestAnimationFrame(() => {
            Object.assign(clone.style, {
              top: `${destRect.top}px`,
              left: `${destRect.left}px`,
              width: `${destRect.width}px`,
              height: `${destRect.height}px`,
              boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
              borderRadius: '16px'
            });

            setTimeout(() => {
              clone.style.opacity = '0';
              setTimeout(() => clone.remove(), 200);
            }, 500);
          });
        } else if (attempts < 10) {
          setTimeout(() => pollForDest(attempts + 1), 50);
        } else {
          clone.style.opacity = '0';
          setTimeout(() => clone.remove(), 300);
        }
      });
    };

    setTimeout(() => pollForDest(0), 50);
  }

  // ── Preview helpers ────────────────────────────────────

  get previewQuiz(): QuizQuestion[] { return this.quizArray.value; }
  get formTitle(): string { return this.materialForm.value.title || 'Untitled'; }
  get formDescription(): string { return this.materialForm.value.description || ''; }
  get formLanguage(): string { return this.materialForm.value.language || ''; }
  get formPrice(): number { return this.materialForm.value.price || 0; }
  get formPassage(): string { return this.materialForm.value.passage || ''; }

  get formLevel(): string {
    const lvl = this.materialForm.value.level;
    return this.levels.find(l => l.value === lvl)?.label || this.translate.instant('CREATE_MATERIAL.LEVEL_ALL');
  }

  get detailsTitle(): string {
    switch (this.selectedType) {
      case 'video_quiz': return this.translate.instant('CREATE_MATERIAL.DETAILS_VIDEO_TITLE');
      case 'reading': return this.translate.instant('CREATE_MATERIAL.DETAILS_READING_TITLE');
      case 'listening': return this.translate.instant('CREATE_MATERIAL.DETAILS_LISTENING_TITLE');
      default: return '';
    }
  }

  get detailsDesc(): string {
    switch (this.selectedType) {
      case 'video_quiz': return this.translate.instant('CREATE_MATERIAL.DETAILS_VIDEO_DESC');
      case 'reading': return this.translate.instant('CREATE_MATERIAL.DETAILS_READING_DESC');
      case 'listening': return this.translate.instant('CREATE_MATERIAL.DETAILS_LISTENING_DESC');
      default: return '';
    }
  }

  get typeLabel(): string {
    switch (this.selectedType) {
      case 'video_quiz': return this.translate.instant('CREATE_MATERIAL.TYPE_VIDEO_QUIZ');
      case 'reading': return this.translate.instant('CREATE_MATERIAL.TYPE_READING');
      case 'listening': return this.translate.instant('CREATE_MATERIAL.TYPE_LISTENING');
      default: return '';
    }
  }

  // ── Bundle Management ─────────────────────────────────────────

  switchLibraryTab(tab: 'materials' | 'bundles') {
    this.libraryTab = tab;
    this.showMaterialsList = false;
    this.showBundlesList = false;

    const libEl = document.querySelector('.cm-library');
    if (libEl) libEl.scrollTop = 0;

    if (tab === 'bundles' && this.myBundles.length === 0 && !this.isLoadingBundles) {
      this.loadBundles();
    }
    this.emitModalSidebarTabSync(tab);
  }

  openMaterialsList() {
    this.libraryTab = 'materials';
    this.showMaterialsList = true;
    this.showBundlesList = false;
    this.modalExpandEvent.emit(true);
    this.emitModalSidebarTabSync('materials');
    this.syncModalTopbarChrome();
    const libEl = document.querySelector('.cm-library');
    if (libEl) libEl.scrollTop = 0;
  }

  openBundlesList() {
    this.libraryTab = 'bundles';
    this.showBundlesList = true;
    this.showMaterialsList = false;
    this.modalExpandEvent.emit(true);
    this.emitModalSidebarTabSync('bundles');
    this.syncModalTopbarChrome();
    const libEl = document.querySelector('.cm-library');
    if (libEl) libEl.scrollTop = 0;
  }

  /** List → split gateway: shrink desktop modal + refresh tab1 chrome via onModalExpand(false). */
  closeMaterialsListToGateway(): void {
    this.showMaterialsList = false;
    this.updateNavState();
    if (this.inline) {
      this.modalExpandEvent.emit(false);
    }
  }

  closeBundlesListToGateway(): void {
    this.showBundlesList = false;
    this.updateNavState();
    if (this.inline) {
      this.modalExpandEvent.emit(false);
    }
  }

  /** Sticky-header Back (desktop modal): returns to split gateway with shrink animation. */
  closeActiveListToGateway(): void {
    if (this.showMaterialsList) {
      this.closeMaterialsListToGateway();
    } else if (this.showBundlesList) {
      this.closeBundlesListToGateway();
    }
  }

  loadBundles() {
    this.isLoadingBundles = true;
    this.cdr.detectChanges();
    this.bundleService.getMyBundles().subscribe({
      next: (bundles) => {
        this.myBundles = bundles || [];
        this.isLoadingBundles = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.myBundles = [];
        this.isLoadingBundles = false;
        this.cdr.detectChanges();
      }
    });
  }

  /** From bundle (no published materials): open material create at the type step; toolbar back returns to the bundle wizard. */
  goToCreateMaterialFromBundle(): void {
    this.resumeBundleAfterMaterial = true;
    this.editingMaterialId = null;
    this.viewMode = 'create';
    this.resetForm();
    this.updateNavState();
    this.modalExpandEvent.emit(true);
    this.loadMyMaterials();
    this.emitModalSidebarTabSync('materials');
  }

  startCreateBundle() {
    this.resetBundleWizardState();
    this.editingBundleId = null;
    this.bundleTitle = '';
    this.bundleDescription = '';
    this.bundleLanguage = this.languages[0] || 'English';
    this.bundleLevel = 'any';
    this.bundlePricingType = null;
    this.bundlePrice = 0;
    this.bundleStructuredTags = [];
    this.bundleSelectedMaterialIds = [];
    this.bundleCoverFile = null;
    this.bundleCoverPreview = null;
    this.bundleCoverUrl = null;
    this.libraryTab = 'bundles';
    this.viewMode = 'bundle-create';
    this.updateNavState();
    this.modalExpandEvent.emit(true);
    this.emitModalSidebarTabSync('bundles');
  }

  editBundle(bundle: ContentBundle) {
    this.resetBundleWizardState();
    this.editingBundleId = bundle._id;
    this.bundleTitle = bundle.title;
    this.bundleDescription = bundle.description || '';
    this.bundleLanguage = bundle.language;
    this.bundleLevel = bundle.level;
    this.bundlePricingType = bundle.pricingType;
    this.bundlePrice = bundle.price;
    this.bundleStructuredTags = [...bundle.structuredTags];
    this.bundleSelectedMaterialIds = bundle.items.map(i => typeof i.materialId === 'string' ? i.materialId : (i.materialId as any)?._id);
    this.bundleCoverFile = null;
    this.bundleCoverPreview = bundle.coverImageUrl || null;
    this.bundleCoverUrl = bundle.coverImageUrl || null;
    this.libraryTab = 'bundles';
    this.viewMode = 'bundle-create';
    this.modalExpandEvent.emit(true);
    this.updateNavState();
    this.emitModalSidebarTabSync('bundles');
  }

  isMaterialInBundle(materialId: string): boolean {
    return this.bundleSelectedMaterialIds.includes(materialId);
  }

  toggleMaterialInBundle(materialId: string) {
    const idx = this.bundleSelectedMaterialIds.indexOf(materialId);
    if (idx >= 0) {
      this.bundleSelectedMaterialIds = this.bundleSelectedMaterialIds.filter(id => id !== materialId);
    } else {
      this.bundleSelectedMaterialIds = [...this.bundleSelectedMaterialIds, materialId];
    }
  }

  get publishedMaterials(): TutorMaterial[] {
    return this.myMaterials.filter(m => m.status === 'published' || m.status === 'draft');
  }

  get selectedPaidMaterials(): TutorMaterial[] {
    return this.myMaterials.filter(m =>
      this.bundleSelectedMaterialIds.includes(m._id) && m.pricingType === 'paid'
    );
  }

  get bundlePaidMaterialsValue(): number {
    return this.selectedPaidMaterials.reduce((sum, m) => sum + (m.price || 0), 0);
  }

  get hasPaidMaterialsInFreeBundle(): boolean {
    return this.bundlePricingType === 'free' && this.selectedPaidMaterials.length > 0;
  }

  onBundleCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    this.bundleCoverFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.bundleCoverPreview = reader.result as string;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  removeBundleCover() {
    this.bundleCoverFile = null;
    this.bundleCoverPreview = null;
    this.bundleCoverUrl = null;
  }

  private async uploadBundleCover(): Promise<string | null> {
    if (!this.bundleCoverFile) return this.bundleCoverUrl;
    this.isUploadingBundleCover = true;
    try {
      const res = await this.bundleService.uploadCover(this.bundleCoverFile).toPromise();
      this.isUploadingBundleCover = false;
      const url = (res as any)?.url || (res as any)?.coverImageUrl || null;
      if (!url) {
        const toast = await this.toastCtrl.create({ message: 'Cover image upload returned no URL', duration: 3000, color: 'warning' });
        await toast.present();
      }
      return url;
    } catch (err: any) {
      this.isUploadingBundleCover = false;
      const toast = await this.toastCtrl.create({ message: 'Cover upload failed — bundle will save without image', duration: 3000, color: 'warning' });
      await toast.present();
      return this.bundleCoverUrl;
    }
  }

  async saveBundle() {
    if (!this.bundleTitle.trim() || !this.bundleLanguage) return;
    if (this.bundlePricingType === null) {
      void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
      return;
    }
    if (this.bundlePricingType === 'paid' && this.bundlePrice <= 0) return;
    if (this.bundleSelectedMaterialIds.length < 2) {
      await this.showTranslatedToast('CREATE_MATERIAL.BUNDLE_WIZ_TOAST_MATERIALS_MIN_TWO');
      return;
    }

    this.isSavingBundle = true;
    const coverUrl = await this.uploadBundleCover();

    const payload: CreateBundlePayload = {
      title: this.bundleTitle.trim(),
      description: this.bundleDescription.trim(),
      coverImageUrl: coverUrl || undefined,
      language: this.bundleLanguage,
      level: this.bundleLevel,
      structuredTags: this.bundleStructuredTags,
      items: this.bundleSelectedMaterialIds.map((id, i) => ({ materialId: id, sortOrder: i })),
      pricingType: this.bundlePricingType,
      price: this.bundlePricingType === 'paid' ? this.bundlePrice : 0,
      status: 'published'
    };

    const request = this.editingBundleId
      ? this.bundleService.updateBundle(this.editingBundleId, payload)
      : this.bundleService.createBundle(payload);

    request.subscribe({
      next: async () => {
        this.isSavingBundle = false;
        this.viewMode = 'library';
        this.libraryTab = 'bundles';
        this.emitModalSidebarTabSync('bundles');
        this.loadBundles();
        const toast = await this.toastCtrl.create({
          message: this.editingBundleId ? 'Bundle updated' : 'Bundle created',
          duration: 2000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();
      },
      error: async () => {
        this.isSavingBundle = false;
        this.cdr.markForCheck();
        const toast = await this.toastCtrl.create({
          message: 'Failed to save bundle',
          duration: 2000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }

  async saveBundleAsDraft() {
    if (!this.bundleTitle.trim() || !this.bundleLanguage) return;
    if (this.bundlePricingType === null) {
      void this.showTranslatedToast('CREATE_MATERIAL.TOAST_FILL_REQUIRED');
      return;
    }

    this.isSavingBundle = true;
    const coverUrl = await this.uploadBundleCover();

    const payload: CreateBundlePayload = {
      title: this.bundleTitle.trim(),
      description: this.bundleDescription.trim(),
      coverImageUrl: coverUrl || undefined,
      language: this.bundleLanguage,
      level: this.bundleLevel,
      structuredTags: this.bundleStructuredTags,
      items: this.bundleSelectedMaterialIds.map((id, i) => ({ materialId: id, sortOrder: i })),
      pricingType: this.bundlePricingType,
      price: this.bundlePricingType === 'paid' ? this.bundlePrice : 0,
      status: 'draft'
    };

    const request = this.editingBundleId
      ? this.bundleService.updateBundle(this.editingBundleId, payload)
      : this.bundleService.createBundle(payload);

    request.subscribe({
      next: async () => {
        this.isSavingBundle = false;
        this.viewMode = 'library';
        this.libraryTab = 'bundles';
        this.emitModalSidebarTabSync('bundles');
        this.loadBundles();
        const toast = await this.toastCtrl.create({
          message: 'Bundle saved as draft',
          duration: 2000,
          position: 'bottom'
        });
        await toast.present();
      },
      error: async () => {
        this.isSavingBundle = false;
        this.cdr.markForCheck();
        const toast = await this.toastCtrl.create({
          message: 'Failed to save bundle',
          duration: 2000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }

  cancelBundleCreate() {
    this.resetBundleWizardState();
    this.viewMode = 'library';
    this.showMaterialsList = false;
    this.showBundlesList = false;
    this.updateNavState();
    if (this.inline) {
      this.modalExpandEvent.emit(false);
    }
    this.emitModalSidebarTabSync('bundles');
  }

  previewBundle(bundle: ContentBundle) {
    sessionStorage.setItem('bundleReferrer', '/tabs/home');
    sessionStorage.setItem('cmReturnSection', 'bundles');
    if (this.inline && !this.platformService.isMobile()) {
      this.router.navigate(['/tabs/home/bundle', bundle._id]);
      return;
    }
    this.router.navigate(['/bundle', bundle._id]);
  }

  async confirmDeleteBundle(bundle: ContentBundle) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Bundle',
      message: `Are you sure you want to delete "${bundle.title}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.bundleService.deleteBundle(bundle._id).subscribe({
              next: () => this.loadBundles(),
              error: async () => {
                const toast = await this.toastCtrl.create({
                  message: 'Failed to delete bundle',
                  duration: 2000,
                  color: 'danger'
                });
                await toast.present();
              }
            });
          }
        }
      ]
    });
    await alert.present();
  }

  getBundleItemCount(bundle: ContentBundle): number {
    return bundle.items?.length || 0;
  }

  getBundleItemTypes(bundle: ContentBundle): string {
    if (!bundle.items?.length) return 'No items';
    const types: Record<string, number> = {};
    for (const item of bundle.items) {
      const mat = item.materialId as any;
      if (mat?.materialType) {
        const label = mat.materialType === 'video_quiz' ? 'video' : mat.materialType;
        types[label] = (types[label] || 0) + 1;
      }
    }
    return Object.entries(types).map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`).join(', ') || `${bundle.items.length} items`;
  }
}
