'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Macbook } from './macbook';
import { SplitChars } from '@/lib/split-text';

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div className="glass w-full p-6 font-mono text-sm leading-relaxed shadow-luxury">
    {children}
  </div>
);

const Row = ({ k, v, ok }: { k: string; v: string; ok?: boolean }) => (
  <div className="flex justify-between gap-4 border-b border-white/5 py-2 last:border-0">
    <span className="text-dark-500">{k}</span>
    <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>{v}</span>
  </div>
);

const STEPS = [
  {
    tag: 'Etapa 01',
    title: 'Lemos o CNPJ na fonte',
    body: 'Consulta direta à Receita Federal. Razão social, situação cadastral e endereço saem prontos para o site.',
    visual: (
      <Panel>
        <p className="mb-3 text-xs uppercase tracking-[0.25em] text-dark-500">
          Receita Federal
        </p>
        <Row k="cnpj" v="33.000.167/0001-01" />
        <Row k="razão social" v="PETROLEO BRASILEIRO S A" />
        <Row k="situação" v="ATIVA" ok />
        <Row k="município" v="RIO DE JANEIRO / RJ" />
      </Panel>
    ),
  },
  {
    tag: 'Etapa 02',
    title: 'Provisionamos o domínio',
    body: 'Um subdomínio dedicado sobe em segundos, com SSL válido e DNS já propagado.',
    visual: (
      <Panel>
        <p className="mb-3 text-xs uppercase tracking-[0.25em] text-dark-500">
          Provisionamento
        </p>
        {[
          'DNS record criado',
          'Certificado SSL emitido',
          'Tenant isolado no banco',
          'Site publicado',
        ].map((l) => (
          <div key={l} className="flex items-center gap-3 py-1.5">
            <span className="text-emerald-400">✓</span>
            <span className="text-dark-300">{l}</span>
          </div>
        ))}
      </Panel>
    ),
  },
  {
    tag: 'Etapa 03',
    title: 'Injetamos a meta tag',
    body: 'A tag de verificação entra no <head> do site institucional, exatamente onde o crawler do Meta procura.',
    visual: (
      <Panel>
        <p className="mb-3 text-xs uppercase tracking-[0.25em] text-dark-500">
          html renderizado no servidor
        </p>
        <pre className="overflow-x-auto text-xs leading-loose text-dark-400">
          <code>
            {'<head>\n  <title>'}
            <span className="text-white">Sua Empresa</span>
            {'</title>\n  '}
            <span className="text-amber-400">
              {'<meta name="facebook-\n    domain-verification"\n    content="a7f2c9e4b1d8" />'}
            </span>
            {'\n</head>'}
          </code>
        </pre>
      </Panel>
    ),
  },
  {
    tag: 'Etapa 04',
    title: 'Monitoramos para sempre',
    body: 'Um job periódico confere se a tag continua viva. Se cair, você sabe antes da sua BM cair junto.',
    visual: (
      <Panel>
        <p className="mb-3 text-xs uppercase tracking-[0.25em] text-dark-500">
          Última verificação
        </p>
        <div className="flex items-center gap-4 py-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-400">
            ✓
          </span>
          <div>
            <p className="text-base text-white">Tag ativa</p>
            <p className="text-xs text-dark-500">conferida há 4 minutos</p>
          </div>
        </div>
        <Row k="uptime da tag" v="100%" ok />
        <Row k="próxima checagem" v="em 1h" />
      </Panel>
    ),
  },
];

