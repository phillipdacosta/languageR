import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AvailabilitySetupComponent } from './availability-setup.component';

describe('AvailabilitySetupComponent', () => {
  let component: AvailabilitySetupComponent;
  let fixture: ComponentFixture<AvailabilitySetupComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [AvailabilitySetupComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilitySetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
