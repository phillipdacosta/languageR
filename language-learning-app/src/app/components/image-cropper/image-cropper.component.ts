import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { ImageCroppedEvent, LoadedImage } from 'ngx-image-cropper';

@Component({
  selector: 'app-image-cropper',
  templateUrl: './image-cropper.component.html',
  styleUrls: ['./image-cropper.component.scss'],
  standalone: false
})
export class ImageCropperComponent implements OnInit {
  @Input() imageChangedEvent: any;
  @Input() imageFile: File | undefined;
  @Input() aspectRatio = 1;
  @Input() cropTitle = 'Crop Profile Picture';

  croppedImage: any = '';
  croppedBase64: string | null = null;
  canvasRotation = 0;
  rotation = 0;
  scale = 1;
  showCropper = false;
  containWithinAspectRatio = false;
  transform: any = {};

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    console.log('ImageCropper initialized with event:', this.imageChangedEvent);
  }

  fileChangeEvent(event: any): void {
    this.imageChangedEvent = event;
  }

  imageCropped(event: ImageCroppedEvent) {
    this.croppedBase64 = event.base64 || null;
    if (this.croppedBase64) {
      this.croppedImage = this.base64ToBlob(this.croppedBase64);
    }
  }

  private base64ToBlob(base64: string): Blob {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const byteString = atob(parts[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mime });
  }

  imageLoaded(image: LoadedImage) {
    this.showCropper = true;
    console.log('Image loaded');
  }

  cropperReady() {
    console.log('Cropper ready');
  }

  loadImageFailed() {
    console.log('Load failed');
  }

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
    if (this.croppedImage) {
      await this.modalController.dismiss(this.croppedImage, 'crop');
    }
  }
}

