import { Component, Input, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController, ToastController, IonContent } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranscriptionService, LessonAnalysis } from '../../services/transcription.service';
import { ReviewDeckService, ReviewDeckItem } from '../../services/review-deck.service';
import { UserService } from '../../services/user.service';
import { LessonService } from '../../services/lesson.service';
import { AnalysisTranslationService } from '../../services/analysis-translation.service';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-lesson-summary',
  templateUrl: './lesson-summary.component.html',
  styleUrls: ['./lesson-summary.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule]
})
export class LessonSummaryComponent implements OnInit, OnDestroy {
  @Input() lessonId!: string;
  @Input() transcriptId?: string;
  @Input() mockAnalysis?: LessonAnalysis; // For dev preview
  @Input() tutorId?: string;
  @ViewChild(IonContent) content!: IonContent;

  analysis: LessonAnalysis | null = null;
  loading = true;
  analysisUnavailable = false;
  
  // Tutor info
  tutorInfo: {
    firstName: string;
    lastInitial: string;
    fullName: string;
    picture: string;
    id: string;
  } | null = null;
  
  // Review deck
  savedCorrections: Set<string> = new Set();
  reviewDeckItems: ReviewDeckItem[] = [];
  
  // Translation
  analysisId: string | null = null;
  originalAnalysis: LessonAnalysis | null = null;
  translating = false;
  showingTranslation = false;

  // Pre-computed template properties
  progressNoteVisible = false;
  progressColorClass = '';
  // Recap-only: backend withheld the CEFR grade (too little genuine
  // target-language speech). Hide the level badge, show recap copy.
  recapOnly = false;
  // CEFR level is withheld from the student until the reveal window (3–5
  // lessons) completes — the backend computes this from plan.revealedCefrLevel.
  // Defaults hidden so we never flash a premature level after one lesson.
  cefrRevealedForStudent = false;
  progressIcon = 'trending-up';
  mainFocusText = '';
  hasPersistentChallenges = false;
  uniqueCorrectedExcerpts: any[] = [];

  private pollingInterval: any = null;

  // Expose Math for template
  Math = Math;

  constructor(
    private modalController: ModalController,
    private transcriptionService: TranscriptionService,
    private reviewDeckService: ReviewDeckService,
    private alertController: AlertController,
    private toastController: ToastController,
    private router: Router,
    private userService: UserService,
    private lessonService: LessonService,
    private analysisTranslation: AnalysisTranslationService
  ) {}

  ngOnDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  ngOnInit() {
    console.log('🎯 LessonSummaryComponent initialized');
    console.log('📊 Mock analysis provided?', !!this.mockAnalysis);
    
    // Load saved corrections from API
    this.loadSavedCorrections();
    
    // If mock analysis provided, use it directly (for dev preview)
    if (this.mockAnalysis) {
      this.analysis = this.mockAnalysis;
      this.loading = false;
      this.computeDerivedProperties();
      this.tutorInfo = {
        firstName: 'Mary',
        lastInitial: 'J',
        fullName: 'Mary Johnson',
        picture: 'https://i.pravatar.cc/150?img=6',
        id: 'mock-tutor-id'
      };
      return;
    }
    
    this.loadAnalysis();
    this.loadTutorInfo();
  }

  async loadAnalysis() {
    try {
      // Poll for analysis (it takes time to process)
      this.pollForAnalysis();
    } catch (error) {
      console.error('Error loading analysis:', error);
      this.loading = false;
    }
  }

