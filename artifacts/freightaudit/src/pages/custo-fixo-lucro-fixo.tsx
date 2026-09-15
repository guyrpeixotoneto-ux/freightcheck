import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, SlidersHorizontal, TrendingUp } from "lucide-react";
import type { LinhaDeLucroFixo } from "@workspace/comparison/lucro-fixo";
import {
  viradasDeCiclo,
  VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO,
  VARIAVEIS_DE_LUCRO_FIXO,
} from "@workspace/comparison/lucro-fixo";
import {
  parDePartida,
  rotulosDasVigencias,
  TIPOS_DE_EQUIPAMENTO,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
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
import { CartoesDeLucroFixo } from "@/components/lucro-fixo/cartoes";
import {
  AlteracoesPorVariavel,
  Coexistencias,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
  ViradasDeCiclo,
} from "@/components/lucro-fixo/graficos";
import { TabelaDeLucroFixo } from "@/components/lucro-fixo/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoVeiculo } from "@/components/lucro-fixo/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeLucroFixo,
  type FiltrosDeLucroFixo,
  type TotaisDeLucroFixo,
} from "@/lib/lucro-fixo";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE LUCRO FIXO — o que mudou na remuneração entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * A pergunta desta tela, e a que ela continua não respondendo
 * ---------------------------------------------------------------------------
 * O verbete desta rota, enquanto ela era tela em preparo, pedia "o percentual
 * contratado sobre o qual ela é calculada". Ele continua não existindo no
 * acervo, e a tela não o inventa — sem ele, aqui se vê o que **mudou** no que se
 * paga, nunca se o valor é o devido.
 *
 * O que o acervo sustenta é outra pergunta, e o dado real a responde melhor do
 * que um percentual responderia: **quem virou o ciclo.** Lucro fixo e
 * amortização nunca coexistem — 558 linhas medidas, zero coexistências —, e o
 * ciclo diz qual dos dois está valendo. Quando um ativo termina de amortizar, a
 * remuneração fixa começa, e a linha da frota sobe sem que ninguém tenha
 * renegociado nada. Um recorte que só mostrasse o delta em reais chamaria isso
 * de aumento.
 *
 * **Esta é a primeira das três auditorias de rubrica que trata de receita.**
 * FINAME e IPVA são custo; o lucro fixo é `Receita bruta`, e a consequência
 * atravessa a tela: subir é verde, não vermelho. A amortização, que divide a
 * tabela com ele, continua sendo custo e mantém a régua antiga — por isso a cor
 * é decidida por variável, e não por tela (`lib/lucro-fixo.ts`).
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * viradas e coexistências vêm de `@workspace/comparison/lucro-fixo`, que o
 * servidor importa do mesmo jeito. A tela escolhe o par, filtra, pagina e
 * exporta.
 *
 * **A tela é de uma unidade por vez**, como as outras duas: uma importação
 * produz uma vigência por unidade, com o mesmo rótulo e a mesma data, e um par
 * escolhido sem olhar o escopo é o único que o motor recusa por construção.
 */
