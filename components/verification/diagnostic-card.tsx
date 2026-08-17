'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
// `import type` é APAGADO na compilação (isolatedModules), então nada de
// lib/verification/diagnose.ts (que importa prisma e node:dns) vai para o bundle
// do browser. Nunca troque isto por um import de valor.
import type { DiagnosticOutcome, SiteDiagnostic } from '@/lib/verification/diagnose';

/**
 * Cartão de diagnóstico do site — as SEIS checagens que a Meta faz, na ordem em que
 * elas bloqueiam umas às outras:
 *
 *   1. o site responde 200;
 *   2. o certificado HTTPS é válido;
 *   3. a meta tag está no <head>;
 *   4. o registro TXT está na zona DNS;
 *   5. a política de privacidade abre;
 *   6. o robô da Meta (facebookexternalhit) consegue ler a mesma página que nós lemos.
 *
 * Separa visualmente os DOIS métodos de verificação da Meta, porque confundi-los já
 * custou retrabalho:
 *   META TAG     → vive no <head> do site. Vale na hora.
 *   REGISTRO TXT → vive na ZONA DNS. Leva de 5 a 15 minutos e só existe quando o
 *                  cliente usa domínio próprio (a zona do subdomínio é nossa).
 *
 * E separa o veredito em duas famílias: "o problema está no seu site" (tem correção
 * aqui) e "o site está certo, o que falta é do lado da Meta" (não há o que corrigir aqui).
 *
 * Três marcas, não duas — é a tradução visual do `DiagnosticOutcome`:
 *   ✓ verde    → comprovadamente certo.
 *   ✗ vermelho → comprovadamente errado (o servidor respondeu e a resposta nega).
 *   — neutro   → não deu para saber (timeout, rede, checagem que não se aplica).
 * Pintar 'indeterminado' de vermelho seria dizer que um blip de rede quebrou o site.
 */

/** Fuso fixo: `toLocaleString` sem timeZone diverge entre o servidor (UTC) e o browser. */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
});

/** Acima disto a página está lenta o bastante para a Meta desistir da leitura. */
const SLOW_LATENCY_MS = 3_000;

const META_DOMAINS_URL = 'https://business.facebook.com/settings/owned-domains';

type Tone = 'success' | 'warning' | 'error' | 'info';

type CardState = 'idle' | 'loading';

const TONE_BADGE: Record<Tone, string> = {
  success: 'badge badge-success',
  warning: 'badge badge-warning',
  error: 'badge badge-error',
  info: 'badge badge-info',
};

const TONE_MARK: Record<Tone, string> = {
  success: '✓',
  warning: '!',
  error: '✗',
  info: '—',
};

const TONE_MARK_CLASS: Record<Tone, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  error: 'border-red-500/40 bg-red-500/10 text-red-400',
  info: 'border-dark-700 bg-white/5 text-dark-400',
};

/** Lido só por leitor de tela: a marca é `aria-hidden` e sozinha não diz nada. */
const TONE_LABEL: Record<Tone, string> = {
  success: 'Aprovado',
  warning: 'Atenção',
  error: 'Falhou',
  info: 'Sem conclusão',
};

const TONE_PANEL: Record<Tone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/5',
  warning: 'border-amber-500/30 bg-amber-500/5',
  error: 'border-red-500/30 bg-red-500/5',
  info: 'border-dark-700 bg-white/5',
};

const LOADING_STEPS = [
  'Baixando a página pública',
  'Procurando a meta tag no <head>',
  'Resolvendo os registros TXT do DNS',
  'Abrindo a política de privacidade',
  'Repetindo a visita como o robô do Facebook',
];

/* ============ LEITURA DEFENSIVA DA RESPOSTA ============ */
/* A rota pode devolver 401/404/429/500 com outro formato. Nada de `as`.          */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asOutcome(value: unknown): DiagnosticOutcome {
  if (value === 'ok') return 'ok';
  if (value === 'ausente') return 'ausente';
  return 'indeterminado';
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(asText).filter((item): item is string => item !== null)
    : [];
}

