/**
 * Registro dos subdomínios de cliente como domínios do projeto na Vercel.
 *
 * POR QUE ISTO EXISTE
 *
 * O caminho natural seria um certificado wildcard `*.million-verify.com`, mas
 * wildcard só é validado por desafio DNS-01, que exige a Vercel ser autoridade
 * da zona. O domínio está no Cloudflare Registrar, que proíbe nameserver
 * externo — e domínio recém-registrado tem trava de 60 dias para transferir.
 *
 * A saída: hostname ÚNICO valida por HTTP-01, sem tocar em DNS. Então cada
 * subdomínio é registrado individualmente e a Vercel emite (e renova) um
 * certificado próprio para ele. O CNAME `*` no Cloudflare, sem proxy, é o que
 * roteia o tráfego — ele não precisa de certificado, só resolve o nome.
 *
 * Quando o domínio puder migrar para os nameservers da Vercel, um wildcard
 * substitui tudo isto e este módulo pode sair.
 */

const API = 'https://api.vercel.com';
const TIMEOUT_MS = 15_000;

export type DomainResult =
  | { ok: true; alreadyExisted: boolean }
  | { ok: false; reason: 'not-configured' | 'invalid' | 'conflict' | 'upstream'; message: string };

type Credentials = { token: string; projectId: string; teamId: string | null };

/** Permite a quem chama distinguir "desligado" de "falhou". */
export function isDomainAutomationConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN?.trim() && process.env.VERCEL_PROJECT_ID?.trim());
}

function credentials(): Credentials | null {
  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();

  if (!token || !projectId) return null;

  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID?.trim() || null };
}

function url(path: string, creds: Credentials): string {
  // Sem teamId a API responde 403 em projeto que pertence a um time.
  return creds.teamId ? `${API}${path}?teamId=${encodeURIComponent(creds.teamId)}` : `${API}${path}`;
}

async function call(
  path: string,
  creds: Credentials,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url(path, creds), {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/**
 * Registra o host no projeto. Idempotente: host já registrado devolve sucesso,
 * porque o build pode ser reexecutado depois de uma falha adiante.
 */
export async function addProjectDomain(host: string): Promise<DomainResult> {
  const creds = credentials();

  if (!creds) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'Automação de domínio não configurada (VERCEL_TOKEN/VERCEL_PROJECT_ID).',
    };
  }

  try {
    const { status, body } = await call(`/v10/projects/${creds.projectId}/domains`, creds, {
      method: 'POST',
      body: JSON.stringify({ name: host }),
    });

    if (status >= 200 && status < 300) return { ok: true, alreadyExisted: false };

    const code = errorCode(body);

    // A Vercel usa 409 para "já existe neste projeto" — que é o estado desejado.
    if (status === 409 || code === 'domain_already_in_use') {
      return { ok: true, alreadyExisted: true };
    }

    console.error(`[vercel-domains] POST ${host} respondeu ${status}: ${describe(body)}`);

    if (status === 400) {
      return { ok: false, reason: 'invalid', message: 'Subdomínio recusado pela Vercel.' };
    }

    if (status === 401 || status === 403) {
      return {
        ok: false,
        reason: 'not-configured',
        message: 'Credenciais da Vercel inválidas para registrar o domínio.',
      };
    }

    return { ok: false, reason: 'upstream', message: 'A Vercel não registrou o domínio agora.' };
  } catch (error) {
    console.error(`[vercel-domains] Falha de rede ao registrar ${host}:`, error);
    return { ok: false, reason: 'upstream', message: 'Não foi possível falar com a Vercel.' };
  }
}

/**
 * Remove o host do projeto. Nunca lança: a exclusão do site não pode falhar
 * porque a limpeza do domínio deu errado — no pior caso sobra um domínio órfão
 * no painel, o que é irritante mas inofensivo.
 */
export async function removeProjectDomain(host: string): Promise<void> {
  const creds = credentials();
  if (!creds) return;

  try {
    const { status, body } = await call(
      `/v9/projects/${creds.projectId}/domains/${encodeURIComponent(host)}`,
      creds,
      { method: 'DELETE' },
    );

    // 404 é sucesso do ponto de vista de quem chama: o host não está mais lá.
    if ((status >= 200 && status < 300) || status === 404) return;

    console.error(`[vercel-domains] DELETE ${host} respondeu ${status}: ${describe(body)}`);
  } catch (error) {
    console.error(`[vercel-domains] Falha de rede ao remover ${host}:`, error);
  }
}

function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Mensagem curta para log, sem despejar o corpo inteiro da resposta. */
function describe(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '(sem corpo)';
  const error = (body as { error?: { code?: string; message?: string } }).error;
  if (!error) return JSON.stringify(body).slice(0, 200);
  return `${error.code ?? '?'} — ${error.message ?? '?'}`;
}
