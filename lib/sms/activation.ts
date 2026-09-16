import type { Prisma, SmsActivationStatus, SmsService } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/security/audit';
import { isSms24hError, sms24hService, type Sms24hSetStatus } from '@/services/sms24h';
import { creditSmsWallet, debitSmsWallet, isSmsWalletError } from '@/lib/sms/wallet';
import {
  SMS_ACTIVATION_TTL_MS,
  SMS_MAX_OPEN_ACTIVATIONS,
  SMS_MAX_RETRIES,
  SMS_MIN_MARGIN,
  SMS_REQUESTING_STALE_MS,
  SMS_SERVICES,
  SMS_STATUS_MIN_INTERVAL_MS,
  formatSmsPhone,
} from '@/lib/sms/catalog';

/**
 * Ciclo de vida de uma ativação de SMS — o que fica entre a carteira do usuário
 * e o sms24h.
 *
 * O dinheiro só se move por aqui e sempre com trava condicional no banco
 * (`updateMany` filtrando o status de origem): duas abas, o cron e o webhook
 * podem chamar as mesmas funções ao mesmo tempo e só uma transação vence.
 *
 * Ordem dos passos na compra — RESERVA antes do PROVEDOR:
 *   1. debita a carteira e grava a ativação em REQUESTING, na mesma transação;
 *   2. fora de transação, cota e pede o número ao sms24h;
 *   3. confirma (WAITING_CODE) ou devolve o valor (FAILED).
 * Chamar o provedor com a transação aberta prenderia a conexão do banco
 * esperando HTTP; pedir o número antes de debitar entregaria número a quem
 * não pagou se o débito falhasse na sequência.
 *
 * Devolução: sem código recebido, o valor volta inteiro (CANCELLED, EXPIRED,
 * FAILED). Com código, o serviço foi prestado e nada volta — vale inclusive
 * para o número que expira depois de um "pedir outro SMS".
 *
 * Nenhuma função aqui autentica. Quem chama prova a posse antes (as actions
 * filtram por userId; o cron é máquina-para-máquina).
 */

export const OPEN_STATUSES: readonly SmsActivationStatus[] = [
  'REQUESTING',
  'WAITING_CODE',
  'CODE_RECEIVED',
];

const TERMINAL_STATUSES: readonly SmsActivationStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];

/** Motivos de FAILED gravados em `metadata.failureCode`; a tela traduz. */
type FailureCode = 'NO_NUMBERS' | 'NO_BALANCE' | 'MARGIN' | 'STALE' | 'PROVIDER';

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  NO_NUMBERS: 'Sem números disponíveis para este serviço no momento.',
  NO_BALANCE: 'Serviço temporariamente indisponível.',
  MARGIN: 'Serviço temporariamente indisponível.',
  STALE: 'O pedido não foi concluído. Os tokens voltaram para o seu saldo.',
  PROVIDER: 'O provedor não conseguiu entregar um número agora.',
};

// ============ VISÃO PARA A TELA ============

export type ActivationView = {
  id: string;
  service: SmsService;
  serviceLabel: string;
  status: SmsActivationStatus;
  /** Dígitos sem o DDI (o que se digita no app). */
  phoneLocal: string | null;
  /** "+5543999999999" */
  phoneInternational: string | null;
  /** "+55 (43) 99999-9999" */
  phoneDisplay: string | null;
  code: string | null;
  priceCents: number;
  refundedCents: number;
  retryCount: number;
  canRetry: boolean;
  createdAt: string;
  expiresAt: string;
  codeReceivedAt: string | null;
  /** Explicação legível quando FAILED. */
  failureMessage: string | null;
};

type ActivationRow = Prisma.SmsActivationGetPayload<{ select: typeof VIEW_SELECT }>;

