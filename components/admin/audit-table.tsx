'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  motion,
  useReducedMotion,
  type Target,
  type Transition,
} from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type RegistroAuditoria = {
  id: string;
  action: string;
  resource: string;
  resourceId: string;
  status: string;
  createdAt: Date;
  user: { email: string };
};

/** Ações emitidas pelo código hoje; string crua é o fallback. */
const ACOES: Record<string, string> = {
  USER_REGISTERED: 'Novo cadastro',
  SITE_CREATED: 'Site criado',
  PAYMENT_CREATED: 'Cobrança PIX gerada',
  PAYMENT_RECEIVED: 'Pagamento confirmado',
  ADMIN_ADJUST_BALANCE: 'Ajuste de saldo',
  ADMIN_SET_ROLE: 'Alteração de nível',
  SEED_EXECUTED: 'Carga inicial',
};

const RECURSOS: Record<string, { rotulo: string; classe: string; glifo: string }> = {
  user: {
    rotulo: 'Usuário',
    classe: 'bg-blue-500/15 text-blue-400',
    glifo: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0',
  },
  site: {
    rotulo: 'Site',
    classe: 'bg-emerald-500/15 text-emerald-400',
    glifo: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18',
  },
  payment: {
    rotulo: 'Pagamento',
    classe: 'bg-amber-500/15 text-amber-400',
    glifo: 'M3 7h18v10H3zM3 11h18M7 15h3',
  },
  system: {
    rotulo: 'Sistema',
    classe: 'bg-white/10 text-dark-300',
    glifo: 'M12 3l9 9-9 9-9-9z',
  },
};

const recursoDe = (recurso: string) =>
  RECURSOS[recurso] ?? {
    rotulo: recurso,
    classe: 'bg-white/10 text-dark-300',
    glifo: 'M4 12h16',
  };

const traduzir = (acao: string) => ACOES[acao] ?? acao;

// Fuso fixo: sem isto o servidor (UTC) e o navegador renderizam textos
// diferentes e a hidratação acusa divergência.
const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function Quando({ data }: { data: Date }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const absoluta = formatadorData.format(data);

  return (
    <time
      dateTime={data.toISOString()}
      title={absoluta}
      className="tabular-nums text-dark-400"
    >
      {montado ? formatDistanceToNow(data, { locale: ptBR, addSuffix: true }) : absoluta}
    </time>
  );
}