  private pollForAnalysis() {
    const maxAttempts = 60;
    let attempts = 0;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(() => {
      attempts++;

      this.transcriptionService.getLessonAnalysis(this.lessonId).subscribe({
        next: (resp: any) => {
          // Endpoint returns { analysis, cefrRevealedForStudent }, but older
          // shapes returned the analysis directly — handle both defensively.
          const analysis = resp?.analysis ?? resp;
          this.cefrRevealedForStudent = resp?.cefrRevealedForStudent === true;
          if (analysis?.status === 'completed') {
            this.analysis = analysis;
            this.loading = false;
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            this.computeDerivedProperties();
            this.initTranslationState();
          } else if (analysis?.status === 'failed' || analysis?.status === 'insufficient_data') {
            this.analysisUnavailable = true;
            this.loading = false;
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
        },
        error: (error: any) => {
          if (error.status === 404 && error.error?.status === 'unavailable') {
            this.analysisUnavailable = true;
            this.loading = false;
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          } else if (attempts >= maxAttempts) {
            this.analysisUnavailable = true;
            this.loading = false;
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
        }
      });
    }, 2000);
  }

  private computeDerivedProperties() {
    if (!this.analysis) return;

    // Recap-only when no level was assessed this lesson.
    this.recapOnly = (this.analysis as any).proficiencyAssessed === false
      || !this.analysis.overallAssessment?.proficiencyLevel;

    // Progress note
    const progressText = this.analysis.overallAssessment?.progressFromLastLesson || '';
    const level = this.analysis.overallAssessment?.proficiencyLevel?.toUpperCase() || '';
    const lower = progressText.toLowerCase();

    this.progressNoteVisible = !!progressText
      && level !== 'C2'
      && !lower.includes('first analyzed lesson')
      && !lower.includes('baseline established');

    if (lower.includes('decreased') || lower.includes('declined') || lower.includes('worsened')) {
      this.progressColorClass = 'progress-decrease';
    } else if (lower.includes('increased') || lower.includes('improved') || lower.includes('expanded')) {
      this.progressColorClass = 'progress-increase';
    } else {
      this.progressColorClass = 'progress-neutral';
    }

    if (lower.includes('decreased') || lower.includes('declined') || lower.includes('worsened') || lower.includes('dropped') || lower.includes('fell')) {
      this.progressIcon = 'trending-down';
    } else {
      this.progressIcon = 'trending-up';
    }

    // Main focus
    if (this.analysis.topErrors?.length) {
      const top = this.analysis.topErrors[0];
      if (top.impact === 'high' || top.teachingPriority?.toLowerCase().includes('high')) {
        this.mainFocusText = top.issue;
      }
    }
    if (!this.mainFocusText && this.analysis.recommendedFocus?.length) {
      this.mainFocusText = this.analysis.recommendedFocus[0];
    }
    if (!this.mainFocusText && this.analysis.areasForImprovement?.length) {
      this.mainFocusText = this.analysis.areasForImprovement[0];
    }

    // Persistent challenges (filter out "None identified")
    const challenges = this.analysis.progressionMetrics?.persistentChallenges || [];
    this.hasPersistentChallenges = challenges.length > 0
      && !(challenges.length === 1 && (challenges[0].toLowerCase().includes('none') || challenges[0].toLowerCase().includes('n/a')));

    // Unique corrected excerpts (filter out duplicates already in error patterns)
    if (this.analysis.correctedExcerpts?.length) {
      const errorPatternOriginals = new Set<string>();
      this.analysis.errorPatterns?.forEach(pattern => {
        pattern.examples?.forEach(example => {
          if (example.original) {
            errorPatternOriginals.add(example.original.trim().toLowerCase());
          }
        });
      });
      this.uniqueCorrectedExcerpts = this.analysis.correctedExcerpts.filter(excerpt => {
        const orig = excerpt.original?.trim().toLowerCase() || '';
        return !errorPatternOriginals.has(orig);
      });
    } else {
      this.uniqueCorrectedExcerpts = [];
    }
  }

  async showConfidenceTooltip() {
    const alert = await this.alertController.create({
      header: 'Confidence Score',
      message: `This represents how confident the AI is that your level is <strong>${this.analysis?.overallAssessment.proficiencyLevel}</strong> based on your grammar, fluency, vocabulary, and accuracy metrics.<br><br><strong>85-100%:</strong> Very confident<br><strong>70-84%:</strong> Moderately confident<br><strong>50-69%:</strong> Less confident<br><strong>Below 50%:</strong> Not enough data`,
      buttons: ['Got it']
    });
    await alert.present();
  }

  /**
   * Save/unsave a correction to review deck
   */
  async toggleSaveCorrection(original: string, corrected: string, explanation: string) {
    const key = `${original}->${corrected}`;
    
    if (this.savedCorrections.has(key)) {
      // Unsave - find and delete from API
      const item = this.reviewDeckItems.find(i => 
        i.original === original && i.corrected === corrected
      );
      
      if (item) {
        this.reviewDeckService.deleteItem(item._id).subscribe({
          next: async () => {
            this.savedCorrections.delete(key);
            this.reviewDeckItems = this.reviewDeckItems.filter(i => i._id !== item._id);
            
            const toast = await this.toastController.create({
              message: 'Removed from review deck',
              duration: 2000,
              position: 'bottom',
              color: 'medium'
            });
            await toast.present();
          },
          error: async (error) => {
            console.error('Error removing from review deck:', error);
            const toast = await this.toastController.create({
              message: 'Failed to remove',
              duration: 2000,
              position: 'bottom',
              color: 'danger'
            });
            await toast.present();
          }
        });
      }
    } else {
      // Save to API
      this.reviewDeckService.saveItem({
        original: original.trim(),
        corrected: corrected.trim(),
        explanation: explanation || '',
        context: '',
        language: this.analysis?.language || 'Spanish',
        errorType: 'other',
        lessonId: this.lessonId
      }).subscribe({
        next: async (response) => {
          this.savedCorrections.add(key);
          this.reviewDeckItems.push(response.item);
          
          const toast = await this.toastController.create({
            message: '✅ Saved to review deck',
            duration: 2000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
        },
        error: async (error) => {
          console.error('Error saving to review deck:', error);
          const toast = await this.toastController.create({
            message: 'Failed to save',
            duration: 2000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
    }
  }

  /**
   * Check if a correction is saved
   */
  isCorrectionSaved(original: string, corrected: string): boolean {
    const key = `${original}->${corrected}`;
    return this.savedCorrections.has(key);
  }

  /**
   * Load saved corrections from API (non-blocking)
   */
  private loadSavedCorrections() {
    // Load saved corrections in the background - don't block the modal from opening
    this.reviewDeckService.getItems({ limit: 1000 }).subscribe({
      next: (response) => {
        this.reviewDeckItems = response.items;
        
        // Build a set of keys for fast lookup
        response.items.forEach(item => {
          const key = `${item.original}->${item.corrected}`;
          this.savedCorrections.add(key);
        });
        console.log('✅ Loaded saved corrections:', this.reviewDeckItems.length);
      },
      error: (error) => {
        console.error('⚠️ Could not load saved corrections (non-blocking):', error);
        // Don't show error to user - saving corrections will still work
        // The error is likely auth-related and will resolve on next page load
      }
    });
  }

  dismiss() {
    this.modalController.dismiss();
  }

  /**
   * Load tutor information from lesson (non-blocking)
   */
  private loadTutorInfo() {
    if (!this.lessonId) {
      console.warn('⚠️ No lessonId provided, cannot load tutor info');
      return;
    }
    
    console.log('🔍 Loading tutor info for lesson:', this.lessonId);
    
    this.lessonService.getLesson(this.lessonId).subscribe({
      next: (response: any) => {
        console.log('📚 Lesson response:', response);
        const lesson = response.lesson;
        
        // FIXED: Ensure tutorId is a string, not an object
        let tutorId: string | undefined = lesson.tutorId || this.tutorId;
        
        // Convert ObjectId objects to strings
        if (tutorId && typeof tutorId === 'object') {
          tutorId = (tutorId as any)._id || String(tutorId);
        }
        
        // Also try to get from analysis if available
        if (!tutorId && this.analysis?.tutorId) {
          const analysisTutorId = this.analysis.tutorId;
          if (typeof analysisTutorId === 'object') {
            tutorId = (analysisTutorId as any)._id || String(analysisTutorId);
          } else {
            tutorId = analysisTutorId as string;
          }
        }
        
        if (tutorId) {
          console.log('👨‍🏫 Fetching tutor details for:', tutorId);
          this.userService.getTutorPublic(tutorId).subscribe({
            next: (tutorResponse: any) => {
              const tutor = tutorResponse.tutor;
              const nameParts = tutor.name.split(' ');
              this.tutorInfo = {
                firstName: nameParts[0],
                lastInitial: nameParts[1]?.charAt(0) || '',
                fullName: tutor.name,
                picture: tutor.picture || '',
                id: tutor.id || tutorId
              };
              console.log('✅ Tutor info loaded:', this.tutorInfo);
            },
            error: (error) => {
              console.error('⚠️ Error loading tutor info (non-critical):', error);
              // Don't block the UI - tutor panel just won't show
            }
          });
        } else {
          console.warn('⚠️ No tutorId found in lesson');
        }
      },
      error: (error) => {
        console.error('⚠️ Error loading lesson (non-critical):', error);
        // Don't block the UI - tutor panel just won't show
      }
    });
  }

  /**
   * Navigate to leave a review
   */
  async leaveReview() {
    if (!this.tutorInfo) return;
    
    await this.modalController.dismiss();
    this.router.navigate(['/tutor-profile', this.tutorInfo.id], {
      queryParams: { leaveReview: true }
    });
  }

  /**
   * Rebook with this tutor
   */
  async rebook() {
    if (!this.tutorInfo) return;
    
    await this.modalController.dismiss();
    this.router.navigate(['/tutor-profile', this.tutorInfo.id]);
  }

  private initTranslationState() {
    if (!this.analysis) return;
    this.analysisId = (this.analysis as any)._id || null;
    this.originalAnalysis = { ...this.analysis };

    if (this.analysisId) {
      const user = this.userService.getCurrentUserValue();
      const targetLang = user?.nativeLanguage || 'en';
      const cached = (this.analysis as any).translations?.[targetLang];
      if (cached) {
        this.analysisTranslation.seedFromResponse(this.analysisId, cached);
      }
      if (this.analysisTranslation.isShowingTranslated(this.analysisId)) {
        const t = this.analysisTranslation.getTranslation(this.analysisId);
        if (t && this.originalAnalysis) {
          this.analysis = this.analysisTranslation.applyTranslation(this.originalAnalysis, t) as LessonAnalysis;
          this.showingTranslation = true;
        }
      }
    }
  }

  toggleTranslation() {
    if (!this.analysisId) return;

    if (this.showingTranslation) {
      this.analysisTranslation.showOriginal(this.analysisId);
      this.analysis = this.originalAnalysis ? { ...this.originalAnalysis } : this.analysis;
      this.showingTranslation = false;
      this.computeDerivedProperties();
      return;
    }

    if (this.analysisTranslation.hasTranslation(this.analysisId)) {
      this.analysisTranslation.showTranslated(this.analysisId);
      const t = this.analysisTranslation.getTranslation(this.analysisId);
      if (t && this.originalAnalysis) {
        this.analysis = this.analysisTranslation.applyTranslation(this.originalAnalysis, t) as LessonAnalysis;
      }
      this.showingTranslation = true;
      this.computeDerivedProperties();
      return;
    }

    this.translating = true;
    this.analysisTranslation.translate(this.analysisId).subscribe({
      next: (t) => {
        if (this.originalAnalysis) {
          this.analysis = this.analysisTranslation.applyTranslation(this.originalAnalysis, t) as LessonAnalysis;
        }
        this.translating = false;
        this.showingTranslation = true;
        this.computeDerivedProperties();
      },
      error: () => {
        this.translating = false;
      }
    });
  }
}
