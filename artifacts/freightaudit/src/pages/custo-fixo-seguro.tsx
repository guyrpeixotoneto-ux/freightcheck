import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Info, ListChecks, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { LinhaDeSeguro } from "@workspace/comparison/seguro";
import {
  leituraDoImpacto,
  VALOR_DECLARADO_SEM_CONFIRMACAO,
} from "@workspace/comparison/politica-do-impacto";
import {
  agruparPorVeiculoDeSeguro,
  VARIAVEIS_DE_DETALHE_DE_SEGURO,
  VARIAVEIS_DE_SEGURO,
} from "@workspace/comparison/seguro";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import {
  RecorteDeEquipamento,
  type RecorteDeTipo,
} from "@/components/comparacao/recorte-de-equipamento";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  TIPOS_DE_EQUIPAMENTO,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { avisoDoParImpossivel, useParNaUrl } from "@/lib/par-de-vigencias";
import { CartoesDeSeguro } from "@/components/seguro/cartoes";
import {
  ConferenciaDoCustoFixo,
  AlteracoesPorVariavel,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/seguro/graficos";
import { TabelaDeSeguro } from "@/components/seguro/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { BarraDoLote } from "@/components/justificativas/barra-do-lote";
import { JustificarEmLoteDialog } from "@/components/justificativas/justificar-em-lote-dialog";
import { alteracoesDoLote, useJustificarEmLote } from "@/lib/justificar-em-lote";
import { DetalheDoVeiculo } from "@/components/seguro/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  contagemPorAba,
  escreverValor,
  filtrar,
  FILTROS_VAZIOS,
  linhasDoCsv,
  type ComparacaoDeSeguro,
  type FiltrosDeSeguro,
  type TotaisDeSeguro,
} from "@/lib/seguro";
import { lerRecorte } from "@/lib/recorte";
import { PainelDaEvolucao } from "@/components/comparacao/evolucao/painel";
import { EVOLUCAO_DO_SEGURO } from "@/components/seguro/evolucao";
import {
  ehModoDaAuditoria,
  ehRecorteDeTipo,
  trocaNaRota,
  type ModoDaAuditoria,
} from "@/lib/modo-da-auditoria";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE SEGURO E APARATO — o que se paga por equipar a carreta.
 *
 * ---------------------------------------------------------------------------
 * A pergunta desta tela, e o achado que a fez existir
 * ---------------------------------------------------------------------------
 * **Seguro, rastreador, tacógrafo, revestimento e faixa refletiva de cada
 * carreta entre duas vigências — e se esse dinheiro está em algum total que a
 * casa já usa.** A segunda metade é a razão da tela.
 *
 * Medido nas 657 linhas do acervo: `carreta.custo_fixo` é, ao centavo e em 657
 * de 657, `carreta.finame` + `carreta.lucro_fixomodelo_novo_ciclo`. Some-se o
 * aparato a essa conta e ela deixa de fechar nas 657. Ou seja, entre R$ 391,81 e
 * R$ 1.104,53 por carreta existem na planilha, aparecem na tela de Custo Fixo
 * Total do Freightech — onde as cinco colunas batem por **valor** com o nosso
 * export (ver `lib/knowledge/src/catalogo.ts`) — e não estão em nenhum total que
 * o acervo entrega. Quem orçar a carreta pelo custo fixo declarado vai orçá-la a
 * menos.
 *
 * ---------------------------------------------------------------------------
 * As três coisas que esta tela diz e as outras não dizem
 * ---------------------------------------------------------------------------
 * **A rubrica é só da carreta.** O cavalo não declara nenhuma das cinco colunas
 * — não é que venham zeradas, é que não existem. A aba Cavalo abre vazia, e isso
 * é a resposta certa.
 *
 * **O rastreador é coluna sem dado.** Zero nas 657 linhas, nas duas pontas. Ele
 * fica na tabela porque escondê-lo apagaria o achado, e fica fora da soma porque
 * um total que o inclui afirma que rastrear custa R$ 0,00 — a mesma recusa que o
 * montante de ICMS recebe na Auditoria de Impostos.
 *
 * **Só o seguro é negociado.** Revestimento (R$ 277,94), faixa refletiva
 * (R$ 15,94) e tacógrafo (R$ 21,03 ou zero) têm um valor só para a frota
 * inteira: quando um deles muda, as 657 carretas mudam juntas. O seguro tem 38
 * valores distintos, de R$ 97,93 a R$ 789,62 — e é por isso que é ele que resume
 * a placa, e que tem um alternador só dele na barra de filtros.
 *
 * ---------------------------------------------------------------------------
 * O alternador "sem alteração" importa mais aqui do que nas outras telas
 * ---------------------------------------------------------------------------
 * Porque três das cinco colunas são taxa fixa, e a comparação típica não move
 * nada. Desligado, a tela diz "nada mudou" e para aí — que é verdade e é pouco.
 * Ligado, ela mostra **quanto** é o aparato de cada carreta, que é a outra
 * metade da pergunta.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto, a
 * conferência contra o custo fixo e os agregados vêm de
 * `@workspace/comparison/seguro`, que o servidor importa do mesmo jeito. O que a
 * página faz é escolher o par, filtrar, paginar e exportar.
 */
