'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatCNPJ, slugify } from '@/lib/utils';

type CnpjResult = {
  cnpj: string;
  name: string;
  status: string;
  headquarters?: { city: string; state: string };
};

const STEPS = [
  'Consultando Receita Federal',
  'Validando situação cadastral',
  'Reservando subdomínio',
  'Injetando meta tag do Meta',
];

const maskCnpj = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

export function CnpjSimulator() {
  const [cnpj, setCnpj] = useState('');
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<CnpjResult | null>(null);
  const [error, setError] = useState('');

  const running = step >= 0 && !result;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setStep(0);

    // A animação de processamento roda em paralelo com a requisição real,
    // mas nunca a atrasa além do necessário.
    const choreography = (async () => {
      for (let i = 1; i < STEPS.length; i++) {
        await new Promise((r) => setTimeout(r, 550));
        setStep(i);
      }
    })();

    try {
      const res = await fetch('/api/cnpj', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj }),
      });

      const json = await res.json();
      await choreography;

      if (!res.ok) {
        setError(json.error ?? 'Não foi possível consultar este CNPJ');
        setStep(-1);
        return;
      }

      setResult(json.data);
    } catch {
      await choreography;
      setError('Erro de conexão. Tente novamente.');
      setStep(-1);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form
        onSubmit={handleSubmit}
        className="glass flex flex-col gap-3 p-3 sm:flex-row"
      >
        <input
          value={cnpj}
          onChange={(e) => setCnpj(maskCnpj(e.target.value))}
          placeholder="00.000.000/0000-00"
          inputMode="numeric"
          disabled={running}
          className="flex-1 border-none bg-transparent text-lg tracking-wide"
        />
        <button
          type="submit"
          disabled={running || cnpj.replace(/\D/g, '').length !== 14}
          className="btn-primary shrink-0 disabled:opacity-40 disabled:hover:scale-100"
        >
          {running ? 'Processando…' : 'Gerar prévia'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <AnimatePresence mode="wait">
        {running && (
          <motion.ul
            key="steps"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="mt-6 space-y-3"
          >
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`flex items-center gap-3 text-sm transition-colors ${
                  i <= step ? 'text-amber-400' : 'text-dark-500'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    i < step
                      ? 'bg-amber-500'
                      : i === step
                        ? 'animate-pulse-amber bg-amber-500'
                        : 'bg-dark-700'
                  }`}
                />
                {label}
              </li>
            ))}
          </motion.ul>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-hover mt-6"
          >
            <span className="badge badge-amber">Prévia gerada</span>

            <h3 className="mt-4 text-2xl font-semibold">{result.name}</h3>
            <p className="mt-1 text-sm text-dark-400">
              {formatCNPJ(result.cnpj)}
              {result.headquarters &&
                ` · ${result.headquarters.city}/${result.headquarters.state}`}
            </p>

            <div className="divider my-5" />

            <p className="text-xs uppercase tracking-widest text-dark-500">
              Subdomínio reservado
            </p>
            <p className="text-gradient mt-1 text-lg font-medium">
              {slugify(result.name).slice(0, 40)}.businessmillion.app
            </p>

            <a href="/register" className="btn-primary mt-6 inline-flex">
              Publicar este site
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
