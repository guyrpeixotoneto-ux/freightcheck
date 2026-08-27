import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoDoCanvas } from "@/lib/fluxos";

/**
 * O CARTÃO DA ETAPA — e o que ele deliberadamente não mostra.
 *
 * Nome, tipo e quem responde. Só isso. O que a etapa guarda de sistemas,
 * documentos, regras, falhas, gargalos, indicadores e ações — que pode ser
 * muita coisa — aparece no painel lateral, sob demanda.
 *
 * A razão é a leitura: um fluxograma existe para responder "como isto funciona"
 * de relance, e um cartão com oito etiquetas obriga a ler cada um antes de
 * enxergar o desenho. O que sobra aqui do resto é **um número** discreto no
 * rodapé, que diz "há mais aqui dentro" sem dizer o quê — o convite ao clique.
 *
 * O que decide o conteúdo é `resumoDoCartao`, em `lib/fluxos.ts`, e não este
 * componente: a regra é testável lá, e aqui fica só a pintura.
 *
 * ---------------------------------------------------------------------------
 * As três formas
 * ---------------------------------------------------------------------------
 *
 * Retângulo para o que executa, pílula para começo e fim, losango para decisão.
 * Três formas, e não oito — uma por tipo seria oito coisas para decorar, e o
 * ganho de leitura é zero: o que precisa saltar aos olhos num fluxograma é onde
 * o caminho se divide. A cor faz o resto da distinção, e vem do catálogo
 * servido pela API (`classe`), não de um `switch` escrito aqui.
 */
export const NoDaEtapa = memo(function NoDaEtapa({
  data,
  selected,
}: NodeProps & { data: NoDoCanvas["data"] }) {
  const { resumo, tipo } = data;
  const forma = tipo?.forma ?? "retangulo";

  return (
    <div
      className={cn(
        "relative w-[200px] border bg-card px-3 py-2 text-left shadow-sm transition-shadow",
        "hover:shadow-md",
        forma === "pilula" && "rounded-full px-5",
        forma === "losango" && "rounded-lg",
        forma === "retangulo" && "rounded-md",
        tipo?.classe,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
      data-testid={`etapa-${resumo.nome}`}
    >
      {/*
        As alças ficam nas quatro laterais e são invisíveis até o cursor entrar
        no cartão. É o que permite ligar uma etapa a outra arrastando — inclusive
        a volta do retrabalho, que sobe — sem que quatro bolinhas fiquem
        poluindo um desenho que na maior parte do tempo só está sendo lido.
      */}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-muted-foreground/40" />
      <Handle
        type="target"
        position={Position.Left}
        id="esquerda"
        className="!h-2 !w-2 !bg-muted-foreground/40"
      />

      <div className="flex items-start gap-1.5">
        <p className="flex-1 text-sm font-medium leading-snug text-foreground">{resumo.nome}</p>
        {resumo.atencao && (
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
            aria-label="Etapa marcada como atenção"
          />
        )}
      </div>

      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {tipo?.rotulo ?? resumo.tipo}
      </p>

      {resumo.quemResponde && (
        <p className="mt-1 truncate text-xs text-muted-foreground" title={resumo.quemResponde}>
          {resumo.quemResponde}
        </p>
      )}

      {resumo.detalhes > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          {resumo.detalhes} {resumo.detalhes === 1 ? "detalhe" : "detalhes"}
        </p>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !bg-muted-foreground/40"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="direita"
        className="!h-2 !w-2 !bg-muted-foreground/40"
      />
    </div>
  );
});
