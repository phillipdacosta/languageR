import { Component, OnInit, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { MaterialService, CreateMaterialPayload, QuizQuestion, MaterialType, TutorMaterial, LinkedChannels } from '../services/material.service';
import { UserService } from '../services/user.service';
import { SharedModule } from '../shared/shared.module';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { QuillEditorComponent } from 'ngx-quill';
import { environment } from '../../environments/environment';

type Step = 'type' | 'pricing' | 'details' | 'quiz' | 'preview';

@Component({
  selector: 'app-create-material',
  templateUrl: './create-material.page.html',
  styleUrls: ['./create-material.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, ReactiveFormsModule, SharedModule, QuillEditorComponent]
})
export class CreateMaterialPage implements OnInit {
  @Input() inline = false;
  @Output() goBackEvent = new EventEmitter<void>();

  viewMode: 'library' | 'create' = 'library';
  myMaterials: TutorMaterial[] = [];
  isLoadingMaterials = true;
  editingMaterialId: string | null = null;
  justPublishedId: string | null = null;
  copiedLinkId: string | null = null;
  currentUserId: string | null = null;

  currentStep: Step = 'type';
  selectedType: MaterialType | null = null;
  selectedPricing: 'free' | 'paid' | null = null;

  navBackLabel = 'Go Back';
  stepTitle = '';

  private static stepTitles: Record<Step, string> = {
    type: 'New Material',
    pricing: 'Pricing',
    details: 'Details',
    quiz: 'Quiz Builder',
    preview: 'Preview'
  };

  materialForm!: FormGroup;
  isSubmitting = false;

  // Video quiz
  videoPreviewUrl: SafeResourceUrl | null = null;
  videoThumbnail: string | null = null;

  // Listening
  audioPreviewUrl: SafeResourceUrl | null = null;
  audioProviderType: string | null = null;

  // Thumbnail
  thumbnailFile: File | null = null;
  thumbnailPreview: string | null = null;
  isUploadingThumbnail = false;
  existingThumbnailUrl: string | null = null;

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

  levels = [
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced', label: 'Advanced' },
    { value: 'any', label: 'All Levels' }
  ];

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
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.initForm();
    this.loadMyMaterials();
    this.loadLinkedChannels();
    this.userService.currentUser$.subscribe(u => {
      if (u) this.currentUserId = u.id;
    });
  }

  private initForm() {
    this.materialForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      whyTakeThis: [''],
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
      },
      error: () => {
        this.isLoadingMaterials = false;
        this.myMaterials = [];
      }
    });
  }

  startCreate() {
    this.editingMaterialId = null;
    this.resetForm();
    this.viewMode = 'create';
    this.updateNavState();
  }

  backToLibrary() {
    this.resetForm();
    this.viewMode = 'library';
    this.updateNavState();
    this.loadMyMaterials();
  }

  handleNavBack() {
    if (this.viewMode === 'library') {
      this.goBackEvent.emit();
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
      this.navBackLabel = 'Back';
      this.stepTitle = '';
      return;
    }
    this.stepTitle = CreateMaterialPage.stepTitles[this.currentStep] || '';
    const idx = this.stepOrder.indexOf(this.currentStep);
    if (idx <= 0 || (this.editingMaterialId && this.currentStep === 'details')) {
      this.navBackLabel = 'My Materials';
    } else {
      const prevStep = this.stepOrder[idx - 1];
      this.navBackLabel = CreateMaterialPage.stepTitles[prevStep] || 'Back';
    }
  }

  editMaterial(m: TutorMaterial) {
    this.editingMaterialId = m._id;
    this.selectedType = m.materialType;
    this.selectedPricing = m.pricingType;
    this.currentStep = 'details';

    // Pre-populate thumbnail
    this.thumbnailFile = null;
    this.thumbnailPreview = m.thumbnailUrl || null;
    this.existingThumbnailUrl = m.thumbnailUrl || null;

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
        const opts = this.fb.array(
          q.options.map(o => this.fb.group({ text: [o.text, Validators.required], isCorrect: [o.isCorrect || false] }))
        );
        this.quizArray.push(this.fb.group({
          question: [q.question, Validators.required],
          explanation: [q.explanation || ''],
          options: opts
        }));
      }
    }

    if (m.videoUrl) this.parseVideoUrl(m.videoUrl);
    if (m.audioUrl) this.parseAudioUrl(m.audioUrl);

    this.viewMode = 'create';
    this.updateNavState();
  }

  async confirmDelete(m: TutorMaterial) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Material',
      message: `Are you sure you want to delete "${m.title}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.materialService.deleteMaterial(m._id).subscribe({
              next: async (res) => {
                if (res.success) {
                  await this.showToast(res.softDeleted ? 'Material hidden (students retain access)' : 'Material deleted');
                  this.loadMyMaterials();
                }
              },
              error: async () => await this.showToast('Failed to delete material')
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
      header: isArchiving ? 'Archive Material' : 'Publish Material',
      message: isArchiving
        ? `Are you sure you want to archive "${m.title}"? Students won't see it in search results.`
        : `Re-publish "${m.title}"? It will become visible to students again.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: isArchiving ? 'Archive' : 'Publish',
          handler: () => {
            const newStatus = isArchiving ? 'archived' : 'published';
            this.materialService.updateMaterial(m._id, { status: newStatus } as any).subscribe({
              next: async (res) => {
                if (res.success) {
                  await this.showToast(isArchiving ? 'Material archived' : 'Material published');
                  this.loadMyMaterials();
                }
              },
              error: async () => await this.showToast('Failed to update material')
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
      case 'video_quiz': return 'Video Quiz';
      case 'reading': return 'Reading';
      case 'listening': return 'Listening';
      default: return '';
    }
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return 'Added ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
      await this.showToast('Link copied! Share it with your students');
      setTimeout(() => { this.copiedLinkId = null; }, 2500);
    } catch {
      await this.showToast('Failed to copy link');
    }
  }

  dismissPublishBanner() {
    this.justPublishedId = null;
  }

  // ── Thumbnail ─────────────────────────────────────────

  onThumbnailSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.showToast('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('Image must be under 5 MB');
      return;
    }

    this.thumbnailFile = file;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.thumbnailPreview = e.target.result;
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  removeThumbnail() {
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.existingThumbnailUrl = null;
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

  get typeIcon(): string {
    switch (this.selectedType) {
      case 'video_quiz': return 'videocam-outline';
      case 'reading': return 'book-outline';
      case 'listening': return 'headset-outline';
      default: return 'document-outline';
    }
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

  selectType(type: MaterialType) {
    this.selectedType = type;
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
    const iconName = type === 'video_quiz' ? 'videocam-outline' : type === 'reading' ? 'book-outline' : 'headset-outline';
    const label = type === 'video_quiz' ? 'Video Quiz' : type === 'reading' ? 'Reading Comprehension' : 'Listening Exercise';

    const clone = document.createElement('div');
    const iconDiv = document.createElement('div');
    Object.assign(iconDiv.style, {
      width: '64px', height: '64px', borderRadius: '18px', background: '#f5f5f5',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
      transition: 'all 400ms cubic-bezier(0.32, 0.72, 0, 1)'
    });
    iconDiv.innerHTML = `<ion-icon name="${iconName}" style="font-size:30px;color:#222;transition:font-size 400ms cubic-bezier(0.32,0.72,0,1)"></ion-icon>`;

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
          borderRadius: '24px',
          flexDirection: 'row',
          justifyContent: 'flex-start',
          padding: '6px 14px 6px 10px',
          gap: '6px',
          border: '1px solid #e8e8e8',
          background: '#f5f5f5',
          boxShadow: 'none'
        });

        const iconInClone = clone.querySelector('div') as HTMLElement;
        if (iconInClone) {
          Object.assign(iconInClone.style, {
            width: '16px', height: '16px', borderRadius: '0', background: 'transparent'
          });
          const ionIcon = iconInClone.querySelector('ion-icon') as HTMLElement;
          if (ionIcon) ionIcon.style.fontSize = '16px';
        }

        labelSpan.style.fontSize = '13px';

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

    if (pricing === 'paid' && this.selectedType === 'video_quiz' && !localStorage.getItem('hideVideoPolicy')) {
      this.showVideoPolicy = true;
      this.videoPolicyDismissed = false;
    } else {
      this.showVideoPolicy = false;
    }

    this.currentStep = 'details';
    this.updateNavState();
  }

  goToQuizStep() {
    const titleCtrl = this.materialForm.get('title');
    const langCtrl = this.materialForm.get('language');

    if (titleCtrl?.invalid || langCtrl?.invalid) {
      titleCtrl?.markAsTouched();
      langCtrl?.markAsTouched();
      this.showToast('Please fill in all required fields');
      return;
    }

    if (this.selectedType === 'video_quiz' && !this.videoPreviewUrl) {
      this.showToast('Please enter a valid video URL');
      return;
    }
    if (this.selectedType === 'reading') {
      const passageHtml = this.materialForm.value.passage || '';
      const stripped = passageHtml.replace(/<[^>]*>/g, '').trim();
      if (!stripped) {
        this.showToast('Please enter a reading passage');
        return;
      }
    }
    if (this.selectedType === 'listening' && !this.audioPreviewUrl) {
      this.showToast('Please enter a valid audio URL');
      return;
    }

    this.currentStep = 'quiz';
    this.updateNavState();
  }

  goToPreview() {
    const quizData: QuizQuestion[] = this.quizArray.value;
    for (let i = 0; i < quizData.length; i++) {
      const q = quizData[i];
      if (!q.question.trim()) {
        this.showToast(`Question ${i + 1} needs a question`);
        return;
      }
      const filled = q.options.filter(o => o.text.trim());
      if (filled.length < 2) {
        this.showToast(`Question ${i + 1} needs at least 2 options`);
        return;
      }
      if (!q.options.some(o => o.isCorrect && o.text.trim())) {
        this.showToast(`Question ${i + 1} needs a correct answer`);
        return;
      }
    }
    this.currentStep = 'preview';
    this.updateNavState();
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
        this.videoThumbnail = `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
        return;
      }
    }

    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      this.videoPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://player.vimeo.com/video/${vimeoMatch[1]}?title=0&byline=0&portrait=0`
      );
      this.videoThumbnail = null;
      return;
    }

    this.videoPreviewUrl = null;
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

  addQuestion() {
    const questionGroup = this.fb.group({
      question: ['', Validators.required],
      explanation: [''],
      options: this.fb.array([
        this.createOption(true),
        this.createOption()
      ])
    });
    this.quizArray.push(questionGroup);
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
      },
      error: () => { this.isLoadingChannels = false; }
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
            await this.showToast('YouTube channel URL saved, but could not resolve channel info. Check the URL or contact support.');
          } else {
            await this.showToast('Channels saved');
          }
        }
      },
      error: async () => {
        this.isSavingChannels = false;
        await this.showToast('Failed to save channels');
      }
    });
  }

  hasLinkedChannel(): boolean {
    return !!(this.linkedChannels.youtubeChannelUrl || this.linkedChannels.vimeoChannelUrl || this.linkedChannels.soundcloudProfileUrl);
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

        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'youtube_linked') return;
          window.removeEventListener('message', onMessage);
          this.isLinkingYouTube = false;

          if (event.data.success) {
            this.loadLinkedChannels();
            this.showToast('YouTube channel linked successfully!');
          } else {
            this.showToast('YouTube linking failed. Please try again.');
          }
          this.cdr.detectChanges();
        };
        window.addEventListener('message', onMessage);

        const checkClosed = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', onMessage);
            this.isLinkingYouTube = false;
            this.cdr.detectChanges();
          }
        }, 1000);
      },
      error: async (err) => {
        this.isLinkingYouTube = false;
        console.error('YouTube auth URL error:', err);
        await this.showToast('Failed to start YouTube linking');
      }
    });
  }

  async unlinkYouTube() {
    const alert = await this.alertCtrl.create({
      header: 'Unlink YouTube',
      message: 'Are you sure you want to disconnect your YouTube channel?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Unlink',
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
                this.showToast('YouTube channel unlinked');
              },
              error: () => this.showToast('Failed to unlink YouTube')
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

  async submit() {
    if (this.isSubmitting) return;

    // Auto-remove empty trailing options, then validate
    for (let qi = this.quizArray.length - 1; qi >= 0; qi--) {
      const opts = this.getOptions(qi);
      for (let oi = opts.length - 1; oi >= 0; oi--) {
        const text = (opts.at(oi).get('text')?.value || '').trim();
        if (!text && opts.length > 2) {
          opts.removeAt(oi);
        }
      }
    }

    const quizData: QuizQuestion[] = this.quizArray.value;
    for (let i = 0; i < quizData.length; i++) {
      const q = quizData[i];
      if (!q.question.trim()) { this.showToast(`Question ${i + 1} needs text`); return; }
      const filledOptions = q.options.filter(o => o.text.trim());
      if (filledOptions.length < 2) { this.showToast(`Question ${i + 1} needs at least 2 options`); return; }
      if (!filledOptions.some(o => o.isCorrect)) { this.showToast(`Question ${i + 1} needs a correct answer`); return; }
      if (q.options.some(o => !o.text.trim())) { this.showToast(`Question ${i + 1} has an empty option — fill it in or remove it`); return; }
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
        await this.showToast('Failed to upload thumbnail. Try again.');
        return;
      }
    }

    const payload: CreateMaterialPayload = {
      title: this.materialForm.value.title,
      description: this.materialForm.value.description,
      whyTakeThis: this.materialForm.value.whyTakeThis || '',
      language: this.materialForm.value.language,
      level: this.materialForm.value.level,
      materialType: this.selectedType!,
      pricingType: this.selectedPricing!,
      price: this.selectedPricing === 'paid' ? this.materialForm.value.price : 0,
      quiz: quizData
    };

    if (thumbnailUrl) {
      payload.thumbnailUrl = thumbnailUrl;
    }

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
            await this.showToast(isEditing ? 'Material updated!' : 'Material published!');
          }
        }
      },
      error: async (err) => {
        this.isSubmitting = false;
        await this.showToast(err?.error?.message || 'Failed to save material');
      }
    });
  }

  private resetForm() {
    this.selectedType = null;
    this.selectedPricing = null;
    this.currentStep = 'type';
    this.materialForm.reset({ level: 'any', price: 0 });
    this.quizArray.clear();
    this.videoPreviewUrl = null;
    this.videoThumbnail = null;
    this.audioPreviewUrl = null;
    this.audioProviderType = null;
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.existingThumbnailUrl = null;
    this.isUploadingThumbnail = false;
    this.contentAttested = false;
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'bottom' });
    await toast.present();
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
    return this.levels.find(l => l.value === lvl)?.label || 'All Levels';
  }

  get typeLabel(): string {
    switch (this.selectedType) {
      case 'video_quiz': return 'Video Quiz';
      case 'reading': return 'Reading Comprehension';
      case 'listening': return 'Listening Exercise';
      default: return '';
    }
  }
}
