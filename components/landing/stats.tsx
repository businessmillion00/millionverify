'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const STATS = [
  { value: 8, suffix: 's', label: 'Do CNPJ ao site no ar' },
  { value: 100, suffix: '%', label: 'Meta tag server-side' },
  { value: 24, suffix: '/7', label: 'Monitoramento da tag' },
  { value: 5, suffix: 'x', label: 'Sites por conta' },
];

export function Stats() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
        const end = Number(el.dataset.count);

        if (reduce) {
          el.textContent = String(end);
          return;
        }

        const counter = { v: 0 };
        gsap.to(counter, {
          v: end,
          duration: 1.6,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          onUpdate: () => {
            el.textContent = String(Math.round(counter.v));
          },
        });
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="border-y border-dark-800 bg-white/[0.015]">
      <div className="container-safe grid gap-10 py-20 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label}>
            <p className="text-gradient text-5xl font-semibold tabular-nums">
              <span data-count={s.value}>0</span>
              {s.suffix}
            </p>
            <p className="mt-3 text-sm text-dark-400">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
