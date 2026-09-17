'use server';

import { prisma } from '@/lib/prisma';
import { CreateSiteSchema } from '@/lib/validators/site';
import { auth } from '@/lib/auth';
import { brasilAPIService } from '@/services/brasil-api';
import { enqueueSiteBuild } from '@/lib/site/provision';
import { APP_CONFIG, MAX_SITES_PER_USER, TOKENS_PER_SITE } from '@/lib/constants';
import { activeSiteWhere, siteExpiresAt } from '@/lib/site/lifetime';
import { debitTokens, isLedgerError, lockUser } from '@/lib/tokens/ledger';

/*
 * Cobrança da criação. Vem da constante compartilhada: um valor próprio aqui
 * divergia do preço anunciado na tela sem ninguém perceber.
 */
const TOKENS_PER_SITE_CREATION = TOKENS_PER_SITE;

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

    const { name, companyName, cnpj, subdomain, description, metaTag, phone } = parsed.data;

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return { success: false, error: 'Usuário não encontrado' };
    }

    if (!user.isActive) {
      return { success: false, error: 'Conta desativada.' };
    }

    // Checagem amigável; a que vale é a trava do razão dentro da transação.
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

    // Limite de sites VIVOS por usuário: os expirados não contam, mesmo que a
    // rotina de exclusão ainda não tenha passado por eles.
    const userSitesCount = await prisma.site.count({
      where: { userId: user.id, ...activeSiteWhere() },
    });

    if (userSitesCount >= MAX_SITES_PER_USER) {
      return {
        success: false,
        error: `Limite de sites atingido (máx. ${MAX_SITES_PER_USER})`,
      };
    }

    // Tentar consultar CNPJ real
    let cnpjInfo = null;
    try {
      cnpjInfo = await brasilAPIService.checkCNPJ(cnpj);
    } catch (error) {
      console.warn('Erro ao consultar CNPJ em BrasilAPI:', error);
      // Continuar mesmo se falhar
    }

    // Prazo de vida: o site sai do ar e é excluído quando vencer.
    const expiresAt = siteExpiresAt();

    // Usar transação para criar site e descontar tokens
    const result = await prisma.$transaction(async (tx) => {
      // 0. Trava o usuário ANTES de inserir o site: o insert pega KEY SHARE na
      //    linha dele e o débito abaixo pede FOR UPDATE — na ordem inversa, duas
      //    criações simultâneas travam uma à outra (ver lockUser).
      await lockUser(tx, user.id);

      // 1. Criar site. O débito vem logo abaixo, na mesma transação: se ele
      //    falhar por saldo, o site some junto.
      const site = await tx.site.create({
        data: {
          userId: user.id,
          name,
          companyName,
          cnpj: cnpj.replace(/\D/g, ''),
          subdomain,
          description,
          metaTag,
          /*
           * Só os dígitos: o provisionamento formata para exibição, e guardar a
           * máscara faria o mesmo telefone divergir conforme quem digitou.
           * Vazio vira null para o `site.phone ?? registry.phone` do
           * provisionamento cair no telefone da Receita.
           */
          phone: phone?.replace(/\D/g, '') || null,
          isPublished: true,
          expiresAt,
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

      // 2. Débito pelo razão (lib/tokens/ledger.ts): trava a linha do usuário
      //    e lança INSUFFICIENT_TOKENS se o saldo não cobrir. Antes o débito era
      //    um updateMany condicional com balanceBefore/After calculados de uma
      //    leitura feita fora da transação — o saldo nunca ficava errado, mas o
      //    extrato podia, e a auditoria de integridade acusava divergência.
      await debitTokens({
        tx,
        userId: user.id,
        amount: TOKENS_PER_SITE_CREATION,
        description: `Criação do site: ${name}`,
        metadata: { siteId: site.id, subdomain },
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
            expiresAt: expiresAt.toISOString(),
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
        url: `https://${result.subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}`,
      },
    };
  } catch (error) {
    if (isLedgerError(error, 'INSUFFICIENT_TOKENS')) {
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
        ...activeSiteWhere(),
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
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: sites };
  } catch (error) {
    console.error('Erro ao buscar sites:', error);
    return { success: false, error: 'Erro ao buscar sites' };
  }
}
