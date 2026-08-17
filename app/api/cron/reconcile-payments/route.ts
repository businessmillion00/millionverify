import { NextRequest, NextResponse } from 'next/server';
import {
  auditLedgerIntegrity,
  expireOrphanPayments,
  reconcileConfirmedPayments,
  reconcilePendingPayments,
} from '@/lib/tokens/reconcile';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;
const REFUND_SWEEP_SIZE = 25;
const INTEGRITY_SAMPLE = 100;

/**
 * Rede de proteção do razão. Rodar a cada 5–15 minutos.
 * Máquina-para-máquina: sem `auth()`, autenticado por Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  // Sem o segredo configurado, `Bearer undefined` seria um cabeçalho válido e
  // qualquer um poderia disparar o job. Falhar fechado é a única opção.
  if (!expected) {
    console.error('CRON_SECRET ausente: rota de reconciliação desativada.');
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 });
  }

  const secret = request.headers.get('authorization');

  if (secret !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Sequencial de propósito: os dois primeiros passos consultam o Asaas e não
    // faz sentido competir por conexão HTTP e por linha de Payment ao mesmo tempo.
    const pending = await reconcilePendingPayments(BATCH_SIZE);
    const confirmed = await reconcileConfirmedPayments(REFUND_SWEEP_SIZE);
    const orphansExpired = await expireOrphanPayments();
    const integrity = await auditLedgerIntegrity(INTEGRITY_SAMPLE);

    if (integrity.divergences.length > 0) {
      console.error(
        `Divergência entre saldo e razão em ${integrity.divergences.length} conta(s):`,
        integrity.divergences,
      );
    }

    return NextResponse.json(
      {
        checked: pending.checked + confirmed.checked,
        credited: pending.credited + confirmed.credited,
        refunded: pending.refunded + confirmed.refunded,
        failed: pending.failed + confirmed.failed,
        mismatches: pending.mismatches + confirmed.mismatches,
        errors: pending.errors + confirmed.errors,
        orphansExpired,
        ledger: {
          checked: integrity.checked,
          explainedByWelcomeBonus: integrity.explainedByWelcomeBonus,
          divergences: integrity.divergences,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro na reconciliação de pagamentos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