const VIEW_SELECT = {
  id: true,
  userId: true,
  service: true,
  status: true,
  providerActivationId: true,
  phone: true,
  code: true,
  priceCents: true,
  refundedCents: true,
  retryCount: true,
  createdAt: true,
  expiresAt: true,
  codeReceivedAt: true,
  lastCheckedAt: true,
  metadata: true,
} satisfies Prisma.SmsActivationSelect;

function failureCodeOf(metadata: Prisma.JsonValue | null): FailureCode | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const code = (metadata as Record<string, unknown>).failureCode;
  return typeof code === 'string' && code in FAILURE_MESSAGES ? (code as FailureCode) : null;
}

export function toActivationView(row: ActivationRow): ActivationView {
  const phone = row.phone ? formatSmsPhone(row.phone) : null;
  const failureCode = row.status === 'FAILED' ? failureCodeOf(row.metadata) : null;

  return {
    id: row.id,
    service: row.service,
    serviceLabel: SMS_SERVICES[row.service].label,
    status: row.status,
    phoneLocal: phone?.local ?? null,
    phoneInternational: phone?.international ?? null,
    phoneDisplay: phone?.display ?? null,
    code: row.code,
    priceCents: row.priceCents,
    refundedCents: row.refundedCents,
    retryCount: row.retryCount,
    canRetry:
      row.status === 'CODE_RECEIVED' &&
      row.retryCount < SMS_MAX_RETRIES &&
      row.expiresAt.getTime() > Date.now(),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    codeReceivedAt: row.codeReceivedAt ? row.codeReceivedAt.toISOString() : null,
    failureMessage: failureCode ? FAILURE_MESSAGES[failureCode] : null,
  };
}

async function loadView(activationId: string): Promise<ActivationView | null> {
  const row = await prisma.smsActivation.findUnique({
    where: { id: activationId },
    select: VIEW_SELECT,
  });
  return row ? toActivationView(row) : null;
}

// ============ TRANSIÇÕES COM TRAVA ============

interface TransitionParams {
  activationId: string;
  from: readonly SmsActivationStatus[];
  to: Extract<SmsActivationStatus, 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'FAILED'>;
  reason: string;
  failureCode?: FailureCode;
}

/**
 * Encerra a ativação e, se nenhum código chegou, devolve o valor à carteira.
 * A trava é o `updateMany` filtrando o status de origem: reentrada (cron +
 * aba + ação do usuário) termina com `moved: false` e sem segundo estorno.
 */
async function transition(
  params: TransitionParams,
): Promise<{ moved: boolean; refundedCents: number }> {
  return prisma.$transaction(async (tx) => {
    const activation = await tx.smsActivation.findUnique({
      where: { id: params.activationId },
      select: {
        id: true,
        userId: true,
        service: true,
        status: true,
        priceCents: true,
        refundedCents: true,
        code: true,
        providerActivationId: true,
        metadata: true,
      },
    });

    if (!activation || !params.from.includes(activation.status)) {
      return { moved: false, refundedCents: 0 };
    }

    const refundable = activation.code === null && activation.refundedCents === 0;
    const now = new Date();
    const metadata =
      typeof activation.metadata === 'object' &&
      activation.metadata !== null &&
      !Array.isArray(activation.metadata)
        ? (activation.metadata as Prisma.JsonObject)
        : {};

    const { count } = await tx.smsActivation.updateMany({
      where: {
        id: activation.id,
        status: { in: [...params.from] },
        // `code: null` repetido aqui de propósito: o `refundable` foi lido
        // antes do UPDATE e um SMS pode ter chegado no meio.
        ...(refundable ? { code: null, refundedCents: 0 } : {}),
      },
      data: {
        status: params.to,
        errorLog: params.reason,
        lastCheckedAt: now,
        ...(params.to === 'COMPLETED' ? { completedAt: now } : { cancelledAt: now }),
        ...(refundable ? { refundedCents: activation.priceCents } : {}),
        ...(params.failureCode
          ? { metadata: { ...metadata, failureCode: params.failureCode } }
          : {}),
      },
    });

    if (count === 0) {
      return { moved: false, refundedCents: 0 };
    }

    const label = SMS_SERVICES[activation.service].label;

    if (refundable) {
      await creditSmsWallet({
        tx,
        type: 'REFUND',
        userId: activation.userId,
        amountCents: activation.priceCents,
        description: `Devolução: número para ${label} sem SMS`,
        activationId: activation.id,
        metadata: { reason: params.reason, status: params.to },
      });
    }

    await recordAudit({
      tx,
      userId: activation.userId,
      action: `SMS_ACTIVATION_${params.to}`,
      resource: 'sms',
      resourceId: activation.id,
      changes: {
        service: activation.service,
        providerActivationId: activation.providerActivationId,
        reason: params.reason,
        refundedCents: refundable ? activation.priceCents : 0,
        ...(params.failureCode ? { failureCode: params.failureCode } : {}),
      },
      status: params.to === 'FAILED' ? 'error' : 'success',
      errorMessage: params.to === 'FAILED' ? params.reason : undefined,
    });

    return { moved: true, refundedCents: refundable ? activation.priceCents : 0 };
  });
}

