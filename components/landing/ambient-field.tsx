'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Fundo do hero em duas camadas:
 *
 *  1. Nebulosa âmbar gerada por fragment shader com *domain warping* —
 *     fbm alimentando fbm, a técnica do Inigo Quilez. É o que dá o
 *     movimento orgânico de fumaça em vez de um gradiente parado.
 *  2. Campo de partículas por cima, com parallax do ponteiro.
 *
 * Desligado sob prefers-reduced-motion e pausado fora da viewport.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uAspect;
  varying vec2  vUv;

  // ---- ruído de valor + fbm ----
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.4;
    p += uMouse * 0.16;

    float t = uTime * 0.045;

    // Domain warping: o resultado de um fbm desloca o domínio do próximo.
    vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
    vec2 r = vec2(
      fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 0.7),
      fbm(p + 3.4 * q + vec2(8.3, 2.8) - t * 0.6)
    );
    float f = fbm(p + 3.2 * r);

    vec3 amber = vec3(0.961, 0.620, 0.043);
    vec3 gold  = vec3(0.831, 0.686, 0.216);
    vec3 ember = vec3(0.600, 0.230, 0.020);

    // Só as cristas do warp acendem; o resto continua sendo o preto da página.
    float glow  = smoothstep(0.44, 0.92, f);
    float crest = smoothstep(0.74, 1.02, length(r));

    vec3 col = mix(ember, amber, smoothstep(0.55, 1.0, f));
    col = mix(col, gold, crest * 0.4);

    // Vinheta forte: o brilho vive no centro e morre bem antes das bordas.
    float vig = 1.0 - smoothstep(0.08, 0.78, length(vUv - 0.5) * 1.5);

    // Desvanece nas bordas verticais para não criar emenda com a seção seguinte.
    float edge = smoothstep(0.0, 0.30, vUv.y) * (1.0 - smoothstep(0.70, 1.0, vUv.y));

    float intensity = glow * vig * edge * 0.48;

    // Dithering: sem isso o degradê escuro ganha faixas visíveis.
    intensity += (hash(vUv * 900.0 + uTime) - 0.5) * 0.012 * step(0.02, intensity);

    // O alfa É a intensidade: onde a nebulosa apaga, o canvas fica
    // transparente e o fundo da página aparece. Com alfa fixo em 1 o quad
    // pintaria preto opaco sobre a página e criaria emenda entre seções.
    gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
  }
`;

export function AmbientField() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // alpha: o canvas fica transparente e o fundo da página aparece por baixo.
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.autoClear = false;
    el.appendChild(renderer.domElement);

    // ── Camada 1: nebulosa em quad de tela cheia ──
    const bgScene = new THREE.Scene();
    const bgCamera = new THREE.Camera();

    const uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
    };

    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        depthWrite: false,
        transparent: true,
      })
    );
    bgScene.add(quad);

    // ── Camada 2: partículas ──
    const fgScene = new THREE.Scene();
    const fgCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 120);
    fgCamera.position.z = 20;

    const COUNT = 900;
    const positions = new Float32Array(COUNT * 3);
    const drift = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 52;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 26;
      drift[i] = 0.15 + Math.random() * 0.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xf7c469,
      size: 0.075,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    fgScene.add(points);

    // ── Interação ──
    const pointer = new THREE.Vector2();
    const target = new THREE.Vector2();

    const onPointerMove = (e: PointerEvent) => {
      target.set(
        (e.clientX / window.innerWidth - 0.5) * 2,
        (e.clientY / window.innerHeight - 0.5) * 2
      );
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      // updateStyle precisa ficar ligado: sem o CSS, o canvas assume o
      // tamanho em pixels físicos e só um quadrante dele fica visível.
      renderer.setSize(w, h);
      fgCamera.aspect = w / h;
      fgCamera.updateProjectionMatrix();
      uniforms.uAspect.value = w / h;
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(el);

    let frame = 0;
    const clock = new THREE.Clock();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible) return;

      const t = clock.getElapsedTime();
      pointer.lerp(target, 0.045);

      uniforms.uTime.value = t;
      uniforms.uMouse.value.copy(pointer);

      const pos = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < COUNT; i++) {
        const y = pos.getY(i) + drift[i] * 0.012;
        pos.setY(i, y > 15 ? -15 : y);
      }
      pos.needsUpdate = true;

      points.rotation.y = t * 0.018 + pointer.x * 0.14;
      points.rotation.x = pointer.y * 0.09;

      renderer.clear();
      renderer.render(bgScene, bgCamera);
      renderer.render(fgScene, fgCamera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointerMove);
      ro.disconnect();
      io.disconnect();
      quad.geometry.dispose();
      (quad.material as THREE.Material).dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    />
  );
}
