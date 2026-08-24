'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  SITE_TEMPLATE_KEYS,
  SITE_TEMPLATE_LABELS,
} from '@/components/site-templates/types';
import { normalizeSubdomain } from '@/lib/subdomain';
import { SubdomainInput } from './subdomain-input';
import type { WizardData } from './wizard';

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  subdomainError?: string;
  onBack: () => void;
  onNext: () => void;
};

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

/**
 * Máscara de telefone brasileiro. Aplicada durante a digitação para o usuário
 * não precisar acertar a pontuação — o servidor valida só os dígitos.
 */
function mascararTelefone(bruto: string): string {
  const d = bruto.replace(/\D/g, '').slice(0, 11);

  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Token válido de verificação de domínio do Meta: sem espaço, aspas ou `<`. */
const META_TAG_TOKEN = /^[A-Za-z0-9._-]+$/;

/**
 * O usuário costuma colar a tag inteira. Gravar `<meta ... />` faria o Next
 * escapar o HTML dentro do atributo `content`, e o robô do Meta — que compara a
 * string crua no HTML — nunca validaria o domínio. Por isso só o valor entra.
 */
const extractMetaTag = (raw: string): string => {
  const match = raw.match(/content=["']([^"']+)["']/i);
  return (match ? match[1] : raw).trim();
};

export function StepIdentity({
  data,
  onChange,
  subdomainError,
  onBack,
  onNext,
}: Props) {
  const [subdomainValid, setSubdomainValid] = useState(false);

  // Sugestão inicial do endereço a partir da razão social; depois é livre.
  useEffect(() => {
    if (data.subdomain) return;

    const suggested = normalizeSubdomain(data.name || data.companyName);
    if (suggested.length >= 3) onChange({ subdomain: suggested });
    // Só na montagem: reescrever depois atropelaria o que o usuário digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Só acusa erro depois de o usuário passar do DDD: reclamar no primeiro
  // dígito seria ruído enquanto ele ainda está digitando.
  const digitosTelefone = data.phone.replace(/\D/g, '');
  const telefoneInvalido =
    digitosTelefone.length > 2 && (digitosTelefone.length < 10 || digitosTelefone.length > 11);

  const handleValidityChange = useCallback((valid: boolean) => {
    setSubdomainValid(valid);
  }, []);

  const name = data.name.trim();
  const metaTag = data.metaTag.trim();

  const nameError =
    name.length > 0 && name.length < 3 ? 'Nome deve ter no mínimo 3 caracteres' : '';
  const metaTagError =
    metaTag.length > 0 && !META_TAG_TOKEN.test(metaTag)
      ? 'Informe apenas o valor de content, sem espaços ou aspas'
      : '';

  const canContinue =
    name.length >= 3 &&
    name.length <= NAME_MAX &&
    data.description.trim().length <= DESCRIPTION_MAX &&
    !metaTagError &&
    subdomainValid &&
    !subdomainError;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (canContinue) onNext();
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2 className="text-xl font-semibold">Identidade do site</h2>
      <p className="mt-2 text-sm text-dark-400">
        Estes dados aparecem na página pública de{' '}
        <span className="text-dark-300">{data.companyName}</span>.
      </p>

      <div className="mt-6 space-y-6">
        <div>
          <label htmlFor="site-name" className="mb-2 block text-sm font-medium">
            Nome do site
          </label>
          <input
            id="site-name"
            value={data.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Como a empresa é conhecida"
            maxLength={NAME_MAX}
            required
          />
          {nameError && <p className="mt-1 text-xs text-red-400">{nameError}</p>}
        </div>

        <div>
          <label htmlFor="site-description" className="mb-2 block text-sm font-medium">
            Descrição <span className="text-dark-500">(opcional)</span>
          </label>
          <textarea
            id="site-description"
            value={data.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Uma linha sobre o que a empresa faz"
            maxLength={DESCRIPTION_MAX}
            rows={3}
            className="w-full resize-y"
          />
          <p className="mt-1 text-xs tabular-nums text-dark-500">
            {data.description.length}/{DESCRIPTION_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="site-phone" className="mb-2 block text-sm font-medium">
            Telefone de contato <span className="text-dark-500">(opcional)</span>
          </label>
          <input
            id="site-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={data.phone}
            onChange={(e) => onChange({ phone: mascararTelefone(e.target.value) })}
            placeholder="(11) 98765-4321"
            aria-describedby="site-phone-ajuda"
            aria-invalid={telefoneInvalido}
          />
          <p id="site-phone-ajuda" className="mt-1 text-xs text-dark-500">
            Aparece na seção de contato do site e na política de privacidade. Em
            branco, usamos o telefone registrado na Receita Federal.
          </p>
          {telefoneInvalido && (
            <p role="alert" className="mt-1 text-xs text-red-400">
              Informe DDD e número — 10 ou 11 dígitos.
            </p>
          )}
        </div>

        <SubdomainInput
          value={data.subdomain}
          onChange={(subdomain) => onChange({ subdomain })}
          onValidityChange={handleValidityChange}
          externalError={subdomainError}
        />

        <div>
          <label htmlFor="site-meta-tag" className="mb-2 block text-sm font-medium">
            Meta tag do Facebook <span className="text-dark-500">(opcional)</span>
          </label>
          <input
            id="site-meta-tag"
            value={data.metaTag}
            onChange={(e) => onChange({ metaTag: extractMetaTag(e.target.value) })}
            placeholder="abc123verificacaodominio"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-dark-500">
            Cole o valor de <code className="text-dark-400">content</code> da
            verificação de domínio do Business Manager. Se colar a tag inteira,
            extraímos o valor automaticamente.
          </p>
          {metaTagError && <p className="mt-1 text-xs text-red-400">{metaTagError}</p>}
        </div>

        <div>
          <p id="template-label" className="mb-2 text-sm font-medium">
            Template
          </p>
          <div
            role="group"
            aria-labelledby="template-label"
            className="grid gap-3 sm:grid-cols-3"
          >
            {SITE_TEMPLATE_KEYS.map((key) => {
              const selected = data.template === key;

              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ template: key })}
                  className={
                    selected
                      ? 'card border-amber-500/50 text-left shadow-amber-glow'
                      : 'card-hover text-left'
                  }
                >
                  <span
                    className={`text-sm font-medium ${
                      selected ? 'text-amber-400' : 'text-white'
                    }`}
                  >
                    {SITE_TEMPLATE_LABELS[key].name}
                  </span>
                  <span className="mt-1 block text-xs text-dark-400">
                    {SITE_TEMPLATE_LABELS[key].description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-between gap-3">
        <button type="button" onClick={onBack} className="btn-ghost">
          Voltar
        </button>
        <button
          type="submit"
          disabled={!canContinue}
          className="btn-primary disabled:opacity-40 disabled:hover:scale-100"
        >
          Revisar
        </button>
      </div>
    </form>
  );
}
