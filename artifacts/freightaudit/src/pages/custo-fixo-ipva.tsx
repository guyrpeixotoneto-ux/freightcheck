import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, ListChecks, Receipt, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import {
  agruparPorVeiculoDeIpva,
  VARIAVEIS_DE_DETALHE_DE_IPVA,
  VARIAVEIS_DE_IPVA,
} from "@workspace/comparison/ipva";
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
import { CartoesDeIpva } from "@/components/ipva/cartoes";
import {
  AliquotaImplicita,
  AlteracoesPorVariavel,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/ipva/graficos";
import { TabelaDeIpva } from "@/components/ipva/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { BarraDoLote } from "@/components/justificativas/barra-do-lote";
import { JustificarEmLoteDialog } from "@/components/justificativas/justificar-em-lote-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { alteracoesDoLote, useJustificarEmLote } from "@/lib/justificar-em-lote";
import { DetalheDoVeiculo } from "@/components/ipva/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  escreverValor,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeIpva,
  type FiltrosDeIpva,
  type TotaisDeIpva,
} from "@/lib/ipva";
import { lerRecorte } from "@/lib/recorte";
import { PainelDaEvolucao } from "@/components/comparacao/evolucao/painel";
import { EVOLUCAO_DO_IPVA } from "@/components/ipva/evolucao";
import {
  ehModoDaAuditoria,
  ehRecorteDeTipo,
  trocaNaRota,
  type ModoDaAuditoria,
} from "@/lib/modo-da-auditoria";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE IPVA — o que mudou no tributo entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que esta tela responde, e a que ela continua não respondendo
 * ---------------------------------------------------------------------------
 * O verbete desta rota, enquanto ela era tela em preparo, pedia a conferência do
 * IPVA contra a base do veículo: ano, categoria e UF do emplacamento. Categoria e
 * UF não estão no acervo, e não passariam a estar porque a tela foi escrita.
 *
 * O que o acervo sustenta é outra pergunta, e ela não é menor: **o que mudou no
 * IPVA de cada veículo entre duas vigências, e qual alíquota do valor de nota
 * cada vigência está aplicando.** A segunda metade é o que separa um IPVA alto de
 * um IPVA errado — e foi ela que revelou, sobre dado real, que a queda de R$ 720
 * mil na linha de IPVA da frota de cavalos não foi economia: foi troca de
 * fórmula, de 1,000% fixo da nota para 0,651% variável (`docs/ACHADO-IPVA.md`).
 * O que falta continua escrito na própria tela, no rodapé da alíquota.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * alíquota e agregados vêm de `@workspace/comparison/ipva`, que o servidor
 * importa do mesmo jeito. O que a página faz é escolher o par, filtrar, paginar
 * e exportar — e mesmo o filtro é uma função só, compartilhada com a contagem
 * das abas, para que a aba nunca prometa doze linhas e a tabela mostre nove.
 *
 * **A tela é de uma unidade por vez**, pela mesma razão que a de FINAME é: uma
 * importação do arquivo da Ambev produz uma vigência por unidade, com o mesmo
 * rótulo e a mesma data — seis vigências × cinco unidades no acervo medido. Um
 * par escolhido sem olhar o escopo casa CAMAÇARI com PERNAMBUCO, que é o único
 * par que o motor recusa por construção, e a tela abriria recusada sem ninguém
 * ter escolhido nada. As três funções que evitam isso são as mesmas do FINAME,
 * e moram no núcleo (`@workspace/comparison/recorte-de-rubrica`) justamente para
 * não existirem em duas versões.
 *
 * **A comparação é sempre do motor.** `/ipva/comparacao` reaproveita o change set
 * quando ele existe e manda calcular quando não existe: é o mesmo caminho de
 * Comparar vigências e o mesmo da Auditoria de FINAME, de modo que as três telas
 * respondem o mesmo número para o mesmo par. As recusas do motor — escopo
 * diferente, cobertura diferente, canal diferente — chegam com a frase dele.
 */
/**
 * A rota desta auditoria — uma só, para os dois modos.
 *
 * `trocarNoEndereco` preserva tudo que não foi pedido: entrar na Evolução e
 * voltar devolve a comparação exatamente como estava — mesma unidade, mesmo
 * canal, mesmo par de vigências, mesmo recorte de equipamento.
 */
const ROTA = "/custo-fixo-ipva";
const trocarNoEndereco = trocaNaRota(ROTA);

