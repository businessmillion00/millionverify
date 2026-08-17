'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import type { PaymentStatus } from '@prisma/client';
import { formatCurrency } from '@/lib/utils';

const POLL_INTERVAL_MS = 5_000;
/** Teto do polling: aba esquecida aberta é o vetor de abuso mais provável aqui. */
const MAX_POLL_MS = 10 * 60 * 1000;
const COPY_FEEDBACK_MS = 2_000;

const PAYMENT_STATUSES: readonly string[] = [
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'REFUNDED',
];

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && PAYMENT_STATUSES.includes(value);
}

/** Lê o status da resposta sem confiar no formato — a rota pode devolver erro. */
function extractStatus(body: unknown): PaymentStatus | null {
  if (typeof body !== 'object' || body === null) return null;

  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;

  const status = (data as { status?: unknown }).status;
  return isPaymentStatus(status) ? status : null;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return days > 0
    ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

type Props = {
  paymentId: string;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  amount: number;
  tokens: number;
  description: string;
  initialStatus: PaymentStatus;
  /** Vencimento da cobrança em ISO — a contagem regressiva roda só no cliente. */
  expiresAt: string | null;
  expiresAtLabel: string | null;
};

export function PixCheckout({
  paymentId,
  pixQrCode,
  pixCopyPaste,
  amount,
  tokens,
  description,
  initialStatus,
  expiresAt,
  expiresAtLabel,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>(initialStatus);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [pollExhausted, setPollExhausted] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checking, setChecking] = useState(false);
  /** Reinicia o intervalo de polling sem depender de mudança de status. */
  const [pollCycle, setPollCycle] = useState(0);
  const successRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(
    async (signal?: AbortSignal): Promise<PaymentStatus | null> => {
      const response = await fetch(`/api/payments/${paymentId}/status`, {
        signal,
        cache: 'no-store',
      });

      if (!response.ok) return null;
      return extractStatus(await response.json());
    },
    [paymentId]
  );

  // ── contagem regressiva até o vencimento ────────────────────────────────
  // Calculada só no cliente: renderizar o restante no servidor daria um valor
  // congelado e divergente na hidratação.
  useEffect(() => {
    if (!expiresAt) return;

    const target = new Date(expiresAt).getTime();
    if (Number.isNaN(target)) return;

    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();

    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [expiresAt]);

  // ── polling do status ───────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'PENDING') return;

    const controller = new AbortController();
    const startedAt = Date.now();
    let stopped = false;

    const intervalId = window.setInterval(() => {
      if (stopped) return;

      if (Date.now() - startedAt > MAX_POLL_MS) {
        stopped = true;
        window.clearInterval(intervalId);
        setPollExhausted(true);
        return;
      }

      // Aba em segundo plano não precisa consultar; a próxima volta do
      // intervalo já cobre o instante em que ela volta a ficar visível.
      if (document.visibilityState !== 'visible') return;

      void (async () => {
        try {
          const next = await fetchStatus(controller.signal);
          if (stopped || next === null || next === 'PENDING') return;

          stopped = true;
          window.clearInterval(intervalId);
          setStatus(next);
          // O saldo vive no server component: sem refresh ele fica desatualizado.
          router.refresh();
        } catch {
          // Abort no cleanup ou falha de rede: a próxima volta tenta de novo.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, [status, fetchStatus, router, pollCycle]);

  // ── animação do estado de sucesso ───────────────────────────────────────
  useEffect(() => {
    if (status !== 'CONFIRMED') return;

    const root = successRef.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-success-ring]',
        { scale: 0.5, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(2)' }
      );
      gsap.from('[data-success-item]', {
        y: 18,
        opacity: 0,
        duration: 0.7,
        delay: 0.15,
        stagger: 0.08,
        ease: 'power3.out',
      });
    }, root);

    return () => ctx.revert();
  }, [status]);

  useEffect(() => {
    if (!copied) return;

    const timeoutId = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = async () => {
    if (!pixCopyPaste) return;
    setCopyError('');

    try {
      await navigator.clipboard.writeText(pixCopyPaste);
      setCopied(true);
    } catch {
      // clipboard exige contexto seguro (https ou localhost).
      setCopyError('Não foi possível copiar. Selecione o código abaixo.');
    }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    setCheckError('');

    try {
      const next = await fetchStatus();
      if (next !== null && next !== 'PENDING') {
        setStatus(next);
        router.refresh();
        return;
      }
      // Ainda pendente: a consulta manual reabre a janela de polling automático.
      setPollExhausted(false);
      setPollCycle((cycle) => cycle + 1);
    } catch {
      setCheckError('Não foi possível consultar agora. Tente novamente.');
    } finally {
      setChecking(false);
    }
  };

  if (status === 'CONFIRMED') {
    return (
      <div ref={successRef} className="card mt-8 text-center">
        <div
          data-success-ring
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="h-9 w-9 text-emerald-400"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <p data-success-item className="mt-6 text-xs uppercase tracking-[0.25em] text-dark-500">
          Pagamento confirmado
        </p>

        <p data-success-item className="text-gradient mt-2 text-5xl font-semibold tabular-nums">
          +{tokens.toLocaleString('pt-BR')}
        </p>

        <p data-success-item className="mt-2 text-sm text-dark-400">
          tokens creditados na sua conta
        </p>

        <div data-success-item className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard/sites/new" className="btn-primary">
            Criar site
          </Link>
          <Link href="/dashboard/billing" className="btn-secondary">
            Voltar para compras
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'FAILED' || status === 'REFUNDED') {
    const failed = status === 'FAILED';

    return (
      <div className="card mt-8">
        <span className={failed ? 'badge badge-error' : 'badge badge-info'}>
          {failed ? 'Cobrança cancelada' : 'Cobrança estornada'}
        </span>

        <p className="mt-4 text-sm text-dark-300">
          {failed
            ? 'Esta cobrança venceu ou não pôde ser processada. Nenhum token foi creditado.'
            : 'Esta cobrança foi estornada e os tokens correspondentes foram removidos do saldo.'}
        </p>

        <Link href="/dashboard/billing" className="btn-primary mt-6 inline-block">
          Gerar nova cobrança
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="card flex flex-col items-center justify-center">
        {pixQrCode ? (
          // Base64 puro vindo do Asaas, sem prefixo no banco.
          // next/image com data URI exigiria unoptimized — <img> resolve melhor.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${pixQrCode}`}
            alt="QR Code PIX para pagamento"
            width={240}
            height={240}
            className="h-60 w-60 rounded-lg bg-white p-3"
          />
        ) : (
          <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-dashed border-dark-700 p-6 text-center text-sm text-dark-400">
            O QR Code desta cobrança não está disponível. Gere uma nova compra.
          </div>
        )}

        <p className="mt-4 text-xs text-dark-500">
          Abra o app do banco e aponte a câmera
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
              A pagar
            </p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {formatCurrency(amount)}
            </p>
            <p className="mt-1 text-sm text-dark-400">{description}</p>
          </div>

          <span className="badge badge-warning">Aguardando PIX</span>
        </div>

        <div className="divider my-6" />

        <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
          PIX copia e cola
        </p>

        {pixCopyPaste ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="btn-secondary text-sm"
              >
                {copied ? 'Copiado!' : 'Copiar código'}
              </button>
              {copied && (
                <span className="badge badge-success text-xs">
                  Cole no app do banco
                </span>
              )}
            </div>

            <code className="mt-3 block max-h-28 select-all overflow-y-auto break-all rounded-lg border border-dark-700 bg-dark-800/50 p-3 text-xs text-dark-300">
              {pixCopyPaste}
            </code>
          </>
        ) : (
          <p className="mt-3 text-sm text-dark-400">
            Código indisponível para esta cobrança.
          </p>
        )}

        {copyError && <p className="mt-2 text-xs text-red-400">{copyError}</p>}

        <div className="divider my-6" />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
              Vence em
            </p>
            <p className="mt-1 text-2xl font-medium tabular-nums text-amber-400">
              {remaining === null
                ? '—'
                : remaining === 0
                  ? 'Vencida'
                  : formatRemaining(remaining)}
            </p>
            {expiresAtLabel && (
              <p className="mt-1 text-xs text-dark-500">
                Vencimento da cobrança em {expiresAtLabel}
              </p>
            )}
          </div>

          <div className="text-right">
            {pollExhausted ? (
              <>
                <p className="text-xs text-dark-500">
                  Atualização automática pausada
                </p>
                <button
                  type="button"
                  onClick={handleCheckNow}
                  disabled={checking}
                  className="btn-ghost mt-1 px-3 py-1 text-sm text-amber-400 disabled:opacity-40"
                >
                  {checking ? 'Verificando...' : 'Verificar agora'}
                </button>
                {checkError && (
                  <p className="text-xs text-red-400">{checkError}</p>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-xs text-dark-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Confirmando o pagamento automaticamente
              </p>
            )}
          </div>
        </div>

        <p className="mt-6 text-xs text-dark-500">
          Os {tokens.toLocaleString('pt-BR')} tokens entram no saldo assim que o
          banco confirma o PIX — normalmente em segundos.
        </p>
      </div>
    </div>
  );
}
