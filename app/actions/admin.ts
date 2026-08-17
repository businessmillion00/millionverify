'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

const requireAdmin = async () => {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') {
    throw new Error('FORBIDDEN');
  }
  return session.user;
};

export async function getRevenueOverview() {
  await requireAdmin();

  const [confirmed, pending, users, sites] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'CONFIRMED' },
      _sum: { amount: true, tokensGranted: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { status: 'PENDING' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.user.count(),
    prisma.site.count({ where: { isDeleted: false } }),
  ]);

  return {
    revenue: confirmed._sum.amount ?? 0,
    tokensSold: confirmed._sum.tokensGranted ?? 0,
    confirmedPayments: confirmed._count,
    pendingRevenue: pending._sum.amount ?? 0,
    pendingPayments: pending._count,
    totalUsers: users,
    totalSites: sites,
  };
}

const AdjustBalanceSchema = z.object({
  userId: z.string().cuid(),
  amount: z.number().int().refine((n) => n !== 0, 'Informe um valor diferente de zero'),
  reason: z.string().min(3, 'Descreva o motivo').max(200),
});

export async function adjustTokenBalance(input: unknown) {
  try {
    const admin = await requireAdmin();

    const parsed = AdjustBalanceSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { userId, amount, reason } = parsed.data;

    await prisma.$transaction(async (tx) => {
      // Impede que um ajuste negativo deixe o saldo abaixo de zero.
      const { count } = await tx.user.updateMany({
        where:
          amount < 0
            ? { id: userId, tokenBalance: { gte: -amount } }
            : { id: userId },
        data: { tokenBalance: { increment: amount } },
      });

      if (count === 0) throw new Error('INVALID_ADJUSTMENT');

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

      await tx.tokenTransaction.create({
        data: {
          userId,
          type: amount > 0 ? 'BONUS' : 'USAGE',
          amount: Math.abs(amount),
          description: `Ajuste manual: ${reason}`,
          balanceBefore: user.tokenBalance - amount,
          balanceAfter: user.tokenBalance,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'ADMIN_ADJUST_BALANCE',
          resource: 'user',
          resourceId: userId,
          changes: { amount, reason, newBalance: user.tokenBalance },
          status: 'success',
        },
      });
    });

    revalidatePath('/admin/users');
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return { success: false, error: 'Acesso negado' };
    }
    if (error instanceof Error && error.message === 'INVALID_ADJUSTMENT') {
      return { success: false, error: 'Saldo insuficiente para este débito' };
    }
    console.error('Erro ao ajustar saldo:', error);
    return { success: false, error: 'Erro ao ajustar saldo' };
  }
}

const SetRoleSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(['USER', 'ADMIN']),
});

export async function setUserRole(input: unknown) {
  try {
    const admin = await requireAdmin();

    const parsed = SetRoleSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Dados inválidos' };
    }

    const { userId, role } = parsed.data;

    if (userId === admin.id) {
      return { success: false, error: 'Você não pode alterar seu próprio nível' };
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { role } }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'ADMIN_SET_ROLE',
          resource: 'user',
          resourceId: userId,
          changes: { role },
          status: 'success',
        },
      }),
    ]);

    revalidatePath('/admin/users');
    return { success: true };
  } catch (error) {
    console.error('Erro ao alterar permissão:', error);
    return { success: false, error: 'Erro ao alterar permissão' };
  }
}
