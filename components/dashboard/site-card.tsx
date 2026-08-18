'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'framer-motion';
import { APP_CONFIG } from '@/lib/constants';

type Props = {
  /** Campos exatamente como vêm do select de getSitesByUser(). */
  siteId: string;
  name: string;
  subdomain: string;
  companyName: string;
  isPublished: boolean;
  viewsCount: number;
  metaTagVerified: boolean;
  /** Rótulo relativo pronto do servidor — formatar no cliente divergiria na hidratação. */
  createdAtLabel: string;
  /**
   * Site novo o suficiente para o certificado do subdomínio ainda estar sendo
   * emitido. Decidido no servidor: comparar datas no cliente divergiria na
   * hidratação.
   */
  verificarEndereco: boolean;
};

type CopyState = 'idle' | 'ok' | 'erro';

export function SiteCard({
  siteId,
  name,
  subdomain,
  companyName,
  isPublished,
  viewsCount,
  metaTagVerified,
  createdAtLabel,
  verificarEndereco,
}: Props) {
  const reduced = useReducedMotion();
  const [copy, setCopy] = useState<CopyState>('idle');
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const host = `${subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}`;
  const url = `https://${host}`;

  /*
   * A Vercel emite o certificado do subdomínio de 2 a 4 minutos DEPOIS do build
   * terminar. Oferecer o link nesse intervalo faz o cliente clicar, ver erro de
   * conexão e concluir que o site quebrou.
   *
   * Em vez de esperar um tempo fixo, o endereço é sondado no servidor e
   * liberado assim que responde de verdade — normalmente antes dos 5 minutos.
   */
  const [enderecoPronto, setEnderecoPronto] = useState(!verificarEndereco);

  useEffect(() => {
    if (enderecoPronto) return;

    let cancelado = false;

    const sondar = async () => {
      try {
        const resposta = await fetch(`/api/sites/${siteId}/domain-status`, {
          cache: 'no-store',
        });
        const corpo = await resposta.json();
        if (!cancelado && corpo?.data?.pronto === true) setEnderecoPronto(true);
      } catch {
        // Rede instável: a próxima volta tenta de novo.
      }
    };

    void sondar();
    const intervalo = window.setInterval(sondar, 15_000);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [siteId, enderecoPronto]);

  // Halo que acompanha o cursor. Motion values em vez de estado: mover o mouse
  // não pode disparar re-render do cartão inteiro.
  const haloX = useSpring(0, { stiffness: 220, damping: 30 });
  const haloY = useSpring(0, { stiffness: 220, damping: 30 });
  const haloOpacity = useMotionValue(0);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (reduced) return;
      const rect = event.currentTarget.getBoundingClientRect();
      haloX.set(event.clientX - rect.left);
      haloY.set(event.clientY - rect.top);
      haloOpacity.set(1);
    },
    [haloOpacity, haloX, haloY, reduced],
  );

  useEffect(() => () => clearTimeout(timeout.current), []);

  const copiar = useCallback(async () => {
    clearTimeout(timeout.current);
    try {
      await navigator.clipboard.writeText(url);
      setCopy('ok');
    } catch {
      setCopy('erro');
    }
    timeout.current = setTimeout(() => setCopy('idle'), 2200);
  }, [url]);

  return (
    <motion.article
      onPointerMove={onPointerMove}
      onPointerLeave={() => haloOpacity.set(0)}
      whileHover={reduced ? undefined : { y: -4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-dark-700 bg-white/[0.02] p-6 transition-colors duration-300 hover:border-amber-500/40"
    >
      {/* Centralização por margem, não por -translate-*: o transform inline do
          motion value substituiria a classe utilitária e o halo ficaria torto. */}
      <motion.span
        aria-hidden
        style={{ x: haloX, y: haloY, opacity: haloOpacity }}
        className="pointer-events-none absolute -ml-28 -mt-28 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl transition-opacity duration-300"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-white">{name}</h3>
          <p className="mt-1 truncate text-xs text-dark-500">{companyName}</p>
        </div>

        <span
          className={`badge shrink-0 text-xs ${
            metaTagVerified ? 'badge-success' : 'badge-warning'
          }`}
          title={
            metaTagVerified
              ? 'A meta tag de verificação foi encontrada no site.'
              : 'Ainda estamos confirmando a meta tag de verificação.'
          }
        >
          {metaTagVerified ? 'Tag ativa' : 'Verificando'}
        </span>
      </div>

      <div className="relative mt-5 flex items-center gap-2">
        {enderecoPronto ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-sm text-amber-400 transition-colors hover:text-amber-300 hover:underline"
          >
            {host}
          </a>
        ) : (
          <span
            title="O endereço fica disponível assim que o certificado é emitido — leva alguns minutos."
            className="flex min-w-0 items-center gap-2 text-sm text-dark-400"
          >
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400"
            />
            <span className="truncate">{host}</span>
            <span className="shrink-0 text-xs text-dark-500">liberando…</span>
          </span>
        )}

        <button
          type="button"
          onClick={copiar}
          aria-label={`Copiar endereço de ${name}`}
          className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg text-dark-500 transition-colors hover:bg-white/5 hover:text-white"
        >
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
        </button>

        <AnimatePresence>
          {copy !== 'idle' && (
            <motion.span
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 24 }}
              role="status"
              className={`text-xs ${copy === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {copy === 'ok' ? 'Copiado' : 'Falhou'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="relative mt-auto flex items-end justify-between gap-3 pt-6">
        <div>
          <p className="text-2xl font-semibold text-white tabular-nums">
            {viewsCount.toLocaleString('pt-BR')}
          </p>
          <p className="mt-0.5 text-xs text-dark-500">
            {viewsCount === 1 ? 'visualização' : 'visualizações'}
          </p>
        </div>

        <div className="text-right">
          <span
            className={`badge text-xs ${
              isPublished ? 'bg-white/5 text-dark-300' : 'bg-dark-800/60 text-dark-300'
            }`}
          >
            {isPublished ? 'Publicado' : 'Rascunho'}
          </span>
          <p className="mt-2 text-xs text-dark-500">Criado {createdAtLabel}</p>
        </div>
      </div>
    </motion.article>
  );
}
