import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateCnpjCartao, registryDataToCartao } from '@/lib/cnpj-pdf-generator';
import { recordAudit } from '@/lib/security/audit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { withSecurityHeaders } from '@/lib/security/headers';
import { rateLimit, rateLimitResponse } from '@/lib/utils/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const FILE_FIELD = 'file';
const FILE_FIELD_ALT = 'documento';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DOCUMENT_FILENAME = 'comprovante-cnpj.pdf';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PDF_SIGNATURE = /^%PDF-\d\.\d/;

const UPLOAD_LIMIT = 5;
const UPLOAD_WINDOW_MS = 3_600_000;
const DOWNLOAD_LIMIT = 60;
const DOWNLOAD_WINDOW_MS = 60_000;
const DELETE_LIMIT = 10;
const DELETE_WINDOW_MS = 3_600_000;
const ISSUE_LIMIT = 15;
const ISSUE_WINDOW_MS = 3_600_000;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/* ────────────────────────────── POST — recebe o PDF ou gera ──────────────────── */

export async function POST(request: NextRequest, context: Context) {
  // Verificar se é upload de arquivo (multipart) ou geração automática (JSON)
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    // Upload manual de PDF
    return handleUpload(request, context);
  }

  // Geração automática do Cartão CNPJ (como o site original faz)
  return handleGenerate(request, context);
}

/* ── Upload manual ── */
async function handleUpload(request: NextRequest, context: Context): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ success: false, error: 'Não autenticado' }, 401);
  }

  if (!assertSameOrigin(request)) {
    return json({ success: false, error: 'Origem não permitida' }, 403);
  }

  const limit = await rateLimit(
    `site-cnpj-document-upload:${session.user.id}`,
    UPLOAD_LIMIT,
    UPLOAD_WINDOW_MS,
  );

  if (!limit.success) {
    return withSecurityHeaders(
      rateLimitResponse(limit, 'Muitos envios de comprovante. Tente novamente mais tarde.'),
    );
  }

  const { id } = await context.params;

  const site = await findOwnedSite(id, session.user.id);
  if (!site) {
    return json({ success: false, error: 'Site não encontrado' }, 404);
  }

  const target = documentPath(site.id);
  if (!target) {
    console.error(`[cnpj-document] Identificador de site fora do formato esperado: ${site.id}`);
    return json({ success: false, error: 'Não foi possível armazenar o arquivo' }, 500);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(
      { success: false, error: 'Envie o arquivo como multipart/form-data.' },
      400,
    );
  }

  const entry = form.get(FILE_FIELD) ?? form.get(FILE_FIELD_ALT);

  if (entry === null || typeof entry === 'string') {
    return json(
      { success: false, error: `Nenhum arquivo recebido no campo "${FILE_FIELD}".` },
      400,
    );
  }

  if (entry.size === 0) {
    return json({ success: false, error: 'O arquivo enviado está vazio.' }, 400);
  }

  if (entry.size > MAX_FILE_BYTES) {
    return json(
      { success: false, error: `O arquivo excede o limite de ${formatMegabytes(MAX_FILE_BYTES)}.` },
      413,
    );
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());

  if (!isPdf(bytes)) {
    return json(
      { success: false, error: 'Envie um PDF válido.' },
      415,
    );
  }

  const uploadedAt = new Date();
  const documentUrl = `/api/sites/${site.id}/cnpj-document`;
  const temporary = `${target}.${randomUUID()}.tmp`;

  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    console.error(`[cnpj-document] Falha ao gravar o comprovante do site ${site.id}:`, error);
    await rm(temporary, { force: true }).catch(() => undefined);
    return json({ success: false, error: 'Não foi possível armazenar o arquivo' }, 500);
  }

  const { count } = await prisma.site.updateMany({
    where: { id: site.id, userId: session.user.id, isDeleted: false },
    data: { cnpjDocumentUrl: documentUrl, cnpjDocumentAt: uploadedAt },
  });

  if (count === 0) {
    await discardStoredDocument(site.id);
    return json({ success: false, error: 'Site não encontrado' }, 404);
  }

  await recordAudit({
    userId: session.user.id,
    action: 'SITE_CNPJ_DOCUMENT_UPLOADED',
    resource: 'site',
    resourceId: site.id,
    changes: { sizeBytes: bytes.byteLength },
  });

  return json(
    {
      success: true,
      data: {
        url: documentUrl,
        uploadedAt: uploadedAt.toISOString(),
        sizeBytes: bytes.byteLength,
      },
    },
    200,
  );
}

