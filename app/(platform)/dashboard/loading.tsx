/**
 * Esqueleto exibido enquanto a página do painel renderiza no servidor.
 *
 * O App Router mostra isto na hora, sem esperar as consultas ao banco. Sem o
 * arquivo, a tela anterior fica congelada durante a navegação — era o que dava
 * a sensação de travamento depois do login.
 *
 * Vale para todas as rotas sob /dashboard, não só a inicial.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>

      {/* Cabeçalho */}
      <div className="h-8 w-56 animate-pulse rounded-lg bg-white/5" />
      <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded bg-white/5" />

      {/* Cartões de métrica */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className="rounded-xl border border-dark-700 bg-white/[0.02] p-6">
            <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
            <div className="mt-4 h-9 w-32 animate-pulse rounded-lg bg-white/5" />
            <div className="mt-3 h-3 w-20 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>

      {/* Bloco de conteúdo */}
      <div className="mt-8 rounded-xl border border-dark-700 bg-white/[0.02] p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-white/5" />
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-12 w-full animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );
}
