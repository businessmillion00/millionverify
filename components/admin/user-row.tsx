'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { adjustTokenBalance, setUserRole } from '@/app/actions/admin';
import { cn } from '@/lib/utils';

export type UsuarioAdmin = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tokenBalance: number;
  createdAt: Date;
  _count: { sites: number; payments: number };
};

// Fuso fixo para o servidor (UTC) e o navegador produzirem o mesmo texto.
const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Estado e chamadas de escrita compartilhados pela linha (desktop) e pelo cartão (mobile). */
function useControlesUsuario(user: UsuarioAdmin, isSelf: boolean) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const confirmar = (mensagem: string) => {
    setSucesso(mensagem);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSucesso(''), 2200);
  };

  const ajustar = () => {
    const valor = Number(amount);
    // O Zod já recusa, mas validar aqui evita uma ida inútil ao servidor.
    if (!Number.isInteger(valor) || valor === 0) {
      setSucesso('');
      setErro('Informe um número inteiro diferente de zero');
      return;
    }

    setErro('');
    setSucesso('');
    startTransition(async () => {
      const result = await adjustTokenBalance({
        userId: user.id,
        amount: valor,
        reason: 'Ajuste via painel admin',
      });
      if (!result.success) {
        setErro(result.error ?? 'Não foi possível ajustar o saldo');
        return;
      }
      setAmount('');
      confirmar(`${valor > 0 ? '+' : ''}${valor.toLocaleString('pt-BR')} tokens`);
      // A action só revalida /admin/users; o refresh mantém qualquer outra rota em dia.
      router.refresh();
    });
  };

  const alternarNivel = () => {
    if (isSelf) return;
    setErro('');
    setSucesso('');
    startTransition(async () => {
      const result = await setUserRole({
        userId: user.id,
        role: user.role === 'ADMIN' ? 'USER' : 'ADMIN',
      });
      if (!result.success) {
        setErro(result.error ?? 'Não foi possível alterar o nível');
        return;
      }
      confirmar(user.role === 'ADMIN' ? 'Agora é USER' : 'Agora é ADMIN');
      router.refresh();
    });
  };

  return { amount, setAmount, erro, sucesso, pending, ajustar, alternarNivel };
}

function BotaoNivel({
  role,
  isSelf,
  pending,
  onToggle,
}: {
  role: string;
  isSelf: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const admin = role === 'ADMIN';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending || isSelf}
      aria-pressed={admin}
      aria-label={
        isSelf
          ? 'Você não pode alterar seu próprio nível'
          : `Tornar ${admin ? 'USER' : 'ADMIN'}`
      }
      title={
        isSelf
          ? 'Você não pode alterar seu próprio nível'
          : `Clique para tornar ${admin ? 'USER' : 'ADMIN'}`
      }
      className={cn(
        'badge text-xs transition-all duration-200',
        admin ? 'badge-amber' : 'badge-info',
        isSelf
          ? 'cursor-not-allowed opacity-60'
          : 'hover:ring-1 hover:ring-amber-500/40',
        pending && 'opacity-50'
      )}
    >
      {admin ? 'ADMIN' : 'USER'}
    </button>
  );
}

