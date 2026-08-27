import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { NoDaEtapa } from "@/components/fluxos/no-da-etapa";
import { montarCanvas, type Catalogo, type FluxoCompleto } from "@/lib/fluxos";

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
 * Duas responsabilidades, e a fronteira entre elas
 * ---------------------------------------------------------------------------
 *
 * O que **desenhar** sai de `montarCanvas` (`lib/fluxos.ts`), função pura e
 * testada. O que este componente faz é o que só um componente faz: guardar as
 * posições enquanto o dedo está no botão do mouse, e avisar quem cuida do
 * servidor quando ele solta. Manter a montagem aqui dentro tornaria a regra
 * "toda etapa vira cartão, toda conexão vira seta" intestável.
 *
 * ---------------------------------------------------------------------------
 * O salvamento do arrastar
 * ---------------------------------------------------------------------------
 *
 * Não salva a cada quadro — salva quando o arrasto termina, com **todas** as
 * posições, numa chamada. Um `PUT` por quadro seria dezenas de requisições para
 * mover um cartão, e um `PUT` por cartão deixaria o desenho pela metade se a
 * terceira falhasse. Ver `reposicionarEtapas` no motor: ou entra tudo, ou nada.
 */

const TIPOS_DE_NO = { etapa: NoDaEtapa };

export interface CanvasDoFluxoProps {
  completo: FluxoCompleto;
  catalogo: Catalogo | undefined;
  /** A etapa aberta no painel lateral, para o cartão aparecer selecionado. */
  etapaSelecionada: string | null;
  onSelecionarEtapa: (etapaId: string | null) => void;
  /** Modo leitura: sem arrastar, sem ligar. Clique continua abrindo o painel. */
  somenteLeitura: boolean;
  onMoverEtapas: (posicoes: { etapaId: string; posX: number; posY: number }[]) => void;
  onConectar: (origemEtapaId: string, destinoEtapaId: string) => void;
  onAbrirConexao: (conexaoId: string) => void;
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
}: CanvasDoFluxoProps) {
  const { nos, setas } = useMemo(() => montarCanvas(completo, catalogo), [completo, catalogo]);
  const { fitView } = useReactFlow();

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
    O ajuste automático acontece uma vez por fluxo aberto, e não a cada
    renderização: refazer o enquadramento depois de cada gravação jogaria de
    volta para a visão geral quem acabou de dar zoom numa etapa.
  */
  const jaAjustou = useRef<string | null>(null);
  useEffect(() => {
    if (jaAjustou.current === completo.fluxo.id) return;
    if (nosLocais.length === 0) return;
    jaAjustou.current = completo.fluxo.id;
    const t = setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [completo.fluxo.id, nosLocais.length, fitView]);

  const aoTerminarArrasto = useCallback(() => {
    if (somenteLeitura) return;
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
  }, [nosLocais, completo.etapas, onMoverEtapas, somenteLeitura]);

  const aoConectar = useCallback(
    (ligacao: Connection) => {
      if (somenteLeitura) return;
      if (!ligacao.source || !ligacao.target) return;
      onConectar(ligacao.source, ligacao.target);
    },
    [onConectar, somenteLeitura],
  );

  const comSelecao = useMemo(
    () => nosLocais.map((no) => ({ ...no, selected: no.id === etapaSelecionada })),
    [nosLocais, etapaSelecionada],
  );

  return (
    <ReactFlow
      nodes={comSelecao}
      edges={setas as unknown as Edge[]}
      nodeTypes={TIPOS_DE_NO}
      onNodesChange={aoMudarNos}
      onNodeDragStop={aoTerminarArrasto}
      onConnect={aoConectar}
      onNodeClick={(_evento, no) => onSelecionarEtapa(no.id)}
      onEdgeClick={(_evento, seta) => {
        if (!somenteLeitura) onAbrirConexao(seta.id);
      }}
      onPaneClick={() => onSelecionarEtapa(null)}
      nodesDraggable={!somenteLeitura}
      nodesConnectable={!somenteLeitura}
      edgesFocusable={!somenteLeitura}
      elementsSelectable
      /*
        `fitView` inicial fica com o efeito acima, e não com esta propriedade:
        a versão declarativa reenquadra em toda troca de nós, que é o
        comportamento que o efeito existe para evitar.
      */
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
      className="bg-muted/20"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-40" />
      <Controls showInteractive={false} />
      {/*
        O mapa aparece só quando o fluxo passa de doze etapas. Num processo
        pequeno ele é um retângulo redundante ocupando canto de tela; num de
        dezesseis, é o que impede a navegação de se perder — que é o "fluxograma
        horizontal infinito sem navegação adequada" que o módulo recusa ser.
      */}
      {completo.etapas.length > 12 && (
        <MiniMap pannable zoomable className="!bg-card" nodeStrokeWidth={2} />
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
