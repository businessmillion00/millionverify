import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { asaasService } from '@/services/asaas';
import { rateLimit, getClientIp } from '@/lib/utils/rate-limit';
import { AsaasWebhookSchema } from '@/lib/validators/payment';
import {
  creditPaymentTokens,
  failPendingPayment,
  refundPaymentTokens,
} from '@/lib/tokens/ledger';

export const dynamic = 'force-dynamic';

/**
 * O Asaas entrega de um punhado de IPs fixos, então este limite mede a fila
 * inteira e não um cliente. Ele existe só para conter flood: um 429 aqui não
 * perde dinheiro, porque o Asaas reentrega qualquer resposta fora do 2xx e o cron
 * `/api/cron/reconcile-payments` é a rede final.
 */
const RATE_LIMIT_MAX = 5000;
const RATE_LIMIT_WINDOW = 3600000;

const CREDIT_EVENTS = new Set([
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED_IN_CASH',
]);

const REFUND_EVENTS = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
]);

const FAIL_EVENTS = new Set(['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_EXPIRED']);

/**
 * O enum de `data.status` em lib/validators/payment.ts cobre só seis valores.
 * Eventos legítimos (chargeback, análise de risco, recebido em dinheiro) chegam
 * com outros e reprová-los com 400 faria o Asaas reentregar para sempre — e
 * suspender a fila inteira depois de N falhas. Reaproveitamos o schema
 * compartilhado e afrouxamos apenas esse campo.
 */
const WebhookPayloadSchema = AsaasWebhookSchema.extend({
  data: AsaasWebhookSchema.shape.data.extend({
    status: z.string().min(1),
  }),
});

/**
 * `createPayment` grava o `Payment.id` em `externalReference`. Se o processo
 * morreu depois de criar a cobrança no Asaas e antes de gravar `asaasPaymentId`,
 * essa é a única forma de reencontrar o pagamento — sem ela o crédito só sairia
 * na reconciliação, e nem lá (o filtro exige asaasPaymentId).
 */
async function findPayment(
  asaasPaymentId: string,
  externalReference?: string,
): Promise<{ id: string } | null> {
  const byAsaasId = await prisma.payment.findUnique({
    where: { asaasPaymentId },
    select: { id: true },
  });

  if (byAsaasId) return byAsaasId;
  if (!externalReference) return null;

  return prisma.payment.findUnique({
    where: { id: externalReference },
    select: { id: true },
  });
}

export async function POST(request: NextRequest) {
  try {
    const ip = await getClientIp();
    const { success } = await rateLimit(
      `webhook:asaas:${ip}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW,
    );

    if (!success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Token conferido ANTES de ler o corpo: payload não autenticado não merece parse.
    if (!asaasService.verifyWebhookToken(request.headers.get('asaas-access-token'))) {
      console.warn('Webhook token verification failed');
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const parsed = WebhookPayloadSchema.safeParse(await request.json());

    if (!parsed.success) {
      console.warn('Webhook validation failed:', parsed.error);
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const { event, data } = parsed.data;

    if (
      !CREDIT_EVENTS.has(event) &&
      !REFUND_EVENTS.has(event) &&
      !FAIL_EVENTS.has(event)
    ) {
      console.info(`Evento do Asaas sem tratamento: ${event}`);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const payment = await findPayment(data.id, data.externalReference);

    if (!payment) {
      // 200 proposital: um id que não existe aqui nunca vai passar a existir, e
      // responder erro faria o Asaas reentregar indefinidamente.
      console.warn(`Payment not found for Asaas ID: ${data.id}`);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (CREDIT_EVENTS.has(event)) {
      const result = await creditPaymentTokens({
        paymentId: payment.id,
        source: 'webhook',
        asaasStatus: data.status,
        asaasPaymentId: data.id,
        paidAt: data.paymentDate ? new Date(data.paymentDate) : new Date(),
        paidValue: data.value,
      });

      if (result.credited) {
        console.info(`Payment confirmed and tokens credited: ${payment.id}`);
      } else if (result.reason === 'VALUE_MISMATCH') {
        console.error(
          `Valor divergente no webhook do pagamento ${payment.id}: crédito bloqueado.`,
        );
      } else {
        console.info(`Duplicate webhook ignored for payment: ${payment.id}`);
      }

      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (REFUND_EVENTS.has(event)) {
      const result = await refundPaymentTokens({
        paymentId: payment.id,
        source: 'webhook',
        asaasStatus: data.status,
        reason: `Evento ${event} recebido do Asaas`,
      });

      console.info(
        result.refunded
          ? `Refund applied for payment ${payment.id}: ${result.tokensReverted} token(s) revertido(s)`
          : `Refund webhook ignored for payment ${payment.id} (${result.reason})`,
      );

      return NextResponse.json({ success: true }, { status: 200 });
    }

    const { failed } = await failPendingPayment({
      paymentId: payment.id,
      source: 'webhook',
      asaasStatus: data.status,
      reason: `Cobrança encerrada pelo Asaas (${event})`,
    });

    console.info(
      failed
        ? `Payment marked as failed: ${payment.id}`
        : `Stale ${event} ignored for payment: ${payment.id}`,
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    // 500 de propósito: o Asaas reentrega e a reconciliação cobre o resto.
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