/** Carimba a consulta ao provedor sem mexer em mais nada. */
async function touch(activationId: string): Promise<void> {
  await prisma.smsActivation.updateMany({
    where: { id: activationId },
    data: { lastCheckedAt: new Date() },
  });
}

/**
 * `setStatus` de melhor esforço: cancelar/concluir no provedor é cortesia para
 * liberar o número; o estado que vale é o nosso. Devolve o que o provedor
 * respondeu, ou null quando a chamada falhou.
 */
async function safeSetStatus(
  providerActivationId: string,
  status: Sms24hSetStatus,
): Promise<boolean | null> {
  try {
    return await sms24hService.setStatus(providerActivationId, status);
  } catch (error) {
    // Id que o provedor já não conhece: o efeito desejado já aconteceu lá.
    if (isSms24hError(error, 'NO_ACTIVATION')) return true;
    console.warn(`[sms] setStatus ${status} falhou para ${providerActivationId}:`, error);
    return null;
  }
}

// ============ RESERVAS ÓRFÃS ============

/**
 * Fecha as reservas do usuário paradas em REQUESTING além do prazo — processo
 * que morreu entre o débito e o pedido ao provedor — devolvendo o valor.
 *
 * Chamado na abertura da tela de SMS e antes de cada compra, para o usuário
 * não ficar com saldo preso (e uma vaga de ativação ocupada) até a próxima
 * volta do cron, que o GitHub atrasa por horas. Idempotente: passa pela mesma
 * trava de `transition`.
 */
export async function reclaimStaleRequests(userId: string): Promise<number> {
  const stale = await prisma.smsActivation.findMany({
    where: {
      userId,
      status: 'REQUESTING',
      createdAt: { lt: new Date(Date.now() - SMS_REQUESTING_STALE_MS) },
    },
    select: { id: true },
    take: SMS_MAX_OPEN_ACTIVATIONS,
  });

  let reclaimed = 0;

  for (const row of stale) {
    const { moved } = await transition({
      activationId: row.id,
      from: ['REQUESTING'],
      to: 'FAILED',
      reason: 'Pedido ao provedor não concluído',
      failureCode: 'STALE',
    });
    if (moved) reclaimed++;
  }

  return reclaimed;
}

// ============ COMPRA ============

export type RequestFailureCode =
  | 'INSUFFICIENT_BALANCE'
  | 'TOO_MANY_OPEN'
  | 'NO_NUMBERS'
  | 'UNAVAILABLE'
  | 'ERROR';

export type RequestActivationResult =
  | { success: true; activationId: string }
  | { success: false; code: RequestFailureCode; error: string };