export default function AuditoriaDeLucroFixo() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeLucroFixo>(FILTROS_VAZIOS);
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

  /** A unidade aberta na lateral — sem ela, trocar de unidade trocaria de tela. */
  const recorte = lerRecorte(useSearch());

  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  /**
   * A unidade aberta — **a mesma que a lateral nomeia**, com ou sem `scopeHash`.
   *
   * `recorte.scopeHash` sozinho não responde isto: sem ele na URL a caixa
   * "Unidade atual" continua escrevendo uma unidade, porque cai no primeiro
   * contexto. Uma tela que lesse só a URL listaria as cinco sob o nome de uma.
   */
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;

  /** Recortar antes de saber a unidade daria a lista errada — e um par dentro dela. */
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

  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            /* A aba escolhe a série: Cavalo oferece quem tem cavalo — inclusive
               as vigências que trazem os dois —, Carreta idem, e "Cavalo +
               Carreta" o acervo de equipamento inteiro. Quem garante que as
               duas pontas do par continuam comparáveis dentro da aba é o
               seletor (`vigenciasCompativeisCom`): a cobertura da vigência
               ainda tem de bater exatamente, e uma série de cavalo puro não
               casa com uma de cavalo mais carreta. */
            recorteDeTipo === "TODOS" ? TIPOS_DE_EQUIPAMENTO : [recorteDeTipo],
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida, recorteDeTipo],
  );

  /**
   * Quais séries esta unidade tem — o que habilita cada aba.
   *
   * Sai da lista de vigências, e não da comparação: a aba precisa estar certa
   * antes de existir par escolhido. `daUnidade` não serve porque ele já está
   * recortado pela aba aberta — a pergunta aqui é sobre o acervo da unidade.
   */
  const disponiveis = useMemo(() => {
    const todas = vigenciasDaUnidade(vigencias.data ?? [], escopoAberto);
    return {
      TODOS: true,
      CAVALO: vigenciasQueCobrem(todas, ["CAVALO"]).length > 0,
      CARRETA: vigenciasQueCobrem(todas, ["CARRETA"]).length > 0,
    } as Record<RecorteDeTipo, boolean>;
  }, [vigencias.data, escopoAberto]);

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidade, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidade, nomePorEscopo],
  );

  /** O par aberto, mantido dentro da unidade aberta. */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const naLista = (id: string) => daUnidade.some((v) => v.id === id);
    if (base && comparada && naLista(base) && naLista(comparada)) return;
    const par = parDePartida(daUnidade);
    setBase(par?.base.id ?? "");
    setComparada(par?.comparada.id ?? "");
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  const semParPossivel =
    Boolean(vigencias.data) && unidadeResolvida && parDePartida(daUnidade) === null;

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * A pergunta, a chave e a cadência moram em `useCandidatosDoPar`, com as
   * outras duas auditorias: a pergunta é a mesma, e telas irmãs respondendo com
   * fôlegos diferentes seria diferença sem motivo. O que esta tela decide é só
   * o que é dela — a rubrica, o "Para" aberto e a unidade do recorte.
   */
  const candidatos = useCandidatosDoPar("lucro-fixo", comparada, escopoAberto);

  const comparacao = useQuery({
    queryKey: ["lucro-fixo", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeLucroFixo>(
        `/lucro-fixo/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["lucro-fixo", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeLucroFixo>(`/lucro-fixo/totais?base=${base}&comparada=${comparada}`),
  });

  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);

  /**
   * As viradas, calculadas uma vez e usadas em três lugares.
   *
   * O painel as mostra, o filtro "só quem virou o ciclo" as usa para recortar, e
   * a contagem das abas conta sobre o mesmo recorte. Três chamadas seriam três
   * listas que só por acidente concordariam.
   */
  const viradas = useMemo(() => viradasDeCiclo(linhas), [linhas]);


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

  const filtradas = useMemo(
    () => filtrar(linhas, filtros, viradas),
    [linhas, filtros, viradas],
  );
  const contagens = useMemo(
    () => contagemPorAba(linhas, { ...filtros, estado: "TODAS" }, viradas),
    [linhas, filtros, viradas],
  );
  const naPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  const rotuloBase = vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Para";

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
      `lucro-fixo-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(
        rotuloComparada,
      )}.csv`,
    );
  }

  const coexistencias = totais.data?.coexistencias ?? [];

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Lucro Fixo
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências
            </span>
          </span>
        }
        icone={TrendingUp}
        descricao="O que mudou na remuneração fixa de cada veículo entre duas vigências — e quem terminou de amortizar o financiamento e passou a recebê-la."
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
              idPrefixo="lucro-fixo"
            />
            <SeletorDoPar
              vigencias={daUnidade}
              rotulos={rotulos}
              base={base}
              comparada={comparada}
              onBase={setBase}
              onComparada={setComparada}
              onInverter={() => {
                setBase(comparada);
                setComparada(base);
              }}
              carregando={comparacao.isFetching}
              idPrefixo="lucro-fixo"
              candidatos={candidatos.data}
              carregandoCandidatos={candidatos.isFetching}
              erroDosCandidatos={
                candidatos.error instanceof Error ? candidatos.error.message : null
              }
            />
          </>
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={TrendingUp}
            titulo="Esta unidade não tem duas vigências para comparar"
            descricao={
              escopoAberto
                ? "A comparação de lucro fixo precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
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
            what="a comparação de lucro fixo"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeLucroFixo
              resumo={(agregados ?? comparacao.data).resumo}
              coexistencias={coexistencias.length}
            />

            {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber((agregados ?? comparacao.data).resumo.impacto.foraDaSoma, 0)}{" "}
                {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora do impacto por serem da coluna do conjunto, que embute a parcela do cavalo
                vinculado — elas aparecem na tabela e no detalhe, nunca numa soma.
              </p>
            )}

            {/*
              A virada de ciclo vem logo abaixo dos indicadores, em largura
              inteira, por ser a leitura própria desta tela: é ela que distingue
              uma linha que subiu porque a frota envelheceu de uma que subiu
              porque alguém renegociou. Espremê-la entre os gráficos a deixaria
              com cara de painel auxiliar.
            */}
            <ViradasDeCiclo
              viradas={viradas}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <Coexistencias
              coexistencias={coexistencias}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <TotalPorVigencia
                totais={totaisDoRecorte}
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
                  id="lucro-fixo-busca"
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
                <SelectTrigger className="w-[15rem]" aria-label="Variável de lucro fixo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_LUCRO_FIXO, ...VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/*
                O filtro próprio desta tela. Ele recorta por **veículo**, não por
                linha: quem pede as viradas quer as quatro linhas daquele ativo —
                o ciclo, o lucro fixo que entrou, a amortização que saiu e o ano
                —, não só a linha do ciclo, que sozinha não explica nada.
              */}
              <label
                htmlFor="lucro-fixo-so-viradas"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="lucro-fixo-so-viradas"
                  checked={filtros.soViradas}
                  onCheckedChange={(soViradas) => setFiltros((f) => ({ ...f, soViradas }))}
                />
                Só quem virou o ciclo
                {viradas.length > 0 && (
                  <span className="rounded-full bg-success/12 px-2 py-0.5 font-mono text-xs font-bold text-success">
                    {formatNumber(viradas.length, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="lucro-fixo-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="lucro-fixo-sem-alteracao"
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
                <EstadoVazio
                  icone={TrendingUp}
                  titulo="Nenhuma variável de lucro fixo mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    (agregados ?? comparacao.data).resumo.veiculosComparados,
                    0,
                  )} veículos comparados, e a remuneração fixa de todos eles chegou igual nas duas planilhas.`}
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
                <TabelaDeLucroFixo
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
              linhas={linhas as LinhaDeLucroFixo[]}
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
