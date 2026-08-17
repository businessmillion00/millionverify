'use client';

/**
 * Representação estilizada de um painel de Business Manager.
 * Ilustração de produto na nossa própria linguagem visual — não é
 * uma réplica da interface do Meta nem coleta credencial nenhuma.
 * Toda medida usa `em` para escalar junto com o zoom do scroll.
 */
export function BmScreen({ verified = false }: { verified?: boolean }) {
  const accent = verified ? 'text-emerald-400' : 'text-amber-400';

  return (
    <div className="flex h-full w-full bg-[#141416] text-left">
      {/* sidebar */}
      <aside className="hidden w-[21%] shrink-0 border-r border-white/[0.07] bg-[#0f0f11] p-[1em] sm:block">
        <div className="flex items-center gap-[0.5em]">
          <div className="h-[1.1em] w-[1.1em] rounded-[0.3em] bg-gradient-amber" />
          <div className="h-[0.4em] flex-1 rounded-full bg-white/20" />
        </div>

        <ul className="mt-[1.6em] space-y-[0.85em]">
          {['Visão geral', 'Contas', 'Domínios', 'Segurança'].map((item, i) => (
            <li
              key={item}
              className={`flex items-center gap-[0.5em] text-[0.6em] ${
                i === 2 ? 'font-medium text-amber-400' : 'text-white/45'
              }`}
            >
              <span
                className={`h-[0.5em] w-[0.5em] rounded-[0.15em] ${
                  i === 2 ? 'bg-amber-500' : 'bg-white/25'
                }`}
              />
              <span className="truncate">{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-[2em] space-y-[0.5em]">
          {[70, 50, 62].map((w, i) => (
            <div
              key={i}
              className="h-[0.3em] rounded-full bg-white/[0.09]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </aside>

      {/* conteúdo */}
      <div className="flex flex-1 flex-col p-[1.1em]">
        <div className="flex items-center justify-between">
          <p className="text-[0.75em] font-semibold text-white/90">
            Verificação de domínio
          </p>
          <span
            className={`rounded-full px-[0.9em] py-[0.3em] text-[0.5em] font-semibold ${
              verified
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {verified ? 'Verificado' : 'Pendente'}
          </span>
        </div>

        <div className="mt-[1em] rounded-[0.5em] border border-white/[0.09] bg-[#0d0d0f] p-[0.9em]">
          <p className="text-[0.48em] font-medium uppercase tracking-[0.25em] text-white/35">
            Meta tag
          </p>
          <code className="mt-[0.6em] block break-all font-mono text-[0.52em] leading-relaxed text-amber-300/90">
            &lt;meta name=&quot;facebook-domain-verification&quot;
            content=&quot;a7f2c9e4b1d8&quot; /&gt;
          </code>
        </div>

        <div className="mt-[0.9em] grid grid-cols-3 gap-[0.6em]">
          {[
            ['Domínio', 'ativo', true],
            ['SSL', 'válido', true],
            ['Tag', verified ? 'detectada' : 'aguardando', verified],
          ].map(([label, value, ok]) => (
            <div
              key={label as string}
              className="rounded-[0.4em] border border-white/[0.08] bg-white/[0.03] p-[0.7em]"
            >
              <p className="text-[0.45em] uppercase tracking-wider text-white/35">
                {label as string}
              </p>
              <p
                className={`mt-[0.4em] text-[0.55em] font-medium ${
                  ok ? 'text-emerald-400' : 'text-white/50'
                }`}
              >
                {value as string}
              </p>
            </div>
          ))}
        </div>

        {/* gráfico de barras decorativo, preenche o resto da tela */}
        <div className="mt-[0.9em] flex flex-1 items-end gap-[0.4em] rounded-[0.5em] border border-white/[0.06] bg-white/[0.02] p-[0.8em]">
          {[38, 55, 44, 70, 62, 85, 74, 92, 68, 80, 58, 96].map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-[0.15em] ${
                i > 8 ? 'bg-gradient-amber' : 'bg-white/[0.12]'
              }`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>

        <p className={`mt-[0.7em] text-[0.45em] ${accent}`}>
          {verified
            ? '● Domínio verificado — recursos liberados'
            : '● Aguardando leitura do crawler'}
        </p>
      </div>
    </div>
  );
}
