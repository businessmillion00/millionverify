'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { runVerification, saveVerification } from '@/app/actions/verification';
import { CopyField } from '@/components/verification/copy-field';
import { BM_DOMAINS_URL } from '@/components/verification/tutorial-steps';

/**
 * Formulário dos dois métodos de verificação da Meta.
 *
 * META TAG  → vai no <head> do site que nós servimos. Vale na hora.
 * REGISTRO TXT → entrada na ZONA DNS do domínio. NÃO vai no HTML e só existe
 *   para quem apontou um domínio próprio: a zona de {subdomínio}.million-verify.com
 *   é nossa, o cliente não tem onde criar o registro. Por isso o bloco fica
 *   desabilitado (com o motivo escrito) enquanto não houver domínio próprio.
 */

type Props = {
  siteId: string;
  host: string;
  /** Domínio próprio apontado para o site; null = subdomínio da plataforma. */
  customDomain: string | null;
  metaTag: string | null;
  metaTagVerified: boolean;
  metaTagLastCheckedLabel: string | null;
  verificationTxt: string | null;
  verificationTxtVerified: boolean;
  verificationTxtLastCheckedLabel: string | null;
};

type Tone = 'success' | 'warning' | 'error';

type Feedback = {
  tone: Tone;
  message: string;
  /** Lista de impedimentos vinda do diagnóstico, já escrita em pt-BR. */
  problems: string[];
};

/** Teto do que cabe no aviso sem virar parede de texto; o cartão ao lado repete. */
const MAX_PROBLEMS = 3;

const TXT_PREFIX = 'facebook-domain-verification';

const FEEDBACK_TONE: Record<Tone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  error: 'border-red-500/30 bg-red-500/5 text-red-300',
};

const metaTagSnippet = (token: string): string =>
  `<meta name="facebook-domain-verification" content="${token}" />`;

