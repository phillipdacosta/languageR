import { TestBed } from '@angular/core/testing';

import { EarlyExitService } from './early-exit.service';

describe('EarlyExitService', () => {
  let service: EarlyExitService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EarlyExitService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