function parseResponseDiagnostic(body: unknown): SiteDiagnostic | null {
  const envelope = asRecord(body);
  if (envelope.success !== true) return null;

  const raw = asRecord(envelope.data);
  const checkedAt = asText(raw.checkedAt);
  const url = asText(raw.url);

  if (checkedAt === null || url === null) return null;

  const metaTag = asRecord(raw.metaTag);
  const txt = asRecord(raw.txt);
  const privacyPolicy = asRecord(raw.privacyPolicy);
  const crawler = asRecord(raw.crawler);

  return {
    checkedAt,
    url,
    httpStatus: asFiniteNumber(raw.httpStatus),
    latencyMs: asFiniteNumber(raw.latencyMs),
    reachable: raw.reachable === true,
    sslOk: raw.sslOk === true,
    metaTag: {
      expected: asText(metaTag.expected),
      found: asText(metaTag.found),
      outcome: asOutcome(metaTag.outcome),
    },
    txt: {
      expected: asText(txt.expected),
      records: asTextList(txt.records),
      outcome: asOutcome(txt.outcome),
      applicable: txt.applicable === true,
    },
    privacyPolicy: {
      url: asText(privacyPolicy.url),
      httpStatus: asFiniteNumber(privacyPolicy.httpStatus),
      htmlLength: asFiniteNumber(privacyPolicy.htmlLength) ?? 0,
      outcome: asOutcome(privacyPolicy.outcome),
    },
    crawler: {
      // Sem `?? constante` aqui: este arquivo não pode importar valor de
      // lib/verification/diagnose.ts. A string vazia só apareceria se a rota
      // devolvesse um formato antigo, e o rótulo abaixo cobre esse caso.
      userAgent: asText(crawler.userAgent) ?? '',
      httpStatus: asFiniteNumber(crawler.httpStatus),
      latencyMs: asFiniteNumber(crawler.latencyMs),
      metaTagFound: crawler.metaTagFound === true,
      blocked: crawler.blocked === true,
      outcome: asOutcome(crawler.outcome),
    },
    error: asText(raw.error),
    problems: asTextList(raw.problems),
  };
}

function extractErrorMessage(body: unknown): string | null {
  return asText(asRecord(body).error);
}

/* ============ VEREDITO EM LINGUAGEM HUMANA ============ */

interface Verdict {
  tone: Tone;
  title: string;
  body: string;
  /** Verdadeiro quando não há mais nada a corrigir do nosso lado. */
  metaSide: boolean;
}

/** Ressalvas que não mudam o veredito, mas que o usuário precisa ler junto dele. */
function successCaveats(diagnostic: SiteDiagnostic): string {
  const notes: string[] = [];

  if (diagnostic.crawler.outcome === 'indeterminado') {
    notes.push(
      'Uma ressalva: não deu para confirmar nesta rodada se o robô da Meta consegue abrir a página. Rode o diagnóstico de novo para fechar essa checagem.',
    );
  }

  if (diagnostic.privacyPolicy.outcome === 'ausente') {
    notes.push(
      'Um ponto secundário: a página de política de privacidade não está abrindo. Ela não bloqueia a verificação automática, mas é um dos sinais de legitimidade avaliados quando um humano revisa o domínio — vale corrigir antes de submeter.',
    );
  }

  return notes.length > 0 ? ` ${notes.join(' ')}` : '';
}

