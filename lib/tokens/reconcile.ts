import { prisma } from '@/lib/prisma';
import { asaasService } from '@/services/asaas';
import {
  creditPaymentTokens,
  failPendingPayment,
  isCreditType,
  refundPaymentTokens,
} from '@/lib/tokens/ledger';

/**
 * Reconciliação de pagamentos: rede de proteção para webhook perdido, descartado
 * por rate limit ou entregue enquanto o processo estava fora do ar.
 *
 * Tudo aqui é idempotente por construção porque nada move saldo diretamente —
 * todo crédito/estorno passa pelas travas condicionais de `lib/tokens/ledger.ts`.
 * Uma corrida entre o webhook e este job termina com um dos dois recebendo
 * `count === 0` e não creditando.
 */

/** Status do Asaas em que o dinheiro entrou. */
const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

/** Status em que a cobrança morreu sem pagamento. */
const LOST_STATUSES = new Set(['OVERDUE', 'DELETED', 'CANCELLED', 'EXPIRED']);

/** Status em que o dinheiro voltou (ou está sendo retirado) do nosso lado. */
const REFUNDED_STATUSES = new Set([
  'REFUNDED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

/**
 * Bônus de boas-vindas creditado por `registerUser` direto em `User.tokenBalance`,
 * sem `TokenTransaction` correspondente. Sem tratar esse caso, o relatório de
 * integridade acusaria divergência em praticamente toda conta do fluxo normal.
 */
export const WELCOME_BONUS_TOKENS = 100;

export interface ReconcileSummary {
  checked: number;
  credited: number;
  refunded: number;
  failed: number;
  mismatches: number;
  unchanged: number;
  errors: number;
}

type SyncOutcome = 'credited' | 'refunded' | 'failed' | 'mismatch' | 'unchanged' | 'error';

interface ReconcilablePayment {
  id: string;
  asaasPaymentId: string;
}

const emptySummary = (): ReconcileSummary => ({
  checked: 0,
  credited: 0,
  refunded: 0,
  failed: 0,
  mismatches: 0,
  unchanged: 0,
  errors: 0,
});

/**
 * Registra a tentativa. `errorLog` só é tocado quando há mensagem nova: o
 * `failPendingPayment` grava o motivo lá e não pode ser sobrescrito por este
 * carimbo. `lastAttemptAt` é o que rotaciona a fila entre execuções do cron.
 */
async function touchAttempt(paymentId: string, errorLog?: string): Promise<void> {
  try {
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        ...(errorLog === undefined ? {} : { errorLog }),
      },
    });
  } catch (error) {
    console.error(`Falha ao registrar tentativa do pagamento ${paymentId}:`, error);
  }
}

async function syncWithAsaas(payment: ReconcilablePayment): Promise<SyncOutcome> {
  let remoteStatus: string;
  let remoteValue: number | null;

  try {
    // A chamada HTTP fica FORA de qualquer transação: `$transaction` interativo
    // expira em 5s e prender a conexão do banco esperando o Asaas é receita de
    // deadlock no pico.
    const remote = await asaasService.getPayment(payment.asaasPaymentId);
    remoteStatus = String(remote.status ?? '').toUpperCase();
    remoteValue = typeof remote.value === 'number' ? remote.value : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar o Asaas';
    await touchAttempt(payment.id, message);
    return 'error';
  }

  try {
    if (PAID_STATUSES.has(remoteStatus)) {
      const result = await creditPaymentTokens({
        paymentId: payment.id,
        source: 'reconcile',
        asaasStatus: remoteStatus,
        asaasPaymentId: payment.asaasPaymentId,
        paidValue: remoteValue,
      });

      await touchAttempt(payment.id);

      if (result.credited) return 'credited';
      return result.reason === 'VALUE_MISMATCH' ? 'mismatch' : 'unchanged';
    }

    if (REFUNDED_STATUSES.has(remoteStatus)) {
      const result = await refundPaymentTokens({
        paymentId: payment.id,
        source: 'reconcile',
        asaasStatus: remoteStatus,
        reason: `Status ${remoteStatus} encontrado na reconciliação`,
      });

      await touchAttempt(payment.id);
      return result.refunded ? 'refunded' : 'unchanged';
    }

    if (LOST_STATUSES.has(remoteStatus)) {
      const { failed } = await failPendingPayment({
        paymentId: payment.id,
        source: 'reconcile',
        asaasStatus: remoteStatus,
        reason: `Cobrança encerrada no Asaas com status ${remoteStatus}`,
      });

      // `failPendingPayment` já gravou o motivo em errorLog; aqui só carimbamos.
      await touchAttempt(payment.id);
      return failed ? 'failed' : 'unchanged';
    }

    // PENDING, AWAITING_RISK_ANALYSIS e afins: nada a fazer, só rotaciona a fila.
    await touchAttempt(payment.id);
    return 'unchanged';
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Falha ao reconciliar pagamento';
    console.error(`Erro ao reconciliar pagamento ${payment.id}:`, error);
    await touchAttempt(payment.id, message);
    return 'error';
  }
}

/** Processa em lotes pequenos para não abrir 50 conexões HTTP simultâneas no Asaas. */
async function mapInChunks<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += size) {
    const chunk = items.slice(index, index + size);
    results.push(...(await Promise.all(chunk.map(run))));
  }

  return results;
}

const CONCURRENCY = 5;

