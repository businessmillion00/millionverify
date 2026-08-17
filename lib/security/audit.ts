import { headers } from 'next/headers';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { extractClientIp } from '@/lib/utils/rate-limit';

/**
 * Ponto único de gravação de AuditLog.
 *
 * Antes disto o `prisma.auditLog.create` estava copiado em payment.ts, site.ts, admin.ts,
 * auth.ts e no webhook — e nenhum deles preenchia ipAddress/userAgent, que existem no schema.
 */

/**
 * Ações já usadas no projeto. app/admin/page.tsx lista `log.action` cru na tabela, então
 * mudar qualquer string existente quebra a leitura do painel.
 * A união com `string & Record<never, never>` mantém o autocomplete das ações conhecidas sem
 * impedir ações novas (a intersecção não colapsa para `string`, que apagaria as sugestões).
 */
export type KnownAuditAction =
  | 'USER_REGISTERED'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_VALUE_MISMATCH'
  | 'PAYMENT_REFUND_SHORTFALL'
  | 'SITE_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNT_DEACTIVATED'
  | 'ADMIN_ADJUST_BALANCE'
  | 'ADMIN_SET_ROLE'
  | 'SEED_EXECUTED';

export type AuditAction = KnownAuditAction | (string & Record<never, never>);
export type AuditResource = 'payment' | 'site' | 'user' | 'system';
export type AuditStatus = 'success' | 'error';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RecordAuditParams {
  /** FK obrigatória. Em ação administrativa grave o id do ADMIN e o alvo em `resourceId`. */
  userId: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  changes?: Prisma.InputJsonValue;
  status?: AuditStatus;
  errorMessage?: string;
  /** Passe o client da transação para o log entrar/sair junto com a operação de negócio. */
  tx?: Prisma.TransactionClient;
}

const MAX_USER_AGENT_LENGTH = 512;

/** ip/user-agent só existem em escopo de request; em cron/seed devolve nulos. */
export async function captureRequestContext(): Promise<RequestContext> {
  try {
    const headersList = await headers();

    return {
      ipAddress: extractClientIp(headersList),
      userAgent: headersList.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    };
  } catch {
    // headers() lança fora do escopo de request. Auditoria de job não tem ip nem UA.
    return { ipAddress: null, userAgent: null };
  }
}

export async function recordAudit(params: RecordAuditParams): Promise<void> {
  const { tx, changes, status = 'success', errorMessage, userId, action, resource, resourceId } =
    params;

  const context = await captureRequestContext();

  const data: Prisma.AuditLogUncheckedCreateInput = {
    userId,
    action,
    resource,
    resourceId,
    status,
    errorMessage: errorMessage ?? null,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    ...(changes !== undefined ? { changes } : {}),
  };

  if (tx) {
    // Dentro de transação o erro PRECISA propagar: sem trilha, o rollback é o certo.
    await tx.auditLog.create({ data });
    return;
  }

  try {
    await prisma.auditLog.create({ data });
  } catch (error) {
    // Fora de transação a auditoria nunca derruba a operação de negócio já concluída.
    console.error('Falha ao gravar AuditLog:', { action, resource, resourceId }, error);
  }
}