export function ScrollJourney() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      // Título de entrada, revelado caractere a caractere.
      gsap.from('[data-intro-char]', {
        yPercent: 115,
        duration: 0.9,
        ease: 'power4.out',
        stagger: { each: 0.018, from: 'start' },
        scrollTrigger: { trigger: '[data-journey]', start: 'top 60%', once: true },
      });

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: '[data-journey]',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.1,
          invalidateOnRefresh: true,
        },
      });

      // ── Aproximação: o notebook se endireita e cresce.
      tl.fromTo(
        '[data-device]',
        { rotateX: 26, rotateZ: -1.2, scale: 0.68, y: 90 },
        { rotateX: 0, rotateZ: 0, scale: 1, y: 0, duration: 0.18, ease: 'power1.inOut' },
        0
      )
        // O reflexo varre a tela conforme a tampa se endireita.
        .fromTo(
          '[data-glare]',
          { xPercent: -18, opacity: 1 },
          { xPercent: 22, opacity: 0.25, duration: 0.26 },
          0
        )
        // O halo por trás do aparelho acende na aproximação.
        .fromTo(
          '[data-device-glow]',
          { opacity: 0, scale: 0.6 },
          { opacity: 1, scale: 1.25, duration: 0.24 },
          0
        )
        .to('[data-intro]', { opacity: 0, yPercent: -60, duration: 0.1 }, 0.09)

        // ── Travessia do vidro.
        .to('[data-device]', { scale: 9.5, duration: 0.24, ease: 'power2.in' }, 0.18)
        .to('[data-chassis]', { opacity: 0, duration: 0.09 }, 0.28)
        .to('[data-device-glow]', { opacity: 0, duration: 0.08 }, 0.3)
        // Clarão curto no instante em que atravessamos o vidro.
        .fromTo(
          '[data-bloom]',
          { opacity: 0, scale: 0.75 },
          { opacity: 0.5, scale: 1.1, duration: 0.03, ease: 'power2.out' },
          0.31
        )
        .to('[data-bloom]', { opacity: 0, duration: 0.05 }, 0.34)
        .to('[data-device]', { opacity: 0, duration: 0.04 }, 0.33)

        // ── Dentro da tela.
        .fromTo(
          '[data-immersive]',
          { opacity: 0, scale: 1.14 },
          { opacity: 1, scale: 1, duration: 0.1, ease: 'power2.out' },
          0.32
        );

      // Cada etapa: título em máscara, corpo e painel em profundidades distintas.
      const slice = 0.56 / STEPS.length;

      STEPS.forEach((_, i) => {
        const at = 0.44 + i * slice;
        const step = `[data-step="${i}"]`;

        tl.fromTo(step, { opacity: 0 }, { opacity: 1, duration: slice * 0.18 }, at)
          .fromTo(
            `${step} [data-char]`,
            { yPercent: 115 },
            { yPercent: 0, duration: slice * 0.3, stagger: { each: 0.004 } },
            at
          )
          .fromTo(
            `${step} [data-body]`,
            { y: 34, opacity: 0 },
            { y: 0, opacity: 1, duration: slice * 0.25 },
            at + slice * 0.08
          )
          // O painel entra mais tarde e vem de mais longe: sensação de profundidade.
          .fromTo(
            `${step} [data-panel]`,
            { y: 70, opacity: 0, rotateY: -9 },
            { y: 0, opacity: 1, rotateY: 0, duration: slice * 0.34 },
            at + slice * 0.12
          );

        if (i < STEPS.length - 1) {
          tl.to(
            step,
            { opacity: 0, yPercent: -12, duration: slice * 0.26 },
            at + slice * 0.68
          );
        }
      });

      tl.fromTo('[data-progress]', { scaleX: 0 }, { scaleX: 1, duration: 0.56 }, 0.44)
        // A tela troca para "verificado" junto da última etapa.
        .to('[data-screen-pending]', { opacity: 0, duration: 0.05 }, 0.88);
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={root}>
      <section data-journey className="relative h-[620vh]">
        <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
          {/* ── Camada 1: o MacBook ── */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ perspective: '1400px' }}
          >
            <div data-intro className="px-6 text-center">
              <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">
                O percurso
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                <SplitChars text="Entre na sua" charAttr="data-intro-char" />{' '}
                <SplitChars
                  text="Business Manager"
                  charAttr="data-intro-char"
                  charClassName="text-gradient"
                />
              </h2>
              <p className="mt-3 text-sm text-dark-400">Role para atravessar a tela</p>
            </div>

            {/* halo que acende por trás do aparelho */}
            <div
              data-device-glow
              aria-hidden
              className="pointer-events-none absolute h-[420px] w-[820px] rounded-full bg-amber-500/20 opacity-0 blur-[120px]"
            />

            <div
              data-device
              className="relative mt-10 w-[min(80vw,900px)]"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <Macbook />
            </div>
          </div>

          {/* clarão da travessia do vidro */}
          <div
            data-bloom
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 opacity-0"
            style={{
              background:
                'radial-gradient(60% 55% at 50% 50%,rgba(255,244,214,0.95) 0%,rgba(245,158,11,0.35) 38%,transparent 72%)',
            }}
          />

          {/* ── Camada 2: dentro da tela ── */}
          <div
            data-immersive
            className="pointer-events-none absolute inset-0 flex items-center opacity-0"
          >
            <div className="container-safe w-full">
              <div className="relative h-[420px] w-full">
                {STEPS.map((step, i) => (
                  <article
                    key={step.tag}
                    data-step={i}
                    className="absolute inset-x-0 top-0 grid items-center gap-12 opacity-0 lg:grid-cols-2"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-amber-500">
                        {step.tag}
                      </p>
                      <h3 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                        <SplitChars text={step.title} />
                      </h3>
                      <p
                        data-body
                        className="mt-5 max-w-lg text-lg text-dark-300"
                      >
                        {step.body}
                      </p>
                    </div>

                    <div
                      data-panel
                      className="hidden lg:block"
                      style={{ perspective: '900px' }}
                    >
                      {step.visual}
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-8 h-px w-full bg-white/10">
                <div
                  data-progress
                  className="h-full origin-left bg-gradient-amber"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
