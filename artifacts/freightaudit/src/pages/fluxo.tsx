import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  LayoutGrid,
  ListPlus,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Shapes,
  Unlock,
  Trash2,
  Wand2,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  BotaoDeExportar,
  SubmenuDeExportar,
} from "@/components/fluxos/botao-de-exportar";
import {
  BotaoDeImportarModelo,
  DialogoDaImportacao,
  ItemDeImportarModelo,
  useImportadorDoModelo,
} from "@/components/fluxos/importador-do-modelo";
import { EditorDoFluxo } from "@/components/fluxos/editor-do-fluxo";
import { MontadorPorTexto } from "@/components/fluxos/montador-por-texto";
import { PaletaDeElementos } from "@/components/fluxos/paleta-de-elementos";
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
import { nomeSugerido, proximaPosicaoLivre } from "@/lib/fluxos-paleta";
import {
  AGRUPAMENTOS_DE_RAIA,
  LENTES_DA_JORNADA,
  ordemDeLeitura,
  VISUALIZACOES,
  type AgrupamentoDeRaia,
  type LenteDaJornada,
  type Orientacao,
  type Visualizacao,
} from "@/lib/fluxos-visoes";
import type { PropsDaVisaoNoCanvas } from "@/components/fluxos/visao";
import type { CampoEditavelNaLista, EtapaNovaNaLista } from "@/lib/fluxos-analise";
import {
  corpoDaEtapa,
  degrauDeVolta,
  escritas,
  lerFluxoAgora,
  fraseDoErro,
  resumoDoFluxo,
  subfluxoDaEtapa,
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
  const [, navegar] = useLocation();
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
  const {
    visualizacao,
    orientacao,
    agrupamento,
    lente,
    sugerirVisualizacao,
    trocarVisualizacao,
    trocarOrientacao,
    trocarAgrupamento,
    trocarLente,
  } = useVisualizacaoDeFluxo();
  /* O sinal recortado na visualização de Gargalos. Vazio: todos. */
  const [sinal, setSinal] = useState("");
  /*
    A janela de elementos começa aberta: ela é o convite a desenhar, e uma
    paleta escondida atrás de um botão faz o canvas continuar parecendo um
    visualizador. Quem quer a tela inteira para ler fecha uma vez — e o botão do
    cabeçalho a traz de volta.
  */
  const [paletaAberta, setPaletaAberta] = useState(true);

  const completo = consulta.data;

  /*
    A importação do modelo é um estado da **tela**, e não do botão: os dois
    gatilhos (barra larga e "Mais ações") e o diálogo, lá embaixo, leem daqui.
  */
  const importador = useImportadorDoModelo({
    completo,
    catalogo: catalogo.data,
    empresaId,
    aoConcluir: () => recarregar(fluxoId),
  });

  /**
   * O VOLTAR SEGUE A TRILHA — sai por onde se entrou.
   *
   * Um subfluxo quase nunca é aberto pela listagem: chega-se nele de dentro do
   * fluxo pai, pela marca de subfluxo no cartão, pelo painel da etapa ou logo
   * depois de "detalhar". Mandar todo mundo para `/fluxos` fazia a seta desfazer
   * o caminho errado — quem estava lendo o processo pai perdia o lugar e tinha
   * de reencontrar o fluxo na lista geral e a etapa dentro dele.
   *
   * A trilha vem da raiz para o pai imediato (`repositorio.ts`), então o degrau
   * de volta é o último. Um fluxo raiz continua voltando para a listagem, que é
   * de fato de onde ele foi aberto.
   */
  const degrau = degrauDeVolta(completo);
  const voltarPara = degrau ? `/fluxos/${degrau.fluxoId}` : "/fluxos";
  const rotuloDoVoltar = degrau
    ? `Voltar para "${degrau.fluxoNome}", o fluxo que contém esta etapa`
    : "Voltar para a lista de fluxos";

  /**
   * O FLUXO VAZIO ABRE NA LISTA — uma vez por fluxo, e nunca por cima da
   * escolha de quem está olhando.
   *
   * Criar um fluxo e cair num canvas em branco é o pior primeiro minuto que
   * este módulo tem: o gesto seguinte é sempre cadastrar as etapas, e é a Lista
   * que cadastra em série. Então um fluxo sem etapa nenhuma abre na tabela, com
   * a linha de "Adicionar nova etapa" à vista.
   *
   * A referência guarda de qual fluxo a sugestão já foi dada, e é o que faz
   * disso uma sugestão e não uma prisão: quem trocar para o Fluxo para arrastar
   * um elemento continua no Fluxo — o efeito não roda de novo enquanto o fluxo
   * aberto for o mesmo, mesmo que ele siga vazio.
   */
  const fluxoJaSugerido = useRef<string | null>(null);
  useEffect(() => {
    if (!completo || fluxoJaSugerido.current === fluxoId) return;
    fluxoJaSugerido.current = fluxoId;
    if (completo.etapas.length === 0) sugerirVisualizacao("lista");
  }, [completo, fluxoId, sugerirVisualizacao]);

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
   * A Lista pede; quem grava é esta página, como todas as outras escritas. O
   * corpo vai inteiro (`corpoDaEtapa`), porque a rota é substituição: corrigir a
   * área mandando só a área apagaria descrição, objetivo, regras, observações e
   * a posição do cartão.
   *
   * E é justamente por ir inteiro que a etapa é **relida do servidor** logo
   * antes de gravar, em vez de sair do cache da tela. O cache pode estar velho:
   * alguém que ficou com a Lista aberta enquanto outra pessoa trocou o
   * responsável mandaria de volta o responsável antigo junto com a sua área
   * nova — uma alteração desfeita sem que ninguém visse. Reler encolhe essa
   * janela para o tempo de uma ida ao servidor. Ela **não fecha**: fechar de
   * verdade exige versão na linha e recusa no servidor (um `If-Match`), que é
   * mudança de contrato e não cabe aqui. O que cabe é não perder por minutos o
   * que se pode não perder por milissegundos.
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
      const limpo = valor.trim();
      const agora = await lerFluxoAgora(empresaId, fluxoId);
      const etapa = agora.etapas.find((e) => e.id === etapaId);
      /*
        A etapa sumiu entre abrir a célula e gravar: quem apagou foi outra
        pessoa, e recriá-la por um PUT seria pior do que não gravar.
      */
      if (!etapa) throw new Error("Esta etapa não existe mais — recarregue o fluxo.");

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

  /*
    O elemento arrastado vira etapa numa chamada só, sem passar por formulário.
    O nome e a posição saem de funções puras (`lib/fluxos-paleta.ts`), e a etapa
    recém-criada já abre selecionada no painel de detalhe: é lá que se dá o nome
    de verdade, com o cartão à vista, em vez de num diálogo por cima do desenho.
  */
  const criarElemento = useMutation({
    mutationFn: (elemento: { tipo: string; posicao: { posX: number; posY: number } | null }) => {
      const tipo = catalogo.data?.tiposDeEtapa.find((t) => t.valor === elemento.tipo);
      const etapas = completo?.etapas ?? [];
      const posicao = elemento.posicao ?? proximaPosicaoLivre(etapas);
      return escritas.criarEtapa(empresaId, fluxoId, {
        nome: tipo ? nomeSugerido(tipo, etapas) : "Nova etapa",
        tipo: elemento.tipo,
        ordem: etapas.length,
        ...posicao,
      });
    },
    onSuccess: (gravada: Etapa) => {
      setSelecionada(gravada.id);
      recarregar(fluxoId);
    },
  });

  /**
   * A ETAPA QUE NASCE NA TABELA — uma linha digitada, quatro coisas gravadas.
   *
   * A Lista monta o que foi digitado; quem grava é esta página, como todas as
   * outras escritas — e pela **mesma porta** do editor da etapa
   * (`escritas.criarEtapa`), para que cadastrar pela tabela e cadastrar pelo
   * formulário não sejam dois caminhos com dois comportamentos.
   *
   * Quatro coisas acontecem, nesta ordem, e cada uma tem um motivo:
   *
   * 1. **A etapa**, com as colunas que a linha oferece. Nome, tipo, área,
   *    responsável e sistema são colunas da etapa e vão no mesmo corpo.
   * 2. **O prazo**, se houver, que não é coluna: é a espécie `PRAZO` da lista
   *    de itens, com caminho próprio — o mesmo que a célula de SLA usa.
   * 3. **A ligação com a etapa anterior**, quando já existe uma. A Lista é a
   *    leitura do processo em ordem; cadastrar a quarta etapa e receber um
   *    cartão solto no desenho obrigaria a voltar ao Fluxo para ligar cada uma
   *    à mão — que é exatamente o trabalho que "Colar etapas" já não pede.
   * 4. **O arranjo**, com o padrão (só quem nunca foi posicionado), para a
   *    etapa nova aparecer no lugar sem desmanchar o que já foi arrastado.
   *
   * O prazo, a ligação e o arranjo não derrubam a criação: se algum falhar, a
   * etapa já existe e recarregar mostra isso. Falhar aqui e a tabela dizer que
   * não cadastrou seria a mentira mais cara desta tela — quem visse o erro
   * digitaria tudo de novo e ficaria com a etapa em duplicidade.
   */
  const criarEtapaNaLista = useMutation({
    mutationFn: async (nova: EtapaNovaNaLista) => {
      const etapas = completo?.etapas ?? [];
      /* A última na ordem de leitura — a mesma que a tabela numera por último. */
      const anterior = completo ? (ordemDeLeitura(completo).at(-1) ?? null) : null;
      const gravada = await escritas.criarEtapa(empresaId, fluxoId, {
        nome: nova.nome.trim(),
        tipo: nova.tipo,
        area: nova.area.trim(),
        responsavel: nova.responsavel.trim(),
        sistemaPrincipal: nova.sistema.trim(),
        ordem: etapas.length,
        ...proximaPosicaoLivre(etapas),
      });

      const prazo = nova.sla.trim();
      if (prazo !== "") {
        await escritas
          .salvarItens(empresaId, fluxoId, gravada.id, "PRAZO", [
            { nome: prazo, descricao: "", ordem: 0 },
          ])
          .catch(() => undefined);
      }

      if (anterior && anterior.id !== gravada.id) {
        await escritas
          .criarConexao(empresaId, fluxoId, {
            origemEtapaId: anterior.id,
            destinoEtapaId: gravada.id,
          })
          .then(() => escritas.organizar(empresaId, fluxoId, false))
          .catch(() => undefined);
      }
      return gravada;
    },
    onSuccess: () => recarregar(fluxoId),
  });

  /**
   * DETALHAR — o fluxo do detalhe nasce, já ligado, e a tela vai para ele.
   *
   * A navegação é parte do pedido, e não uma cortesia: quem clicou em "detalhar"
   * quer escrever os passos de dentro agora. Ficar no fluxo pai obrigaria a
   * procurar o detalhe recém-criado na listagem geral para poder começar.
   *
   * O fluxo pai é recarregado antes da ida porque a etapa mudou aqui também —
   * ela passou a ter marca de subfluxo, e voltar (pelo navegador, pela trilha)
   * tem de encontrar a tela certa.
   */
  const detalhar = useMutation({
    mutationFn: (etapaId: string) => escritas.detalharEtapa(empresaId, fluxoId, etapaId),
    onSuccess: (criado) => {
      recarregar(fluxoId);
      navegar(`/fluxos/${criado.id}`);
    },
  });

  const desligarSubfluxo = useMutation({
    mutationFn: (etapaId: string) => escritas.desligarSubfluxo(empresaId, fluxoId, etapaId),
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
  const aoCriarEtapaNaLista = useCallback(
    (nova: EtapaNovaNaLista) => criarEtapaNaLista.mutateAsync(nova).then(() => undefined),
    [criarEtapaNaLista],
  );
  const aoSoltarElemento = useCallback(
    (tipo: string, posicao: { posX: number; posY: number } | null) =>
      criarElemento.mutate({ tipo, posicao }),
    [criarElemento],
  );
  /*
    Detalhar é pedido de três lugares — o ícone do cartão da Jornada, o do nó do
    Fluxo e o botão do painel —, e os três passam por aqui: uma mutação só, um
    erro só no cabeçalho, uma navegação só para o detalhe recém-nascido.
  */
  const aoDetalharEtapa = useCallback(
    (etapaId: string) => detalhar.mutate(etapaId),
    [detalhar],
  );
  /*
    Qual etapa está sendo detalhada agora — para o cartão que foi clicado girar
    o seu próprio ícone, e não todos eles.
  */
  const detalhandoAgora = detalhar.isPending ? (detalhar.variables ?? null) : null;
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
    /*
      A página inteira mede uma janela e rola por dentro, então ela dispensa o
      espaço que a casca reserva para a barra do celular e desconta a barra da
      sua própria altura — ver a coluna logo abaixo. Com a reserva ligada, o
      desconto acontecia duas vezes: sobrava uma faixa cinza vazia acima da
      barra, e o último cartão da Jornada ficava cortado ao meio para pagá-la.
    */
    <Layout semReservaDaBarra>
      {/*
        A COLUNA DA JANELA — cabeçalho em cima, visualização ocupando o resto.

        A altura vem daqui, e não do contêiner do canvas: `100dvh` menos a faixa
        vermelha do topo e, no celular, menos a barra de baixo. O cabeçalho tem
        a altura que tiver — uma linha de ações ou duas, com descrição ou sem —
        e o que sobra é da visualização. Antes a conta era feita ao contrário,
        chutando a altura do cabeçalho em `16rem` no celular e `11,5rem` no
        computador; quando o cabeçalho não media isso, a diferença virava faixa
        vazia embaixo ou etapa cortada.
      */}
      <div
        className="flex h-[calc(100dvh-4rem-5.5rem-env(safe-area-inset-bottom))] flex-col md:h-[calc(100dvh-4rem)]"
      >
        {/*
          O CABEÇALHO — duas faixas com papéis fixos.

          Antes tudo dividia um `flex-wrap` só: identidade, opções da visualização
          e ações do fluxo. Como as opções mudam com a visualização, trocar de
          ângulo remontava o cabeçalho inteiro — o título ganhava e perdia largura
          (e reticências), e "Editar fluxo", "Colar etapas", "Exportar" e "Nova
          etapa" trocavam de lugar a cada troca. Um cabeçalho que se remonta faz
          parecer que se mudou de tela quando o fluxo é o mesmo.

          Agora cada faixa tem um dono. A de cima é a identidade do fluxo e as
          ações que existem nas seis visualizações — ela é idêntica em todas. A de
          baixo é a barra da visualização, e é a única que muda. Nada foi
          removido: o que era específico continua específico, só que confinado à
          faixa que pode mudar.
        */}
        <header className="shrink-0 border-b bg-card px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="icon" asChild aria-label={rotuloDoVoltar}>
              <Link href={voltarPara} title={rotuloDoVoltar}>
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
                  {/*
                    A descrição da visualização saiu daqui e foi para a barra de
                    baixo: ela é a única parte desta linha que dependia do ângulo
                    escolhido, e era o que fazia o resumo do fluxo quebrar em duas
                    linhas numa visualização e em uma noutra.
                  */}
                  <p className="truncate text-xs text-muted-foreground">
                    {completo ? resumoDoFluxo(completo) : null}
                    {completo?.fluxo.dono ? ` · ${completo.fluxo.dono}` : ""}
                  </p>
                </>
              )}
            </div>

            {/*
              As ações do fluxo. Todas valem nas seis visualizações, então todas
              ficam aqui, sempre na mesma ordem e sempre no mesmo lugar — quem
              clica em "Nova etapa" não precisa procurá-la de novo depois de
              trocar de ângulo.

              A ordem é uma só, mas a forma muda com a largura. Os controles
              lado a lado cabem no computador; no telefone eles quebravam em duas
              fileiras irregulares logo abaixo do título — "Só leitura", "Editar
              fluxo" e "Colar etapas" numa, "Exportar" e "Nova etapa" noutra —, e
              o cabeçalho tomava metade da tela antes de a primeira etapa
              aparecer. Então na tela estreita fica visível só o que se usa toda
              hora, "Nova etapa", e o resto entra em "Mais ações", na mesma ordem
              em que está na barra larga.
            */}
            <div className="hidden flex-wrap items-center justify-end gap-1.5 md:flex">
              <Button variant="ghost" size="sm" onClick={() => setSomenteLeitura((v) => !v)}>
                {somenteLeitura ? "Liberar edição" : "Só leitura"}
              </Button>

              <Button variant="outline" size="sm" onClick={() => setEditandoFluxo(true)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Editar fluxo
              </Button>

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

              {completo && (
                <BotaoDeImportarModelo importador={importador} desabilitado={somenteLeitura} />
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

            <div className="flex items-center gap-1.5 md:hidden">
              <Button
                size="sm"
                disabled={somenteLeitura}
                onClick={() => setEditandoEtapa({ aberto: true, etapaId: null })}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Nova etapa
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Mais ações">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setSomenteLeitura((v) => !v)}>
                    {somenteLeitura ? (
                      <Unlock className="mr-2 h-4 w-4" />
                    ) : (
                      <Lock className="mr-2 h-4 w-4" />
                    )}
                    {somenteLeitura ? "Liberar edição" : "Só leitura"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditandoFluxo(true)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar fluxo
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={somenteLeitura} onSelect={() => setColando(true)}>
                    <ListPlus className="mr-2 h-4 w-4" />
                    Colar etapas
                  </DropdownMenuItem>
                  {completo && (
                    <>
                      <DropdownMenuSeparator />
                      <SubmenuDeExportar
                        completo={completo}
                        catalogo={catalogo.data}
                        empresa={nomeDaEmpresa}
                      />
                      <ItemDeImportarModelo importador={importador} desabilitado={somenteLeitura} />
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/*
            A BARRA DA VISUALIZAÇÃO — a única faixa que muda com o ângulo.

            A ordem dos lugares é fixa: seletor, opção da visualização, ferramentas
            do canvas, descrição. O segundo lugar tem largura mínima reservada
            mesmo quando está vazio, senão "Elementos" e "Organizar" andariam para
            a esquerda na Jornada e voltariam nas Raias — que é o mesmo defeito, só
            que menor.
          */}
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t pt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Visualização</span>
              <SeletorDeVisualizacao valor={visualizacao} aoTrocar={trocarVisualizacao} />
            </div>

            {/*
              O controle que só existe para algumas visualizações. Ele ocupa um
              lugar só — orientação no Fluxo e nos Gargalos, agrupamento nas Raias
              — em vez de os dois ficarem visíveis o tempo todo: uma barra com
              todas as opções das seis obrigaria a ler seis controles para usar um.

              A largura reservada para esse lugar vale a partir do computador. No
              telefone a barra já quebra em linhas, e reservar 196px vazios só
              empurrava o controle seguinte para uma linha sozinha — a fileira em
              branco que aparecia entre "Visualização" e "Tipo de jornada".
            */}
            <div className="flex min-h-8 items-center gap-1.5 md:min-w-[196px]">
              {(visualizacao === "fluxo" || visualizacao === "gargalos") && (
                <>
                  <span className="text-xs text-muted-foreground">Orientação</span>
                  <Select
                    value={orientacao}
                    onValueChange={(v) => trocarOrientacao(v as "vertical" | "horizontal")}
                  >
                    <SelectTrigger className="h-8 w-[130px]" aria-label="Orientação do fluxo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vertical">Vertical</SelectItem>
                      <SelectItem value="horizontal">Horizontal</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}

              {visualizacao === "raias" && (
                <>
                  <span className="text-xs text-muted-foreground">Agrupar por</span>
                  <Select value={agrupamento} onValueChange={(v) => trocarAgrupamento(v as never)}>
                    <SelectTrigger className="h-8 w-[130px]" aria-label="Agrupar raias por">
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
                </>
              )}
            </div>

            {/*
              O tipo de jornada. Fica ao lado do seletor de visualização, e não
              dentro dele, porque não é uma sétima visualização: a jornada
              continua sendo uma só — o que se escolhe aqui é qual campo das
              etapas o cartão mostra.
            */}
            {visualizacao === "jornada" && (
              <div className="flex items-center gap-1.5">
                <span className="hidden text-xs text-muted-foreground lg:inline">
                  Tipo de jornada
                </span>
                <Select value={lente} onValueChange={(v) => trocarLente(v as never)}>
                  <SelectTrigger className="h-8 w-[150px]" aria-label="Tipo de jornada">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LENTES_DA_JORNADA.map((l) => (
                      <SelectItem key={l.valor} value={l.valor}>
                        {l.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/*
              O interruptor da janela de elementos. Ele só aparece onde há canvas:
              na Jornada e na Lista não existe desenho para receber um elemento, e
              um botão que abre uma paleta inútil é pior do que a ausência dele.
            */}
            {entrada.ehCanvas && (
              <Button
                variant={paletaAberta ? "secondary" : "ghost"}
                size="sm"
                disabled={somenteLeitura}
                aria-pressed={paletaAberta}
                onClick={() => setPaletaAberta((v) => !v)}
              >
                <Shapes className="mr-1.5 h-3.5 w-3.5" />
                Elementos
              </Button>
            )}

            {/*
              "Organizar" é o botão que faltava: `posicionarEtapas` já era função
              pura e testada, e nada na tela a chamava — quem montasse um fluxo à
              mão ficava com o arranjo que arrastou, e quem esquecesse de arrastar
              ficava com os cartões empilhados na origem.

              O clique normal arruma só o que nunca foi posicionado. Com a tecla
              Shift, refaz o desenho inteiro — o pedido destrutivo fica atrás de
              um gesto deliberado, e o rótulo do botão o anuncia.

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

            {/*
              A descrição fica no fim da barra, encostada à direita: é o texto que
              explica o ângulo escolhido, e o lugar dela é junto do seletor que o
              escolheu — não na linha do nome do fluxo, que não muda.
            */}
            <p className="ml-auto hidden max-w-[38ch] truncate text-xs text-muted-foreground lg:block">
              {entrada.descricao}
            </p>
          </div>

          {(mover.isError ||
            conectar.isError ||
            excluirEtapa.isError ||
            organizar.isError ||
            criarElemento.isError ||
            detalhar.isError ||
            desligarSubfluxo.isError) && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription>
                {fraseDoErro(
                  mover.error ??
                    conectar.error ??
                    excluirEtapa.error ??
                    organizar.error ??
                    criarElemento.error ??
                    detalhar.error ??
                    desligarSubfluxo.error,
                )}
              </AlertDescription>
            </Alert>
          )}
        </header>

        {/*
          O `min-h-0` não é enfeite: sem ele um filho que rola por dentro estica
          o pai em vez de rolar, e o canvas volta a empurrar a barra da tela para
          fora da janela. Com ele, esta faixa tem altura concreta — o que o canvas
          exige para calcular o enquadramento — sem ninguém precisar adivinhar
          quanto o cabeçalho mede.
        */}
        <div className="flex min-h-0 w-full flex-1">
          {/*
            A paleta fica **fora** do canvas, como coluna irmã, e não flutuando por
            cima dele: sobreposta, ela taparia justamente a faixa do desenho em que
            o começo do processo costuma estar, e o pan para desviar dela viraria
            parte do trabalho. Fora, ela também continua no lugar quando o fluxo
            ainda está vazio — que é exatamente quando ela mais serve.
          */}
          {paletaAberta && entrada.ehCanvas && !somenteLeitura && (
            <PaletaDeElementos
              catalogo={catalogo.data}
              aceitaArrasto={arranjoPersistido}
              aoEscolher={(tipo) => criarElemento.mutate({ tipo, posicao: null })}
              aoFechar={() => setPaletaAberta(false)}
            />
          )}

          <div className="relative min-w-0 flex-1">
            {consulta.isLoading && <Skeleton className="h-full w-full" />}
            {/*
              O CONVITE E A TABELA — quem atende o fluxo vazio, e quando.

              Nas cinco visualizações que desenham, um fluxo sem etapa é uma tela
              em branco, e o convite é o que a preenche. Na Lista, não: a tabela
              **é** o caminho de cadastro, com o cabeçalho das colunas dizendo o
              que a etapa vai precisar e a linha de "Adicionar nova etapa" no
              topo. Trocar a tabela vazia por um cartão de convite ali seria
              esconder justamente o lugar onde o trabalho começa.
            */}
            {completo && completo.etapas.length === 0 && visualizacao !== "lista" && (
              <FluxoSemEtapas
                aoCriar={() => setEditandoEtapa({ aberto: true, etapaId: null })}
                aoColar={() => setColando(true)}
                bloqueado={somenteLeitura}
              />
            )}
            {completo && (completo.etapas.length > 0 || visualizacao === "lista") && (
              <MotorDeVisualizacao
                completo={completo}
                catalogo={catalogo.data}
                visualizacao={visualizacao}
                orientacao={orientacao}
                agrupamento={agrupamento}
                lente={lente}
                sinal={sinal}
                onTrocarSinal={setSinal}
                etapaSelecionada={selecionada}
                onSelecionarEtapa={setSelecionada}
                somenteLeitura={somenteLeitura}
                onEditarCampoDaEtapa={aoEditarCampoDaEtapa}
                onCriarEtapa={aoCriarEtapaNaLista}
                onMoverEtapas={aoMover}
                onConectar={aoConectar}
                onAbrirConexao={aoAbrirConexao}
                onSoltarElemento={aoSoltarElemento}
                onDetalharEtapa={aoDetalharEtapa}
                detalhando={detalhandoAgora}
              />
            )}
            {(mover.isPending || criarElemento.isPending) && (
              <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow">
                <Loader2 className="h-3 w-3 animate-spin" />
                {criarElemento.isPending ? "criando a etapa" : "salvando posição"}
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
              subfluxo={subfluxoDaEtapa(completo, etapaSelecionada)}
              onDetalhar={() => aoDetalharEtapa(etapaSelecionada.id)}
              onDesligarSubfluxo={() => desligarSubfluxo.mutate(etapaSelecionada.id)}
              detalhando={detalhandoAgora === etapaSelecionada.id}
            />
          )}
        </div>
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

      {/*
        A importação do modelo fica aqui, com os outros diálogos da tela, e não
        dentro do botão que a abre: o botão vive num contêiner que some por
        largura, e um diálogo aberto não pode depender do tamanho da janela para
        continuar na tela. Ver `importador-do-modelo.tsx`.
      */}
      <DialogoDaImportacao importador={importador} />

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
  lente,
  sinal,
  onTrocarSinal,
  ...props
}: PropsDaVisaoNoCanvas & {
  visualizacao: Visualizacao;
  orientacao: Orientacao;
  agrupamento: AgrupamentoDeRaia;
  lente: LenteDaJornada;
  sinal: string;
  onTrocarSinal: (sinal: string) => void;
}) {
  switch (visualizacao) {
    case "raias":
      return <VisaoRaias {...props} agrupamento={agrupamento} />;
    case "jornada":
      return <VisaoJornada {...props} lente={lente} />;
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
          ligadas e organizadas. Ou puxe um elemento da janela ao lado para o desenho e ligue os
          cartões arrastando das bordas.
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
