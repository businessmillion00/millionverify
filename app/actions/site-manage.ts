'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { normalizeSubdomain } from '@/lib/subdomain';
import { APP_CONFIG } from '@/lib/constants';
import {
  isDomainAutomationConfigured,
  removeProjectDomain,
} from '@/services/vercel-domains';

/**
 * Chaves de template aceitas. Duplica a lista de components/site-templates/types
 * porque um arquivo 'use server' só pode exportar funções async — nada de
 * reexportar a constante daqui.
 */
const TEMPLATE_KEYS = ['minimal', 'corporate', 'bold'] as const;

const DEFAULT_THEME = { bgColor: '#121212', accentColor: '#F59E0B' } as const;

/** O valor da verificação da Meta é opaco; só barramos o que quebraria o HTML. */
const META_TAG_PATTERN = /^[A-Za-z0-9._:-]{4,200}$/;

const SiteIdSchema = z.string().cuid('Site inválido');

const UpdateDetailsSchema = z.object({
  siteId: SiteIdSchema,
  name: z
    .string()
    .trim()
    .min(3, 'Nome deve ter no mínimo 3 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  description: z
    .string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .nullish(),
  metaTag: z.string().max(500, 'Meta tag muito longa').nullish(),
});

const PublishSchema = z.object({
  siteId: SiteIdSchema,
  published: z.boolean(),
});

const TemplateSchema = z.object({
  siteId: SiteIdSchema,
  template: z.enum(TEMPLATE_KEYS, { errorMap: () => ({ message: 'Template inválido' }) }),
});

const DeleteSchema = z.object({
  siteId: SiteIdSchema,
  confirmation: z.string().nullish(),
});

const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * O cron compara a string crua dentro do HTML servido. Se o usuário colar a tag
 * inteira, o Next escaparia as aspas dentro do atributo `content` e a
 * verificação nunca passaria — então guardamos apenas o valor.
 */
const extractMetaTagContent = (raw: string): string => {
  const match = raw.match(/content=["']([^"']+)["']/i);
  return (match ? match[1] : raw).trim();
};

const toJsonObject = (value: Prisma.JsonValue): Prisma.InputJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};

const revalidateSite = (siteId: string) => {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/sites');
  revalidatePath(`/dashboard/sites/${siteId}`);
};

export async function updateSiteDetails(input: unknown) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = UpdateDetailsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const userId = session.user.id;
    const { siteId, name } = parsed.data;
    const description = emptyToNull(parsed.data.description);
    const rawMetaTag = emptyToNull(parsed.data.metaTag);
    const metaTag = rawMetaTag === null ? null : extractMetaTagContent(rawMetaTag);

    if (metaTag !== null && !META_TAG_PATTERN.test(metaTag)) {
      return {
        success: false,
        error: 'Código de verificação inválido. Cole apenas o valor de content="...".',
      };
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.site.findFirst({
        where: { id: siteId, userId, isDeleted: false },
        select: { metaTag: true },
      });

      if (!current) throw new Error('SITE_NOT_FOUND');

      // Trocar o código invalida a última checagem: o cron precisa reconferir o
      // HTML antes de a UI voltar a dizer "tag ativa".
      const metaTagChanged = (current.metaTag ?? null) !== metaTag;

      const { count } = await tx.site.updateMany({
        where: { id: siteId, userId, isDeleted: false },
        data: {
          name,
          description,
          metaTag,
          ...(metaTagChanged ? { metaTagVerified: false, metaTagLastCheckedAt: null } : {}),
        },
      });

      if (count === 0) throw new Error('SITE_NOT_FOUND');

      await tx.auditLog.create({
        data: {
          userId,
          action: 'SITE_UPDATED',
          resource: 'site',
          resourceId: siteId,
          changes: { name, description, metaTagChanged },
          status: 'success',
        },
      });
    });

    revalidateSite(siteId);
    return { success: true, message: 'Dados atualizados' };
  } catch (error) {
    if (error instanceof Error && error.message === 'SITE_NOT_FOUND') {
      return { success: false, error: 'Site não encontrado' };
    }
    console.error('Erro ao atualizar site:', error);
    return { success: false, error: 'Erro ao atualizar site' };
  }
}

export async function setSitePublished(input: unknown) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = PublishSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const userId = session.user.id;
    const { siteId, published } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.site.updateMany({
        where: { id: siteId, userId, isDeleted: false },
        data: { isPublished: published },
      });

      if (count === 0) throw new Error('SITE_NOT_FOUND');

      await tx.auditLog.create({
        data: {
          userId,
          action: published ? 'SITE_PUBLISHED' : 'SITE_UNPUBLISHED',
          resource: 'site',
          resourceId: siteId,
          changes: { isPublished: published },
          status: 'success',
        },
      });
    });

    revalidateSite(siteId);
    return {
      success: true,
      data: { isPublished: published },
      message: published ? 'Site publicado' : 'Site despublicado',
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'SITE_NOT_FOUND') {
      return { success: false, error: 'Site não encontrado' };
    }
    console.error('Erro ao alterar publicação do site:', error);
    return { success: false, error: 'Erro ao alterar publicação do site' };
  }
}

