import { NextRequest, NextResponse } from 'next/server';
import { MONITOR_BATCH_SIZE, monitorSites } from '@/lib/verification/monitor';

export const dynamic = 'force-dynamic';

/**
 * Rediagnóstico periódico da verificação de domínio da Meta. Rodar a cada 15–60 minutos.
 *
 * Máquina-para-máquina: sem `auth()`, autenticado por Bearer CRON_SECRET — igual a
 * app/api/cron/reconcile-payments/route.ts.
 *
 * A rota é deliberadamente fina: quem seleciona o lote, controla a concorrência, grava
 * o diagnóstico e detecta regressão é `lib/verification/monitor.ts`. Assim a lógica é
 * testável sem simular uma requisição HTTP e sem um CRON_SECRET de mentira.
 *
 * O contrato de resposta `{ checked, verified }` foi PRESERVADO: é o que o monitoramento
 * externo do job já lê. Os demais campos são acréscimos aditivos.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  // Sem o segredo configurado, `Bearer undefined` seria um cabeçalho válido e qualquer
  // um poderia disparar o job. Falhar fechado é a única opção.
  if (!expected) {
    console.error('CRON_SECRET ausente: rota de verificação de domínio desativada.');
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 });
  }

  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
  const startedAt = Date.now();

  try {
    const summary = await monitorSites(limit);

    if (summary.regressed > 0) {
      // Cada regressão já virou AuditLog; o console é o canal que o operador enxerga
      // primeiro quando várias caem de uma vez (indício de problema nosso, não do cliente).
      console.warn(
        `Verificação de domínio perdida em ${summary.regressed} site(s) nesta rodada.`,
      );
    }

    return NextResponse.json(
      { ...summary, durationMs: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro na verificação periódica de domínio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** `?limit=` é só uma alavanca de operação (a rota já exige o segredo); `monitorSites` reclampa. */
function parseLimit(raw: string | null): number {
  if (!raw) return MONITOR_BATCH_SIZE;

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : MONITOR_BATCH_SIZE;
}
