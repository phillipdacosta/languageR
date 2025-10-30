import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TutorCalendarPage } from './tutor-calendar.page';

describe('TutorCalendarPage', () => {
  let component: TutorCalendarPage;
  let fixture: ComponentFixture<TutorCalendarPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(TutorCalendarPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
