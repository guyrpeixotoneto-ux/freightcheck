/**
 * O vocabulário visual do cartão de arquivo recebido — o mesmo nas duas abas.
 *
 * Isto morava dentro de `pages/importacoes.tsx`, privado, quando havia um tipo
 * só de cartão: o da planilha. Com a aba Chamados passando a listar arquivo por
 * arquivo, deixá-lo lá obrigaria a segunda lista a redesenhar o selo de estado e
 * o ladrilho de contador — e duas cópias de "como um arquivo recebido se
 * parece" divergem no primeiro ajuste, dentro da mesma tela.
 *
 * O que é comum às duas abas está aqui; o que é próprio de cada pipeline —
 * quais contadores existem, que estados a máquina tem — fica de cada lado, que
 * é onde a diferença é real.
 */

import { cn } from "@/lib/utils";
import { type Table2 } from "lucide-react";

/**
 * As quatro cores de estado.
 *
 * Duplicata não é erro: é o sistema tendo feito o trabalho dele. Pintá-la de
 * vermelho ensina o operador a procurar culpa onde não há.
 */
export const TONS = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  erro: "bg-red-50 text-red-800 border-red-200",
  neutro: "bg-slate-100 text-slate-700 border-slate-300",
  espera: "bg-amber-50 text-amber-800 border-amber-200",
} as const;

export type TomDoEstado = keyof typeof TONS;

/**
 * O selo de estado, já traduzido.
 *
 * Recebe o rótulo e o tom, e não o status cru, porque as duas abas leem
 * máquinas de estado diferentes — `import_run_status` e `ticket_import_status`.
 * Quem traduz é o `lib` de cada uma; o que este componente garante é que a
 * tradução apareça igual dos dois lados.
 */
export function SeloDeEstado({
  estado,
}: {
  estado: { rotulo: string; tom: TomDoEstado };
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
        TONS[estado.tom],
      )}
    >
      {estado.rotulo}
    </span>
  );
}

export const ACCENTS = {
  indigo: "bg-indigo-50 text-indigo-600",
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  violet: "bg-violet-50 text-violet-600",
  red: "bg-red-50 text-red-500",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-600",
} as const;

/**
 * One produced quantity, as a tile.
 *
 * The icon is decoration; the number is the claim. Erros e Avisos só ganham cor
 * quando são maiores que zero — um zero pintado de vermelho vira alarme onde não
 * há nada a fazer.
 */
export function Metric({
  icon: Icon,
  accent,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof Table2;
  accent: keyof typeof ACCENTS;
  label: string;
  value: string;
  tone?: "bad" | "warn" | "muted";
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-3 flex items-center gap-3">
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          ACCENTS[accent],
        )}
      >
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </div>
        <div
          className={cn(
            "text-lg font-bold tabular-nums leading-tight",
            tone === "bad" && "text-red-600",
            tone === "warn" && "text-orange-500",
          )}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

/**
 * A linha de procedência do arquivo: hash, tamanho, quando e por quem.
 *
 * É a primeira coisa que as duas abas dizem sobre um arquivo, e a razão de ela
 * ser a mesma é literal: é a mesma afirmação. O SHA-256 aparece truncado porque
 * aqui ele identifica o arquivo para quem lê a lista — o dígito completo é da
 * tela de detalhe, onde serve para conferir contra o arquivo que se tem em mãos.
 */
export function Procedencia({
  sha256,
  byteSize,
  quando,
  quem,
}: {
  sha256: string;
  byteSize: number;
  /** Já formatado: cada aba sabe qual das suas datas responde por "quando". */
  quando: string;
  quem: string | null;
}) {
  return (
    <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-[0.6875rem] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
        sha256
      </span>
      <span className="font-mono">{sha256.slice(0, 16)}…</span>
      <span aria-hidden>·</span>
      <span>{(byteSize / 1024).toFixed(0)} KB</span>
      <span aria-hidden>·</span>
      <span>{quando}</span>
      {quem && (
        <>
          <span aria-hidden>·</span>
          <span>por {quem}</span>
        </>
      )}
    </p>
  );
}