/**
 * A rota desta auditoria — uma só, para os dois modos.
 *
 * `trocarNoEndereco` preserva tudo que não foi pedido: entrar na Evolução e
 * voltar devolve a comparação exatamente como estava — mesma unidade, mesmo
 * canal, mesmo par de vigências, mesmo recorte de equipamento.
 */
const ROTA = "/custo-fixo-seguro";
const trocarNoEndereco = trocaNaRota(ROTA);

export default function AuditoriaDeSeguro() {
  /**
   * O par que o endereço traz, quando traz — o que faz o **Abrir auditoria** do
   * Monitor Custo Fixo chegar aqui no mesmo par que ele estava mostrando.
   *
   * É só o valor inicial: `parReconciliado`, abaixo, continua mandando, e um
   * par que não pertença à unidade aberta é descartado como qualquer outro.
   * Sem os parâmetros no endereço, as duas pontas nascem vazias — o estado que
   * esta tela sempre teve. Ver `useParNaUrl`, em `lib/par-de-vigencias.ts`.
   */
  /*
    As duas pontas moram no endereço — ver `useParNaUrl`.

    Eram `useState`, e o par não sobrevivia a um recarregamento nem cabia num
    link: copiar o endereço depois de comparar junho com setembro mandava o
    outro para o par de partida desta tela. O hook entra no lugar do `useState`
    sem mudar mais nada — o seletor continua recebendo os mesmos dois setters.
  */
  const [base, setBase] = useParNaUrl("base");
  const [comparada, setComparada] = useParNaUrl("comparada");
  const [filtros, setFiltros] = useState<FiltrosDeSeguro>(FILTROS_VAZIOS);
  const [comSemAlteracao, setComSemAlteracao] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberto, setAberto] = useState<{
    entityLabel: string | null;
    entityType: string;
  } | null>(null);

  const vigencias = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });

  /**
   * A unidade aberta na lateral — e por que esta tela precisa saber dela.
   *
   * Sem isto, trocar de unidade aqui não trocaria o dado: trocaria de tela.
   * `enderecoDe` (`lib/navegacao-do-escopo.ts`) desvia para Parâmetros toda tela
   * que não sabe ler o recorte. Estar em `TELAS_QUE_HONRAM_ESCOPO` é uma
   * promessa, e o que a cumpre é o recorte abaixo.
   */
  const recorte = lerRecorte(useSearch());

  /**
   * O modo aberto, e o recorte **da evolução** — duas chaves próprias no mesmo
   * endereço.
   *
   * São chaves separadas de `filtros.tipo` de propósito, e é isso que faz a ida
   * e volta não custar nada: entrar na Evolução não toca no recorte da
   * comparação, que continua no estado e volta como estava ao sair. Unidade,
   * canal, `scopeHash` e o par de vigências nem são mencionados aqui — eles
   * vivem na URL e no estado da tela, e a troca de modo passa ao largo deles.
   *
   * Valor adulterado cai no padrão em vez de quebrar: `comparacao` para o modo,
   * que é a tela que sempre existiu, e `TODOS` para o recorte da evolução.
   */
  const busca = useSearch();
  const [, navegar] = useLocation();
  const parametrosDaUrl = useMemo(() => new URLSearchParams(busca), [busca]);
  const modoPedido = parametrosDaUrl.get("modo");
  const modo: ModoDaAuditoria = ehModoDaAuditoria(modoPedido) ? modoPedido : "comparacao";
  const recortePedido = parametrosDaUrl.get("recorteEvolucao");
  const recorteDaEvolucao: RecorteDeTipo = ehRecorteDeTipo(recortePedido)
    ? recortePedido
    : "TODOS";
  const anoDaEvolucao = parametrosDaUrl.get("ano");

  const trocarNaUrl = (mudancas: Record<string, string | null>) =>
    navegar(trocarNoEndereco(busca, mudancas));

  /** O contexto da unidade aberta, que atravessa os dois modos sem ser tocado. */
  const consultaDoContexto = useMemo(() => {
    const q = new URLSearchParams();
    for (const chave of ["scopeHash", "canal", "operacao"]) {
      const valor = parametrosDaUrl.get(chave);
      if (valor !== null && valor !== "") q.set(chave, valor);
    }
    return q;
  }, [parametrosDaUrl]);

  /**
   * Os contextos — de onde saem o **nome** de cada unidade e **qual delas está
   * aberta**.
   *
   * A vigência traz o `scope_hash`, que é um hash: serve para recortar e não
   * para ler. Quem traduz hash em "CAMAÇARI" é a lista de contextos, que a
   * lateral já consulta — daí `useContextosDaCasca`, que divide o mesmo cache e
   * nunca transforma uma falha em painel de erro. Sem ela, os rótulos ficam sem
   * o nome da unidade: é degradação, não quebra.
   */
  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  /**
   * A unidade aberta — **a mesma que a lateral nomeia**, com ou sem `scopeHash`.
   *
   * `recorte.scopeHash` sozinho não responde isto, e é o erro que a Auditoria de
   * FINAME já pagou: sem ele na URL — quem chega por um link nu, ou pelo menu
   * antes de escolher unidade —, a caixa "Unidade atual" continua escrevendo uma
   * unidade, porque cai no primeiro contexto (`contextoAberto`). Uma tela que
   * lesse só a URL listaria as cinco sob o nome de uma.
   */
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;

  /**
   * Recortar antes de saber qual é a unidade daria a lista errada por um
   * instante — e, pior, um par escolhido nela.
   */
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * As vigências que o seletor oferece: as da unidade aberta **que cobrem
   * equipamento**.
   *
   * O segundo filtro não é refinamento: esta tela lê placa, e o acervo entrega
   * o arquivo de trecho como vigência separada (`entity_type_set = TRECHO`).
   * Sem ele a lista oferecia uma ponta que esta tela não sabe ler — e escolhê-la
   * é a recusa do motor em tela ("Coberturas diferentes") ou zero linhas sem
   * explicação, nas duas vezes por um erro que não é de quem clicou.
   */
  /**
   * A série aberta — cavalo, carreta, ou as duas.
   *
   * Declarada **antes** da lista de vigências porque é ela que a recorta: na
   * aba Cavalo o seletor do par só oferece vigências que têm cavalo. O
   * mecanismo continua sendo `filtros.tipo`, que a tabela, as abas de estado e
   * o CSV já respeitavam; o que mudou é quem o comanda e o quanto ele alcança.
   */
  const recorteDeTipo = (filtros.tipo === "TODOS" ? "TODOS" : filtros.tipo) as RecorteDeTipo;

  /**
   * As vigências de equipamento da unidade — **antes** da aba.
   *
   * Existe separada da lista que o seletor oferece porque três coisas precisam
   * do acervo inteiro da unidade, e não do recorte de uma aba: o rótulo de cada
   * vigência, quais abas habilitar, e nada mais. Recortar antes delas foi o
   * defeito que esta separação conserta — ver `rotulos`, logo abaixo.
   */
  const daUnidadeTodas = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPOS_DE_EQUIPAMENTO,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  /**
   * As datas da unidade — o eixo do ano, na Evolução.
   *
   * Sai de `daUnidadeTodas` (o acervo da unidade, antes da aba) pelo mesmo
   * motivo que os rótulos: quais anos existem é pergunta sobre a unidade, e não
   * sobre o recorte aberto. Recortada pela aba, a lista de anos mudaria ao
   * trocar de equipamento — e um ano sumiria do seletor por ter só carreta.
   */
  const datasDaUnidade = useMemo(
    () => [...new Set(daUnidadeTodas.map((v) => v.effectiveDate))],
    [daUnidadeTodas],
  );

  /**
   * A lista que o seletor do par oferece — a da aba aberta.
   *
   * A aba escolhe a série: Cavalo oferece quem tem cavalo — inclusive as
   * vigências que trazem os dois —, Carreta idem, e "Cavalo + Carreta" o acervo
   * de equipamento inteiro. Quem garante que as duas pontas do par continuam
   * comparáveis dentro da aba é o seletor (`vigenciasCompativeisCom`): a
   * cobertura da vigência ainda tem de bater exatamente, e uma série de cavalo
   * puro não casa com uma de cavalo mais carreta.
   */
  const daUnidade = useMemo(
    () =>
      recorteDeTipo === "TODOS"
        ? daUnidadeTodas
        : vigenciasQueCobrem(daUnidadeTodas, [recorteDeTipo]),
    [daUnidadeTodas, recorteDeTipo],
  );

  /**
   * Quais séries esta unidade tem — o que habilita cada aba.
   *
   * Sai da lista de vigências, e não da comparação: a aba precisa estar certa
   * antes de existir par escolhido. E sai de `daUnidadeTodas`, não de
   * `daUnidade` — este já está recortado pela aba aberta, e a pergunta aqui é
   * sobre o acervo da unidade.
   */
  const disponiveis = useMemo(
    () =>
      ({
        TODOS: true,
        CAVALO: vigenciasQueCobrem(daUnidadeTodas, ["CAVALO"]).length > 0,
        CARRETA: vigenciasQueCobrem(daUnidadeTodas, ["CARRETA"]).length > 0,
      }) as Record<RecorteDeTipo, boolean>,
    [daUnidadeTodas],
  );

  /**
   * O texto de cada opção do seletor, distinto por construção.
   *
   * Sem ele o seletor mostra a mesma frase cinco vezes seguidas — uma por
   * unidade —, e escolher ali é adivinhar. `rotulosDasVigencias` acrescenta só o
   * que desempata, e só onde desempata.
   */
  /*
    Sobre `daUnidadeTodas`, e nunca sobre a lista da aba.

    `rotulosDasVigencias` decide a marca da quinzena olhando as **outras datas
    da lista** que recebe: uma entrega sozinha no mês é "agosto/2026", duas no
    mesmo mês viram "1ª quinzena" e "2ª quinzena". Alimentado com a lista já
    recortada pela aba, o mesmo `snapshot` mudava de nome conforme a aba aberta
    — medido: "agosto/2026 · 1ª quinzena" na lista inteira e "agosto/2026" na
    aba Carreta, quando a outra quinzena do mês não tem carreta. O nome de uma
    vigência não pode depender de onde se está olhando.
  */
  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidadeTodas, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidadeTodas, nomePorEscopo],
  );

  /**
   * O par aberto, mantido dentro da unidade aberta.
   *
   * Quem decide é `parReconciliado`, e a regra dele é uma: **o que está na
   * lista fica**. Ao trocar de unidade, o par anterior deixa de estar nela — e
   * mantê-lo faria a tela responder por Pernambuco sob a palavra CAMAÇARI. Ao
   * abrir sem nenhuma ponta válida, é `parDePartida` quem escolhe, com as duas
   * recusas do motor antecipadas: mesma cobertura e mesmo escopo.
   *
   * O que ele nunca faz é desfazer escolha de quem escolheu — o defeito
   * relatado na Auditoria de Km Rodado, onde cada clique no seletor era apagado
   * no quadro seguinte.
   */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const par = parReconciliado(daUnidade, { base, comparada });
    if (par.base !== base) setBase(par.base);
    if (par.comparada !== comparada) setComparada(par.comparada);
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  /**
   * Por que esta lista não dá par — quando não dá.
   *
   * Sai da lista, e não de "as duas pontas estão vazias": o par é escolhido num
   * efeito, que roda **depois** da renderização — ler o estado aqui piscaria a
   * tela vazia por um quadro em toda unidade que tem par.
   */
  const semPar =
    Boolean(vigencias.data) && unidadeResolvida ? motivoSemPar(daUnidade) : null;
  /** Há lista e mesmo assim não há par: a frase da tela vazia é outra. */
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  /**
   * A tela vazia fala enquanto ninguém escolheu o par inteiro.
   *
   * Com as duas pontas escolhidas à mão — o que `parReconciliado` agora
   * preserva —, quem responde é a comparação, ou a recusa do servidor sobre
   * aquele par. Manter a frase no ar ao lado do resultado negaria o que está
   * logo abaixo dela.
   */
  const semParPossivel = semPar !== null && !(base && comparada);

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * A pergunta, a chave e a cadência moram em `useCandidatosDoPar`, com as
   * outras duas auditorias: a pergunta é a mesma, e telas irmãs respondendo com
   * fôlegos diferentes seria diferença sem motivo. O que esta tela decide é só
   * o que é dela — a rubrica, o "Para" aberto e a unidade do recorte.
   */
  const candidatos = useCandidatosDoPar("seguro", comparada, escopoAberto);

  const comparacao = useQuery({
    queryKey: ["seguro", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeSeguro>(
        `/seguro/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["seguro", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () => fetchJson<TotaisDeSeguro>(`/seguro/totais?base=${base}&comparada=${comparada}`),
  });

  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);


  const agregados =
    recorteDeTipo === "TODOS"
      ? comparacao.data
      : comparacao.data?.porTipo?.[recorteDeTipo];

  /*
    A política do impacto, lida uma vez para a tela inteira.

    O cartão, a tabela e o painel de evolução respondiam pela mesma comparação
    e decidiam sozinhos: o cartão dizia "Sem impacto precificável" enquanto a
    tabela, logo abaixo, publicava reais sem ressalva. A decisão passa a ser uma
    (`politica-do-impacto`), sobre o **recorte aberto**, que é o mesmo de que
    saem os números dos três.
  */
  const impactoDoRecorte = (agregados ?? comparacao.data)?.resumo.impacto;
  const leituraDoImpactoEmTela = impactoDoRecorte
    ? leituraDoImpacto(impactoDoRecorte.porPeriodicidade, impactoDoRecorte.naoCalculavel)
    : null;

  /**
   * Quantos veículos cada recorte tem — o número ao lado de cada aba.
   *
   * Comparados + novos + ausentes: os três estados da frota no par. Zero
   * desabilita a aba, porque uma vigência sem carreta não tem tela de carreta.
   */
  const contagensDoRecorte = useMemo(() => {
    const quantos = (
      a:
        | {
            resumo: {
              veiculosComparados: number;
              novosNaVigencia: number;
              ausentesNaComparada: number;
            };
          }
        | undefined,
    ) =>
      a
        ? a.resumo.veiculosComparados +
          a.resumo.novosNaVigencia +
          a.resumo.ausentesNaComparada
        : 0;
    return {
      TODOS: quantos(comparacao.data),
      CAVALO: quantos(comparacao.data?.porTipo?.CAVALO),
      CARRETA: quantos(comparacao.data?.porTipo?.CARRETA),
    } as Record<RecorteDeTipo, number>;
  }, [comparacao.data]);

  /** Os totais do gráfico, no recorte aberto — a série já vem por tipo. */
  const totaisDoRecorte = useMemo(() => {
    const todos = totais.data?.totais ?? [];
    return recorteDeTipo === "TODOS"
      ? todos
      : todos.filter((t) => t.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);
  const contagens = useMemo(
    () => contagemPorAba(linhas, { ...filtros, estado: "TODAS" }),
    [linhas, filtros],
  );

  /**
   * As placas — o que a tabela lista desde que deixou de listar variáveis.
   *
   * **Agrupa depois de filtrar, e não antes.** As abas, a busca e os seletores
   * continuam sendo sobre a alteração — é ali que moram o estado e a variável —,
   * e a placa entra na lista quando sobra alguma linha dela no recorte. Agrupar
   * primeiro obrigaria cada filtro a decidir o que significa "uma placa
   * alterada", e a aba diria 33 sobre uma tabela de 7 linhas.
   *
   * Por isso a contagem das abas continua em alterações: é o que elas contam. A
   * paginação, essa sim, passou a ser de veículos — é o que a tabela mostra.
   */
  const veiculos = useMemo(() => agruparPorVeiculoDeSeguro(filtradas), [filtradas]);
  const naPagina = useMemo(
    () => veiculos.slice((pagina - 1) * porPagina, pagina * porPagina),
    [veiculos, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  /*
    As duas pontas escritas como quem fala delas — `julho/2026`.

    Saíam do `sourceLabel`: o gráfico dizia `EMPURRADA_2_7_2026` sob o mesmo par
    que o seletor, dois centímetros acima, chamava de `julho/2026`. Duas
    palavras para a mesma vigência na mesma tela, e a do gráfico é a que
    ninguém usa para falar — ninguém abre a tela querendo saber o que mudou no
    `EMPURRADA_2_7_2026`.

    `rotulos` é o mesmo mapa do seletor, de modo que as duas partes da tela não
    podem divergir: a marca da quinzena, o nome da unidade e o desempate saem de
    uma régua só. O `sourceLabel` fica de reserva para a vigência que não
    estiver no mapa.

    Com isto o nome do arquivo deixa de aparecer nesta tela por padrão — e é o
    que se quer: ele não é como a vigência se chama, é o que ela veio. Onde ele
    ainda importa, `rotulosDasVigencias` o traz de volta sozinho, como último
    desempate entre duas linhas que seguiriam indistinguíveis.
  */
  const rotuloBase =
    rotulos.get(base) ?? vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    rotulos.get(comparada) ??
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ??
    "Para";

  /*
    Justificar sem sair daqui — a mesma caixa de Chamados, o mesmo POST, e a
    vigência escrita nela: quem justifica a partir desta tela escolheu o par no
    seletor acima, e um diálogo que não diz onde grava deixa a decisão sem a
    metade que a torna verificável.
  */
  const justificar = useJustificarNaTabela(
    comparacao.data?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada}`,
  );

  /*
    JUSTIFICAR EM LOTE — a mesma caixa, aplicada a várias alterações de uma vez.

    O universo é `filtradas`, e não `naPagina`: é o recorte inteiro dos filtros
    ativos que o link "Selecionar todos os N resultados" alcança, e é dele que
    sai o N escrito nele. A tabela continua paginada; a seleção, não.

    `filtros` vai inteiro para o hook — é dele que saem o recorte gravado e a
    assinatura que derruba a seleção global quando alguém mexe num filtro. Uma
    lista de campos escolhidos a dedo aqui seria um campo a esquecer amanhã.
  */
  const alteracoesDoRecorte = useMemo(
    () => alteracoesDoLote(filtradas, escreverValor),
    [filtradas],
  );

  const lote = useJustificarEmLote({
    changeSetId: comparacao.data?.changeSetId,
    contexto: `comparação ${rotuloBase} → ${rotuloComparada}`,
    justificadaPor: justificar.justificadaPor,
    alteracoesDoRecorte,
    rubrica: "seguro",
    base,
    comparada,
    filtros,
    filtrosVazios: FILTROS_VAZIOS,
    semAlteracao: comSemAlteracao,
  });

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificar.justificadaPor));
    salvarArquivo(
      blob,
      `seguro-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  const deTaxa = comparacao.data?.resumo.impacto.alteracoesDeTaxa ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Seguro e Aparato
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              {modo === "evolucao" ? "Evolução anual" : "Comparação entre vigências"}
            </span>
          </span>
        }
        icone={ShieldCheck}
        descricao={
          modo === "evolucao"
            ? "Como o seguro e o aparato de cada carreta se moveram ao longo do ano, uma coluna por vigência — com o impacto dos movimentos e a variação ponta a ponta lidos separadamente."
            : "Seguro, rastreador, tacógrafo, revestimento e faixa refletiva de cada carreta entre duas vigências — e se esse dinheiro está no custo fixo que o export declara."
        }
        atualizando={
          modo === "comparacao" && comparacao.isFetching && !comparacao.isLoading
        }
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        {vigencias.error ? (
          <ApiErrorNotice
            error={vigencias.error}
            what="a lista de vigências"
            onTentarDeNovo={() => void vigencias.refetch()}
          />
        ) : (
          <>
            <RecorteDeEquipamento
              valor={recorteDeTipo}
              onValor={(tipo) => {
                /* Escolher um equipamento é sair da Evolução: os três primeiros
                   botões são da comparação, e clicar num deles é pedir a tela
                   deles. O recorte da evolução fica guardado para a volta. */
                setFiltros((f) => ({ ...f, tipo }));
                if (modo !== "comparacao") trocarNaUrl({ modo: null });
              }}
              disponiveis={disponiveis}
              idPrefixo="seguro"
              abaExtra={{
                rotulo: "Evolução",
                ativa: modo === "evolucao",
                onAbrir: () => trocarNaUrl({ modo: "evolucao" }),
                ...(daUnidadeTodas.length === 0
                  ? {
                      indisponivel:
                        "Esta unidade ainda não tem vigência de equipamento importada — não há ano para acompanhar.",
                    }
                  : {}),
              }}
            />
            {modo === "evolucao" && (
              <PainelDaEvolucao
                rubrica={EVOLUCAO_DO_SEGURO}
                consulta={consultaDoContexto}
                datas={datasDaUnidade}
                recorte={recorteDaEvolucao}
                onRecorte={(r) => trocarNaUrl({ recorteEvolucao: r === "TODOS" ? null : r })}
                ano={anoDaEvolucao}
                onAno={(a) => trocarNaUrl({ ano: a })}
                disponiveis={disponiveis}
              />
            )}
            {modo === "comparacao" && (
            <SeletorDoPar
              vigencias={daUnidade}
              foco={recorteDeTipo === "TODOS" ? null : recorteDeTipo}
              base={base}
              comparada={comparada}
              onBase={setBase}
              onComparada={setComparada}
              onInverter={() => {
                setBase(comparada);
                setComparada(base);
              }}
              rotulos={rotulos}
              carregando={comparacao.isFetching}
              idPrefixo="seguro"
              candidatos={candidatos.data}
              carregandoCandidatos={candidatos.isFetching}
              erroDosCandidatos={
                candidatos.error instanceof Error ? candidatos.error.message : null
              }
            />
            )}
          </>
        )}

        {/*
          Tudo abaixo é da comparação: a tela vazia, os cartões, os gráficos, a
          tabela e a gaveta. Na Evolução o painel acima responde sozinho, e
          deixar esta metade no ar poria a matriz do ano sob os cartões de um par
          de vigências — o número de um recorte sob o título de outro.
        */}
        {modo === "comparacao" && (
          <>
        {semParPossivel && (
          <EstadoVazio
            icone={ShieldCheck}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : "Esta unidade não tem duas vigências para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : escopoAberto
                  ? "A comparação do aparato precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
                  : "O acervo ainda não tem duas vigências da mesma unidade e da mesma cobertura para comparar."
            }
          />
        )}

        {comparacao.isLoading && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        )}

        {comparacao.error && (
          <ApiErrorNotice
            error={comparacao.error}
            what="a comparação do aparato"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeSeguro resumo={(agregados ?? comparacao.data).resumo} />

            {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber((agregados ?? comparacao.data).resumo.impacto.foraDaSoma, 0)}{" "}
                {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora do impacto: o rastreador é zero em todas as linhas do acervo, e o
                custo fixo do conjunto é total — ele já contém o FINAME e o lucro fixo.
                As duas aparecem na tabela e no detalhe, nunca numa soma.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <TotalPorVigencia
                totais={totaisDoRecorte}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={(agregados ?? comparacao.data).alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={(agregados ?? comparacao.data).distribuicaoPorEstado} />
            </div>

            {/*
              A conferência vem em largura inteira, e logo abaixo dos
              indicadores, por ser a leitura própria desta tela — a única que
              nenhuma outra do produto faz. Espremê-la numa das três colunas
              acima a deixaria com cara de gráfico auxiliar, e ela é o oposto
              disso: é o que diz se este dinheiro está em algum total que a casa
              já usa.
            */}
            <ConferenciaDoCustoFixo
              conferencias={totais.data?.conferencias ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <EvolucaoEntreVigencias
              totais={totaisDoRecorte}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              /* A mesma política do cartão e do menu do par — ver
                 `politica-do-impacto`. */
              leitura={leituraDoImpactoEmTela}
            />

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b">
              {ABAS_DE_ESTADO.map((aba) => (
                <button
                  key={aba.chave}
                  type="button"
                  role="tab"
                  aria-selected={filtros.estado === aba.chave}
                  onClick={() => setFiltros((f) => ({ ...f, estado: aba.chave }))}
                  className={cn(
                    "border-b-2 py-2 text-sm font-semibold",
                    filtros.estado === aba.chave
                      ? "border-brand text-brand"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* Com o alternador ligado a lista deixa de ser só de
                      alterações — chamar centenas de linhas iguais de
                      "alterações" seria o rótulo contradizendo a coluna Status. */}
                  {aba.chave === "TODAS" && comSemAlteracao ? "Todas as linhas" : aba.rotulo} (
                  {formatNumber(contagens[aba.chave] ?? 0, 0)})
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[13rem] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="seguro-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar placa ou variável…"
                  aria-label="Buscar placa ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O seletor "Tipo de equipamento" morava aqui e subiu para o topo
                da tela (`RecorteDeEquipamento`). Duas caixas comandando o mesmo
                `filtros.tipo` seriam duas respostas possíveis para "qual
                recorte está aberto" — e a de baixo, entre filtros de tabela,
                sugeriria que o recorte é só da tabela.
              */}
              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[15rem]" aria-label="Variável do aparato">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_SEGURO, ...VARIAVEIS_DE_DETALHE_DE_SEGURO].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/*
                O alternador do seguro é o filtro próprio desta tela, e existe
                porque quatro das cinco colunas se movem em bloco: quando a
                tabela de revestimento muda, as 657 carretas mudam juntas, e a
                lista inteira vira ruído sobre o que aconteceu com *uma* placa.
                Ligado, sobra só o que foi negociado ativo a ativo.
              */}
              <label
                htmlFor="seguro-so-seguro"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="seguro-so-seguro"
                  checked={filtros.soSeguro}
                  onCheckedChange={(soSeguro) => setFiltros((f) => ({ ...f, soSeguro }))}
                />
                Só o seguro
                {deTaxa > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {formatNumber(deTaxa, 0)} de taxa
                  </span>
                )}
              </label>

              <label
                htmlFor="seguro-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="seguro-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar veículos sem alteração
              </label>

              {/*
                Justificar em lote — secundário, e imediatamente antes de
                Exportar CSV.

                Ele some com o modo ligado: a barra logo abaixo passa a ser o
                comando, e dois lugares oferecendo entrar no mesmo modo seriam
                dois estados possíveis para uma coisa só. Desligado quando não
                há alteração justificável no recorte — entrar no modo ali
                mostraria uma coluna de caixas todas desabilitadas.
              */}
              {!lote.emLote && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={lote.abrirModo}
                  disabled={alteracoesDoRecorte.length === 0}
                  className="ml-auto gap-2 border-brand/40 text-brand hover:bg-brand/5 hover:text-brand"
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  Justificar em lote
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={exportar}
                disabled={filtradas.length === 0}
                className={cn("gap-2", lote.emLote && "ml-auto")}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>

            {/* A barra entre os filtros e a tabela — e só enquanto o modo
                estiver ligado. Ver `barra-do-lote.tsx`. */}
            {lote.emLote && <BarraDoLote {...lote.propsDaBarra} />}

            {filtradas.length === 0 ? (
              linhas.length === 0 ? (
                <EstadoVazio
                  icone={ShieldCheck}
                  titulo="Nenhuma coluna do aparato mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    (agregados ?? comparacao.data).resumo.veiculosComparados,
                    0,
                  )} veículos comparados, e o aparato de todos eles chegou igual nas duas planilhas. Três das cinco colunas são taxa fixa — ligue “Mostrar veículos sem alteração” para ver quanto cada carreta paga.`}
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao="O recorte atual não tem nenhuma alteração. Limpe os filtros para ver as demais."
                  acao={
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFiltros(FILTROS_VAZIOS)}
                    >
                      Limpar filtros
                    </Button>
                  }
                />
              )
            ) : (
              <>
                {/*
                  A ressalva da política, sobre as colunas de dinheiro da tabela.

                  Ela publica o valor declarado de cada ponta, e no estado
                  `NAO_PRECIFICAVEL` esse valor é movimento que o motor não pôde
                  precificar — o mesmo movimento que o cartão, acima, chama de
                  "Sem impacto precificável". Os dois números sempre estiveram
                  certos; o que faltava era a tela dizer que respondem a
                  perguntas diferentes. Ver `politica-do-impacto`.
                */}
                {leituraDoImpactoEmTela?.declaradoSemConfirmacao && (
                  <p
                    role="status"
                    className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
                    <span>{VALOR_DECLARADO_SEM_CONFIRMACAO}</span>
                  </p>
                )}
                <TabelaDeSeguro
                  veiculos={naPagina}
                  justificadaPor={justificar.justificadaPor}
                  selecao={lote.emLote ? lote.selecao : undefined}
                  onAbrir={(v) =>
                    setAberto({ entityLabel: v.entityLabel, entityType: v.entityType })
                  }
                  onJustificar={justificar.abrir}
                />
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={veiculos.length}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade="veículos"
                  unidadeSingular="veículo"
                />
              </>
            )}

            <JustificarDialog {...justificar.propsDoDialogo} />

            <JustificarEmLoteDialog {...lote.propsDoDialogo} />

            <DetalheDoVeiculo
              veiculo={aberto}
              linhas={linhas as LinhaDeSeguro[]}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              onFechar={() => setAberto(null)}
            />
          </>
        )}
          </>
        )}
      </div>
    </Layout>
  );
}
