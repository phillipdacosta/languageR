import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { ReminderNotificationComponent } from './reminder-notification.component';

describe('ReminderNotificationComponent', () => {
  let component: ReminderNotificationComponent;
  let fixture: ComponentFixture<ReminderNotificationComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ReminderNotificationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReminderNotificationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
