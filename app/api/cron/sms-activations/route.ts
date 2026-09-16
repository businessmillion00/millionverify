import { NextRequest, NextResponse } from 'next/server';
import { sweepActivations } from '@/lib/sms/activation';

export const dynamic = 'force-dynamic';

/*
 * Cada ativação pode exigir uma ou duas chamadas ao provedor (getStatus e
 * setStatus), com timeout de 20s cada; o lote padrão com 5 em paralelo não
 * cabe nos 10s default da Vercel.
 */
export const maxDuration = 60;

const DEFAULT_LIMIT = 50;

/**
 * Varredura das ativações de SMS. Rodar a cada 5–15 minutos.
 *
 * Máquina-para-máquina: sem `auth()`, autenticado por Bearer CRON_SECRET, como
 * as demais rotas de app/api/cron. O que ela faz — vencer prazos com devolução,
 * fechar reservas obsoletas e sondar códigos de quem fechou a aba — é o mesmo
 * `syncActivation` do polling da tela; a pontualidade para quem está com a tela
 * aberta NÃO depende daqui.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  // Sem o segredo configurado, `Bearer undefined` seria um cabeçalho válido e
  // qualquer um poderia disparar o job. Falhar fechado é a única opção.
  if (!expected) {
    console.error('CRON_SECRET ausente: varredura de SMS desativada.');
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 });
  }

  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
  const startedAt = Date.now();

  try {
    const summary = await sweepActivations(limit);

    if (summary.checked > 0) {
      console.info(
        `Varredura de SMS: ${summary.checked} conferida(s), ${summary.expired} vencida(s), ${summary.codesReceived} código(s) recuperado(s).`,
      );
    }

    return NextResponse.json(
      { ...summary, durationMs: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro na varredura de ativações de SMS:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** `?limit=` é só uma alavanca de operação (a rota já exige o segredo). */
function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : DEFAULT_LIMIT;
}
