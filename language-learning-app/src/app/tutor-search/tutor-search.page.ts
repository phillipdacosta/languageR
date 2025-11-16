import { Component, OnInit, Input } from '@angular/core';
import { ModalController, ViewWillEnter } from '@ionic/angular';
@Component({
  selector: 'app-tutor-search',
  templateUrl: './tutor-search.page.html',
  styleUrls: ['./tutor-search.page.scss'],
  standalone: false,
})
export class TutorSearchPage implements OnInit, ViewWillEnter {
  @Input() scrollToTutorId?: string;

  constructor(private modalCtrl: ModalController) { }

  ngOnInit() {
  }
  
  ionViewWillEnter() {
    // This will trigger the child component's ionViewWillEnter
    console.log('TutorSearchPage: ionViewWillEnter');
  }

  cancel() {
    this.modalCtrl.dismiss();
  }
}