export default function AuditoriaDeIpva() {
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
  const [filtros, setFiltros] = useState<FiltrosDeIpva>(FILTROS_VAZIOS);
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
  const candidatos = useCandidatosDoPar("ipva", comparada, escopoAberto);

  const comparacao = useQuery({
    queryKey: ["ipva", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeIpva>(
        `/ipva/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["ipva", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () => fetchJson<TotaisDeIpva>(`/ipva/totais?base=${base}&comparada=${comparada}`),
  });

  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);


  const agregados =
    recorteDeTipo === "TODOS"
      ? comparacao.data
      : comparacao.data?.porTipo?.[recorteDeTipo];

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
  const veiculos = useMemo(() => agruparPorVeiculoDeIpva(filtradas), [filtradas]);
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
    rubrica: "ipva",
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
      `ipva-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  const negativos = comparacao.data?.resumo.impacto.valoresNegativos ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de IPVA
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              {modo === "evolucao" ? "Evolução anual" : "Comparação entre vigências"}
            </span>
          </span>
        }
        icone={Receipt}
        descricao={
          modo === "evolucao"
            ? "Como o IPVA e o licenciamento de cada veículo se moveram ao longo do ano, uma coluna por vigência — com o impacto dos movimentos e a variação ponta a ponta lidos separadamente."
            : "O que mudou no IPVA e no licenciamento de cada veículo entre duas vigências — e qual alíquota do valor de nota cada vigência está aplicando."
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
              idPrefixo="ipva"
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
                rubrica={EVOLUCAO_DO_IPVA}
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
              idPrefixo="ipva"
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
            icone={Receipt}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : "Esta unidade não tem duas vigências para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : escopoAberto
                  ? "A comparação de IPVA precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
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
            what="a comparação de IPVA"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeIpva resumo={(agregados ?? comparacao.data).resumo} />

            {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber((agregados ?? comparacao.data).resumo.impacto.foraDaSoma, 0)}{" "}
                {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora do impacto por serem da coluna “mensal” da carreta, que não é 1/12 da
                anual — elas aparecem na tabela e no detalhe, nunca numa soma.
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
              A alíquota vem em largura inteira, e logo abaixo dos indicadores, por
              ser a leitura própria desta tela — a única que nenhuma outra do
              produto faz. Espremê-la numa das três colunas acima a deixaria com
              cara de gráfico auxiliar, e ela é o oposto disso: é o que distingue
              um IPVA alto de um IPVA errado.
            */}
            <AliquotaImplicita
              aliquotas={totais.data?.aliquotas ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <EvolucaoEntreVigencias
              totais={totaisDoRecorte}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
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
                  id="ipva-busca"
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
                <SelectTrigger className="w-[15rem]" aria-label="Variável de IPVA">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_IPVA, ...VARIAVEIS_DE_DETALHE_DE_IPVA].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/*
                O filtro de negativos é o único desta tela que não existe na de
                FINAME, e existe porque o acervo o pediu: são 15 licenciamentos
                abaixo de zero, até −R$ 1.709,86, e achá-los rolando 600 linhas
                não é achar. Eles continuam somando — a planilha os declarou —,
                mas ficam a um clique de distância de quem for perguntar à Ambev
                se são estorno ou erro.
              */}
              <label
                htmlFor="ipva-so-negativos"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="ipva-so-negativos"
                  checked={filtros.soNegativos}
                  onCheckedChange={(soNegativos) =>
                    setFiltros((f) => ({ ...f, soNegativos }))
                  }
                />
                Só valores negativos
                {negativos > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {formatNumber(negativos, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="ipva-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="ipva-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar veículos sem alteração
              </label>

              {/*
                Justificar em lote — secundário, e imediatamente antes de
                Exportar CSV.

                Ele não compete com nada porque não há ação principal nesta
                fileira: exportar e justificar em lote são duas saídas da mesma
                tabela, e as duas são de quem já leu o recorte. O botão some com
                o modo ligado — a barra logo abaixo passa a ser o comando, e dois
                lugares oferecendo entrar no mesmo modo seriam dois estados
                possíveis para uma coisa só.

                Desligado quando não há alteração justificável no recorte: com a
                aba Conflito aberta, entrar no modo mostraria uma coluna de
                caixas todas desabilitadas.
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
                  icone={Receipt}
                  titulo="Nenhuma variável de IPVA mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    (agregados ?? comparacao.data).resumo.veiculosComparados,
                    0,
                  )} veículos comparados, e o IPVA de todos eles chegou igual nas duas planilhas.`}
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
                <TabelaDeIpva
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
              linhas={linhas as LinhaDeIpva[]}
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
