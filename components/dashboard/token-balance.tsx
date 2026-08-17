'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { motion, useReducedMotion } from 'framer-motion';
import { TOKENS_PER_SITE } from '@/lib/constants';
import { cn } from '@/lib/utils';

const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');

/** Interpola o número exibido em vez de trocá-lo de uma vez (mesmo padrão do token-slider). */
function useTweenedNumber(value: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const proxy = useRef({ v: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = fmtInt(value);
      proxy.current.v = value;
      return;
    }

    const tween = gsap.to(proxy.current, {
      v: value,
      duration: 0.9,
      ease: 'power3.out',
      onUpdate: () => {
        el.textContent = fmtInt(proxy.current.v);
      },
    });

    return () => {
      tween.kill();
    };
  }, [value]);

  return ref;
}

type Props = {
  balance: number;
  /** Tokens que já entraram na conta (compras, bônus e estornos). */
  credited?: number;
  /** Tokens já consumidos. */
  spent?: number;
  /** Saldo após cada movimentação, do mais antigo para o mais recente. Desenha a sparkline. */
  history?: number[];
  /** Rota de recarga. */
  buyHref?: string;
  /** Rota do extrato. Omita na própria página de extrato. */
  statementHref?: string;
  className?: string;
};

const SPARK_W = 100;
const SPARK_H = 32;

/**
 * Cartão-herói do painel: saldo, quantos sites ele ainda paga e a trajetória
 * recente do saldo. O número é o único dado que o usuário procura primeiro.
 */
export function TokenBalance({
  balance,
  credited,
  spent,
  history,
  buyHref = '/dashboard/billing',
  statementHref,
  className,
}: Props) {
  const reduced = useReducedMotion();
  const balanceRef = useTweenedNumber(balance);
  const rawId = useId();
  // `useId` devolve ':r0:' e dois-pontos quebram a referência url(#id) no SVG.
  const gradientId = `spark-${rawId.replace(/:/g, '')}`;

  const sitesDisponiveis = Math.floor(balance / TOKENS_PER_SITE);
  const sobra = balance % TOKENS_PER_SITE;
  const faltamParaProximo = balance <= 0 ? TOKENS_PER_SITE : TOKENS_PER_SITE - sobra;
  const progresso = (sobra / TOKENS_PER_SITE) * 100;
  const saldoBaixo = balance < TOKENS_PER_SITE;

  const spark = useMemo(() => {
    const pontos = history ?? [];
    if (pontos.length < 2) return null;

    const max = Math.max(...pontos);
    const min = Math.min(...pontos);
    const span = max - min || 1;
    const stepX = SPARK_W / (pontos.length - 1);

    const coords = pontos.map((valor, i) => ({
      x: i * stepX,
      y: SPARK_H - 3 - ((valor - min) / span) * (SPARK_H - 8),
    }));

    const linha = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
      .join(' ');

    return {
      linha,
      area: `${linha} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`,
      ultimo: coords[coords.length - 1],
    };
  }, [history]);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-dark-700 bg-white/[0.02] p-7 shadow-luxury sm:p-8',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-amber-500/10 blur-[90px]"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">Saldo</p>

          <p className="mt-3 flex items-baseline gap-2">
            <span
              ref={balanceRef}
              className="text-gradient text-5xl font-semibold tabular-nums sm:text-6xl"
            >
              {fmtInt(balance)}
            </span>
            <span className="text-sm text-dark-400">tokens</span>
          </p>

          <p className="mt-2 text-sm text-dark-300 tabular-nums">
            {sitesDisponiveis > 0
              ? `${fmtInt(sitesDisponiveis)} ${sitesDisponiveis === 1 ? 'site disponível' : 'sites disponíveis'}`
              : 'Nenhum site disponível'}{' '}
            <span className="text-dark-500">· {TOKENS_PER_SITE} tokens por site</span>
          </p>
        </div>

        {spark && (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Trajetória do saldo nas últimas ${history?.length ?? 0} movimentações`}
            className="h-16 w-full max-w-[220px] shrink-0"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(245,158,11,0.28)" />
                <stop offset="100%" stopColor="rgba(245,158,11,0)" />
              </linearGradient>
            </defs>

            <motion.path
              d={spark.area}
              fill={`url(#${gradientId})`}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.35 }}
            />
            <motion.path
              d={spark.linha}
              fill="none"
              stroke="#F59E0B"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            />
            <circle
              cx={spark.ultimo.x}
              cy={spark.ultimo.y}
              r="2"
              fill="#FBBF24"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      {/* Progresso até o próximo site pago — traduz o saldo em algo acionável. */}
      <div className="relative mt-8">
        <div className="flex items-center justify-between text-xs text-dark-500">
          <span>Próximo site</span>
          <span className="tabular-nums">
            {saldoBaixo
              ? `faltam ${fmtInt(faltamParaProximo)} tokens`
              : `+${fmtInt(faltamParaProximo)} tokens para o site ${fmtInt(sitesDisponiveis + 1)}`}
          </span>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dark-700">
          <motion.div
            className="h-full rounded-full bg-gradient-amber"
            initial={reduced ? false : { width: '0%' }}
            animate={{ width: `${Math.max(progresso, balance > 0 ? 4 : 0)}%` }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
        </div>
      </div>

      {(credited !== undefined || spent !== undefined) && (
        <div className="relative mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/5 pt-6 text-sm">
          {credited !== undefined && (
            <div>
              <p className="text-xs uppercase tracking-widest text-dark-500">Creditados</p>
              <p className="mt-1 font-medium text-emerald-400 tabular-nums">
                +{fmtInt(credited)}
              </p>
            </div>
          )}
          {spent !== undefined && (
            <div>
              <p className="text-xs uppercase tracking-widest text-dark-500">Consumidos</p>
              <p className="mt-1 font-medium text-dark-200 tabular-nums">−{fmtInt(spent)}</p>
            </div>
          )}
        </div>
      )}

      <div className="relative mt-7 flex flex-wrap items-center gap-3">
        <Link href={buyHref} className={saldoBaixo ? 'btn-primary' : 'btn-secondary'}>
          Comprar tokens
        </Link>

        {statementHref && (
          <Link
            href={statementHref}
            className="text-sm text-dark-400 transition-colors hover:text-white"
          >
            Ver extrato →
          </Link>
        )}

        {saldoBaixo && (
          <span className="badge badge-warning ml-auto text-xs">
            {balance <= 0 ? 'Sem tokens' : 'Saldo baixo'}
          </span>
        )}
      </div>
    </section>
  );
}
