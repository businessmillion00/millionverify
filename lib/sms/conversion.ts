import { prisma } from '@/lib/prisma';
import { debitTokens, isLedgerError } from '@/lib/tokens/ledger';
import { creditSmsWallet } from '@/lib/sms/wallet';
import { recordAudit } from '@/lib/security/audit';
import { tokenLabel } from '@/lib/constants';
import {
  SMS_TOKENS_PER_SITE_TOKEN,
  conversionCents,
  parseConvertQuantity,
  smsTokenLabel,
} from '@/lib/sms/catalog';

/**
 * Conversão de tokens de site em tokens de SMS — o ÚNICO caminho pelo qual
 * tokens de SMS entram na conta (fora a devolução de número sem SMS).
 *
 * Os dois razões são movimentados na MESMA transação: o débito em
 * `lib/tokens/ledger.ts` e o crédito em `lib/sms/wallet.ts` travam a mesma
 * linha do usuário (FOR UPDATE, reentrante dentro da transação), então ou os
 * dois lados acontecem ou nenhum. Sem isso um processo morto no meio deixaria
 * o cliente sem token de site e sem token de SMS.
 *
 * Sentido único: token de SMS não volta a ser token de site.
 */

export type ConvertFailureCode = 'INSUFFICIENT_TOKENS' | 'INVALID_QUANTITY' | 'UNAVAILABLE';

export type ConvertTokensResult =
  | {
      success: true;
      tokens: number;
      smsCents: number;
      tokenBalance: number;
      smsBalanceCents: number;
    }
  | { success: false; code: ConvertFailureCode; error: string };

export async function convertTokensToSms(params: {
  userId: string;
  tokens: number;
}): Promise<ConvertTokensResult> {
  const tokens = parseConvertQuantity(params.tokens);

  if (tokens === null) {
    return { success: false, code: 'INVALID_QUANTITY', error: 'Quantidade inválida.' };
  }

  const smsCents = conversionCents(tokens);

  try {
    return await prisma.$transaction(async (tx) => {
      const debit = await debitTokens({
        tx,
        userId: params.userId,
        type: 'CONVERSION',
        amount: tokens,
        description: `Conversão em ${smsTokenLabel(smsCents)}`,
        metadata: { smsCents, rate: SMS_TOKENS_PER_SITE_TOKEN },
      });

      const credit = await creditSmsWallet({
        tx,
        type: 'CONVERSION',
        userId: params.userId,
        amountCents: smsCents,
        description: `Conversão de ${tokenLabel(tokens)} de site`,
        metadata: { tokens, rate: SMS_TOKENS_PER_SITE_TOKEN },
      });

      await recordAudit({
        tx,
        userId: params.userId,
        action: 'TOKENS_CONVERTED_TO_SMS',
        resource: 'sms',
        resourceId: params.userId,
        changes: {
          tokens,
          smsCents,
          tokenBalanceAfter: debit.balanceAfter,
          smsBalanceAfterCents: credit.balanceAfterCents,
        },
      });

      return {
        success: true,
        tokens,
        smsCents,
        tokenBalance: debit.balanceAfter,
        smsBalanceCents: credit.balanceAfterCents,
      };
    });
  } catch (error) {
    if (isLedgerError(error, 'INSUFFICIENT_TOKENS')) {
      return {
        success: false,
        code: 'INSUFFICIENT_TOKENS',
        error: `Você não tem ${tokenLabel(tokens)} de site para converter.`,
      };
    }
    throw error;
  }
}
