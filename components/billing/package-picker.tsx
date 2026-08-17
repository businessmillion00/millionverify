'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  TOKEN_PACKAGES,
  packageEconomics,
  type TokenPackageKey,
} from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { createPayment } from '@/app/actions/payment';
import { Reveal } from '@/components/ui/reveal';

const KEYS = Object.keys(TOKEN_PACKAGES) as TokenPackageKey[];
const DEFAULT_KEY: TokenPackageKey =
  KEYS.find((key) => packageEconomics(key).popular) ?? KEYS[0];

type Props = {
  /** Falso quando o usuário ainda não tem asaasCustomerId — createPayment recusaria. */
  billingEnabled: boolean;
};

export function PackagePicker({ billingEnabled }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<TokenPackageKey>(DEFAULT_KEY);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const chosen = packageEconomics(selected);

  const handleBuy = () => {
    setError('');

    startTransition(async () => {
      const result = await createPayment({ tokensPackage: selected });

      // success não é literal discriminante na união retornada pela action:
      // o narrowing precisa passar por result.data.
      if (!result.success || !result.data) {
        setError(result.error ?? 'Erro ao processar pagamento');
        return;
      }

      router.push(`/dashboard/billing/${result.data.paymentId}`);
    });
  };

  return (
    <Reveal stagger=".pkg-card" className="mt-8">
      <div
        role="radiogroup"
        aria-label="Pacotes de tokens"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {KEYS.map((key) => {
          const pkg = packageEconomics(key);
          const active = key === selected;

          // Sem .card aqui: a classe é declarada depois das utilities em
          // globals.css e sobrescreveria a cor de borda do estado selecionado.
          // Todos os pacotes travam durante o pending — cada clique geraria uma
          // cobrança PENDING nova no Asaas.
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => setSelected(key)}
              className={`pkg-card rounded-xl border bg-white/5 p-6 text-left backdrop-blur-md transition-all duration-300 disabled:opacity-40 ${
                active
                  ? 'border-amber-500/60 shadow-amber-glow'
                  : 'border-dark-700 hover:border-amber-500/30'
              }`}
            >
              <div className="flex min-h-[26px] items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
                  Tokens
                </p>
                {pkg.popular && (
                  <span className="badge badge-amber text-[10px] uppercase tracking-wider">
                    Mais escolhido
                  </span>
                )}
              </div>

              <p className="text-gradient mt-2 text-4xl font-semibold tabular-nums">
                {pkg.tokens.toLocaleString('pt-BR')}
              </p>

              <p className="mt-1 text-xs text-dark-400 tabular-nums">
                {pkg.sites.toLocaleString('pt-BR')} sites publicados
              </p>

              <div className="divider my-4" />

              <div className="flex min-h-[24px] items-center gap-2">
                {pkg.discount > 0.005 && (
                  <>
                    <span className="badge bg-emerald-500/15 text-xs text-emerald-400">
                      −{Math.round(pkg.discount * 100)}%
                    </span>
                    <span className="text-xs text-dark-500 line-through tabular-nums">
                      {formatCurrency(pkg.listPrice)}
                    </span>
                  </>
                )}
              </div>

              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatCurrency(pkg.price)}
              </p>
              <p className="mt-1 text-xs text-dark-500 tabular-nums">
                {formatCurrency(pkg.unitPrice)} por token
              </p>
            </button>
          );
        })}
      </div>

      <div className="card mt-6 flex flex-wrap items-center justify-between gap-6">
        <div className="text-sm">
          <p className="text-dark-300 tabular-nums">
            {chosen.tokens.toLocaleString('pt-BR')} tokens por{' '}
            <span className="font-medium text-white">
              {formatCurrency(chosen.price)}
            </span>
          </p>
          <p className="mt-1 h-5 text-emerald-400 tabular-nums">
            {chosen.savings > 0.01 &&
              `Você economiza ${formatCurrency(chosen.savings)}`}
          </p>
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>

        <button
          type="button"
          onClick={handleBuy}
          disabled={pending || !billingEnabled}
          className="btn-primary disabled:opacity-40"
        >
          {pending ? 'Gerando...' : 'Gerar PIX'}
        </button>
      </div>

      <p className="mt-4 text-xs text-dark-500">
        Pagamento via PIX. Os tokens entram na conta assim que a cobrança é
        confirmada pelo banco.
      </p>
    </Reveal>
  );
}
