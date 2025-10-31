import { Component, OnInit, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
@Component({
  selector: 'app-tutor-search',
  templateUrl: './tutor-search.page.html',
  styleUrls: ['./tutor-search.page.scss'],
  standalone: false,
})
export class TutorSearchPage implements OnInit {
  @Input() scrollToTutorId?: string;

  constructor(private modalCtrl: ModalController) { }

  ngOnInit() {
  }

  cancel() {
    this.modalCtrl.dismiss();
  }
}