export async function requestActivation(params: {
  userId: string;
  service: SmsService;
}): Promise<RequestActivationResult> {
  const { userId, service } = params;
  const info = SMS_SERVICES[service];

  // Reserva órfã de uma tentativa anterior não pode nem prender saldo nem
  // contar como ativação aberta.
  await reclaimStaleRequests(userId);

  const open = await prisma.smsActivation.count({
    where: { userId, status: { in: [...OPEN_STATUSES] } },
  });

  if (open >= SMS_MAX_OPEN_ACTIVATIONS) {
    return {
      success: false,
      code: 'TOO_MANY_OPEN',
      error: `Você já tem ${SMS_MAX_OPEN_ACTIVATIONS} números aguardando SMS. Conclua ou cancele um deles antes de pedir outro.`,
    };
  }

  // 1. Reserva: débito e ativação nascem juntos. Se o débito falhar por saldo,
  //    a transação desfaz a ativação e nada fica para trás.
  let activationId: string;

  try {
    activationId = await prisma.$transaction(async (tx) => {
      const activation = await tx.smsActivation.create({
        data: {
          userId,
          service,
          status: 'REQUESTING',
          priceCents: info.priceCents,
          expiresAt: new Date(Date.now() + SMS_ACTIVATION_TTL_MS),
        },
        select: { id: true },
      });

      await debitSmsWallet({
        tx,
        userId,
        amountCents: info.priceCents,
        description: `Número para ${info.label}`,
        activationId: activation.id,
        metadata: { service },
      });

      await recordAudit({
        tx,
        userId,
        action: 'SMS_ACTIVATION_REQUESTED',
        resource: 'sms',
        resourceId: activation.id,
        changes: { service, priceCents: info.priceCents },
      });

      return activation.id;
    });
  } catch (error) {
    if (isSmsWalletError(error, 'INSUFFICIENT_SMS_BALANCE')) {
      return {
        success: false,
        code: 'INSUFFICIENT_BALANCE',
        error: 'Tokens de SMS insuficientes. Converta tokens de site para continuar.',
      };
    }
    throw error;
  }

  // 2. Cotação. É proteção de margem, não pré-requisito: sem resposta, segue.
  let costCents: number | null = null;

  try {
    const quote = await sms24hService.getPrices(info.code);

    if (quote) {
      costCents = quote.costCents;
      const ceiling = Math.floor(info.priceCents * (1 - SMS_MIN_MARGIN));

      if (quote.costCents > ceiling) {
        console.error(
          `[sms] ${service}: custo no provedor de ${quote.costCents} centavos passou do teto de ${ceiling} para o preço de venda de ${info.priceCents}. Venda recusada — revise o preço em lib/sms/catalog.ts.`,
        );

        await transition({
          activationId,
          from: ['REQUESTING'],
          to: 'FAILED',
          reason: `Custo no provedor (${quote.costCents} centavos) acima do teto para o preço de venda`,
          failureCode: 'MARGIN',
        });

        return { success: false, code: 'UNAVAILABLE', error: FAILURE_MESSAGES.MARGIN };
      }
    }
  } catch (error) {
    console.warn(`[sms] getPrices falhou para ${service}; seguindo sem cotação:`, error);
  }

  // 3. Pede o número.
  try {
    const number = await sms24hService.getNumber(info.code);

    const { count } = await prisma.smsActivation.updateMany({
      where: { id: activationId, status: 'REQUESTING' },
      data: {
        status: 'WAITING_CODE',
        providerActivationId: number.activationId,
        phone: number.phone,
        costCents,
        // O prazo conta a partir de agora, não da reserva.
        expiresAt: new Date(Date.now() + SMS_ACTIVATION_TTL_MS),
        lastCheckedAt: null,
      },
    });

    if (count === 0) {
      // A varredura já encerrou a reserva como obsoleta e devolveu o valor:
      // libera o número no provedor para não pagar por algo sem dono.
      await safeSetStatus(number.activationId, 8);
      return { success: false, code: 'ERROR', error: FAILURE_MESSAGES.STALE };
    }

    return { success: true, activationId };
  } catch (error) {
    let failureCode: FailureCode = 'PROVIDER';
    let requestCode: RequestFailureCode = 'ERROR';

    if (isSms24hError(error, 'NO_NUMBERS')) {
      failureCode = 'NO_NUMBERS';
      requestCode = 'NO_NUMBERS';
    } else if (isSms24hError(error, 'NO_BALANCE')) {
      // Saldo do PROVEDOR zerado: nenhuma venda sai até alguém recarregar lá.
      console.error('[sms] sms24h respondeu NO_BALANCE: o saldo da conta no provedor acabou.');
      failureCode = 'NO_BALANCE';
      requestCode = 'UNAVAILABLE';
    } else {
      console.error(`[sms] getNumber falhou para ${service}:`, error);
      if (isSms24hError(error, 'BAD_KEY')) requestCode = 'UNAVAILABLE';
    }

    await transition({
      activationId,
      from: ['REQUESTING'],
      to: 'FAILED',
      reason: error instanceof Error ? error.message : 'Falha ao pedir número',
      failureCode,
    });

    return { success: false, code: requestCode, error: FAILURE_MESSAGES[failureCode] };
  }
}

