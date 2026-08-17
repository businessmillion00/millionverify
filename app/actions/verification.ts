'use server';

/**
 * Ações da tela de verificação de domínio (/dashboard/sites/[id]/verificacao).
 *
 * Um arquivo 'use server' só pode exportar funções async: padrões, tipos e
 * mensagens vivem em escopo de módulo e NÃO são reexportados. O cliente recebe
 * o que precisa pelo retorno das actions.
 *
 * DIVISÃO DE RESPONSABILIDADE
 *   Aqui  → gravar `metaTag` / `verificationTxt` (o que o usuário digita).
 *   lib/verification/diagnose.ts → executar o diagnóstico e gravar
 *   `lastDiagnostic`, `metaTagVerified` e `metaTagLastCheckedAt`. Reimplementar
 *   o fetch/DNS aqui produziria dois formatos de JSON na mesma coluna e dois
 *   veredictos possíveis para o mesmo site.
 *
 * A gravação da meta tag repete, de propósito, a semântica de `updateSiteDetails`
 * (app/actions/site-manage.ts): extrair o valor de content="...", validar contra o
 * mesmo padrão e zerar a confirmação quando o código muda. Sem esse reset, um
 * código novo herdaria o "verificado" do código antigo — que é exatamente a
 * promessa que o produto não pode quebrar.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { recordAudit } from '@/lib/security/audit';
import { rateLimit } from '@/lib/utils/rate-limit';
import { SITE_RATE_LIMITS } from '@/lib/constants';
import { siteHost } from '@/lib/subdomain';
import {
  DIAGNOSE_SITE_SELECT,
  diagnoseSite,
  persistDiagnostic,
  type DiagnosticOutcome,
} from '@/lib/verification/diagnose';

/* ────────────────────────── contratos de retorno ──────────────────────────
   Uniões discriminadas porque a inferência do Next devolveria `success: boolean`
   e o cliente perderia o narrowing. */

type SavedVerification = {
  metaTag: string | null;
  verificationTxt: string | null;
};

type VerificationReport = {
  host: string;
  /** Instante da checagem já formatado no servidor (evita divergir na hidratação). */
  checkedAtLabel: string;
  httpStatus: number | null;
  latencyMs: number | null;
  reachable: boolean;
  metaTagOutcome: DiagnosticOutcome;
  txtOutcome: DiagnosticOutcome;
  /** false para subdomínio da plataforma: a zona DNS é nossa. */
  txtApplicable: boolean;
  verified: boolean;
  /** true quando nada pôde ser concluído (timeout, rede, DNS instável). */
  inconclusive: boolean;
  /** Linha principal para o usuário. */
  message: string;
  /** Lista humana do que impede a verificação, já em pt-BR, vinda do diagnóstico. */
  problems: string[];
};

type SaveResult =
  | { success: true; message: string; data: SavedVerification }
  | { success: false; error: string };

type RunResult =
  | { success: true; data: VerificationReport }
  | { success: false; error: string };

/* ─────────────────────────────── constantes ─────────────────────────────── */

const DAY_MS = 86_400_000;

/** Mesmo padrão de app/actions/site-manage.ts — o valor da Meta é opaco. */
const META_TAG_PATTERN = /^[A-Za-z0-9._:-]{4,200}$/;

/** Token do TXT: o prefixo é remontado na leitura, aqui guardamos só o valor. */
const TXT_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{4,255}$/;

const TXT_PREFIX = 'facebook-domain-verification';

const SiteIdSchema = z.string().cuid('Site inválido');

const SaveSchema = z.object({
  siteId: SiteIdSchema,
  /** Ausente = não mexe no valor atual. Vazio/null = apaga o código. */
  metaTag: z.string().max(500, 'Meta tag muito longa').nullish(),
  verificationTxt: z.string().max(500, 'Registro TXT muito longo').nullish(),
});

const RunSchema = z.object({ siteId: SiteIdSchema });

/* ──────────────────────────────── helpers ──────────────────────────────── */

const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Aceita a tag inteira (`<meta name="..." content="abc" />`) ou só o valor.
 * Guardamos apenas o valor porque é ele que o diagnóstico compara com o que
 * encontra no <head> publicado.
 */
const extractMetaTagContent = (raw: string): string => {
  const match = raw.match(/content=["']([^"']+)["']/i);
  return (match ? match[1] : raw).trim();
};

/**
 * Aceita `facebook-domain-verification=abc123`, a versão entre aspas (como alguns
 * painéis de DNS exibem) ou só `abc123`.
 */
