'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { motion, useReducedMotion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';

/** Ponto já agregado por dia — serializável, montado no Server Component. */
export type PontoFaturamento = {
  /** ISO curto, `yyyy-MM-dd`. */
  dia: string;
  valor: number;
  tokens: number;
};

type Metrica = 'valor' | 'tokens';

const VIEW_W = 760;
const VIEW_H = 280;
const PAD = { top: 22, right: 22, bottom: 36, left: 68 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;
const BASE_Y = PAD.top + PLOT_H;
const LINHAS = 4;

const compacto = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Arredonda o topo do eixo para 1 / 2 / 2,5 / 5 × 10ⁿ — evita rótulos quebrados. */
function escalaMaxima(maximo: number): number {
  if (maximo <= 0) return 1;
  const expoente = Math.floor(Math.log10(maximo));
  const base = 10 ** expoente;
  const normalizado = maximo / base;
  const passo =
    normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 2.5 ? 2.5 : normalizado <= 5 ? 5 : 10;
  return passo * base;
}

const rotuloDia = (dia: string) => format(parseISO(dia), 'dd/MM');
const rotuloDiaLongo = (dia: string) =>
  format(parseISO(dia), "d 'de' MMMM", { locale: ptBR });

export function RevenueChart({ pontos }: { pontos: PontoFaturamento[] }) {
  const [metrica, setMetrica] = useState<Metrica>('valor');
  const [ativo, setAtivo] = useState<number | null>(null);
  const reduzido = useReducedMotion();

  const moldura = useRef<HTMLDivElement>(null);
  const linhaRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);

  const n = pontos.length;
  const valores = pontos.map((p) => (metrica === 'valor' ? p.valor : p.tokens));
  const total = valores.reduce((soma, v) => soma + v, 0);
  const pico = valores.reduce((maior, v) => (v > maior ? v : maior), 0);
  const vazio = total <= 0;

  const maximo = vazio ? 1 : escalaMaxima(pico);
  const x = (i: number) => PAD.left + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => BASE_Y - (v / maximo) * PLOT_H;

  const dLinha = valores
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  const dArea = n
    ? `${dLinha} L${x(n - 1).toFixed(1)} ${BASE_Y} L${x(0).toFixed(1)} ${BASE_Y} Z`
    : '';

  // Rótulos do eixo X: ~6 marcas, sempre incluindo o último dia.
  const passo = Math.max(1, Math.ceil(n / 6));
  const marcasX: number[] = [];
  for (let i = 0; i < n; i += passo) marcasX.push(i);
  if (n > 0 && marcasX[marcasX.length - 1] !== n - 1) {
    if (n - 1 - marcasX[marcasX.length - 1] < passo / 2) marcasX.pop();
    marcasX.push(n - 1);
  }

  const formatarValor = (v: number) =>
    metrica === 'valor' ? formatCurrency(v) : `${Math.round(v).toLocaleString('pt-BR')} tokens`;

  const resumoAcessivel =
    n === 0
      ? 'Sem dados de faturamento.'
      : `${metrica === 'valor' ? 'Faturamento' : 'Tokens vendidos'} por dia entre ${rotuloDiaLongo(
          pontos[0].dia
        )} e ${rotuloDiaLongo(pontos[n - 1].dia)}. Total de ${formatarValor(total)}.`;

  // Traço da linha desenhado com strokeDashoffset; refeito a cada troca de métrica.
  useEffect(() => {
    const linha = linhaRef.current;
    if (!linha || vazio) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const comprimento = linha.getTotalLength();

    const ctx = gsap.context(() => {
      gsap.fromTo(
        linha,
        { strokeDasharray: comprimento, strokeDashoffset: comprimento },
        { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out' }
      );
      if (areaRef.current) {
        gsap.from(areaRef.current, { opacity: 0, duration: 1, ease: 'power2.out' });
      }
    }, moldura);

    return () => ctx.revert();
  }, [metrica, vazio, pontos]);

  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    if (vazio || n === 0) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    const xSvg = ((e.clientX - caixa.left) / caixa.width) * VIEW_W;
    const indice = Math.round(((xSvg - PAD.left) / PLOT_W) * (n - 1));
    setAtivo(Math.min(n - 1, Math.max(0, indice)));
  };

  const aoTeclar = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (vazio || n === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const direcao = e.key === 'ArrowRight' ? 1 : -1;
      setAtivo((atual) => {
        const partida = atual ?? n - 1;
        return Math.min(n - 1, Math.max(0, partida + direcao));
      });
    } else if (e.key === 'Escape') {
      setAtivo(null);
    }
  };

  const ponto = ativo !== null ? pontos[ativo] : null;
  const valorAtivo = ativo !== null ? valores[ativo] : 0;

  return (
    <section className="rounded-2xl border border-dark-700 bg-white/[0.02] p-6 shadow-luxury sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">
            {metrica === 'valor' ? 'Faturamento' : 'Tokens'}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Últimos {n} dias
          </h2>
          <p className="mt-2 text-sm text-dark-400">
            {metrica === 'valor'
              ? 'Pagamentos confirmados por dia, em reais.'
              : 'Tokens creditados por dia.'}
          </p>
        </div>

        <div
          className="flex items-center gap-1 rounded-full border border-dark-700 bg-dark-950/60 p-1"
          role="group"
          aria-label="Métrica do gráfico"
        >
          {(['valor', 'tokens'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metrica === m}
              onClick={() => {
                setMetrica(m);
                setAtivo(null);
              }}
              className={`relative rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                metrica === m ? 'text-dark-950' : 'text-dark-400 hover:text-white'
              }`}
            >
              {metrica === m && (
                <motion.span
                  layoutId="metrica-faturamento-ativa"
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-gradient-amber"
                  transition={
                    reduzido
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 400, damping: 32 }
                  }
                />
              )}
              <span className="relative">{m === 'valor' ? 'Reais' : 'Tokens'}</span>
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <dt className="text-xs uppercase tracking-widest text-dark-500">Total</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-white">
            {formatarValor(total)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-dark-500">Média diária</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-white">
            {formatarValor(n > 0 ? total / n : 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-dark-500">Melhor dia</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-white">
            {formatarValor(pico)}
          </dd>
        </div>
      </dl>

      <div ref={moldura} className="relative mt-6">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
          role="img"
          aria-label={resumoAcessivel}
          tabIndex={0}
          onPointerMove={aoMover}
          onPointerLeave={() => setAtivo(null)}
          onBlur={() => setAtivo(null)}
          onKeyDown={aoTeclar}
        >
          <defs>
            <linearGradient id="bm-area-faturamento" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* grade + eixo Y */}
          {Array.from({ length: LINHAS + 1 }, (_, k) => {
            const valor = (maximo / LINHAS) * k;
            const yy = y(valor);
            return (
              <g key={k}>
                <line
                  x1={PAD.left}
                  x2={VIEW_W - PAD.right}
                  y1={yy}
                  y2={yy}
                  className="stroke-dark-800"
                  strokeWidth={1}
                  strokeOpacity={k === 0 ? 0.9 : 0.45}
                />
                {/* Sem dados, uma escala numérica seria inventada — só a grade fica. */}
                {!vazio && (
                  <text
                    x={PAD.left - 12}
                    y={yy + 4}
                    textAnchor="end"
                    fontSize={11}
                    className="fill-dark-500 tabular-nums"
                  >
                    {compacto.format(valor)}
                  </text>
                )}
              </g>
            );
          })}

          {/* eixo X */}
          {marcasX.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={VIEW_H - 12}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize={11}
              className="fill-dark-500 tabular-nums"
            >
              {rotuloDia(pontos[i].dia)}
            </text>
          ))}

          {!vazio && (
            <>
              <path ref={areaRef} d={dArea} fill="url(#bm-area-faturamento)" />
              <path
                ref={linhaRef}
                d={dLinha}
                fill="none"
                stroke="#F59E0B"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* crosshair + ponto ativo */}
          {!vazio && ativo !== null && (
            <g pointerEvents="none">
              <line
                x1={x(ativo)}
                x2={x(ativo)}
                y1={PAD.top}
                y2={BASE_Y}
                className="stroke-dark-700"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <circle
                cx={x(ativo)}
                cy={y(valorAtivo)}
                r={9}
                fill="#F59E0B"
                fillOpacity={0.16}
              />
              <circle
                cx={x(ativo)}
                cy={y(valorAtivo)}
                r={4.5}
                fill="#F59E0B"
                stroke="#121212"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {vazio && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
            <p className="rounded-lg border border-dark-700 bg-dark-950/80 px-4 py-3 text-center text-sm text-dark-400 backdrop-blur-sm">
              Nenhum pagamento confirmado nos últimos {n} dias.
            </p>
          </div>
        )}

        {ponto && ativo !== null && !vazio && (
          <div
            className="pointer-events-none absolute z-10 min-w-[9rem] rounded-lg border border-dark-700 bg-dark-950/95 px-3 py-2 shadow-luxury backdrop-blur-sm"
            style={{
              left: `${(x(ativo) / VIEW_W) * 100}%`,
              top: `${(y(valorAtivo) / VIEW_H) * 100}%`,
              // Perto das bordas o balão ancora pelo lado em vez de centralizar,
              // senão ele vaza para fora da moldura do gráfico.
              transform: `translate(${
                (x(ativo) / VIEW_W) * 100 > 80
                  ? 'calc(-100% + 14px)'
                  : (x(ativo) / VIEW_W) * 100 < 20
                    ? '-14px'
                    : '-50%'
              }, calc(-100% - 14px))`,
            }}
          >
            <p className="text-xs text-dark-400">{rotuloDiaLongo(ponto.dia)}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-white">
              {formatCurrency(ponto.valor)}
            </p>
            <p className="text-xs tabular-nums text-amber-400">
              {ponto.tokens.toLocaleString('pt-BR')} tokens
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-dark-500">
        Passe o cursor sobre o gráfico — ou use as setas do teclado — para ver os
        valores de cada dia.
      </p>

      <table className="sr-only">
        <caption>Faturamento e tokens por dia</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Faturamento</th>
            <th scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {pontos.map((p) => (
            <tr key={p.dia}>
              <th scope="row">{rotuloDiaLongo(p.dia)}</th>
              <td>{formatCurrency(p.valor)}</td>
              <td>{p.tokens.toLocaleString('pt-BR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
