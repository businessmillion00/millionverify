'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import dynamic from 'next/dynamic';
import { CnpjSimulator } from './cnpj-simulator';

// three.js é pesado e puramente decorativo — fica fora do bundle inicial.
const AmbientField = dynamic(
  () => import('./ambient-field').then((m) => m.AmbientField),
  { ssr: false }
);

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('[data-hero-line]', {
          yPercent: 110,
          duration: 1,
          stagger: 0.12,
        })
        .from('[data-hero-sub]', { y: 24, opacity: 0, duration: 0.8 }, '-=0.5')
        .from('[data-hero-panel]', { y: 40, opacity: 0, duration: 0.9 }, '-=0.6');

      gsap.to('[data-hero-glow]', {
        opacity: 0.55,
        scale: 1.15,
        duration: 4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative overflow-hidden pb-24 pt-44">
      <AmbientField />

      <div
        data-hero-glow
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-amber-500/20 opacity-30 blur-[120px]"
      />

      <div className="container-safe relative">
        <h1 className="text-center text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
          <span className="block overflow-hidden">
            <span data-hero-line className="block">
              Verifique sua BM
            </span>
          </span>
          <span className="block overflow-hidden">
            <span data-hero-line className="text-gradient block">
              em segundos
            </span>
          </span>
        </h1>

        <p
          data-hero-sub
          className="mx-auto mt-6 max-w-xl text-center text-lg text-dark-300"
        >
          Informe o CNPJ e geramos a infraestrutura digital completa — site
          institucional, subdomínio e a meta tag do Facebook já injetada.
        </p>

        <div data-hero-panel className="mt-14">
          <CnpjSimulator />
        </div>
      </div>
    </section>
  );
}
