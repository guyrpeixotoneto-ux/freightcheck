import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Landmark, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeImpostos } from "@workspace/comparison/impostos";
import {
  VARIAVEIS_DE_DETALHE_DE_IMPOSTOS,
  VARIAVEIS_DE_IMPOSTOS,
} from "@workspace/comparison/impostos";
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
import { avisoDoParImpossivel, parDaUrl } from "@/lib/par-de-vigencias";
import { CartoesDeImpostos } from "@/components/impostos/cartoes";
import {
  AlteracoesPorVariavel,
  ConferenciaDeAliquotas,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/impostos/graficos";
import { TabelaDeImpostos } from "@/components/impostos/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoVeiculo } from "@/components/impostos/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeImpostos,
  type FiltrosDeImpostos,
  type TotaisDeImpostos,
} from "@/lib/impostos";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE IMPOSTOS — o tributo da compra do ativo entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que esta tela responde, e a que ela continua não respondendo
 * ---------------------------------------------------------------------------
 * O verbete desta rota, enquanto ela era tela em preparo, pedia duas coisas, e
 * a tela entrega uma e **recusa** a outra por escrito.
 *
 * Ela entrega a primeira: **a alíquota medida, e não a declarada.** O acervo
 * declara quatro alíquotas de imposto e dois montantes, e a razão entre dois
 * valores em reais — o tributo sobre o valor de nota — não tem ambiguidade de
 * escala, enquanto uma coluna de percentual pode vir em pontos ou em fração sem
 * que se saiba qual. A conferência entre as duas é o painel central desta tela, e
 * é o que separa uma taxa aplicada de uma taxa apenas declarada.
 *
 * Ela recusa a segunda, que o verbete também pedia: **o imposto do frete não está
 * aqui.** A dedução de PIS/COFINS e de ICMS/ISS sobre a prestação mora na tabela
 * de trecho, que não é a fonte que este banco apura hoje. Somá-la ao imposto da
 * compra do ativo daria o total de duas grandezas diferentes sob um rótulo só —
 * que é exatamente o que o verbete dizia ser preciso evitar. A distinção está
 * escrita no rodapé da conferência e na gaveta de cada veículo.
 *
 * E há um achado que nenhuma das duas metades previa, e que a tela mostra em
 * primeiro plano: **o montante de ICMS é zero nas 1.215 linhas do acervo**,
 * enquanto as alíquotas de ICMS existem e são declaradas em toda linha. Isso não
 * é imposto zero; é coluna sem dado, e o veredito próprio recusa lê-la como
 * 0,000%.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * alíquota medida e agregados vêm de `@workspace/comparison/impostos`, que o
 * servidor importa do mesmo jeito. O que a página faz é escolher o par, filtrar,
 * paginar e exportar — e mesmo o filtro é uma função só, compartilhada com a
 * contagem das abas, para que a aba nunca prometa doze linhas e a tabela mostre
 * nove.
 *
 * **A tela é de uma unidade por vez**, pela mesma razão que as três auditorias
 * anteriores são: uma importação do arquivo da Ambev produz uma vigência por
 * unidade, com o mesmo rótulo e a mesma data. Um par escolhido sem olhar o escopo
 * casa CAMAÇARI com PERNAMBUCO, que é o único par que o motor recusa por
 * construção, e a tela abriria recusada sem ninguém ter escolhido nada. As três
 * funções que evitam isso moram no núcleo
 * (`@workspace/comparison/recorte-de-rubrica`) justamente para não existirem em
 * quatro versões.
 *
 * **A comparação é sempre do motor.** `/impostos/comparacao` reaproveita o change
 * set quando ele existe e manda calcular quando não existe, de modo que esta tela
 * responda o mesmo número que Comparar vigências para o mesmo par.
 */
