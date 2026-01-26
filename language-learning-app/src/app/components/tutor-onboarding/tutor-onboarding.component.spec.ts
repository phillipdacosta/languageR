import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { TutorOnboardingComponent } from './tutor-onboarding.component';

describe('TutorOnboardingComponent', () => {
  let component: TutorOnboardingComponent;
  let fixture: ComponentFixture<TutorOnboardingComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [TutorOnboardingComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TutorOnboardingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