function buildVerdict(diagnostic: SiteDiagnostic): Verdict {
  const { metaTag, crawler, httpStatus, reachable, error } = diagnostic;

  // A checagem mais valiosa das seis vem ANTES do caso de sucesso de propósito: é
  // exatamente o cenário em que a página, o código e o DNS estão certos e a Meta falha
  // assim mesmo. Sem esta ramificação o cartão diria "está tudo certo" para quem tem um
  // WAF barrando o rastreador — a mentira mais cara que esta tela poderia contar.
  if (metaTag.outcome === 'ok' && crawler.outcome === 'ausente') {
    return crawler.blocked
      ? {
          tone: 'error',
          metaSide: false,
          title: 'O problema está no seu site: ele bloqueia o robô da Meta',
          body: `A página abre normalmente e o código de verificação está no <head> — mas quando repetimos a mesma requisição com o User-Agent do rastreador da Meta (facebookexternalhit), o servidor respondeu HTTP ${
            crawler.httpStatus ?? '—'
          }. É um bloqueio por User-Agent: WAF, Cloudflare, ModSecurity ou um limite de requisições. Enquanto ele existir, a Meta nunca vai ler a sua tag, por mais correta que ela esteja. Libere o User-Agent facebookexternalhit nas regras de segurança do servidor ou da CDN e rode o diagnóstico de novo.`,
        }
      : {
          tone: 'error',
          metaSide: false,
          title: 'O problema está no seu site: o robô da Meta recebe outra página',
          body: 'A página abre para nós com o código de verificação no lugar, mas a resposta entregue ao rastreador da Meta veio sem a meta tag. Alguma camada de cache ou CDN está servindo versões diferentes conforme o User-Agent. Limpe o cache do domínio (purge total, não só da home) e rode o diagnóstico de novo.',
        };
  }

  // A tag está comprovada, mas pela resposta entregue AO ROBÔ — a nossa própria
  // requisição não recebeu 2xx. Cair no caso de sucesso aqui afirmaria "a página pública
  // respondeu normalmente", que é justamente o que não aconteceu. A verificação segue de
  // pé (nada foi revertido); o que está barrado é o nosso monitoramento.
  if (
    metaTag.outcome === 'ok' &&
    !(httpStatus !== null && httpStatus >= 200 && httpStatus < 300)
  ) {
    return {
      tone: 'warning',
      metaSide: false,
      title: 'A tag está publicada, mas o site barra o nosso verificador',
      body: `O robô da Meta abriu a página e recebeu o código de verificação correto — por isso a verificação continua válida e nada foi revertido no status. A mesma página, porém, ${
        httpStatus === null
          ? 'não respondeu à requisição do nosso diagnóstico'
          : `respondeu HTTP ${httpStatus} à requisição do nosso diagnóstico`
      }. Alguma proteção que filtra por User-Agent (WAF, Cloudflare ou limite de requisições) está barrando o nosso verificador: enquanto ela existir, não conseguimos acompanhar sozinhos se a tag continua no ar.`,
    };
  }

  if (metaTag.outcome === 'ok') {
    return {
      tone: 'success',
      metaSide: true,
      title: 'O site está certo — o que falta é do lado da Meta',
      body:
        'A página pública respondeu normalmente, o rastreador da Meta consegue abri-la e o código de verificação está no <head> exatamente como foi cadastrado. Não há nada a corrigir aqui. Volte ao Business Manager em Segurança da marca → Domínios, selecione o domínio e clique em Verificar domínio. Se ainda assim ela recusar, o motivo está na conta da Meta — domínio já reivindicado por outra Business Manager, ou cache de uma verificação anterior — e não no site.' +
        successCaveats(diagnostic),
    };
  }

  if (metaTag.outcome === 'indeterminado') {
    return {
      tone: 'warning',
      metaSide: false,
      title: 'Não foi possível concluir o diagnóstico',
      body: `${error ?? 'A checagem não chegou a uma conclusão.'} Nada foi alterado no status da verificação: uma falha passageira não invalida uma tag já confirmada. Tente de novo em alguns minutos.`,
    };
  }

  if (metaTag.expected === null) {
    return {
      tone: 'error',
      metaSide: false,
      title: 'Falta cadastrar o código de verificação',
      body: 'No Business Manager, copie o valor de content="..." da meta tag que a Meta mostra e salve no campo "Código de verificação da Meta" desta página. Ele entra no <head> do site imediatamente, sem precisar republicar.',
    };
  }

  if (!reachable) {
    return {
      tone: 'error',
      metaSide: false,
      title: 'O problema está no seu site: a página não está disponível',
      body: `${error ?? 'O endereço público não devolveu resposta.'} Enquanto a página não abrir, a Meta não tem o que ler — o código cadastrado é irrelevante.`,
    };
  }

  if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 300)) {
    return {
      tone: 'error',
      metaSide: false,
      title: 'O problema está no seu site: a página não abre',
      body: `O endereço respondeu HTTP ${httpStatus}. A Meta só lê a verificação quando a página devolve 200. Se o site estiver despublicado, publique-o antes de tentar verificar de novo.`,
    };
  }

  if (crawler.blocked) {
    return {
      tone: 'error',
      metaSide: false,
      title: 'O problema está no seu site: ele bloqueia o robô da Meta',
      body: `O servidor respondeu HTTP ${
        crawler.httpStatus ?? '—'
      } quando a requisição foi feita com o User-Agent do rastreador da Meta, embora responda normalmente para um visitante comum. Libere o User-Agent facebookexternalhit no seu WAF/CDN — sem isso, nada mais nesta tela vai adiantar.`,
    };
  }

  if (metaTag.found !== null) {
    return {
      tone: 'error',
      metaSide: false,
      title: 'O problema está no seu site: o código publicado é outro',
      body: 'A página abre normalmente, mas a meta tag no ar tem um valor diferente do que a Meta espera. Confira no Business Manager qual é o código atual do domínio e salve exatamente esse valor aqui.',
    };
  }

  return {
    tone: 'error',
    metaSide: false,
    title: 'O problema está no seu site: a meta tag não está publicada',
    body: 'A página abre normalmente, mas a tag facebook-domain-verification não apareceu no <head> servido. Salve o código novamente nesta página e rode o diagnóstico outra vez.',
  };
}

