import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { UserService } from '../services/user.service';
import { ProgressService, Struggle, StruggleResponse } from '../services/progress.service';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

// 🚀 PERFORMANCE FIX: Extend Struggle with cached expansion state
interface ExpandableStruggle extends Struggle {
  isExpanded: boolean;
}

// Register Chart.js components
Chart.register(...registerables);

interface AnalysisSummary {
  _id: string;
  lessonId: string;
  lessonDate: Date;
  language: string;
  proficiencyLevel: string;
  confidence: number;
  status: string;
  tutorName: string;
  tutorPicture?: string;
  subject?: string;
  grammarAccuracy?: number;
  fluencyScore?: number;
  vocabularyRange?: string;
  errorRate?: number;
  speakingTimeMinutes?: number;
  // Lesson type flags
  isTrialLesson?: boolean;
  isOfficeHours?: boolean;
  officeHoursType?: string | null;
  // Cached computed values (added for performance)
  formattedDate?: string;
  levelClass?: string;
  tutorInitial?: string;
  formattedTutorName?: string;
}

interface ProgressStats {
  currentLevel: string;
  currentConfidence: number;
  totalStudyTime: number;
  streak: number;
  improvementRate: string | null;
  improvementMessage: string | null;
  avgGrammar: number;
  avgFluency: number;
  avgVocabulary: number;
  avgPronunciation: number;
  avgListening: number;
  // Cached computed values (added for performance)
  totalStudyTimeFormatted?: string;
  currentLevelClass?: string;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'lesson' | 'level' | 'streak' | 'skill';
  requirement: number | string;
  earned: boolean;
  earnedDate?: Date;
  color: string;
}

