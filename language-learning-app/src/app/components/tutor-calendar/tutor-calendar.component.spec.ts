import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { TutorCalendarComponent } from './tutor-calendar.component';

describe('TutorCalendarComponent', () => {
  let component: TutorCalendarComponent;
  let fixture: ComponentFixture<TutorCalendarComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [TutorCalendarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TutorCalendarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
