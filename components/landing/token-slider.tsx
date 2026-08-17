'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { AnimatePresence, motion } from 'framer-motion';
import {
  TOKEN_PACKAGES,
  packageEconomics,
  type TokenPackageKey,
} from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { Reveal } from '@/components/ui/reveal';

const KEYS = Object.keys(TOKEN_PACKAGES) as TokenPackageKey[];
const LAST = KEYS.length - 1;

/** Interpola o número exibido em vez de trocá-lo de uma vez. */
function useTweenedNumber(value: number, format: (n: number) => string) {
  const ref = useRef<HTMLSpanElement>(null);
  const proxy = useRef({ v: value });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = format(value);
      proxy.current.v = value;
      return;
    }

    const tween = gsap.to(proxy.current, {
      v: value,
      duration: 0.55,
      ease: 'power3.out',
      onUpdate: () => {
        el.textContent = format(proxy.current.v);
      },
    });

    return () => {
      tween.kill();
    };
  }, [value, format]);

  return ref;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtBRL = (n: number) => formatCurrency(n);

export function TokenSlider() {
  const [index, setIndex] = useState(2);
  const pkg = packageEconomics(KEYS[index]);

  const tokensRef = useTweenedNumber(pkg.tokens, fmtInt);
  const priceRef = useTweenedNumber(pkg.price, fmtBRL);
  const sitesRef = useTweenedNumber(pkg.sites, fmtInt);

  const progress = (index / LAST) * 100;

  return (
    <section className="container-safe py-32">
      <Reveal>
        <p className="text-center text-xs uppercase tracking-[0.35em] text-amber-500/70">
          Preços
        </p>
        <h2 className="mt-4 text-center text-4xl font-semibold tracking-tight sm:text-5xl">
          Escolha seu <span className="text-gradient">pacote</span>
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-center text-dark-400">
          Cada site publicado consome 10 tokens. Sem mensalidade — os tokens não
          expiram.
        </p>
      </Reveal>

      <Reveal className="mx-auto mt-14 max-w-3xl">
        <div className="relative overflow-hidden rounded-2xl border border-dark-700 bg-white/[0.02] p-8 shadow-luxury sm:p-10">
          {/* halo que acompanha o tamanho do pacote */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[100px] transition-opacity duration-500"
            style={{ opacity: 0.35 + (index / LAST) * 0.65 }}
          />

          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
                  Tokens
                </p>
                <AnimatePresence>
                  {pkg.popular && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                      className="badge badge-amber text-[10px] uppercase tracking-wider"
                    >
                      Mais escolhido
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              <p className="text-gradient mt-1 text-6xl font-semibold tabular-nums">
                <span ref={tokensRef}>{fmtInt(pkg.tokens)}</span>
              </p>
            </div>

            <div className="text-right">
              <div className="flex min-h-[24px] items-center justify-end gap-2">
                <AnimatePresence mode="popLayout">
                  {pkg.discount > 0.005 && (
                    <motion.span
                      key={KEYS[index]}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="badge bg-emerald-500/15 text-xs text-emerald-400"
                    >
                      −{Math.round(pkg.discount * 100)}%
                    </motion.span>
                  )}
                </AnimatePresence>
                {pkg.discount > 0.005 && (
                  <span className="text-sm text-dark-500 line-through tabular-nums">
                    {formatCurrency(pkg.listPrice)}
                  </span>
                )}
              </div>

              <p className="mt-1 text-5xl font-semibold tabular-nums">
                <span ref={priceRef}>{fmtBRL(pkg.price)}</span>
              </p>
              <p className="mt-1 text-xs text-dark-500 tabular-nums">
                {formatCurrency(pkg.unitPrice).replace('R$', 'R$')} por token
              </p>
            </div>
          </div>

          {/* ── slider ── */}
          <div className="relative mt-12 pb-16">
            {/* trilha */}
            <div className="relative h-1.5 rounded-full bg-dark-700">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-amber transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />

              {/* marcadores */}
              {KEYS.map((k, i) => (
                <span
                  key={k}
                  aria-hidden
                  className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-300 ${
                    i <= index ? 'bg-amber-400' : 'bg-dark-600'
                  }`}
                  style={{ left: `${(i / LAST) * 100}%` }}
                />
              ))}

              {/* thumb */}
              <span
                aria-hidden
                className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400 bg-dark-950 shadow-amber-glow transition-[left] duration-500 ease-out"
                style={{ left: `${progress}%` }}
              />
            </div>

            {/* input real, invisível por cima: mantém teclado e leitor de tela */}
            <input
              type="range"
              min={0}
              max={LAST}
              step={1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-label="Tamanho do pacote de tokens"
              aria-valuetext={`${pkg.tokens} tokens por ${formatCurrency(pkg.price)}`}
              className="absolute inset-x-0 top-0 h-6 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent opacity-0"
            />

            {/* rótulos alinhados a cada marcador */}
            {KEYS.map((k, i) => (
              <button
                key={k}
                onClick={() => setIndex(i)}
                style={{ left: `${(i / LAST) * 100}%` }}
                className={`absolute top-7 -translate-x-1/2 whitespace-nowrap text-xs tabular-nums transition-colors duration-300 ${
                  i === index
                    ? 'font-medium text-amber-400'
                    : 'text-dark-500 hover:text-dark-300'
                }`}
              >
                {TOKEN_PACKAGES[k].tokens.toLocaleString('pt-BR')}
              </button>
            ))}
          </div>

          <div className="divider" />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
            <div className="text-sm">
              <p className="text-dark-300 tabular-nums">
                <span ref={sitesRef}>{fmtInt(pkg.sites)}</span> sites publicados
              </p>
              <p className="mt-1 h-5 text-emerald-400 tabular-nums">
                {pkg.savings > 0.01 &&
                  `Você economiza ${formatCurrency(pkg.savings)}`}
              </p>
            </div>

            <Link href="/register" className="btn-primary">
              Comprar com PIX
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-dark-500">
          Pagamento via PIX. Os tokens entram na conta assim que a cobrança é
          confirmada.
        </p>
      </Reveal>
    </section>
  );
}