export function VerificationPanel({
  siteId,
  host,
  customDomain,
  metaTag,
  metaTagVerified,
  metaTagLastCheckedLabel,
  verificationTxt,
  verificationTxtVerified,
  verificationTxtLastCheckedLabel,
}: Props) {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;

  const [metaTagInput, setMetaTagInput] = useState(metaTag ?? '');
  const [txtInput, setTxtInput] = useState(verificationTxt ?? '');
  const [busy, setBusy] = useState<'idle' | 'saving' | 'checking'>('idle');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const txtEnabled = customDomain !== null;
  const working = busy !== 'idle';

  const check = async () => {
    const result = await runVerification({ siteId });

    if (!result.success) {
      setFeedback({ tone: 'error', message: result.error, problems: [] });
      return;
    }

    const { verified, inconclusive, message, problems, checkedAtLabel } = result.data;

    setFeedback({
      // 'indeterminado' é âmbar, não vermelho: o resultado anterior foi mantido e
      // nada precisa ser corrigido pelo cliente.
      tone: verified ? 'success' : inconclusive ? 'warning' : 'error',
      message: `${message} Checado em ${checkedAtLabel}.`,
      problems,
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;

    setBusy('saving');
    setFeedback(null);

    try {
      const saved = await saveVerification({
        siteId,
        metaTag: metaTagInput,
        // Campo desabilitado não é enviado: `undefined` preserva o que já existe
        // no banco em vez de apagá-lo.
        verificationTxt: txtEnabled ? txtInput : undefined,
      });

      if (!saved.success) {
        setFeedback({ tone: 'error', message: saved.error, problems: [] });
        return;
      }

      // Mostra o valor normalizado que foi realmente gravado — quem colou a tag
      // inteira vê agora só o token, igual ao que a checagem procura.
      setMetaTagInput(saved.data.metaTag ?? '');
      if (txtEnabled) setTxtInput(saved.data.verificationTxt ?? '');

      if (saved.data.metaTag === null && saved.data.verificationTxt === null) {
        setFeedback({
          tone: 'warning',
          message: 'Código removido. Sem ele a Meta não tem como verificar o domínio.',
          problems: [],
        });
        return;
      }

      setBusy('checking');
      await check();
    } catch {
      setFeedback({
        tone: 'error',
        message: 'Não foi possível salvar agora. Tente novamente.',
        problems: [],
      });
    } finally {
      setBusy('idle');
      // O estado exibido (badges, última checagem, diagnóstico) vive no server
      // component: sem refresh a tela ficaria contando a história antiga.
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2 className="text-xl font-semibold">Código de verificação da Meta</h2>
      <p className="mt-1 text-sm text-dark-400">
        A Meta aceita dois caminhos. Você só precisa de um — e o de cima é o que
        funciona no seu endereço.
      </p>

      {/* ── MÉTODO 1: META TAG ─────────────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-amber-500/25 bg-amber-500/[0.03] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-medium">Meta tag no site</h3>
          <span className="badge badge-amber text-xs">Recomendado · vale na hora</span>
        </div>

        <p className="mt-2 text-sm text-dark-400">
          No Business Manager, em Domínios, escolha a opção de{' '}
          <span className="text-dark-200">meta tag</span>. Cole aqui a tag inteira ou só
          o valor de{' '}
          <span className="font-mono text-dark-200">content=&quot;…&quot;</span> — ela
          entra no <span className="font-mono text-dark-200">&lt;head&gt;</span> de{' '}
          {host} imediatamente, sem republicar o site.
        </p>

        <label htmlFor="metaTag" className="mt-5 mb-2 block text-sm font-medium">
          Código da meta tag
        </label>
        <textarea
          id="metaTag"
          name="metaTag"
          rows={3}
          maxLength={500}
          autoComplete="off"
          spellCheck={false}
          value={metaTagInput}
          onChange={(event) => setMetaTagInput(event.target.value)}
          placeholder='<meta name="facebook-domain-verification" content="a1b2c3d4e5f6" />'
          className="w-full font-mono text-sm"
        />
        <p className="mt-1 text-xs text-dark-500">
          Guardamos apenas o valor de content. Trocar o código zera a confirmação
          anterior — a checagem roda de novo contra o HTML servido.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={metaTagVerified ? 'badge badge-success' : 'badge badge-warning'}>
            {metaTagVerified
              ? 'Tag encontrada no site'
              : metaTag
                ? 'Aguardando confirmação'
                : 'Nenhum código salvo'}
          </span>
          <span className="text-xs text-dark-500">
            {metaTagLastCheckedLabel
              ? `Checado em ${metaTagLastCheckedLabel}`
              : 'Ainda não checamos.'}
          </span>
        </div>

        {metaTag && (
          <div className="mt-4">
            <CopyField
              label="Tag servida hoje no <head> do site"
              value={metaTagSnippet(metaTag)}
              hint="É esta linha que a Meta encontra ao abrir o seu endereço."
              multiline
            />
          </div>
        )}
      </section>

      {/* ── MÉTODO 2: REGISTRO TXT ─────────────────────────────────────── */}
      <section className="mt-5 rounded-xl border border-dark-700 bg-white/[0.02] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-medium text-dark-200">Registro TXT no DNS</h3>
          <span className="badge badge-info text-xs">Alternativa · 5 a 15 min</span>
        </div>

        {txtEnabled ? (
          <>
            <p className="mt-2 text-sm text-dark-400">
              Como <span className="text-dark-200">{customDomain}</span> é um domínio
              seu, dá para verificar pelo DNS. Crie no seu provedor um registro{' '}
              <span className="text-dark-200">TXT</span> na raiz do domínio com o valor
              abaixo e salve o token aqui — a checagem resolve o DNS, não o HTML.
            </p>

            <label htmlFor="verificationTxt" className="mt-5 mb-2 block text-sm font-medium">
              Token do registro TXT
            </label>
            <input
              id="verificationTxt"
              name="verificationTxt"
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              value={txtInput}
              onChange={(event) => setTxtInput(event.target.value)}
              placeholder={`${TXT_PREFIX}=a1b2c3d4e5f6`}
              className="w-full font-mono text-sm"
            />
            <p className="mt-1 text-xs text-dark-500">
              Pode colar a linha inteira; guardamos só o token depois do sinal de igual.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span
                className={
                  verificationTxtVerified ? 'badge badge-success' : 'badge badge-warning'
                }
              >
                {verificationTxtVerified
                  ? 'TXT encontrado no DNS'
                  : verificationTxt
                    ? 'Aguardando propagação'
                    : 'Nenhum token salvo'}
              </span>
              <span className="text-xs text-dark-500">
                {verificationTxtLastCheckedLabel
                  ? `Checado em ${verificationTxtLastCheckedLabel}`
                  : 'Ainda não checamos.'}
              </span>
            </div>

            {verificationTxt && (
              <div className="mt-4">
                <CopyField
                  label="Valor do registro TXT"
                  value={`${TXT_PREFIX}=${verificationTxt}`}
                  hint={`Crie o registro TXT na zona de ${customDomain}. A propagação leva de 5 a 15 minutos.`}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-dark-400">
              Este caminho pede uma entrada na{' '}
              <span className="text-dark-200">zona DNS</span> do domínio — não é algo que
              se cole no HTML. Como o seu site vive em{' '}
              <span className="text-dark-200">{host}</span>, a zona é nossa e você não
              tem onde criar o registro. Ele só passa a valer se você apontar um domínio
              próprio para o site.
            </p>

            <label
              htmlFor="verificationTxtDisabled"
              className="mt-5 mb-2 block text-sm font-medium text-dark-500"
            >
              Token do registro TXT
            </label>
            <input
              id="verificationTxtDisabled"
              disabled
              value=""
              readOnly
              placeholder="Disponível com domínio próprio"
              aria-describedby="txt-indisponivel"
              className="w-full cursor-not-allowed font-mono text-sm opacity-50"
            />
            <p id="txt-indisponivel" className="mt-1 text-xs text-dark-500">
              Fique na meta tag acima: ela resolve a verificação no mesmo minuto.
            </p>
          </>
        )}
      </section>

      {/* ── AÇÕES ──────────────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={working} className="btn-primary disabled:opacity-50">
          {busy === 'saving'
            ? 'Salvando…'
            : busy === 'checking'
              ? 'Verificando…'
              : 'Salvar e verificar'}
        </button>

        <a
          href={BM_DOMAINS_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-sm"
        >
          Abrir Domínios no Business Manager
        </a>
      </div>

      <div aria-live="polite" className="min-h-[1px]">
        <AnimatePresence initial={false} mode="wait">
          {feedback && (
            <motion.div
              key={`${feedback.tone}-${feedback.message}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
              className={`mt-5 rounded-lg border p-4 text-sm ${FEEDBACK_TONE[feedback.tone]}`}
            >
              <p>{feedback.message}</p>

              {feedback.problems.length > 0 && (
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-dark-300">
                  {feedback.problems.slice(0, MAX_PROBLEMS).map((problem) => (
                    <li key={problem} className="flex gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-60"
                      />
                      <span>{problem}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-dark-500">
        O “Diagnóstico do site”, logo abaixo, confere o que o seu endereço está servindo
        neste instante — é a prova de que o problema não está aqui. Quem aperta o botão
        “Verificar domínio” de verdade é você, dentro do Business Manager.
      </p>
    </form>
  );
}
