import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

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
  
  strengths: string[];
  areasForImprovement: string[];
  
  grammarAnalysis: {
    mistakeTypes: Array<{
      type: string;
      examples: string[];
      frequency: number;
      severity: 'minor' | 'moderate' | 'major';
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
  };
  
  topicsDiscussed: string[];
  conversationQuality: 'basic' | 'intermediate' | 'advanced' | 'excellent';
  
  recommendedFocus: string[];
  suggestedExercises: string[];
  homeworkSuggestions: string[];
  
  studentSummary: string;
  
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

@Injectable({
  providedIn: 'root'
})
export class TranscriptionService {
  private apiUrl = `${environment.apiUrl}/transcription`;
  
  // Observable for real-time transcription status
  private transcriptionStatus = new BehaviorSubject<'idle' | 'recording' | 'processing' | 'completed'>('idle');
  public transcriptionStatus$ = this.transcriptionStatus.asObservable();
  
  private currentTranscriptId: string | null = null;
  private segmentBuffer: TranscriptSegment[] = [];
  private flushInterval: any = null;

  constructor(private http: HttpClient) {}

  /**
   * Start transcription for a lesson
   */
  startTranscription(lessonId: string, language: string): Observable<any> {
    console.log(`🎙️ Starting transcription for lesson ${lessonId}`);
    
    this.transcriptionStatus.next('recording');
    
    return new Observable(observer => {
      this.http.post(`${this.apiUrl}/start`, { lessonId, language })
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
    
    this.http.post(`${this.apiUrl}/${this.currentTranscriptId}/segments`, { segments })
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
    
    console.log(`🎙️ Uploading audio for transcription (${speaker})`);
    
    return this.http.post(`${this.apiUrl}/${transcriptId}/audio`, formData);
  }

  /**
   * Complete transcription and trigger analysis
   */
  completeTranscription(): Observable<any> {
    if (!this.currentTranscriptId) {
      throw new Error('No active transcription');
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
    
    return new Observable(observer => {
      this.http.post(`${this.apiUrl}/${this.currentTranscriptId}/complete`, {})
        .subscribe({
          next: (response) => {
            console.log('✅ Transcription completed, analysis started');
            this.transcriptionStatus.next('completed');
            observer.next(response);
            observer.complete();
          },
          error: (error) => {
            console.error('❌ Error completing transcription:', error);
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
    return this.http.get<LessonAnalysis>(`${this.apiUrl}/${transcriptId}/analysis`);
  }

  /**
   * Get analysis for a lesson
   */
  getLessonAnalysis(lessonId: string): Observable<LessonAnalysis> {
    return this.http.get<LessonAnalysis>(`${this.apiUrl}/lesson/${lessonId}/analysis`);
  }

  /**
   * Get latest analysis for a student (optionally with specific tutor)
   */
  getLatestAnalysis(studentId: string, tutorId?: string): Observable<LessonAnalysis> {
    const params = tutorId ? { tutorId } : {};
    return this.http.get<LessonAnalysis>(`${this.apiUrl}/student/${studentId}/latest`, { params });
  }

  /**
   * Get student progress report
   */
  getStudentProgress(studentId: string, tutorId?: string, limit: number = 10): Observable<any> {
    const params: any = { limit: limit.toString() };
    if (tutorId) {
      params.tutorId = tutorId;
    }
    return this.http.get(`${this.apiUrl}/student/${studentId}/progress`, { params });
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

