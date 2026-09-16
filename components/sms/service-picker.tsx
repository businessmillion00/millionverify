'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SmsService } from '@prisma/client';
import {
  SMS_SERVICES,
  SMS_SERVICE_ORDER,
  affordable,
  formatSmsTokens,
  smsTokenLabel,
} from '@/lib/sms/catalog';
import type { SmsStock } from '@/lib/sms/stock';
import { requestSmsNumber } from '@/app/actions/sms';
import { Reveal } from '@/components/ui/reveal';
import { ServiceMark } from '@/components/sms/service-mark';

type Props = {
  balanceCents: number;
  /** Estoque por serviço; null quando o provedor não respondeu. */
  stock: SmsStock | null;
  /** Falso sem SMS24H_API_KEY: a compra fica desligada. */
  enabled: boolean;
};

export function ServicePicker({ balanceCents, stock, enabled }: Props) {
  const router = useRouter();
  const [service, setService] = useState<SmsService>(SMS_SERVICE_ORDER[0]);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const info = SMS_SERVICES[service];
  const missingCents = Math.max(0, info.priceCents - balanceCents);
  const quantity = stock?.[service];
  const outOfStock = quantity === 0;
  const canBuy = enabled && !pending && missingCents === 0 && !outOfStock;

  const choose = (next: SmsService) => {
    setService(next);
    setError('');
  };

  const handleBuy = () => {
    setError('');

    startTransition(async () => {
      const result = await requestSmsNumber({ service });

      if (!result.success) {
        setError(result.error);
        // Saldo e estoque vivem no server component: o refresh traz o valor atual.
        if (result.code === 'INSUFFICIENT_BALANCE' || result.code === 'NO_NUMBERS') {
          router.refresh();
        }
        return;
      }

      router.push(`/dashboard/sms/${result.activationId}`);
    });
  };

  return (
    <Reveal stagger=".svc-card" className="mt-8">
      <div
        role="radiogroup"
        aria-label="Serviço que vai receber o SMS"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {SMS_SERVICE_ORDER.map((option) => {
          const meta = SMS_SERVICES[option];
          const active = option === service;
          const available = stock?.[option];
          const count = affordable(balanceCents, option);

          // Sem .card: a classe é declarada depois das utilities em globals.css
          // e sobrescreveria a borda do estado selecionado. Tudo trava no
          // pending — cada clique reserva saldo e prende um número.
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => choose(option)}
              className={`svc-card rounded-xl border bg-white/5 p-5 text-left backdrop-blur-md transition-all duration-300 disabled:opacity-40 ${
                active
                  ? 'border-amber-500/60 shadow-amber-glow'
                  : 'border-dark-700 hover:border-amber-500/30'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <ServiceMark service={option} />
                {available === 0 ? (
                  <span className="badge badge-error text-[10px] uppercase tracking-wider">
                    Sem estoque
                  </span>
                ) : typeof available === 'number' ? (
                  <span className="text-[11px] text-dark-500 tabular-nums">
                    {available.toLocaleString('pt-BR')} disp.
                  </span>
                ) : null}
              </div>

              <p className="mt-4 text-base font-semibold text-white">{meta.label}</p>
              <p className="text-gradient mt-1 text-2xl font-semibold tabular-nums">
                {formatSmsTokens(meta.priceCents)}
              </p>
              <p className="text-xs text-dark-400">tokens SMS</p>
              <p className="mt-2 text-xs leading-relaxed text-dark-500">{meta.hint}</p>

              <p className="mt-3 text-[11px] text-dark-500 tabular-nums">
                {count === 0
                  ? 'Saldo não cobre'
                  : `Seu saldo paga ${count.toLocaleString('pt-BR')}`}
              </p>
            </button>
          );
        })}
      </div>

      <div className="card mt-6 flex flex-wrap items-center justify-between gap-6">
        <div className="text-sm">
          <p className="text-dark-300 tabular-nums">
            Número para <span className="font-medium text-white">{info.label}</span> por{' '}
            <span className="font-medium text-white">{smsTokenLabel(info.priceCents)}</span>
          </p>

          {missingCents > 0 ? (
            <p className="mt-1 text-xs text-amber-400 tabular-nums">
              Faltam {smsTokenLabel(missingCents)}.{' '}
              <Link href="#converter" className="underline underline-offset-2 hover:text-amber-300">
                Converter tokens de site
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-xs text-dark-500 tabular-nums">
              Depois da compra: {smsTokenLabel(balanceCents - info.priceCents)}
            </p>
          )}

          <p className="mt-1 text-xs text-dark-500">
            Se o SMS não chegar em 20 minutos, os tokens voltam para o saldo.
          </p>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleBuy}
          disabled={!canBuy}
          className="btn-primary disabled:opacity-40"
        >
          {pending ? 'Pedindo número...' : outOfStock ? 'Sem estoque agora' : 'Pedir número'}
        </button>
      </div>
    </Reveal>
  );
}
