import { useCallback, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, LayoutGrid, ListPlus, Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DetalheDaEtapa } from "@/components/fluxos/detalhe-da-etapa";
import { EditorDaEtapa } from "@/components/fluxos/editor-da-etapa";
import { BotaoDeExportar } from "@/components/fluxos/botao-de-exportar";
import { EditorDoFluxo } from "@/components/fluxos/editor-do-fluxo";
import { MontadorPorTexto } from "@/components/fluxos/montador-por-texto";
import { useEmpresaDosFluxos } from "@/components/fluxos/seletor-de-empresa";
import { SeletorDeVisualizacao } from "@/components/fluxos/seletor-de-visualizacao";
import { VisaoFluxo } from "@/components/fluxos/visao-fluxo";
import { VisaoGargalos } from "@/components/fluxos/visao-gargalos";
import { VisaoJornada } from "@/components/fluxos/visao-jornada";
import { VisaoLista } from "@/components/fluxos/visao-lista";
import { VisaoMapa } from "@/components/fluxos/visao-mapa";
import { VisaoRaias } from "@/components/fluxos/visao-raias";
import { useVisualizacaoDeFluxo } from "@/hooks/use-visualizacao-de-fluxo";
import { analisarFluxo } from "@/lib/fluxos-analise";
import {
  AGRUPAMENTOS_DE_RAIA,
  VISUALIZACOES,
  type AgrupamentoDeRaia,
  type Orientacao,
  type Visualizacao,
} from "@/lib/fluxos-visoes";
import type { PropsDaVisaoNoCanvas } from "@/components/fluxos/visao";
import type { CampoEditavelNaLista } from "@/lib/fluxos-analise";
import {
  corpoDaEtapa,
  escritas,
  fraseDoErro,
  resumoDoFluxo,
  useCatalogoDeFluxos,
  useFluxo,
  useEmpresas,
  useRecarregarFluxos,
  type Conexao,
  type Etapa,
} from "@/lib/fluxos";

/**
 * A TELA DO FLUXO — o fluxograma como elemento principal.
 *
 * O desenho ocupa a tela. O cabeçalho é uma faixa fina com o nome, o status e o
 * que ele é ("16 etapas · 20 conexões · com retorno"); o detalhe de uma etapa
 * aparece numa coluna à direita quando alguém clica num cartão, sem tapar o
 * fluxo. É a regra de UX do pedido, aplicada: o fluxo é o principal, o resto
 * aparece sob demanda.
 *
 * ---------------------------------------------------------------------------
 * Seis visualizações, um processo
 * ---------------------------------------------------------------------------
 *
 * Esta página é o **workspace** do processo: ela carrega o fluxo uma vez, cuida
 * das escritas e escolhe qual projeção desenhar. Fluxo, Raias, Jornada, Mapa,
 * Lista e Gargalos são componentes irmãos que recebem o mesmo `FluxoCompleto` —
 * não há uma segunda consulta, um segundo cache nem um segundo formato.
 *
 * A consequência é o critério de aceite inteiro: trocar de visualização não
 * recarrega, não navega, não duplica e não perde a etapa selecionada; e uma
 * alteração feita em qualquer lugar aparece nas outras porque "as outras" não
 * existem — existe um objeto no cache e seis funções que o desenham.
 *
 * O que era o seletor "Modo Processo" virou o seletor de visualização. O Modo
 * Monitoramento não sumiu do plano: ele é uma **camada** sobre estas seis
 * (como os Gargalos já são), e não uma sétima aba — quando houver coletor, o
 * farol entra em `montarProjecao` do mesmo jeito que a severidade entrou.
 *
 * ---------------------------------------------------------------------------
 * Editar é o estado normal, não uma tela à parte
 * ---------------------------------------------------------------------------
 *
 * Não há "tela de edição" separada do visualizador: é o mesmo canvas, com o
 * arrastar e o ligar ligados. Duas telas fariam quem cadastra alternar entre
 * elas para ver o que fez. O que existe é um interruptor de leitura, para quem
 * só quer consultar sem risco de mover um cartão sem querer.
 *
 * O que muda por visualização é **quanto** se edita direto no desenho. Arrastar
 * cartão só grava onde as coordenadas desenhadas são as gravadas — o Fluxo
 * vertical. Nas projeções calculadas (horizontal, raias, mapa) o arrasto fica
 * desligado, porque o que ele gravaria seria uma coordenada derivada por cima
 * do arranjo real. Editar conteúdo, esse sim, funciona igual nas seis: é o
 * mesmo painel de detalhe, com o mesmo formulário.
 */
