'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TOKEN_BASE_PRICE, tokenLabel } from '@/lib/constants';
import {
  SMS_CONVERT_MAX,
  SMS_CONVERT_MIN,
  SMS_CONVERT_PRESETS,
  SMS_SERVICES,
  SMS_SERVICE_ORDER,
  SMS_TOKENS_PER_SITE_TOKEN,
  conversionCents,
  formatSmsTokens,
  parseConvertQuantity,
  smsTokenLabel,
} from '@/lib/sms/catalog';
import { formatCurrency } from '@/lib/utils';
import { convertTokens } from '@/app/actions/sms';
import { Reveal } from '@/components/ui/reveal';

const DEFAULT_QUANTITY = SMS_CONVERT_PRESETS[0];

type Props = {
  /** Tokens de site disponíveis para converter. */
  tokenBalance: number;
  /** Tokens de SMS atuais, em centavos de token. */
  smsBalanceCents: number;
  /** Falso sem SMS24H_API_KEY: converter viraria saldo impossível de gastar. */
  enabled: boolean;
};

/** "1 WhatsApp · 3 Telegram · 10 Google" — o que a conversão paga. */
function buys(cents: number): string {
  return SMS_SERVICE_ORDER.map((service) => {
    const info = SMS_SERVICES[service];
    return `${Math.floor(cents / info.priceCents).toLocaleString('pt-BR')} ${info.label}`;
  }).join(' · ');
}

/**
 * Troca tokens de site por tokens de SMS. A taxa é constante do servidor; a
 * tela só escolhe QUANTOS tokens de site entram. O resultado da conversão
 * chega pelo retorno da action e o refresh do router atualiza os saldos do
 * server component (inclusive o badge de tokens do topo).
 */
