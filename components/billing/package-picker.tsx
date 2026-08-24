'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  TOKEN_MAX_PURCHASE,
  TOKEN_MIN_PURCHASE,
  TOKEN_DISCOUNT_THRESHOLD,
  betterDeal,
  TOKEN_PRESETS,
  parseTokenQuantity,
  tokenOrder,
} from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { createPayment } from '@/app/actions/payment';
import { Reveal } from '@/components/ui/reveal';

/** Quantidade inicial: um token, que é um site — a compra mais comum. */
const DEFAULT_QUANTITY = TOKEN_PRESETS[0];

const plural = (n: number, singular: string, plural_: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural_}`;

type Props = {
  /** Falso quando o usuário ainda não tem asaasCustomerId — createPayment recusaria. */
  billingEnabled: boolean;
};

export function PackagePicker({ billingEnabled }: Props) {
  const router = useRouter();

  const [quantity, setQuantity] = useState<number>(DEFAULT_QUANTITY);
  /** Texto cru do campo personalizado: guardar número impediria apagar o campo. */
  const [customText, setCustomText] = useState('');
  const [usingCustom, setUsingCustom] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const customQuantity = useMemo(
    () => (customText.trim() === '' ? null : parseTokenQuantity(customText)),
    [customText],
  );

  // O preço mostrado usa a MESMA função do servidor, então não há como a tela
  // exibir um valor e a cobrança sair outro.
  const chosen = tokenOrder(quantity);
  const customInvalid = customText.trim() !== '' && customQuantity === null;

  /*
   * O degrau de desconto cria uma faixa em que levar MENOS custa MAIS: 9 tokens
   * saem por R$ 225 e 10 por R$ 200. Esconder isso faria o cliente descobrir
   * depois de pagar.
   */
  const melhorOferta = betterDeal(chosen.tokens);
  const canBuy = billingEnabled && !pending && (!usingCustom || customQuantity !== null);

  const selectPreset = (value: number) => {
    setUsingCustom(false);
    setCustomText('');
    setQuantity(value);
    setError('');
  };

  const changeCustom = (text: string) => {
    // Só dígitos: o campo é quantidade, e um "1,5" viraria pedido inválido.
    const digits = text.replace(/\D/g, '').slice(0, 3);
    setCustomText(digits);
    setUsingCustom(true);
    setError('');

    const parsed = parseTokenQuantity(digits);
    if (parsed !== null) setQuantity(parsed);
  };

  const handleBuy = () => {
    setError('');

    const finalQuantity = usingCustom ? customQuantity : quantity;

    if (finalQuantity === null) {
      setError(`Informe uma quantidade entre ${TOKEN_MIN_PURCHASE} e ${TOKEN_MAX_PURCHASE}.`);
      return;
    }

    startTransition(async () => {
      const result = await createPayment({ tokens: finalQuantity });

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
        aria-label="Quantidade de tokens"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {TOKEN_PRESETS.map((preset) => {
          const order = tokenOrder(preset);
          const active = !usingCustom && preset === quantity;

          // Sem .card aqui: a classe é declarada depois das utilities em
          // globals.css e sobrescreveria a cor de borda do estado selecionado.
          // Todas as opções travam durante o pending — cada clique geraria uma
          // cobrança PENDING nova no Asaas.
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => selectPreset(preset)}
              className={`pkg-card rounded-xl border bg-white/5 p-6 text-left backdrop-blur-md transition-all duration-300 disabled:opacity-40 ${
                active
                  ? 'border-amber-500/60 shadow-amber-glow'
                  : 'border-dark-700 hover:border-amber-500/30'
              }`}
            >
              <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
                {preset === 1 ? 'Token' : 'Tokens'}
              </p>

              <p className="text-gradient mt-2 text-4xl font-semibold tabular-nums">
                {preset}
              </p>

              <p className="mt-1 text-xs text-dark-400 tabular-nums">
                {plural(order.sites, 'site', 'sites')}
              </p>

              <div className="divider my-4" />

              {/* Altura fixa: sem ela os cards com e sem desconto desalinham. */}
              <div className="flex min-h-[22px] items-center gap-2">
                {order.discount > 0.005 && (
                  <>
                    <span className="badge bg-emerald-500/15 text-xs text-emerald-400">
                      −{Math.round(order.discount * 100)}%
                    </span>
                    <span className="text-xs text-dark-500 line-through tabular-nums">
                      {formatCurrency(order.listPrice)}
                    </span>
                  </>
                )}
              </div>

              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatCurrency(order.price)}
              </p>
              <p className="mt-1 text-xs text-dark-500 tabular-nums">
                {formatCurrency(order.unitPrice)} por token
              </p>
            </button>
          );
        })}
      </div>

      {/* Quantidade personalizada — para 2, 3 ou mais de 15. */}
      <div
        className={`mt-4 rounded-xl border p-6 transition-colors ${
          usingCustom ? 'border-amber-500/60 bg-amber-500/5' : 'border-dark-700 bg-white/5'
        }`}
      >
        <label htmlFor="tokens-personalizado" className="text-sm font-medium text-white">
          Outra quantidade
        </label>
        <p className="mt-1 text-xs text-dark-400">
          Qualquer valor de {TOKEN_MIN_PURCHASE} a {TOKEN_MAX_PURCHASE} tokens.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <input
            id="tokens-personalizado"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={customText}
            onChange={(event) => changeCustom(event.target.value)}
            onFocus={() => setUsingCustom(true)}
            disabled={pending}
            placeholder="Ex.: 3"
            aria-invalid={customInvalid}
            className="max-w-[8rem] tabular-nums"
          />

          <p className="text-sm tabular-nums text-dark-300">
            {customQuantity !== null ? (
              <>
                {plural(customQuantity, 'site', 'sites')} ·{' '}
                <span className="font-medium text-white">
                  {formatCurrency(tokenOrder(customQuantity).price)}
                </span>{' '}
                <span className="text-dark-500">
                  ({formatCurrency(tokenOrder(customQuantity).unitPrice)}/token)
                </span>
              </>
            ) : (
              <span className="text-dark-500">Informe a quantidade</span>
            )}
          </p>
        </div>

        {customInvalid && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            Use um número inteiro entre {TOKEN_MIN_PURCHASE} e {TOKEN_MAX_PURCHASE}.
          </p>
        )}
      </div>

      <div className="card mt-6 flex flex-wrap items-center justify-between gap-6">
        <div className="text-sm">
          <p className="text-dark-300 tabular-nums">
            {plural(chosen.tokens, 'token', 'tokens')} por{' '}
            <span className="font-medium text-white">{formatCurrency(chosen.price)}</span>
          </p>
          <p className="mt-1 text-xs text-dark-500 tabular-nums">
            Publica {plural(chosen.sites, 'site', 'sites')}
          </p>
          {chosen.savings > 0.01 ? (
            <p className="mt-1 text-xs text-emerald-400 tabular-nums">
              Você economiza {formatCurrency(chosen.savings)}
            </p>
          ) : (
            <p className="mt-1 text-xs text-dark-500 tabular-nums">
              A partir de {TOKEN_DISCOUNT_THRESHOLD} tokens o preço cai para{' '}
              {formatCurrency(tokenOrder(TOKEN_DISCOUNT_THRESHOLD).unitPrice)} cada.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-1 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>

        {melhorOferta && (
          <button
            type="button"
            onClick={() => selectPreset(melhorOferta.tokens)}
            disabled={pending}
            className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-left text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-40"
          >
            {melhorOferta.price < chosen.price ? (
              <>
                <strong>{melhorOferta.tokens} tokens custam menos</strong> —{' '}
                {formatCurrency(melhorOferta.price)} em vez de {formatCurrency(chosen.price)}.
                Clique para trocar.
              </>
            ) : (
              <>
                <strong>Leve {melhorOferta.tokens} pelo mesmo preço</strong> —{' '}
                {formatCurrency(melhorOferta.price)}, com{' '}
                {melhorOferta.tokens - chosen.tokens} site
                {melhorOferta.tokens - chosen.tokens === 1 ? '' : 's'} a mais. Clique
                para trocar.
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={handleBuy}
          disabled={!canBuy}
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