/* ── Geração automática do Cartão CNPJ ── */
async function handleGenerate(request: NextRequest, context: Context): Promise<NextResponse> {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return json({ success: false, error: 'Não autenticado' }, 401);
    }

    if (!assertSameOrigin(request)) {
      return json({ success: false, error: 'Origem não permitida' }, 403);
    }

    const limit = await rateLimit(
      `site-cnpj-document-issue:${session.user.id}`,
      ISSUE_LIMIT,
      ISSUE_WINDOW_MS,
    );

    if (!limit.success) {
      return withSecurityHeaders(
        rateLimitResponse(limit, 'Muitas emissões do cartão CNPJ. Tente novamente mais tarde.'),
      );
    }

    const { id } = await context.params;

    if (!id) {
      return json({ success: false, error: 'ID do site não fornecido' }, 400);
    }

    // Buscar site com registryData (dados cadastrais completos da Receita)
    const site = await prisma.site.findFirst({
      where: { id, userId: session.user.id, isDeleted: false },
      select: { id: true, cnpj: true, companyName: true, registryData: true, cnpjDocumentUrl: true },
    });

    if (!site) {
      return json({ success: false, error: 'Site não encontrado' }, 404);
    }

    // Se já existe um PDF anexado manualmente, entregar esse (precedência)
    if (site.cnpjDocumentUrl) {
      return deliverStoredDocument(site.id, session.user.id, site.cnpj);
    }

    // Gerar o Cartão CNPJ localmente com pdf-lib
    const registryData = site.registryData ? (site.registryData as Record<string, unknown>) : {};

    // Converter registryData para o formato do gerador
    // Se registryData estiver vazio, usa os dados básicos do Site como fallback
    const cartaoData = Object.keys(registryData).length > 0
      ? registryDataToCartao(registryData)
      : {
        cnpj: site.cnpj || '',
        companyName: site.companyName || '',
        tradeName: '',
        legalNature: '',
        openingDate: '',
        situation: '',
        situationDate: '',
        situationReason: '',
        cnaeCode: '',
        cnaeDescription: '',
        secondaryCnaes: [],
        address: undefined,
        phone: '',
        email: '',
        capital: '',
        porte: '',
        isMatrix: true,
      };

    // Garantir campos mínimos
    if (!cartaoData.cnpj || !cartaoData.companyName) {
      // Fallback: usar dados básicos do Site
      cartaoData.cnpj = site.cnpj;
      cartaoData.companyName = site.companyName;
    }

    // Gerar o PDF
    const pdfBytes = await generateCnpjCartao(cartaoData);

    if (!pdfBytes || pdfBytes.byteLength === 0) {
      throw new Error('Falha ao gerar o PDF do cartão CNPJ');
    }

    await recordAudit({
      userId: session.user.id,
      action: 'SITE_CNPJ_DOCUMENT_ISSUED',
      resource: 'site',
      resourceId: site.id,
      changes: { sizeBytes: pdfBytes.byteLength },
    });

    const digits = cartaoData.cnpj.replace(/\D/g, '');
    const safeName = cartaoData.companyName
      .replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const fileName = `CARTAO_CNPJ_${safeName}_${digits}.pdf`;

    return pdfResponse(pdfBytes, fileName);
  } catch (error) {
    console.error('[cnpj-document] Erro ao gerar cartão CNPJ:', error);
    return json(
      { success: false, error: 'Erro interno ao gerar o documento. Tente novamente.' },
      500,
    );
  }
}

/* ─────────────────────────── GET — devolve o PDF ao dono ──────────────────────── */

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return json({ success: false, error: 'Não autenticado' }, 401);
    }

    const { id } = await context.params;

    if (!id) {
      return json({ success: false, error: 'ID do site não fornecido' }, 400);
    }

    /*
     * Consulta própria em vez de `findOwnedSite`: só o GET precisa de
     * companyName e registryData, e registryData é uma coluna pesada que POST e
     * DELETE não têm por que carregar.
     */
    const site = await prisma.site.findFirst({
      where: { id, userId: session.user.id, isDeleted: false },
      select: {
        id: true,
        cnpj: true,
        companyName: true,
        registryData: true,
        cnpjDocumentUrl: true,
      },
    });

    if (!site) {
      return json({ success: false, error: 'Site não encontrado' }, 404);
    }

    // Se existe PDF anexado manualmente, entregar
    if (site.cnpjDocumentUrl) {
      return deliverStoredDocument(site.id, session.user.id, site.cnpj);
    }

    // Se não existe, gerar automaticamente
    const registryData = site.registryData ? (site.registryData as Record<string, unknown>) : {};

    // Usar registryData se disponível, senão fallback para dados básicos do Site
    const cartaoData = Object.keys(registryData).length > 0
      ? registryDataToCartao(registryData)
      : {
        cnpj: site.cnpj || '',
        companyName: site.companyName || '',
        tradeName: '',
        legalNature: '',
        openingDate: '',
        situation: '',
        situationDate: '',
        situationReason: '',
        cnaeCode: '',
        cnaeDescription: '',
        secondaryCnaes: [],
        address: undefined,
        phone: '',
        email: '',
        capital: '',
        porte: '',
        isMatrix: true,
      };
    if (!cartaoData.cnpj || !cartaoData.companyName) {
      cartaoData.cnpj = site.cnpj;
      cartaoData.companyName = site.companyName;
    }

    const pdfBytes = await generateCnpjCartao(cartaoData);

    if (!pdfBytes || pdfBytes.byteLength === 0) {
      throw new Error('Falha ao gerar o PDF');
    }

    const digits = cartaoData.cnpj.replace(/\D/g, '');
    const safeName = cartaoData.companyName
      .replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const fileName = `CARTAO_CNPJ_${safeName}_${digits}.pdf`;

    return pdfResponse(pdfBytes, fileName);
  } catch (error) {
    console.error('[cnpj-document] Erro inesperado no GET:', error);
    return json(
      { success: false, error: 'Erro interno do servidor. Tente novamente.' },
      500,
    );
  }
}

