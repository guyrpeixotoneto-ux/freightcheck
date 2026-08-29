import { memo } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarcaDeSubfluxo } from "@/components/fluxos/marca-de-subfluxo";
import { severidadeNoCatalogo } from "@/lib/fluxos-analise";
import { iconeDoCatalogo } from "@/lib/fluxos-icones";
import type { DadosDoNo } from "@/lib/fluxos-canvas";

/**
 * O CARTÃO DA ETAPA — e o que ele deliberadamente não mostra.
 *
 * Nome, tipo e quem responde. Só isso. O que a etapa guarda de sistemas,
 * documentos, regras, falhas, gargalos, indicadores e ações — que pode ser
 * muita coisa — aparece no painel de detalhe, sob demanda.
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
 *
 * ---------------------------------------------------------------------------
 * O mesmo cartão nas quatro visualizações que desenham
 * ---------------------------------------------------------------------------
 *
 * Fluxo, Raias, Mapa e Gargalos usam **este** cartão. O que muda é `variante`
 * (o Mapa usa o compacto, para caber o processo inteiro) e `severidade` (só os
 * Gargalos pintam por risco). Um cartão por visualização faria a mesma etapa
 * mostrar coisas diferentes conforme a aba — e é assim que duas telas passam a
 * discordar sobre o mesmo processo.
 */

/** Abaixo deste zoom o cartão perde o subtítulo; mais abaixo, fica só o nome. */
const ZOOM_DO_DETALHE = 0.75;
const ZOOM_DO_TIPO = 0.45;

/**
 * O LOSANGO — desenhado, e não sugerido.
 *
 * Um retângulo de canto arredondado com a cor da decisão era o que existia
 * aqui, e ele falha justamente no que a forma existe para fazer: num desenho de
 * vinte cartões, "onde o caminho se divide" tem que saltar aos olhos **antes**
 * de qualquer leitura de cor ou de texto.
 *
 * A caixa continua com a largura de sempre — as alças, e portanto as setas,
 * chegam onde chegariam de qualquer jeito — e o losango é um quadrado girado
 * dentro dela. Girar o quadrado, em vez de recortar a caixa com `clip-path`,
 * preserva a borda: um recorte corta a borda junto, e o cartão fica sem
 * contorno exatamente na forma em que o contorno mais importa.
 *
 * O texto não gira, e cabe numa faixa central estreita — que é o preço honesto
 * da forma. Por isso a decisão é o único cartão que não mostra responsável nem
 * contador de detalhes: eles continuam a um clique, no painel.
 */
const LADO_DO_LOSANGO = 104;

