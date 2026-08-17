import { NextRequest, NextResponse } from 'next/server';
import { brasilAPIService } from '@/services/brasil-api';
import { CheckCNPJSchema } from '@/lib/validators/cnpj';
import { rateLimit, getClientIp } from '@/lib/utils/rate-limit';

export async function POST(request: NextRequest) {
  const ip = await getClientIp();
  const { success } = await rateLimit(`cnpj:${ip}`, 20, 300000); // 20 / 5min

  if (!success) {
    return NextResponse.json(
      { error: 'Muitas consultas. Aguarde alguns minutos.' },
      { status: 429 }
    );
  }

  const parsed = CheckCNPJSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 });
  }

  try {
    const info = await brasilAPIService.checkCNPJ(parsed.data.cnpj);
    return NextResponse.json({ success: true, data: info });
  } catch {
    return NextResponse.json(
      { error: 'CNPJ não encontrado na Receita Federal' },
      { status: 404 }
    );
  }
}
