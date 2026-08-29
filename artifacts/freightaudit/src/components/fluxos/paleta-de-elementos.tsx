import { useMemo, useState } from "react";
import { ChevronDown, Search, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { iconeDoCatalogo } from "@/lib/fluxos-icones";
import {
  escreverArrasto,
  montarPaleta,
  totalDaPaleta,
} from "@/lib/fluxos-paleta";
import type { Catalogo, TipoDeEtapaNoCatalogo } from "@/lib/fluxos";

/**
 * A JANELA DE ELEMENTOS — escolher a peça antes de desenhá-la.
 *
 * É a coluna que faltava para o canvas se comportar como um quadro branco: os
 * elementos ficam à vista, agrupados e buscáveis, e vão para o desenho por
 * arrasto — solta-se no ponto, nasce a etapa ali. Antes, a única porta para uma
 * etapa nova era um formulário de dez campos aberto por um botão no cabeçalho:
 * quem estava desenhando o processo tinha que parar de desenhar para cadastrar.
 *
 * ---------------------------------------------------------------------------
 * Arrastar **e** clicar — as duas, porque nem todo mundo arrasta
 * ---------------------------------------------------------------------------
 *
 * O arrasto é o gesto do quadro branco e é o caminho principal. O clique existe
 * ao lado dele por dois motivos que não são detalhe: teclado e leitor de tela
 * não arrastam, e nas visualizações cujo desenho é **calculado** (o horizontal,
 * as raias, o mapa) não existe ponto do canvas para obedecer — soltar ali
 * gravaria uma coordenada derivada por cima do arranjo real. Por isso cada
 * elemento é um `<button>` de verdade, com foco, `Enter` e rótulo acessível, e
 * não um `<div draggable>`.
 *
 * ---------------------------------------------------------------------------
 * Por que os elementos são etapas, e não formas
 * ---------------------------------------------------------------------------
 *
 * A janela que inspirou esta mostra formas geométricas — retângulo, losango,
 * cilindro. Aqui elas seriam decoração: o que este produto grava é uma etapa de
 * um **tipo**, com cor, ícone e significado que o servidor conhece e cobra. A
 * paleta então mostra os tipos do catálogo, cada um desenhado com a forma e a
 * cor que ele terá no cartão — o que se vê na janela é literalmente o que cai
 * no desenho. O agrupamento e a busca moram em `lib/fluxos-paleta.ts`, testados;
 * aqui fica só a pintura.
 */

export interface PaletaDeElementosProps {
  catalogo: Catalogo | undefined;
  /**
   * Criar a etapa deste tipo sem ponto no canvas — o clique, e o arrasto solto
   * numa visualização cujas posições são calculadas.
   */
  aoEscolher: (tipo: string) => void;
  aoFechar: () => void;
  /**
   * O desenho obedece a um ponto solto? Quando não, a janela diz isso em uma
   * linha em vez de deixar o arrasto falhar em silêncio.
   */
  aceitaArrasto: boolean;
}

export function PaletaDeElementos({
  catalogo,
  aoEscolher,
  aoFechar,
  aceitaArrasto,
}: PaletaDeElementosProps) {
  const [busca, setBusca] = useState("");
  const grupos = useMemo(
    () => montarPaleta(catalogo, busca),
    [catalogo, busca],
  );
  const total = totalDaPaleta(grupos);

  return (
    <aside
      className="flex w-[248px] shrink-0 flex-col border-r bg-card"
      aria-label="Elementos do fluxo"
    >
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <p className="flex-1 text-sm font-medium text-foreground">Elementos</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={aoFechar}
          aria-label="Fechar a janela de elementos"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Buscar elemento"
            aria-label="Buscar elemento"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {total === 0 && (
          <p className="px-1 py-6 text-sm text-muted-foreground">
            Nenhum elemento com “{busca.trim()}”.
          </p>
        )}

        {grupos.map((grupo) => (
          <Grupo
            key={grupo.valor}
            rotulo={grupo.rotulo}
            descricao={grupo.descricao}
            itens={grupo.itens}
            aoEscolher={aoEscolher}
          />
        ))}
      </div>

      <p className="border-t px-3 py-2 text-2xs leading-snug text-muted-foreground">
        {aceitaArrasto
          ? "Arraste um elemento para o desenho — ou clique para criá-lo no fim do fluxo."
          : "Nesta visualização o desenho é calculado: clique num elemento e ele nasce no fim do fluxo."}
      </p>
    </aside>
  );
}

/**
 * Um grupo — aberto por padrão, e recolhível.
 *
 * Todos abertos é o certo para uma lista deste tamanho: com três seções e oito
 * elementos, esconder é obrigar a abrir. O recolher existe para quem trabalha
 * o dia inteiro numa parte do processo e não quer rolar por cima do resto.
 */
function Grupo({
  rotulo,
  descricao,
  itens,
  aoEscolher,
}: {
  rotulo: string;
  descricao: string;
  itens: TipoDeEtapaNoCatalogo[];
  aoEscolher: (tipo: string) => void;
}) {
  const [aberto, setAberto] = useState(true);

  return (
    <Collapsible open={aberto} onOpenChange={setAberto} className="py-1.5">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-muted/60">
        <span className="flex-1 text-sm font-medium text-foreground">
          {rotulo}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            !aberto && "-rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="px-1 pb-2 pt-0.5 text-2xs text-muted-foreground">
          {descricao}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {itens.map((tipo) => (
            <BotaoDoElemento
              key={tipo.valor}
              tipo={tipo}
              aoEscolher={aoEscolher}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * O elemento na janela — desenhado com a forma e a cor que terá no canvas.
 *
 * A miniatura reusa `classe` e `forma` do catálogo, e não um estilo escrito
 * aqui: é o que garante que a peça escolhida seja a peça que aparece. Um
 * quadradinho cinza genérico obrigaria a soltar para descobrir o que vinha.
 */
function BotaoDoElemento({
  tipo,
  aoEscolher,
}: {
  tipo: TipoDeEtapaNoCatalogo;
  aoEscolher: (tipo: string) => void;
}) {
  const Icone = iconeDoCatalogo(tipo.icone) ?? Square;

  return (
    <button
      type="button"
      draggable
      onDragStart={(evento) => escreverArrasto(evento.dataTransfer, tipo.valor)}
      onClick={() => aoEscolher(tipo.valor)}
      title={tipo.descricao}
      aria-label={`${tipo.rotulo} — ${tipo.descricao}`}
      data-testid={`elemento-${tipo.valor}`}
      className="flex cursor-grab flex-col items-center gap-1 rounded-md p-1.5 text-center hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      {/*
        O losango é a forma girada, e o ícone **não** gira junto: um ícone a 45°
        vira ruído, e o que precisa ser reconhecido de relance é o contorno.
      */}
      {tipo.forma === "losango" ? (
        <span className="relative flex h-10 w-full items-center justify-center">
          <span
            className={cn(
              "absolute h-7 w-7 rotate-45 rounded-sm border-2",
              tipo.classe,
            )}
          />
          <Icone className="relative h-4 w-4 text-foreground/70" />
        </span>
      ) : (
        <span
          className={cn(
            "flex h-10 w-full items-center justify-center border-2",
            tipo.forma === "pilula" ? "rounded-full" : "rounded-md",
            tipo.classe,
          )}
        >
          <Icone className="h-4 w-4 text-foreground/70" />
        </span>
      )}
      <span className="w-full truncate text-2xs leading-tight text-muted-foreground">
        {tipo.rotulo}
      </span>
    </button>
  );
}