function tally(outcomes: readonly SyncOutcome[]): ReconcileSummary {
  const summary = emptySummary();
  summary.checked = outcomes.length;

  for (const outcome of outcomes) {
    switch (outcome) {
      case 'credited':
        summary.credited++;
        break;
      case 'refunded':
        summary.refunded++;
        break;
      case 'failed':
        summary.failed++;
        break;
      case 'mismatch':
        summary.mismatches++;
        break;
      case 'error':
        summary.errors++;
        break;
      default:
        summary.unchanged++;
    }
  }

  return summary;
}

/**
 * Confere no Asaas os pagamentos que continuam PENDING depois de algum tempo.
 * `olderThanMinutes` evita consultar cobranças recém-criadas, que ainda estão
 * legitimamente em aberto na tela do usuário.
 */
export async function reconcilePendingPayments(
  limit = 50,
  olderThanMinutes = 10,
): Promise<ReconcileSummary> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000);

  const rows = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      asaasPaymentId: { not: null },
      createdAt: { lt: cutoff },
    },
    orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { id: true, asaasPaymentId: true },
  });

  const payments = rows.filter(
    (row): row is ReconcilablePayment => row.asaasPaymentId !== null,
  );

  const outcomes = await mapInChunks(payments, CONCURRENCY, syncWithAsaas);
  return tally(outcomes);
}

/**
 * Varredura de estornos: um PAYMENT_REFUNDED perdido deixaria os tokens creditados
 * para sempre. Olha apenas os pagamentos confirmados na janela recente, em lotes
 * pequenos, rotacionando por `lastAttemptAt`.
 */
export async function reconcileConfirmedPayments(
  limit = 25,
  windowDays = 30,
): Promise<ReconcileSummary> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60000);

  const rows = await prisma.payment.findMany({
    where: {
      status: 'CONFIRMED',
      asaasPaymentId: { not: null },
      paidAt: { gte: cutoff },
    },
    orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { id: true, asaasPaymentId: true },
  });

  const payments = rows.filter(
    (row): row is ReconcilablePayment => row.asaasPaymentId !== null,
  );

  const outcomes = await mapInChunks(payments, CONCURRENCY, syncWithAsaas);
  return tally(outcomes);
}

/**
 * Cobranças que nunca chegaram ao Asaas: `createPayment` grava o Payment antes de
 * chamar a API e, se o processo morrer no meio, sobra um PENDING sem
 * `asaasPaymentId` inflando "Em aberto" no painel admin para sempre.
 * Nenhum webhook pode chegar para elas — expirar é seguro.
 */
export async function expireOrphanPayments(
  olderThanMinutes = 30,
  limit = 100,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000);

  const orphans = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      asaasPaymentId: null,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const results = await Promise.all(
    orphans.map((orphan) =>
      failPendingPayment({
        paymentId: orphan.id,
        source: 'reconcile',
        asaasStatus: 'DELETED',
        reason: 'Cobrança nunca chegou ao Asaas',
      }),
    ),
  );

  return results.filter((result) => result.failed).length;
}

export interface LedgerDivergence {
  userId: string;
  email: string;
  tokenBalance: number;
  /** Saldo recalculado a partir do razão: PURCHASE + BONUS − USAGE − REFUND. */
  ledgerBalance: number;
  difference: number;
}

export interface LedgerIntegrityReport {
  checked: number;
  /** Contas cuja única divergência é o bônus de boas-vindas sem lançamento. */
  explainedByWelcomeBonus: number;
  divergences: LedgerDivergence[];
}

/**
 * Recalcula o saldo pelo razão e compara com `User.tokenBalance`.
 * SOMENTE LEITURA: divergência de saldo é sintoma, e corrigir automaticamente
 * esconderia a causa. Reporta para investigação manual.
 *
 * Amostra os usuários alterados mais recentemente — é onde uma corrida acabou de
 * acontecer, se aconteceu.
 */
export async function auditLedgerIntegrity(limit = 100): Promise<LedgerIntegrityReport> {
  const users = await prisma.user.findMany({
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, email: true, tokenBalance: true },
  });

  if (users.length === 0) {
    return { checked: 0, explainedByWelcomeBonus: 0, divergences: [] };
  }

  const grouped = await prisma.tokenTransaction.groupBy({
    by: ['userId', 'type'],
    where: { userId: { in: users.map((user) => user.id) } },
    _sum: { amount: true },
  });

  // `amount` é sempre positivo no projeto: sem olhar o `type`, a soma sai errada.
  const ledgerByUser = new Map<string, number>();

  for (const row of grouped) {
    const total = row._sum.amount ?? 0;
    const signed = isCreditType(row.type) ? total : -total;
    ledgerByUser.set(row.userId, (ledgerByUser.get(row.userId) ?? 0) + signed);
  }

  const divergences: LedgerDivergence[] = [];
  let explainedByWelcomeBonus = 0;

  for (const user of users) {
    const ledgerBalance = ledgerByUser.get(user.id) ?? 0;
    const difference = user.tokenBalance - ledgerBalance;

    if (difference === 0) continue;

    if (difference === WELCOME_BONUS_TOKENS) {
      explainedByWelcomeBonus++;
      continue;
    }

    divergences.push({
      userId: user.id,
      email: user.email,
      tokenBalance: user.tokenBalance,
      ledgerBalance,
      difference,
    });
  }

  return { checked: users.length, explainedByWelcomeBonus, divergences };
}
