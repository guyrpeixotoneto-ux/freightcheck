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
  parDePartida,
  rotulosDasVigencias,
  vigenciasDaUnidade,
} from "@workspace/comparison/recorte-de-rubrica";
import { CartoesDeImpostos } from "@/components/impostos/cartoes";
import {
  AlteracoesPorVariavel,
  ConferenciaDeAliquotas,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/impostos/graficos";
import { TabelaDeImpostos } from "@/components/impostos/tabela";
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
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
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

  /** As vigências da unidade aberta — a lista que o seletor oferece. */
  const daUnidade = useMemo(
    () => (unidadeResolvida ? vigenciasDaUnidade(vigencias.data ?? [], escopoAberto) : []),
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  /**
   * O texto de cada opção do seletor, distinto por construção.
   *
   * Sem ele o seletor mostra a mesma frase cinco vezes seguidas — uma por
   * unidade —, e escolher ali é adivinhar. `rotulosDasVigencias` acrescenta só o
   * que desempata, e só onde desempata.
   */
  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidade, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidade, nomePorEscopo],
  );

  /**
   * O par aberto, mantido dentro da unidade aberta.
   *
   * Duas coisas num efeito só porque são a mesma: **o par tem de existir dentro
   * desta lista**. Ao trocar de unidade, o par anterior deixa de estar nela — e
   * mantê-lo faria a tela responder por Pernambuco sob a palavra CAMAÇARI.
   */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const naLista = (id: string) => daUnidade.some((v) => v.id === id);
    if (base && comparada && naLista(base) && naLista(comparada)) return;
    const par = parDePartida(daUnidade);
    setBase(par?.base.id ?? "");
    setComparada(par?.comparada.id ?? "");
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  /**
   * A unidade já respondeu e não tem duas vigências para comparar.
   *
   * Sai da lista, e não de "as duas pontas estão vazias": o par é escolhido num
   * efeito, que roda **depois** da renderização — ler o estado aqui piscaria a
   * tela vazia por um quadro em toda unidade que tem par.
   */
  const semParPossivel =
    Boolean(vigencias.data) && unidadeResolvida && parDePartida(daUnidade) === null;

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

  const rotuloBase = vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Para";

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas));
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
          <SeletorDoPar
            vigencias={daUnidade}
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
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={Landmark}
            titulo="Esta unidade não tem duas vigências para comparar"
            descricao={
              escopoAberto
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
            <CartoesDeImpostos resumo={comparacao.data.resumo} />

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

            {comparacao.data.resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(comparacao.data.resumo.impacto.foraDaSoma, 0)}{" "}
                {comparacao.data.resumo.impacto.foraDaSoma === 1
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
                totais={totais.data?.totais ?? []}
                tributo="PIS_COFINS"
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <TotalPorVigencia
                totais={totais.data?.totais ?? []}
                tributo="ICMS"
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={comparacao.data.alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={comparacao.data.distribuicaoPorEstado} />
            </div>

            <EvolucaoEntreVigencias
              totais={totais.data?.totais ?? []}
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

              <Select
                value={filtros.tipo}
                onValueChange={(tipo) => setFiltros((f) => ({ ...f, tipo }))}
              >
                <SelectTrigger className="w-[9.5rem]" aria-label="Tipo de equipamento">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os tipos</SelectItem>
                  <SelectItem value="CAVALO">Cavalo</SelectItem>
                  <SelectItem value="CARRETA">Carreta</SelectItem>
                </SelectContent>
              </Select>

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
                    comparacao.data.resumo.veiculosComparados,
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
                  onAbrir={(l) =>
                    setAberto({ entityLabel: l.entityLabel, entityType: l.entityType })
                  }
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