const extractTxtToken = (raw: string): string => {
  const unquoted = raw.trim().replace(/^["']+|["']+$/g, '').trim();
  const match = unquoted.match(new RegExp(`${TXT_PREFIX}\\s*=\\s*["']?([^"'\\s]+)`, 'i'));
  return (match ? match[1] : unquoted).trim();
};

/**
 * O `revalidateSite` de site-manage.ts é privado do módulo e não conhece a rota
 * nova — daí a lista repetida aqui, incluindo /verificacao.
 */
const revalidateVerification = (siteId: string): void => {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/sites');
  revalidatePath(`/dashboard/sites/${siteId}`);
  revalidatePath(`/dashboard/sites/${siteId}/verificacao`);
};

/* ─────────────────────────────── actions ─────────────────────────────── */

/**
 * Grava o código da meta tag e/ou o token do TXT.
 * Passe `undefined` no campo que não deve ser tocado; string vazia apaga o valor.
 */
export async function saveVerification(input: unknown): Promise<SaveResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = SaveSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const userId = session.user.id;
    const { siteId } = parsed.data;

    // Chave por usuário: em fluxo autenticado o IP é forjável e agrupa gente
    // atrás do mesmo NAT.
    const limit = await rateLimit(
      `verification:save:${userId}`,
      SITE_RATE_LIMITS.CHECK_META_TAG,
      DAY_MS,
    );
    if (!limit.success) {
      return {
        success: false,
        error: 'Você salvou a verificação muitas vezes hoje. Tente novamente mais tarde.',
      };
    }

    let metaTag: string | null | undefined;
    if (parsed.data.metaTag !== undefined) {
      const raw = emptyToNull(parsed.data.metaTag);
      metaTag = raw === null ? null : extractMetaTagContent(raw);

      if (metaTag !== null && !META_TAG_PATTERN.test(metaTag)) {
        return {
          success: false,
          error:
            'Código da meta tag inválido. Cole a tag inteira ou apenas o valor de content="...".',
        };
      }
    }

    let verificationTxt: string | null | undefined;
    if (parsed.data.verificationTxt !== undefined) {
      const raw = emptyToNull(parsed.data.verificationTxt);
      verificationTxt = raw === null ? null : extractTxtToken(raw);

      if (verificationTxt !== null && !TXT_TOKEN_PATTERN.test(verificationTxt)) {
        return {
          success: false,
          error: `Registro TXT inválido. Cole "${TXT_PREFIX}=..." ou apenas o token.`,
        };
      }
    }

    if (metaTag === undefined && verificationTxt === undefined) {
      return { success: false, error: 'Nenhum campo foi enviado para salvar' };
    }

    const saved = await prisma.$transaction(async (tx) => {
      const current = await tx.site.findFirst({
        where: { id: siteId, userId, isDeleted: false },
        select: { metaTag: true, verificationTxt: true },
      });

      if (!current) throw new Error('SITE_NOT_FOUND');

      const metaTagChanged = metaTag !== undefined && (current.metaTag ?? null) !== metaTag;
      const txtChanged =
        verificationTxt !== undefined && (current.verificationTxt ?? null) !== verificationTxt;

      // Invalidação, não diagnóstico: quem grava veredicto é persistDiagnostic.
      // Trocar o código sem zerar o flag deixaria "verificado" um valor que nunca
      // foi conferido — mesmo motivo do reset em site-manage.ts.
      const data: Prisma.SiteUpdateManyMutationInput = {
        ...(metaTag !== undefined ? { metaTag } : {}),
        ...(metaTagChanged ? { metaTagVerified: false, metaTagLastCheckedAt: null } : {}),
        ...(verificationTxt !== undefined ? { verificationTxt } : {}),
        ...(txtChanged
          ? { verificationTxtVerified: false, verificationTxtLastCheckedAt: null }
          : {}),
      };

      const { count } = await tx.site.updateMany({
        where: { id: siteId, userId, isDeleted: false },
        data,
      });

      if (count === 0) throw new Error('SITE_NOT_FOUND');

      await recordAudit({
        userId,
        action: 'SITE_VERIFICATION_UPDATED',
        resource: 'site',
        resourceId: siteId,
        // O token não vai para a trilha: é a credencial que prova a posse do domínio.
        changes: {
          metaTagChanged,
          txtChanged,
          hasMetaTag: metaTag !== undefined ? metaTag !== null : current.metaTag !== null,
          hasVerificationTxt:
            verificationTxt !== undefined
              ? verificationTxt !== null
              : current.verificationTxt !== null,
        },
        tx,
      });

      return {
        metaTag: metaTag === undefined ? (current.metaTag ?? null) : metaTag,
        verificationTxt:
          verificationTxt === undefined ? (current.verificationTxt ?? null) : verificationTxt,
      };
    });

    revalidateVerification(siteId);

    return {
      success: true,
      message: 'Verificação salva. O código já é servido pelo site.',
      data: saved,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'SITE_NOT_FOUND') {
      return { success: false, error: 'Site não encontrado' };
    }

    console.error('Erro ao salvar verificação:', error);
    return { success: false, error: 'Erro ao salvar a verificação' };
  }
}

