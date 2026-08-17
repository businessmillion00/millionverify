import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit, rateLimitResponse } from '@/lib/utils/rate-limit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { describeBuild, provisionSite, type BuildStatusView } from '@/lib/site/provision';

/**
 * Estado do provisionamento de um site.
 *
 * GET  — polling da tela "Montando.". Só leitura.
 * POST — assume o provisionamento (idempotente: quem perde a corrida recebe o
 *        estado atual sem executar nada). É o gatilho de execução enquanto
 *        `createSite` não chama `enqueueSiteBuild` — ver needsIntegration.
 *
 * O matcher do middleware exclui `/api`: sem `auth()` aqui a rota fica aberta.
 * Recurso de outro dono responde 404, nunca 403, para não permitir enumeração.
 */

export const dynamic = 'force-dynamic';

/**
 * O POST executa o build inteiro (consulta à Receita + leitura do HTML
 * publicado) dentro da requisição. Com o teto padrão de 10s a invocação seria
 * morta no meio e o site ficaria preso em BUILDING até `resetStuckBuilds`.
 */
export const maxDuration = 60;

/** Polling nunca pode ser servido de cache — o valor consultado é justamente o que muda. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/** RATE_LIMITS (lib/utils/rate-limit.ts) não tem entrada de build e é de outro time. */
const POLL_LIMIT = 120;
const POLL_WINDOW_MS = 60_000;
const START_LIMIT = 10;
const START_WINDOW_MS = 3_600_000;

/**
 * `content` entra no select porque o diário do build mora em `content.build`.
 * Os campos realmente pesados — `registryData` e `cnpjDocumentUrl` — ficam de
 * fora: um polling de 1 em 1 segundo não pode arrastar o payload da Receita.
 */
const STATUS_SELECT = {
  id: true,
  buildStatus: true,
  buildStartedAt: true,
  buildCompletedAt: true,
  buildError: true,
  subdomain: true,
  customDomain: true,
  content: true,
} as const;

type Context = { params: Promise<{ id: string }> };

const unauthorized = () =>
  NextResponse.json(
    { success: false, error: 'Não autenticado' },
    { status: 401, headers: NO_STORE },
  );

const notFound = () =>
  NextResponse.json(
    { success: false, error: 'Site não encontrado' },
    { status: 404, headers: NO_STORE },
  );

const ok = (data: BuildStatusView) =>
  NextResponse.json({ success: true, data }, { headers: NO_STORE });

export async function GET(_request: NextRequest, context: Context) {
  const session = await auth();

  if (!session?.user?.id) return unauthorized();

  // Chave pelo id do usuário, não pelo IP: o polling é autenticado e
  // x-forwarded-for é forjável por quem quiser escapar do limite.
  const limit = await rateLimit(
    `site-build-status:${session.user.id}`,
    POLL_LIMIT,
    POLL_WINDOW_MS,
  );

  if (!limit.success) {
    return rateLimitResponse(limit, 'Muitas consultas. Aguarde alguns instantes.');
  }

  const { id } = await context.params;

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
    select: STATUS_SELECT,
  });

  if (!site) return notFound();

  return ok(describeBuild(site));
}

export async function POST(request: NextRequest, context: Context) {
  const session = await auth();

  if (!session?.user?.id) return unauthorized();

  // Route handler autenticado por cookie e fora do middleware: sem esta checagem
  // um POST disparado de outro site chegaria autenticado.
  if (!assertSameOrigin(request)) {
    return NextResponse.json(
      { success: false, error: 'Origem não autorizada' },
      { status: 403, headers: NO_STORE },
    );
  }

  const limit = await rateLimit(
    `site-build-start:${session.user.id}`,
    START_LIMIT,
    START_WINDOW_MS,
  );

  if (!limit.success) {
    return rateLimitResponse(limit, 'Muitas tentativas de montagem. Aguarde alguns minutos.');
  }

  const { id } = await context.params;

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
    select: { id: true },
  });

  if (!site) return notFound();

  // Idempotente: a trava condicional vive dentro de `provisionSite`. Duas abas
  // abertas na tela "Montando." não montam o site duas vezes.
  await provisionSite(site.id);

  const updated = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
    select: STATUS_SELECT,
  });

  if (!updated) return notFound();

  return ok(describeBuild(updated));
}
