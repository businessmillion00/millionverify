import { CopyField } from '@/components/verification/copy-field';
import type { DiagnosticOutcome, SiteDiagnostic } from '@/lib/verification/diagnose';

/**
 * Cartão "seu site está no ar": prova que o endereço existe, entrega o host
 * pronto para colar no Business Manager e resume o último diagnóstico gravado.
 *
 * Sem 'use client': é renderizado pela página (server component) e o
 * `SiteDiagnostic` chega já normalizado por `parseDiagnostic`
 * (lib/verification/diagnose.ts, dono do contrato de `Site.lastDiagnostic`) —
 * este arquivo não interpreta Json cru.
 */

type Props = {
  host: string;
  url: string;
  isPublished: boolean;
  viewsCount: number;
  diagnostic: SiteDiagnostic | null;
  /** Data do último diagnóstico já formatada no servidor (evita divergir na hidratação). */
  diagnosticLabel: string | null;
};

/** Quantos problemas cabem no cartão sem virar parede de texto. */
const MAX_PROBLEMS = 3;

const OUTCOME_LABEL: Record<DiagnosticOutcome, string> = {
  ok: 'encontrada',
  ausente: 'não encontrada',
  indeterminado: 'inconclusiva',
};

const OUTCOME_TONE: Record<DiagnosticOutcome, string> = {
  ok: 'text-emerald-400',
  ausente: 'text-red-400',
  indeterminado: 'text-amber-400',
};

const statusTone = (status: number | null): string => {
  if (status === null) return 'text-red-400';
  if (status >= 200 && status < 300) return 'text-emerald-400';
  if (status >= 300 && status < 400) return 'text-amber-400';
  return 'text-red-400';
};

export function SiteLiveCard({
  host,
  url,
  isPublished,
  viewsCount,
  diagnostic,
  diagnosticLabel,
}: Props) {
  const problems = diagnostic ? diagnostic.problems.slice(0, MAX_PROBLEMS) : [];

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {isPublished ? 'Seu site está no ar' : 'Seu site está fora do ar'}
        </h2>

        <span className={isPublished ? 'badge badge-success' : 'badge badge-error'}>
          {isPublished ? 'Publicado' : 'Rascunho'}
        </span>
      </div>

      <p className="mt-2 text-sm text-dark-400">
        {isPublished
          ? 'É este endereço que a Meta abre para procurar o código de verificação.'
          : 'Enquanto estiver assim, o endereço responde 404 e a Meta não encontra o código.'}
      </p>

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 break-all text-sm font-medium text-amber-400 hover:underline"
      >
        {host}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-3.5 w-3.5 shrink-0"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
        </svg>
      </a>

      <div className="mt-4">
        <CopyField
          label="Domínio para o Business Manager"
          value={host}
          hint="Cole exatamente assim: sem https:// e sem barra no final."
        />
      </div>

      <div className="divider my-5" />

      <dl className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-dark-400">Visualizações</dt>
          <dd className="tabular-nums">{viewsCount.toLocaleString('pt-BR')}</dd>
        </div>

        {diagnostic ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-dark-400">Resposta do site</dt>
              <dd className={`tabular-nums ${statusTone(diagnostic.httpStatus)}`}>
                {diagnostic.httpStatus ?? 'sem resposta'}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-dark-400">Latência</dt>
              <dd className="tabular-nums">
                {diagnostic.latencyMs === null ? '—' : `${diagnostic.latencyMs} ms`}
              </dd>
            </div>

            {diagnostic.reachable && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-dark-400">HTTPS</dt>
                <dd className={diagnostic.sslOk ? 'text-emerald-400' : 'text-red-400'}>
                  {diagnostic.sslOk ? 'válido' : 'sem certificado válido'}
                </dd>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <dt className="text-dark-400">Meta tag no HTML</dt>
              <dd className={OUTCOME_TONE[diagnostic.metaTag.outcome]}>
                {OUTCOME_LABEL[diagnostic.metaTag.outcome]}
              </dd>
            </div>

            {diagnostic.txt.applicable && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-dark-400">Registro TXT no DNS</dt>
                <dd className={OUTCOME_TONE[diagnostic.txt.outcome]}>
                  {OUTCOME_LABEL[diagnostic.txt.outcome]}
                </dd>
              </div>
            )}
          </>
        ) : (
          <div className="text-dark-500">
            Nenhum diagnóstico ainda. Use “Diagnosticar agora” para medir o site.
          </div>
        )}
      </dl>

      {problems.length > 0 && (
        <>
          <div className="divider my-5" />

          <p className="text-xs uppercase tracking-widest text-dark-500">
            O que impede a verificação
          </p>

          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-dark-300">
            {problems.map((problem) => (
              <li key={problem} className="flex gap-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                <span>{problem}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {diagnosticLabel && (
        <p className="mt-4 text-xs text-dark-500">Última checagem em {diagnosticLabel}</p>
      )}
    </section>
  );
}
