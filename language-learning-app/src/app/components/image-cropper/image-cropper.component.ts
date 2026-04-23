import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { ImageCroppedEvent, ImageCropperComponent as NgxImageCropper, LoadedImage } from 'ngx-image-cropper';

@Component({
  selector: 'app-image-cropper',
  templateUrl: './image-cropper.component.html',
  styleUrls: ['./image-cropper.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, NgxImageCropper]
})
export class ImageCropperComponent implements OnInit {
  @ViewChild(NgxImageCropper) private cropper!: NgxImageCropper;

  @Input() imageChangedEvent: any;
  @Input() imageFile: File | undefined;
  @Input() aspectRatio = 1;
  @Input() cropTitle = 'Crop Profile Picture';

  canvasRotation = 0;
  rotation = 0;
  scale = 1;
  showCropper = false;
  containWithinAspectRatio = false;
  transform: any = {};
  cropReady = false;

  constructor(private modalController: ModalController) {}

  ngOnInit() {}

  fileChangeEvent(event: any): void {
    this.imageChangedEvent = event;
  }

  imageCropped(_event: ImageCroppedEvent) {
    this.cropReady = true;
  }

  imageLoaded(_image: LoadedImage) {
    this.showCropper = true;
  }

  cropperReady() {}

  loadImageFailed() {}

  rotateLeft() {
    this.canvasRotation--;
    this.flipAfterRotate();
  }

  rotateRight() {
    this.canvasRotation++;
    this.flipAfterRotate();
  }

  private flipAfterRotate() {
    const flippedH = this.transform.flipH;
    const flippedV = this.transform.flipV;
    this.transform = {
      ...this.transform,
      flipH: flippedV,
      flipV: flippedH
    };
  }

  zoomOut() {
    this.scale -= 0.1;
    this.transform = {
      ...this.transform,
      scale: this.scale
    };
  }

  zoomIn() {
    this.scale += 0.1;
    this.transform = {
      ...this.transform,
      scale: this.scale
    };
  }

  resetImage() {
    this.scale = 1;
    this.rotation = 0;
    this.canvasRotation = 0;
    this.transform = {};
  }

  async cancel() {
    await this.modalController.dismiss(null, 'cancel');
  }

  async crop() {
    if (!this.cropper) return;
    try {
      const result = await this.cropper.crop('blob');
      if (result?.blob) {
        await this.modalController.dismiss(result.blob, 'crop');
      }
    } catch {
      await this.modalController.dismiss(null, 'cancel');
    }
  }
}