export default function AuditoriaDeImpostos() {
  /**
   * O par que o endereço traz, quando traz — o que faz o **Abrir auditoria** do
   * Monitor Custo Fixo chegar aqui no mesmo par que ele estava mostrando.
   *
   * É só o valor inicial: `parReconciliado`, abaixo, continua mandando, e um
   * par que não pertença à unidade aberta é descartado como qualquer outro.
   * Sem os parâmetros no endereço, as duas pontas nascem vazias — o estado que
   * esta tela sempre teve. Ver `parDaUrl`, em `lib/par-de-vigencias.ts`.
   */
  const parInicial = parDaUrl(useSearch());
  const [base, setBase] = useState(parInicial.base);
  const [comparada, setComparada] = useState(parInicial.comparada);
  const [filtros, setFiltros] = useState<FiltrosDeImpostos>(FILTROS_VAZIOS);
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

  /** A unidade aberta — a mesma que a lateral nomeia, com ou sem `scopeHash`. */
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
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * A pergunta, a chave e a cadência moram em `useCandidatosDoPar`, com as
   * outras auditorias: a pergunta é a mesma, e telas irmãs respondendo com
   * fôlegos diferentes seria diferença sem motivo. O que esta tela decide é só
   * o que é dela — a rubrica, o "Para" aberto e a unidade do recorte.
   *
   * Esta era a única das quatro sem a coluna, e a ausência não tinha razão: as
   * mesmas vigências, o mesmo gesto, e aqui a escolha era às cegas.
   */
  const candidatos = useCandidatosDoPar("impostos", comparada, escopoAberto);

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
   * `parReconciliado` preserva a ponta que continua na lista e nunca desfaz
   * escolha de quem escolheu. Ao trocar de unidade, o par anterior deixa de
   * estar nela — e mantê-lo faria a tela responder por Pernambuco sob a palavra
   * CAMAÇARI.
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

  const comparacao = useQuery({
    queryKey: ["impostos", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeImpostos>(
        `/impostos/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["impostos", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeImpostos>(`/impostos/totais?base=${base}&comparada=${comparada}`),
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
  const naPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
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

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificar.justificadaPor));
    salvarArquivo(
      blob,
      `impostos-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  const aliquotasAlteradas = comparacao.data?.resumo.impacto.aliquotasAlteradas ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Impostos
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências
            </span>
          </span>
        }
        icone={Landmark}
        descricao="O ICMS e o PIS/COFINS da compra de cada ativo entre duas vigências — e a alíquota que o dinheiro revela, ao lado da que o cadastro declara."
        atualizando={comparacao.isFetching && !comparacao.isLoading}
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
              onValor={(tipo) => setFiltros((f) => ({ ...f, tipo }))}
              disponiveis={disponiveis}
              idPrefixo="impostos"
            />
            <SeletorDoPar
              vigencias={daUnidade}
              foco={recorteDeTipo === "TODOS" ? null : recorteDeTipo}
              candidatos={candidatos.data}
              carregandoCandidatos={candidatos.isFetching}
              erroDosCandidatos={
                candidatos.error instanceof Error ? candidatos.error.message : null
              }
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
              idPrefixo="impostos"
            />
          </>
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={Landmark}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : "Esta unidade não tem duas vigências para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : escopoAberto
                  ? "A comparação de impostos precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
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
            what="a comparação de impostos"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeImpostos resumo={(agregados ?? comparacao.data).resumo} />

            {aliquotasAlteradas > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(aliquotasAlteradas, 0)}{" "}
                {aliquotasAlteradas === 1
                  ? "alteração foi de alíquota declarada e ficou"
                  : "alterações foram de alíquotas declaradas e ficaram"}{" "}
                fora do impacto: uma taxa não é dinheiro, e somá-la a reais daria um número que
                não é de nada. Elas estão na tabela, marcadas com o sinal de por cento.
              </p>
            )}

            {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber((agregados ?? comparacao.data).resumo.impacto.foraDaSoma, 0)}{" "}
                {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora do impacto por serem do montante de ICMS, zerado nas 1.215 linhas do acervo
                — elas aparecem na tabela e no detalhe, nunca numa soma.
              </p>
            )}

            {/*
              A conferência vem em largura inteira, e logo abaixo dos indicadores,
              por ser a leitura própria desta tela — a única que nenhuma outra do
              produto faz. Espremê-la numa das colunas de gráfico a deixaria com
              cara de painel auxiliar, e ela é o oposto disso: é a pergunta do
              verbete desta rota.
            */}
            <ConferenciaDeAliquotas
              conferencias={totais.data?.conferencias ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <TotalPorVigencia
                totais={totaisDoRecorte}
                tributo="PIS_COFINS"
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <TotalPorVigencia
                totais={totaisDoRecorte}
                tributo="ICMS"
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={(agregados ?? comparacao.data).alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={(agregados ?? comparacao.data).distribuicaoPorEstado} />
            </div>

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
                  id="impostos-busca"
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
              {/*
                O filtro de tributo é o único desta tela que não existe nas outras
                três auditorias, e existe porque os dois tributos não somam entre
                si: ler a lista inteira ordenada por placa mistura ICMS e
                PIS/COFINS na mesma coluna de números.
              */}
              <Select
                value={filtros.tributo}
                onValueChange={(tributo) =>
                  setFiltros((f) => ({ ...f, tributo: tributo as FiltrosDeImpostos["tributo"] }))
                }
              >
                <SelectTrigger className="w-[11rem]" aria-label="Tributo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Os dois tributos</SelectItem>
                  <SelectItem value="PIS_COFINS">PIS/COFINS</SelectItem>
                  <SelectItem value="ICMS">ICMS</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[15rem]" aria-label="Variável de imposto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_IMPOSTOS, ...VARIAVEIS_DE_DETALHE_DE_IMPOSTOS].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="impostos-so-aliquotas"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="impostos-so-aliquotas"
                  checked={filtros.soAliquotas}
                  onCheckedChange={(soAliquotas) =>
                    setFiltros((f) => ({ ...f, soAliquotas }))
                  }
                />
                Só alíquotas declaradas
                {aliquotasAlteradas > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {formatNumber(aliquotasAlteradas, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="impostos-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="impostos-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar veículos sem alteração
              </label>

              <Button
                type="button"
                variant="outline"
                onClick={exportar}
                disabled={filtradas.length === 0}
                className="ml-auto gap-2"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>

            {filtradas.length === 0 ? (
              linhas.length === 0 ? (
                /*
                  Aqui a tela vazia não é uma tela vazia, e é a diferença mais
                  importante desta rubrica: o PIS/COFINS de aquisição não varia
                  entre vigências, então "nada mudou" é o resultado esperado — e a
                  conferência acima continua valendo, porque ela não olha o que
                  mudou, olha o que está declarado.
                */
                <EstadoVazio
                  icone={Landmark}
                  titulo="Nenhuma variável de imposto mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    (agregados ?? comparacao.data).resumo.veiculosComparados,
                    0,
                  )} veículos comparados. É o resultado esperado: o imposto da compra incide uma vez, sobre a nota, e não se move de uma quinzena para outra. A conferência da alíquota, acima, continua dizendo o que cada vigência declara.`}
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
                <TabelaDeImpostos
                  linhas={naPagina}
                  justificadaPor={justificar.justificadaPor}
                  onAbrir={(l) =>
                    setAberto({ entityLabel: l.entityLabel, entityType: l.entityType })
                  }
                  onJustificar={justificar.abrir}
                />
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={filtradas.length}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade="linhas"
                  unidadeSingular="linha"
                />
              </>
            )}

            <JustificarDialog {...justificar.propsDoDialogo} />

            <DetalheDoVeiculo
              veiculo={aberto}
              linhas={linhas as LinhaDeImpostos[]}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              onFechar={() => setAberto(null)}
            />
          </>
        )}
      </div>
    </Layout>
  );
}
