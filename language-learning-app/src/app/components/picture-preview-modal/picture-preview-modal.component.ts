import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-picture-preview-modal',
  templateUrl: './picture-preview-modal.component.html',
  styleUrls: ['./picture-preview-modal.component.scss'],
  standalone: false,
})
export class PicturePreviewModalComponent implements OnInit {
  @Input() imageUrl: string = '';

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    console.log('🖼️ PicturePreviewModal initialized');
    console.log('🖼️ imageUrl:', this.imageUrl);
    console.log('🖼️ imageUrl length:', this.imageUrl?.length);
    console.log('🖼️ imageUrl type:', typeof this.imageUrl);
  }

  onImageLoad() {
    console.log('✅ Image loaded successfully!');
  }

  onImageError(event: any) {
    console.error('❌ Image failed to load:', event);
    console.error('❌ Image src was:', this.imageUrl);
  }

  cancel() {
    this.modalController.dismiss(null, 'cancel');
  }

  confirm() {
    this.modalController.dismiss(true, 'confirm');
  }
}