/* ============ LINHAS DO RESULTADO ============ */

/** ✓ para 'ok', ✗ para 'ausente', — para 'indeterminado'. Sem exceções. */
function outcomeTone(outcome: DiagnosticOutcome): Tone {
  if (outcome === 'ok') return 'success';
  return outcome === 'ausente' ? 'error' : 'info';
}

/**
 * Linha 1. Resposta recebida decide: 2xx é ✓, qualquer outro status é ✗ (o servidor
 * falou e a resposta nega), e SEM resposta é — (daqui não dá para distinguir site fora
 * do ar de rede instável no meio do caminho; o veredito acima é quem dá o recado).
 */
function reachableTone(diagnostic: SiteDiagnostic): Tone {
  if (diagnostic.httpStatus === null) return 'info';
  return diagnostic.httpStatus >= 200 && diagnostic.httpStatus < 300 ? 'success' : 'error';
}

function sslTone(diagnostic: SiteDiagnostic): Tone {
  if (diagnostic.sslOk) return 'success';
  return diagnostic.reachable ? 'error' : 'info';
}

function txtTone(txt: SiteDiagnostic['txt']): Tone {
  return txt.applicable ? outcomeTone(txt.outcome) : 'info';
}

function crawlerValue(crawler: SiteDiagnostic['crawler']): string {
  if (crawler.outcome === 'ok') return 'acesso liberado';
  if (crawler.blocked) return `bloqueado · HTTP ${crawler.httpStatus ?? '—'}`;
  if (crawler.outcome === 'indeterminado') return 'inconclusivo';

  // 'ausente' sem status nenhum é o site que não respondeu a ninguém — não é o robô
  // recebendo uma página diferente, e dizer o contrário mandaria o usuário caçar um
  // bloqueio de WAF que não existe.
  return crawler.httpStatus === null ? 'sem resposta' : 'resposta diferente';
}

function crawlerHint(crawler: SiteDiagnostic['crawler']): string {
  if (crawler.blocked) {
    return `O servidor respondeu HTTP ${
      crawler.httpStatus ?? '—'
    } para o rastreador e 200 para um visitante comum: alguma proteção por User-Agent (WAF, Cloudflare ou limite de requisições) está barrando a Meta.`;
  }

  if (crawler.outcome === 'indeterminado') {
    return 'A requisição feita como o robô da Meta não chegou a uma conclusão. Nada foi alterado no status da verificação.';
  }

  if (crawler.outcome === 'ausente') {
    return crawler.httpStatus === null
      ? 'A página não respondeu à requisição feita como o robô da Meta. Enquanto o site não abrir, não há o que o rastreador leia.'
      : 'O robô abriu a página, mas a resposta entregue a ele veio sem a meta tag — sinal de cache ou CDN servindo versões diferentes por User-Agent.';
  }

  return crawler.metaTagFound
    ? 'Repetimos a visita com o User-Agent facebookexternalhit: a página abriu e a meta tag veio junto nessa resposta.'
    : 'Repetimos a visita com o User-Agent facebookexternalhit e a página abriu normalmente para ele.';
}

function privacyValue(privacy: SiteDiagnostic['privacyPolicy']): string {
  if (privacy.outcome === 'ok') return 'acessível';
  if (privacy.outcome === 'indeterminado') return 'inconclusivo';
  return privacy.httpStatus === null ? 'não abriu' : `HTTP ${privacy.httpStatus}`;
}