export const NoDaEtapa = memo(function NoDaEtapa({
  data,
  selected,
}: NodeProps & { data: DadosDoNo }) {
  const {
    resumo,
    tipo,
    variante = "completo",
    numero = null,
    severidade = null,
    subfluxo = null,
  } = data;
  const forma = tipo?.forma ?? "retangulo";
  const compacto = variante === "compacto";
  const Icone = iconeDoCatalogo(tipo?.icone);

  /*
    Detalhe progressivo: quanto mais longe a câmera, menos texto o cartão
    carrega. O seletor devolve **booleanos**, e não o zoom — assim o React só
    volta a renderizar quando o limiar é cruzado, e não a cada quadro de um
    gesto de zoom, que num processo de duzentas etapas é a diferença entre
    suave e travado.
  */
  const mostrarDetalhe = useStore((s) => s.transform[2] >= ZOOM_DO_DETALHE);
  const mostrarTipo = useStore((s) => s.transform[2] >= ZOOM_DO_TIPO);

  const risco = severidade ? severidadeNoCatalogo(severidade) : null;
  const pintura = risco ? risco.cartao : tipo?.classe;

  const alcas = (
    <>
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
    </>
  );

  if (forma === "losango") {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center",
          compacto ? "h-[104px] w-[140px]" : "h-[150px] w-[200px]",
        )}
        data-testid={`etapa-${resumo.nome}`}
      >
        {alcas}
        <div
          className={cn(
            "absolute border shadow-sm transition-shadow",
            "rounded-[10px]",
            pintura ?? "border-border bg-card",
            selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          style={{
            width: compacto ? 72 : LADO_DO_LOSANGO,
            height: compacto ? 72 : LADO_DO_LOSANGO,
            transform: "rotate(45deg)",
          }}
        />
        <div
          className="relative flex flex-col items-center justify-center gap-0.5 px-1 text-center"
          style={{ width: compacto ? 88 : 118 }}
        >
          <p
            className={cn(
              "font-medium leading-tight text-foreground",
              compacto ? "line-clamp-2 text-[10px]" : "line-clamp-3 text-[11px]",
            )}
            title={resumo.nome}
          >
            {resumo.nome}
          </p>
          {risco && (
            <span
              className={cn("h-2 w-2 rounded-full", risco.ponto)}
              aria-label={`Severidade: ${risco.rotulo}`}
            />
          )}
          {!risco && resumo.atencao && (
            <AlertTriangle
              className="h-3.5 w-3.5 text-amber-600"
              aria-label="Etapa marcada como atenção"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative border bg-card text-left shadow-sm transition-shadow hover:shadow-md",
        compacto ? "w-[140px] px-2 py-1.5" : "w-[200px] px-3 py-2",
        forma === "pilula" ? (compacto ? "rounded-full px-3" : "rounded-full px-5") : "rounded-md",
        /* Na visualização de Gargalos a severidade manda na cor; nas outras, o tipo. */
        pintura,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
      data-testid={`etapa-${resumo.nome}`}
    >
      {alcas}

      {/*
        A linha de cima é a identificação: o número de leitura à esquerda, o
        ícone do tipo à direita. O ícone vem do catálogo (`tipo.icone`), o mesmo
        que a paleta desenha — quem arrastou o elemento "Validação" reconhece no
        desenho a peça que soltou, que é o mínimo que uma paleta com ícone deve
        garantir.
      */}
      {(numero !== null || (Icone && mostrarTipo)) && (
        <div className="mb-1 flex items-center justify-between gap-1.5">
          {numero !== null ? (
            <span
              className={cn(
                "rounded bg-foreground/[0.06] px-1.5 py-px text-[10px] font-semibold",
                "leading-4 tabular-nums text-muted-foreground",
              )}
            >
              {String(numero).padStart(2, "0")}
            </span>
          ) : (
            <span />
          )}
          {Icone && mostrarTipo && (
            <Icone
              className={cn("shrink-0 text-muted-foreground", compacto ? "h-3 w-3" : "h-4 w-4")}
              aria-hidden
            />
          )}
        </div>
      )}

      <div className="flex items-start gap-1.5">
        <p
          className={cn(
            "flex-1 font-medium leading-snug text-foreground",
            compacto ? "line-clamp-2 text-xs" : "text-sm",
          )}
        >
          {resumo.nome}
        </p>
        {risco && (
          <span
            className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", risco.ponto)}
            aria-label={`Severidade: ${risco.rotulo}`}
          />
        )}
        {!risco && resumo.atencao && (
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
            aria-label="Etapa marcada como atenção"
          />
        )}
      </div>

      {mostrarTipo && (
        <p
          className={cn(
            "mt-0.5 uppercase tracking-wide text-muted-foreground",
            compacto ? "text-[9px]" : "text-[11px]",
          )}
        >
          {tipo?.rotulo ?? resumo.tipo}
        </p>
      )}

      {/*
        O responsável em selo, e não em linha de texto solta: no fluxograma de
        parede é ele que fecha o cartão, e é a informação que o olho procura
        depois do nome — "isto é meu ou de outra área?".
      */}
      {mostrarDetalhe && !compacto && resumo.quemResponde && (
        <p
          className={cn(
            "mt-1.5 truncate rounded border border-border/70 bg-background/60",
            "px-1.5 py-0.5 text-[11px] text-muted-foreground",
          )}
          title={resumo.quemResponde}
        >
          {resumo.quemResponde}
        </p>
      )}

      {mostrarDetalhe && !compacto && resumo.detalhes > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          {resumo.detalhes} {resumo.detalhes === 1 ? "detalhe" : "detalhes"}
        </p>
      )}

      {/*
        A marca do subfluxo — no canvas ela é só o caminho de ida, e por isso
        `podeDetalhar` é falso aqui.

        Criar um detalhe a partir do desenho não cabe no cartão: ele já carrega
        alça de conexão nas quatro laterais e o gesto de arrastar, e um botão
        que nasce debaixo do cursor no meio de uma ligação é um clique errado
        esperando para acontecer. Quem quer detalhar clica no cartão e usa o
        painel — o mesmo painel das seis visualizações.
      */}
      {subfluxo && (
        <div className="mt-1.5 flex">
          <MarcaDeSubfluxo subfluxo={subfluxo} nomeDaEtapa={resumo.nome} podeDetalhar={false} />
        </div>
      )}
    </div>
  );
});