export default function TelaDoFluxo() {
  const [, params] = useRoute("/fluxos/:id");
  const fluxoId = params?.id ?? "";

  const { empresaId } = useEmpresaDosFluxos();
  const catalogo = useCatalogoDeFluxos();
  const consulta = useFluxo(empresaId, fluxoId);
  const recarregar = useRecarregarFluxos(empresaId);
  /*
    O nome da empresa entra no cabeçalho do arquivo exportado. A consulta já é
    a mesma que o seletor usa e vem do cache — o custo é zero, e um fluxograma
    que circula fora do produto sem dizer de quem ele é vale bem menos.
  */
  const empresas = useEmpresas();
  const nomeDaEmpresa =
    empresas.data?.find((e) => e.id === empresaId)?.nome ?? null;

  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [editandoEtapa, setEditandoEtapa] = useState<{ aberto: boolean; etapaId: string | null }>({
    aberto: false,
    etapaId: null,
  });
  const [editandoFluxo, setEditandoFluxo] = useState(false);
  const [colando, setColando] = useState(false);
  /*
    De qual etapa a próxima nasce ligada. É preenchido pelo botão "Etapa
    seguinte" do painel e consumido uma vez, quando a gravação volta — o
    diálogo de etapa continua sendo o mesmo, sem um segundo modo escondido.
  */
  const [seguinteDe, setSeguinteDe] = useState<string | null>(null);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [conexaoAberta, setConexaoAberta] = useState<Conexao | null>(null);
  const { visualizacao, orientacao, agrupamento, trocarVisualizacao, trocarOrientacao, trocarAgrupamento } =
    useVisualizacaoDeFluxo();
  /* O sinal recortado na visualização de Gargalos. Vazio: todos. */
  const [sinal, setSinal] = useState("");

  const completo = consulta.data;
  const etapaSelecionada = useMemo(
    () => completo?.etapas.find((e) => e.id === selecionada) ?? null,
    [completo, selecionada],
  );

  /*
    A análise só é calculada quando alguém está olhando os Gargalos — e é
    memoizada pelo fluxo, não pela renderização. Num processo de duzentas etapas
    ela é uma passada linear; recalculá-la a cada clique de seleção seria o tipo
    de custo que só aparece quando o processo cresce.
  */
  const analise = useMemo(
    () => (completo && visualizacao === "gargalos" ? analisarFluxo(completo) : null),
    [completo, visualizacao],
  );

  const entrada = VISUALIZACOES.find((v) => v.valor === visualizacao) ?? VISUALIZACOES[0];
  /* "Organizar" só faz sentido onde o desenho é o gravado. */
  const arranjoPersistido =
    (visualizacao === "fluxo" || visualizacao === "gargalos") && orientacao === "vertical";

  const mover = useMutation({
    mutationFn: (posicoes: { etapaId: string; posX: number; posY: number }[]) =>
      escritas.salvarPosicoes(empresaId, fluxoId, posicoes),
    onSuccess: () => recarregar(fluxoId),
  });

  const conectar = useMutation({
    mutationFn: (ligacao: { origemEtapaId: string; destinoEtapaId: string }) =>
      escritas.criarConexao(empresaId, fluxoId, ligacao),
    onSuccess: () => recarregar(fluxoId),
  });

  const organizar = useMutation({
    mutationFn: (refazerTudo: boolean) => escritas.organizar(empresaId, fluxoId, refazerTudo),
    onSuccess: () => recarregar(fluxoId),
  });

  /**
   * A EDIÇÃO EM CÉLULA DA LISTA — uma gravação de campo, aqui e não lá.
   *
   * A Lista pede; quem grava é esta página, como todas as outras escritas. A
   * etapa vem do cache e o corpo vai inteiro (`corpoDaEtapa`), porque a rota é
   * substituição: corrigir a área mandando só a área apagaria o resto.
   *
   * O prazo é o caso à parte, e é o que faz a coluna de SLA valer a pena numa
   * tela de auditoria: ele não é coluna da etapa, é a espécie `PRAZO` da lista
   * de itens, com caminho próprio. A Lista só oferece a edição quando há no
   * máximo um prazo cadastrado (ver `edicaoNaLista`), então gravar aqui é
   * substituir a lista por um item — ou esvaziá-la, quando o campo fica em
   * branco.
   */
  const editarCampo = useMutation({
    mutationFn: async ({
      etapaId,
      campo,
      valor,
    }: {
      etapaId: string;
      campo: CampoEditavelNaLista;
      valor: string;
    }) => {
      const etapa = completo?.etapas.find((e) => e.id === etapaId);
      if (!etapa) return;
      const limpo = valor.trim();

      if (campo === "sla") {
        await escritas.salvarItens(
          empresaId,
          fluxoId,
          etapaId,
          "PRAZO",
          limpo === "" ? [] : [{ nome: limpo, descricao: "", ordem: 0 }],
        );
        return;
      }

      const coluna = campo === "sistema" ? "sistemaPrincipal" : campo;
      await escritas.atualizarEtapa(empresaId, fluxoId, etapaId, {
        ...corpoDaEtapa(etapa),
        [coluna]: limpo,
      });
    },
    onSuccess: () => recarregar(fluxoId),
  });

  const excluirEtapa = useMutation({
    mutationFn: (etapaId: string) => escritas.excluirEtapa(empresaId, fluxoId, etapaId),
    onSuccess: () => {
      setSelecionada(null);
      recarregar(fluxoId);
    },
  });

  const aoMover = useCallback(
    (posicoes: { etapaId: string; posX: number; posY: number }[]) => mover.mutate(posicoes),
    [mover],
  );
  const aoConectar = useCallback(
    (origemEtapaId: string, destinoEtapaId: string) =>
      conectar.mutate({ origemEtapaId, destinoEtapaId }),
    [conectar],
  );
  /*
    A promessa é devolvida crua — inclusive a rejeição. É o que permite a célula
    manter o que foi digitado e mostrar a frase do servidor, em vez de perder o
    texto e voltar ao valor antigo sem explicação.
  */
  const aoEditarCampoDaEtapa = useCallback(
    (etapaId: string, campo: CampoEditavelNaLista, valor: string) =>
      editarCampo.mutateAsync({ etapaId, campo, valor }).then(() => undefined),
    [editarCampo],
  );
  const aoAbrirConexao = useCallback(
    (conexaoId: string) => {
      const conexao = completo?.conexoes.find((c) => c.id === conexaoId) ?? null;
      setConexaoAberta(conexao);
    },
    [completo],
  );

  if (consulta.isError) {
    return (
      <Layout>
        <main className="px-8 py-6">
          <ApiErrorNotice error={consulta.error} what="este fluxo operacional" />
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="border-b bg-card px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Voltar para a lista de fluxos">
            <Link href="/fluxos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>

          <div className="min-w-0 flex-1">
            {consulta.isLoading ? (
              <Skeleton className="h-6 w-64" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-foreground">
                    {completo?.fluxo.nome}
                  </h1>
                  <Badge variant="outline" className="font-normal">
                    {completo?.fluxo.categoria}
                  </Badge>
                  {completo?.fluxo.status !== "ATIVO" && (
                    <Badge variant="secondary" className="font-normal">
                      {completo?.fluxo.status === "RASCUNHO" ? "Rascunho" : "Arquivado"}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {completo ? resumoDoFluxo(completo) : null}
                  {completo?.fluxo.dono ? ` · ${completo.fluxo.dono}` : ""}
                  {` · ${entrada.descricao}`}
                </p>
              </>
            )}
          </div>

          {/*
            O seletor de visualização, e os controles que só existem para
            algumas delas. Eles trocam com a visualização em vez de ficarem
            todos na barra: uma barra com orientação, agrupamento e sinal
            visíveis o tempo todo obrigaria a ler seis controles para usar um.
          */}
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-muted-foreground lg:inline">Visualização</span>
            <SeletorDeVisualizacao valor={visualizacao} aoTrocar={trocarVisualizacao} />
          </div>

          {(visualizacao === "fluxo" || visualizacao === "gargalos") && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-muted-foreground lg:inline">Orientação</span>
              <Select value={orientacao} onValueChange={(v) => trocarOrientacao(v as "vertical" | "horizontal")}>
                <SelectTrigger className="h-8 w-[130px]" aria-label="Orientação do fluxo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical">Vertical</SelectItem>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {visualizacao === "raias" && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-muted-foreground lg:inline">Agrupar por</span>
              <Select value={agrupamento} onValueChange={(v) => trocarAgrupamento(v as never)}>
                <SelectTrigger className="h-8 w-[140px]" aria-label="Agrupar raias por">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGRUPAMENTOS_DE_RAIA.map((a) => (
                    <SelectItem key={a.valor} value={a.valor}>
                      {a.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={() => setSomenteLeitura((v) => !v)}>
            {somenteLeitura ? "Liberar edição" : "Só leitura"}
          </Button>

          <Button variant="outline" size="sm" onClick={() => setEditandoFluxo(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar fluxo
          </Button>

          {/*
            "Organizar" é o botão que faltava: `posicionarEtapas` já era função
            pura e testada, e nada na tela a chamava — quem montasse um fluxo à
            mão ficava com o arranjo que arrastou, e quem esquecesse de arrastar
            ficava com os cartões empilhados na origem.

            O clique normal arruma só o que nunca foi posicionado. Com a tecla
            Shift, refaz o desenho inteiro — o pedido destrutivo fica atrás de
            um gesto deliberado, e o rótulo do botão o anuncia.
          */}
          {/*
            Fora do Fluxo vertical o botão some em vez de ficar desabilitado:
            nas projeções calculadas não existe "arranjo para organizar", e um
            botão morto na barra sugere que existe.
          */}
          {arranjoPersistido && (
            <Button
              variant="ghost"
              size="sm"
              disabled={somenteLeitura || organizar.isPending || !completo?.etapas.length}
              title="Organizar o desenho. Com Shift, refaz o arranjo inteiro."
              onClick={(evento) => organizar.mutate(evento.shiftKey)}
            >
              {organizar.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
              )}
              Organizar
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={somenteLeitura}
            onClick={() => setColando(true)}
          >
            <ListPlus className="mr-1.5 h-3.5 w-3.5" />
            Colar etapas
          </Button>

          {completo && (
            <BotaoDeExportar
              completo={completo}
              catalogo={catalogo.data}
              empresa={nomeDaEmpresa}
            />
          )}

          <Button
            size="sm"
            disabled={somenteLeitura}
            onClick={() => setEditandoEtapa({ aberto: true, etapaId: null })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nova etapa
          </Button>
        </div>

        {(mover.isError || conectar.isError || excluirEtapa.isError || organizar.isError) && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              {fraseDoErro(
                mover.error ?? conectar.error ?? excluirEtapa.error ?? organizar.error,
              )}
            </AlertDescription>
          </Alert>
        )}
      </header>

      {/*
        Altura fixa em unidades de janela, e não `flex-1` dentro do Layout: o
        canvas precisa de uma altura concreta para calcular o enquadramento, e
        um contêiner que se resolve em zero deixa o fluxograma invisível — o
        defeito mais comum de quem monta um canvas dentro de layout flexível.
      */}
      <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] w-full sm:h-[calc(100dvh-8.5rem)]">
        <div className="relative min-w-0 flex-1">
          {consulta.isLoading && <Skeleton className="h-full w-full" />}
          {completo && completo.etapas.length === 0 && (
            <FluxoSemEtapas
              aoCriar={() => setEditandoEtapa({ aberto: true, etapaId: null })}
              aoColar={() => setColando(true)}
              bloqueado={somenteLeitura}
            />
          )}
          {completo && completo.etapas.length > 0 && (
            <MotorDeVisualizacao
              completo={completo}
              catalogo={catalogo.data}
              visualizacao={visualizacao}
              orientacao={orientacao}
              agrupamento={agrupamento}
              sinal={sinal}
              onTrocarSinal={setSinal}
              etapaSelecionada={selecionada}
              onSelecionarEtapa={setSelecionada}
              somenteLeitura={somenteLeitura}
              onEditarCampoDaEtapa={aoEditarCampoDaEtapa}
              onMoverEtapas={aoMover}
              onConectar={aoConectar}
              onAbrirConexao={aoAbrirConexao}
            />
          )}
          {mover.isPending && (
            <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow">
              <Loader2 className="h-3 w-3 animate-spin" />
              salvando posição
            </div>
          )}
        </div>

        {/*
          Um detalhe só, para as seis visualizações — coluna no desktop, gaveta
          no celular. Ele fica **aqui**, na página, e não dentro de cada visão:
          é assim que clicar num cartão do Fluxo, numa linha da Lista ou num
          passo da Jornada abre exatamente a mesma coisa.
        */}
        {etapaSelecionada && (
          <DetalheDaEtapa
            etapa={etapaSelecionada}
            catalogo={catalogo.data}
            podeEditar={!somenteLeitura}
            diagnostico={analise?.porEtapa.get(etapaSelecionada.id)}
            onEditar={() => setEditandoEtapa({ aberto: true, etapaId: etapaSelecionada.id })}
            onSeguinte={() => {
              setSeguinteDe(etapaSelecionada.id);
              setEditandoEtapa({ aberto: true, etapaId: null });
            }}
            onExcluir={() => excluirEtapa.mutate(etapaSelecionada.id)}
            onFechar={() => setSelecionada(null)}
          />
        )}
      </div>

      {/*
        O editor só monta com o catálogo em mãos, e não é detalhe: as listas de
        material são derivadas das espécies do catálogo dentro de um
        `useState` inicial, que roda uma vez. Montar antes de ele chegar
        produziria um formulário sem as cinco listas — e sem erro nenhum na
        tela, que é a pior forma.
      */}
      {editandoEtapa.aberto && completo && catalogo.data && (
        <EditorDaEtapa
          /*
            A chave inclui a etapa: sem ela, abrir o editor de uma etapa logo
            depois de fechar o de outra reaproveitaria o estado do formulário
            anterior — o React mantém o componente montado e os `useState`
            iniciais não voltam a rodar.
          */
          key={editandoEtapa.etapaId ?? "nova"}
          aberto
          etapa={completo.etapas.find((e) => e.id === editandoEtapa.etapaId) ?? null}
          fluxoId={fluxoId}
          empresaId={empresaId}
          catalogo={catalogo.data}
          aoFechar={() => {
            setEditandoEtapa({ aberto: false, etapaId: null });
            setSeguinteDe(null);
          }}
          aoSalvar={(gravada: Etapa) => {
            /*
              Ligar e posicionar acontecem aqui, e não dentro do editor: o
              editor grava uma etapa e não sabe de onde o pedido veio. A
              organização é chamada com o padrão (só quem está na origem), então
              ela coloca a etapa recém-nascida no lugar sem desmanchar nada do
              que já foi arrastado.
            */
            const origem = seguinteDe;
            setSeguinteDe(null);
            if (!origem || origem === gravada.id) {
              recarregar(fluxoId);
              return;
            }
            void escritas
              .criarConexao(empresaId, fluxoId, {
                origemEtapaId: origem,
                destinoEtapaId: gravada.id,
              })
              .then(() => escritas.organizar(empresaId, fluxoId, false))
              .finally(() => recarregar(fluxoId));
          }}
        />
      )}

      {editandoFluxo && completo && catalogo.data && (
        <EditorDoFluxo
          aberto
          fluxo={completo.fluxo}
          empresaId={empresaId}
          catalogo={catalogo.data}
          categoriasConhecidas={[completo.fluxo.categoria]}
          aoFechar={() => setEditandoFluxo(false)}
          aoSalvar={() => recarregar(fluxoId)}
        />
      )}

      {colando && completo && (
        <MontadorPorTexto
          empresaId={empresaId}
          fluxoId={fluxoId}
          categoriasConhecidas={[completo.fluxo.categoria]}
          origem={
            etapaSelecionada ? { id: etapaSelecionada.id, nome: etapaSelecionada.nome } : null
          }
          aoFechar={() => setColando(false)}
          aoConcluir={() => recarregar(fluxoId)}
        />
      )}

      {conexaoAberta && completo && (
        <EditorDaConexao
          conexao={conexaoAberta}
          empresaId={empresaId}
          fluxoId={fluxoId}
          catalogo={catalogo.data}
          aoFechar={() => setConexaoAberta(null)}
          aoSalvar={() => recarregar(fluxoId)}
        />
      )}
    </Layout>
  );
}

/**
 * O MOTOR DE VISUALIZAÇÃO — o único lugar onde "qual visualização" é decidido.
 *
 * Uma função de despacho, e não uma página cheia de condicionais espalhadas: a
 * escolha aparece **uma vez**, aqui, e cada projeção é um componente irmão que
 * recebe o mesmo `FluxoCompleto`. Acrescentar uma sétima visualização é uma
 * entrada em `VISUALIZACOES` e um `case` — nunca um `if` novo em cada trecho da
 * tela.
 *
 * As seis recebem `somenteLeitura` e nenhuma delas escreve: as mutações vivem
 * na página. É o que faz o modo de leitura valer nas seis sem que cada uma
 * precise lembrar de respeitá-lo.
 */
function MotorDeVisualizacao({
  visualizacao,
  orientacao,
  agrupamento,
  sinal,
  onTrocarSinal,
  ...props
}: PropsDaVisaoNoCanvas & {
  visualizacao: Visualizacao;
  orientacao: Orientacao;
  agrupamento: AgrupamentoDeRaia;
  sinal: string;
  onTrocarSinal: (sinal: string) => void;
}) {
  switch (visualizacao) {
    case "raias":
      return <VisaoRaias {...props} agrupamento={agrupamento} />;
    case "jornada":
      return <VisaoJornada {...props} />;
    case "mapa":
      return <VisaoMapa {...props} />;
    case "lista":
      return <VisaoLista {...props} />;
    case "gargalos":
      return (
        <VisaoGargalos
          {...props}
          orientacao={orientacao}
          sinal={sinal}
          onTrocarSinal={onTrocarSinal}
        />
      );
    case "fluxo":
    default:
      return <VisaoFluxo {...props} orientacao={orientacao} />;
  }
}

/**
 * O fluxo vazio — e a saída que ele passou a oferecer primeiro.
 *
 * Antes, a única porta era "criar a primeira etapa", uma de cada vez: quem
 * chegava aqui com um processo de treze passos na mão via um convite para abrir
 * treze formulários. O caminho de cima agora é colar a lista inteira; criar uma
 * etapa por vez continua ali, para quem está descobrindo o processo enquanto o
 * desenha.
 */
function FluxoSemEtapas({
  aoCriar,
  aoColar,
  bloqueado,
}: {
  aoCriar: () => void;
  aoColar: () => void;
  bloqueado: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-muted/20">
      <div className="max-w-md text-center">
        <Wand2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium text-foreground">Este fluxo ainda não tem etapas.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Cole a lista de etapas de uma vez — uma por linha, na ordem do processo — e elas nascem
          ligadas e organizadas. Ou crie uma a uma e ligue arrastando das bordas dos cartões.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={aoColar} disabled={bloqueado}>
            <ListPlus className="mr-1.5 h-4 w-4" />
            Colar as etapas
          </Button>
          <Button variant="outline" onClick={aoCriar} disabled={bloqueado}>
            <Plus className="mr-1.5 h-4 w-4" />
            Criar a primeira etapa
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A seta clicada — trocar o tipo, escrever a condição, ou remover.
 *
 * É um painel pequeno e não um diálogo cheio, porque uma conexão guarda três
 * coisas. O tipo é o que dá sentido ao desenho: a mesma seta entre as mesmas
 * etapas significa coisas diferentes conforme seja "decisão — não" ou
 * "retrabalho", e é aqui que isso é dito.
 */
function EditorDaConexao({
  conexao,
  empresaId,
  fluxoId,
  catalogo,
  aoFechar,
  aoSalvar,
}: {
  conexao: Conexao;
  empresaId: string | null;
  fluxoId: string;
  catalogo: ReturnType<typeof useCatalogoDeFluxos>["data"];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [tipo, setTipo] = useState(conexao.tipo);
  const [rotulo, setRotulo] = useState(conexao.rotulo ?? "");

  const salvar = useMutation({
    mutationFn: () =>
      escritas.atualizarConexao(empresaId, fluxoId, conexao.id, {
        origemEtapaId: conexao.origemEtapaId,
        destinoEtapaId: conexao.destinoEtapaId,
        tipo,
        rotulo,
        ordem: conexao.ordem,
      }),
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });

  const remover = useMutation({
    mutationFn: () => escritas.excluirConexao(empresaId, fluxoId, conexao.id),
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });

  return (
    <div className="fixed bottom-6 left-1/2 z-40 w-[420px] -translate-x-1/2 rounded-lg border bg-card p-4 shadow-lg">
      <p className="mb-3 text-sm font-medium text-foreground">Conexão</p>

      <div className="space-y-3">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger aria-label="Tipo da conexão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalogo?.tiposDeConexao ?? []).map((t) => (
              <SelectItem key={t.valor} value={t.valor}>
                {t.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          placeholder="Condição — “se rejeitado”"
          aria-label="Condição da conexão"
        />
      </div>

      {(salvar.isError || remover.isError) && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{fraseDoErro(salvar.error ?? remover.error)}</AlertDescription>
        </Alert>
      )}

      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => remover.mutate()}
          disabled={remover.isPending}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Remover
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
