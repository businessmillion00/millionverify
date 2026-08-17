'use server';

import { prisma } from '@/lib/prisma';
import { CreateSiteSchema } from '@/lib/validators/site';
import { auth } from '@/lib/auth';
import { brasilAPIService } from '@/services/brasil-api';
import { enqueueSiteBuild } from '@/lib/site/provision';

const TOKENS_PER_SITE_CREATION = 10;

export async function createSite(input: unknown) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    // Validação
    const parsed = CreateSiteSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Dados inválidos', errors: parsed.error.flatten() };
    }

    const { name, companyName, cnpj, subdomain, description, metaTag } = parsed.data;

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return { success: false, error: 'Usuário não encontrado' };
    }

    // Verificar saldo de tokens
    if (user.tokenBalance < TOKENS_PER_SITE_CREATION) {
      return {
        success: false,
        error: `Tokens insuficientes. Você precisa de ${TOKENS_PER_SITE_CREATION} tokens para criar um site.`
      };
    }

    // Verificar se subdomain já existe
    const existingSubdomain = await prisma.site.findFirst({
      where: { subdomain },
    });

    if (existingSubdomain) {
      return { success: false, error: 'Este subdomínio já está em uso' };
    }

    // Verificar limite de sites por usuário (máx 5)
    const userSitesCount = await prisma.site.count({
      where: { userId: user.id, isDeleted: false },
    });

    if (userSitesCount >= 5) {
      return { success: false, error: 'Limite de sites atingido (máx. 5)' };
    }

    // Tentar consultar CNPJ real
    let cnpjInfo = null;
    try {
      cnpjInfo = await brasilAPIService.checkCNPJ(cnpj);
    } catch (error) {
      console.warn('Erro ao consultar CNPJ em BrasilAPI:', error);
      // Continuar mesmo se falhar
    }

    // Usar transação para criar site e descontar tokens
    const result = await prisma.$transaction(async (tx) => {
      // Débito condicional: falha se outra requisição concorrente já gastou o saldo.
      const { count } = await tx.user.updateMany({
        where: { id: user.id, tokenBalance: { gte: TOKENS_PER_SITE_CREATION } },
        data: { tokenBalance: { decrement: TOKENS_PER_SITE_CREATION } },
      });

      if (count === 0) {
        throw new Error('INSUFFICIENT_TOKENS');
      }

      const newBalance = user.tokenBalance - TOKENS_PER_SITE_CREATION;

      // 2. Criar site
      const site = await tx.site.create({
        data: {
          userId: user.id,
          name,
          companyName,
          cnpj: cnpj.replace(/\D/g, ''),
          subdomain,
          description,
          metaTag,
          isPublished: true,
          theme: {
            bgColor: '#121212',
            accentColor: '#F59E0B',
          },
          content: {
            description: cnpjInfo?.name || companyName,
            city: cnpjInfo?.headquarters?.city || '',
            state: cnpjInfo?.headquarters?.state || '',
          },
        },
      });

      // 3. Registrar transação de tokens
      await tx.tokenTransaction.create({
        data: {
          userId: user.id,
          type: 'USAGE',
          amount: TOKENS_PER_SITE_CREATION,
          description: `Criação do site: ${name}`,
          balanceBefore: user.tokenBalance,
          balanceAfter: newBalance,
          metadata: {
            siteId: site.id,
            subdomain,
          },
        },
      });

      // 4. Registrar auditoria
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'SITE_CREATED',
          resource: 'site',
          resourceId: site.id,
          changes: {
            name,
            subdomain,
            tokensUsed: TOKENS_PER_SITE_CREATION,
          },
          status: 'success',
        },
      });

      return site;
    });

    // Coloca o site na fila de provisionamento (o default do schema é READY, e
    // sem isto lib/site/provision.ts nunca rodaria: o site ficaria para sempre
    // com o `content` de rascunho gravado logo acima, sem os textos e sem o
    // payload da Receita em `registryData`).
    //
    // Fora da transação e sem derrubar a criação: o site e o débito já estão
    // confirmados, e a tela "Montando." consegue reenfileirar sozinha
    // (POST /api/sites/{id}/build-status) se esta chamada falhar.
    try {
      await enqueueSiteBuild(result.id);
    } catch (error) {
      console.error('Falha ao enfileirar o provisionamento do site:', result.id, error);
    }

    return {
      success: true,
      data: {
        id: result.id,
        name: result.name,
        subdomain: result.subdomain,
        url: `https://${result.subdomain}.businessmillion.app`,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_TOKENS') {
      return { success: false, error: 'Tokens insuficientes' };
    }
    console.error('Erro ao criar site:', error);
    return { success: false, error: 'Erro ao criar site' };
  }
}

export async function getSitesByUser() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const sites = await prisma.site.findMany({
      where: {
        userId: session.user.id,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        subdomain: true,
        companyName: true,
        isPublished: true,
        viewsCount: true,
        metaTagVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: sites };
  } catch (error) {
    console.error('Erro ao buscar sites:', error);
    return { success: false, error: 'Erro ao buscar sites' };
  }
}