interface NextGoal {
  type: 'lesson' | 'level' | 'streak';
  title: string;
  description: string;
  current: number;
  target: number;
  icon: string;
  color: string;
  progressPercentage?: number; // Cached value to avoid function calls in template
}

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Default // Keep Default for now, OnPush would require more refactoring
})
export class Tab3Page implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('radarCanvas') radarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('lineCanvas') lineCanvas!: ElementRef<HTMLCanvasElement>;
  
  analyses: AnalysisSummary[] = [];
  sortedAnalyses: AnalysisSummary[] = []; // For timeline display
  loading = true;
  error = '';
  currentUser: any = null;
  private hasInitiallyLoaded = false; // Track if data has been loaded
  
  stats: ProgressStats = {
    currentLevel: 'N/A',
    currentConfidence: 0,
    totalStudyTime: 0,
    streak: 0,
    improvementRate: null,
    improvementMessage: null,
    avgGrammar: 0,
    avgFluency: 0,
    avgVocabulary: 0,
    avgPronunciation: 0,
    avgListening: 0
  };
  
  badges: Badge[] = [];
  nextGoal: NextGoal | null = null;
  earnedBadgesCount = 0;
  totalBadgesCount = 0;
  highestLevelReached: string = '';
  
  // Struggles data
  struggles: ExpandableStruggle[] = [];
  strugglesLoading = false;
  strugglesError = '';
  currentLanguage: string = '';
  expandedStruggles: Set<number> = new Set(); // Track which struggles are expanded
  
  milestoneSnapshots: any[] = [];
  selectedMilestone: number = 0;
  
  // Expose Math for template
  Math = Math;
  
  private radarChart: Chart | null = null;
  private lineChart: Chart | null = null;

  constructor(
    private router: Router,
    private http: HttpClient,
    private userService: UserService,
    private progressService: ProgressService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadCurrentUser();
  }
  
  ngAfterViewInit() {
    // Charts will be created after data is loaded
  }
  
  ngOnDestroy() {
    // Cleanup charts
    if (this.radarChart) {
      this.radarChart.destroy();
    }
    if (this.lineChart) {
      this.lineChart.destroy();
    }
  }
  
  get isProfileUnlocked(): boolean {
    return this.analyses.length >= 5;
  }
  
  get lessonsUntilUnlock(): number {
    return Math.max(0, 5 - this.analyses.length);
  }
  
  get checklistItems(): number[] {
    return [1, 2, 3, 4, 5];
  }

  ionViewWillEnter() {
    // Only reload data on subsequent visits (after initial load)
    // This prevents duplicate loading on first page load
    if (this.currentUser && this.hasInitiallyLoaded) {
      console.log('🔄 [Progress] Reloading data on page re-enter...');
      this.loadAnalyses();
    }
  }

  async loadCurrentUser() {
    this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user?.userType === 'student') {
        this.loadAnalyses();
      }
    });
  }

  async loadAnalyses() {
    try {
      console.log('🔍 [Progress] Starting to load analyses...');
      this.loading = true;
      this.error = '';

      const headers = this.userService.getAuthHeadersSync();
      const url = `${environment.backendUrl}/api/transcription/my-analyses`;

      const response: any = await this.http.get(url, { headers }).toPromise();

      if (response.success && response.analyses) {
        // ⚠️ IMPORTANT: Filter excludes trial lessons and quick office hours
        // This filtering affects ALL progress features:
        // - CEFR Level Progress chart
        // - Total study time
        // - Streak calculations
        // - Badge counts (lesson milestones)
        // - Struggles analysis
        // - Stats (grammar, fluency, vocabulary averages)
        // - Improvement rate
        // - Radar chart
        // - Skills progress bars
        this.analyses = response.analyses
          .filter((a: any) => {
            // Backend should already filter, but double-check on frontend
            if (a.isTrialLesson === true) {
              console.log('🚫 [Progress] Frontend filtering out trial lesson:', a._id);
              return false;
            }
            if (a.isOfficeHours === true && a.officeHoursType === 'quick') {
              console.log('🚫 [Progress] Frontend filtering out quick office hours:', a._id);
              return false;
            }
            return true;
          })
          .map((a: any) => ({
            ...a,
            grammarAccuracy: a.grammarAnalysis?.accuracyScore || 0,
            fluencyScore: a.fluencyAnalysis?.overallFluencyScore || 0,
            vocabularyRange: a.vocabularyAnalysis?.vocabularyRange || 'moderate',
            errorRate: a.progressionMetrics?.errorRate || 0,
            speakingTimeMinutes: a.progressionMetrics?.speakingTimeMinutes || 0
          }));
        
        console.log('✅ [Progress] Loaded', this.analyses.length, 'analyses (excluding trial & quick office hours)');
        console.log('   All progress features (badges, stats, charts) will use this filtered data');

        // 🚀 PERFORMANCE FIX: Break up heavy computations to prevent UI freeze
        // Let the UI render first, then compute stats/badges in separate microtasks
        
        // Step 1: Calculate stats (needs to happen first for other calculations)
        setTimeout(() => {
          console.log('📊 [Progress] Step 1: Calculating stats...');
          this.calculateStats();
          this.cdr.detectChanges();
          
          // Step 2: Pre-compute timeline data (depends on stats)
          setTimeout(() => {
            console.log('📊 [Progress] Step 2: Pre-computing timeline data...');
            this.sortedAnalyses = [...this.analyses]
              .sort((a, b) => 
                new Date(b.lessonDate).getTime() - new Date(a.lessonDate).getTime()
              )
              .map(analysis => ({
                ...analysis,
                // Pre-compute formatted values
                formattedDate: this.formatDate(analysis.lessonDate),
                levelClass: this.getLevelClass(analysis.proficiencyLevel),
                tutorInitial: this.getTutorInitial(analysis.tutorName),
                formattedTutorName: this.formatTutorName(analysis.tutorName)
              }));
            this.cdr.detectChanges();
            
            // Step 3: Initialize badges (depends on stats)
            setTimeout(() => {
              console.log('📊 [Progress] Step 3: Initializing badges...');
              this.initializeBadges();
              this.cdr.detectChanges();
              
              // Step 4: Calculate milestone snapshots
              setTimeout(() => {
                console.log('📊 [Progress] Step 4: Calculating milestone snapshots...');
                this.calculateMilestoneSnapshots();
                this.cdr.detectChanges();
                
                // Step 5: Create charts (after all data is ready)
                setTimeout(() => {
                  console.log('📊 [Progress] Step 5: Creating charts...');
                  this.createRadarChart();
                  this.createLineChart();
                  this.cdr.detectChanges();
                  console.log('✅ [Progress] All computations complete!');
                }, 50);
                
                // Step 6: Load struggles (can happen in parallel)
                console.log('📊 [Progress] Step 6: Loading struggles...');
                this.loadStruggles();
              }, 0);
            }, 0);
          }, 0);
        }, 0);
        
        // Mark as initially loaded
        this.hasInitiallyLoaded = true;
      }
    } catch (error: any) {
      console.error('❌ [Progress] Error loading analyses:', error);
      this.error = error.error?.message || 'Failed to load analyses';
    } finally {
      this.loading = false;
    }
  }
  
  async loadStruggles() {
    try {
      // Determine the most common language from analyses
      if (this.analyses.length === 0) {
        return;
      }
      
      // Count lessons by language
      const languageCounts: { [key: string]: number } = {};
      this.analyses.forEach(a => {
        languageCounts[a.language] = (languageCounts[a.language] || 0) + 1;
      });
      
      // Get most common language
      this.currentLanguage = Object.keys(languageCounts).reduce((a, b) => 
        languageCounts[a] > languageCounts[b] ? a : b
      );
      
      console.log('🔍 [Progress] Loading struggles for language:', this.currentLanguage);
      this.strugglesLoading = true;
      this.strugglesError = '';
      
      this.progressService.getStruggles(this.currentLanguage).subscribe({
        next: (response: StruggleResponse) => {
          console.log('✅ [Progress] Struggles loaded:', response);
          if (response.success && response.hasEnoughData) {
            // 🚀 PERFORMANCE FIX: Add isExpanded property to avoid function calls in template
            this.struggles = (response.struggles || []).map(s => ({
              ...s,
              isExpanded: false
            }));
          } else {
            this.struggles = [];
          }
          this.strugglesLoading = false;
        },
        error: (error) => {
          console.error('❌ [Progress] Error loading struggles:', error);
          this.strugglesError = 'Failed to load challenges';
          this.strugglesLoading = false;
        }
      });
    } catch (error) {
      console.error('❌ [Progress] Error in loadStruggles:', error);
      this.strugglesLoading = false;
    }
  }
  
  getImpactColor(impact: string): string {
    switch (impact) {
      case 'high': return 'danger';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'medium';
    }
  }
  
  getImpactIcon(impact: string): string {
    switch (impact) {
      case 'high': return 'alert-circle';
      case 'medium': return 'warning';
      case 'low': return 'information-circle';
      default: return 'help-circle';
    }
  }
  
  toggleStruggle(index: number) {
    // 🚀 PERFORMANCE FIX: Toggle property directly instead of using Set
    if (this.struggles[index]) {
      this.struggles[index].isExpanded = !this.struggles[index].isExpanded;
    }
  }
  
  isStruggleExpanded(index: number): boolean {
    // Keep for backwards compatibility, but should use struggle.isExpanded directly in template
    return this.struggles[index]?.isExpanded || false;
  }
  
  calculateStats() {
    if (this.analyses.length === 0) return;
    
    // Sort by date (newest first)
    const sorted = [...this.analyses].sort((a, b) => 
      new Date(b.lessonDate).getTime() - new Date(a.lessonDate).getTime()
    );
    
    // Always calculate these (shown even with < 5 lessons)
    this.stats.totalStudyTime = this.analyses.reduce((sum, a) => sum + (a.speakingTimeMinutes || 0), 0);
    this.stats.streak = this.calculateStreak(sorted);
    
    // Only calculate detailed stats if 5+ lessons
    if (!this.isProfileUnlocked) {
      return;
    }
    
    // Current level from MOST RECENT MILESTONE (consistent with chart)
    const levelMap: { [key: string]: number } = { 
      'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 
    };
    const levelNames: { [key: number]: string } = {
      1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2'
    };
    
    // Sort by date (oldest first for milestone calculation)
    const sortedOldestFirst = [...this.analyses].sort((a, b) => 
      new Date(a.lessonDate).getTime() - new Date(b.lessonDate).getTime()
    );
    
    // Get the most recent complete 5-lesson milestone
    const totalLessons = sortedOldestFirst.length;
    if (totalLessons >= 5) {
      // Find the last complete milestone block (5, 10, 15, etc.)
      const lastMilestoneIndex = Math.floor(totalLessons / 5) * 5;
      const milestoneBlock = sortedOldestFirst.slice(lastMilestoneIndex - 5, lastMilestoneIndex);
      
      // Calculate average level for this milestone block
      const levels = milestoneBlock.map(a => levelMap[a.proficiencyLevel] || 3);
      const avgLevelNum = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
      const avgLevelClamped = Math.max(1, Math.min(6, avgLevelNum));
      
      this.stats.currentLevel = levelNames[avgLevelClamped];
    } else {
      // Less than 5 lessons: use average of all lessons
      const levels = sortedOldestFirst.map(a => levelMap[a.proficiencyLevel] || 3);
      const avgLevelNum = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
      const avgLevelClamped = Math.max(1, Math.min(6, avgLevelNum));
      this.stats.currentLevel = levelNames[avgLevelClamped];
    }
    
    // Use most recent confidence (that's fine to keep as latest)
    this.stats.currentConfidence = sorted[0].confidence;
    
    // Improvement rate - TREND-BASED approach (last 3-5 lessons)
    if (this.stats.currentLevel === 'C2') {
      // Special handling for C2 (Mastery level)
      this.stats.improvementRate = null;
      this.stats.improvementMessage = 'Mastery Level';
    } else if (sorted.length === 1) {
      // First lesson
      this.stats.improvementRate = null;
      this.stats.improvementMessage = 'Just Getting Started';
    } else if (sorted.length === 2) {
      // Second lesson - show momentum
      this.stats.improvementRate = null;
      this.stats.improvementMessage = 'Building Momentum';
    } else {
      // 3+ lessons - use trend analysis
      const recentCount = Math.min(5, Math.floor(sorted.length / 2)); // Last 3-5 lessons
      const recentLessons = sorted.slice(0, recentCount);
      const olderLessons = sorted.slice(recentCount);
      
      // Calculate average level for recent vs older lessons
      const recentLevels = recentLessons.map(a => levelMap[a.proficiencyLevel] || 0);
      const olderLevels = olderLessons.map(a => levelMap[a.proficiencyLevel] || 0);
      
      const avgRecent = recentLevels.reduce((sum, l) => sum + l, 0) / recentLevels.length;
      const avgOlder = olderLevels.reduce((sum, l) => sum + l, 0) / olderLevels.length;
      
      const difference = avgRecent - avgOlder;
      
      // Determine trend (threshold: 0.3 level difference)
      if (difference > 0.3) {
        this.stats.improvementRate = null;
        this.stats.improvementMessage = 'Improving ↑';
      } else if (difference < -0.3) {
        this.stats.improvementRate = null;
        this.stats.improvementMessage = 'Keep Practicing';
      } else {
        this.stats.improvementRate = null;
        this.stats.improvementMessage = 'Steady Progress';
      }
    }
    
    // Average scores
    this.stats.avgGrammar = this.calculateAverage(this.analyses.map(a => a.grammarAccuracy || 0));
    this.stats.avgFluency = this.calculateAverage(this.analyses.map(a => a.fluencyScore || 0));
    
    // Vocabulary (convert range to score)
    const vocabScores = this.analyses.map(a => this.vocabularyToScore(a.vocabularyRange || 'moderate'));
    this.stats.avgVocabulary = this.calculateAverage(vocabScores);
    
    // Pronunciation - DISABLED: Not yet implemented in AI analysis
    // const pronunciationScores = this.analyses.map(a => Math.max(0, 100 - (a.errorRate || 0) * 100));
    // this.stats.avgPronunciation = this.calculateAverage(pronunciationScores);
    this.stats.avgPronunciation = 0; // Not yet available
    
    // Listening - DISABLED: Not yet implemented in AI analysis
    // this.stats.avgListening = this.stats.avgFluency * 0.95; // Slightly lower than fluency
    this.stats.avgListening = 0; // Not yet available
    
    // Cache computed values to avoid function calls in template
    this.stats.totalStudyTimeFormatted = this.getTotalStudyTimeFormatted();
    this.stats.currentLevelClass = this.getLevelClass(this.stats.currentLevel);
  }
  
  calculateStreak(sortedAnalyses: AnalysisSummary[]): number {
    if (sortedAnalyses.length === 0) return 0;
    
    let streak = 1;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < sortedAnalyses.length - 1; i++) {
      const current = new Date(sortedAnalyses[i].lessonDate);
      current.setHours(0, 0, 0, 0);
      
      const next = new Date(sortedAnalyses[i + 1].lessonDate);
      next.setHours(0, 0, 0, 0);
      
      const diffDays = Math.floor((current.getTime() - next.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        streak++;
      } else if (diffDays > 1) {
        break;
      }
    }
    
    return streak;
  }
  
  calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return Math.round(sum / numbers.length);
  }
  
  vocabularyToScore(range: string | undefined): number {
    if (!range) return 65;
    const map: { [key: string]: number } = {
      'limited': 50,
      'moderate': 65,
      'good': 80,
      'excellent': 95
    };
    return map[range] || 65;
  }
  
  createRadarChart() {
    if (!this.radarCanvas) return;
    
    if (this.radarChart) {
      this.radarChart.destroy();
    }
    
    const ctx = this.radarCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    
    const config: ChartConfiguration<'radar'> = {
      type: 'radar',
      data: {
        labels: ['Vocabulary', 'Grammar', 'Pronunciation', 'Fluency', 'Listening'],
        datasets: [{
          label: 'Your Skills',
          data: [
            this.stats.avgVocabulary,
            this.stats.avgGrammar,
            this.stats.avgPronunciation,
            this.stats.avgFluency,
            this.stats.avgListening
          ],
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 2,
          pointBackgroundColor: 'rgb(59, 130, 246)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgb(59, 130, 246)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: {
              stepSize: 20,
              font: {
                size: 11
              }
            },
            pointLabels: {
              font: {
                size: 13,
                weight: 500
              }
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.06)'
            }
          }
        },
        plugins: {
          legend: {
            display: false
          }
        }
      }
    };
    
    this.radarChart = new Chart(ctx, config);
  }
  
  createLineChart() {
    if (!this.lineCanvas) return;
    
    const ctx = this.lineCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    
    // Cleanup existing chart
    if (this.lineChart) {
      this.lineChart.destroy();
    }
    
    // Sort analyses by date (oldest to newest)
    const sortedAnalyses = [...this.analyses].sort((a, b) => 
      new Date(a.lessonDate).getTime() - new Date(b.lessonDate).getTime()
    );
    
    // Calculate CEFR level for every 5-lesson milestone
    const milestones = this.calculateCEFRMilestones(sortedAnalyses);
    
    if (milestones.length === 0) {
      console.log('Not enough lessons for milestones yet');
      return;
    }
    
    // Prepare data
    const labels = milestones.map(m => `Lesson ${m.lessonNumber}`);
    const levelData = milestones.map(m => m.levelNumeric);
    
    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');
    
    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'CEFR Level',
          data: levelData,
          borderColor: '#8b5cf6',
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.2, // Slight curves for steps
          pointRadius: 8,
          pointHoverRadius: 12,
          pointBackgroundColor: '#8b5cf6',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 3,
          pointHoverBackgroundColor: '#7c3aed',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 4
          // Removed stepped: 'before' to allow smooth diagonal gradient fill
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            padding: 16,
            cornerRadius: 12,
            titleFont: {
              size: 14,
              weight: 600
            },
            bodyFont: {
              size: 18,
              weight: 700
            },
            displayColors: false,
            callbacks: {
              label: (context) => {
                const levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
                const milestone = milestones[context.dataIndex];
                return `${levels[milestone.levelNumeric]} (Lessons ${milestone.startLesson}-${milestone.endLesson})`;
              }
            }
          }
        },
        scales: {
          y: {
            min: 0,
            max: 7,
            ticks: {
              stepSize: 1,
              callback: function(value) {
                const levels: { [key: number]: string } = {
                  0: '',
                  1: 'A1',
                  2: 'A2',
                  3: 'B1',
                  4: 'B2',
                  5: 'C1',
                  6: 'C2'
                };
                return levels[value as number] || '';
              },
              font: {
                size: 13,
                weight: 600
              },
              color: '#6b7280'
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.05)'
            },
            border: {
              display: false
            }
          },
          x: {
            ticks: {
              font: {
                size: 12,
                weight: 500
              },
              color: '#6b7280',
              maxRotation: 0,
              autoSkip: false
            },
            grid: {
              display: false
            },
            border: {
              display: false
            }
          }
        }
      }
    };
    
    this.lineChart = new Chart(ctx, config);
  }
  
  calculateCEFRMilestones(sortedAnalyses: AnalysisSummary[]): Array<{
    lessonNumber: number;
    startLesson: number;
    endLesson: number;
    level: string;
    levelNumeric: number;
  }> {
    const milestones = [];
    const levelMap: { [key: string]: number } = {
      'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6
    };
    
    // Calculate milestone every 5 lessons
    for (let i = 0; i < sortedAnalyses.length; i += 5) {
      const block = sortedAnalyses.slice(i, Math.min(i + 5, sortedAnalyses.length));
      
      // Only create milestone if we have at least 5 lessons in this block
      if (block.length < 5 && i > 0) {
        break; // Don't show incomplete blocks after the first milestone
      }
      
      // Calculate average CEFR level for this block
      const levels = block.map(a => levelMap[a.proficiencyLevel] || 3);
      const avgLevel = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
      const avgLevelClamped = Math.max(1, Math.min(6, avgLevel)); // Clamp between A1 and C2
      
      const levelNames: { [key: number]: string } = {
        1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2'
      };
      
      milestones.push({
        lessonNumber: i + block.length,
        startLesson: i + 1,
        endLesson: i + block.length,
        level: levelNames[avgLevelClamped],
        levelNumeric: avgLevelClamped
      });
    }
    
    return milestones;
  }
  
  calculateMilestoneSnapshots() {
    const sortedAnalyses = [...this.analyses].sort((a, b) => 
      new Date(a.lessonDate).getTime() - new Date(b.lessonDate).getTime()
    );
    
    this.milestoneSnapshots = [];
    const levelMap: { [key: string]: number } = {
      'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6
    };
    
    // Calculate snapshot for every 5 lessons
    for (let i = 0; i < sortedAnalyses.length; i += 5) {
      const block = sortedAnalyses.slice(i, Math.min(i + 5, sortedAnalyses.length));
      
      // Only create snapshot if we have at least 5 lessons in this block
      if (block.length < 5 && i > 0) {
        break;
      }
      
      // Calculate averages for this milestone
      const grammarScores = block.map(a => a.grammarAccuracy || 0).filter(s => s > 0);
      const fluencyScores = block.map(a => a.fluencyScore || 0).filter(s => s > 0);
      const vocabScores = block.map(a => this.vocabularyToScore(a.vocabularyRange)).filter(s => s > 0);
      const studyTime = block.reduce((sum, a) => sum + (a.speakingTimeMinutes || 0), 0);
      
      const avgGrammar = grammarScores.length > 0 
        ? Math.round(grammarScores.reduce((sum, s) => sum + s, 0) / grammarScores.length)
        : 0;
      const avgFluency = fluencyScores.length > 0
        ? Math.round(fluencyScores.reduce((sum, s) => sum + s, 0) / fluencyScores.length)
        : 0;
      const avgVocab = vocabScores.length > 0
        ? Math.round(vocabScores.reduce((sum, s) => sum + s, 0) / vocabScores.length)
        : 0;
      
      // Get CEFR level
      const levels = block.map(a => levelMap[a.proficiencyLevel] || 3);
      const avgLevel = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
      const avgLevelClamped = Math.max(1, Math.min(6, avgLevel));
      const levelNames: { [key: number]: string } = {
        1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2'
      };
      const cefrLevel = levelNames[avgLevelClamped];
      
      // Calculate improvement from previous milestone
      let grammarChange = 0;
      let fluencyChange = 0;
      let vocabChange = 0;
      if (this.milestoneSnapshots.length > 0) {
        const prev = this.milestoneSnapshots[this.milestoneSnapshots.length - 1];
        grammarChange = avgGrammar - prev.grammarScore;
        fluencyChange = avgFluency - prev.fluencyScore;
        vocabChange = avgVocab - prev.vocabScore;
      }
      
      this.milestoneSnapshots.push({
        milestoneNumber: Math.floor(i / 5) + 1,
        lessonNumber: i + block.length,
        startLesson: i + 1,
        endLesson: i + block.length,
        cefrLevel: cefrLevel,
        grammarScore: avgGrammar,
        fluencyScore: avgFluency,
        vocabScore: avgVocab,
        studyTime: studyTime,
        grammarChange: grammarChange,
        fluencyChange: fluencyChange,
        vocabChange: vocabChange,
        lessonsInBlock: block.length
      });
    }
    
    // Auto-select the most recent milestone
    if (this.milestoneSnapshots.length > 0) {
      this.selectedMilestone = this.milestoneSnapshots.length - 1;
    }
    
    console.log('📊 Calculated milestone snapshots:', this.milestoneSnapshots);
  }
  
  selectMilestone(index: number) {
    this.selectedMilestone = index;
  }
  
  getSelectedSnapshot() {
    return this.milestoneSnapshots[this.selectedMilestone];
  }
  
  formatStudyTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  viewAnalysis(analysisId: string, lessonId: string) {
    this.router.navigate(['/lesson-analysis', lessonId]);
  }
  
  formatDate(date: Date | string): string {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
  
  formatDateShort(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  
  formatTimeShort(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  
  formatFullDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  formatTime(hours: number, minutes: number): string {
    if (hours > 0) {
      return `${hours} h ${minutes} m`;
    }
    return `${minutes} m`;
  }
  
  getTotalStudyTimeFormatted(): string {
    const hours = Math.floor(this.stats.totalStudyTime / 60);
    const minutes = this.stats.totalStudyTime % 60;
    return this.formatTime(hours, minutes);
  }

  getProficiencyColor(level: string): string {
    const levelColors: { [key: string]: string } = {
      'A1': '#ef4444',
      'A2': '#f59e0b',
      'B1': '#8b5cf6',
      'B2': '#3b82f6',
      'C1': '#22c55e',
      'C2': '#22c55e'
    };
    return levelColors[level] || '#6b7280';
  }
  
  getLevelClass(level: string): string {
    const mapping: { [key: string]: string } = {
      'C1': 'success',
      'C2': 'success',
      'B2': 'primary',
      'B1': 'tertiary',
      'A2': 'warning',
      'A1': 'danger'
    };
    return mapping[level] || 'medium';
  }
  
  // =============================================
  // GAMIFICATION METHODS
  // =============================================
  
  initializeBadges() {
    const lessonCount = this.analyses.length;
    const streak = this.stats.streak;
    
    // Calculate highest level reached
    const levelHierarchy: { [key: string]: number } = {
      'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6
    };
    
    let highestLevel = '';
    let highestLevelNum = 0;
    this.analyses.forEach(a => {
      const levelNum = levelHierarchy[a.proficiencyLevel] || 0;
      if (levelNum > highestLevelNum) {
        highestLevelNum = levelNum;
        highestLevel = a.proficiencyLevel;
      }
    });
    this.highestLevelReached = highestLevel;
    
    // Define all badges
    this.badges = [
      // Lesson Milestone Badges
      {
        id: 'lesson-5',
        name: 'Getting Started',
        description: 'Complete 5 lessons',
        icon: 'rocket',
        type: 'lesson',
        requirement: 5,
        earned: lessonCount >= 5,
        color: '#3b82f6'
      },
      {
        id: 'lesson-10',
        name: 'Committed Learner',
        description: 'Complete 10 lessons',
        icon: 'school',
        type: 'lesson',
        requirement: 10,
        earned: lessonCount >= 10,
        color: '#8b5cf6'
      },
      {
        id: 'lesson-25',
        name: 'Dedicated Student',
        description: 'Complete 25 lessons',
        icon: 'book',
        type: 'lesson',
        requirement: 25,
        earned: lessonCount >= 25,
        color: '#06b6d4'
      },
      {
        id: 'lesson-50',
        name: 'Rising Star',
        description: 'Complete 50 lessons',
        icon: 'star',
        type: 'lesson',
        requirement: 50,
        earned: lessonCount >= 50,
        color: '#f59e0b'
      },
      {
        id: 'lesson-100',
        name: 'Language Master',
        description: 'Complete 100 lessons',
        icon: 'trophy',
        type: 'lesson',
        requirement: 100,
        earned: lessonCount >= 100,
        color: '#fbbf24'
      },
      
      // Level Achievement Badges
      {
        id: 'level-a2',
        name: 'Breaking Through',
        description: 'Reach A2 level',
        icon: 'trending-up',
        type: 'level',
        requirement: 'A2',
        earned: highestLevelNum >= 2,
        color: '#f59e0b'
      },
      {
        id: 'level-b1',
        name: 'Intermediate Achiever',
        description: 'Reach B1 level',
        icon: 'ribbon',
        type: 'level',
        requirement: 'B1',
        earned: highestLevelNum >= 3,
        color: '#8b5cf6'
      },
      {
        id: 'level-b2',
        name: 'Advanced Learner',
        description: 'Reach B2 level',
        icon: 'medal',
        type: 'level',
        requirement: 'B2',
        earned: highestLevelNum >= 4,
        color: '#3b82f6'
      },
      {
        id: 'level-c1',
        name: 'Proficiency Master',
        description: 'Reach C1 level',
        icon: 'shield-checkmark',
        type: 'level',
        requirement: 'C1',
        earned: highestLevelNum >= 5,
        color: '#22c55e'
      },
      {
        id: 'level-c2',
        name: 'Native-Level Legend',
        description: 'Reach C2 level',
        icon: 'sparkles',
        type: 'level',
        requirement: 'C2',
        earned: highestLevelNum >= 6,
        color: '#10b981'
      },
      
      // Streak Badges
      {
        id: 'streak-7',
        name: 'Week Warrior',
        description: 'Complete lessons 7 days in a row',
        icon: 'flame',
        type: 'streak',
        requirement: 7,
        earned: streak >= 7,
        color: '#f97316'  // Changed from red (#ef4444) to warm orange - more positive!
      },
      {
        id: 'streak-14',
        name: 'Two-Week Champion',
        description: 'Complete lessons 14 days in a row',
        icon: 'flame',
        type: 'streak',
        requirement: 14,
        earned: streak >= 14,
        color: '#fb923c'  // Slightly lighter orange to differentiate from 7-day
      },
      {
        id: 'streak-30',
        name: 'Monthly Master',
        description: 'Complete lessons 30 days in a row',
        icon: 'trophy',
        type: 'streak',
        requirement: 30,
        earned: streak >= 30,
        color: '#fbbf24'
      },
      {
        id: 'streak-60',
        name: 'Consistency King',
        description: 'Complete lessons 60 days in a row',
        icon: 'diamond',
        type: 'streak',
        requirement: 60,
        earned: streak >= 60,
        color: '#a855f7'
      },
      {
        id: 'streak-100',
        name: 'Dedication Legend',
        description: 'Complete lessons 100 days in a row',
        icon: 'star',
        type: 'streak',
        requirement: 100,
        earned: streak >= 100,
        color: '#ec4899'
      },
      
      // Skill-Specific Badges (5+ lessons required)
      {
        id: 'skill-grammar',
        name: 'Grammar Guru',
        description: '90%+ grammar average',
        icon: 'create',
        type: 'skill',
        requirement: 90,
        earned: lessonCount >= 5 && this.stats.avgGrammar >= 90,
        color: '#06b6d4'
      },
      {
        id: 'skill-vocabulary',
        name: 'Vocabulary Virtuoso',
        description: '90%+ vocabulary average',
        icon: 'albums',
        type: 'skill',
        requirement: 90,
        earned: lessonCount >= 5 && this.stats.avgVocabulary >= 90,
        color: '#8b5cf6'
      },
      {
        id: 'skill-pronunciation',
        name: 'Pronunciation Pro',
        description: '90%+ pronunciation average',
        icon: 'mic',
        type: 'skill',
        requirement: 90,
        earned: lessonCount >= 5 && this.stats.avgPronunciation >= 90,
        color: '#3b82f6'
      },
      {
        id: 'skill-fluency',
        name: 'Fluency Master',
        description: '90%+ fluency average',
        icon: 'chatbubbles',
        type: 'skill',
        requirement: 90,
        earned: lessonCount >= 5 && this.stats.avgFluency >= 90,
        color: '#10b981'
      },
      {
        id: 'skill-allrounder',
        name: 'All-Rounder',
        description: '80%+ in all skills',
        icon: 'star-half',
        type: 'skill',
        requirement: 80,
        earned: lessonCount >= 5 && 
                this.stats.avgGrammar >= 80 && 
                this.stats.avgVocabulary >= 80 && 
                this.stats.avgPronunciation >= 80 && 
                this.stats.avgFluency >= 80 &&
                this.stats.avgListening >= 80,
        color: '#fbbf24'
      }
    ];
    
    // Calculate earned count
    this.earnedBadgesCount = this.badges.filter(b => b.earned).length;
    this.totalBadgesCount = this.badges.length;
    
    // Calculate next goal
    this.calculateNextGoal();
  }
  
  calculateNextGoal() {
    const lessonCount = this.analyses.length;
    const streak = this.stats.streak;
    
    // Find next lesson milestone
    const lessonMilestones = [5, 10, 25, 50, 100];
    const nextLessonMilestone = lessonMilestones.find(m => m > lessonCount);
    
    // Find next streak milestone
    const streakMilestones = [7, 14, 30, 60, 100];
    const nextStreakMilestone = streakMilestones.find(m => m > streak);
    
    // Determine which goal is closest
    const lessonsToNextBadge = nextLessonMilestone ? nextLessonMilestone - lessonCount : Infinity;
    const streaksToNextBadge = nextStreakMilestone ? nextStreakMilestone - streak : Infinity;
    
    if (lessonsToNextBadge <= streaksToNextBadge && nextLessonMilestone) {
      const badge = this.badges.find(b => b.type === 'lesson' && b.requirement === nextLessonMilestone);
      this.nextGoal = {
        type: 'lesson',
        title: badge?.name || 'Next Milestone',
        description: badge?.description || '',
        current: lessonCount,
        target: nextLessonMilestone,
        icon: badge?.icon || 'flag',
        color: badge?.color || '#3b82f6',
        progressPercentage: Math.min(100, Math.round((lessonCount / nextLessonMilestone) * 100))
      };
    } else if (nextStreakMilestone) {
      const badge = this.badges.find(b => b.type === 'streak' && b.requirement === nextStreakMilestone);
      this.nextGoal = {
        type: 'streak',
        title: badge?.name || 'Next Streak',
        description: badge?.description || '',
        current: streak,
        target: nextStreakMilestone,
        icon: badge?.icon || 'flame',
        color: badge?.color || '#f97316',  // Default to warm orange instead of red
        progressPercentage: Math.min(100, Math.round((streak / nextStreakMilestone) * 100))
      };
    } else {
      // All milestones achieved!
      this.nextGoal = null;
    }
  }
  
  getProgressPercentage(goal: NextGoal): number {
    return Math.min(100, Math.round((goal.current / goal.target) * 100));
  }
  
  formatTutorName(fullName: string): string {
    if (!fullName) return '';
    const parts = fullName.trim().split(' ');
    if (parts.length === 1) return parts[0];
    const firstName = parts[0];
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${firstName} ${lastInitial}.`;
  }
  
  getTutorInitial(fullName: string): string {
    if (!fullName) return '?';
    return fullName.charAt(0).toUpperCase();
  }
  
  viewChecklistLesson(position: number) {
    // Only allow clicking completed lessons
    if (this.analyses.length < position) {
      return;
    }
    
    // Sort analyses by date (oldest first) to match checklist order
    const sortedByDate = [...this.analyses].sort((a, b) => 
      new Date(a.lessonDate).getTime() - new Date(b.lessonDate).getTime()
    );
    
    // Get the analysis at this position (position is 1-indexed)
    const analysis = sortedByDate[position - 1];
    
    if (analysis) {
      this.viewAnalysis(analysis._id, analysis.lessonId);
    }
  }
  
  // =============================================
  // TRACKBY FUNCTIONS (Performance Optimization)
  // =============================================
  
  trackByAnalysisId(index: number, analysis: AnalysisSummary): string {
    return analysis._id;
  }
  
  trackByBadgeId(index: number, badge: Badge): string {
    return badge.id;
  }
  
  trackByStruggleIssue(index: number, struggle: Struggle): string {
    return struggle.issue;
  }
  
  trackByMilestoneNumber(index: number, snapshot: any): number {
    return snapshot.milestoneNumber;
  }
  
  trackByChecklistItem(index: number, item: number): number {
    return item;
  }
  
  trackByExampleOriginal(index: number, example: any): string {
    return example.original + example.corrected;
  }
}
