import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/utils/rate-limit';

/** Polling nunca pode ser servido de cache — o valor consultado é justamente o que muda. */
const NO_STORE = { 'Cache-Control': 'no-store' };

const POLL_LIMIT = 120;
const POLL_WINDOW_MS = 60_000;

type Context = { params: Promise<{ paymentId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  // O matcher do middleware exclui /api: sem esta checagem a rota fica aberta.
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Não autenticado' },
      { status: 401, headers: NO_STORE }
    );
  }

  // Chave pelo id do usuário, não pelo IP: o polling é autenticado e
  // x-forwarded-for é forjável por quem quiser escapar do limite.
  const { success, reset } = await rateLimit(
    `payment-status:${session.user.id}`,
    POLL_LIMIT,
    POLL_WINDOW_MS
  );

  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return NextResponse.json(
      { success: false, error: 'Muitas consultas. Aguarde alguns instantes.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retryAfter) } }
    );
  }

  const { paymentId } = await context.params;

  // findFirst com userId no where: cobrança de outro dono devolve 404,
  // indistinguível de "não existe", para não permitir enumeração de ids.
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: session.user.id },
    select: {
      id: true,
      status: true,
      asaasStatus: true,
      amount: true,
      tokensGranted: true,
      createdAt: true,
      paidAt: true,
    },
  });

  if (!payment) {
    return NextResponse.json(
      { success: false, error: 'Pagamento não encontrado' },
      { status: 404, headers: NO_STORE }
    );
  }

  // Mesmo shape de getPaymentStatus (app/actions/payment.ts) para manter um contrato só.
  // Nada de pixQrCode/pixKey aqui: o checkout já os recebeu pelo server component.
  // E nada de consultar o Asaas ou creditar tokens — um GET do cliente jamais move dinheiro.
  return NextResponse.json(
    {
      success: true,
      data: {
        id: payment.id,
        status: payment.status,
        asaasStatus: payment.asaasStatus,
        amount: payment.amount,
        tokens: payment.tokensGranted,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      },
    },
    { headers: NO_STORE }
  );
}
