/**
 * Comprovante de Inscrição e de Situação Cadastral — o "cartão CNPJ" emitido
 * pela Receita Federal.
 *
 * A Receita não expõe API pública para isso: a emissão em
 * solucoes.receita.fazenda.gov.br é protegida por captcha justamente para
 * impedir automação. O PDF oficial vem então pelo CNPJá, que faz a consulta
 * on-line e devolve o comprovante emitido pela própria Receita.
 *
 * Cada emissão consome 1 crédito da conta CNPJá — por isso a rota que chama
 * daqui limita a frequência por usuário.
 */

const CERTIFICATE_URL = 'https://api.cnpja.com/rfb/certificate';
const TIMEOUT_MS = 30_000;
const PDF_SIGNATURE = /^%PDF-\d\.\d/;

/** REGISTRATION é o comprovante em si; MEMBERS acrescenta o quadro societário. */
export type CertificatePage = 'REGISTRATION' | 'MEMBERS';

export type CertificateFailureReason =
  | 'not-configured'
  | 'invalid-cnpj'
  | 'not-found'
  | 'quota'
  | 'timeout'
  | 'upstream';

export type CertificateResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; reason: CertificateFailureReason; status: number; message: string };

/** Permite à rota distinguir "não configurado" de "falhou" antes de gastar crédito. */
export function isCertificateConfigured(): boolean {
  return Boolean(process.env.CNPJA_API_KEY?.trim());
}

/**
 * Baixa o comprovante oficial em PDF. Nunca lança: toda falha vira um resultado
 * com `status` HTTP e mensagem já pronta para o usuário final.
 */
export async function fetchCnpjCertificate(
  cnpj: string,
  pages: CertificatePage[] = ['REGISTRATION'],
): Promise<CertificateResult> {
  const apiKey = process.env.CNPJA_API_KEY?.trim();

  if (!apiKey) {
    return {
      ok: false,
      reason: 'not-configured',
      status: 503,
      message:
        'A emissão automática do cartão CNPJ não está configurada. Baixe o comprovante no site da Receita Federal e anexe-o aqui.',
    };
  }

  const digits = cnpj.replace(/\D/g, '');

  if (digits.length !== 14) {
    return {
      ok: false,
      reason: 'invalid-cnpj',
      status: 400,
      message: 'O CNPJ cadastrado neste site está incompleto.',
    };
  }

  const url = `${CERTIFICATE_URL}?taxId=${digits}&pages=${pages.join(',')}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: apiKey, Accept: 'application/pdf' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error('[cnpj-certificate] Falha de rede ao emitir o comprovante:', error);

    return {
      ok: false,
      reason: timedOut ? 'timeout' : 'upstream',
      status: 504,
      message: timedOut
        ? 'A Receita Federal demorou demais para responder. Tente novamente em instantes.'
        : 'Não foi possível falar com a Receita Federal agora. Tente novamente em instantes.',
    };
  }

  if (!response.ok) {
    // O corpo do erro é JSON e ajuda no log, mas nunca vai para o usuário: pode
    // conter detalhes da conta do provedor.
    const detail = await response.text().catch(() => '');
    console.error(
      `[cnpj-certificate] Provedor respondeu ${response.status} para o CNPJ ${digits}: ${detail.slice(0, 300)}`,
    );

    return describeUpstreamFailure(response.status);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!looksLikePdf(bytes)) {
    console.error(
      `[cnpj-certificate] Resposta sem assinatura de PDF para o CNPJ ${digits} (${bytes.byteLength} bytes)`,
    );

    return {
      ok: false,
      reason: 'upstream',
      status: 502,
      message: 'A resposta da Receita Federal não veio como PDF. Tente novamente em instantes.',
    };
  }

  return { ok: true, pdf: bytes };
}

function describeUpstreamFailure(status: number): CertificateResult {
  if (status === 400) {
    return {
      ok: false,
      reason: 'invalid-cnpj',
      status: 400,
      message: 'A Receita Federal não aceitou o CNPJ informado. Confira o cadastro do site.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: 'not-configured',
      status: 503,
      message:
        'A emissão automática do cartão CNPJ está indisponível. Baixe o comprovante no site da Receita Federal e anexe-o aqui.',
    };
  }

  if (status === 404) {
    return {
      ok: false,
      reason: 'not-found',
      status: 404,
      message: 'Este CNPJ não foi encontrado no cadastro da Receita Federal.',
    };
  }

  if (status === 429) {
    return {
      ok: false,
      reason: 'quota',
      status: 429,
      message: 'Limite de emissões atingido. Tente novamente mais tarde.',
    };
  }

  return {
    ok: false,
    reason: 'upstream',
    status: 502,
    message: 'A Receita Federal não conseguiu emitir o comprovante agora. Tente novamente em instantes.',
  };
}

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  return PDF_SIGNATURE.test(Buffer.from(bytes.subarray(0, 8)).toString('latin1'));
}
