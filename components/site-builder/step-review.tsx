'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSite } from '@/app/actions/site';
import { setSiteTemplate } from '@/app/actions/site-manage';
import { APP_CONFIG } from '@/lib/constants';
import { formatCNPJ } from '@/lib/utils';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_BG_COLOR,
  SITE_TEMPLATE_LABELS,
  buildPalette,
} from '@/components/site-templates/types';
import type { WizardData } from './wizard';

type Props = {
  data: WizardData;
  tokenBalance: number;
  tokensPerSite: number;
  sitesCount: number;
  maxSites: number;
  onBack: () => void;
  onSubdomainConflict: (message: string) => void;
};

/**
 * `idle` → pode enviar. `submitting` → envio em curso.
 * `blocked` → o site pode já existir (criado, ou resposta perdida): reenviar
 * cobraria 10 tokens de novo, então o botão nunca volta a ficar disponível.
 */
type SubmitState = 'idle' | 'submitting' | 'blocked';

/** Cores que createSite grava em `theme` — a prévia mostra o site real. */
const PREVIEW_PALETTE = buildPalette({
  bgColor: DEFAULT_BG_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
});

export function StepReview({
  data,
  tokenBalance,
  tokensPerSite,
  sitesCount,
  maxSites,
  onBack,
  onSubdomainConflict,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const url = `${data.subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}`;
  const balanceAfter = tokenBalance - tokensPerSite;
  const hasBalance = tokenBalance >= tokensPerSite;
  const location = data.cnpjInfo?.headquarters.city
    ? `${data.cnpjInfo.headquarters.city} — ${data.cnpjInfo.headquarters.state}`
    : null;

  const handleSubmit = async () => {
    if (state !== 'idle' || !hasBalance) return;

    setError('');
    setWarning('');
    setState('submitting');

    try {
      const result = await createSite({
        name: data.name.trim(),
        companyName: data.companyName.trim(),
        cnpj: data.cnpj,
        subdomain: data.subdomain,
        description: data.description.trim() || undefined,
        metaTag: data.metaTag.trim() || undefined,
      });

      if (!result.success || !result.data) {
        const message = result.error ?? 'Erro ao criar site';
        setState('idle');

        // Corrida entre a checagem de disponibilidade e a criação: o campo
        // precisa voltar ao passo anterior já sinalizado.
        if (/subdom/i.test(message)) {
          onSubdomainConflict(message);
          return;
        }

        setError(message);
        return;
      }

      const created = result.data;

      // O template não faz parte de CreateSiteSchema; é gravado logo depois.
      const applied = await setSiteTemplate({
        siteId: created.id,
        template: data.template,
      });

      if (!applied.success) {
        // Sem router.refresh() aqui: recarregar a página trocaria o assistente
        // pelo aviso de saldo/limite e o usuário nunca leria este recado.
        setState('blocked');
        setWarning(
          `Site criado em ${created.subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}, mas o template escolhido não foi aplicado. Troque o template na página do site.`
        );
        return;
      }

      // `createSite` enfileirou o provisionamento: o destino é a tela que mostra
      // o build acontecendo, e é ela que leva à verificação quando termina.
      // Mandar para "Meus sites" aqui deixaria o cliente olhando uma lista
      // enquanto o site dele está sendo montado.
      router.push(`/dashboard/sites/${created.id}/montando`);
      router.refresh();
    } catch {
      // A resposta se perdeu: o site pode ter sido criado e os tokens debitados.
      setState('blocked');
      setError(
        'Não foi possível confirmar a criação. Abra "Meus sites" para verificar se o site já existe antes de tentar de novo.'
      );
    }
  };

  return (
    <section>
      <h2 className="text-xl font-semibold">Revisão</h2>
      <p className="mt-2 text-sm text-dark-400">
        Confira antes de publicar. O subdomínio não pode ser alterado depois.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-dark-700">
          <div className="flex items-center gap-2 border-b border-dark-700 bg-dark-900 px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-dark-700" />
            <span className="h-2 w-2 rounded-full bg-dark-700" />
            <span className="h-2 w-2 rounded-full bg-dark-700" />
            <span className="ml-2 truncate text-xs text-dark-400">{url}</span>
          </div>

          <div
            className="px-6 py-10"
            style={{ backgroundColor: PREVIEW_PALETTE.bg, color: PREVIEW_PALETTE.ink }}
          >
            {location && (
              <p
                className="text-[0.65rem] uppercase tracking-[0.35em]"
                style={{ color: PREVIEW_PALETTE.accent }}
              >
                {location}
              </p>
            )}

            <h3 className="mt-3 text-2xl font-semibold tracking-tight">
              {data.name || 'Nome do site'}
            </h3>

            <p className="mt-1 text-sm" style={{ color: PREVIEW_PALETTE.inkMuted }}>
              {data.companyName}
            </p>

            <span
              className="mt-5 block h-px w-full"
              style={{ backgroundColor: PREVIEW_PALETTE.hairline }}
            />

            {data.description && (
              <p className="mt-5 text-sm" style={{ color: PREVIEW_PALETTE.inkMuted }}>
                {data.description}
              </p>
            )}

            <p
              className="mt-5 text-xs tabular-nums"
              style={{ color: PREVIEW_PALETTE.inkSubtle }}
            >
              CNPJ {formatCNPJ(data.cnpj)}
            </p>
          </div>
        </div>

        <div className="card">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-widest text-dark-500">
                Razão social
              </dt>
              <dd className="mt-1">{data.companyName}</dd>
            </div>

            <div>
              <dt className="text-xs uppercase tracking-widest text-dark-500">CNPJ</dt>
              <dd className="mt-1 tabular-nums">{formatCNPJ(data.cnpj)}</dd>
            </div>

            <div>
              <dt className="text-xs uppercase tracking-widest text-dark-500">
                Endereço do site
              </dt>
              <dd className="mt-1 text-amber-400">{url}</dd>
            </div>

            <div>
              <dt className="text-xs uppercase tracking-widest text-dark-500">
                Template
              </dt>
              <dd className="mt-1">{SITE_TEMPLATE_LABELS[data.template].name}</dd>
            </div>

            <div>
              <dt className="text-xs uppercase tracking-widest text-dark-500">
                Meta tag do Facebook
              </dt>
              <dd className="mt-1 break-all">
                {data.metaTag.trim() || (
                  <span className="text-dark-400">
                    Nenhuma — você pode adicionar depois
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="divider my-5" />

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-dark-400">Custo da criação</span>
            <span className="text-gradient text-lg font-medium tabular-nums">
              {tokensPerSite.toLocaleString('pt-BR')} tokens
            </span>
          </div>

          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm text-dark-400">Saldo após a criação</span>
            <span className="tabular-nums">
              {Math.max(balanceAfter, 0).toLocaleString('pt-BR')} tokens
            </span>
          </div>

          <p className="mt-4 text-xs text-dark-500">
            Este será o seu site {Math.min(sitesCount + 1, maxSites)} de {maxSites}.
          </p>

          {!hasBalance && (
            <p className="mt-4 text-sm text-red-400">
              Saldo insuficiente: você tem{' '}
              {tokenBalance.toLocaleString('pt-BR')} tokens e a criação custa{' '}
              {tokensPerSite.toLocaleString('pt-BR')}.
            </p>
          )}
        </div>
      </div>

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {warning && <p className="mt-6 text-sm text-yellow-400">{warning}</p>}

      {state === 'blocked' ? (
        <div className="mt-8 flex justify-end">
          <Link href="/dashboard/sites" className="btn-primary">
            Ir para meus sites
          </Link>
        </div>
      ) : (
        <div className="mt-8 flex flex-wrap justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={state === 'submitting'}
            className="btn-ghost disabled:opacity-40"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={state === 'submitting' || !hasBalance}
            className="btn-primary disabled:opacity-40 disabled:hover:scale-100"
          >
            {state === 'submitting'
              ? 'Criando site…'
              : `Criar site por ${tokensPerSite} tokens`}
          </button>
        </div>
      )}
    </section>
  );
}
