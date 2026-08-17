'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';

/**
 * Tela "Montando." — log do provisionamento em tempo real.
 *
 * O estado vem SEMPRE do servidor (GET /api/sites/{id}/build-status): nada aqui
 * finge progresso. Se o build travar, a tela para de andar — é essa a verdade
 * que o usuário precisa ver.
 *
 * Os tipos são declarados localmente, e não importados de lib/site/provision.ts,
 * porque aquele módulo importa prisma e o razão de tokens: um `import` real
 * arrastaria o cliente Prisma para o bundle do browser.
 */

const POLL_INTERVAL_MS = 1_200;
/** Teto do polling: aba esquecida aberta é o vetor de abuso mais provável aqui. */
const MAX_POLL_MS = 4 * 60 * 1000;
const TICK_MS = 200;

/**
 * Tempo mínimo que cada etapa fica visível antes da próxima ser revelada.
 *
 * O provisionamento roda em poucos milissegundos e o log inteiro passava num
 * piscar, sem dar para ler. Isto atrasa só a EXIBIÇÃO: o build não fica mais
 * lento, a duração impressa em cada linha continua sendo a medida de verdade, e
 * uma falha aparece na hora, sem esperar a fila de revelação.
 */
const MIN_STEP_DWELL_MS = 1_500;

type BuildStatus = 'QUEUED' | 'BUILDING' | 'READY' | 'FAILED';
type StepState = 'pendente' | 'executando' | 'concluida' | 'falhou';

export type BuildStepView = {
  key: string;
  label: string;
  hint: string;
  state: StepState;
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
};

export type BuildView = {
  siteId: string;
  status: BuildStatus;
  steps: BuildStepView[];
  currentStep: number | null;
  completedSteps: number;
  totalSteps: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  refundedTokens: number;
  host: string;
  url: string;
};

/* ============ PARSER DEFENSIVO DA RESPOSTA ============ */

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

const asDuration = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;

const asStatus = (value: unknown): BuildStatus | null =>
  value === 'QUEUED' || value === 'BUILDING' || value === 'READY' || value === 'FAILED'
    ? value
    : null;

const asState = (value: unknown): StepState =>
  value === 'executando' || value === 'concluida' || value === 'falhou' ? value : 'pendente';

function parseStep(value: unknown): BuildStepView | null {
  const raw = asRecord(value);
  const key = asText(raw.key);
  const label = asText(raw.label);

  if (key === null || label === null) return null;

  return {
    key,
    label,
    hint: asText(raw.hint) ?? '',
    state: asState(raw.state),
    detail: asText(raw.detail),
    startedAt: asText(raw.startedAt),
    finishedAt: asText(raw.finishedAt),
    durationMs: asDuration(raw.durationMs),
    error: asText(raw.error),
  };
}

/** Lê a resposta sem confiar no formato — a rota pode devolver erro ou 429. */
function parseView(body: unknown): BuildView | null {
  const envelope = asRecord(body);
  if (envelope.success !== true) return null;

  const data = asRecord(envelope.data);
  const status = asStatus(data.status);
  if (status === null) return null;

  const steps = Array.isArray(data.steps)
    ? data.steps.map(parseStep).filter((step): step is BuildStepView => step !== null)
    : [];

  if (steps.length === 0) return null;

  const current = data.currentStep;

  return {
    siteId: asText(data.siteId) ?? '',
    status,
    steps,
    currentStep:
      typeof current === 'number' && Number.isInteger(current) && current >= 0 ? current : null,
    completedSteps: asCount(data.completedSteps),
    totalSteps: asCount(data.totalSteps) || steps.length,
    startedAt: asText(data.startedAt),
    completedAt: asText(data.completedAt),
    error: asText(data.error),
    refundedTokens: asCount(data.refundedTokens),
    host: asText(data.host) ?? '',
    url: asText(data.url) ?? '',
  };
}

/* ============ APRESENTAÇÃO ============ */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

