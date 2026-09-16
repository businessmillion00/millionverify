'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ActivationView } from '@/lib/sms/activation';
import { SMS_MAX_RETRIES, SMS_SERVICES, smsTokenLabel } from '@/lib/sms/catalog';
import {
  cancelSmsActivation,
  completeSmsActivation,
  retrySmsActivation,
} from '@/app/actions/sms';
import { ACTIVATION_STATUS } from '@/components/sms/status';
import { ServiceMark } from '@/components/sms/service-mark';

const POLL_INTERVAL_MS = 5_000;
/** Folga depois do vencimento para o polling colher o estado final (EXPIRED/COMPLETED). */
const POLL_GRACE_MS = 60_000;
const COPY_FEEDBACK_MS = 2_000;

type CopyTarget = 'local' | 'international' | 'code';
type Busy = 'cancel' | 'complete' | 'retry' | null;

function isView(value: unknown): value is ActivationView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; status?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.status === 'string';
}

function formatRemaining(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

type Props = { initial: ActivationView };

/**
 * Tela de uma ativação: número para digitar no app, código quando chega, e as
 * três ações possíveis. O estado é sempre o do servidor — cada ação devolve a
 * visão nova e o polling substitui a atual; nada é deduzido no cliente.
 */
export function ActivationPanel({ initial }: Props) {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  const [view, setView] = useState<ActivationView>(initial);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const statusRef = useRef(view.status);

  const service = SMS_SERVICES[view.service];
  const meta = ACTIVATION_STATUS[view.status];
  const waiting = view.status === 'WAITING_CODE' || view.status === 'REQUESTING';
  const hasCode = view.code !== null;

  const fetchView = useCallback(
    async (signal?: AbortSignal): Promise<ActivationView | null> => {
      const response = await fetch(`/api/sms/activations/${view.id}`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) return null;

      const body = (await response.json()) as { data?: unknown };
      return isView(body.data) ? body.data : null;
    },
    [view.id],
  );

  // ── contagem regressiva ─────────────────────────────────────────────────
  // Só no cliente: renderizar o restante no servidor daria um valor congelado
  // e divergente na hidratação.
  useEffect(() => {
    if (!waiting && view.status !== 'CODE_RECEIVED') {
      setRemaining(null);
      return;
    }

    const target = new Date(view.expiresAt).getTime();
    if (Number.isNaN(target)) return;

    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [view.expiresAt, view.status, waiting]);

  // ── polling enquanto o SMS não chega ────────────────────────────────────
  useEffect(() => {
    statusRef.current = view.status;
    if (!waiting) return;

    const controller = new AbortController();
    const deadline = new Date(view.expiresAt).getTime() + POLL_GRACE_MS;
    let stopped = false;

    const id = window.setInterval(() => {
      if (stopped) return;

      if (Date.now() > deadline) {
        stopped = true;
        window.clearInterval(id);
        return;
      }

      // Aba em segundo plano não consulta; a próxima volta cobre a volta dela.
      if (document.visibilityState !== 'visible') return;

      void (async () => {
        try {
          const next = await fetchView(controller.signal);
          if (stopped || !next) return;

          if (next.status !== statusRef.current) {
            stopped = true;
            window.clearInterval(id);
            setView(next);
            // Saldo (devolução) e listas vivem no server component.
            router.refresh();
            return;
          }

          setView(next);
        } catch {
          // Abort no cleanup ou falha de rede: a próxima volta tenta de novo.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(id);
      controller.abort();
    };
  }, [waiting, view.status, view.expiresAt, fetchView, router]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async (target: CopyTarget, value: string | null) => {
    if (!value) return;
    setCopyError('');

    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
    } catch {
      // clipboard exige contexto seguro (https ou localhost).
      setCopyError('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  const run = async (
    kind: Exclude<Busy, null>,
    action: (input: { activationId: string }) => ReturnType<typeof cancelSmsActivation>,
  ) => {
    setBusy(kind);
    setError('');

    try {
      const result = await action({ activationId: view.id });

      if (result.view) setView(result.view);
      if (!result.success) setError(result.error);

      router.refresh();
    } catch {
      setError('Não foi possível concluir a ação agora. Tente novamente.');
    } finally {
      setBusy(null);
    }
  };

  const refundLine =
    view.refundedCents > 0
      ? `${smsTokenLabel(view.refundedCents)} devolvidos ao seu saldo.`
      : hasCode
        ? 'Código entregue — os tokens não são devolvidos.'
        : null;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── número ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-3">
          <ServiceMark service={view.service} />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-dark-500">Número para</p>
            <p className="text-base font-semibold text-white">{service.label}</p>
          </div>
        </div>

        <div className="divider my-6" />

        {view.phoneDisplay ? (
          <>
            <p className="text-xs uppercase tracking-[0.25em] text-dark-500">Digite no app</p>
            <p className="mt-2 select-all font-mono text-3xl font-semibold tabular-nums text-white sm:text-4xl">
              {view.phoneDisplay}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => copy('local', view.phoneLocal)}
                className="btn-secondary text-sm"
              >
                {copied === 'local' ? 'Copiado!' : 'Copiar número'}
              </button>
              <button
                type="button"
                onClick={() => copy('international', view.phoneInternational)}
                className="btn-ghost text-sm text-dark-300"
              >
                {copied === 'international' ? 'Copiado!' : 'Copiar com +55'}
              </button>
            </div>
            {copyError && <p className="mt-2 text-xs text-red-400">{copyError}</p>}

            <p className="mt-5 text-sm leading-relaxed text-dark-400">
              Selecione <span className="text-white">Brasil (+55)</span> no {service.label},
              informe o número e peça o código por SMS. Ele aparece aqui sozinho — não
              precisa atualizar a página.
            </p>
          </>
        ) : (
          <p className="text-sm text-dark-400">
            {view.status === 'REQUESTING'
              ? 'Pedindo um número ao provedor...'
              : 'Nenhum número foi reservado para esta ativação.'}
          </p>
        )}
      </div>

      {/* ── estado / código ─────────────────────────────────────────────── */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view.status}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
          role={hasCode ? 'status' : undefined}
          className="card"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <span className={meta.badge}>{meta.label}</span>

            {remaining !== null && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.25em] text-dark-500">
                  {hasCode ? 'Número expira em' : 'Prazo do SMS'}
                </p>
                <p className="mt-0.5 text-xl font-medium tabular-nums text-amber-400">
                  {remaining === 0 ? 'Encerrando…' : formatRemaining(remaining)}
                </p>
              </div>
            )}
          </div>

          {hasCode && (
            <>
              <p className="mt-6 text-xs uppercase tracking-[0.25em] text-dark-500">
                Código recebido
              </p>
              <p className="text-gradient mt-2 select-all font-mono text-5xl font-semibold tabular-nums">
                {view.code}
              </p>
              <button
                type="button"
                onClick={() => copy('code', view.code)}
                className="btn-secondary mt-4 text-sm"
              >
                {copied === 'code' ? 'Copiado!' : 'Copiar código'}
              </button>
            </>
          )}

          <p className="mt-5 text-sm leading-relaxed text-dark-300">
            {view.status === 'REQUESTING' &&
              'Estamos reservando um número. Leva só alguns segundos.'}
            {view.status === 'WAITING_CODE' &&
              !hasCode &&
              'Aguardando o SMS chegar no número. Consultamos o provedor a cada poucos segundos.'}
            {view.status === 'WAITING_CODE' &&
              hasCode &&
              'Pedimos outro SMS ao provedor. O novo código substitui o anterior assim que chegar.'}
            {view.status === 'CODE_RECEIVED' &&
              'Use o código no app. Se ele reenviar o SMS, peça outro aqui — no mesmo número, sem custo extra.'}
            {view.status === 'COMPLETED' && 'Ativação concluída. Obrigado!'}
            {view.status === 'CANCELLED' && 'Esta ativação foi cancelada.'}
            {view.status === 'EXPIRED' && 'O prazo terminou sem nenhum SMS chegar.'}
            {view.status === 'FAILED' &&
              (view.failureMessage ?? 'Não foi possível reservar um número.')}
          </p>

          {refundLine && <p className="mt-2 text-xs text-dark-500">{refundLine}</p>}

          {error && (
            <p role="alert" className="mt-3 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {view.status === 'WAITING_CODE' && !hasCode && (
              <button
                type="button"
                onClick={() => run('cancel', cancelSmsActivation)}
                disabled={busy !== null}
                className="btn-ghost text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40"
              >
                {busy === 'cancel'
                  ? 'Cancelando…'
                  : `Cancelar e devolver ${smsTokenLabel(view.priceCents)}`}
              </button>
            )}

            {hasCode && meta.open && (
              <>
                <button
                  type="button"
                  onClick={() => run('complete', completeSmsActivation)}
                  disabled={busy !== null}
                  className="btn-primary disabled:opacity-40"
                >
                  {busy === 'complete' ? 'Concluindo…' : 'Concluir'}
                </button>

                {view.canRetry && (
                  <button
                    type="button"
                    onClick={() => run('retry', retrySmsActivation)}
                    disabled={busy !== null}
                    className="btn-secondary text-sm disabled:opacity-40"
                    title={`${SMS_MAX_RETRIES - view.retryCount} reenvio(s) restante(s)`}
                  >
                    {busy === 'retry' ? 'Pedindo…' : 'Pedir outro SMS'}
                  </button>
                )}
              </>
            )}

            {!meta.open && (
              <Link href="/dashboard/sms" className="btn-primary">
                Pedir outro número
              </Link>
            )}
          </div>

          <p className="mt-6 text-xs text-dark-500 tabular-nums">
            Cobrado {smsTokenLabel(view.priceCents)}
            {view.retryCount > 0 && ` · ${view.retryCount} reenvio(s)`}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
