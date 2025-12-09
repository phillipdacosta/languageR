import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LoadingController, AlertController, ToastController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { LessonAnalysis } from '../services/transcription.service';
import { ReviewDeckService, ReviewDeckItem } from '../services/review-deck.service';
import { UserService } from '../services/user.service';

interface LessonInfo {
  _id: string;
  subject: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  actualDurationMinutes?: number;
  tutor: {
    _id: string;
    name: string;
    picture?: string;
  };
  student: {
    _id: string;
    name: string;
    picture?: string;
  };
}

@Component({
  selector: 'app-lesson-analysis',
  templateUrl: './lesson-analysis.page.html',
  styleUrls: ['./lesson-analysis.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class LessonAnalysisPage implements OnInit, OnDestroy {
  lessonId: string = '';
  analysis: LessonAnalysis | null = null;
  lesson: LessonInfo | null = null;
  loading = true;
  error: string | null = null;
  canGenerate = false;
  private pollingInterval: any = null;
  pollCount = 0;
  maxPollAttempts = 60;
  
  // Review deck
  savedCorrections: Set<string> = new Set();
  reviewDeckItems: ReviewDeckItem[] = [];
  
  // Expose Math for template
  Math = Math;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private http: HttpClient,
    private userService: UserService,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private reviewDeckService: ReviewDeckService
  ) {}

  ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') || '';
    if (this.lessonId) {
      // Wait for user to be loaded before making API calls
      this.userService.getCurrentUser().subscribe(user => {
        if (user) {
          console.log('✅ User loaded, fetching analysis...');
          this.loadAnalysis();
          this.loadSavedCorrections();
        }
      });
    } else {
      this.error = 'No lesson ID provided';
      this.loading = false;
    }
  }

  ngOnDestroy() {
    // Clean up polling interval on component destroy
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  async loadAnalysis() {
    this.loading = true;
    this.error = null;

    try {
      const headers = this.userService.getAuthHeadersSync();

      const response: any = await this.http
        .get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
        .toPromise();

      console.log('📊 Analysis API response:', response);

      // Handle both new format (with success wrapper) and direct analysis response
      if (response.success) {
        // New format
        this.analysis = response.analysis;
        this.lesson = response.lesson;
      } else if (response.status) {
        // Direct LessonAnalysis document format - use it as-is with proper type
        this.analysis = response as LessonAnalysis;
        
        // Try to populate lesson info from lessonId if populated
        if (response.lessonId) {
          this.lesson = {
            _id: response.lessonId._id || response.lessonId,
            subject: response.lessonId.subject || response.language + ' Lesson',
            startTime: response.lessonDate || response.lessonId.startTime,
            endTime: response.lessonId.endTime,
            duration: response.lessonId.duration,
            actualDurationMinutes: response.lessonId.actualDurationMinutes,
            tutor: response.tutorId ? {
              _id: response.tutorId._id || response.tutorId,
              name: response.tutorId.name || 'Tutor',
              picture: response.tutorId.picture
            } : { _id: '', name: 'Tutor', picture: '' },
            student: response.studentId ? {
              _id: response.studentId._id || response.studentId,
              name: response.studentId.name || 'Student',
              picture: response.studentId.picture
            } : { _id: '', name: 'Student', picture: '' }
          };
        }
      }
      
      console.log('✅ Analysis loaded:', !!this.analysis);
      console.log('✅ Lesson loaded:', !!this.lesson);
      
      // If analysis is still processing, start polling
      if (this.analysis?.status === 'processing' || this.analysis?.status === 'pending') {
        this.startPolling();
      } else {
        // Stop polling if analysis is complete or failed
        this.stopPolling();
      }
    } catch (err: any) {
      console.error('Error loading analysis:', err);
      if (err.status === 404) {
        this.error = 'Analysis not available yet. It may still be generating...';
        this.canGenerate = err.error?.canGenerate || false;
        
        // If analysis doesn't exist yet, start polling (it might be generating)
        this.startPolling();
      } else {
        this.error = 'Failed to load lesson analysis';
        this.stopPolling();
      }
    } finally {
      this.loading = false;
    }
  }

  private startPolling() {
    // Don't start if already polling
    if (this.pollingInterval) {
      return;
    }

    this.pollCount = 0;
    console.log('🔄 Starting to poll for analysis...');

    this.pollingInterval = setInterval(async () => {
      this.pollCount++;
      
      if (this.pollCount >= this.maxPollAttempts) {
        console.log('⏱️ Max poll attempts reached');
        this.stopPolling();
        this.error = 'Analysis is taking longer than expected. Please refresh the page later.';
        return;
      }

      console.log(`🔄 Polling attempt ${this.pollCount}/${this.maxPollAttempts}`);
      
      try {
        const headers = this.userService.getAuthHeadersSync();

        const response: any = await this.http
          .get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
          .toPromise();

        if (response.success && response.analysis) {
          this.analysis = response.analysis;
          this.lesson = response.lesson;
          this.error = null;
          
          // Stop polling if analysis is complete or failed
          if (response.analysis.status === 'completed' || response.analysis.status === 'failed') {
            console.log('✅ Analysis ready!');
            this.stopPolling();
          }
        }
      } catch (err: any) {
        // Continue polling on 404 (analysis not ready yet)
        if (err.status !== 404) {
          console.error('Polling error:', err);
          this.stopPolling();
        }
      }
    }, 2000); // Poll every 2 seconds
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.pollCount = 0;
      console.log('⏸️ Stopped polling');
    }
  }

  async generateAnalysis() {
    const loading = await this.loadingCtrl.create({
      message: 'Generating analysis...'
    });
    await loading.present();

    try {
      const headers = this.userService.getAuthHeadersSync();

      const response: any = await this.http
        .post(`${environment.apiUrl}/lessons/${this.lessonId}/generate-analysis`, {}, { headers })
        .toPromise();

      if (response.success) {
        // Start polling for the analysis
        this.error = null;
        this.loadAnalysis();
      }
    } catch (err) {
      console.error('Error generating analysis:', err);
      const alert = await this.alertCtrl.create({
        header: 'Error',
        message: 'Failed to generate analysis. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  goBack() {
    // Use browser history to go back to wherever user came from
    // This works for navigation from: tab3/progress, tab1/home, notifications, etc.
    this.location.back();
  }

  async leaveReview() {
    // TODO: Navigate to review page or open review modal
    const alert = await this.alertCtrl.create({
      header: 'Leave a Review',
      message: 'Review functionality coming soon!',
      buttons: ['OK']
    });
    await alert.present();
  }

  async rebook() {
    // Navigate to tutor profile to book again
    if (this.lesson?.tutor._id) {
      this.router.navigate(['/tutor', this.lesson.tutor._id]);
    }
  }

  /**
   * Check if there are any homework items to display
   */
  hasHomeworkItems(): boolean {
    return !!(this.analysis?.homeworkSuggestions?.length || this.analysis?.suggestedExercises?.length);
  }

  /**
   * Helper methods to safely check array properties
   */
  hasStrengths(): boolean {
    return !!(this.analysis?.strengths && this.analysis.strengths.length > 0);
  }

  hasAreasForImprovement(): boolean {
    return !!(this.analysis?.areasForImprovement && this.analysis.areasForImprovement.length > 0);
  }

  hasRecommendedFocus(): boolean {
    return !!(this.analysis?.recommendedFocus && this.analysis.recommendedFocus.length > 0);
  }

  hasPersistentChallenges(): boolean {
    return !!(
      this.analysis?.progressionMetrics?.persistentChallenges &&
      this.analysis.progressionMetrics.persistentChallenges.length > 0 &&
      !this.isOnlyNoneIdentified(this.analysis.progressionMetrics.persistentChallenges)
    );
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
    
    if (progressText.includes('decreased') || progressText.includes('declined') || 
        progressText.includes('worsened') || progressText.includes('dropped') || 
        progressText.includes('fell')) {
      return 'trending-down';
    }
    
    if (progressText.includes('increased') || progressText.includes('improved') || 
        progressText.includes('enhanced') || progressText.includes('expanded') || 
        progressText.includes('grew')) {
      return 'trending-up';
    }
    
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
    
    if (progressText.includes('decreased') || progressText.includes('declined') || 
        progressText.includes('worsened')) {
      return 'progress-decrease';
    }
    
    if (progressText.includes('increased') || progressText.includes('improved') || 
        progressText.includes('expanded')) {
      return 'progress-increase';
    }
    
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
      if (topError.impact === 'high' || 
          (topError.teachingPriority && topError.teachingPriority.toLowerCase().includes('critical'))) {
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
    
    if (level === 'C2') {
      return '🎯 Native-level fluency maintained!';
    }
    
    if (metrics?.grammarAccuracyChange && metrics.grammarAccuracyChange > 0) {
      return `🔥 Grammar improved ${metrics.grammarAccuracyChange}% since last session!`;
    }
    
    if (metrics?.vocabularyGrowth && metrics.vocabularyGrowth > 3) {
      return `🥳 Your vocabulary grew by ${metrics.vocabularyGrowth} words!`;
    }
    
    if (metrics?.errorRateChange && metrics.errorRateChange < 0) {
      const improvement = Math.abs(metrics.errorRateChange);
      return `✨ ${improvement}% fewer errors than last time!`;
    }
    
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
    
    if (metrics?.errorRateChange && metrics.errorRateChange > 5) {
      return `⚠️ More errors today (${metrics.errorRateChange}% increase) — let's review them next time`;
    }
    
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
    const alert = await this.alertCtrl.create({
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
      // Unsave
      const item = this.reviewDeckItems.find(i => 
        i.original === original && i.corrected === corrected
      );
      
      if (item) {
        this.reviewDeckService.deleteItem(item._id).subscribe({
          next: async () => {
            this.savedCorrections.delete(key);
            this.reviewDeckItems = this.reviewDeckItems.filter(i => i._id !== item._id);
            
            const toast = await this.toastCtrl.create({
              message: 'Removed from review deck',
              duration: 2000,
              position: 'bottom',
              color: 'medium'
            });
            await toast.present();
          },
          error: async (error) => {
            console.error('Error removing from review deck:', error);
            const toast = await this.toastCtrl.create({
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
      // Save
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
          
          const toast = await this.toastCtrl.create({
            message: '✅ Saved to review deck',
            duration: 2000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
        },
        error: async (error) => {
          console.error('Error saving to review deck:', error);
          const toast = await this.toastCtrl.create({
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
    this.reviewDeckService.getItems({ limit: 1000 }).subscribe({
      next: (response) => {
        this.reviewDeckItems = response.items;
        response.items.forEach(item => {
          const key = `${item.original}->${item.corrected}`;
          this.savedCorrections.add(key);
        });
        console.log('✅ Loaded saved corrections:', this.reviewDeckItems.length);
      },
      error: (error) => {
        console.error('⚠️ Could not load saved corrections (non-blocking):', error);
      }
    });
  }
}
