/**
 * Cliente do sms24h (protocolo compatível com sms-activate).
 *
 * Endpoint único, `api_key` em toda chamada, resposta em texto puro
 * (`CHAVE:valor`) — exceto getPrices e getNumbersStatus, que são JSON.
 * Documentação de referência: sms24h-api-integracao.md (16/09/2026).
 *
 * A chave dá acesso ao saldo do provedor: fica no servidor, nunca vai para o
 * cliente. Sem a chave configurada, `isConfigured()` devolve false e a tela de
 * SMS entra em modo indisponível, no mesmo espírito da checagem de ASAAS_API_KEY.
 */

const DEFAULT_BASE_URL = 'https://api.sms24h.org/stubs/handler_api';

/** Brasil no catálogo do provedor. Sempre o ID, nunca o nome. */
export const SMS24H_COUNTRY_BR = 73;

const TIMEOUT_MS = 20_000;

/** Códigos que o provedor devolve como erro em qualquer endpoint. */
export type Sms24hErrorCode =
  | 'BAD_KEY'
  | 'BAD_ACTION'
  | 'BAD_SERVICE'
  | 'WRONG_SERVICE'
  | 'NO_NUMBERS'
  | 'NO_BALANCE'
  | 'NO_ACTIVATION'
  | 'ERROR_SQL'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'UNEXPECTED';

export class Sms24hError extends Error {
  readonly code: Sms24hErrorCode;
  /** Texto cru devolvido pelo provedor, para o log. */
  readonly raw: string;

  constructor(code: Sms24hErrorCode, raw: string, message?: string) {
    super(message ?? `sms24h respondeu ${raw}`);
    this.name = 'Sms24hError';
    this.code = code;
    this.raw = raw;
  }
}

export function isSms24hError(error: unknown, code?: Sms24hErrorCode): error is Sms24hError {
  return error instanceof Sms24hError && (code === undefined || error.code === code);
}

/** Estado de uma ativação, já interpretado — o chamador não compara prefixos. */
export type Sms24hActivationStatus =
  | { kind: 'waiting' }
  | { kind: 'waiting_retry'; lastCode: string }
  | { kind: 'code'; code: string }
  | { kind: 'cancelled' }
  | { kind: 'missing' };

export type Sms24hSetStatus = 1 | 3 | 6 | 8;

/** Resposta esperada para cada `setStatus`, conforme a tabela da documentação. */
const SET_STATUS_OK: Record<Sms24hSetStatus, string> = {
  1: 'ACCESS_READY',
  3: 'ACCESS_RETRY_GET',
  6: 'ACCESS_ACTIVATION',
  8: 'ACCESS_CANCEL',
};

const KNOWN_ERRORS: ReadonlySet<Sms24hErrorCode> = new Set([
  'BAD_KEY',
  'BAD_ACTION',
  'BAD_SERVICE',
  'WRONG_SERVICE',
  'NO_NUMBERS',
  'NO_BALANCE',
  'NO_ACTIVATION',
  'ERROR_SQL',
]);

/** A página oficial grafa `NO_ATIVATION` em um lugar; tratamos as duas formas. */
function normalizeErrorCode(raw: string): Sms24hErrorCode | null {
  const head = raw.split(':')[0].trim().toUpperCase();
  if (head === 'NO_ATIVATION') return 'NO_ACTIVATION';
  return KNOWN_ERRORS.has(head as Sms24hErrorCode) ? (head as Sms24hErrorCode) : null;
}

export interface Sms24hPriceQuote {
  /** Menor preço com estoque, em centavos. */
  costCents: number;
  quantity: number;
}

class Sms24hService {
  private get apiKey(): string {
    return process.env.SMS24H_API_KEY?.trim() ?? '';
  }

  private get baseUrl(): string {
    return process.env.SMS24H_API_URL?.trim() || DEFAULT_BASE_URL;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Faz a chamada e devolve o texto cru já sem espaços nas pontas.
   * Erros conhecidos do protocolo viram `Sms24hError` aqui mesmo, para nenhum
   * chamador precisar comparar strings soltas.
   */
  private async call(
    action: string,
    params: Record<string, string | number> = {},
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new Sms24hError('BAD_KEY', '', 'SMS24H_API_KEY não configurada');
    }

    const query = new URLSearchParams({ api_key: this.apiKey, action });
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new Sms24hError(
        timedOut ? 'TIMEOUT' : 'HTTP_ERROR',
        '',
        timedOut ? 'sms24h não respondeu a tempo' : 'Falha de rede ao chamar o sms24h',
      );
    }

    if (!response.ok) {
      throw new Sms24hError('HTTP_ERROR', `HTTP ${response.status}`);
    }

    const text = (await response.text()).trim();
    const errorCode = normalizeErrorCode(text);
    if (errorCode) {
      throw new Sms24hError(errorCode, text);
    }