function privacyHint(privacy: SiteDiagnostic['privacyPolicy']): string {
  if (privacy.outcome === 'ok') {
    return `A página abre em ${privacy.url ?? '/politica-de-privacidade'} com conteúdo real. É o sinal de legitimidade que a Meta avalia junto com o domínio.`;
  }

  if (privacy.outcome === 'indeterminado') {
    return 'Não deu para confirmar a política de privacidade nesta rodada. Rode o diagnóstico de novo em alguns minutos.';
  }

  return privacy.httpStatus !== null && privacy.httpStatus >= 200 && privacy.httpStatus < 300
    ? 'A página respondeu, mas praticamente sem conteúdo — para quem revisa o domínio, isso vale o mesmo que uma página inexistente.'
    : `O link do rodapé aponta para ${
        privacy.url ?? '/politica-de-privacidade'
      }, e esse endereço não está abrindo. É um dos sinais de legitimidade que a Meta avalia.`;
}

interface RowProps {
  tone: Tone;
  label: string;
  /** Frase curta em pt-BR explicando o que a checagem significa ou o que deu errado. */
  hint: string;
  value?: string | null;
  /** Sobrescreve o rótulo de leitor de tela quando `TONE_LABEL` não descreve o caso. */
  statusLabel?: string;
}

function DiagnosticRow({ tone, label, value, hint, statusLabel }: RowProps) {
  return (
    <li data-diag-row className="flex items-start gap-3 py-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${TONE_MARK_CLASS[tone]}`}
      >
        {TONE_MARK[tone]}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-white">
            {label}
            <span className="sr-only"> — {statusLabel ?? TONE_LABEL[tone]}</span>
          </span>
          {value ? (
            <span className="text-sm tabular-nums text-dark-300">{value}</span>
          ) : null}
        </span>

        <span className="mt-1 block break-words text-xs leading-relaxed text-dark-500">
          {hint}
        </span>
      </span>
    </li>
  );
}

/* ============ COMPONENTE ============ */

type Props = {
  siteId: string;
  /** Host público exibido no cabeçalho — use siteHost(site) de lib/subdomain.ts. */
  siteHost: string;
  /** Domínio próprio, quando houver. É o que torna o método TXT aplicável. */
  customDomain?: string | null;
  /** Último diagnóstico gravado: passe parseDiagnostic(site.lastDiagnostic). */
  initialDiagnostic?: SiteDiagnostic | null;
  className?: string;
};

