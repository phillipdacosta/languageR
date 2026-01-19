import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { TutorAvailabilitySelectionModalComponent } from './tutor-availability-selection-modal.component';

describe('TutorAvailabilitySelectionModalComponent', () => {
  let component: TutorAvailabilitySelectionModalComponent;
  let fixture: ComponentFixture<TutorAvailabilitySelectionModalComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [TutorAvailabilitySelectionModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TutorAvailabilitySelectionModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