    return text;
  }

  /** Saldo da chave no provedor, em reais. */
  async getBalance(): Promise<number> {
    const text = await this.call('getBalance');
    if (!text.startsWith('ACCESS_BALANCE:')) {
      throw new Sms24hError('UNEXPECTED', text);
    }

    const value = Number(text.slice('ACCESS_BALANCE:'.length));
    if (!Number.isFinite(value)) {
      throw new Sms24hError('UNEXPECTED', text);
    }

    return value;
  }

  /**
   * Menor preço com estoque para o serviço, ou null quando o formato não é
   * reconhecido. A documentação descreve `{ País: { Serviço: { Preço: Qtd } } }`,
   * mas implementações do protocolo também devolvem `{ cost, count }` — os
   * dois formatos são aceitos. Formato desconhecido NÃO é erro: o chamador
   * decide seguir sem a cotação.
   */
  async getPrices(serviceCode: string): Promise<Sms24hPriceQuote | null> {
    const text = await this.call('getPrices', {
      service: serviceCode,
      country: SMS24H_COUNTRY_BR,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Sms24hError('UNEXPECTED', text.slice(0, 200));
    }

    return extractQuote(parsed, serviceCode);
  }

  /**
   * Estoque por serviço. Devolve o mapa cru (`{ "wa_0": 91, ... }`): a chave é
   * `servico_encaminhamento` e o catálogo filtra as que interessam.
   */
  async getNumbersStatus(): Promise<Record<string, number>> {
    const text = await this.call('getNumbersStatus', {
      country: SMS24H_COUNTRY_BR,
      operator: 'any',
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Sms24hError('UNEXPECTED', text.slice(0, 200));
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Sms24hError('UNEXPECTED', text.slice(0, 200));
    }

    const stock: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const quantity = Number(value);
      if (Number.isFinite(quantity)) stock[key] = quantity;
    }

    return stock;
  }

  /**
   * Aluga um número. Lança `Sms24hError('NO_NUMBERS')` sem estoque e
   * `Sms24hError('NO_BALANCE')` quando o saldo DO PROVEDOR acabou.
   */
  async getNumber(
    serviceCode: string,
    options: { operator?: string; ddd?: string } = {},
  ): Promise<{ activationId: string; phone: string }> {
    const text = await this.call('getNumber', {
      service: serviceCode,
      operator: options.operator ?? 'any',
      country: SMS24H_COUNTRY_BR,
      ...(options.ddd ? { ddd: options.ddd } : {}),
    });

    const parts = text.split(':');
    if (parts[0] !== 'ACCESS_NUMBER' || parts.length < 3) {
      throw new Sms24hError('UNEXPECTED', text);
    }

    const activationId = parts[1].trim();
    const phone = parts[2].replace(/\D/g, '');

    if (!activationId || !phone) {
      throw new Sms24hError('UNEXPECTED', text);
    }

    return { activationId, phone };
  }

  async getStatus(activationId: string): Promise<Sms24hActivationStatus> {
    let text: string;
    try {
      text = await this.call('getStatus', { id: activationId });
    } catch (error) {
      // Id desconhecido no provedor é um estado, não uma falha de chamada.
      if (isSms24hError(error, 'NO_ACTIVATION')) return { kind: 'missing' };
      throw error;
    }

    if (text === 'STATUS_WAIT_CODE') return { kind: 'waiting' };
    if (text === 'STATUS_CANCEL') return { kind: 'cancelled' };

    if (text.startsWith('STATUS_WAIT_RETRY:')) {
      return { kind: 'waiting_retry', lastCode: text.slice('STATUS_WAIT_RETRY:'.length).trim() };
    }

    if (text.startsWith('STATUS_OK:')) {
      const code = text.slice('STATUS_OK:'.length).trim();
      if (!code) throw new Sms24hError('UNEXPECTED', text);
      return { kind: 'code', code };
    }

    throw new Sms24hError('UNEXPECTED', text);
  }

  /**
   * Muda o estado da ativação. Devolve true quando o provedor confirmou com a
   * resposta esperada para aquele status; false quando respondeu outra coisa
   * que não seja erro conhecido (ex.: recusa de cancelamento). Erros conhecidos
   * (NO_ACTIVATION, BAD_KEY…) continuam lançando.
   */
  async setStatus(activationId: string, status: Sms24hSetStatus): Promise<boolean> {
    const text = await this.call('setStatus', { id: activationId, status });
    return text === SET_STATUS_OK[status];
  }
}

/**
 * Procura a cotação do serviço no JSON do getPrices, tolerando o país como id
 * numérico ou nome e os dois formatos de mapa de preços.
 */
function extractQuote(payload: unknown, serviceCode: string): Sms24hPriceQuote | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const countries = Object.values(payload as Record<string, unknown>);
  const byCountry =
    (payload as Record<string, unknown>)[String(SMS24H_COUNTRY_BR)] ?? countries[0];

  if (typeof byCountry !== 'object' || byCountry === null) return null;

  const service = (byCountry as Record<string, unknown>)[serviceCode];
  if (typeof service !== 'object' || service === null) return null;

  const entries = service as Record<string, unknown>;

  // Formato `{ cost, count }`.
  if ('cost' in entries) {
    const cost = Number(entries.cost);
    const count = Number(entries.count ?? 0);
    if (!Number.isFinite(cost)) return null;
    return { costCents: Math.round(cost * 100), quantity: Number.isFinite(count) ? count : 0 };
  }

  // Formato `{ "8.00": 91, "9.50": 12 }`: menor preço com estoque.
  let best: Sms24hPriceQuote | null = null;
  for (const [priceKey, rawQuantity] of Object.entries(entries)) {
    const price = Number(priceKey);
    const quantity = Number(rawQuantity);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0) continue;

    const costCents = Math.round(price * 100);
    if (best === null || costCents < best.costCents) {
      best = { costCents, quantity };
    }
  }

  return best;
}

export const sms24hService = new Sms24hService();