/* ─────────────────────── DELETE — remove arquivo e colunas ────────────────────── */

export async function DELETE(request: NextRequest, context: Context) {
  const session = await auth();

  if (!session?.user?.id) {
    return json({ success: false, error: 'Não autenticado' }, 401);
  }

  if (!assertSameOrigin(request)) {
    return json({ success: false, error: 'Origem não permitida' }, 403);
  }

  const limit = await rateLimit(
    `site-cnpj-document-delete:${session.user.id}`,
    DELETE_LIMIT,
    DELETE_WINDOW_MS,
  );

  if (!limit.success) {
    return withSecurityHeaders(rateLimitResponse(limit));
  }

  const { id } = await context.params;

  const site = await findOwnedSite(id, session.user.id);
  if (!site) {
    return json({ success: false, error: 'Site não encontrado' }, 404);
  }

  const { count } = await prisma.site.updateMany({
    where: { id: site.id, userId: session.user.id, isDeleted: false },
    data: { cnpjDocumentUrl: null, cnpjDocumentAt: null },
  });

  if (count === 0) {
    return json({ success: false, error: 'Site não encontrado' }, 404);
  }

  await discardStoredDocument(site.id);

  await recordAudit({
    userId: session.user.id,
    action: 'SITE_CNPJ_DOCUMENT_DELETED',
    resource: 'site',
    resourceId: site.id,
  });

  return json({ success: true, data: { url: null, uploadedAt: null } }, 200);
}

/* ────────────────────────────────── auxiliares ────────────────────────────────── */

async function findOwnedSite(siteId: string, userId: string) {
  return prisma.site.findFirst({
    where: { id: siteId, userId, isDeleted: false },
    select: { id: true, cnpj: true, cnpjDocumentUrl: true, cnpjDocumentAt: true },
  });
}

/** Entrega o PDF previamente armazenado pelo usuário. */
async function deliverStoredDocument(
  siteId: string,
  userId: string,
  cnpj: string,
): Promise<NextResponse> {
  const rateLimitResult = await rateLimit(
    `site-cnpj-document-read:${userId}`,
    DOWNLOAD_LIMIT,
    DOWNLOAD_WINDOW_MS,
  );
  if (!rateLimitResult.success) {
    return withSecurityHeaders(rateLimitResponse(rateLimitResult));
  }

  const target = documentPath(siteId);
  if (!target) {
    return json({ success: false, error: 'Comprovante indisponível' }, 404);
  }

  let stored: Buffer;
  try {
    stored = await readFile(target);
  } catch {
    return json(
      { success: false, error: 'O comprovante não está mais disponível. Envie o arquivo novamente.' },
      404,
    );
  }

  return pdfResponse(new Uint8Array(stored), DOCUMENT_FILENAME);
}

/** Copia para um ArrayBuffer próprio: o Buffer do Node é uma view de um pool. */
function pdfResponse(bytes: Uint8Array, filename: string): NextResponse {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);

  return withSecurityHeaders(
    new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...NO_STORE,
      },
    }),
  );
}

function uploadRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'uploads');
}

function documentPath(siteId: string): string | null {
  if (!SAFE_ID.test(siteId)) return null;

  const root = uploadRoot();
  const target = path.resolve(root, siteId, DOCUMENT_FILENAME);

  return target.startsWith(root + path.sep) ? target : null;
}

async function discardStoredDocument(siteId: string): Promise<void> {
  if (!SAFE_ID.test(siteId)) return;

  const root = uploadRoot();
  const directory = path.resolve(root, siteId);

  if (!directory.startsWith(root + path.sep)) return;

  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    console.error(`[cnpj-document] Falha ao remover o comprovante do site ${siteId}:`, error);
  }
}

function isPdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  return PDF_SIGNATURE.test(Buffer.from(bytes.subarray(0, 8)).toString('latin1'));
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function json(body: Record<string, unknown>, status: number): NextResponse {
  return withSecurityHeaders(NextResponse.json(body, { status, headers: NO_STORE }));
}
