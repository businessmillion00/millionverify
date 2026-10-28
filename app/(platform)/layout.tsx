import type { ReactNode } from 'react';
import { GoogleTagManager } from '@/components/analytics/google-tag-manager';

/**
 * Grupo de rotas da PLATAFORMA: landing, login, cadastro, painel e admin.
 *
 * Existe por um motivo só: colocar o Google Tag Manager em tudo que é Million
 * Verify e em nada que é site de cliente. Os tenants vivem em
 * app/sites/[subdomain], fora deste grupo, e são servidos nos subdomínios —
 * injetar o container da plataforma lá rastrearia o visitante do cliente.
 *
 * O grupo não muda URL nenhuma. Não renderiza <html>/<body>: isso continua
 * sendo do app/layout.tsx, que é o dono do documento para todo mundo.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GoogleTagManager />
      {children}
    </>
  );
}
