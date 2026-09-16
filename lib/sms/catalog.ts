import type { SmsService } from '@prisma/client';

/**
 * Catálogo dos serviços revendidos e o preço em tokens de SMS.
 *
 * Dois tipos de token convivem na conta:
 *   - token de SITE: R$ 25 na compra, 1 por site publicado (lib/constants.ts);
 *   - token de SMS: vale R$ 1, só nasce da conversão de tokens de site
 *     (1 token de site → 25 tokens de SMS) e paga os números desta tela.
 *
 * O negócio é intermediação: o número é comprado no sms24h e vendido com
 * margem. `priceCents` (centavos de token, 100 = 1 token SMS) é a ÚNICA fonte
 * do valor debitado — o cliente manda o serviço, nunca o preço.
 * `referenceCostCents` é o custo visto na documentação do provedor em
 * 16/09/2026 e serve só de referência; o custo real de cada ativação vem do
 * `getPrices` na hora da compra e fica em `SmsActivation.costCents`.
 *
 * Este arquivo é importado por client components: nada de segredo aqui.
 */

/** 1 token SMS = 100 centavos = R$ 1. */
export const SMS_TOKEN_CENTS = 100;

/** 1 token de site (R$ 25) vira 25 tokens de SMS. Conversão só neste sentido. */
export const SMS_TOKENS_PER_SITE_TOKEN = 25;

export type SmsServiceInfo = {
  /** Código do serviço no sms24h. */
  code: string;
  label: string;
  /** Preço de venda, em centavos de token SMS. */
  priceCents: number;
  /** Custo de referência no provedor, em centavos de real (documentação de 16/09/2026). */
  referenceCostCents: number;
  /** Onde o usuário digita o número. */
  hint: string;
  /** Cor da marca, para o cartão do serviço. */
  accent: string;
};

export const SMS_SERVICES: Record<SmsService, SmsServiceInfo> = {
  WHATSAPP: {
    code: 'wa',
    label: 'WhatsApp',
    priceCents: 1700,
    referenceCostCents: 800,
    hint: 'Cadastro de conta no WhatsApp ou WhatsApp Business',
    accent: '#25D366',
  },
  TELEGRAM: {
    code: 'tg',
    label: 'Telegram',
    priceCents: 800,
    referenceCostCents: 400,
    hint: 'Cadastro de conta no Telegram',
    accent: '#2AABEE',
  },
  GOOGLE: {
    code: 'go',
    label: 'Google',
    priceCents: 250,
    referenceCostCents: 100,
    hint: 'Conta Google e Gmail',
    accent: '#4285F4',
  },
  FACEBOOK: {
    code: 'fb',
    label: 'Facebook',
    priceCents: 200,
    referenceCostCents: 80,
    hint: 'Cadastro e confirmação no Facebook',
    accent: '#1877F2',
  },
  INSTAGRAM: {
    code: 'ig',
    label: 'Instagram',
    priceCents: 150,
    referenceCostCents: 64,
    hint: 'Cadastro e confirmação no Instagram',
    accent: '#E1306C',
  },
};

/** Ordem de exibição: do mais procurado para o mais barato. */
export const SMS_SERVICE_ORDER: readonly SmsService[] = [
  'WHATSAPP',
  'TELEGRAM',
  'GOOGLE',
  'FACEBOOK',
  'INSTAGRAM',
];

export function isSmsService(value: unknown): value is SmsService {
  return typeof value === 'string' && value in SMS_SERVICES;
}

/**
 * Margem mínima aceita sobre o custo do provedor. Se o `getPrices` mostrar o
 * número custando mais do que `preço × (1 − margem)`, a venda é recusada —
 * intermediar com prejuízo é pior do que negar o pedido.
 */
export const SMS_MIN_MARGIN = 0.1;

/** Quanto tempo o número fica reservado esperando o SMS. */
export const SMS_ACTIVATION_TTL_MS = 20 * 60 * 1000;

/**
 * Ativações abertas ao mesmo tempo por conta. Cada uma prende um número no
 * provedor; sem teto, um clique repetido esgotaria o estoque de todo mundo.
 */
export const SMS_MAX_OPEN_ACTIVATIONS = 3;

/** "Pedir outro SMS" por ativação. */
export const SMS_MAX_RETRIES = 3;

/**
 * Ativação parada em REQUESTING além disto é processo que morreu entre o
 * débito e o pedido ao provedor: os tokens voltam para o saldo.
 */
export const SMS_REQUESTING_STALE_MS = 3 * 60 * 1000;

/** Intervalo mínimo entre consultas ao provedor para a MESMA ativação. */
export const SMS_STATUS_MIN_INTERVAL_MS = 4_000;

/**
 * Saldo na conta do sms24h (em reais) abaixo do qual o painel admin avisa.
 * Zerado, o `getNumber` responde NO_BALANCE e toda venda falha em silêncio —
 * o aviso existe para alguém recarregar antes disso.
 */
export const SMS_PROVIDER_LOW_BALANCE = 50;

// ============ CONVERSÃO DE TOKENS DE SITE ============

/** Quantidades de tokens de site oferecidas como atalho na conversão. */
export const SMS_CONVERT_PRESETS = [1, 2, 5, 10] as const;
export const SMS_CONVERT_MIN = 1;
export const SMS_CONVERT_MAX = 100;

/** Centavos de token SMS que `tokens` tokens de site viram. */
export function conversionCents(tokens: number): number {
  return tokens * SMS_TOKENS_PER_SITE_TOKEN * SMS_TOKEN_CENTS;
}

/**
 * Normaliza uma quantidade de tokens de site vinda de fora. Devolve null em
 * vez de corrigir: quantidade inválida é erro de quem chamou.
 */
export function parseConvertQuantity(value: unknown): number | null {
  const quantity = typeof value === 'string' ? Number(value.trim()) : value;

  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
  if (quantity < SMS_CONVERT_MIN || quantity > SMS_CONVERT_MAX) return null;

  return quantity;
}

// ============ FORMATAÇÃO ============

const tokenNumber = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** "1700" → "17"; "150" → "1,5". */
export function formatSmsTokens(cents: number): string {
  return tokenNumber.format(cents / SMS_TOKEN_CENTS);
}

/** "17 tokens SMS" / "1 token SMS" / "1,5 tokens SMS". */
export function smsTokenLabel(cents: number): string {
  return `${formatSmsTokens(cents)} ${cents === SMS_TOKEN_CENTS ? 'token' : 'tokens'} SMS`;
}

/** Quantos números de cada serviço um saldo compra. */
export function affordable(balanceCents: number, service: SmsService): number {
  return Math.floor(balanceCents / SMS_SERVICES[service].priceCents);
}

/**
 * "5543999999999" → { local: "43999999999", international: "+5543999999999",
 * display: "+55 (43) 99999-9999" }. Aceita número sem o 55 também.
 */
export function formatSmsPhone(raw: string): {
  local: string;
  international: string;
  display: string;
} {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  const international = `+55${local}`;

  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  const display =
    rest.length === 9
      ? `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
      : rest.length === 8
        ? `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
        : international;

  return { local, international, display };
}
