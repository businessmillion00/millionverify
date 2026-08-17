'use client';

/**
 * Linha copiável — a peça compartilhada de toda a tela de verificação.
 *
 * Regra do produto: o cliente NUNCA deve digitar à mão um dado que a Meta compara
 * caractere a caractere (razão social, CEP, domínio, código da meta tag). Por isso
 * todo valor exibido aqui sai por `navigator.clipboard`, e quando o clipboard não
 * está disponível (contexto inseguro, permissão negada, WebView antiga) o valor é
 * exposto num bloco `select-all` — o plano B nunca some.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

type CopyState = 'idle' | 'ok' | 'erro';

/** Tempo do "Copiado!" na tela. Curto o bastante para não mascarar a próxima cópia. */
const FEEDBACK_MS = 2000;

/** Nada de campo vazio mudo: o traço mostra que o dado falta, não que a linha sumiu. */
const EMPTY_PLACEHOLDER = '—';

const TEXTAREA_MIN_ROWS = 3;
const TEXTAREA_MAX_ROWS = 12;

type CopyFieldProps = {
  /** Rótulo do campo, exatamente como o Business Manager o chama. */
  label: string;
  /** Valor a copiar. String vazia é tratada como "sem dado" e desabilita o botão. */
  value: string;
  /** Texto auxiliar abaixo do campo — onde o dado é usado, ou por que está faltando. */
  hint?: string;
  /** Fonte monoespaçada. Ligada por padrão: é o que evita confundir O/0 e I/l. */
  mono?: boolean;
  /** Renderiza um bloco de várias linhas em vez de um campo de uma linha. */
  multiline?: boolean;
};

export function CopyField({
  label,
  value,
  hint,
  mono = true,
  multiline = false,
}: CopyFieldProps): JSX.Element {
  const fieldId = useId();
  const [state, setState] = useState<CopyState>('idle');
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const isEmpty = value.trim().length === 0;
  const shown = isEmpty ? EMPTY_PLACEHOLDER : value;

  // Timeout pendente com o componente desmontado dispara setState em nada: limpe sempre.
  useEffect(() => () => clearTimeout(timeout.current), []);

  const copiar = useCallback(async () => {
    if (isEmpty) return;

    clearTimeout(timeout.current);

    try {
      // clipboard só existe em contexto seguro (https ou localhost).
      await navigator.clipboard.writeText(value);
      setState('ok');
    } catch {
      setState('erro');
    }

    timeout.current = setTimeout(() => setState('idle'), FEEDBACK_MS);
  }, [isEmpty, value]);

  const rows = multiline
    ? Math.min(TEXTAREA_MAX_ROWS, Math.max(TEXTAREA_MIN_ROWS, shown.split('\n').length))
    : undefined;

  // O estilo global de input/textarea (globals.css) já entrega fundo, borda e foco.
  const controlClass = [
    'w-full text-sm',
    mono ? 'font-mono' : '',
    isEmpty ? 'text-dark-500' : 'text-white',
    multiline ? 'resize-none leading-relaxed' : 'truncate',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-start sm:gap-4">
      <label
        htmlFor={fieldId}
        className="text-xs font-medium uppercase tracking-widest text-dark-500 sm:pt-2.5"
      >
        {label}
      </label>

      <div className="min-w-0">
        <div className="flex items-start gap-2">
          {multiline ? (
            <textarea
              id={fieldId}
              readOnly
              rows={rows}
              value={shown}
              onFocus={(event) => event.currentTarget.select()}
              className={controlClass}
            />
          ) : (
            <input
              id={fieldId}
              type="text"
              readOnly
              value={shown}
              onFocus={(event) => event.currentTarget.select()}
              className={controlClass}
            />
          )}

          <button
            type="button"
            onClick={copiar}
            disabled={isEmpty}
            aria-label={isEmpty ? `${label} sem valor para copiar` : `Copiar ${label}`}
            title={isEmpty ? 'Sem valor para copiar' : 'Copiar'}
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dark-700 text-dark-400 transition-colors hover:border-amber-500/40 hover:bg-white/5 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-dark-700 disabled:hover:bg-transparent disabled:hover:text-dark-400"
          >
            {state === 'ok' ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>

        {/* Região viva SÓ com o retorno da cópia: se a dica entrasse aqui, o leitor de
            tela a repetiria a cada vez que o "Copiado!" expirasse. */}
        <span
          role="status"
          className={`text-xs ${state === 'erro' ? 'text-red-400' : 'text-green-400'}`}
        >
          {state === 'ok'
            ? 'Copiado!'
            : state === 'erro'
              ? 'Não foi possível copiar automaticamente. Selecione o texto abaixo.'
              : ''}
        </span>

        {hint && <p className="mt-1.5 text-xs text-dark-500">{hint}</p>}

        {state === 'erro' && (
          <code className="mt-2 block max-h-40 select-all overflow-auto whitespace-pre-wrap break-all rounded-lg border border-dark-700 bg-dark-800/50 p-3 text-xs text-dark-300">
            {value}
          </code>
        )}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <path d="M9 9.5A2.5 2.5 0 0111.5 7h6A2.5 2.5 0 0120 9.5v6a2.5 2.5 0 01-2.5 2.5h-6A2.5 2.5 0 019 15.5v-6z" />
      <path d="M15 7V6.5A2.5 2.5 0 0012.5 4h-6A2.5 2.5 0 004 6.5v6A2.5 2.5 0 006.5 15H7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4 text-green-400"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
