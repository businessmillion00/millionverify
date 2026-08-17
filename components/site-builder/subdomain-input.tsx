'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { APP_CONFIG } from '@/lib/constants';
import {
  SUBDOMAIN_MAX_LENGTH,
  normalizeSubdomain,
  sanitizeSubdomainInput,
  validateSubdomain,
} from '@/lib/subdomain';

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onValidityChange: (valid: boolean) => void;
  /** Conflito detectado no envio (alguém reservou entre a checagem e o create). */
  externalError?: string;
};

const CheckResponseSchema = z.object({
  data: z
    .object({
      normalized: z.string(),
      available: z.boolean(),
      reason: z.string().optional(),
      suggestions: z.array(z.string()).optional(),
    })
    .optional(),
  error: z.string().optional(),
});

const BADGE: Record<Exclude<Status, 'idle'>, string> = {
  checking: 'badge badge-warning',
  available: 'badge badge-success',
  taken: 'badge badge-error',
  invalid: 'badge badge-error',
};

export function SubdomainInput({
  value,
  onChange,
  onValidityChange,
  externalError,
}: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // O callback do pai muda de identidade a cada render; guardá-lo em ref evita
  // que o efeito de validade dispare em loop.
  const notifyRef = useRef(onValidityChange);
  useEffect(() => {
    notifyRef.current = onValidityChange;
  });

  useEffect(() => {
    notifyRef.current(status === 'available');
  }, [status]);

  useEffect(() => {
    setSuggestions([]);

    const canonical = normalizeSubdomain(value);

    if (canonical.length === 0) {
      setStatus('idle');
      setMessage('');
      return;
    }

    // "minha-" a caminho de "minha-empresa": ainda não é um endereço final,
    // então não é erro nem vale gastar uma consulta ao servidor.
    if (canonical !== value) {
      setStatus('checking');
      setMessage('Continue digitando…');
      return;
    }

    // As mesmas regras da rota de checagem e de CreateSiteSchema: tamanho,
    // caracteres, hífen nas pontas e nomes reservados pela plataforma.
    const validation = validateSubdomain(canonical);

    if (!validation.valid) {
      setStatus('invalid');
      setMessage(validation.reason);
      return;
    }

    setStatus('checking');
    setMessage('Verificando disponibilidade…');

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/subdomain/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain: canonical }),
          signal: controller.signal,
        });

        const json = CheckResponseSchema.safeParse(await res.json());

        if (!json.success) {
          setStatus('invalid');
          setMessage('Não foi possível verificar o subdomínio agora');
          return;
        }

        // 400/401/429 chegam com { error } em pt-BR — mostre o motivo real.
        if (!res.ok || !json.data.data) {
          setStatus('invalid');
          setMessage(json.data.error ?? 'Não foi possível verificar o subdomínio agora');
          return;
        }

        const result = json.data.data;

        if (result.available) {
          setStatus('available');
          setMessage('Disponível');
          return;
        }

        setStatus('taken');
        setMessage(result.reason ?? 'Este subdomínio já está em uso');
        setSuggestions(result.suggestions ?? []);
      } catch {
        if (controller.signal.aborted) return;
        setStatus('invalid');
        setMessage('Erro de conexão ao verificar o subdomínio');
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  return (
    <div>
      <label htmlFor="subdomain" className="mb-2 block text-sm font-medium">
        Endereço do site
      </label>

      <div className="glass flex items-center gap-2 p-2">
        <input
          id="subdomain"
          value={value}
          onChange={(e) => onChange(sanitizeSubdomainInput(e.target.value))}
          placeholder="minha-empresa"
          autoComplete="off"
          spellCheck={false}
          maxLength={SUBDOMAIN_MAX_LENGTH}
          aria-describedby="subdomain-status"
          className="min-w-0 flex-1 border-none bg-transparent"
        />
        <span className="shrink-0 pr-2 text-sm text-dark-400">
          {APP_CONFIG.SUBDOMAIN_SUFFIX}
        </span>
      </div>

      <div id="subdomain-status" aria-live="polite" className="mt-2 min-h-[1.75rem]">
        {externalError ? (
          <span className="badge badge-error">{externalError}</span>
        ) : (
          status !== 'idle' && <span className={BADGE[status]}>{message}</span>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-dark-500">Sugestões:</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange(suggestion)}
              className="btn-secondary px-3 py-1 text-xs"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
