'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { formatCurrency } from '@/lib/utils';

type Formato = 'currency' | 'integer';

type Props = {
  label: string;
  /** Recebe número (não string) justamente para permitir o count-up. */
  value: number;
  format?: Formato;
  hint?: string;
  /** Atraso de entrada em segundos — escalona a grade de tiles. */
  delay?: number;
};

const formatar = (valor: number, formato: Formato) =>
  formato === 'currency'
    ? formatCurrency(valor)
    : Math.round(valor).toLocaleString('pt-BR');

export function StatTile({
  label,
  value,
  format = 'integer',
  hint,
  delay = 0,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const numero = useRef<HTMLSpanElement>(null);
  // Guarda o último valor exibido para que uma atualização de dados continue
  // a contagem de onde parou em vez de voltar a zero.
  const anterior = useRef(0);

  // Entrada + halo que acompanha o cursor (mesmo gesto dos cards da landing).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const card = root.current;
    const halo = card?.querySelector('[data-halo]');
    if (!card || !halo) return;

    const ctx = gsap.context(() => {
      gsap.from(card, {
        y: 18,
        opacity: 0,
        duration: 0.8,
        delay,
        ease: 'power3.out',
      });
    }, root);

    const mover = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      gsap.to(halo, {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        opacity: 1,
        duration: 0.5,
      });
    };
    const sair = () => {
      gsap.to(halo, { opacity: 0, duration: 0.4 });
    };

    card.addEventListener('pointermove', mover);
    card.addEventListener('pointerleave', sair);

    return () => {
      card.removeEventListener('pointermove', mover);
      card.removeEventListener('pointerleave', sair);
      ctx.revert();
    };
  }, [delay]);

  // Contador.
  useEffect(() => {
    const alvo = numero.current;
    if (!alvo) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      alvo.textContent = formatar(value, format);
      anterior.current = value;
      return;
    }

    const contador = { v: anterior.current };
    const tween = gsap.to(contador, {
      v: value,
      duration: 1.4,
      delay,
      ease: 'power2.out',
      onUpdate: () => {
        anterior.current = contador.v;
        alvo.textContent = formatar(contador.v, format);
      },
    });

    return () => {
      tween.kill();
    };
  }, [value, format, delay]);

  return (
    <div
      ref={root}
      data-stat
      className="group relative overflow-hidden rounded-xl border border-dark-700 bg-white/[0.02] p-6 transition-colors duration-300 hover:border-amber-500/40"
    >
      <div
        data-halo
        aria-hidden
        className="pointer-events-none absolute h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/10 opacity-0 blur-3xl"
      />

      <p className="relative text-xs uppercase tracking-widest text-dark-500">
        {label}
      </p>

      <p className="text-gradient relative mt-3 text-3xl font-semibold tabular-nums">
        <span ref={numero}>{formatar(value, format)}</span>
      </p>

      {hint && <p className="relative mt-1.5 text-xs text-dark-500">{hint}</p>}
    </div>
  );
}
