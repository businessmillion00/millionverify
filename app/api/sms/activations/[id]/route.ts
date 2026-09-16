import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimitByName } from '@/lib/utils/rate-limit';
import { syncActivation } from '@/lib/sms/activation';

/** Polling nunca pode ser servido de cache — o valor consultado é justamente o que muda. */
const NO_STORE = { 'Cache-Control': 'no-store' };

type Context = { params: Promise<{ id: string }> };

/**
 * Polling da tela de ativação. Diferente de /api/payments/[id]/status, esta
 * rota CONSULTA o provedor e pode mover saldo — quando descobre que o prazo
 * venceu sem SMS, devolve o valor. É seguro porque nada da requisição entra na
 * decisão: o estado vem do sms24h e do relógio, e toda transição tem trava
 * condicional (lib/sms/activation.ts). Sem isso o usuário esperaria a próxima
 * volta do cron, que o GitHub atrasa por horas.
 */
export async function GET(_request: NextRequest, context: Context) {
  // O matcher do middleware exclui /api: sem esta checagem a rota fica aberta.
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Não autenticado' },
      { status: 401, headers: NO_STORE },
    );
  }

  // Chave pelo id do usuário: o polling é autenticado e o IP é forjável.
  const limit = await rateLimitByName('sms:status', session.user.id);

  if (!limit.success) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    return NextResponse.json(
      { success: false, error: 'Muitas consultas. Aguarde alguns instantes.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retryAfter) } },
    );
  }

  const { id } = await context.params;

  // userId no where: ativação de outro dono responde o mesmo 404 de
  // ativação inexistente, para não permitir enumeração de ids.
  const owned = await prisma.smsActivation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });

  if (!owned) {
    return NextResponse.json(
      { success: false, error: 'Ativação não encontrada' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const view = await syncActivation(owned.id);

    if (!view) {
      return NextResponse.json(
        { success: false, error: 'Ativação não encontrada' },
        { status: 404, headers: NO_STORE },
      );
    }

    return NextResponse.json({ success: true, data: view }, { headers: NO_STORE });
  } catch (error) {
    console.error(`[sms] falha ao sincronizar ${owned.id}:`, error);
    return NextResponse.json(
      { success: false, error: 'Não foi possível consultar agora.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
