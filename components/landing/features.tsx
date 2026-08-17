'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Reveal } from '@/components/ui/reveal';

const FEATURES = [
  {
    title: 'Consulta na fonte',
    body: 'CNPJ validado por dígito verificador e enriquecido direto na Receita Federal via BrasilAPI.',
    glyph: 'M4 7h16M4 12h10M4 17h7',
  },
  {
    title: 'Subdomínio instantâneo',
    body: 'Cada empresa ganha seu próprio host, isolado por tenant, com SSL e DNS já resolvidos.',
    glyph: 'M12 3v18M3 12h18',
  },
  {
    title: 'Meta tag no lugar certo',
    body: 'A tag de verificação entra no <head> renderizado no servidor — o crawler do Meta encontra na primeira passada.',
    glyph: 'M8 6l-5 6 5 6M16 6l5 6-5 6',
  },
  {
    title: 'Monitoramento contínuo',
    body: 'Job periódico confere se a tag continua ativa e sinaliza no painel antes que sua BM caia.',
    glyph: 'M3 12h4l3 8 4-16 3 8h4',
  },
  {
    title: 'PIX que credita sozinho',
    body: 'Webhook do Asaas credita tokens numa transação atômica. Reentrega duplicada não credita duas vezes.',
    glyph: 'M12 3l9 9-9 9-9-9z',
  },
  {
    title: 'Auditoria completa',
    body: 'Toda ação crítica vira registro rastreável: quem fez, o que mudou, quando e de onde.',
    glyph: 'M9 12l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z',
  },
];

export function Features() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      // Halo âmbar que segue o cursor dentro de cada card.
      gsap.utils.toArray<HTMLElement>('[data-feature]').forEach((card) => {
        const halo = card.querySelector('[data-halo]');
        card.addEventListener('pointermove', (e) => {
          const r = card.getBoundingClientRect();
          gsap.to(halo, {
            x: e.clientX - r.left,
            y: e.clientY - r.top,
            opacity: 1,
            duration: 0.5,
          });
        });
        card.addEventListener('pointerleave', () => {
          gsap.to(halo, { opacity: 0, duration: 0.4 });
        });
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="container-safe py-32">
      <Reveal>
        <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">
          Infraestrutura
        </p>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Tudo que a verificação exige,{' '}
          <span className="text-gradient">gerado por você não</span>
        </h2>
      </Reveal>

      <Reveal stagger="[data-feature]" className="mt-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              data-feature
              className="group relative overflow-hidden rounded-xl border border-dark-700 bg-white/[0.02] p-7 transition-colors duration-300 hover:border-amber-500/40"
            >
              <div
                data-halo
                aria-hidden
                className="pointer-events-none absolute h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/10 opacity-0 blur-3xl"
              />

              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="relative h-7 w-7 text-amber-500"
              >
                <path d={f.glyph} />
              </svg>

              <h3 className="relative mt-6 text-lg font-medium">{f.title}</h3>
              <p className="relative mt-3 text-sm leading-relaxed text-dark-400">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