type Props = {
  siteId: string;
  siteName: string;
  /** Destino quando o build termina — a tela de verificação da Meta. */
  readyHref: string;
  tokensPerSite: number;
  initial: BuildView;
  /**
   * `true` quando o site ainda não foi montado: a tela dispara o POST que
   * assume o provisionamento. A rota é idempotente, então duas abas abertas
   * não montam o site duas vezes.
   */
  autoStart: boolean;
};

export function BuildProgress({
  siteId,
  siteName,
  readyHref,
  tokensPerSite,
  initial,
  autoStart,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<BuildView>(initial);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  /** Reinicia o intervalo de polling sem depender de mudança de status. */
  const [pollCycle, setPollCycle] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  const kickedRef = useRef(false);
  const navigatedRef = useRef(false);
  /**
   * Âncora local do início de cada etapa. O relógio do servidor pode estar
   * adiantado ou atrasado em relação ao do browser; medir o tempo decorrido
   * contra `startedAt` mostraria valores negativos ou saltos.
   */
  const anchorsRef = useRef<Map<string, number>>(new Map());
  const root = useRef<HTMLDivElement>(null);

  const running = view.status === 'QUEUED' || view.status === 'BUILDING';
  const failed = view.status === 'FAILED';

  /*
   * Quantas etapas já foram reveladas na tela. Anda uma por vez, no ritmo de
   * MIN_STEP_DWELL_MS, atrás do que o servidor já concluiu — nunca à frente.
   */
  const [revealed, setRevealed] = useState(() =>
    // Build já encerrado quando a tela abriu (revisita, F5): mostra tudo de uma
    // vez. O ritmo existe para acompanhar a montagem, não para atrasar quem
    // chega depois dela.
    initial.status === 'READY' || initial.status === 'FAILED' ? initial.steps.length : 0,
  );

  const settled = useMemo(
    () => view.steps.filter((step) => step.state === 'concluida' || step.state === 'falhou').length,
    [view.steps],
  );

  useEffect(() => {
    // Falha não espera a fila: o usuário precisa ver o erro imediatamente.
    if (failed) {
      setRevealed(view.steps.length);
      return;
    }

    if (revealed >= settled) return;

    const timeoutId = window.setTimeout(
      () => setRevealed((count) => Math.min(count + 1, settled)),
      MIN_STEP_DWELL_MS,
    );

    return () => window.clearTimeout(timeoutId);
  }, [failed, revealed, settled, view.steps.length]);

  /*
   * O que vai para a tela: etapa já revelada mostra o estado real; a próxima
   * aparece como "executando" mesmo que o servidor já a tenha concluído; as
   * demais seguem pendentes.
   */
  const displaySteps = useMemo(() => {
    if (failed) return view.steps;

    return view.steps.map((step, index) => {
      if (index < revealed) return step;

      if (index === revealed && step.state !== 'pendente') {
        return { ...step, state: 'executando' as StepState, durationMs: null, finishedAt: null };
      }

      return { ...step, state: 'pendente' as StepState, durationMs: null, detail: null };
    });
  }, [failed, revealed, view.steps]);

  /** A revelação continua depois do servidor terminar, então o relógio segue. */
  const revealing = revealed < view.steps.length;

  const fetchView = useCallback(
    async (signal?: AbortSignal): Promise<BuildView | null> => {
      const response = await fetch(`/api/sites/${siteId}/build-status`, {
        signal,
        cache: 'no-store',
      });

      if (!response.ok) return null;
      return parseView(await response.json());
    },
    [siteId],
  );

  // ── dispara o provisionamento ───────────────────────────────────────────
  useEffect(() => {
    if (!autoStart || kickedRef.current) return;
    kickedRef.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/sites/${siteId}/build-status`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
        });

        const parsed = parseView(await response.json().catch(() => null));

        if (parsed) {
          setView(parsed);
          return;
        }

        if (!response.ok) {
          setNotice(
            'Não foi possível iniciar a montagem agora. Use "Verificar agora" para tentar de novo.',
          );
        }
      } catch {
        // Rede caiu no meio do disparo: o polling continua e o job pode já ter
        // começado do lado do servidor.
      }
    })();
  }, [autoStart, siteId]);

  // ── polling do estado ───────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;

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
          const next = await fetchView(controller.signal);
          if (stopped || next === null) return;

          setView(next);
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
  }, [running, fetchView, pollCycle]);

  // ── relógio local para o tempo da etapa em execução ─────────────────────
  useEffect(() => {
    if (!running && !revealing) return;

    const intervalId = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [running, revealing]);

  // Âncora de cada etapa que entra em execução — na ordem em que aparece.
  useEffect(() => {
    const anchors = anchorsRef.current;

    for (const step of displaySteps) {
      if (step.state === 'executando' && !anchors.has(step.key)) {
        anchors.set(step.key, Date.now());
      }
    }
  }, [displaySteps]);

  // ── conclusão ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (view.status !== 'READY' || navigatedRef.current) return;
    // Só navega depois que a última etapa apareceu; sair antes engoliria o log.
    if (revealing) return;

    navigatedRef.current = true;
    // O saldo e os cartões do painel vivem em server components.
    router.refresh();
    router.push(readyHref);
  }, [view.status, revealing, readyHref, router]);

  // ── animação de entrada ─────────────────────────────────────────────────
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      gsap.from('[data-build-line]', {
        x: -12,
        opacity: 0,
        duration: 0.5,
        stagger: 0.06,
        ease: 'power3.out',
      });
    }, element);

    return () => ctx.revert();
  }, []);

  const handleCheckNow = async () => {
    setChecking(true);
    setNotice('');

    try {
      const next = await fetchView();

      if (next) {
        setView(next);

        if (next.status === 'QUEUED' || next.status === 'BUILDING') {
          setPollExhausted(false);
          setPollCycle((cycle) => cycle + 1);
        }
      } else {
        setNotice('Não foi possível consultar agora. Tente novamente em instantes.');
      }
    } catch {
      setNotice('Não foi possível consultar agora. Tente novamente em instantes.');
    } finally {
      setChecking(false);
    }
  };

  const elapsedOf = useCallback(
    (step: BuildStepView): number | null => {
      if (step.durationMs !== null) return step.durationMs;
      if (step.state !== 'executando') return null;

      const anchor = anchorsRef.current.get(step.key);
      return anchor === undefined ? 0 : Math.max(0, tick - anchor);
    },
    [tick],
  );

  const totalElapsed = useMemo(
    () => displaySteps.reduce((sum, step) => sum + (elapsedOf(step) ?? 0), 0),
    [displaySteps, elapsedOf],
  );

  const done = displaySteps.filter((step) => step.state === 'concluida').length;
  const percent = view.totalSteps > 0 ? Math.round((done / view.totalSteps) * 100) : 0;
  // "Pronto" só depois do log inteiro na tela, senão o selo chega antes das etapas.
  const ready = view.status === 'READY' && !revealing;

  return (
    <div ref={root} className="mt-10">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span
              className={
                failed ? 'badge badge-error' : ready ? 'badge badge-success' : 'badge badge-amber'
              }
            >
              {failed ? 'Falhou' : ready ? 'Pronto' : 'Montando'}
            </span>

            <p className="mt-3 text-sm text-dark-400">
              {failed
                ? 'O provisionamento parou no meio do caminho.'
                : ready
                  ? 'Site publicado. Levando você para a verificação da Meta...'
                  : `Estamos montando ${siteName} e publicando em ${view.host}.`}
            </p>
          </div>

          <p className="shrink-0 text-right">
            <span className="text-3xl font-semibold tabular-nums text-amber-400">{done}</span>
            <span className="text-lg text-dark-500"> / {view.totalSteps}</span>
            <span className="mt-1 block text-xs uppercase tracking-[0.25em] text-dark-500">
              etapas
            </span>
          </p>
        </div>

        <div
          className="mt-6 h-1 w-full overflow-hidden rounded-full bg-dark-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={view.totalSteps}
          aria-valuenow={done}
          aria-label="Progresso do provisionamento"
        >
          <div
            className={`h-full transition-[width] duration-500 ease-out ${
              failed ? 'bg-red-500/70' : 'gradient-amber'
            }`}
            style={{ width: `${failed ? 100 : percent}%` }}
          />
        </div>

        {/* Log estilo terminal: uma linha por etapa, sempre na mesma ordem. */}
        <ol
          aria-live="polite"
          className="mt-6 space-y-2 rounded-xl border border-dark-700 bg-dark-950/60 p-4 font-mono text-xs"
        >
          {displaySteps.map((step, index) => {
            const elapsed = elapsedOf(step);
            const active = step.state === 'executando';

            return (
              <li
                key={step.key}
                data-build-line
                className={`flex items-start gap-3 ${
                  step.state === 'pendente' ? 'text-dark-600' : 'text-dark-300'
                }`}
              >
                <span className="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center">
                  {step.state === 'concluida' ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                      className="h-3.5 w-3.5 text-emerald-400"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : step.state === 'falhou' ? (
                    <span className="text-red-400" aria-hidden>
                      ×
                    </span>
                  ) : active ? (
                    <span
                      aria-hidden
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400"
                    />
                  ) : (
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-dark-700" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={
                      active
                        ? 'text-amber-300'
                        : step.state === 'falhou'
                          ? 'text-red-300'
                          : undefined
                    }
                  >
                    [{index + 1}/{view.totalSteps}] {step.label}
                  </span>

                  {(step.detail ?? step.error ?? (active ? step.hint : null)) && (
                    <span
                      className={`mt-1 block ${
                        step.error ? 'text-red-400/80' : 'text-dark-500'
                      }`}
                    >
                      {step.error ?? step.detail ?? step.hint}
                    </span>
                  )}
                </span>

                <span className="shrink-0 tabular-nums text-dark-500">
                  {elapsed === null ? '—' : formatDuration(elapsed)}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="divider my-6" />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-dark-500">Tempo de montagem</p>
            <p className="mt-1 text-2xl font-medium tabular-nums text-amber-400">
              {formatDuration(totalElapsed)}
            </p>
          </div>

          <div className="text-right">
            {(running || revealing) && !pollExhausted && (
              <p className="flex items-center gap-2 text-xs text-dark-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Acompanhando o progresso automaticamente
              </p>
            )}

            {(pollExhausted || failed) && (
              <>
                <p className="text-xs text-dark-500">
                  {failed ? 'Provisionamento encerrado' : 'Atualização automática pausada'}
                </p>
                <button
                  type="button"
                  onClick={handleCheckNow}
                  disabled={checking}
                  className="btn-ghost mt-1 px-3 py-1 text-sm text-amber-400 disabled:opacity-40"
                >
                  {checking ? 'Verificando...' : 'Verificar agora'}
                </button>
              </>
            )}
          </div>
        </div>

        {notice && <p className="mt-3 text-xs text-red-400">{notice}</p>}

        {(running || revealing) && (
          <p className="mt-6 text-xs text-dark-500">
            Pode fechar essa janela — quando voltar, o site estará pronto.
          </p>
        )}
      </section>

      {failed && (
        <section className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
          <h2 className="text-xl font-semibold text-red-400">O site não pôde ser montado</h2>

          <p className="mt-3 max-w-3xl text-sm text-dark-300">
            {view.error ?? 'O provisionamento foi interrompido antes de terminar.'}
          </p>

          <p className="mt-3 max-w-3xl text-sm text-dark-400">
            {view.refundedTokens > 0
              ? `Os ${view.refundedTokens} tokens da criação já voltaram para o seu saldo — você não paga por um site que não subiu.`
              : `Nenhum token foi mantido por este site. Se os ${tokensPerSite} tokens da criação não aparecerem no seu saldo, fale com o suporte informando o identificador ${siteId}.`}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/dashboard/sites/new" className="btn-primary">
              Criar site novamente
            </Link>
            <Link href="/dashboard/sites" className="btn-secondary">
              Voltar para os sites
            </Link>
          </div>
        </section>
      )}

      {ready && (
        <p className="mt-6 text-sm text-dark-400">
          Se a página não trocar sozinha,{' '}
          <Link href={readyHref} className="text-amber-400 hover:underline">
            abra a verificação da Meta
          </Link>
          .
        </p>
      )}
    </div>
  );
}
