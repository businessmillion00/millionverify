import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/security/audit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit, rateLimitResponse } from '@/lib/utils/rate-limit';
import {
  DIAGNOSE_SITE_SELECT,
  diagnoseSite,
  persistDiagnostic,
} from '@/lib/verification/diagnose';

/**
 * Diagnóstico sob demanda de um site.
 *
 * É POST porque tem efeito: dispara requisições externas (HTTP + DNS) e grava
 * `lastDiagnostic`, `metaTagVerified` e os carimbos de tempo. Um GET com esse efeito
 * seria disparado por prefetch, por crawler e por qualquer <img> apontada para a rota.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Cada diagnóstico custa TRÊS requisições externas (home, home vista como o robô da
 * Meta e política de privacidade — todas em paralelo dentro de `diagnoseSite`) mais uma
 * consulta DNS. 20/min por usuário continua folgado para uso humano e fecha a porta para
 * um laço automatizado transformar o painel em ferramenta de carga contra o site alheio.
 *
 * O catálogo `RATE_LIMITS` (lib/utils/rate-limit.ts) é arquivo compartilhado e não
 * pode ser editado por esta trilha — daí as constantes locais.
 */
const DIAGNOSE_LIMIT = 20;
const DIAGNOSE_WINDOW_MS = 60_000;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  // O matcher do middleware exclui /api: sem esta checagem a rota fica aberta.
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Não autenticado' },
      { status: 401, headers: NO_STORE },
    );
  }

  // Rota mutante autenticada por cookie: sem Origin conferido, outro site dispararia
  // o diagnóstico em nome do usuário logado.
  if (!assertSameOrigin(request)) {
    return NextResponse.json(
      { success: false, error: 'Origem não permitida' },
      { status: 403, headers: NO_STORE },
    );
  }

  const userId = session.user.id;

  // Chave pelo id do usuário e não pelo IP: a rota é autenticada e x-forwarded-for
  // é forjável por quem quiser escapar do limite.
  const limit = await rateLimit(`site-diagnose:${userId}`, DIAGNOSE_LIMIT, DIAGNOSE_WINDOW_MS);

  if (!limit.success) {
    return rateLimitResponse(
      limit,
      'Muitos diagnósticos seguidos. Aguarde um instante antes de tentar de novo.',
    );
  }

  const { id } = await context.params;

  // findFirst amarrado ao dono: site de outro usuário responde 404, indistinguível
  // de "não existe", para não permitir enumeração de ids.
  const site = await prisma.site.findFirst({
    where: { id, userId, isDeleted: false },
    select: DIAGNOSE_SITE_SELECT,
  });

  if (!site) {
    return NextResponse.json(
      { success: false, error: 'Site não encontrado' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const diagnostic = await diagnoseSite(site);

    // persistDiagnostic é a única escritora de lastDiagnostic/metaTagVerified:
    // ela também é quem garante que 'indeterminado' não zera uma tag já verificada.
    await persistDiagnostic(id, diagnostic);

    await recordAudit({
      userId,
      action: 'SITE_DIAGNOSED',
      resource: 'site',
      resourceId: id,
      changes: {
        url: diagnostic.url,
        httpStatus: diagnostic.httpStatus,
        latencyMs: diagnostic.latencyMs,
        metaTag: diagnostic.metaTag.outcome,
        txt: diagnostic.txt.outcome,
        txtApplicable: diagnostic.txt.applicable,
        privacyPolicy: diagnostic.privacyPolicy.outcome,
        privacyPolicyStatus: diagnostic.privacyPolicy.httpStatus,
        crawler: diagnostic.crawler.outcome,
        crawlerStatus: diagnostic.crawler.httpStatus,
        // O campo que explica o suporte: 200 para nós e bloqueio para o robô é o
        // cenário em que o cliente jura que está tudo certo e a Meta recusa.
        crawlerBlocked: diagnostic.crawler.blocked,
      },
      status: diagnostic.error === null ? 'success' : 'error',
      ...(diagnostic.error !== null ? { errorMessage: diagnostic.error } : {}),
    });

    return NextResponse.json({ success: true, data: diagnostic }, { headers: NO_STORE });
  } catch (error) {
    console.error('Erro ao diagnosticar site:', { siteId: id }, error);

    return NextResponse.json(
      { success: false, error: 'Não foi possível concluir o diagnóstico agora.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
