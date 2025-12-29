import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LessonAnalysisPage } from './lesson-analysis.page';

describe('LessonAnalysisPage', () => {
  let component: LessonAnalysisPage;
  let fixture: ComponentFixture<LessonAnalysisPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(LessonAnalysisPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
