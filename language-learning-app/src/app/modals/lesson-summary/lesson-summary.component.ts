import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { TranscriptionService, LessonAnalysis } from '../../services/transcription.service';

@Component({
  selector: 'app-lesson-summary',
  templateUrl: './lesson-summary.component.html',
  styleUrls: ['./lesson-summary.component.scss'],
})
export class LessonSummaryComponent implements OnInit {
  @Input() lessonId!: string;
  @Input() transcriptId?: string;

  analysis: LessonAnalysis | null = null;
  loading = true;

  constructor(
    private modalController: ModalController,
    private transcriptionService: TranscriptionService
  ) {}

  ngOnInit() {
    this.loadAnalysis();
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
            console.log('✅ Analysis loaded successfully');
          } else if (analysis.status === 'failed') {
            console.error('❌ Analysis failed');
            this.loading = false;
            clearInterval(interval);
          }
        },
        error: (error) => {
          // Still processing, keep polling
          if (attempts >= maxAttempts) {
            console.error('Analysis timeout');
            this.loading = false;
            clearInterval(interval);
          }
        }
      });
    }, 2000); // Check every 2 seconds
  }

  dismiss() {
    this.modalController.dismiss();
  }
}
