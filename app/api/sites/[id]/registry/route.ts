/**
 * GET /api/sites/[id]/registry
 *
 * Devolve, já normalizados, os campos que o cliente precisa colar no Business Manager.
 * A lista de campos vem de `buildBmFields`, a MESMA função que a tabela da tela de
 * verificação renderiza — tela e API não têm como divergir.
 *
 * O middleware não cobre /api (o matcher exclui a rota), então a autenticação e a
 * conferência de dono acontecem aqui, com `findFirst` amarrado ao `userId`: site de
 * outra pessoa devolve 404, indistinguível de "não existe", para não permitir
 * enumeração de ids.
 */

import { NextRequest, NextResponse } from 'next/server';

import {
  buildBmFields,
  buildCopyAllText,
  loadRegistryData,
} from '@/components/verification/bm-data-table';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit, rateLimitResponse } from '@/lib/utils/rate-limit';
import { withSecurityHeaders } from '@/lib/security/headers';

export const dynamic = 'force-dynamic';

/** Teto do endpoint: segura recarga em rajada sem gastar o limite de consulta à Receita. */
const READ_LIMIT = 60;
const READ_WINDOW_MS = 60_000;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ success: false, error: 'Não autenticado' }, 401);
  }

  // Chave pelo id do usuário: o fluxo é autenticado e x-forwarded-for é forjável.
  const limit = await rateLimit(`site-registry:${session.user.id}`, READ_LIMIT, READ_WINDOW_MS);
  if (!limit.success) {
    return withSecurityHeaders(
      rateLimitResponse(limit, 'Muitas consultas ao cadastro. Aguarde alguns instantes.'),
    );
  }

  const { id } = await context.params;

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
    select: {
      id: true,
      userId: true,
      cnpj: true,
      companyName: true,
      subdomain: true,
      customDomain: true,
      phone: true,
      email: true,
      registryData: true,
    },
  });

  if (!site) {
    return json({ success: false, error: 'Site não encontrado' }, 404);
  }

  // O limite de 50 consultas/dia à Receita (SITE_RATE_LIMITS.CHECK_CNPJ) é aplicado
  // dentro de loadRegistryData, e só é gasto quando a coluna ainda está vazia.
  const resolution = await loadRegistryData({
    siteId: site.id,
    userId: site.userId,
    cnpj: site.cnpj,
    stored: site.registryData,
  });

  const fields = buildBmFields({ site, registry: resolution.data });

  return json({
    success: true,
    data: {
      siteId: site.id,
      source: resolution.source,
      registry: resolution.data,
      fields,
      copyAll: buildCopyAllText(fields),
    },
    ...(resolution.warning ? { warning: resolution.warning } : {}),
  });
}

function json(body: unknown, status: number = 200): NextResponse {
  return withSecurityHeaders(
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  );
}
