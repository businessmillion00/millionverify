'use client';

/**
 * Comprovante de Dados Cadastrais do CNPJ.
 *
 * O card oferece duas formas de obter o documento:
 *   1. **Download automático** — botão "Baixar Cartão CNPJ" que chama
 *      GET /api/sites/{id}/cnpj-document e devolve o PDF (oficial da Receita
 *      ou armazenado pelo usuário).
 *   2. **Upload manual** — o usuário envia o comprovante oficial da Receita Federal.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { TutorialLauncher } from '@/components/verification/tutorial-trigger';
import {
  CNPJ_TUTORIAL_STEPS,
  CNPJ_TUTORIAL_SUBTITLE,
  CNPJ_TUTORIAL_TITLE,
  cnpjTutorialVars,
  receitaCnpjUrl,
} from '@/components/verification/cnpj-tutorial-steps';
import { cn, formatCNPJ } from '@/lib/utils';

/**
 * File System Access API — só o Chromium tem, e o TypeScript do DOM ainda não
 * a declara. Tipamos o mínimo que usamos em vez de espalhar `any`.
 */
type SaveFilePickerWindow = {
  showSaveFilePicker(options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
};

const COPY_FEEDBACK_MS = 2500;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type CnpjDocumentCardProps = {
  /** `Site.id` — daqui sai o endpoint do documento quando `uploadUrl` não vem pronto. */
  siteId?: string;
  /** CNPJ do site (a coluna guarda 14 dígitos limpos). */
  cnpj: string;
  companyName: string;
  /** `Site.cnpjDocumentUrl`. */
  documentUrl?: string | null;
  /** `Site.cnpjDocumentAt` já formatado no servidor, para não divergir na hidratação. */
  documentAtLabel?: string | null;
  /**
   * Endpoint do documento (GET baixa, POST anexa, DELETE remove) —
   * `/api/sites/{id}/cnpj-document`. Opcional: com `siteId` ele é derivado.
   */
  uploadUrl?: string;
  className?: string;
};

export function CnpjDocumentCard({
  siteId,
  cnpj,
  companyName,
  documentUrl,
  documentAtLabel,
  uploadUrl: uploadUrlProp,
  className,
}: CnpjDocumentCardProps) {
  const router = useRouter();
  const fileInputId = useId();

  // O endpoint é o mesmo para GET (baixar), POST (anexar) e DELETE. Derivar de
  // `siteId` evita que a tela precise repetir a rota — e que o botão vire um
  // no-op silencioso quando a prop não é passada.
  const uploadUrl =
    uploadUrlProp ?? (siteId ? `/api/sites/${encodeURIComponent(siteId)}/cnpj-document` : undefined);

  const digits = cnpj.replace(/\D/g, '');
  const consultaUrl = receitaCnpjUrl(digits);

  const tutorialVars = useMemo(
    () => cnpjTutorialVars(digits, companyName),
    [companyName, digits],
  );

  const [copiado, setCopiado] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout>>();

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Estado do download automático
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState('');

  const copiarAoAbrir = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(digits);
      setCopiado(true);
      clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopiado(false), COPY_FEEDBACK_MS);
    } catch {
      // Fallback para navegadores sem Clipboard API.
    }
  }, [digits]);

  /* ── Download automático do Cartão CNPJ ── */
  const baixarCartao = useCallback(async () => {
    // Sempre habilitado se o endpoint existe (uploadUrl derivado de siteId)
    if (!uploadUrl) {
      setErroDownload('Endpoint do documento não disponível.');
      return;
    }

    setBaixando(true);
    setErroDownload('');

    try {
      const response = await fetch(uploadUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/pdf' },
        // Evita cache agressivo do Next.js/CDN
        next: { revalidate: 0 },
        cache: 'no-store',
      });

      if (!response.ok) {
        // É um erro JSON
        let errorMessage = `Erro ${response.status}`;
        try {
          const body = await response.json();
          errorMessage = body?.error ?? body?.message ?? errorMessage;
        } catch {
          // Não é JSON — usar texto genérico
          try {
            const text = await response.text();
            if (text) errorMessage = text.slice(0, 200);
          } catch {
            // Silêncio
          }
        }
        throw new Error(errorMessage);
      }

      // Verificar Content-Type
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/pdf')) {
        throw new Error(
          `Resposta inesperada (Content-Type: ${contentType}). Verifique sua autenticação e tente novamente.`,
        );
      }

      // É um PDF — forçar o download via Blob
      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error('O PDF veio vazio do servidor. Tente novamente.');
      }

      // Gerar nome descritivo do arquivo
      const safeName = companyName
        .replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 60);
      const fileName = `CARTAO_CNPJ_${safeName}_${digits}.pdf`;

      // Tentar usar File System Access API (Chrome moderno)
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as unknown as SaveFilePickerWindow).showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          // Fall through to anchor download
        }
      }

      // Fallback: download via anchor tag
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('[Cartão CNPJ] Erro ao baixar:', error);
      setErroDownload(error instanceof Error ? error.message : 'Falha ao baixar');
    } finally {
      setBaixando(false);
    }
  }, [uploadUrl, digits, companyName]);

  /* ── Upload manual ── */
  const selecionarArquivo = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArquivo(file);
    setErro('');
    setSucesso('');
  }, []);

  const enviar = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!uploadUrl || !arquivo) return;

      if (arquivo.size > MAX_UPLOAD_BYTES) {
        setErro(`O arquivo excede o limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
        return;
      }

      setEnviando(true);
      setErro('');
      setSucesso('');

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const formData = new FormData();
        formData.append('file', arquivo);

        const response = await fetch(uploadUrl, {
          method: 'POST',
          credentials: 'include',
          body: formData,
          signal: abortRef.current.signal,
        });

        const body = await response.json().catch(() => ({ error: 'Falha no servidor' }));

        if (!response.ok) {
          setErro(body.error ?? `Erro ${response.status}`);
          return;
        }

        setSucesso('Comprovante anexado com sucesso.');
        setArquivo(null);
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Requisição abortada intencionalmente — ignorar.
        } else {
          setErro('Não foi possível anexar o comprovante agora. Tente novamente em instantes.');
        }
      } finally {
        setEnviando(false);
      }
    },
    [arquivo, uploadUrl, router],
  );

  return (
    <section className={cn('card', className)} aria-labelledby="comprovante-cnpj">
      <header>
        <h2 id="comprovante-cnpj" className="text-lg font-semibold text-white">
          Comprovante do CNPJ
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-dark-400">
          Documento com os dados cadastrais da empresa para a verificação do domínio
          no Meta Business Manager.
        </p>
      </header>

      {/* ── Botão de download automático (destaque) ── */}
      <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="text-sm font-semibold text-amber-300">Baixar Cartão CNPJ</h3>
        <p className="mt-1 text-xs text-dark-400">
          Emite na hora o Comprovante de Inscrição e de Situação Cadastral de {companyName}
          {' '}na Receita Federal — o mesmo PDF oficial do site da Receita, sem o captcha.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={baixarCartao}
            disabled={baixando}
            className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {baixando ? 'Emitindo na Receita…' : 'Baixar Cartão CNPJ'}
          </button>
          {erroDownload && (
            <span role="alert" className="text-xs text-red-400">{erroDownload}</span>
          )}
        </div>
      </div>

      {/* ── Consulta oficial na Receita (alternativa) ── */}
      <div className="divider my-4" />

      <p className="text-xs leading-relaxed text-dark-400">
        Alternativamente, o comprovante oficial é emitido pela{' '}
        <strong className="text-dark-300">Receita Federal</strong>. Abra a consulta
        oficial com o seu CNPJ já preenchido e salve como PDF.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {consultaUrl ? (
          <a
            href={consultaUrl}
            target="_blank"
            rel="noreferrer"
            onClick={copiarAoAbrir}
            className="btn-secondary text-sm"
          >
            Abrir a consulta na Receita Federal
          </a>
        ) : (
          <span className="badge badge-warning text-xs">
            CNPJ incompleto no cadastro deste site
          </span>
        )}

        <TutorialLauncher
          title={CNPJ_TUTORIAL_TITLE}
          subtitle={CNPJ_TUTORIAL_SUBTITLE}
          steps={CNPJ_TUTORIAL_STEPS}
          vars={tutorialVars}
          label="Ver o passo a passo"
          variant="ghost"
        />

        <span role="status" className="text-xs text-dark-500">
          {copiado
            ? 'CNPJ copiado para a área de transferência.'
            : `CNPJ ${formatCNPJ(digits)} · ${companyName}`}
        </span>
      </div>

      {/* ── Comprovante guardado ── */}
      <div className="divider my-6" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-white">Comprovante guardado no painel</h3>
        <span className={`badge text-xs ${documentUrl ? 'badge-success' : 'badge-warning'}`}>
          {documentUrl ? 'Anexado' : 'Nenhum arquivo'}
        </span>
      </div>

      {documentUrl ? (
        <p className="mt-2 text-sm text-dark-400">
          {documentAtLabel
            ? `Comprovante anexado em ${documentAtLabel}. `
            : 'Comprovante anexado. '}
          <a
            href={documentUrl}
            target="_blank"
            rel="noreferrer"
            className="text-amber-400 transition-colors hover:text-amber-300 hover:underline"
          >
            Abrir arquivo
          </a>
        </p>
      ) : (
        <p className="mt-2 text-sm text-dark-400">
          Nenhum comprovante anexado até agora.
        </p>
      )}

      {uploadUrl ? (
        <form onSubmit={enviar} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor={fileInputId}
              className="text-xs font-medium uppercase tracking-widest text-dark-500"
            >
              Anexar o PDF que você baixou
            </label>
            <input
              ref={inputRef}
              id={fileInputId}
              type="file"
              accept="application/pdf,.pdf"
              onChange={selecionarArquivo}
              disabled={enviando}
              className="mt-2 w-full text-sm text-dark-300 file:mr-3 file:rounded-md file:border-0 file:bg-dark-700 file:px-3 file:py-1.5 file:text-sm file:text-dark-200 hover:file:bg-dark-600"
            />
            <p className="mt-1.5 text-xs text-dark-500">
              Só o PDF original salvo na página da Receita, de até 10 MB. Print de tela e
              foto do documento são recusados na análise da Meta.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!arquivo || enviando} className="btn-secondary text-sm">
              {enviando ? 'Enviando…' : 'Anexar comprovante'}
            </button>
            {arquivo && !enviando && (
              <span className="truncate text-xs text-dark-500">{arquivo.name}</span>
            )}
          </div>

          <p role="status" className="text-xs text-green-400">
            {sucesso}
          </p>
          {erro && (
            <p role="alert" className="text-xs text-red-400">
              {erro}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-dark-500">
          O envio do arquivo pelo painel ainda não está disponível.
        </p>
      )}
    </section>
  );
}