export function TokenConverter({ tokenBalance, smsBalanceCents, enabled }: Props) {
  const router = useRouter();
  const [quantity, setQuantity] = useState<number>(DEFAULT_QUANTITY);
  /** Texto cru do campo: guardar número impediria apagar o campo. */
  const [customText, setCustomText] = useState('');
  const [usingCustom, setUsingCustom] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [pending, startTransition] = useTransition();

  const customQuantity = useMemo(
    () => (customText.trim() === '' ? null : parseConvertQuantity(customText)),
    [customText],
  );
  const customInvalid = customText.trim() !== '' && customQuantity === null;

  const chosen = usingCustom ? customQuantity : quantity;
  const chosenCents = chosen === null ? 0 : conversionCents(chosen);
  const insufficient = chosen !== null && chosen > tokenBalance;
  const canConvert = !pending && chosen !== null && !insufficient;

  const selectPreset = (value: number) => {
    setUsingCustom(false);
    setCustomText('');
    setQuantity(value);
    setError('');
    setDone('');
  };

  const changeCustom = (text: string) => {
    // Só dígitos: o campo é quantidade inteira de tokens de site.
    const digits = text.replace(/\D/g, '').slice(0, 3);
    setCustomText(digits);
    setUsingCustom(true);
    setError('');
    setDone('');

    const parsed = parseConvertQuantity(digits);
    if (parsed !== null) setQuantity(parsed);
  };

  const handleConvert = () => {
    setError('');
    setDone('');

    if (chosen === null) {
      setError(`Informe uma quantidade entre ${SMS_CONVERT_MIN} e ${SMS_CONVERT_MAX}.`);
      return;
    }

    startTransition(async () => {
      const result = await convertTokens({ tokens: chosen });

      if (!result.success) {
        setError(result.error);
        // Saldo desatualizado (outra aba converteu): o refresh traz o real.
        if (result.code === 'INSUFFICIENT_TOKENS') router.refresh();
        return;
      }

      setDone(
        `${smsTokenLabel(result.smsCents)} adicionados. Você agora tem ${smsTokenLabel(result.smsBalanceCents)} e ${tokenLabel(result.tokenBalance)} de site.`,
      );
      router.refresh();
    });
  };

  if (!enabled) {
    return (
      <div className="card mt-8">
        <span className="badge badge-warning">Conversão pausada</span>
        <p className="mt-3 text-sm text-dark-300">
          O provedor de números não está configurado. Como a conversão é definitiva, ela
          fica pausada até os números voltarem — seus tokens de site continuam valendo
          para publicar sites.
        </p>
      </div>
    );
  }

  if (tokenBalance === 0) {
    return (
      <div className="card mt-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="badge badge-warning">Sem tokens de site</span>
          <p className="mt-3 text-sm text-dark-300">
            Tokens de SMS só nascem da conversão de tokens de site: cada token de site (
            {formatCurrency(TOKEN_BASE_PRICE)}) vira {SMS_TOKENS_PER_SITE_TOKEN} tokens de SMS.
            Compre tokens de site para continuar.
          </p>
        </div>

        <Link href="/dashboard/billing" className="btn-primary">
          Comprar tokens
        </Link>
      </div>
    );
  }

  return (
    <Reveal stagger=".conv-card" className="mt-8">
      <div
        role="radiogroup"
        aria-label="Quantidade de tokens de site a converter"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {SMS_CONVERT_PRESETS.map((preset) => {
          const active = !usingCustom && preset === quantity;
          const cents = conversionCents(preset);

          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => selectPreset(preset)}
              className={`conv-card rounded-xl border bg-white/5 p-6 text-left backdrop-blur-md transition-all duration-300 disabled:opacity-40 ${
                active
                  ? 'border-amber-500/60 shadow-amber-glow'
                  : 'border-dark-700 hover:border-amber-500/30'
              }`}
            >
              <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
                {preset === 1 ? 'Token de site' : 'Tokens de site'}
              </p>
              <p className="text-gradient mt-2 text-4xl font-semibold tabular-nums">{preset}</p>

              <div className="divider my-4" />

              <p className="text-2xl font-semibold tabular-nums">
                {formatSmsTokens(cents)}{' '}
                <span className="text-sm font-normal text-dark-400">tokens SMS</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-dark-500 tabular-nums">{buys(cents)}</p>
            </button>
          );
        })}
      </div>

      <div
        className={`mt-4 rounded-xl border p-6 transition-colors ${
          usingCustom ? 'border-amber-500/60 bg-amber-500/5' : 'border-dark-700 bg-white/5'
        }`}
      >
        <label htmlFor="converter-personalizado" className="text-sm font-medium text-white">
          Outra quantidade
        </label>
        <p className="mt-1 text-xs text-dark-400">
          De {SMS_CONVERT_MIN} a {SMS_CONVERT_MAX} tokens de site por conversão.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <input
            id="converter-personalizado"
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
                <span className="font-medium text-white">
                  {smsTokenLabel(conversionCents(customQuantity))}
                </span>{' '}
                <span className="text-dark-500">· {buys(conversionCents(customQuantity))}</span>
              </>
            ) : (
              <span className="text-dark-500">Informe a quantidade</span>
            )}
          </p>
        </div>

        {customInvalid && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            Use um número inteiro entre {SMS_CONVERT_MIN} e {SMS_CONVERT_MAX}.
          </p>
        )}
      </div>

      <div className="card mt-6 flex flex-wrap items-center justify-between gap-6">
        <div className="text-sm">
          <p className="text-dark-300 tabular-nums">
            {chosen === null ? (
              'Escolha quantos tokens de site converter'
            ) : (
              <>
                <span className="font-medium text-white">{tokenLabel(chosen)}</span> de site viram{' '}
                <span className="font-medium text-white">{smsTokenLabel(chosenCents)}</span>
              </>
            )}
          </p>

          {insufficient ? (
            <p className="mt-1 text-xs text-amber-400 tabular-nums">
              Você tem {tokenLabel(tokenBalance)} de site.{' '}
              <Link
                href="/dashboard/billing"
                className="underline underline-offset-2 hover:text-amber-300"
              >
                Comprar mais
              </Link>
            </p>
          ) : chosen !== null ? (
            <p className="mt-1 text-xs text-dark-500 tabular-nums">
              Depois: {tokenLabel(tokenBalance - chosen)} de site ·{' '}
              {smsTokenLabel(smsBalanceCents + chosenCents)}
            </p>
          ) : null}

          <p className="mt-1 text-xs text-dark-500">
            A conversão é definitiva: tokens de SMS não voltam a ser tokens de site.
          </p>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="mt-2 text-xs text-emerald-400">
              {done}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleConvert}
          disabled={!canConvert}
          className="btn-primary disabled:opacity-40"
        >
          {pending ? 'Convertendo...' : 'Converter'}
        </button>
      </div>
    </Reveal>
  );
}
