/**
 * Cabeçalhos de segurança da aplicação.
 *
 * next.config.js hoje aplica X-Content-Type-Options, X-Frame-Options, X-XSS-Protection e
 * Referrer-Policy SOMENTE em `/api/:path*` — o HTML das páginas sai sem nenhum deles.
 * Este módulo é a fonte única de verdade: os handlers que possuímos aplicam via
 * `withSecurityHeaders`, e o wiring global (next.config.js / middleware.ts) é pedido
 * como integração, já que esses arquivos são compartilhados.
 */

export interface CspOptions {
  /**
   * Nonce por requisição. Só existe se o middleware gerar um e injetá-lo no HTML
   * (`<Script nonce>` / header `x-nonce`). Sem nonce caímos em 'unsafe-inline',
   * porque o Next 14 emite scripts inline de bootstrap/hidratação sem nonce próprio.
   */
  nonce?: string;
  /** Libera 'unsafe-eval' e o websocket de HMR. Padrão: true fora de produção. */
  development?: boolean;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Monta a Content-Security-Policy que a app realmente aguenta hoje:
 * - `img-src data:` porque o QR Code PIX vem em base64 puro do Asaas;
 * - `img-src blob:` e `worker-src blob:` porque three.js gera texturas/workers em blob;
 * - `style-src 'unsafe-inline'` por causa do Tailwind JIT em dev, do GSAP e do Framer Motion,
 *   que escrevem `style="..."` direto no elemento;
 * - `script-src 'unsafe-inline'` enquanto não houver nonce (ver `buildStrictCspWithNonce`).
 */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const development = options.development ?? !isProduction;
  const { nonce } = options;

  const scriptSrc = nonce
    ? // 'strict-dynamic' faz o browser confiar no que os scripts com nonce carregarem;
      // 'unsafe-inline'/https: ficam como fallback ignorado por browsers modernos.
      `'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`
    : `'self' 'unsafe-inline'`;

  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    // React Refresh e o eval-source-map do webpack só existem em dev.
    `script-src ${scriptSrc}${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.asaas.com",
    "font-src 'self' data:",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    // O browser só fala com a própria origem; Asaas e BrasilAPI são chamados do servidor.
    development
      ? "connect-src 'self' ws://localhost:* http://localhost:*"
      : "connect-src 'self'",
  ];

  if (!development) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Objeto reutilizável. Congelado para ninguém mutar o cabeçalho global sem querer.
 * Cross-Origin-Resource-Policy é 'same-site' (e não 'same-origin') porque os sites dos
 * clientes rodam em subdomínios de businessmillion.app e carregam os assets de /_next.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': buildContentSecurityPolicy(),
  // Ignorado pelo browser em http://, então é inofensivo em desenvolvimento.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'display-capture=()',
    'encrypted-media=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'X-DNS-Prefetch-Control': 'off',
});

/**
 * Aplica os cabeçalhos sem sobrescrever o que o handler já definiu de propósito.
 * Devolve a MESMA resposta (não clona) para preservar corpo e status.
 */
export function withSecurityHeaders<T extends Response>(response: T): T {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }

  return response;
}

/** Mescla os cabeçalhos de segurança com extras, para usar no `init` de uma resposta nova. */
export function securityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...SECURITY_HEADERS, ...extra };
}
