import { Component, Input, OnInit, ViewChild } from '@angular/core';
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
export class LessonSummaryComponent implements OnInit {
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

  ngOnInit() {
    console.log('🎯 LessonSummaryComponent initialized');
    console.log('📊 Mock analysis provided?', !!this.mockAnalysis);
    
    // Load saved corrections from API
    this.loadSavedCorrections();
    
    // If mock analysis provided, use it directly (for dev preview)
    if (this.mockAnalysis) {
      this.analysis = this.mockAnalysis;
      this.loading = false;
      // Mock tutor info
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
    const maxAttempts = 60; // 60 attempts = 2 minutes max
    let attempts = 0;

    const interval = setInterval(() => {
      attempts++;

      this.transcriptionService.getLessonAnalysis(this.lessonId).subscribe({
        next: (analysis) => {
          if (analysis.status === 'completed') {
            this.analysis = analysis;
            this.loading = false;
            clearInterval(interval);
            this.initTranslationState();
            console.log('✅ Analysis loaded successfully');
          } else if (analysis.status === 'failed' || analysis.status === 'insufficient_data') {
            this.analysisUnavailable = true;
            this.loading = false;
            clearInterval(interval);
            console.log(`⚠️ Analysis ${analysis.status}`);
          }
        },
        error: (error: any) => {
          if (error.status === 404 && error.error?.status === 'unavailable') {
            this.analysisUnavailable = true;
            this.loading = false;
            clearInterval(interval);
          } else if (attempts >= maxAttempts) {
            this.analysisUnavailable = true;
            this.loading = false;
            clearInterval(interval);
          }
        }
      });
    }, 2000); // Check every 2 seconds
  }

  /**
   * Get unique corrected excerpts that aren't already shown in error patterns
   */
  getUniqueCorrectedExcerpts() {
    if (!this.analysis?.correctedExcerpts || !this.analysis?.errorPatterns) {
      return this.analysis?.correctedExcerpts || [];
    }
    
    // Collect all original texts from error patterns
    const errorPatternOriginals = new Set<string>();
    this.analysis.errorPatterns.forEach(pattern => {
      pattern.examples?.forEach(example => {
        if (example.original) {
          errorPatternOriginals.add(example.original.trim().toLowerCase());
        }
      });
    });
    
    // Filter out excerpts that match error pattern examples
    return this.analysis.correctedExcerpts.filter(excerpt => {
      const excerptOriginal = excerpt.original?.trim().toLowerCase() || '';
      return !errorPatternOriginals.has(excerptOriginal);
    });
  }

  /**
   * Determine if progress text should be shown
   * Hide for native speakers (C2) or first lessons
   */
  shouldShowProgress(): boolean {
    if (!this.analysis?.overallAssessment?.progressFromLastLesson) {
      return false;
    }
    
    const progressText = this.analysis.overallAssessment.progressFromLastLesson.toLowerCase();
    const proficiencyLevel = this.analysis.overallAssessment.proficiencyLevel?.toUpperCase();
    
    // Don't show progress for native speakers (C2)
    if (proficiencyLevel === 'C2') {
      return false;
    }
    
    // Don't show if it's explicitly a first lesson
    if (progressText.includes('first analyzed lesson') || progressText.includes('baseline established')) {
      return false;
    }
    
    return true;
  }

  /**
   * Get the appropriate icon for progress direction
   */
  getProgressIcon(): string {
    if (!this.analysis?.overallAssessment?.progressFromLastLesson) {
      return 'trending-up';
    }
    
    const progressText = this.analysis.overallAssessment.progressFromLastLesson.toLowerCase();
    
    // Check for decrease indicators
    if (progressText.includes('decreased') || 
        progressText.includes('declined') || 
        progressText.includes('worsened') ||
        progressText.includes('dropped') ||
        progressText.includes('fell')) {
      return 'trending-down';
    }
    
    // Check for increase indicators
    if (progressText.includes('increased') || 
        progressText.includes('improved') || 
        progressText.includes('enhanced') ||
        progressText.includes('expanded') ||
        progressText.includes('grew')) {
      return 'trending-up';
    }
    
    // Default to neutral/up if unclear
    return 'trending-up';
  }

  /**
   * Get the appropriate color class for progress
   */
  getProgressColorClass(): string {
    if (!this.analysis?.overallAssessment?.progressFromLastLesson) {
      return '';
    }
    
    const progressText = this.analysis.overallAssessment.progressFromLastLesson.toLowerCase();
    
    // Red for decreases
    if (progressText.includes('decreased') || 
        progressText.includes('declined') || 
        progressText.includes('worsened')) {
      return 'progress-decrease';
    }
    
    // Green for increases
    if (progressText.includes('increased') || 
        progressText.includes('improved') || 
        progressText.includes('expanded')) {
      return 'progress-increase';
    }
    
    // Neutral for stable/remained
    return 'progress-neutral';
  }

  /**
   * Get main focus for next lesson
   */
  getMainFocus(): string {
    if (!this.analysis) return '';
    
    // Priority 1: Top error if high priority
    if (this.analysis.topErrors && this.analysis.topErrors.length > 0) {
      const topError = this.analysis.topErrors[0];
      // Check for high priority/impact
      if (topError.impact === 'high' || 
          (topError.teachingPriority && topError.teachingPriority.toLowerCase().includes('high'))) {
        return topError.issue;
      }
    }
    
    // Priority 2: First recommended focus
    if (this.analysis.recommendedFocus && this.analysis.recommendedFocus.length > 0) {
      return this.analysis.recommendedFocus[0];
    }
    
    // Priority 3: First area for improvement
    if (this.analysis.areasForImprovement && this.analysis.areasForImprovement.length > 0) {
      return this.analysis.areasForImprovement[0];
    }
    
    return 'Continue practicing conversation skills';
  }

  /**
   * Check if persistent challenges only contains "None identified"
   */
  isOnlyNoneIdentified(challenges: string[]): boolean {
    if (!challenges || challenges.length === 0) return true;
    if (challenges.length === 1 && 
        (challenges[0].toLowerCase().includes('none') || 
         challenges[0].toLowerCase().includes('n/a'))) {
      return true;
    }
    return false;
  }

  /**
   * Get celebratory message based on performance
   */
  getCelebrationMessage(): string | null {
    if (!this.analysis) return null;
    
    const metrics = this.analysis.progressionMetrics;
    const level = this.analysis.overallAssessment.proficiencyLevel;
    
    // Native speaker
    if (level === 'C2') {
      return '🎯 Native-level fluency maintained!';
    }
    
    // Grammar improvement
    if (metrics?.grammarAccuracyChange && metrics.grammarAccuracyChange > 0) {
      return `🔥 Grammar improved ${metrics.grammarAccuracyChange}% since last session!`;
    }
    
    // Vocabulary growth
    if (metrics?.vocabularyGrowth && metrics.vocabularyGrowth > 3) {
      return `🥳 Your vocabulary grew by ${metrics.vocabularyGrowth} words!`;
    }
    
    // Error rate decrease
    if (metrics?.errorRateChange && metrics.errorRateChange < 0) {
      const improvement = Math.abs(metrics.errorRateChange);
      return `✨ ${improvement}% fewer errors than last time!`;
    }
    
    // Level up
    if (metrics?.proficiencyChange === 'improved') {
      return `🎉 Congratulations! You leveled up to ${level}!`;
    }
    
    return null;
  }

  /**
   * Get warning message if performance declined
   */
  getWarningMessage(): string | null {
    if (!this.analysis) return null;
    
    const metrics = this.analysis.progressionMetrics;
    
    // More errors
    if (metrics?.errorRateChange && metrics.errorRateChange > 5) {
      return `⚠️ More errors today (${metrics.errorRateChange}% increase) — let's review them next time`;
    }
    
    // Grammar declined
    if (metrics?.grammarAccuracyChange && metrics.grammarAccuracyChange < -5) {
      return `⚠️ Grammar accuracy dropped ${Math.abs(metrics.grammarAccuracyChange)}% — focus on fundamentals`;
    }
    
    return null;
  }

  /**
   * Get previous grammar score for progress visualization
   */
  getPreviousGrammarScore(): number | null {
    if (!this.analysis?.progressionMetrics?.grammarAccuracyChange) {
      return null;
    }
    
    const current = this.analysis.grammarAnalysis.accuracyScore;
    const change = this.analysis.progressionMetrics.grammarAccuracyChange;
    return current - change;
  }

  /**
   * Show confidence tooltip
   */
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
      return;
    }

    if (this.analysisTranslation.hasTranslation(this.analysisId)) {
      this.analysisTranslation.showTranslated(this.analysisId);
      const t = this.analysisTranslation.getTranslation(this.analysisId);
      if (t && this.originalAnalysis) {
        this.analysis = this.analysisTranslation.applyTranslation(this.originalAnalysis, t) as LessonAnalysis;
      }
      this.showingTranslation = true;
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
      },
      error: () => {
        this.translating = false;
      }
    });
  }
}