// ============ SINCRONIZAÇÃO COM O PROVEDOR ============

/**
 * Traz a ativação para o estado atual: aplica vencimento, sonda o provedor e
 * grava código/cancelamento. É chamada pelo polling da tela e pela varredura
 * do cron — os dois caminhos passam pelas mesmas travas, então concorrer é
 * inofensivo.
 *
 * Só consulta o provedor quando faz sentido (aguardando código, dentro do
 * prazo, respeitando o intervalo mínimo): várias abas abertas não multiplicam
 * as chamadas.
 */
export async function syncActivation(activationId: string): Promise<ActivationView | null> {
  const row = await prisma.smsActivation.findUnique({
    where: { id: activationId },
    select: VIEW_SELECT,
  });

  if (!row) return null;
  if (TERMINAL_STATUSES.includes(row.status)) return toActivationView(row);

  const now = Date.now();

  if (row.status === 'REQUESTING') {
    if (now - row.createdAt.getTime() > SMS_REQUESTING_STALE_MS) {
      await transition({
        activationId,
        from: ['REQUESTING'],
        to: 'FAILED',
        reason: 'Pedido ao provedor não concluído',
        failureCode: 'STALE',
      });
      return loadView(activationId);
    }
    return toActivationView(row);
  }

  // Daqui para baixo: WAITING_CODE ou CODE_RECEIVED — sempre com id no provedor.
  const providerId = row.providerActivationId;
  if (!providerId) {
    console.error(`[sms] ativação ${activationId} em ${row.status} sem providerActivationId`);
    return toActivationView(row);
  }

  if (row.expiresAt.getTime() <= now) {
    if (row.code === null) {
      await safeSetStatus(providerId, 8);
      await transition({
        activationId,
        from: ['WAITING_CODE'],
        to: 'EXPIRED',
        reason: 'Prazo vencido sem receber SMS',
      });
    } else {
      await safeSetStatus(providerId, 6);
      await transition({
        activationId,
        from: ['WAITING_CODE', 'CODE_RECEIVED'],
        to: 'COMPLETED',
        reason: 'Prazo encerrado com código recebido',
      });
    }
    return loadView(activationId);
  }

  // Com código na tela, só o usuário decide o próximo passo.
  if (row.status === 'CODE_RECEIVED') return toActivationView(row);

  if (row.lastCheckedAt && now - row.lastCheckedAt.getTime() < SMS_STATUS_MIN_INTERVAL_MS) {
    return toActivationView(row);
  }

  try {
    const remote = await sms24hService.getStatus(providerId);

    switch (remote.kind) {
      case 'waiting':
      case 'waiting_retry':
        await touch(activationId);
        break;

      case 'code': {
        const { count } = await prisma.smsActivation.updateMany({
          where: { id: activationId, status: 'WAITING_CODE' },
          data: {
            status: 'CODE_RECEIVED',
            code: remote.code,
            codeReceivedAt: new Date(),
            lastCheckedAt: new Date(),
          },
        });

        if (count > 0) {
          // O código em si fica fora da trilha: é uma senha de uso único.
          await recordAudit({
            userId: row.userId,
            action: 'SMS_CODE_RECEIVED',
            resource: 'sms',
            resourceId: activationId,
            changes: { service: row.service, retryCount: row.retryCount },
          });
        }
        break;
      }

      case 'cancelled':
      case 'missing':
        await transition({
          activationId,
          from: ['WAITING_CODE'],
          to: 'CANCELLED',
          reason:
            remote.kind === 'cancelled'
              ? 'Ativação cancelada pelo provedor'
              : 'Ativação não encontrada no provedor',
        });
        break;
    }
  } catch (error) {
    // Falha de consulta não muda estado; a próxima volta do polling tenta de novo.
    console.warn(`[sms] getStatus falhou para ${activationId}:`, error);
    await touch(activationId);
  }

  return loadView(activationId);
}

