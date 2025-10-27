import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AgoraService } from '../services/agora.service';

@Component({
  selector: 'app-debug-permissions',
  templateUrl: './debug-permissions.page.html',
  styleUrls: ['./debug-permissions.page.scss'],
  standalone: false,
})
export class DebugPermissionsPage implements OnInit {

  browserSupported = false;
  permissions = { camera: false, microphone: false };
  devices: any = { cameras: [], microphones: [], speakers: [] };
  testResult = '';

  constructor(private agoraService: AgoraService, private router: Router) { }

  async ngOnInit() {
    await this.runDiagnostics();
  }

  async runDiagnostics() {
    console.log('Running browser diagnostics...');
    
    // Check browser support
    this.browserSupported = this.agoraService.isBrowserSupported();
    console.log('Browser supported:', this.browserSupported);
    
    // Check permissions
    this.permissions = await this.agoraService.checkPermissions();
    console.log('Permissions:', this.permissions);
    
    // Get devices
    this.devices = await this.agoraService.getDevices();
    console.log('Devices:', this.devices);
    
    this.testResult = `Browser Support: ${this.browserSupported ? '✅' : '❌'}
Camera Permission: ${this.permissions.camera ? '✅' : '❌'}
Microphone Permission: ${this.permissions.microphone ? '✅' : '❌'}
Cameras Found: ${this.devices.cameras.length}
Microphones Found: ${this.devices.microphones.length}`;
  }

  async testPermissions() {
    try {
      this.testResult = 'Testing permissions...';
      const granted = await this.agoraService.requestPermissions();
      this.testResult = granted ? '✅ Permissions granted!' : '❌ Permissions denied';
      
      // Refresh diagnostics
      await this.runDiagnostics();
    } catch (error) {
      this.testResult = `❌ Error: ${error}`;
    }
  }

  async testAgoraConnection() {
    try {
      this.testResult = 'Testing Agora connection...';
      await this.agoraService.initializeClient();
      this.testResult = '✅ Agora client initialized successfully!';
    } catch (error) {
      this.testResult = `❌ Agora error: ${error}`;
    }
  }

  goBack() {
    this.router.navigate(['/tabs']);
  }
}
