import type { Prisma, SmsWalletTransactionType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Tokens de SMS: o razão do segundo tipo de token.
 *
 * Unidade interna: CENTAVOS de token (100 = 1 token SMS = R$ 1). Os preços
 * têm meio token (Instagram custa 1,5), então inteiro em centavos é o que
 * mantém a trava `>=` exata. O saldo só entra por conversão de tokens de site
 * (lib/sms/conversion.ts) ou por devolução de número sem SMS — nunca por PIX.
 *
 * Mesmas regras de lib/tokens/ledger.ts, que é o modelo desta implementação:
 * - tudo dentro de `prisma.$transaction`;
 * - a trava é o `SELECT ... FOR UPDATE` na linha do usuário, nunca checagem
 *   em memória;
 * - todo movimento gera um `SmsWalletTransaction` com before/after coerentes;
 * - `amountCents` é SEMPRE positivo — a direção vem do `type`.
 *
 * Vive em arquivo próprio para a conversão importar os dois razões sem
 * importação circular.
 */

export type SmsWalletErrorCode = 'INSUFFICIENT_SMS_BALANCE' | 'USER_NOT_FOUND' | 'INVALID_AMOUNT';

export class SmsWalletError extends Error {
  readonly code: SmsWalletErrorCode;

  constructor(code: SmsWalletErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SmsWalletError';
    this.code = code;
  }
}

export function isSmsWalletError(
  error: unknown,
  code?: SmsWalletErrorCode,
): error is SmsWalletError {
  return error instanceof SmsWalletError && (code === undefined || error.code === code);
}

/** Tipos que somam saldo. O restante (PURCHASE) subtrai. */
const CREDIT_TYPES: readonly SmsWalletTransactionType[] = ['CONVERSION', 'REFUND'];

export function isSmsCreditType(type: SmsWalletTransactionType): boolean {
  return CREDIT_TYPES.includes(type);
}

type Client = Prisma.TransactionClient;

/**
 * Trava a linha do usuário até o fim da transação e devolve o saldo atual em
 * centavos. SQL cru pelo mesmo motivo de `lockUserBalance` no ledger de tokens:
 * o Prisma não expõe bloqueio pessimista. Renomear tabela/coluna exige
 * atualizar esta consulta.
 */
async function lockSmsBalance(tx: Client, userId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ smsBalanceCents: number }>>`
    SELECT "smsBalanceCents" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;

  return rows.length > 0 ? rows[0].smsBalanceCents : null;
}

export interface SmsWalletMovement {
  userId: string;
  type: SmsWalletTransactionType;
  /** Sempre positivo, em centavos de token. */
  amountCents: number;
  description: string;
  activationId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface SmsWalletResult {
  balanceBeforeCents: number;
  balanceAfterCents: number;
  /** Quanto de fato se moveu — só difere de `amountCents` em débito com `allowShortfall`. */
  appliedCents: number;
}

/** Núcleo: trava, move o saldo, grava o SmsWalletTransaction. */
export async function applySmsWallet(
  tx: Client,
  movement: SmsWalletMovement,
  options: { allowShortfall?: boolean } = {},
): Promise<SmsWalletResult> {
  if (!Number.isInteger(movement.amountCents) || movement.amountCents <= 0) {
    throw new SmsWalletError(
      'INVALID_AMOUNT',
      `Movimento de tokens de SMS inválido: ${movement.amountCents}`,
    );
  }

  const balanceBeforeCents = await lockSmsBalance(tx, movement.userId);

  if (balanceBeforeCents === null) {
    throw new SmsWalletError('USER_NOT_FOUND', `Usuário ${movement.userId} não encontrado`);
  }

  const credit = isSmsCreditType(movement.type);
  let appliedCents = movement.amountCents;

  if (!credit && balanceBeforeCents < movement.amountCents) {
    if (!options.allowShortfall) {
      throw new SmsWalletError(
        'INSUFFICIENT_SMS_BALANCE',
        `Saldo de ${balanceBeforeCents} centavos de token é insuficiente para debitar ${movement.amountCents}`,
      );
    }
    appliedCents = balanceBeforeCents;
  }

  const balanceAfterCents = credit
    ? balanceBeforeCents + appliedCents
    : balanceBeforeCents - appliedCents;

  if (appliedCents > 0) {
    await tx.user.update({
      where: { id: movement.userId },
      data: {
        smsBalanceCents: credit ? { increment: appliedCents } : { decrement: appliedCents },
      },
    });
  }

  // Movimento zerado também vira registro: o razão precisa mostrar que o
  // estorno foi processado e que não havia nada a retirar.
  await tx.smsWalletTransaction.create({
    data: {
      userId: movement.userId,
      type: movement.type,
      amountCents: appliedCents,
      description: movement.description,
      activationId: movement.activationId,
      balanceBeforeCents,
      balanceAfterCents,
      metadata: movement.metadata,
    },
  });

  return { balanceBeforeCents, balanceAfterCents, appliedCents };
}

type StandaloneMovement = Omit<SmsWalletMovement, 'type'> & {
  /** Transação em curso, para compor com outras escritas do chamador. */
  tx?: Client;
};

async function inTransaction<T>(
  tx: Client | undefined,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  if (tx) return run(tx);
  return prisma.$transaction(run);
}

/**
 * Debita tokens de SMS com trava de concorrência. Lança
 * `SmsWalletError('INSUFFICIENT_SMS_BALANCE')` se o saldo não cobrir o valor —
 * a checagem acontece com a linha travada, então duas compras simultâneas nunca
 * gastam o mesmo token.
 */
export async function debitSmsWallet(params: StandaloneMovement): Promise<SmsWalletResult> {
  const { tx, ...movement } = params;
  return inTransaction(tx, (client) => applySmsWallet(client, { ...movement, type: 'PURCHASE' }));
}

/** Credita tokens de SMS: conversão de tokens de site ou devolução de número sem SMS. */
export async function creditSmsWallet(
  params: StandaloneMovement & { type: Extract<SmsWalletTransactionType, 'CONVERSION' | 'REFUND'> },
): Promise<SmsWalletResult> {
  const { tx, type, ...movement } = params;
  return inTransaction(tx, (client) => applySmsWallet(client, { ...movement, type }));
}
