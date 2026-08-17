import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit, getClientIp } from '@/lib/utils/rate-limit';
import { normalizeSubdomain, suggestSubdomains, validateSubdomain } from '@/lib/subdomain';

const CheckSubdomainSchema = z.object({
  subdomain: z.string().min(1).max(80),
});

/**
 * A unique constraint de Site.subdomain é global e continua valendo para sites
 * com isDeleted: true — filtrar soft delete aqui faria o assistente prometer um
 * subdomínio que createSite recusaria com P2002.
 */
const isTaken = async (subdomain: string): Promise<boolean> => {
  const existing = await prisma.site.findFirst({
    where: { subdomain },
    select: { id: true },
  });

  return existing !== null;
};

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const ip = await getClientIp();
  const { success } = await rateLimit(`subdomain:${ip}`, 60, 60000); // 60 / min

  if (!success) {
    return NextResponse.json(
      { error: 'Muitas verificações. Aguarde um minuto.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 });
  }

  const parsed = CheckSubdomainSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Subdomínio inválido' }, { status: 400 });
  }

  const normalized = normalizeSubdomain(parsed.data.subdomain);
  const validation = validateSubdomain(normalized);

  if (!validation.valid) {
    return NextResponse.json({
      success: true,
      data: {
        normalized,
        available: false,
        reason: validation.reason,
        suggestions: [],
      },
    });
  }

  try {
    if (await isTaken(normalized)) {
      // A resposta nunca diz de quem é o site — só se dá para usar ou não.
      return NextResponse.json({
        success: true,
        data: {
          normalized,
          available: false,
          reason: 'Este subdomínio já está em uso',
          suggestions: await suggestSubdomains(normalized, isTaken),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { normalized, available: true, suggestions: [] },
    });
  } catch (error) {
    console.error('Erro ao verificar subdomínio:', error);
    return NextResponse.json({ error: 'Erro ao verificar subdomínio' }, { status: 500 });
  }
}
