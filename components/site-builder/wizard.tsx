'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { SiteTemplateKey } from '@/components/site-templates/types';
import { StepCnpj } from './step-cnpj';
import { StepIdentity } from './step-identity';
import { StepReview } from './step-review';

/**
 * Recorte de CNPJInfo (services/brasil-api) com o que o assistente exibe.
 * Depender do tipo inteiro obrigaria a validar campos que ninguém usa — e uma
 * mudança de formato em `capital` ou `foundedAt` derrubaria a criação de site.
 */
export type WizardCnpjInfo = {
  cnpj: string;
  name: string;
  tradeName: string | null;
  status: string;
  isActive: boolean;
  mainActivity: string | null;
  headquarters: { city: string; state: string };
};

/**
 * Estado único do assistente. Os passos não guardam nada próprio que precise
 * sobreviver a uma troca de passo — voltar e avançar nunca perde o preenchido.
 */
export type WizardData = {
  /** Mantido com máscara: CreateSiteSchema aceita mascarado ou 14 dígitos. */
  cnpj: string;
  /** Razão social vinda da Receita Federal, não digitada pelo usuário. */
  companyName: string;
  cnpjInfo: WizardCnpjInfo | null;
  name: string;
  description: string;
  subdomain: string;
  metaTag: string;
  template: SiteTemplateKey;
};

type Props = {
  tokenBalance: number;
  sitesCount: number;
  maxSites: number;
  tokensPerSite: number;
};

const STEPS = [
  { title: 'CNPJ', hint: 'Consulta na Receita Federal' },
  { title: 'Identidade', hint: 'Nome, subdomínio e meta tag' },
  { title: 'Revisão', hint: 'Prévia e custo em tokens' },
] as const;

const INITIAL_DATA: WizardData = {
  cnpj: '',
  companyName: '',
  cnpjInfo: null,
  name: '',
  description: '',
  subdomain: '',
  metaTag: '',
  template: 'minimal',
};

export function Wizard({ tokenBalance, sitesCount, maxSites, tokensPerSite }: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [subdomainError, setSubdomainError] = useState('');
  const reduceMotion = useReducedMotion() ?? false;

  const update = useCallback((patch: Partial<WizardData>) => {
    setData((current) => ({ ...current, ...patch }));

    // Editar o subdomínio invalida o conflito detectado no envio anterior.
    if ('subdomain' in patch) setSubdomainError('');
  }, []);

  const goTo = useCallback((next: number) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleSubdomainConflict = useCallback(
    (message: string) => {
      setSubdomainError(message);
      setStep(1);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    []
  );

  const transition = { duration: reduceMotion ? 0 : 0.28, ease: 'easeOut' as const };

  return (
    <div className="mt-10">
      <ol className="flex flex-wrap gap-x-8 gap-y-3">
        {STEPS.map((item, index) => (
          <li
            key={item.title}
            className={`flex items-center gap-3 text-sm transition-colors ${
              index <= step ? 'text-amber-400' : 'text-dark-500'
            }`}
            aria-current={index === step ? 'step' : undefined}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                index < step
                  ? 'bg-amber-500'
                  : index === step
                    ? 'animate-pulse-amber bg-amber-500'
                    : 'bg-dark-700'
              }`}
            />
            <span>
              <span className="font-medium">{item.title}</span>
              <span className="ml-2 hidden text-xs text-dark-500 sm:inline">
                {item.hint}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div
        className="mt-4 h-1 w-full overflow-hidden rounded-full bg-dark-800"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-label="Progresso da criação do site"
      >
        <motion.div
          className="gradient-amber h-full"
          initial={false}
          animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          transition={transition}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={transition}
          className="mt-8"
        >
          {step === 0 && (
            <StepCnpj data={data} onChange={update} onNext={() => goTo(1)} />
          )}

          {step === 1 && (
            <StepIdentity
              data={data}
              onChange={update}
              subdomainError={subdomainError}
              onBack={() => goTo(0)}
              onNext={() => goTo(2)}
            />
          )}

          {step === 2 && (
            <StepReview
              data={data}
              tokenBalance={tokenBalance}
              tokensPerSite={tokensPerSite}
              sitesCount={sitesCount}
              maxSites={maxSites}
              onBack={() => goTo(1)}
              onSubdomainConflict={handleSubdomainConflict}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
