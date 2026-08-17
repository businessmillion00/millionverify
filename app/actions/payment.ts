'use server';

import { prisma } from '@/lib/prisma';
import { asaasService } from '@/services/asaas';
import { CreatePaymentSchema } from '@/lib/validators/payment';
import { tokenOrder } from '@/lib/constants';
import { auth } from '@/lib/auth';
import { addDays, format } from 'date-fns';

export async function createPayment(input: unknown) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    // Validação
    const parsed = CreatePaymentSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Quantidade inválida' };
    }

    const order = tokenOrder(parsed.data.tokens);

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return { success: false, error: 'Usuário não encontrado' };
    }

    if (!user.asaasCustomerId) {
      return { success: false, error: 'Cliente não registrado no Asaas' };
    }

    // Criar pagamento no banco de dados primeiro
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        amount: order.price,
        tokensGranted: order.tokens,
        description: `Compra de ${order.tokens} ${order.tokens === 1 ? 'token' : 'tokens'}`,
        status: 'PENDING',
      },
    });

    try {
      // Criar cobrança no Asaas
      const dueDate = addDays(new Date(), 7);

      const asaasPayment = await asaasService.createPayment({
        customer: user.asaasCustomerId,
        value: order.price,
        dueDate: format(dueDate, 'yyyy-MM-dd'),
        description: `Compra de ${order.tokens} ${order.tokens === 1 ? 'token' : 'tokens'}`,
        externalReference: payment.id,
      });

      const pix = await asaasService.getPixQrCode(asaasPayment.id);

      // Atualizar payment com dados do Asaas
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          asaasPaymentId: asaasPayment.id,
          asaasStatus: asaasPayment.status,
          pixQrCode: pix.encodedImage,
          pixKey: pix.payload,
          pixExpiresAt: dueDate,
          lastAttemptAt: new Date(),
        },
      });

      // Registrar auditoria
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'PAYMENT_CREATED',
          resource: 'payment',
          resourceId: payment.id,
          changes: {
            tokens: order.tokens,
            amount: order.price,
            asaasId: asaasPayment.id,
          },
          status: 'success',
        },
      });

      return {
        success: true,
        data: {
          paymentId: updatedPayment.id,
          asaasPaymentId: asaasPayment.id,
          amount: order.price,
          tokens: order.tokens,
          pixQrCode: pix.encodedImage,
          pixCopyPaste: pix.payload,
          expiresAt: dueDate.toISOString(),
        },
      };
    } catch (asaasError) {
      // Se falhar no Asaas, atualizar payment com erro
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          errorLog: JSON.stringify(asaasError),
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });

      console.error('Erro ao criar pagamento no Asaas:', asaasError);
      return { success: false, error: 'Erro ao processar pagamento. Tente novamente.' };
    }
  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    return { success: false, error: 'Erro ao processar pagamento' };
  }
}

export async function getPaymentStatus(paymentId: string) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.userId !== session.user.id) {
      return { success: false, error: 'Pagamento não encontrado' };
    }

    return {
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
    };
  } catch (error) {
    console.error('Erro ao buscar status de pagamento:', error);
    return { success: false, error: 'Erro ao buscar status' };
  }
}