function Mensagem({ erro, sucesso }: { erro: string; sucesso: string }) {
  return (
    <div className="min-h-[1.125rem]">
      <AnimatePresence mode="wait" initial={false}>
        {erro ? (
          <motion.p
            key="erro"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="text-xs text-red-400"
          >
            {erro}
          </motion.p>
        ) : sucesso ? (
          <motion.p
            key="sucesso"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="text-xs tabular-nums text-emerald-400"
          >
            {sucesso}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AjusteSaldo({
  amount,
  setAmount,
  pending,
  onAplicar,
}: {
  amount: string;
  setAmount: (v: string) => void;
  pending: boolean;
  onAplicar: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="number"
        step={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && amount) onAplicar();
        }}
        placeholder="±tokens"
        aria-label="Ajuste de tokens"
        className="w-28 py-1 text-sm"
      />
      <button
        type="button"
        onClick={onAplicar}
        disabled={pending || !amount}
        className="btn-secondary px-3 py-1 text-sm disabled:opacity-40"
      >
        {pending ? 'Aplicando…' : 'Aplicar'}
      </button>
    </div>
  );
}

/** Linha da tabela (telas grandes). */
export function UserRow({
  user,
  isSelf = false,
}: {
  user: UsuarioAdmin;
  isSelf?: boolean;
}) {
  const { amount, setAmount, erro, sucesso, pending, ajustar, alternarNivel } =
    useControlesUsuario(user, isSelf);

  return (
    <tr className="border-b border-dark-800 transition-colors last:border-0 hover:bg-white/[0.03]">
      <td className="py-3.5 pl-6 pr-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-amber-subtle text-sm font-semibold text-amber-400 ring-1 ring-amber-500/20"
          >
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">
              {user.name ?? '—'}
              {isSelf && (
                <span className="ml-2 text-xs font-normal text-amber-500/80">você</span>
              )}
            </p>
            <p className="truncate text-xs text-dark-500">{user.email}</p>
          </div>
        </div>
      </td>

      <td className="px-4 py-3.5">
        <BotaoNivel
          role={user.role}
          isSelf={isSelf}
          pending={pending}
          onToggle={alternarNivel}
        />
      </td>

      <td className="px-4 py-3.5 tabular-nums text-white">
        {user.tokenBalance.toLocaleString('pt-BR')}
      </td>

      <td className="px-4 py-3.5 tabular-nums text-dark-400">
        {user._count.sites} · {user._count.payments} pgto
      </td>

      <td className="px-4 py-3.5 tabular-nums text-dark-400">
        {formatadorData.format(user.createdAt)}
      </td>

      <td className="py-3.5 pl-4 pr-6">
        <AjusteSaldo
          amount={amount}
          setAmount={setAmount}
          pending={pending}
          onAplicar={ajustar}
        />
        <Mensagem erro={erro} sucesso={sucesso} />
      </td>
    </tr>
  );
}

/** Mesmo conteúdo em cartão (telas pequenas) — a tabela rolando na horizontal é ruim no mobile. */
export function UserCard({
  user,
  isSelf = false,
}: {
  user: UsuarioAdmin;
  isSelf?: boolean;
}) {
  const { amount, setAmount, erro, sucesso, pending, ajustar, alternarNivel } =
    useControlesUsuario(user, isSelf);

  return (
    <li className="rounded-xl border border-dark-800 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-white">
            {user.name ?? '—'}
            {isSelf && (
              <span className="ml-2 text-xs font-normal text-amber-500/80">você</span>
            )}
          </p>
          <p className="truncate text-xs text-dark-500">{user.email}</p>
        </div>
        <BotaoNivel
          role={user.role}
          isSelf={isSelf}
          pending={pending}
          onToggle={alternarNivel}
        />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-dark-500">Tokens</dt>
          <dd className="mt-0.5 tabular-nums text-white">
            {user.tokenBalance.toLocaleString('pt-BR')}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-dark-500">Sites</dt>
          <dd className="mt-0.5 tabular-nums text-dark-300">
            {user._count.sites} · {user._count.payments} pgto
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-dark-500">Desde</dt>
          <dd className="mt-0.5 tabular-nums text-dark-300">
            {formatadorData.format(user.createdAt)}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <AjusteSaldo
          amount={amount}
          setAmount={setAmount}
          pending={pending}
          onAplicar={ajustar}
        />
        <Mensagem erro={erro} sucesso={sucesso} />
      </div>
    </li>
  );
}

type Campo = 'usuario' | 'tokens' | 'sites' | 'criado';
type Direcao = 'asc' | 'desc';
type Nivel = 'todos' | 'ADMIN' | 'USER';

function Seta({ direcao }: { direcao: Direcao }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      className={cn(
        'ml-1 inline h-3 w-3 transition-transform duration-200',
        direcao === 'asc' && 'rotate-180'
      )}
    >
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

function ThOrdenavel({
  campo,
  rotulo,
  className,
  ativo,
  direcao,
  onOrdenar,
}: {
  campo: Campo;
  rotulo: string;
  className: string;
  ativo: Campo;
  direcao: Direcao;
  onOrdenar: (campo: Campo) => void;
}) {
  const selecionado = ativo === campo;
  return (
    <th
      scope="col"
      className={cn('text-left font-medium', className)}
      aria-sort={selecionado ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onOrdenar(campo)}
        className={cn(
          'flex items-center py-4 uppercase tracking-widest transition-colors hover:text-white',
          selecionado && 'text-amber-400'
        )}
      >
        {rotulo}
        {selecionado && <Seta direcao={direcao} />}
      </button>
    </th>
  );
}

/** Tabela completa: busca, filtro por nível e ordenação, tudo no cliente (lista limitada a 100). */
export function UsersTable({
  users,
  currentAdminId,
}: {
  users: UsuarioAdmin[];
  currentAdminId: string | null;
}) {
  const [busca, setBusca] = useState('');
  const [nivel, setNivel] = useState<Nivel>('todos');
  const [campo, setCampo] = useState<Campo>('criado');
  const [direcao, setDirecao] = useState<Direcao>('desc');

  const ordenar = (proximo: Campo) => {
    if (proximo === campo) {
      setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setCampo(proximo);
    setDirecao(proximo === 'usuario' ? 'asc' : 'desc');
  };

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim());

    const filtrados = users.filter((u) => {
      if (nivel !== 'todos' && u.role !== nivel) return false;
      if (!termo) return true;
      return normalizar(`${u.name ?? ''} ${u.email}`).includes(termo);
    });

    const comparar = (a: UsuarioAdmin, b: UsuarioAdmin) => {
      switch (campo) {
        case 'usuario':
          return (a.name ?? a.email).localeCompare(b.name ?? b.email, 'pt-BR');
        case 'tokens':
          return a.tokenBalance - b.tokenBalance;
        case 'sites':
          return a._count.sites - b._count.sites || a._count.payments - b._count.payments;
        case 'criado':
          return a.createdAt.getTime() - b.createdAt.getTime();
      }
    };

    return [...filtrados].sort((a, b) => (direcao === 'asc' ? comparar(a, b) : -comparar(a, b)));
  }, [users, busca, nivel, campo, direcao]);

  const niveis: { chave: Nivel; rotulo: string }[] = [
    { chave: 'todos', rotulo: 'Todos' },
    { chave: 'ADMIN', rotulo: 'Admins' },
    { chave: 'USER', rotulo: 'Usuários' },
  ];

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            aria-label="Buscar usuários"
            className="w-full py-2 pl-10 pr-4 text-sm"
          />
        </div>

        <div className="flex gap-2" role="group" aria-label="Filtrar por nível">
          {niveis.map(({ chave, rotulo }) => (
            <button
              key={chave}
              type="button"
              onClick={() => setNivel(chave)}
              aria-pressed={nivel === chave}
              className={cn(
                'badge text-xs transition-colors',
                nivel === chave
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-white/[0.04] text-dark-400 hover:text-white'
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <p className="text-sm tabular-nums text-dark-500">
          {visiveis.length} de {users.length}
        </p>
      </div>

      {visiveis.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-dark-700 bg-gradient-amber-subtle px-6 py-14 text-center">
          <p className="text-base font-medium text-white">Nenhum usuário encontrado</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-dark-400">
            Ajuste a busca ou volte para o filtro “Todos”.
          </p>
          <button
            type="button"
            onClick={() => {
              setBusca('');
              setNivel('todos');
            }}
            className="btn-secondary mt-6 text-sm"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <>
          <div className="card mt-6 hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-dark-500">
                <tr className="border-b border-dark-700">
                  <ThOrdenavel
                    campo="usuario"
                    rotulo="Usuário"
                    className="pl-6 pr-4"
                    ativo={campo}
                    direcao={direcao}
                    onOrdenar={ordenar}
                  />
                  <th scope="col" className="px-4 py-4 font-medium">
                    Nível
                  </th>
                  <ThOrdenavel
                    campo="tokens"
                    rotulo="Tokens"
                    className="px-4"
                    ativo={campo}
                    direcao={direcao}
                    onOrdenar={ordenar}
                  />
                  <ThOrdenavel
                    campo="sites"
                    rotulo="Sites"
                    className="px-4"
                    ativo={campo}
                    direcao={direcao}
                    onOrdenar={ordenar}
                  />
                  <ThOrdenavel
                    campo="criado"
                    rotulo="Cadastro"
                    className="px-4"
                    ativo={campo}
                    direcao={direcao}
                    onOrdenar={ordenar}
                  />
                  <th scope="col" className="py-4 pl-4 pr-6 font-medium">
                    Ajuste de saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isSelf={user.id === currentAdminId}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-6 space-y-3 lg:hidden">
            {visiveis.map((user) => (
              <UserCard key={user.id} user={user} isSelf={user.id === currentAdminId} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
