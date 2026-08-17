'use server';

import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/utils/auth-utils';
import { RegisterSchema } from '@/lib/validators/auth';
import { rateLimit } from '@/lib/utils/rate-limit';
import { asaasService } from '@/services/asaas';

export async function registerUser(input: unknown) {
  try {
    // Rate limiting
    const { success } = await rateLimit('register', 5, 3600000); // 5 por hora por IP
    if (!success) {
      return { success: false, error: 'Muitas tentativas. Tente novamente em 1 hora.' };
    }

    // Validação
    const parsed = RegisterSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Dados inválidos' };
    }

    const { name, email, password } = parsed.data;

    // Verificar se email já existe
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return { success: false, error: 'Email já registrado' };
    }

    // Hash da senha
    const passwordHash = await hashPassword(password);

    // Criar usuário
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'USER',
        tokenBalance: 100, // Bônus de 100 tokens para novos usuários
      },
    });

    // Tentar criar cliente no Asaas
    try {
      const asaasCustomer = await asaasService.createCustomer({
        name,
        email,
        cpfCnpj: '00000000000191', // Placeholder
      });

      // Atualizar user com Asaas ID
      await prisma.user.update({
        where: { id: user.id },
        data: { asaasCustomerId: asaasCustomer.id },
      });
    } catch (error) {
      console.error('Erro ao criar cliente Asaas:', error);
      // Continuar mesmo se falhar (pode tentar depois)
    }

    // Registrar auditoria
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTERED',
        resource: 'user',
        resourceId: user.id,
        status: 'success',
      },
    });

    return {
      success: true,
      message: 'Registro realizado com sucesso. Você já ganha 100 tokens bônus!'
    };
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    return { success: false, error: 'Erro ao processar registro' };
  }
}
