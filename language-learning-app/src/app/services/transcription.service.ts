import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface TranscriptSegment {
  timestamp: Date;
  speaker: 'student' | 'tutor';
  text: string;
  confidence?: number;
  language: string;
}

export interface LessonAnalysis {
  lessonId: string;
  transcriptId: string;
  studentId: string;
  tutorId: string;
  language: string;
  lessonDate: Date;
  
  overallAssessment: {
    proficiencyLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
    confidence: number;
    summary: string;
    progressFromLastLesson?: string;
  };
  
  // Progression metrics
  progressionMetrics?: {
    previousProficiencyLevel: string;
    proficiencyChange: string;
    errorRate: number;
    errorRateChange: number;
    vocabularyGrowth: number;
    fluencyImprovement: number;
    grammarAccuracyChange: number;
    confidenceLevel: number;
    speakingTimeMinutes: number;
    complexSentencesUsed: number;
    keyImprovements: string[];
    persistentChallenges: string[];
  };
  
  // New: Top priority errors ranked by importance
  topErrors?: Array<{
    rank: number;
    issue: string;
    impact: 'low' | 'medium' | 'high';
    occurrences: number;
    teachingPriority: 'optional' | 'important' | 'critical';
  }>;
  
  // New: Error patterns with grouped examples
  errorPatterns?: Array<{
    pattern: string;
    frequency: number;
    severity: 'low' | 'medium' | 'high';
    examples: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
    practiceNeeded: string;
  }>;
  
  // New: Corrected excerpts (not full transcript)
  correctedExcerpts?: Array<{
    context: string;
    original: string;
    corrected: string;
    keyCorrections: string[];
  }>;
  
  strengths: string[];
  areasForImprovement: string[];
  
  grammarAnalysis: {
    mistakeTypes: Array<{
      type: string;
      examples: string[];
      frequency: number;
      severity: 'minor' | 'moderate' | 'major' | 'low' | 'medium' | 'high';
    }>;
    suggestions: string[];
    accuracyScore: number;
  };
  
  vocabularyAnalysis: {
    uniqueWordCount: number;
    vocabularyRange: 'limited' | 'moderate' | 'good' | 'excellent';
    suggestedWords: string[];
    advancedWordsUsed: string[];
  };
  
  fluencyAnalysis: {
    speakingSpeed: string;
    pauseFrequency: string;
    fillerWords: {
      count: number;
      examples: string[];
    };
    overallFluencyScore: number;
    notes?: string;
  };
  
  // Pronunciation Assessment (Azure Speech)
  pronunciationAnalysis?: {
    overallScore: number;
    accuracyScore: number;
    fluencyScore: number;
    prosodyScore: number;
    completenessScore: number;
    mispronunciations: Array<{
      word: string;
      score: number;
      errorType: string;
      problematicPhonemes: string[];
    }>;
    segmentsAssessed: number;
    totalSegments: number;
    targetLanguageSegments: number;
    samplingRate: number;
  };
  
  topicsDiscussed: string[];
  conversationQuality: 'basic' | 'intermediate' | 'advanced' | 'excellent' | 'elementary';
  
  recommendedFocus: string[];
  suggestedExercises: string[];
  homeworkSuggestions: string[];
  
  studentSummary: string;
  
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string; // Optional error message when status is 'failed'
}

@Injectable({
  providedIn: 'root'
})
export class TranscriptionService {
  private apiUrl = `${environment.backendUrl}/api/transcription`;
  
  // Observable for real-time transcription status
  private transcriptionStatus = new BehaviorSubject<'idle' | 'recording' | 'processing' | 'completed'>('idle');
  public transcriptionStatus$ = this.transcriptionStatus.asObservable();
  
  public currentTranscriptId: string | null = null;
  private segmentBuffer: TranscriptSegment[] = [];
  private flushInterval: any = null;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  /**
   * Start transcription for a lesson
   */
  startTranscription(lessonId: string, language: string): Observable<any> {
    console.log(`🎙️ Starting transcription for lesson ${lessonId}`);
    
    this.transcriptionStatus.next('recording');
    
    const headers = this.userService.getAuthHeadersSync();
    
    return new Observable(observer => {
      this.http.post(`${this.apiUrl}/start`, { lessonId, language }, { headers })
        .subscribe({
          next: (response: any) => {
            this.currentTranscriptId = response.transcriptId;
            console.log(`✅ Transcription started: ${this.currentTranscriptId}`);
            
            // Start auto-flush of segments every 30 seconds
            this.startAutoFlush();
            
            observer.next(response);
            observer.complete();
          },
          error: (error) => {
            console.error('❌ Error starting transcription:', error);
            this.transcriptionStatus.next('idle');
            observer.error(error);
          }
        });
    });
  }

  /**
   * Add transcript segments (for real-time transcription)
   */
  addSegment(segment: TranscriptSegment): void {
    if (!this.currentTranscriptId) {
      console.warn('⚠️ No active transcript, segment not added');
      return;
    }
    
    this.segmentBuffer.push(segment);
    
    // Auto-flush if buffer gets too large
    if (this.segmentBuffer.length >= 10) {
      this.flushSegments();
    }
  }

