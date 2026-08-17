/**
 * DIAGNÓSTICO TEMPORÁRIO — apague esta rota depois de resolver o MissingSecret.
 *
 * Existe para responder o que os logs não dizem: qual commit está no ar e o que
 * o runtime realmente enxerga em `process.env`. Nenhum valor de segredo é
 * devolvido — só presença, tamanho e uma impressão digital curta, o suficiente
 * para comparar dois ambientes sem expor a chave.
 *
 * Fica fora do middleware: o matcher em middleware.ts exclui /api.
 */

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { config as authConfig } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Presença e tamanho, nunca o valor. O prefixo do hash só serve para comparar. */
function inspect(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
    return { presente: false, tamanho: 0, impressao: null };
  }

  return {
    presente: true,
    tamanho: value.length,
    impressao: createHash('sha256').update(value).digest('hex').slice(0, 8),
  };
}

export async function GET() {
  return NextResponse.json(
    {
      // Responde "o deploy no ar já tem minha correção?"
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      ambiente: process.env.VERCEL_ENV ?? null,

      // O que o runtime lê do ambiente.
      env: {
        AUTH_SECRET: inspect(process.env.AUTH_SECRET),
        NEXTAUTH_SECRET: inspect(process.env.NEXTAUTH_SECRET),
        DATABASE_URL: inspect(process.env.DATABASE_URL),
        DATABASE_URL_UNPOOLED: inspect(process.env.DATABASE_URL_UNPOOLED),
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,
      },

      // O que chegou de fato na config do next-auth. Se `env` acima mostrar o
      // segredo presente e isto não, o problema é a montagem da config.
      configDoNextAuth: {
        secret: inspect(authConfig.secret),
        trustHost: authConfig.trustHost ?? null,
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
