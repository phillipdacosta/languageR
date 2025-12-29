import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface EarlyExitData {
  lessonId: string;
  scheduledEndTime: Date;
  currentTime: Date;
  minutesRemaining: number;
}

@Injectable({
  providedIn: 'root'
})
export class EarlyExitService {
  private earlyExitTriggered = new Subject<EarlyExitData>();
  public earlyExitTriggered$ = this.earlyExitTriggered.asObservable();
  
  // New: Emit when lesson is confirmed ended early
  private lessonEndedEarly = new Subject<string>(); // lessonId
  public lessonEndedEarly$ = this.lessonEndedEarly.asObservable();

  constructor() { }

  /**
   * Trigger early exit flow - this will be observed by app.component to show modal
   */
  triggerEarlyExit(data: EarlyExitData) {
    console.log('🚪 EarlyExitService: Triggering early exit flow', data);
    this.earlyExitTriggered.next(data);
  }
  
  /**
   * Notify that lesson has been confirmed ended early
   * This tells the video-call page to stop transcription immediately
   */
  confirmLessonEnded(lessonId: string) {
    console.log('✅ EarlyExitService: Lesson confirmed ended:', lessonId);
    this.lessonEndedEarly.next(lessonId);
  }

  /**
   * Check if user is exiting early
   */
  isEarlyExit(scheduledEndTime: Date, currentTime: Date = new Date()): boolean {
    return currentTime < scheduledEndTime;
  }

  /**
   * Get minutes remaining until scheduled end
   */
  getMinutesRemaining(scheduledEndTime: Date, currentTime: Date = new Date()): number {
    return Math.round((scheduledEndTime.getTime() - currentTime.getTime()) / 60000);
  }
}

