import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

const VERT_SRC = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_dark;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect;

  float t = u_time * 0.55;

  float n = noise(p * 1.4 + vec2(t * 0.55, t * 0.42));
  float n2 = noise(p * 2.2 - vec2(t * 0.38, t * 0.62));
  float m = n * 0.55 + n2 * 0.45;

  vec2 c1 = vec2(sin(t * 0.95) * 0.55, cos(t * 0.72) * 0.38);
  vec2 c2 = vec2(cos(t * 0.82) * 0.48, sin(t * 0.68) * 0.42);
  vec2 c3 = vec2(sin(t * 0.58 + 1.1) * 0.36, cos(t * 0.88 + 0.7) * 0.48);

  float d1 = 1.0 - length(p - c1) * 0.82;
  float d2 = 1.0 - length(p - c2) * 0.88;
  float d3 = 1.0 - length(p - c3) * 0.72;
  d1 = smoothstep(0.0, 1.0, d1);
  d2 = smoothstep(0.0, 1.0, d2);
  d3 = smoothstep(0.0, 1.0, d3);

  vec3 col1 = vec3(0.42, 0.52, 0.96);
  vec3 col2 = vec3(0.70, 0.38, 0.82);
  vec3 col3 = vec3(0.96, 0.52, 0.36);
  vec3 col4 = vec3(0.32, 0.72, 0.90);

  vec3 color = mix(col1, col2, d1);
  color = mix(color, col3, d2 * 0.62);
  color = mix(color, col4, d3 * 0.48);
  color = mix(color, vec3(0.94, 0.95, 0.99), 0.38 + m * 0.12);

  float vig = 1.0 - length(uv - 0.5) * 0.9;
  vig = smoothstep(0.12, 1.0, vig);
  color *= 0.5 + vig * 0.5;

  vec3 darkMul = vec3(0.22, 0.24, 0.32);
  color = mix(color, color * darkMul + vec3(0.08, 0.09, 0.14), u_dark);

  gl_FragColor = vec4(color, 1.0);
}
`;

@Component({
  selector: 'app-mesh-gradient-background',
  standalone: true,
  imports: [CommonModule],
  template:
    '<canvas #cv class="mesh-gradient-canvas" aria-hidden="true"></canvas>',
  styles: [
    `
      :host {
        display: block;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 0;
        opacity: 0.42;
        mask-image: linear-gradient(
          to bottom,
          black 0%,
          black 55%,
          transparent 100%
        );
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 0%,
          black 55%,
          transparent 100%
        );
      }

      .mesh-gradient-canvas {
        display: block;
        width: 100%;
        height: 100%;
        vertical-align: top;
      }

      @media (max-width: 600px) {
        :host {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host {
          display: none;
        }
      }

      :host-context(html.ion-palette-dark) {
        opacity: 0.3;
      }
    `,
  ],
})
export class MeshGradientBackgroundComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cv', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly hostRef = inject(ElementRef<HTMLElement>);

  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private aPosition = -1;
  private uTime: WebGLUniformLocation | null = null;
  private uResolution: WebGLUniformLocation | null = null;
  private uDark: WebGLUniformLocation | null = null;
  private buffer: WebGLBuffer | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private visHandler = () => {
    if (!document.hidden) {
      cancelAnimationFrame(this.raf);
      this.loop();
    }
  };

  ngAfterViewInit(): void {
    requestAnimationFrame(() => this.initWebGL());
  }

  private initWebGL(): void {
    const canvas = this.canvasRef.nativeElement;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    }) as WebGLRenderingContext | null;

    if (!gl) {
      return;
    }
    this.gl = gl;

    const vs = this.compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }
    this.program = program;

    this.aPosition = gl.getAttribLocation(program, 'a_position');
    this.uTime = gl.getUniformLocation(program, 'u_time');
    this.uResolution = gl.getUniformLocation(program, 'u_resolution');
    this.uDark = gl.getUniformLocation(program, 'u_dark');

    if (this.aPosition < 0) {
      return;
    }

    const buf = gl.createBuffer();
    if (!buf) {
      return;
    }
    this.buffer = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const host = this.hostRef.nativeElement;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);

    document.addEventListener('visibilitychange', this.visHandler);
    this.resize();
    this.loop();
  }

  private darkFactor(): number {
    if (typeof document === 'undefined') {
      return 0;
    }
    const html = document.documentElement;
    if (html.classList.contains('ion-palette-dark')) {
      return 1;
    }
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 0.75;
    }
    return 0;
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener('visibilitychange', this.visHandler);
    this.ro?.disconnect();

    const gl = this.gl;
    if (gl && this.program) {
      gl.deleteProgram(this.program);
    }
    if (gl && this.buffer) {
      gl.deleteBuffer(this.buffer);
    }
    this.gl = null;
    this.program = null;
    this.buffer = null;
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) {
      return null;
    }
    const sh = gl.createShader(type);
    if (!sh) {
      return null;
    }
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  private resize(): void {
    const host = this.hostRef.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    const gl = this.gl;
    if (!host || !canvas || !gl) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.floor(host.clientWidth));
    const ch = Math.max(1, Math.floor(host.clientHeight));
    const w = Math.max(1, Math.floor(cw * dpr));
    const h = Math.max(1, Math.floor(ch * dpr));
    if (canvas.width === w && canvas.height === h) {
      return;
    }
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  private loop = (): void => {
    if (document.hidden) {
      this.raf = 0;
      return;
    }
    const gl = this.gl;
    const program = this.program;
    const host = this.hostRef.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!gl || !program || !canvas || !this.buffer) {
      return;
    }

    if (host.clientWidth < 2 || host.clientHeight < 2) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    this.resize();

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

    const t = performance.now() * 0.001;
    if (this.uTime !== null) {
      gl.uniform1f(this.uTime, t);
    }
    if (this.uResolution !== null) {
      gl.uniform2f(this.uResolution, canvas.width, canvas.height);
    }
    if (this.uDark !== null) {
      gl.uniform1f(this.uDark, this.darkFactor());
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.raf = requestAnimationFrame(this.loop);
  };
}
