import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LegendaDoFluxo } from "@/components/fluxos/legenda-do-fluxo";
import { NoDaEtapa } from "@/components/fluxos/no-da-etapa";
import { NoDaFase } from "@/components/fluxos/no-da-fase";
import { NoDaRaia } from "@/components/fluxos/no-da-raia";
import { NoDoGrupo } from "@/components/fluxos/no-do-grupo";
import { montarProjecao, type OpcoesDaProjecao } from "@/lib/fluxos-canvas";
import { ajustarSolto, lerArrasto } from "@/lib/fluxos-paleta";
import { type Catalogo, type FluxoCompleto } from "@/lib/fluxos";

/**
 * O CANVAS — o fluxograma de verdade, e por que ele usa uma biblioteca.
 *
 * O que a tela precisa: pan, zoom, ajustar à janela, arrastar cartão, ligar
 * cartões arrastando de uma alça, setas que se recalculam sozinhas, rótulo na
 * seta e um mapa de navegação. Nada disso é a parte interessante deste módulo, e
 * escrever tudo à mão em SVG custaria muito mais linhas do que o módulo inteiro
 * tem — com mais defeitos.
 *
 * **A checagem foi feita antes de somar a dependência**: este repositório não
 * tinha nenhuma biblioteca de canvas ou grafo. `recharts` (gráficos),
 * `embla-carousel` (carrossel), `framer-motion` (animação) e `react-resizable-
 * panels` (divisórias) resolvem coisas vizinhas e nenhuma delas desenha grafo.
 * `@xyflow/react` é a escolha consolidada para isso, é React puro, não traz
 * dependência transitiva pesada e é a mesma família que o pedido citou.
 *
 * ---------------------------------------------------------------------------
 * Um canvas, quatro visualizações
 * ---------------------------------------------------------------------------
 *
 * Fluxo, Raias, Mapa e Gargalos são este mesmo componente com uma `projecao`
 * diferente — posições calculadas, variante do cartão, faixas de raia,
 * severidade. O que **desenhar** sai de `montarProjecao` (função pura, testada);
 * o que este componente faz é o que só um componente faz: guardar as posições
 * enquanto o dedo está no botão do mouse, e avisar quem cuida do servidor
 * quando ele solta.
 *
 * ---------------------------------------------------------------------------
 * O salvamento do arrastar
 * ---------------------------------------------------------------------------
 *
 * Não salva a cada quadro — salva quando o arrasto termina, com **todas** as
 * posições, numa chamada. Um `PUT` por quadro seria dezenas de requisições para
 * mover um cartão, e um `PUT` por cartão deixaria o desenho pela metade se a
 * terceira falhasse. Ver `reposicionarEtapas` no motor: ou entra tudo, ou nada.
 *
 * E só grava quando as posições desenhadas **são** as gravadas — isto é, no
 * Fluxo vertical. Nas projeções calculadas (horizontal, raias, mapa) o arrasto
 * fica desligado: gravar ali sobrescreveria com uma coordenada derivada o
 * arranjo que alguém montou à mão no fluxo, e voltar para o Fluxo mostraria um
 * desenho que ninguém pediu.
 */

const TIPOS_DE_NO = { etapa: NoDaEtapa, raia: NoDaRaia, fase: NoDaFase, grupo: NoDoGrupo };

export interface CanvasDoFluxoProps {
  completo: FluxoCompleto;
  catalogo: Catalogo | undefined;
  /** A etapa aberta no painel de detalhe, para o cartão aparecer selecionado. */
  etapaSelecionada: string | null;
  onSelecionarEtapa: (etapaId: string | null) => void;
  /** Modo leitura: sem arrastar, sem ligar. Clique continua abrindo o detalhe. */
  somenteLeitura: boolean;
  onMoverEtapas: (posicoes: { etapaId: string; posX: number; posY: number }[]) => void;
  onConectar: (origemEtapaId: string, destinoEtapaId: string) => void;
  onAbrirConexao: (conexaoId: string) => void;
  /**
   * Um elemento veio da paleta e foi solto no desenho. A posição é a do ponto
   * solto, em coordenadas do fluxo — e é `null` quando o desenho desta
   * visualização é calculado, caso em que quem grava decide onde a etapa cai.
   */
  onSoltarElemento?: (tipo: string, posicao: { posX: number; posY: number } | null) => void;
  /** A projeção desta visualização. Vazia, é o Fluxo vertical de sempre. */
  projecao?: OpcoesDaProjecao;
  /**
   * As posições desenhadas são as gravadas? Só então arrastar grava.
   * Padrão: `true` — o Fluxo vertical.
   */
  posicoesPersistidas?: boolean;
  /**
   * Muda quando a visualização muda, para o enquadramento ser refeito. O fluxo
   * aberto entra nela: trocar de fluxo também reenquadra.
   */
  chaveDoEnquadramento?: string;
  mostrarMinimapa?: boolean;
  /** A legenda das formas e dos traços, no canto de baixo. */
  mostrarLegenda?: boolean;
}

