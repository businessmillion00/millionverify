'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { rateLimitByName } from '@/lib/utils/rate-limit';
import { sms24hService } from '@/services/sms24h';
import {
  ConvertTokensSchema,
  RequestSmsNumberSchema,
  SmsActivationIdSchema,
} from '@/lib/validators/sms';
import { convertTokensToSms, type ConvertTokensResult } from '@/lib/sms/conversion';
import {
  cancelActivation,
  completeActivation,
  requestActivation,
  retryActivation,
  type ActivationView,
  type RequestFailureCode,
  type UserActionResult,
} from '@/lib/sms/activation';

/**
 * Actions da área de SMS. Autenticam, validam, limitam e delegam:
 * dinheiro e estado vivem em lib/sms/conversion.ts, lib/sms/activation.ts e
 * lib/sms/wallet.ts.
 */

type RequestNumberResult =
  | { success: true; activationId: string }
  | { success: false; error: string; code?: RequestFailureCode };

const revalidateSms = (activationId?: string): void => {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/tokens');
  revalidatePath('/dashboard/sms');
  if (activationId) revalidatePath(`/dashboard/sms/${activationId}`);
};

/** Troca tokens de site por tokens de SMS (1 → 25). Sentido único. */
export async function convertTokens(input: unknown): Promise<ConvertTokensResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, code: 'INVALID_QUANTITY', error: 'Não autenticado' };
    }

    const parsed = ConvertTokensSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        code: 'INVALID_QUANTITY',
        error: parsed.error.issues[0]?.message ?? 'Quantidade inválida',
      };
    }

    // A conversão é definitiva: sem provedor configurado ela viraria um saldo
    // que o usuário não consegue gastar.
    if (!sms24hService.isConfigured()) {
      return {
        success: false,
        code: 'UNAVAILABLE',
        error: 'Números para SMS indisponíveis no momento. A conversão fica pausada.',
      };
    }

    const limit = await rateLimitByName('sms:convert', session.user.id);
    if (!limit.success) {
      return {
        success: false,
        code: 'INVALID_QUANTITY',
        error: 'Muitas conversões em pouco tempo. Aguarde alguns minutos.',
      };
    }

    const result = await convertTokensToSms({
      userId: session.user.id,
      tokens: parsed.data.tokens,
    });

    if (result.success) revalidateSms();
    return result;
  } catch (error) {
    console.error('Erro ao converter tokens em tokens de SMS:', error);
    return {
      success: false,
      code: 'INVALID_QUANTITY',
      error: 'Não foi possível converter agora. Tente novamente.',
    };
  }
}

/** Compra um número para receber o SMS do serviço escolhido. */
export async function requestSmsNumber(input: unknown): Promise<RequestNumberResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = RequestSmsNumberSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Serviço inválido' };
    }

    if (!sms24hService.isConfigured()) {
      return { success: false, error: 'Números para SMS indisponíveis no momento.', code: 'UNAVAILABLE' };
    }

    const limit = await rateLimitByName('sms:request', session.user.id);
    if (!limit.success) {
      return { success: false, error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' };
    }

    const result = await requestActivation({
      userId: session.user.id,
      service: parsed.data.service,
    });

    revalidateSms(result.success ? result.activationId : undefined);

    return result.success
      ? { success: true, activationId: result.activationId }
      : { success: false, error: result.error, code: result.code };
  } catch (error) {
    console.error('Erro ao pedir número para SMS:', error);
    return { success: false, error: 'Não foi possível pedir o número agora. Tente novamente.' };
  }
}

type ManagedAction = (params: { activationId: string; userId: string }) => Promise<UserActionResult>;

async function manage(input: unknown, run: ManagedAction): Promise<UserActionResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = SmsActivationIdSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Ativação inválida' };
    }

    const limit = await rateLimitByName('sms:manage', session.user.id);
    if (!limit.success) {
      return { success: false, error: 'Muitas ações em pouco tempo. Aguarde um instante.' };
    }

    const result = await run({ activationId: parsed.data.activationId, userId: session.user.id });
    revalidateSms(parsed.data.activationId);
    return result;
  } catch (error) {
    console.error('Erro em ação de ativação de SMS:', error);
    return { success: false, error: 'Não foi possível concluir a ação agora.' };
  }
}

export async function cancelSmsActivation(input: unknown): Promise<UserActionResult> {
  return manage(input, cancelActivation);
}

export async function completeSmsActivation(input: unknown): Promise<UserActionResult> {
  return manage(input, completeActivation);
}

export async function retrySmsActivation(input: unknown): Promise<UserActionResult> {
  return manage(input, retryActivation);
}

export type { ActivationView };