  /**
   * Flush buffered segments to backend
   */
  private flushSegments(): void {
    if (this.segmentBuffer.length === 0 || !this.currentTranscriptId) {
      return;
    }
    
    const segments = [...this.segmentBuffer];
    this.segmentBuffer = [];
    
    const headers = this.userService.getAuthHeadersSync();
    
    this.http.post(`${this.apiUrl}/${this.currentTranscriptId}/segments`, { segments }, { headers })
      .subscribe({
        next: () => console.log(`📤 Flushed ${segments.length} segments`),
        error: (error) => console.error('❌ Error flushing segments:', error)
      });
  }

  /**
   * Start auto-flush interval
   */
  private startAutoFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    this.flushInterval = setInterval(() => {
      this.flushSegments();
    }, 30000); // Every 30 seconds
  }

  /**
   * Upload audio file for transcription
   */
  uploadAudio(transcriptId: string, audioBlob: Blob, speaker: 'student' | 'tutor'): Observable<any> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    formData.append('speaker', speaker);
    
    // Get auth headers but exclude Content-Type (Angular will set multipart/form-data automatically)
    const authHeaders = this.userService.getAuthHeadersSync();
    const authToken = authHeaders.get('Authorization') || authHeaders.get('authorization');
    const headers = new HttpHeaders({
      'Authorization': authToken || ''
    });
    // Don't set Content-Type - let Angular handle it for FormData
    
    console.log(`🎙️ Uploading audio for transcription (${speaker})`);
    
    return this.http.post(`${this.apiUrl}/${transcriptId}/audio`, formData, { headers });
  }

  /**
   * Complete transcription and trigger analysis
   */
  completeTranscription(): Observable<any> {
    if (!this.currentTranscriptId) {
      const error = new Error('No active transcription - currentTranscriptId is null/undefined');
      console.error('❌ completeTranscription failed:', error.message);
      console.error('💡 This usually means the transcription session was not properly resumed after page refresh');
      throw error;
    }
    
    console.log(`✅ Completing transcription: ${this.currentTranscriptId}`);
    
    // Flush any remaining segments
    this.flushSegments();
    
    // Stop auto-flush
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    this.transcriptionStatus.next('processing');
    
    const headers = this.userService.getAuthHeadersSync();
    console.log('📤 POST Request Details:');
    console.log('   URL:', `${this.apiUrl}/${this.currentTranscriptId}/complete`);
    console.log('   Headers:', headers.keys());
    console.log('   Authorization:', headers.get('Authorization')?.substring(0, 30) + '...');
    
    return new Observable(observer => {
      this.http.post(`${this.apiUrl}/${this.currentTranscriptId}/complete`, {}, { headers })
        .subscribe({
          next: (response) => {
            console.log('✅ Transcription completed, analysis started');
            console.log('✅ Response from /complete:', response);
            this.transcriptionStatus.next('completed');
            observer.next(response);
            observer.complete();
          },
          error: (error) => {
            console.error('❌ Error completing transcription:', error);
            console.error('❌ Error status:', error.status);
            console.error('❌ Error message:', error.message);
            console.error('❌ Full error:', error);
            this.transcriptionStatus.next('idle');
            observer.error(error);
          }
        });
    });
  }

  /**
   * Get analysis for a transcript
   */
  getAnalysis(transcriptId: string): Observable<LessonAnalysis> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<LessonAnalysis>(`${this.apiUrl}/${transcriptId}/analysis`, { headers });
  }

  /**
   * Get analysis for a lesson
   */
  getLessonAnalysis(lessonId: string): Observable<LessonAnalysis> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<LessonAnalysis>(`${this.apiUrl}/lesson/${lessonId}/analysis`, { headers });
  }

  /**
   * Get latest analysis for a student (optionally with specific tutor)
   */
  getLatestAnalysis(studentId: string, tutorId?: string): Observable<LessonAnalysis> {
    const params: any = {};
    if (tutorId) {
      params.tutorId = tutorId;
    }
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<LessonAnalysis>(`${this.apiUrl}/student/${studentId}/latest`, { params, headers });
  }

  /**
   * Get student progress report
   */
  getStudentProgress(studentId: string, tutorId?: string, limit: number = 10): Observable<any> {
    const params: any = { limit: limit.toString() };
    if (tutorId) {
      params.tutorId = tutorId;
    }
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get(`${this.apiUrl}/student/${studentId}/progress`, { params, headers });
  }

  /**
   * Get transcript status (for session validation)
   */
  getTranscript(transcriptId: string): Observable<any> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get(`${this.apiUrl}/${transcriptId}`, { headers });
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.currentTranscriptId = null;
    this.segmentBuffer = [];
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    this.transcriptionStatus.next('idle');
  }

  /**
   * Get current transcript ID
   */
  getCurrentTranscriptId(): string | null {
    return this.currentTranscriptId;
  }
}

