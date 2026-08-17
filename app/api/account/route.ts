import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimitByName, rateLimitResponse, type RateLimitResult } from '@/lib/utils/rate-limit';
import { withSecurityHeaders } from '@/lib/security/headers';
import { assertSameOrigin } from '@/lib/security/csrf';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

/** Nunca exponha passwordHash nem asaasCustomerId: o dono não precisa e vazam superfície. */
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  name: true,
  cpfCnpj: true,
  phone: true,
  tokenBalance: true,
  monthlyTokenLimit: true,
  isActive: true,
  isVerified: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * `.strict()` recusa qualquer campo fora desta lista — é assim que role, tokenBalance,
 * isActive, isVerified e asaasCustomerId ficam fora de alcance. O `data` do update é
 * montado campo a campo; o body NUNCA é espalhado.
 */
const UpdateAccountSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Nome deve ter no mínimo 2 caracteres')
      .max(120, 'Nome deve ter no máximo 120 caracteres')
      .optional(),
    phone: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ''))
      .refine((value) => value.length >= 10 && value.length <= 11, 'Telefone inválido')
      .optional(),
    cpfCnpj: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ''))
      .refine((value) => value.length === 11 || value.length === 14, 'CPF ou CNPJ inválido')
      .optional(),
  })
  .strict('Campo não permitido')
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Informe ao menos um campo para atualizar',
  );

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ error: 'Não autenticado' }, 401);
  }

  // Chave por usuário: o middleware não cobre /api e o IP é forjável.
  const limit = await rateLimitByName('account:read', session.user.id);
  if (!limit.success) {
    return tooManyRequests(limit, 'Muitas consultas ao perfil. Aguarde alguns instantes.');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: ACCOUNT_SELECT,
  });

  if (!user) {
    return json({ error: 'Conta não encontrada' }, 404);
  }

  return json({ success: true, data: serializeAccount(user) });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ error: 'Não autenticado' }, 401);
  }

  if (!assertSameOrigin(request)) {
    return json({ error: 'Origem não permitida' }, 403);
  }

  const limit = await rateLimitByName('account:write', session.user.id);
  if (!limit.success) {
    return tooManyRequests(limit, 'Muitas alterações de perfil. Tente novamente mais tarde.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Corpo da requisição inválido' }, 400);
  }

  const parsed = UpdateAccountSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, 400);
  }

  const userId = session.user.id;

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: ACCOUNT_SELECT,
  });

  if (!current) {
    return json({ error: 'Conta não encontrada' }, 404);
  }

  if (!current.isActive) {
    return json({ error: 'Conta desativada. Fale com o suporte para reativá-la.' }, 403);
  }

  const data: Prisma.UserUpdateInput = {};
  const changes: Record<string, string> = {};

  if (parsed.data.name !== undefined && parsed.data.name !== current.name) {
    data.name = parsed.data.name;
    changes.name = parsed.data.name;
  }

  if (parsed.data.phone !== undefined && parsed.data.phone !== current.phone) {
    data.phone = parsed.data.phone;
    // O log registra QUE mudou, não o dado pessoal completo.
    changes.phone = maskTail(parsed.data.phone, 4);
  }

  if (parsed.data.cpfCnpj !== undefined && parsed.data.cpfCnpj !== current.cpfCnpj) {
    data.cpfCnpj = parsed.data.cpfCnpj;
    changes.cpfCnpj = maskTail(parsed.data.cpfCnpj, 2);
  }

  if (Object.keys(data).length === 0) {
    return json({ success: true, data: serializeAccount(current), message: 'Nenhuma alteração' });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: ACCOUNT_SELECT,
  });

  await recordAudit({
    userId,
    action: 'ACCOUNT_UPDATED',
    resource: 'user',
    resourceId: userId,
    changes,
  });

  return json({ success: true, data: serializeAccount(updated) });
}

/**
 * Exclusão LÓGICA. Apagar o User cascateia Payments, TokenTransactions e AuditLogs —
 * a trilha financeira some junto, e o schema não tem `deletedAt`.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ error: 'Não autenticado' }, 401);
  }

  if (!assertSameOrigin(request)) {
    return json({ error: 'Origem não permitida' }, 403);
  }

  const limit = await rateLimitByName('account:write', session.user.id);
  if (!limit.success) {
    return tooManyRequests(limit, 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const userId = session.user.id;

  // Cobrança viva no Asaas pode ser paga depois da desativação: o webhook chegaria
  // creditando tokens numa conta inativa. Recusar é a única saída que não perde dinheiro.
  const livePendingPayments = await prisma.payment.count({
    where: { userId, status: 'PENDING', asaasPaymentId: { not: null } },
  });

  if (livePendingPayments > 0) {
    return json(
      {
        error:
          'Existem cobranças PIX em aberto. Aguarde a confirmação ou o vencimento antes de desativar a conta.',
      },
      409,
    );
  }

  const deactivated = await prisma.$transaction(async (tx) => {
    // Condicional: uma segunda chamada concorrente não regrava nem duplica auditoria.
    const { count } = await tx.user.updateMany({
      where: { id: userId, isActive: true },
      data: { isActive: false },
    });

    if (count === 0) return false;

    // Cobranças que nunca chegaram ao Asaas são impagáveis; encerrá-las evita inflar
    // o "Em aberto" do painel admin para sempre.
    await tx.payment.updateMany({
      where: { userId, status: 'PENDING', asaasPaymentId: null },
      data: {
        status: 'FAILED',
        errorLog: 'Cobrança cancelada: conta desativada antes do envio ao Asaas',
      },
    });

    await recordAudit({
      userId,
      action: 'ACCOUNT_DEACTIVATED',
      resource: 'user',
      resourceId: userId,
      changes: { isActive: false },
      tx,
    });

    return true;
  });

  // LIMITAÇÃO CONHECIDA: lib/auth.ts `authorize` não checa `isActive`, então isto não
  // bloqueia login nem invalida o JWT já emitido (30 dias). A correção está pedida como
  // integração; até lá a mensagem não promete o que o sistema não cumpre.
  return json({
    success: true,
    data: { isActive: false, sessionInvalidated: false },
    message: deactivated
      ? 'Conta desativada. Encerre a sessão para sair; a reativação é feita pelo suporte.'
      : 'Esta conta já estava desativada.',
  });
}

type AccountRecord = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

function serializeAccount(user: AccountRecord) {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

function maskTail(value: string, visible: number): string {
  return `***${value.slice(-visible)}`;
}

function json(body: unknown, status: number = 200): NextResponse {
  return withSecurityHeaders(
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  );
}

function tooManyRequests(result: RateLimitResult, message: string): NextResponse {
  return withSecurityHeaders(rateLimitResponse(result, message));
}