export async function setSiteTemplate(input: unknown) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = TemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const userId = session.user.id;
    const { siteId, template } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const current = await tx.site.findFirst({
        where: { id: siteId, userId, isDeleted: false },
        select: { theme: true },
      });

      if (!current) throw new Error('SITE_NOT_FOUND');

      // theme é Json e o Prisma substitui o valor inteiro: sem ler antes,
      // gravar o template apagaria bgColor/accentColor usados na página pública.
      const theme: Prisma.InputJsonObject = {
        ...DEFAULT_THEME,
        ...toJsonObject(current.theme),
        template,
      };

      const { count } = await tx.site.updateMany({
        where: { id: siteId, userId, isDeleted: false },
        data: { theme },
      });

      if (count === 0) throw new Error('SITE_NOT_FOUND');

      await tx.auditLog.create({
        data: {
          userId,
          action: 'SITE_TEMPLATE_CHANGED',
          resource: 'site',
          resourceId: siteId,
          changes: { template },
          status: 'success',
        },
      });
    });

    revalidateSite(siteId);
    return { success: true, data: { template }, message: 'Template atualizado' };
  } catch (error) {
    if (error instanceof Error && error.message === 'SITE_NOT_FOUND') {
      return { success: false, error: 'Site não encontrado' };
    }
    console.error('Erro ao trocar template do site:', error);
    return { success: false, error: 'Erro ao trocar template do site' };
  }
}

export async function deleteSite(input: unknown) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = DeleteSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const userId = session.user.id;
    const { siteId } = parsed.data;
    const confirmation = normalizeSubdomain(parsed.data.confirmation ?? '');

    const excluido = await prisma.$transaction(async (tx) => {
      const current = await tx.site.findFirst({
        where: { id: siteId, userId, isDeleted: false },
        select: { name: true, subdomain: true, customDomain: true },
      });

      if (!current) throw new Error('SITE_NOT_FOUND');
      if (confirmation !== current.subdomain) throw new Error('INVALID_CONFIRMATION');

      // Exclusão lógica: o subdomínio segue ocupado pela unique constraint.
      const { count } = await tx.site.updateMany({
        where: { id: siteId, userId, isDeleted: false },
        data: { isDeleted: true, isPublished: false },
      });

      if (count === 0) throw new Error('SITE_NOT_FOUND');

      await tx.auditLog.create({
        data: {
          userId,
          action: 'SITE_DELETED',
          resource: 'site',
          resourceId: siteId,
          changes: { name: current.name, subdomain: current.subdomain },
          status: 'success',
        },
      });

      return current;
    });

    /*
     * Limpeza do domínio FORA da transação: é chamada de rede, e mantê-la
     * dentro seguraria a transação aberta esperando I/O. A função não lança —
     * um domínio órfão no painel da Vercel é irritante, não é motivo para a
     * exclusão do site falhar depois de já estar gravada.
     */
    if (!excluido.customDomain && isDomainAutomationConfigured()) {
      await removeProjectDomain(`${excluido.subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}`);
    }

    revalidateSite(siteId);
    return { success: true, message: 'Site excluído' };
  } catch (error) {
    if (error instanceof Error && error.message === 'SITE_NOT_FOUND') {
      return { success: false, error: 'Site não encontrado' };
    }
    if (error instanceof Error && error.message === 'INVALID_CONFIRMATION') {
      return {
        success: false,
        error: 'Digite o subdomínio exatamente como aparece para confirmar a exclusão',
      };
    }
    console.error('Erro ao excluir site:', error);
    return { success: false, error: 'Erro ao excluir site' };
  }
}

/* ============ ADAPTADORES DE <form action> ============
   A página de edição é um server component: os formulários chamam estas
   funções direto e o resultado volta pela querystring (?ok= / ?erro=), sem
   precisar de client component só para exibir a mensagem. */

const formValue = (formData: FormData, key: string): string | null => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : null;
};

const feedbackUrl = (
  siteId: string,
  result: { success: boolean; error?: string; message?: string },
): string => {
  const base = siteId ? `/dashboard/sites/${siteId}` : '/dashboard/sites';

  return result.success
    ? `${base}?ok=${encodeURIComponent(result.message ?? 'Alterações salvas')}`
    : `${base}?erro=${encodeURIComponent(result.error ?? 'Não foi possível concluir a operação')}`;
};

export async function updateSiteDetailsForm(formData: FormData) {
  const siteId = formValue(formData, 'siteId') ?? '';

  const result = await updateSiteDetails({
    siteId,
    name: formValue(formData, 'name') ?? '',
    description: formValue(formData, 'description'),
    metaTag: formValue(formData, 'metaTag'),
  });

  redirect(feedbackUrl(siteId, result));
}

export async function setSitePublishedForm(formData: FormData) {
  const siteId = formValue(formData, 'siteId') ?? '';

  const result = await setSitePublished({
    siteId,
    published: formValue(formData, 'published') === 'true',
  });

  redirect(feedbackUrl(siteId, result));
}

export async function setSiteTemplateForm(formData: FormData) {
  const siteId = formValue(formData, 'siteId') ?? '';

  const result = await setSiteTemplate({
    siteId,
    template: formValue(formData, 'template') ?? '',
  });

  redirect(feedbackUrl(siteId, result));
}

export async function deleteSiteForm(formData: FormData) {
  const siteId = formValue(formData, 'siteId') ?? '';

  const result = await deleteSite({
    siteId,
    confirmation: formValue(formData, 'confirmation'),
  });

  if (!result.success) {
    redirect(feedbackUrl(siteId, result));
  }

  redirect(`/dashboard/sites?ok=${encodeURIComponent('Site excluído')}`);
}