// ============ AÇÕES DO USUÁRIO ============

export type UserActionResult =
  | { success: true; view: ActivationView }
  | { success: false; error: string; view?: ActivationView };

async function findOwned(activationId: string, userId: string) {
  return prisma.smsActivation.findFirst({
    where: { id: activationId, userId },
    select: VIEW_SELECT,
  });
}

/** Desiste do número antes de o SMS chegar: cancela no provedor e devolve o valor. */
export async function cancelActivation(params: {
  activationId: string;
  userId: string;
}): Promise<UserActionResult> {
  const row = await findOwned(params.activationId, params.userId);
  if (!row) return { success: false, error: 'Ativação não encontrada' };

  if (row.status !== 'WAITING_CODE' || row.code !== null || !row.providerActivationId) {
    return {
      success: false,
      error: 'Esta ativação não pode mais ser cancelada.',
      view: toActivationView(row),
    };
  }

  const confirmed = await safeSetStatus(row.providerActivationId, 8);

  if (confirmed === null) {
    return {
      success: false,
      error: 'Não foi possível falar com o provedor agora. Tente de novo em instantes.',
      view: toActivationView(row),
    };
  }

  if (!confirmed) {
    // Recusa do provedor: ou o SMS acabou de chegar, ou ainda é cedo para
    // cancelar. Sincroniza para a tela mostrar o estado real.
    const view = await syncActivation(row.id);

    return {
      success: false,
      error:
        view?.status === 'CODE_RECEIVED'
          ? 'O SMS chegou antes do cancelamento — o código já está na tela.'
          : 'O provedor ainda não permite cancelar este número. Tente novamente em alguns instantes.',
      ...(view ? { view } : {}),
    };
  }

  await transition({
    activationId: row.id,
    from: ['WAITING_CODE'],
    to: 'CANCELLED',
    reason: 'Cancelado pelo usuário',
  });

  const view = await loadView(row.id);
  return view ? { success: true, view } : { success: false, error: 'Ativação não encontrada' };
}

/** Confirma que o código serviu: encerra no provedor e fecha a ativação. */
export async function completeActivation(params: {
  activationId: string;
  userId: string;
}): Promise<UserActionResult> {
  const row = await findOwned(params.activationId, params.userId);
  if (!row) return { success: false, error: 'Ativação não encontrada' };

  if (row.code === null || !OPEN_STATUSES.includes(row.status) || !row.providerActivationId) {
    return {
      success: false,
      error: 'Só é possível concluir depois de receber o código.',
      view: toActivationView(row),
    };
  }

  await safeSetStatus(row.providerActivationId, 6);

  await transition({
    activationId: row.id,
    from: ['WAITING_CODE', 'CODE_RECEIVED'],
    to: 'COMPLETED',
    reason: 'Concluído pelo usuário',
  });

  const view = await loadView(row.id);
  return view ? { success: true, view } : { success: false, error: 'Ativação não encontrada' };
}

