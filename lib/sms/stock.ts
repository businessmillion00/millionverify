import type { SmsService } from '@prisma/client';
import { sms24hService } from '@/services/sms24h';
import { SMS_SERVICES, SMS_SERVICE_ORDER } from '@/lib/sms/catalog';

/** Quantidade disponível por serviço; ausente quando o provedor não listou. */
export type SmsStock = Partial<Record<SmsService, number>>;

const TTL_MS = 60_000;

/** O painel admin não pode esperar os 20s de timeout do cliente por um número. */
const BALANCE_TIMEOUT_MS = 6_000;
const BALANCE_TTL_MS = 30_000;

export type SmsProviderBalance =
  | { state: 'ok'; balance: number }
  | { state: 'unconfigured' }
  | { state: 'error'; message: string };

/**
 * Memo por processo, no globalThis pelo mesmo motivo do rate limit: em dev o
 * módulo é reavaliado a cada hot reload. Cada instância serverless tem o seu —
 * é só para a tela não bater no provedor a cada abertura, não precisa ser
 * consistente entre instâncias.
 */
const globalForStock = globalThis as unknown as {
  __bmSmsStock?: { value: SmsStock; expiresAt: number };
  __bmSmsProviderBalance?: { value: number; expiresAt: number };
};

/**
 * Saldo da conta no sms24h, em reais — o "estoque" de vocês: cada número
 * vendido desconta dali. Com cache curto para o painel admin não bater no
 * provedor a cada F5; erro e ausência de chave viram estados, não exceções.
 */
export async function getSmsProviderBalance(): Promise<SmsProviderBalance> {
  if (!sms24hService.isConfigured()) return { state: 'unconfigured' };

  const cached = globalForStock.__bmSmsProviderBalance;
  if (cached && cached.expiresAt > Date.now()) {
    return { state: 'ok', balance: cached.value };
  }

  try {
    const balance = await Promise.race([
      sms24hService.getBalance(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sms24h não respondeu a tempo')), BALANCE_TIMEOUT_MS),
      ),
    ]);

    globalForStock.__bmSmsProviderBalance = { value: balance, expiresAt: Date.now() + BALANCE_TTL_MS };
    return { state: 'ok', balance };
  } catch (error) {
    console.warn('[sms] getBalance falhou:', error);
    return {
      state: 'error',
      message: error instanceof Error ? error.message : 'Falha ao consultar o provedor',
    };
  }
}

/**
 * Estoque por serviço, com cache curto. Null quando o provedor não está
 * configurado ou não respondeu: a tela esconde o badge e a compra continua
 * possível — quem decide se há número é o `getNumber`.
 */
export async function getSmsStock(): Promise<SmsStock | null> {
  if (!sms24hService.isConfigured()) return null;

  const cached = globalForStock.__bmSmsStock;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const raw = await sms24hService.getNumbersStatus();
    const stock: SmsStock = {};

    for (const service of SMS_SERVICE_ORDER) {
      // Chave `servico_encaminhamento`; 0 = sem encaminhamento.
      const quantity = raw[`${SMS_SERVICES[service].code}_0`];
      if (typeof quantity === 'number') stock[service] = quantity;
    }

    globalForStock.__bmSmsStock = { value: stock, expiresAt: Date.now() + TTL_MS };
    return stock;
  } catch (error) {
    console.warn('[sms] getNumbersStatus falhou:', error);
    return null;
  }
}
