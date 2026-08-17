import { Prisma } from '@prisma/client';
import type { PaymentStatus, TokenTransactionType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Razão de tokens: ponto ÚNICO de entrada para qualquer movimento de saldo.
 *
 * Regras que valem para todas as funções deste arquivo:
 * - tudo acontece dentro de um `prisma.$transaction`;
 * - a trava de concorrência é sempre condicional no banco (`updateMany` com filtro
 *   de estado, ou `SELECT ... FOR UPDATE` no usuário), nunca uma checagem em memória;
 * - todo movimento gera um `TokenTransaction` com `balanceBefore`/`balanceAfter`
 *   coerentes e um `AuditLog`;
 * - `TokenTransaction.amount` é SEMPRE positivo — a direção vem do `type`
 *   (PURCHASE/BONUS creditam, USAGE/REFUND debitam), como no resto do projeto.
 */

/** Quem originou o movimento. Vai para o metadata para permitir auditoria posterior. */
export type LedgerSource = 'webhook' | 'reconcile' | 'manual' | 'system';

export type LedgerErrorCode =
  | 'INSUFFICIENT_TOKENS'
  | 'ALREADY_CREDITED'
  | 'ALREADY_REFUNDED'
  | 'PAYMENT_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'INVALID_AMOUNT';

/** Erro nomeado do razão — permite `catch` por código em vez de comparar strings soltas. */
export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export function isLedgerError(error: unknown, code?: LedgerErrorCode): error is LedgerError {
  return error instanceof LedgerError && (code === undefined || error.code === code);
}

/** Tipos que somam saldo. Os demais (USAGE, REFUND) subtraem. */
const CREDIT_TYPES: readonly TokenTransactionType[] = ['PURCHASE', 'BONUS'];

export function isCreditType(type: TokenTransactionType): boolean {
  return CREDIT_TYPES.includes(type);
}

/**
 * Estados a partir dos quais um pagamento ainda pode ser creditado.
 * FAILED entra na lista de propósito: um PAYMENT_OVERDUE rebaixa a cobrança para
 * FAILED e o cliente ainda pode pagá-la depois. Se o crédito só aceitasse PENDING,
 * esse pagamento entraria e nunca viraria tokens. A exatidão continua garantida
 * porque CONFIRMED/REFUNDED estão fora do conjunto: só uma transação consegue
 * tirar a linha de dentro dele.
 */
const CREDITABLE_STATUSES: readonly PaymentStatus[] = ['PENDING', 'FAILED'];

/** `Payment.amount` é Float no schema: comparação de dinheiro sempre com tolerância. */
const VALUE_EPSILON = 0.01;

type LedgerClient = Prisma.TransactionClient;

async function inTransaction<T>(
  tx: LedgerClient | undefined,
  run: (client: LedgerClient) => Promise<T>,
): Promise<T> {
  if (tx) return run(tx);
  return prisma.$transaction(run);
}

/**
 * Trava a linha do usuário até o fim da transação e devolve o saldo atual.
 *
 * Sem o `FOR UPDATE`, `balanceBefore`/`balanceAfter` saem mentirosos: em READ
 * COMMITTED outra transação pode confirmar uma alteração de saldo entre o nosso
 * UPDATE e a leitura de conferência, e o razão passa a registrar um histórico que
 * nunca existiu. Com a linha travada, a aritmética em memória é exata.
 *
 * O SQL é cru porque o Prisma não expõe bloqueio pessimista. Os identificadores
 * seguem o schema atual, que não usa `@@map`/`@map`: renomear tabela ou coluna
 * exige atualizar esta consulta junto.
 */
async function lockUserBalance(tx: LedgerClient, userId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ tokenBalance: number }>>`
    SELECT "tokenBalance" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;

  return rows.length > 0 ? rows[0].tokenBalance : null;
}

interface BalanceMovement {
  userId: string;
  type: TokenTransactionType;
  /** Sempre positivo. */
  amount: number;
  description: string;
  paymentId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface BalanceResult {
  balanceBefore: number;
  balanceAfter: number;
  /** Quanto de fato se moveu — só difere de `amount` em estorno com saldo insuficiente. */
  applied: number;
}

/**
 * Núcleo do razão: trava, move o saldo, grava o TokenTransaction.
 * `allowShortfall` só é usado em estorno — ver `refundPaymentTokens`.
 */
async function applyBalance(
  tx: LedgerClient,
  movement: BalanceMovement,
  options: { allowShortfall?: boolean } = {},
): Promise<BalanceResult> {
  if (!Number.isInteger(movement.amount) || movement.amount <= 0) {
    throw new LedgerError(
      'INVALID_AMOUNT',
      `Movimento de tokens inválido: ${movement.amount}`,
    );
  }

  const balanceBefore = await lockUserBalance(tx, movement.userId);

  if (balanceBefore === null) {
    throw new LedgerError('USER_NOT_FOUND', `Usuário ${movement.userId} não encontrado`);
  }

  const credit = isCreditType(movement.type);
  let applied = movement.amount;

  if (!credit && balanceBefore < movement.amount) {
    if (!options.allowShortfall) {
      throw new LedgerError(
        'INSUFFICIENT_TOKENS',
        `Saldo de ${balanceBefore} token(s) é insuficiente para debitar ${movement.amount}`,
      );
    }
    applied = balanceBefore;
  }

  const balanceAfter = credit ? balanceBefore + applied : balanceBefore - applied;

  if (applied > 0) {
    await tx.user.update({
      where: { id: movement.userId },
      data: {
        tokenBalance: credit ? { increment: applied } : { decrement: applied },
      },
    });
  }

  // Mesmo um movimento zerado vira registro: o razão precisa mostrar que o estorno
  // foi processado e que não havia nada a retirar.
  await tx.tokenTransaction.create({
    data: {
      userId: movement.userId,
      paymentId: movement.paymentId,
      type: movement.type,
      amount: applied,
      description: movement.description,
      balanceBefore,
      balanceAfter,
      metadata: movement.metadata,
    },
  });

  return { balanceBefore, balanceAfter, applied };
}

// ============ CRÉDITO DE PAGAMENTO ============

export interface CreditPaymentParams {
  /** `Payment.id` interno — nunca o id do Asaas. */
  paymentId: string;
  source: LedgerSource;
  /** Status cru devolvido pelo Asaas, gravado como está em `Payment.asaasStatus`. */
  asaasStatus?: string | null;
  /** Preenche `Payment.asaasPaymentId` quando a cobrança foi reencontrada por externalReference. */
  asaasPaymentId?: string | null;
  paidAt?: Date | null;
  /** Valor efetivamente pago, para conferir contra `Payment.amount`. */
  paidValue?: number | null;
}

export type CreditSkipReason = 'ALREADY_CREDITED' | 'PAYMENT_NOT_FOUND' | 'VALUE_MISMATCH';

export type CreditPaymentResult =
  | {
      credited: true;
      paymentId: string;
      userId: string;
      tokens: number;
      balanceBefore: number;
      balanceAfter: number;
    }
  | { credited: false; reason: CreditSkipReason };

/**
 * Credita os tokens de um pagamento exatamente uma vez.
 *
 * A trava de idempotência é o `updateMany` condicional: apenas a transação que
 * conseguir mover o pagamento para fora de `CREDITABLE_STATUSES` credita.
 * `count === 0` significa reentrega do Asaas ou corrida com o reconciliador —
 * é comportamento normal, não erro, e não gera log de erro.
 */
export async function creditPaymentTokens(
  params: CreditPaymentParams,
): Promise<CreditPaymentResult> {
  return prisma.$transaction(async (tx): Promise<CreditPaymentResult> => {
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      select: {
        id: true,
        userId: true,
        status: true,
        amount: true,
        tokensGranted: true,
        asaasPaymentId: true,
      },
    });

    if (!payment) {
      return { credited: false, reason: 'PAYMENT_NOT_FOUND' };
    }

    if (!CREDITABLE_STATUSES.includes(payment.status)) {
      return { credited: false, reason: 'ALREADY_CREDITED' };
    }

    if (
      params.paidValue != null &&
      Math.abs(params.paidValue - payment.amount) > VALUE_EPSILON
    ) {
      // Pagamento parcial ou payload adulterado: não credita nada e deixa a
      // cobrança PENDING para conferência manual.
      const message = `Valor divergente: esperado ${payment.amount}, recebido ${params.paidValue}`;

      await tx.payment.update({
        where: { id: payment.id },
        data: { errorLog: message, lastAttemptAt: new Date() },
      });

      // A cobrança segue PENDING, então o reconciliador volta a encontrá-la a cada
      // execução. Um AuditLog por pagamento basta: a mensagem viva fica no errorLog.
      const alreadyLogged = await tx.auditLog.findFirst({
        where: { action: 'PAYMENT_VALUE_MISMATCH', resourceId: payment.id },
        select: { id: true },
      });

      if (!alreadyLogged) {
        await tx.auditLog.create({
          data: {
            userId: payment.userId,
            action: 'PAYMENT_VALUE_MISMATCH',
            resource: 'payment',
            resourceId: payment.id,
            changes: {
              expectedAmount: payment.amount,
              receivedAmount: params.paidValue,
              source: params.source,
            },
            status: 'error',
            errorMessage: message,
          },
        });
      }

      return { credited: false, reason: 'VALUE_MISMATCH' };
    }

    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: [...CREDITABLE_STATUSES] } },
      data: {
        status: 'CONFIRMED',
        asaasStatus: params.asaasStatus ?? 'CONFIRMED',
        paidAt: params.paidAt ?? new Date(),
        lastAttemptAt: new Date(),
        errorLog: null,
        // Só grava quando falta: `asaasPaymentId` é @unique e sobrescrever um id
        // existente derrubaria a transação inteira.
        ...(params.asaasPaymentId && !payment.asaasPaymentId
          ? { asaasPaymentId: params.asaasPaymentId }
          : {}),
      },
    });

    if (count === 0) {
      return { credited: false, reason: 'ALREADY_CREDITED' };
    }

    const { balanceBefore, balanceAfter } = await applyBalance(tx, {
      userId: payment.userId,
      type: 'PURCHASE',
      amount: payment.tokensGranted,
      description: `Compra de ${payment.tokensGranted} tokens`,
      paymentId: payment.id,
      metadata: {
        asaasPaymentId: params.asaasPaymentId ?? payment.asaasPaymentId,
        paymentMethod: 'PIX',
        value: payment.amount,
        source: params.source,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: payment.userId,
        action: 'PAYMENT_RECEIVED',
        resource: 'payment',
        resourceId: payment.id,
        changes: {
          tokensAdded: payment.tokensGranted,
          newBalance: balanceAfter,
          source: params.source,
        },
        status: 'success',
      },
    });

    return {
      credited: true,
      paymentId: payment.id,
      userId: payment.userId,
      tokens: payment.tokensGranted,
      balanceBefore,
      balanceAfter,
    };
  });
}

// ============ ESTORNO DE PAGAMENTO ============

export interface RefundPaymentParams {
  paymentId: string;
  source: LedgerSource;
  asaasStatus?: string | null;
  /** Motivo legível, gravado na auditoria. */
  reason?: string;
}

export type RefundSkipReason = 'ALREADY_REFUNDED' | 'PAYMENT_NOT_FOUND' | 'NOT_CREDITED';

export type RefundPaymentResult =
  | {
      refunded: true;
      paymentId: string;
      userId: string;
      tokensReverted: number;
      /** Tokens que já haviam sido gastos e não puderam ser retirados. */
      shortfall: number;
      balanceBefore: number;
      balanceAfter: number;
    }
  | { refunded: false; reason: RefundSkipReason };

/**
 * Reverte os tokens de um pagamento estornado, exatamente uma vez.
 * Simétrica ao crédito: a trava é o `updateMany` de CONFIRMED -> REFUNDED.
 */
export async function refundPaymentTokens(
  params: RefundPaymentParams,
): Promise<RefundPaymentResult> {
  return prisma.$transaction(async (tx): Promise<RefundPaymentResult> => {
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      select: {
        id: true,
        userId: true,
        status: true,
        amount: true,
        tokensGranted: true,
        asaasPaymentId: true,
      },
    });

    if (!payment) {
      return { refunded: false, reason: 'PAYMENT_NOT_FOUND' };
    }

    if (payment.status === 'REFUNDED') {
      return { refunded: false, reason: 'ALREADY_REFUNDED' };
    }

    if (payment.status !== 'CONFIRMED') {
      // Estorno de cobrança que nunca creditou: marca o pagamento e não toca no
      // saldo — debitar aqui tiraria tokens que este pagamento nunca deu.
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'REFUNDED',
          asaasStatus: params.asaasStatus ?? 'REFUNDED',
          lastAttemptAt: new Date(),
        },
      });

      if (count === 0) {
        return { refunded: false, reason: 'ALREADY_REFUNDED' };
      }

      await tx.auditLog.create({
        data: {
          userId: payment.userId,
          action: 'PAYMENT_REFUNDED',
          resource: 'payment',
          resourceId: payment.id,
          changes: {
            tokensReverted: 0,
            note: 'Cobrança estornada sem crédito prévio de tokens',
            source: params.source,
            reason: params.reason ?? null,
          },
          status: 'success',
        },
      });

      return { refunded: false, reason: 'NOT_CREDITED' };
    }

    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: 'CONFIRMED' },
      data: {
        status: 'REFUNDED',
        asaasStatus: params.asaasStatus ?? 'REFUNDED',
        lastAttemptAt: new Date(),
      },
    });

    if (count === 0) {
      return { refunded: false, reason: 'ALREADY_REFUNDED' };
    }

    // O usuário pode já ter gasto os tokens comprados. Saldo negativo é pior que
    // déficit: quebraria toda trava `gte` do projeto e permitiria consumo com
    // saldo "menos alguma coisa". Retiramos o que existe, registramos o déficit
    // e deixamos a cobrança para o financeiro.
    const { balanceBefore, balanceAfter, applied } = await applyBalance(
      tx,
      {
        userId: payment.userId,
        type: 'REFUND',
        amount: payment.tokensGranted,
        description: `Estorno de ${payment.tokensGranted} tokens`,
        paymentId: payment.id,
        metadata: {
          asaasPaymentId: payment.asaasPaymentId,
          value: payment.amount,
          source: params.source,
        },
      },
      { allowShortfall: true },
    );

    const shortfall = payment.tokensGranted - applied;

    await tx.auditLog.create({
      data: {
        userId: payment.userId,
        action: 'PAYMENT_REFUNDED',
        resource: 'payment',
        resourceId: payment.id,
        changes: {
          tokensReverted: applied,
          shortfall,
          newBalance: balanceAfter,
          source: params.source,
          reason: params.reason ?? null,
        },
        status: 'success',
      },
    });

    if (shortfall > 0) {
      await tx.auditLog.create({
        data: {
          userId: payment.userId,
          action: 'PAYMENT_REFUND_SHORTFALL',
          resource: 'payment',
          resourceId: payment.id,
          changes: { expected: payment.tokensGranted, reverted: applied, shortfall },
          status: 'error',
          errorMessage: `Estorno de ${payment.tokensGranted} tokens com saldo de apenas ${balanceBefore}: ${shortfall} token(s) já consumidos não puderam ser retirados`,
        },
      });
    }

    return {
      refunded: true,
      paymentId: payment.id,
      userId: payment.userId,
      tokensReverted: applied,
      shortfall,
      balanceBefore,
      balanceAfter,
    };
  });
}

// ============ ENCERRAMENTO DE COBRANÇA SEM CRÉDITO ============

export interface FailPaymentParams {
  paymentId: string;
  source: LedgerSource;
  asaasStatus?: string | null;
  /** Vai para `Payment.errorLog` e para a auditoria. */
  reason: string;
}

/**
 * Marca uma cobrança PENDING como FAILED. Não move saldo.
 *
 * O filtro `status: 'PENDING'` é obrigatório: sem ele um PAYMENT_OVERDUE atrasado
 * ou reentregue rebaixa um pagamento já CONFIRMED, os tokens creditados continuam
 * no saldo e o faturamento do painel admin passa a contar a menos.
 */
export async function failPendingPayment(
  params: FailPaymentParams,
): Promise<{ failed: boolean }> {
  return prisma.$transaction(async (tx): Promise<{ failed: boolean }> => {
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      select: { id: true, userId: true },
    });

    if (!payment) return { failed: false };

    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        asaasStatus: params.asaasStatus ?? 'OVERDUE',
        errorLog: params.reason,
        lastAttemptAt: new Date(),
      },
    });

    if (count === 0) return { failed: false };

    await tx.auditLog.create({
      data: {
        userId: payment.userId,
        action: 'PAYMENT_FAILED',
        resource: 'payment',
        resourceId: payment.id,
        changes: { reason: params.reason, source: params.source },
        status: 'success',
      },
    });

    return { failed: true };
  });
}

// ============ MOVIMENTOS AVULSOS ============

export interface ManualMovementParams {
  userId: string;
  /** Positivo e inteiro. */
  amount: number;
  description: string;
  paymentId?: string;
  metadata?: Prisma.InputJsonValue;
  /** Auditoria opcional — omitir só em movimentos já auditados pelo chamador. */
  audit?: {
    /** SNAKE_CASE MAIÚSCULO, como o resto do projeto. */
    action: string;
    resource: string;
    resourceId: string;
    /** Autor do movimento; por padrão o próprio usuário afetado. */
    actorId?: string;
  };
  /** Transação em curso, para compor com outras escritas do chamador. */
  tx?: Prisma.TransactionClient;
}

async function recordMovement(
  params: ManualMovementParams & { type: TokenTransactionType },
): Promise<BalanceResult> {
  return inTransaction(params.tx, async (tx) => {
    const result = await applyBalance(tx, {
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      description: params.description,
      paymentId: params.paymentId,
      metadata: params.metadata,
    });

    if (params.audit) {
      await tx.auditLog.create({
        data: {
          userId: params.audit.actorId ?? params.userId,
          action: params.audit.action,
          resource: params.audit.resource,
          resourceId: params.audit.resourceId,
          changes: {
            type: params.type,
            amount: params.amount,
            balanceAfter: result.balanceAfter,
          },
          status: 'success',
        },
      });
    }

    return result;
  });
}

/**
 * Debita tokens com trava de concorrência. Lança `LedgerError('INSUFFICIENT_TOKENS')`
 * se o saldo não cobrir o valor — a checagem é feita com a linha do usuário travada,
 * então duas requisições simultâneas nunca conseguem gastar o mesmo token.
 */
export async function debitTokens(
  params: ManualMovementParams & { type?: Extract<TokenTransactionType, 'USAGE' | 'REFUND'> },
): Promise<BalanceResult> {
  return recordMovement({ ...params, type: params.type ?? 'USAGE' });
}

/** Credita tokens fora de um pagamento (bônus, cortesia, ajuste manual). */
export async function grantTokens(
  params: ManualMovementParams & { type?: Extract<TokenTransactionType, 'BONUS' | 'PURCHASE'> },
): Promise<BalanceResult> {
  return recordMovement({ ...params, type: params.type ?? 'BONUS' });
}
