'use client';

import { BmScreen } from './bm-screen';

/**
 * MacBook Pro em CSS puro, proporções do modelo de 14".
 *
 * As espessuras usam clamp(vw) em vez de % — percentual de altura contra
 * um pai de altura automática colapsa para zero. Como o conjunto inteiro é
 * ampliado por `transform: scale()`, essas medidas acompanham o zoom sem
 * perder nitidez: o conteúdo da tela segue sendo DOM real, não bitmap.
 */
export function Macbook() {
  return (
    <div className="relative select-none">
      {/* ─────────── TAMPA ─────────── */}
      <div
        data-lid
        className="relative rounded-[clamp(8px,1.2vw,18px)] p-[clamp(4px,0.55vw,8px)] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.9)]"
        style={{
          background:
            'linear-gradient(160deg,#7c7c82 0%,#4a4a4f 14%,#35353a 50%,#2a2a2e 86%,#55555b 100%)',
        }}
      >
        {/* fio de luz na borda superior do alumínio */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[6%] top-0 h-px rounded-full bg-white/40"
        />

        {/* moldura preta */}
        <div
          className="relative rounded-[clamp(5px,0.85vw,13px)] bg-[#0b0b0c] p-[clamp(3px,0.5vw,7px)]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' }}
        >
          {/* tela */}
          <div className="relative aspect-[16/10.4] overflow-hidden rounded-[clamp(3px,0.45vw,7px)] bg-[#0d0d0f] text-[clamp(11px,1.62vw,21px)]">
            <div className="absolute inset-0">
              <BmScreen verified />
            </div>
            <div data-screen-pending className="absolute inset-0">
              <BmScreen />
            </div>

            {/* notch */}
            <div
              aria-hidden
              className="absolute left-1/2 top-0 z-20 h-[clamp(7px,1.05vw,15px)] w-[13%] -translate-x-1/2 rounded-b-[clamp(3px,0.4vw,6px)] bg-[#0b0b0c]"
            >
              <div className="absolute left-1/2 top-1/2 h-[clamp(2px,0.28vw,4px)] w-[clamp(2px,0.28vw,4px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22222a]" />
            </div>

            {/* reflexo diagonal do vidro */}
            <div
              data-glare
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                background:
                  'linear-gradient(112deg,rgba(255,255,255,0.10) 0%,rgba(255,255,255,0.035) 18%,transparent 42%,transparent 100%)',
              }}
            />
            {/* vinheta */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                background:
                  'radial-gradient(120% 90% at 50% 40%,transparent 55%,rgba(0,0,0,0.45) 100%)',
              }}
            />
          </div>

          {/* queixo da tampa — liso, como no aparelho real */}
          <div className="h-[clamp(6px,0.9vw,13px)]" />
        </div>
      </div>

      {/* ─────────── DOBRADIÇA + BASE ─────────── */}
      <div data-chassis className="relative">
        {/* vinco da dobradiça */}
        <div
          className="mx-auto h-[clamp(2px,0.3vw,4px)] w-[97%]"
          style={{ background: 'linear-gradient(180deg,#17171a,#0b0b0d)' }}
        />

        {/* deck */}
        <div
          className="relative mx-auto h-[clamp(7px,1vw,14px)] w-[104%] rounded-b-[clamp(4px,0.6vw,9px)]"
          style={{
            background:
              'linear-gradient(180deg,#8e8e95 0%,#5b5b61 20%,#3d3d42 58%,#232327 100%)',
            boxShadow: '0 18px 34px -12px rgba(0,0,0,0.85)',
          }}
        >
          {/* entalhe para abrir a tampa */}
          <div className="absolute left-1/2 top-0 h-[45%] w-[11%] -translate-x-1/2 rounded-b-full bg-[#191920]" />
        </div>

        {/* sombra de contato com a mesa */}
        <div
          aria-hidden
          className="mx-auto mt-[clamp(4px,0.6vw,9px)] h-[clamp(8px,1.1vw,16px)] w-[84%] rounded-[50%] blur-lg"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        />
      </div>
    </div>
  );
}
