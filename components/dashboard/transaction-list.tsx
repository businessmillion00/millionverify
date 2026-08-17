'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { PaymentStatus, TokenTransactionType } from '@prisma/client';
import { cn } from '@/lib/utils';

export type TransactionItem = {
  id: string;
  type: TokenTransactionType;
  /** Sempre positivo no banco — o sinal vem do tipo. */
  amount: number;
  description: string;
  balanceAfter: number;
  /** 'aaaa-mm-dd' no fuso de São Paulo: agrupa sem depender do relógio do cliente. */
  dayKey: string;
  /** 'Hoje', 'Ontem' ou a data por extenso — já formatada no servidor. */
  dayLabel: string;
  timeLabel: string;
};

type TypeMeta = {
  label: string;
  /** Débito é o único tipo que sai do saldo. */
  debit: boolean;
  tone: string;
  chip: string;
  glyph: string;
};

const TYPE_META: Record<TokenTransactionType, TypeMeta> = {
  PURCHASE: {
    label: 'Compra',
    debit: false,
    tone: 'text-emerald-400',
    chip: 'bg-emerald-500/12 text-emerald-400 ring-emerald-500/20',
    glyph: 'M12 4.5v10M8 10.5l4 4 4-4M5 19.5h14',
  },
  USAGE: {
    label: 'Uso',
    debit: true,
    tone: 'text-red-400',
    chip: 'bg-red-500/12 text-red-400 ring-red-500/20',
    glyph:
      'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM3.8 9.5h16.4M3.8 14.5h16.4M12 3.5c2.3 2.3 2.3 14.7 0 17M12 3.5c-2.3 2.3-2.3 14.7 0 17',
  },
  BONUS: {
    label: 'Bônus',
    debit: false,
    tone: 'text-amber-400',
    chip: 'bg-amber-500/12 text-amber-400 ring-amber-500/20',
    glyph:
      'M12 4l2.3 4.66 5.15.75-3.72 3.63.88 5.13L12 15.75l-4.61 2.42.88-5.13L4.55 9.4l5.15-.74L12 4z',
  },
  REFUND: {
    label: 'Estorno',
    debit: false,
    tone: 'text-blue-400',
    chip: 'bg-blue-500/12 text-blue-400 ring-blue-500/20',
    glyph: 'M4.5 10.5h11a4.5 4.5 0 010 9H9M4.5 10.5l4-4M4.5 10.5l4 4',
  },
};

export const PAYMENT_STATUS_LABEL: Record<
  PaymentStatus,
  { label: string; className: string }
> = {
  PENDING: { label: 'Aguardando PIX', className: 'badge badge-warning' },
  CONFIRMED: { label: 'Confirmado', className: 'badge badge-success' },
  FAILED: { label: 'Falhou', className: 'badge badge-error' },
  REFUNDED: { label: 'Estornado', className: 'badge badge-info' },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const meta = PAYMENT_STATUS_LABEL[status];
  return <span className={`${meta.className} text-xs`}>{meta.label}</span>;
}

type Props = {
  items: TransactionItem[];
  /** Agrupa por dia com cabeçalhos fixos — usado no extrato completo. */
  grouped?: boolean;
  /** Renderizado quando não há movimentações. */
  empty?: ReactNode;
  className?: string;
};

type Grupo = { dayKey: string; dayLabel: string; itens: TransactionItem[] };

function agrupar(items: TransactionItem[]): Grupo[] {
  const grupos: Grupo[] = [];

  for (const item of items) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dayKey === item.dayKey) {
      ultimo.itens.push(item);
    } else {
      grupos.push({ dayKey: item.dayKey, dayLabel: item.dayLabel, itens: [item] });
    }
  }

  return grupos;
}

function Linha({ item, index, reduced }: { item: TransactionItem; index: number; reduced: boolean }) {
  const meta = TYPE_META[item.type];

  return (
    <motion.li
      // O atraso satura: em listas longas ninguém espera o 40º item entrar.
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index, 12) * 0.035, ease: [0.22, 1, 0.36, 1] }}
      className="group flex items-center gap-4 border-b border-white/5 px-1 py-4 last:border-0"
    >
      <span
        aria-hidden
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset transition-transform duration-300 group-hover:scale-105',
          meta.chip,
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d={meta.glyph} />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{item.description}</p>
        <p className="mt-1 text-xs text-dark-500">
          {meta.label} · {item.timeLabel}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className={cn('text-sm font-semibold tabular-nums', meta.tone)}>
          {meta.debit ? '−' : '+'}
          {item.amount.toLocaleString('pt-BR')}
        </p>
        <p className="mt-1 text-xs text-dark-500 tabular-nums">
          saldo {item.balanceAfter.toLocaleString('pt-BR')}
        </p>
      </div>
    </motion.li>
  );
}

/** Extrato de tokens. O sinal vem do tipo: `amount` é sempre positivo no banco. */
export function TransactionList({ items, grouped = false, empty, className }: Props) {
  const reduced = useReducedMotion() ?? false;

  if (items.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  if (!grouped) {
    return (
      <ul className={cn('rounded-2xl border border-dark-700 bg-white/[0.02] px-5 sm:px-6', className)}>
        {items.map((item, i) => (
          <Linha key={item.id} item={item} index={i} reduced={reduced} />
        ))}
      </ul>
    );
  }

  let deslocamento = 0;

  return (
    <div className={cn('rounded-2xl border border-dark-700 bg-white/[0.02] px-5 py-2 sm:px-6', className)}>
      {agrupar(items).map((grupo) => {
        const base = deslocamento;
        deslocamento += grupo.itens.length;

        return (
          <section key={grupo.dayKey}>
            {/* z-10 fica abaixo do topbar (z-30), que também é sticky. */}
            <h3 className="sticky top-16 z-10 -mx-5 bg-dark-950/85 px-5 py-3 text-xs uppercase tracking-widest text-dark-500 backdrop-blur-md sm:-mx-6 sm:px-6">
              {grupo.dayLabel}
            </h3>

            <ul>
              {grupo.itens.map((item, i) => (
                <Linha key={item.id} item={item} index={base + i} reduced={reduced} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
