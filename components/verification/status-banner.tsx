'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { setSitePublished } from '@/app/actions/site-manage';
import { BM_DOMAINS_URL } from '@/components/verification/tutorial-steps';

/**
 * Banner de estado da verificação: sempre UMA mensagem, a mais bloqueante.
 * A ordem existe porque um estado esconde o outro — checar a tag num site
 * despublicado devolve 404 para sempre e o cliente nunca descobriria por quê.
 *
 * 1. unpublished  → o site responde 404; nada mais importa.
 * 1b. propagating → publicado, mas o endereço ainda não responde: a Vercel leva
 *      alguns minutos para emitir o certificado do subdomínio. Verificar agora
 *      falha SEMPRE, porque a Meta não consegue abrir a página.
 * 2. missing-code → não existe código salvo; a Meta não tem o que verificar.
 * 3. awaiting     → código salvo, ainda não confirmado no HTML/DNS.
 * 4. verified     → falta só clicar em "Verificar domínio" no Business Manager.
 *
 * Framer Motion (e não <Reveal>): o banner troca de estado depois da primeira
 * pintura e o ScrollTrigger do Reveal não dispararia, deixando-o em opacity 0.
 */

export type VerificationState =
  | 'unpublished'
  | 'propagating'
  | 'missing-code'
  | 'awaiting'
  | 'verified';

type Props = {
  siteId: string;
  state: VerificationState;
  host: string;
  /** Última checagem já formatada no servidor; null = nunca checamos. */
  lastCheckedLabel: string | null;
};

const TONE: Record<VerificationState, { frame: string; badge: string; label: string }> = {
  unpublished: {
    frame: 'border-red-500/30 bg-red-500/5',
    badge: 'badge badge-error',
    label: 'Site fora do ar',
  },
  propagating: {
    frame: 'border-amber-500/30 bg-amber-500/5',
    badge: 'badge badge-warning',
    label: 'Preparando o endereço',
  },
  'missing-code': {
    frame: 'border-red-500/30 bg-red-500/5',
    badge: 'badge badge-error',
    label: 'Sem código de verificação',
  },
  awaiting: {
    frame: 'border-amber-500/30 bg-amber-500/5',
    badge: 'badge badge-warning',
    label: 'Pendente no Business Manager',
  },
  verified: {
    frame: 'border-emerald-500/30 bg-emerald-500/5',
    badge: 'badge badge-success',
    label: 'Código publicado e confirmado',
  },
};

export function StatusBanner({ siteId, state, host, lastCheckedLabel }: Props) {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  const tone = TONE[state];

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError('');

    try {
      const result = await setSitePublished({ siteId, published: true });

      if (!result.success) {
        setPublishError(result.error ?? 'Não foi possível publicar o site agora.');
        return;
      }

      // A action revalida /dashboard/sites/[id], não esta rota: o refresh é
      // quem traz o estado novo para cá.
      router.refresh();
    } catch {
      setPublishError('Não foi possível publicar o site agora.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={state}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
        role={state === 'verified' ? 'status' : 'alert'}
        className={`mt-8 rounded-xl border p-6 ${tone.frame}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className={tone.badge}>{tone.label}</span>

          {lastCheckedLabel && state !== 'missing-code' && (
            <span className="text-xs text-dark-500">
              Última checagem em {lastCheckedLabel}
            </span>
          )}
          {!lastCheckedLabel && state === 'awaiting' && (
            <span className="text-xs text-dark-500">Ainda não checamos este código.</span>
          )}
        </div>

        {state === 'unpublished' && (
          <>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dark-300">
              O site está como rascunho: quem abrir{' '}
              <span className="text-white">{host}</span> recebe uma página não
              encontrada. A Meta faz exatamente essa visita para procurar o código —
              enquanto o site não estiver publicado, a verificação falha sempre,
              mesmo com o código certo salvo aqui.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="btn-primary disabled:opacity-50"
              >
                {publishing ? 'Publicando…' : 'Publicar site agora'}
              </button>

              <Link href={`/dashboard/sites/${siteId}`} className="btn-ghost text-sm">
                Abrir configurações do site
              </Link>
            </div>

            {publishError && <p className="mt-3 text-xs text-red-400">{publishError}</p>}
          </>
        )}

        {state === 'propagating' && (
          <>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dark-300">
              O site foi publicado, mas <span className="text-white">{host}</span>{' '}
              ainda não responde: o certificado de segurança do endereço leva de dois
              a quatro minutos para ser emitido. É automático e não exige nada de você.
            </p>

            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-dark-300">
              <strong className="text-white">Espere o endereço abrir antes de verificar
              na Meta.</strong>{' '}
              A verificação funciona com a Meta visitando o seu site — se ela visitar
              agora, não conseguirá abrir a página e o domínio será recusado, mesmo com
              o código correto salvo aqui.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => router.refresh()}
                className="btn-secondary text-sm"
              >
                Conferir de novo
              </button>
            </div>
          </>
        )}

        {state === 'missing-code' && (
          <>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dark-300">
              Nenhum código de verificação foi salvo ainda. Sem ele, a Meta abre o seu
              site, não encontra nada que prove que o domínio é seu e mantém a Business
              Manager bloqueada — não há como ela verificar no escuro.
            </p>

            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-dark-300">
              Pegue o código em{' '}
              <span className="text-white">
                Meta Business Manager → Configurações do negócio → Segurança da marca →
                Domínios
              </span>
              : adicione <span className="text-white">{host}</span>, escolha a opção de{' '}
              <span className="text-white">meta tag</span> e cole aqui embaixo o valor de{' '}
              <span className="font-mono text-white">content=&quot;…&quot;</span>.
            </p>

            <a
              href={BM_DOMAINS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary mt-5 inline-block text-sm"
            >
              Abrir Domínios no Business Manager
            </a>
          </>
        )}

        {state === 'awaiting' && (
          <>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dark-300">
              O código está salvo e já é servido no{' '}
              <span className="font-mono text-white">&lt;head&gt;</span> de{' '}
              <span className="text-white">{host}</span>. Falta a Meta confirmar: abra
              Domínios no Business Manager e clique em{' '}
              <span className="text-white">Verificar domínio</span>. Se ela recusar, use
              “Diagnosticar agora” aqui embaixo para conferir que o código está sendo
              servido antes de abrir chamado com a Meta.
            </p>

            <a
              href={BM_DOMAINS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary mt-5 inline-block text-sm"
            >
              Abrir Domínios no Business Manager
            </a>
          </>
        )}

        {state === 'verified' && (
          <>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dark-300">
              Conferimos o endereço <span className="text-white">{host}</span> e o código
              está lá, servido para quem acessar. Agora é com a Meta: abra Domínios no
              Business Manager, selecione o domínio e clique em{' '}
              <span className="text-white">Verificar domínio</span> para destravar a BM.
            </p>

            <a
              href={BM_DOMAINS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-primary mt-5 inline-block text-sm"
            >
              Verificar no Business Manager
            </a>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