/**
 * Roda o diagnóstico agora e devolve o resultado para a tela.
 *
 * A checagem inteira é delegada a `diagnoseSite` (HTML para a meta tag, DNS para
 * o TXT) e a gravação a `persistDiagnostic` — a mesma dupla que o monitor em lote
 * usa, para que robô e botão nunca discordem sobre o mesmo site.
 */
export async function runVerification(input: unknown): Promise<RunResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Não autenticado' };
    }

    const parsed = RunSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const userId = session.user.id;
    const { siteId } = parsed.data;

    const limit = await rateLimit(
      `verification:check:${userId}`,
      SITE_RATE_LIMITS.CHECK_META_TAG,
      DAY_MS,
    );
    if (!limit.success) {
      return {
        success: false,
        error: 'Limite de checagens de hoje atingido. O robô continua verificando sozinho.',
      };
    }

    // Busca amarrada ao dono; persistDiagnostic grava por id, então a posse
    // precisa estar provada antes de chamá-lo.
    const site = await prisma.site.findFirst({
      where: { id: siteId, userId, isDeleted: false },
      select: DIAGNOSE_SITE_SELECT,
    });

    if (!site) {
      return { success: false, error: 'Site não encontrado' };
    }

    if (site.metaTag === null && site.verificationTxt === null) {
      return {
        success: false,
        error: 'Salve o código de verificação da Meta antes de checar.',
      };
    }

    const diagnostic = await diagnoseSite(site);
    await persistDiagnostic(siteId, diagnostic);

    const txtApplicable = diagnostic.txt.applicable;
    const metaOk = diagnostic.metaTag.outcome === 'ok';
    const txtOk = txtApplicable && diagnostic.txt.outcome === 'ok';
    const verified = metaOk || txtOk;

    // 'indeterminado' não é "não encontrado": foi impossível concluir. Tratar os
    // dois como a mesma coisa faria uma queda de rede parecer código errado.
    const inconclusive =
      !verified &&
      (diagnostic.metaTag.outcome === 'indeterminado' ||
        (txtApplicable && diagnostic.txt.outcome === 'indeterminado'));

    const checkedAt = new Date(diagnostic.checkedAt);
    const checkedAtLabel = (
      Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt
    ).toLocaleString('pt-BR');

    await recordAudit({
      userId,
      action: 'SITE_VERIFICATION_CHECKED',
      resource: 'site',
      resourceId: siteId,
      changes: {
        httpStatus: diagnostic.httpStatus,
        latencyMs: diagnostic.latencyMs,
        reachable: diagnostic.reachable,
        metaTagOutcome: diagnostic.metaTag.outcome,
        txtOutcome: diagnostic.txt.outcome,
        txtApplicable,
        problems: diagnostic.problems.length,
        source: 'manual',
      },
      status: inconclusive ? 'error' : 'success',
      errorMessage: inconclusive ? (diagnostic.error ?? 'Diagnóstico inconclusivo') : undefined,
    });

    revalidateVerification(siteId);

    return {
      success: true,
      data: {
        host: siteHost(site),
        checkedAtLabel,
        httpStatus: diagnostic.httpStatus,
        latencyMs: diagnostic.latencyMs,
        reachable: diagnostic.reachable,
        metaTagOutcome: diagnostic.metaTag.outcome,
        txtOutcome: diagnostic.txt.outcome,
        txtApplicable,
        verified,
        inconclusive,
        message: buildMessage({ verified, inconclusive, metaOk, txtOk }),
        problems: diagnostic.problems,
      },
    };
  } catch (error) {
    console.error('Erro ao verificar site:', error);
    return { success: false, error: 'Erro ao rodar a verificação' };
  }
}

/* ───────────────────────── mensagem do diagnóstico ───────────────────────── */

function buildMessage({
  verified,
  inconclusive,
  metaOk,
  txtOk,
}: {
  verified: boolean;
  inconclusive: boolean;
  metaOk: boolean;
  txtOk: boolean;
}): string {
  if (verified) {
    if (metaOk && txtOk) {
      return 'Meta tag e registro TXT confirmados. A Meta já consegue verificar o domínio.';
    }
    if (metaOk) {
      return 'Meta tag encontrada no <head> do site. A Meta já consegue ler o código.';
    }
    return 'Registro TXT encontrado na zona DNS. A Meta já consegue ler o código.';
  }

  if (inconclusive) {
    return 'Não deu para concluir agora — o resultado anterior foi mantido. Tente de novo em instantes.';
  }

  return 'O código ainda não está sendo servido no seu endereço.';
}
