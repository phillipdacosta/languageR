import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { StudentSelectionActionsheetComponent } from './student-selection-actionsheet.component';

describe('StudentSelectionActionsheetComponent', () => {
  let component: StudentSelectionActionsheetComponent;
  let fixture: ComponentFixture<StudentSelectionActionsheetComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ StudentSelectionActionsheetComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(StudentSelectionActionsheetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
