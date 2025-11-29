import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { OfficeHoursBookingComponent } from './office-hours-booking.component';

describe('OfficeHoursBookingComponent', () => {
  let component: OfficeHoursBookingComponent;
  let fixture: ComponentFixture<OfficeHoursBookingComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [OfficeHoursBookingComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OfficeHoursBookingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
