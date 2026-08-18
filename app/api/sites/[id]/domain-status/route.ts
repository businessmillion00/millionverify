/**
 * O endereço do site já responde?
 *
 * A Vercel emite o certificado do subdomínio de forma assíncrona — leva de 2 a
 * 4 minutos depois do build terminar. Nesse intervalo o link existe mas não
 * abre, e o cliente conclui que o site quebrou.
 *
 * A sondagem acontece no servidor porque o navegador não distingue "certificado
 * ainda não emitido" de "rede caiu": ambos chegam como um fetch rejeitado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { siteUrl } from '@/lib/subdomain';
import { withSecurityHeaders } from '@/lib/security/headers';
import { rateLimit, rateLimitResponse } from '@/lib/utils/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const PROBE_TIMEOUT_MS = 6_000;
/** A tela consulta a cada 15s; o teto acomoda algumas abas abertas. */
const PROBE_LIMIT = 60;
const PROBE_WINDOW_MS = 60_000;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(_request: NextRequest, context: Context) {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ success: false, error: 'Não autenticado' }, 401);
  }

  const limit = await rateLimit(
    `site-domain-status:${session.user.id}`,
    PROBE_LIMIT,
    PROBE_WINDOW_MS,
  );

  if (!limit.success) {
    return withSecurityHeaders(rateLimitResponse(limit));
  }

  const { id } = await context.params;

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
    select: { subdomain: true, customDomain: true, isPublished: true },
  });

  if (!site) {
    return json({ success: false, error: 'Site não encontrado' }, 404);
  }

  if (!site.isPublished) {
    return json({ success: true, data: { pronto: false, motivo: 'nao-publicado' } }, 200);
  }

  const url = siteUrl(site);

  try {
    /*
     * `redirect: 'manual'` porque redirecionamento já prova que o TLS fechou —
     * seguir a cadeia só gastaria tempo. Qualquer resposta HTTP serve: o que
     * está sendo medido é o handshake, não o conteúdo.
     */
    await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });

    return json({ success: true, data: { pronto: true, url } }, 200);
  } catch {
    // Falha aqui é o estado normal enquanto o certificado não sai. Não é erro:
    // por isso 200 com `pronto: false`, e não 5xx.
    return json({ success: true, data: { pronto: false, motivo: 'certificado', url } }, 200);
  }
}

function json(body: Record<string, unknown>, status: number): NextResponse {
  return withSecurityHeaders(NextResponse.json(body, { status, headers: NO_STORE }));
}
