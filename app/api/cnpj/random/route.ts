import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/utils/rate-limit';
import { brasilAPIService } from '@/services/brasil-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RANDOM_SOURCE_URL =
    process.env.RANDOM_CNPJ_SOURCE_URL?.trim() ||
    'https://verificadordebms.com/api/cnpj/random';
const MAX_ATTEMPTS = 3;
const RANDOM_LIMIT = 10;
const RANDOM_WINDOW_MS = 300_000;

const RandomCnpjResponseSchema = {
    parse(value: unknown): string {
        if (typeof value !== 'object' || value === null) {
            throw new Error('Resposta inválida da fonte de CNPJ aleatório');
        }

        const cnpj = (value as { cnpj?: unknown }).cnpj;
        if (typeof cnpj !== 'string' || cnpj.replace(/\D/g, '').length !== 14) {
            throw new Error('A fonte não retornou um CNPJ válido');
        }

        return cnpj.replace(/\D/g, '');
    },
};

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const limit = await rateLimit(
        `cnpj-random:${session.user.id}`,
        RANDOM_LIMIT,
        RANDOM_WINDOW_MS,
    );

    if (!limit.success) {
        return NextResponse.json(
            { error: 'Muitos sorteios. Aguarde alguns minutos.' },
            { status: 429 },
        );
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
            const sourceResponse = await fetch(RANDOM_SOURCE_URL, {
                cache: 'no-store',
                signal: AbortSignal.timeout(8_000),
            });

            if (!sourceResponse.ok) continue;

            const sourcePayload: unknown = await sourceResponse.json();
            const cnpj = RandomCnpjResponseSchema.parse(sourcePayload);
            const info = await brasilAPIService.checkCNPJ(cnpj);

            if (!info.isActive) continue;

            return NextResponse.json(
                {
                    cnpj: info.cnpj,
                    realPublicRecord: true,
                    source: 'RECEITA_FEDERAL_DADOS_ABERTOS',
                },
                { headers: { 'Cache-Control': 'no-store' } },
            );
        } catch {
            // Tenta outro registro quando a fonte ou a consulta cadastral falhar.
        }
    }

    return NextResponse.json(
        { error: 'Não foi possível obter um CNPJ ativo agora. Tente novamente.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
}
