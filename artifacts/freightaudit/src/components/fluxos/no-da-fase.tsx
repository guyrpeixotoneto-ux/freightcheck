import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { ALTURA_DA_FASE } from "@/lib/fluxos-visoes";
import type { DadosDaFase } from "@/lib/fluxos-canvas";

/**
 * A FAIXA DA FASE — o capítulo do processo, acima dos cartões.
 *
 * É o cabeçalho colorido do fluxograma de parede: "Preparação", "Emissão",
 * "Fiscal", "Financeiro". Vale a pena porque muda o que o desenho responde de
 * relance — sem ela, vinte cartões são vinte cartões; com ela, são sete
 * momentos, e o olho encontra o trecho que interessa antes de ler qualquer
 * nome de etapa.
 *
 * Como a raia, é **cenário**: não é entidade, não seleciona, não arrasta e não
 * abre painel. A fase é a leitura de um campo que já está na etapa (a área, por
 * padrão), e mudá-la é mudar aquele campo no painel de detalhe de sempre.
 *
 * O corpo é quase transparente de propósito. O que precisa de cor é a barra do
 * título; pintar a coluna inteira brigaria com a cor do cartão, que é a que
 * carrega significado — o tipo da etapa, ou a severidade nos Gargalos.
 */

/**
 * As cores das fases, na ordem em que são gastas.
 *
 * Sete, e cíclicas: um processo com mais de sete fases repete a primeira cor em
 * vez de ganhar um tom novo inventado na hora. A cor aqui é **ritmo de
 * leitura** — serve para dizer "mudou de capítulo" —, não um código que alguém
 * precise decorar; o nome da fase está escrito ao lado, em letra maiúscula.
 */
const CORES: { barra: string; texto: string; corpo: string }[] = [
  {
    barra: "bg-emerald-100 dark:bg-emerald-950",
    texto: "text-emerald-700 dark:text-emerald-300",
    corpo: "bg-emerald-50/40 dark:bg-emerald-950/20",
  },
  {
    barra: "bg-sky-100 dark:bg-sky-950",
    texto: "text-sky-700 dark:text-sky-300",
    corpo: "bg-sky-50/40 dark:bg-sky-950/20",
  },
  {
    barra: "bg-violet-100 dark:bg-violet-950",
    texto: "text-violet-700 dark:text-violet-300",
    corpo: "bg-violet-50/40 dark:bg-violet-950/20",
  },
  {
    barra: "bg-amber-100 dark:bg-amber-950",
    texto: "text-amber-700 dark:text-amber-300",
    corpo: "bg-amber-50/40 dark:bg-amber-950/20",
  },
  {
    barra: "bg-teal-100 dark:bg-teal-950",
    texto: "text-teal-700 dark:text-teal-300",
    corpo: "bg-teal-50/40 dark:bg-teal-950/20",
  },
  {
    barra: "bg-blue-100 dark:bg-blue-950",
    texto: "text-blue-700 dark:text-blue-300",
    corpo: "bg-blue-50/40 dark:bg-blue-950/20",
  },
  {
    barra: "bg-slate-100 dark:bg-slate-900",
    texto: "text-slate-700 dark:text-slate-300",
    corpo: "bg-slate-50/40 dark:bg-slate-900/20",
  },
];
export const NoDaFase = memo(function NoDaFase({ data }: NodeProps & { data: DadosDaFase }) {
  const { fase } = data;
  const cor = CORES[fase.cor % CORES.length];
  const etapas = fase.etapas.length;

  return (
    <div
      className={cn(
        "pointer-events-none flex h-full w-full flex-col overflow-hidden rounded-lg",
        fase.semInformacao ? "bg-muted/20" : cor.corpo,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 flex-col justify-center rounded-t-lg px-4",
          fase.semInformacao ? "bg-muted" : cor.barra,
        )}
        style={{ height: ALTURA_DA_FASE }}
      >
        <p
          className={cn(
            "truncate text-[13px] font-semibold uppercase leading-tight tracking-wide",
            fase.semInformacao ? "text-muted-foreground" : cor.texto,
          )}
          title={fase.rotulo}
        >
          {fase.rotulo}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {etapas} {etapas === 1 ? "etapa" : "etapas"}
        </p>
      </div>
    </div>
  );
});