function Etiqueta({ registro }: { registro: RegistroAuditoria }) {
  const recurso = recursoDe(registro.resource);
  return (
    <span
      className={`badge px-2.5 py-0.5 text-xs ${recurso.classe}`}
      title={`${registro.resource}:${registro.resourceId}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden
        className="mr-1.5 h-3.5 w-3.5"
      >
        <path d={recurso.glifo} />
      </svg>
      {recurso.rotulo}
    </span>
  );
}

export function AuditTable({ registros }: { registros: RegistroAuditoria[] }) {
  const [filtro, setFiltro] = useState<string>('todas');
  const reduzido = useReducedMotion();

  const acoes = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const r of registros) contagem.set(r.action, (contagem.get(r.action) ?? 0) + 1);
    return Array.from(contagem, ([acao, total]) => ({ acao, total })).sort(
      (a, b) => b.total - a.total || traduzir(a.acao).localeCompare(traduzir(b.acao), 'pt-BR')
    );
  }, [registros]);

  const filtrados = useMemo(
    () => (filtro === 'todas' ? registros : registros.filter((r) => r.action === filtro)),
    [registros, filtro]
  );

  const entrada = (
    i: number
  ): {
    initial: false | Target;
    animate: Target;
    transition: Transition;
  } => ({
    initial: reduzido ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: reduzido ? 0 : 0.4,
      delay: reduzido ? 0 : Math.min(i * 0.03, 0.45),
      ease: [0.22, 1, 0.36, 1],
    },
  });

  return (
    <section className="rounded-2xl border border-dark-700 bg-white/[0.02] p-6 shadow-luxury sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">
            Auditoria
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Atividade recente
          </h2>
          <p className="mt-2 text-sm text-dark-400">
            Todo evento crítico do produto — quem fez, sobre o quê e quando.
          </p>
        </div>

        <p className="text-sm tabular-nums text-dark-500">
          {filtrados.length} de {registros.length} eventos
        </p>
      </div>

      {registros.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFiltro('todas')}
            aria-pressed={filtro === 'todas'}
            className={`badge text-xs transition-colors ${
              filtro === 'todas'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-white/[0.04] text-dark-400 hover:text-white'
            }`}
          >
            Todas
            <span className="ml-2 tabular-nums opacity-70">{registros.length}</span>
          </button>

          {acoes.map(({ acao, total }) => (
            <button
              key={acao}
              type="button"
              onClick={() => setFiltro(acao)}
              aria-pressed={filtro === acao}
              title={acao}
              className={`badge text-xs transition-colors ${
                filtro === acao
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-white/[0.04] text-dark-400 hover:text-white'
              }`}
            >
              {traduzir(acao)}
              <span className="ml-2 tabular-nums opacity-70">{total}</span>
            </button>
          ))}
        </div>
      )}

      {filtrados.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-dark-700 bg-gradient-amber-subtle px-6 py-14 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            aria-hidden
            className="mx-auto h-10 w-10 text-amber-500/70"
          >
            <path d="M4 5h16M4 12h10M4 19h7" />
            <circle cx="17.5" cy="17.5" r="3.5" />
            <path d="M20 20l2 2" />
          </svg>
          <p className="mt-5 text-base font-medium text-white">
            {registros.length === 0
              ? 'Nenhum evento registrado ainda'
              : 'Nenhum evento para este filtro'}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-dark-400">
            {registros.length === 0
              ? 'Cadastros, cobranças PIX e criação de sites aparecem aqui assim que acontecerem.'
              : 'Escolha outra ação para ver o histórico correspondente.'}
          </p>
          {registros.length > 0 && (
            <button
              type="button"
              onClick={() => setFiltro('todas')}
              className="btn-secondary mt-6 text-sm"
            >
              Limpar filtro
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Tabela (telas grandes) */}
          <div className="mt-6 hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-dark-500">
                <tr className="border-b border-dark-700">
                  <th scope="col" className="py-3 pr-4 font-medium">Ação</th>
                  <th scope="col" className="px-4 py-3 font-medium">Usuário</th>
                  <th scope="col" className="px-4 py-3 font-medium">Recurso</th>
                  <th scope="col" className="py-3 pl-4 text-right font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((registro, i) => (
                  <motion.tr
                    key={`${filtro}-${registro.id}`}
                    {...entrada(i)}
                    className="border-b border-dark-800 last:border-0 transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="py-3.5 pr-4">
                      <p className="font-medium text-white">{traduzir(registro.action)}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-dark-500">
                        {registro.action}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-dark-300">{registro.user.email}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Etiqueta registro={registro} />
                        <span className="font-mono text-[11px] text-dark-500">
                          {registro.resourceId.slice(0, 8)}
                        </span>
                        {registro.status !== 'success' && (
                          <span className="badge badge-error px-2 py-0.5 text-[11px]">
                            {registro.status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 pl-4 text-right">
                      <Quando data={registro.createdAt} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cartões (telas pequenas) */}
          <ul className="mt-6 space-y-3 lg:hidden">
            {filtrados.map((registro, i) => (
              <motion.li
                key={`${filtro}-${registro.id}`}
                {...entrada(i)}
                className="rounded-xl border border-dark-800 bg-white/[0.02] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-white">{traduzir(registro.action)}</p>
                  {registro.status !== 'success' && (
                    <span className="badge badge-error px-2 py-0.5 text-[11px]">
                      {registro.status}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-dark-300">{registro.user.email}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <Etiqueta registro={registro} />
                  <Quando data={registro.createdAt} />
                </div>
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