/**
 * Pede outro SMS no mesmo número (o app reenviou o código). Não custa nada a
 * mais: a ativação volta a WAITING_CODE e o polling continua até o prazo.
 */
export async function retryActivation(params: {
  activationId: string;
  userId: string;
}): Promise<UserActionResult> {
  const row = await findOwned(params.activationId, params.userId);
  if (!row) return { success: false, error: 'Ativação não encontrada' };

  const view = toActivationView(row);

  if (!view.canRetry || !row.providerActivationId) {
    return {
      success: false,
      error:
        row.retryCount >= SMS_MAX_RETRIES
          ? `Limite de ${SMS_MAX_RETRIES} reenvios atingido para este número.`
          : 'Não é possível pedir outro SMS para esta ativação.',
      view,
    };
  }

  const confirmed = await safeSetStatus(row.providerActivationId, 3);

  if (!confirmed) {
    return {
      success: false,
      error: 'O provedor não aceitou o pedido de outro SMS agora. Tente novamente em instantes.',
      view,
    };
  }

  await prisma.smsActivation.updateMany({
    where: { id: row.id, status: 'CODE_RECEIVED' },
    data: {
      status: 'WAITING_CODE',
      retryCount: { increment: 1 },
      lastCheckedAt: null,
    },
  });

  await recordAudit({
    userId: row.userId,
    action: 'SMS_ACTIVATION_RETRY',
    resource: 'sms',
    resourceId: row.id,
    changes: { service: row.service, retryCount: row.retryCount + 1 },
  });

  const next = await loadView(row.id);
  return next ? { success: true, view: next } : { success: false, error: 'Ativação não encontrada' };
}

// ============ VARREDURA (CRON) ============

export interface SweepSummary {
  checked: number;
  completed: number;
  expired: number;
  cancelled: number;
  failed: number;
  codesReceived: number;
  errors: number;
}

/** Sonda ativações abandonadas para o código não se perder. */
const IDLE_PROBE_MS = 60_000;
const CONCURRENCY = 5;

/**
 * Rede de proteção para quem fechou a aba: aplica vencimentos (com devolução),
 * fecha reservas obsoletas e sonda códigos de ativações paradas. Idempotente
 * por construção — é o mesmo `syncActivation` do polling.
 */
export async function sweepActivations(limit = 50): Promise<SweepSummary> {
  const now = Date.now();

  const rows = await prisma.smsActivation.findMany({
    where: {
      OR: [
        { status: 'REQUESTING', createdAt: { lt: new Date(now - SMS_REQUESTING_STALE_MS) } },
        { status: { in: ['WAITING_CODE', 'CODE_RECEIVED'] }, expiresAt: { lte: new Date(now) } },
        {
          status: 'WAITING_CODE',
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - IDLE_PROBE_MS) } }],
        },
      ],
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true, status: true },
  });

  const summary: SweepSummary = {
    checked: rows.length,
    completed: 0,
    expired: 0,
    cancelled: 0,
    failed: 0,
    codesReceived: 0,
    errors: 0,
  };

  for (let index = 0; index < rows.length; index += CONCURRENCY) {
    const chunk = rows.slice(index, index + CONCURRENCY);

    await Promise.all(
      chunk.map(async (row) => {
        try {
          const view = await syncActivation(row.id);
          if (!view || view.status === row.status) return;

          switch (view.status) {
            case 'COMPLETED':
              summary.completed++;
              break;
            case 'EXPIRED':
              summary.expired++;
              break;
            case 'CANCELLED':
              summary.cancelled++;
              break;
            case 'FAILED':
              summary.failed++;
              break;
            case 'CODE_RECEIVED':
              summary.codesReceived++;
              break;
          }
        } catch (error) {
          summary.errors++;
          console.error(`[sms] varredura falhou para ${row.id}:`, error);
        }
      }),
    );
  }

  return summary;
}
