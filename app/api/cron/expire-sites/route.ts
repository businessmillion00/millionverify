import { NextRequest, NextResponse } from 'next/server';
import { EXPIRE_BATCH_SIZE, expireSites } from '@/lib/site/lifetime';

export const dynamic = 'force-dynamic';

/*
 * A remoção de cada domínio na Vercel tem timeout próprio de 15s; com o lote
 * padrão e 5 remoções simultâneas, os 10s default da Vercel não bastam.
 */
export const maxDuration = 60;

/**
 * Exclusão dos sites cujo prazo de vida venceu. Rodar a cada 15–60 minutos.
 *
 * Máquina-para-máquina: sem `auth()`, autenticado por Bearer CRON_SECRET — igual a
 * app/api/cron/verify-meta-tags/route.ts.
 *
 * A rota é fina de propósito: quem seleciona o lote, marca a exclusão, registra a
 * auditoria e limpa o domínio é `lib/site/lifetime.ts`. A pontualidade NÃO depende
 * daqui — as consultas já escondem o site vencido; esta rotina só faz a limpeza.
 *
 * Resposta: `{ expired, remaining, durationMs }`. `remaining` acima de zero em
 * rodadas seguidas significa que o lote não está dando conta do volume.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  // Sem o segredo configurado, `Bearer undefined` seria um cabeçalho válido e qualquer
  // um poderia disparar o job. Falhar fechado é a única opção.
  if (!expected) {
    console.error('CRON_SECRET ausente: rota de expiração de sites desativada.');
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 });
  }

  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
  const startedAt = Date.now();

  try {
    const summary = await expireSites(limit);

    if (summary.expired > 0) {
      console.info(`Expiração de sites: ${summary.expired} excluído(s), ${summary.remaining} restante(s).`);
    }

    return NextResponse.json(
      { ...summary, durationMs: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro na expiração de sites:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** `?limit=` é só uma alavanca de operação (a rota já exige o segredo); `expireSites` reclampa. */
function parseLimit(raw: string | null): number {
  if (!raw) return EXPIRE_BATCH_SIZE;

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : EXPIRE_BATCH_SIZE;
}
