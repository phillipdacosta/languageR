import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { UserService } from '../services/user.service';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

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
}

interface ProgressStats {
  currentLevel: string;
  currentConfidence: number;
  totalStudyTime: number;
  streak: number;
  improvementRate: string;
  avgGrammar: number;
  avgFluency: number;
  avgVocabulary: number;
  avgPronunciation: number;
  avgListening: number;
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
}

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  standalone: false,
})
export class Tab3Page implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('radarCanvas') radarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('lineCanvas') lineCanvas!: ElementRef<HTMLCanvasElement>;
  
  analyses: AnalysisSummary[] = [];
  sortedAnalyses: AnalysisSummary[] = []; // For timeline display
  loading = true;
  error = '';
  currentUser: any = null;
  
  stats: ProgressStats = {
    currentLevel: 'N/A',
    currentConfidence: 0,
    totalStudyTime: 0,
    streak: 0,
    improvementRate: '0%',
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
  
  private radarChart: Chart | null = null;
  private lineChart: Chart | null = null;

  constructor(
    private router: Router,
    private http: HttpClient,
    private userService: UserService
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
    // Reload data when page is entered
    if (this.currentUser) {
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
        this.analyses = response.analyses.map((a: any) => ({
          ...a,
          grammarAccuracy: a.grammarAnalysis?.accuracyScore || 0,
          fluencyScore: a.fluencyAnalysis?.overallFluencyScore || 0,
          vocabularyRange: a.vocabularyAnalysis?.vocabularyRange || 'moderate',
          errorRate: a.progressionMetrics?.errorRate || 0,
          speakingTimeMinutes: a.progressionMetrics?.speakingTimeMinutes || 0
        }));
        
        console.log('✅ [Progress] Loaded', this.analyses.length, 'analyses');
        
        // Calculate stats
        this.calculateStats();
        
        // Initialize badges and gamification
        this.initializeBadges();
        
        // Sort analyses for timeline (oldest to newest)
        this.sortedAnalyses = [...this.analyses].sort((a, b) => 
          new Date(a.lessonDate).getTime() - new Date(b.lessonDate).getTime()
        );
        
        // Create charts
        setTimeout(() => {
          this.createRadarChart();
          this.createLineChart();
        }, 100);
      }
    } catch (error: any) {
      console.error('❌ [Progress] Error loading analyses:', error);
      this.error = error.error?.message || 'Failed to load analyses';
    } finally {
      this.loading = false;
    }
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
    
    // Current level from AVERAGE of all lessons (consistent with chart)
    const levelMap: { [key: string]: number } = { 
      'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 
    };
    const levelNames: { [key: number]: string } = {
      1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2'
    };
    
    // Calculate average level from all lessons
    const levels = sorted.map(a => levelMap[a.proficiencyLevel] || 3);
    const avgLevelNum = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
    const avgLevelClamped = Math.max(1, Math.min(6, avgLevelNum));
    
    this.stats.currentLevel = levelNames[avgLevelClamped];
    
    // Use most recent confidence (that's fine to keep as latest)
    this.stats.currentConfidence = sorted[0].confidence;
    
    // Improvement rate (compare first vs last)
    if (sorted.length > 1) {
      const firstLevel = levelMap[sorted[sorted.length - 1].proficiencyLevel] || 0;
      const lastLevel = levelMap[sorted[0].proficiencyLevel] || 0;
      const improvement = ((lastLevel - firstLevel) / firstLevel) * 100;
      this.stats.improvementRate = improvement > 0 ? `+${Math.round(improvement)}%` : '0%';
    }
    
    // Average scores
    this.stats.avgGrammar = this.calculateAverage(this.analyses.map(a => a.grammarAccuracy || 0));
    this.stats.avgFluency = this.calculateAverage(this.analyses.map(a => a.fluencyScore || 0));
    
    // Vocabulary (convert range to score)
    const vocabScores = this.analyses.map(a => this.vocabularyToScore(a.vocabularyRange || 'moderate'));
    this.stats.avgVocabulary = this.calculateAverage(vocabScores);
    
    // Pronunciation (use 100 - errorRate as proxy)
    const pronunciationScores = this.analyses.map(a => Math.max(0, 100 - (a.errorRate || 0) * 100));
    this.stats.avgPronunciation = this.calculateAverage(pronunciationScores);
    
    // Listening (use fluency as proxy for now)
    this.stats.avgListening = this.stats.avgFluency * 0.95; // Slightly lower than fluency
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
  
  vocabularyToScore(range: string): number {
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
          pointHoverBorderWidth: 4,
          stepped: 'before' // Creates step chart effect
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
        description: '7-day streak',
        icon: 'flame',
        type: 'streak',
        requirement: 7,
        earned: streak >= 7,
        color: '#ef4444'
      },
      {
        id: 'streak-14',
        name: 'Two-Week Champion',
        description: '14-day streak',
        icon: 'flame',
        type: 'streak',
        requirement: 14,
        earned: streak >= 14,
        color: '#f97316'
      },
      {
        id: 'streak-30',
        name: 'Monthly Master',
        description: '30-day streak',
        icon: 'trophy',
        type: 'streak',
        requirement: 30,
        earned: streak >= 30,
        color: '#fbbf24'
      },
      {
        id: 'streak-60',
        name: 'Consistency King',
        description: '60-day streak',
        icon: 'diamond',
        type: 'streak',
        requirement: 60,
        earned: streak >= 60,
        color: '#a855f7'
      },
      {
        id: 'streak-100',
        name: 'Dedication Legend',
        description: '100-day streak',
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
        color: badge?.color || '#3b82f6'
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
        color: badge?.color || '#ef4444'
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
}
