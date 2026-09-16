'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { z } from 'zod';
import { CheckCNPJSchema } from '@/lib/validators/cnpj';
import { formatCNPJ } from '@/lib/utils';
import { normalizeSubdomain } from '@/lib/subdomain';
import type { WizardCnpjInfo, WizardData } from './wizard';

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
};

const nullableText = z
  .string()
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/**
 * Lê a resposta de POST /api/cnpj sem `any` e sem exigir o CNPJInfo inteiro:
 * campos que o assistente não mostra são descartados em silêncio pelo Zod.
 */
const CnpjResponseSchema = z.object({
  data: z
    .object({
      cnpj: z.string(),
      name: z.string(),
      tradeName: nullableText,
      status: z.string(),
      isActive: z.boolean(),
      mainActivity: nullableText,
      headquarters: z
        .object({ city: z.string().catch(''), state: z.string().catch('') })
        .catch({ city: '', state: '' }),
    })
    .optional(),
  error: z.string().optional(),
});

const NAME_MAX = 100;

/**
 * Nome fantasia é o rótulo comercial: melhor ponto de partida para o título do
 * site do que a razão social ("ACME COMERCIO DE PECAS LTDA").
 */
const suggestedName = (info: WizardCnpjInfo): string =>
  (info.tradeName ?? info.name).slice(0, NAME_MAX);

const maskCnpj = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

export function StepCnpj({ data, onChange, onNext }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const info = data.cnpjInfo;
  const digits = data.cnpj.replace(/\D/g, '');

  const handleCnpjChange = (raw: string) => {
    const masked = maskCnpj(raw);
    setError('');

    if (!info) {
      onChange({ cnpj: masked });
      return;
    }

    // Trocar o CNPJ invalida a consulta anterior — razão social e situação têm
    // de vir da mesma empresa. O que foi preenchido a partir dela também sai,
    // mas só enquanto intocado: texto escrito pelo usuário nunca é descartado.
    const suggested = suggestedName(info);

    onChange({
      cnpj: masked,
      cnpjInfo: null,
      companyName: '',
      ...(data.name === suggested ? { name: '' } : {}),
      ...(data.subdomain === normalizeSubdomain(suggested) ? { subdomain: '' } : {}),
    });
  };

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;

    const parsed = CheckCNPJSchema.safeParse({ cnpj: data.cnpj });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/cnpj', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj: data.cnpj }),
      });

      const json = CnpjResponseSchema.safeParse(await res.json());

      if (!json.success) {
        setError('Resposta inesperada da consulta de CNPJ');
        return;
      }

      if (!res.ok || !json.data.data) {
        setError(json.data.error ?? 'Não foi possível consultar este CNPJ');
        return;
      }

      const found = json.data.data;

      onChange({
        cnpjInfo: found,
        companyName: found.name,
        // Só sugere o nome se o usuário ainda não escreveu o dele.
        name: data.name || suggestedName(found),
      });
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const canContinue = Boolean(info?.isActive);

  return (
    <section>
      <h2 className="text-xl font-semibold">Qual é o CNPJ da empresa?</h2>
      <p className="mt-2 text-sm text-dark-400">
        Consultamos a Receita Federal para preencher a razão social e o endereço
        do site. O CNPJ precisa estar com a situação cadastral ativa.
      </p>

      <form onSubmit={handleLookup} className="glass mt-6 flex flex-col gap-3 p-3 sm:flex-row">
        <input
          value={data.cnpj}
          onChange={(e) => handleCnpjChange(e.target.value)}
          placeholder="00.000.000/0000-00"
          inputMode="numeric"
          aria-label="CNPJ"
          disabled={loading}
          className="flex-1 border-none bg-transparent text-lg tracking-wide"
        />
        <button
          type="submit"
          disabled={loading || digits.length !== 14}
          className="btn-primary shrink-0 disabled:opacity-40 disabled:hover:scale-100"
        >
          {loading ? 'Consultando…' : 'Consultar CNPJ'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <AnimatePresence mode="wait">
        {info && (
          <motion.div
            key={info.cnpj}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="card mt-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-dark-500">
                  Razão social
                </p>
                <h3 className="mt-1 text-lg font-semibold">{info.name}</h3>
              </div>

              <span
                className={info.isActive ? 'badge badge-success' : 'badge badge-error'}
              >
                {info.status}
              </span>
            </div>

            <div className="divider my-5" />

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-widest text-dark-500">CNPJ</dt>
                <dd className="mt-1 tabular-nums">{formatCNPJ(info.cnpj)}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-widest text-dark-500">
                  Município
                </dt>
                <dd className="mt-1">
                  {info.headquarters.city
                    ? `${info.headquarters.city} — ${info.headquarters.state}`
                    : 'Não informado'}
                </dd>
              </div>

              {info.tradeName && (
                <div>
                  <dt className="text-xs uppercase tracking-widest text-dark-500">
                    Nome fantasia
                  </dt>
                  <dd className="mt-1">{info.tradeName}</dd>
                </div>
              )}

              {info.mainActivity && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-widest text-dark-500">
                    Atividade principal
                  </dt>
                  <dd className="mt-1 text-dark-300">{info.mainActivity}</dd>
                </div>
              )}
            </dl>

            {!info.isActive && (
              <p className="mt-5 text-sm text-red-400">
                Esta empresa está com a situação <strong>{info.status}</strong> na
                Receita Federal. Sites institucionais só podem ser criados para
                CNPJ ativo — regularize o cadastro ou informe outro CNPJ.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!canContinue}
          className="btn-primary disabled:opacity-40 disabled:hover:scale-100"
        >
          Continuar
        </button>
      </div>
    </section>
  );
}
