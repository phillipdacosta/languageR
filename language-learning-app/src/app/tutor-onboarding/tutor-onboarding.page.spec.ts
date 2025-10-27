import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TutorOnboardingPage } from './tutor-onboarding.page';

describe('TutorOnboardingPage', () => {
  let component: TutorOnboardingPage;
  let fixture: ComponentFixture<TutorOnboardingPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(TutorOnboardingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