export function DiagnosticCard({
  siteId,
  siteHost,
  customDomain = null,
  initialDiagnostic = null,
  className,
}: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<CardState>('idle');
  const [diagnostic, setDiagnostic] = useState<SiteDiagnostic | null>(initialDiagnostic);
  const [failure, setFailure] = useState('');

  const runDiagnosis = useCallback(async () => {
    setState('loading');
    setFailure('');

    try {
      const response = await fetch(`/api/sites/${siteId}/diagnose`, {
        method: 'POST',
        cache: 'no-store',
        // Content-Type não-simples força preflight em requisição cross-site, o que
        // soma à checagem de Origin feita no servidor.
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setFailure(
          extractErrorMessage(body) ?? 'Não foi possível rodar o diagnóstico agora.',
        );
        return;
      }

      const parsed = parseResponseDiagnostic(body);

      if (parsed === null) {
        setFailure('O diagnóstico voltou em um formato inesperado. Tente novamente.');
        return;
      }

      setDiagnostic(parsed);
      // Os selos de verificação vivem no server component: sem refresh eles ficam velhos.
      router.refresh();
    } catch {
      setFailure('Falha de conexão ao chamar o diagnóstico. Verifique sua internet.');
    } finally {
      setState('idle');
    }
  }, [siteId, router]);

  // ── animação do carregamento ────────────────────────────────────────────
  useEffect(() => {
    if (state !== 'loading') return;

    const root = rootRef.current;
    if (!root) return;
    // Sem animação os passos ficam legíveis do jeito que já nascem no HTML: a
    // opacidade baixa é o estado inicial DA ANIMAÇÃO, nunca o estado final.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-diag-step]',
        { opacity: 0.25 },
        {
          opacity: 1,
          duration: 0.45,
          ease: 'sine.inOut',
          stagger: { each: 0.18, repeat: -1, yoyo: true },
        },
      );

      gsap.fromTo(
        '[data-diag-scan]',
        { scaleX: 0, transformOrigin: 'left center' },
        { scaleX: 1, duration: 1.6, ease: 'power1.inOut', repeat: -1 },
      );
    }, root);

    return () => ctx.revert();
  }, [state]);

  // ── entrada em cascata do resultado ─────────────────────────────────────
  useEffect(() => {
    if (state === 'loading' || diagnostic === null) return;

    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      gsap.from('[data-diag-row]', {
        y: 12,
        opacity: 0,
        duration: 0.5,
        stagger: 0.06,
        ease: 'power2.out',
      });
    }, root);

    return () => ctx.revert();
  }, [diagnostic, state]);

  const verdict = diagnostic === null ? null : buildVerdict(diagnostic);

  const checkedAtLabel =
    diagnostic === null ? null : DATE_TIME_FORMAT.format(new Date(diagnostic.checkedAt));

  const latencyLabel =
    diagnostic === null || diagnostic.latencyMs === null
      ? null
      : `${diagnostic.latencyMs.toLocaleString('pt-BR')}ms`;

  const slow = diagnostic !== null && (diagnostic.latencyMs ?? 0) > SLOW_LATENCY_MS;

  return (
    <section ref={rootRef} className={className ? `card ${className}` : 'card'}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-dark-500">Health check</p>
          <h2 className="mt-1 text-xl font-semibold">Diagnóstico do site</h2>
          <p className="mt-2 max-w-xl text-sm text-dark-400">
            Buscamos <span className="break-all text-dark-300">{siteHost}</span> do nosso
            servidor — inclusive uma segunda vez, com o User-Agent do robô do Facebook — e
            conferimos as seis coisas que a Meta olha.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runDiagnosis()}
          disabled={state === 'loading'}
          className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'loading' ? 'Diagnosticando...' : 'Diagnosticar agora'}
        </button>
      </div>

      {failure ? (
        <p className="badge badge-error mt-5" role="alert">
          {failure}
        </p>
      ) : null}

      {state === 'loading' ? (
        <div className="mt-6" aria-live="polite" aria-busy="true">
          <div className="h-1 w-full overflow-hidden rounded-full bg-dark-800">
            <div data-diag-scan className="h-full w-full bg-gradient-amber" />
          </div>

          <ul className="mt-4 space-y-2">
            {LOADING_STEPS.map((step) => (
              <li
                key={step}
                data-diag-step
                className="flex items-center gap-2 text-sm text-dark-400"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {step}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state !== 'loading' && diagnostic === null ? (
        <p className="mt-6 rounded-xl border border-dashed border-dark-700 p-5 text-sm text-dark-400">
          Este site ainda não passou por um diagnóstico. Rode um antes de clicar em
          &quot;Verificar domínio&quot; no Business Manager — se algo estiver errado aqui, a
          Meta também não vai conseguir ler.
        </p>
      ) : null}

      {state !== 'loading' && diagnostic !== null && verdict !== null ? (
        <>
          <div className={`mt-6 rounded-xl border p-5 ${TONE_PANEL[verdict.tone]}`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className={TONE_BADGE[verdict.tone]}>
                {verdict.metaSide ? 'Nada pendente aqui' : 'Ação necessária no site'}
              </span>
              {checkedAtLabel ? (
                <span className="text-xs tabular-nums text-dark-500">
                  Checado em {checkedAtLabel}
                </span>
              ) : null}
            </div>

            <p className="mt-3 font-medium text-white">{verdict.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-dark-300">{verdict.body}</p>

            {verdict.metaSide ? (
              <a
                href={META_DOMAINS_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary mt-4 inline-block text-sm"
              >
                Abrir Domínios no Business Manager
              </a>
            ) : null}
          </div>

          {diagnostic.problems.length > 0 ? (
            <ul className="mt-5 space-y-2">
              {diagnostic.problems.map((problem, index) => (
                <li
                  key={`${index}-${problem}`}
                  data-diag-row
                  className="flex gap-2 text-sm leading-relaxed text-dark-300"
                >
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                  <span className="min-w-0 break-words">{problem}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="divider my-6" />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.25em] text-dark-500">
              As seis checagens
            </p>
            <span className="text-xs text-dark-500">
              ✓ certo · — sem conclusão · ✗ precisa de correção
            </span>
          </div>

          <ul className="mt-1 divide-y divide-dark-800">
            {/* 1 */}
            <DiagnosticRow
              tone={reachableTone(diagnostic)}
              label="Site no ar"
              value={
                diagnostic.httpStatus === null
                  ? 'sem resposta'
                  : `HTTP ${diagnostic.httpStatus}`
              }
              hint={
                diagnostic.httpStatus === null
                  ? (diagnostic.error ??
                    `Não recebemos resposta de ${diagnostic.url}. Sem uma página aberta, a Meta não tem o que ler.`)
                  : `É este endereço que a Meta abre para procurar a verificação: ${diagnostic.url}`
              }
            />

            {/* 2 */}
            <DiagnosticRow
              tone={sslTone(diagnostic)}
              label="Certificado HTTPS válido"
              value={diagnostic.sslOk ? 'certificado aceito' : 'não confirmado'}
              hint={
                diagnostic.sslOk
                  ? 'A conexão foi feita por HTTPS e o certificado do domínio foi aceito sem aviso.'
                  : 'A Meta só lê domínios servidos por HTTPS com certificado válido — um aviso de certificado interrompe a leitura antes do HTML.'
              }
            />

            {/* 3 — método 1 */}
            <DiagnosticRow
              tone={outcomeTone(diagnostic.metaTag.outcome)}
              label="Meta tag no <head> (método 1)"
              value={
                diagnostic.metaTag.outcome === 'ok'
                  ? 'encontrada'
                  : diagnostic.metaTag.outcome === 'ausente'
                    ? 'não encontrada'
                    : 'inconclusivo'
              }
              hint={
                diagnostic.metaTag.expected === null
                  ? 'Nenhum código cadastrado para este site. Copie o valor de content="..." no Business Manager e salve nesta página.'
                  : `A tag facebook-domain-verification vive no HTML e vale na hora. Esperado: ${
                      diagnostic.metaTag.expected
                    }${
                      diagnostic.metaTag.found !== null &&
                      diagnostic.metaTag.found !== diagnostic.metaTag.expected
                        ? ` · publicado: ${diagnostic.metaTag.found}`
                        : ''
                    }`
              }
            />

            {/* 4 — método 2 */}
            <DiagnosticRow
              tone={txtTone(diagnostic.txt)}
              label="Registro TXT no DNS (método 2)"
              statusLabel={diagnostic.txt.applicable ? undefined : 'Não se aplica'}
              value={
                !diagnostic.txt.applicable
                  ? 'não se aplica'
                  : diagnostic.txt.outcome === 'ok'
                    ? 'propagado'
                    : diagnostic.txt.outcome === 'ausente'
                      ? 'não encontrado'
                      : 'inconclusivo'
              }
              hint={
                !diagnostic.txt.applicable
                  ? 'No subdomínio da plataforma a verificação é feita pela meta tag: a zona DNS é nossa e você não consegue criar registros nela. O método TXT só passa a existir com domínio próprio.'
                  : diagnostic.txt.expected === null
                    ? `Nenhum token TXT cadastrado para ${customDomain ?? 'o domínio próprio'}.`
                    : `O TXT não vai no HTML: é uma entrada na zona DNS de ${
                        customDomain ?? 'seu domínio'
                      } e leva de 5 a 15 minutos para propagar. Esperado: facebook-domain-verification=${
                        diagnostic.txt.expected
                      }${
                        diagnostic.txt.records.length > 0
                          ? ` · lidos na zona: ${diagnostic.txt.records.join(' · ')}`
                          : ''
                      }`
              }
            />

            {/* 5 */}
            <DiagnosticRow
              tone={outcomeTone(diagnostic.privacyPolicy.outcome)}
              label="Política de privacidade acessível"
              value={privacyValue(diagnostic.privacyPolicy)}
              hint={privacyHint(diagnostic.privacyPolicy)}
            />

            {/* 6 — a que pega o caso em que tudo parece certo e a Meta falha */}
            <DiagnosticRow
              tone={outcomeTone(diagnostic.crawler.outcome)}
              label="O robô do Facebook consegue acessar"
              value={crawlerValue(diagnostic.crawler)}
              hint={crawlerHint(diagnostic.crawler)}
            />
          </ul>

          <p className="mt-4 text-xs tabular-nums text-dark-500">
            {latencyLabel === null
              ? 'Tempo de resposta não medido.'
              : `Verificado em ${latencyLabel}`}
            {slow
              ? ' — acima de 3 segundos o rastreador da Meta costuma desistir da leitura.'
              : ''}
          </p>

          <p className="mt-4 text-xs leading-relaxed text-dark-500">
            O registro TXT NÃO vai no HTML do site: ele é uma entrada na zona DNS do
            domínio, criada no painel do seu provedor. É por isso que ele demora a
            propagar, enquanto a meta tag passa a valer no instante em que é salva aqui.
          </p>
        </>
      ) : null}
    </section>
  );
}