function CanvasInterno({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  somenteLeitura,
  onMoverEtapas,
  onConectar,
  onAbrirConexao,
  onSoltarElemento,
  projecao,
  posicoesPersistidas = true,
  chaveDoEnquadramento,
  mostrarMinimapa,
  mostrarLegenda,
}: CanvasDoFluxoProps) {
  const { nos, faixas, setas } = useMemo(
    () => montarProjecao(completo, catalogo, projecao ?? {}),
    [completo, catalogo, projecao],
  );
  const { fitView, screenToFlowPosition } = useReactFlow();

  const podeArrastar = !somenteLeitura && posicoesPersistidas;

  /*
    As posições vivem em estado local **enquanto** se arrasta, e voltam a ser as
    do servidor quando o fluxo é recarregado. Sem o estado local o cartão não
    acompanharia o cursor; sem a ressincronização, uma edição feita noutra aba
    nunca apareceria.
  */
  const [nosLocais, setNosLocais] = useState<Node[]>(nos as unknown as Node[]);
  useEffect(() => {
    setNosLocais(nos as unknown as Node[]);
  }, [nos]);

  const aoMudarNos = useCallback((mudancas: NodeChange[]) => {
    setNosLocais((atuais) => applyNodeChanges(mudancas, atuais));
  }, []);

  /*
    O ajuste automático acontece uma vez por visualização aberta, e não a cada
    renderização: refazer o enquadramento depois de cada gravação jogaria de
    volta para a visão geral quem acabou de dar zoom numa etapa. Trocar de
    visualização, ao contrário, **precisa** reenquadrar — o desenho novo pode
    estar inteiro fora da janela em que o anterior cabia.
  */
  const chave = chaveDoEnquadramento ?? completo.fluxo.id;
  const jaAjustou = useRef<string | null>(null);
  useEffect(() => {
    if (jaAjustou.current === chave) return;
    if (nosLocais.length === 0) return;
    jaAjustou.current = chave;
    const t = setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [chave, nosLocais.length, fitView]);

  const aoTerminarArrasto = useCallback(() => {
    if (!podeArrastar) return;
    const posicoes = nosLocais.map((no) => ({
      etapaId: no.id,
      posX: Math.round(no.position.x),
      posY: Math.round(no.position.y),
    }));
    /*
      Só chama quando alguma coisa de fato mudou. Um clique que não arrasta
      dispara `onNodeDragStop` do mesmo jeito, e sem esta comparação cada
      seleção de cartão gravaria as posições inteiras de novo.
    */
    const mudou = posicoes.some((p) => {
      const original = completo.etapas.find((e) => e.id === p.etapaId);
      return original && (original.posX !== p.posX || original.posY !== p.posY);
    });
    if (mudou) onMoverEtapas(posicoes);
  }, [nosLocais, completo.etapas, onMoverEtapas, podeArrastar]);

  const aoConectar = useCallback(
    (ligacao: Connection) => {
      if (somenteLeitura) return;
      if (!ligacao.source || !ligacao.target) return;
      onConectar(ligacao.source, ligacao.target);
    },
    [onConectar, somenteLeitura],
  );

  /*
    O SOLTE DA PALETA — o gesto do quadro branco, e a conversão que ele exige.
    O navegador entrega a posição em pixels da janela; o fluxo pensa em
    coordenadas próprias, que mudam com o pan e o zoom. `screenToFlowPosition` é
    quem faz a ponte, e ela só existe dentro do provider — este é o único lugar
    da tela em que essa conta pode ser feita.

    Onde as posições desenhadas não são as gravadas, o ponto é descartado (e não
    o solte): a etapa nasce mesmo assim, no fim do fluxo, porque gravar a
    coordenada de um desenho derivado sobrescreveria o arranjo real — a mesma
    razão pela qual o arrasto de cartão fica desligado nessas visualizações.
  */
  const aoArrastarSobre = useCallback(
    (evento: DragEvent<HTMLDivElement>) => {
      if (somenteLeitura || !onSoltarElemento) return;
      evento.preventDefault();
      evento.dataTransfer.dropEffect = "copy";
    },
    [somenteLeitura, onSoltarElemento],
  );

  const aoSoltar = useCallback(
    (evento: DragEvent<HTMLDivElement>) => {
      if (somenteLeitura || !onSoltarElemento) return;
      const tipo = lerArrasto(evento.dataTransfer);
      if (!tipo) return;
      evento.preventDefault();
      if (!posicoesPersistidas) {
        onSoltarElemento(tipo, null);
        return;
      }
      const ponto = screenToFlowPosition({ x: evento.clientX, y: evento.clientY });
      onSoltarElemento(tipo, ajustarSolto(ponto));
    },
    [somenteLeitura, onSoltarElemento, posicoesPersistidas, screenToFlowPosition],
  );

  /*
    As faixas entram na frente da lista para ficarem atrás no desenho, e ficam
    **fora** do estado local: elas não se movem, não se selecionam e não podem
    entrar no lote que o arrasto grava — uma faixa é a leitura de um campo da
    etapa, não uma etapa.
  */
  const comSelecao = useMemo(
    () => [
      ...(faixas as unknown as Node[]),
      ...nosLocais.map((no) => ({ ...no, selected: no.id === etapaSelecionada })),
    ],
    [faixas, nosLocais, etapaSelecionada],
  );

  return (
    <ReactFlow
      nodes={comSelecao}
      edges={setas as unknown as Edge[]}
      nodeTypes={TIPOS_DE_NO}
      onNodesChange={aoMudarNos}
      onNodeDragStop={aoTerminarArrasto}
      onConnect={aoConectar}
      onNodeClick={(_evento, no) => {
        if (no.type === "raia" || no.type === "fase" || no.type === "grupo") return;
        onSelecionarEtapa(no.id);
      }}
      onEdgeClick={(_evento, seta) => {
        if (!somenteLeitura) onAbrirConexao(seta.id);
      }}
      onPaneClick={() => onSelecionarEtapa(null)}
      onDragOver={aoArrastarSobre}
      onDrop={aoSoltar}
      nodesDraggable={podeArrastar}
      nodesConnectable={!somenteLeitura}
      edgesFocusable={!somenteLeitura}
      elementsSelectable
      /*
        `fitView` inicial fica com o efeito acima, e não com esta propriedade:
        a versão declarativa reenquadra em toda troca de nós, que é o
        comportamento que o efeito existe para evitar.
      */
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
      className="bg-muted/20"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-40" />
      <Controls showInteractive={false} />
      {/*
        O mapa aparece só quando o fluxo passa de doze etapas — ou quando a
        visualização pede. Num processo pequeno ele é um retângulo redundante
        ocupando canto de tela; num de dezesseis, é o que impede a navegação de
        se perder.
      */}
      {(mostrarMinimapa ?? completo.etapas.length > 12) && (
        <MiniMap
          pannable
          zoomable
          className="!bg-card"
          nodeStrokeWidth={2}
          /* Cenário não entra no mapa: uma faixa de fase pintada ali viraria um
             bloco só, e o mapa existe para mostrar onde as etapas estão. */
          nodeColor={(no) => (no.type === "etapa" ? "#cbd5e1" : "transparent")}
          nodeStrokeColor={(no) => (no.type === "etapa" ? "#94a3b8" : "transparent")}
        />
      )}
      {/*
        A legenda é um `Panel`, e não um nó do canvas: ela explica o desenho, e
        por isso não pode andar com ele — um pan que leva a legenda para fora da
        tela deixa o desenho sem explicação exatamente quando alguém está
        procurando o que a cor quer dizer.
      */}
      {mostrarLegenda && (
        <Panel position="bottom-left" className="!m-3">
          <LegendaDoFluxo catalogo={catalogo} />
        </Panel>
      )}
    </ReactFlow>
  );
}

export function CanvasDoFluxo(props: CanvasDoFluxoProps) {
  /*
    O provider precisa envolver quem usa `useReactFlow`, e por isso o
    componente é dividido em dois. Pô-lo na página faria toda tela que mostre um
    fluxo lembrar de montá-lo — e esquecer disso produz um erro de runtime que
    só aparece ao abrir a tela.
  */
  return (
    <ReactFlowProvider>
      <CanvasInterno {...props} />
    </ReactFlowProvider>
  );
}
