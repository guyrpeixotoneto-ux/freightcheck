import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Route, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeKm } from "@workspace/comparison/km-rodado";
import {
  TIPO_DO_KM_RODADO,
  VARIAVEIS_DE_DETALHE_DE_KM,
  VARIAVEIS_DE_KM,
} from "@workspace/comparison/km-rodado";
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
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { CartoesDeKm } from "@/components/km-rodado/cartoes";
import {
  AlteracoesPorVariavel,
  ComposicaoDoPreco,
  ConferenciaDoKm,
  DistribuicaoPorEstado,
  PrecoPorKm,
} from "@/components/km-rodado/graficos";
import { TabelaDeKm } from "@/components/km-rodado/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoTrecho } from "@/components/km-rodado/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeKm,
  type FiltrosDeKm,
  type TotaisDeKm,
} from "@/lib/km-rodado";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE KM RODADO — o quilômetro contratado de cada trecho.
 *
 * ---------------------------------------------------------------------------
 * A primeira tela de custo variável, e o que muda por isso
 * ---------------------------------------------------------------------------
 * As quatro auditorias de rubrica anteriores são por **placa**: o FINAME, o
 * IPVA, o lucro fixo e os impostos são de um ativo. Esta é por **trecho** — a
 * linha da tabela de frete, identificada pela chave do percurso. Custo variável
 * é provocado por rodar, e o que roda é um percurso, não um cavalo parado no
 * pátio.
 *
 * Isso muda duas coisas na tela e nenhuma no motor: o seletor só oferece
 * vigências que **cobrem trecho** (no acervo, o arquivo de equipamento e o de
 * trecho chegam em vigências separadas, com `entity_type_set` diferente), e a
 * unidade de cada linha deixa de ser sempre reais — numa mesma coluna convivem
 * R$/km, quilômetros e viagens previstas.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela responde, e o que ela recusa responder
 * ---------------------------------------------------------------------------
 * O verbete desta rota pedia **quantos quilômetros cada ativo rodou na
 * vigência**. Esse dado não existe no acervo e não passa a existir porque a tela
 * foi escrita: o que chega é a tabela de preço por trecho, não o apontamento de
 * viagens. A tela diz isso no cartão de impacto, no rodapé da conferência e na
 * gaveta de cada trecho — e não multiplica R$/km por uma quilometragem que
 * ninguém importou.
 *
 * O que ela responde é **quanto custa o quilômetro contratado**, e mais duas
 * contas que só o grão trecho permite fazer, ambas publicadas no dicionário da
 * tabela de frete e nunca conferidas até aqui: ida mais volta tem de dar o km do
 * ciclo, e o R$/viagem dividido pelo R$/km tem de devolver esse mesmo km. A
 * segunda enxerga um preço montado sobre outra distância — coisa que o delta de
 * uma coluna sozinha nunca mostra.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * preço por km e as duas conferências vêm de `@workspace/comparison/km-rodado`,
 * que o servidor importa do mesmo jeito.
 */
export default function AuditoriaDeKmRodado() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeKm>(FILTROS_VAZIOS);
  const [comSemAlteracao, setComSemAlteracao] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberto, setAberto] = useState<{ entityLabel: string | null } | null>(null);

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

  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  /** A unidade aberta — a mesma que a lateral nomeia, com ou sem `scopeHash`. */
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;

  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * As vigências que o seletor oferece: as da unidade aberta **que cobrem
   * trecho**.
   *
   * O segundo filtro é o que distingue esta tela das quatro de custo fixo, e ele
   * não é refinamento: no acervo, a mesma unidade entrega o arquivo de
   * equipamento e o de trecho em vigências separadas. Sem ele, o par de partida
   * cai na vigência de cavalo mais recente e a tela abre com zero linhas —
   * correta e inexplicável.
   */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPO_DO_KM_RODADO,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidade, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidade, nomePorEscopo],
  );

  /**
   * O par aberto, mantido dentro da lista que o seletor oferece.
   *
   * Ao trocar de unidade, o par anterior deixa de estar nela — e mantê-lo faria a
   * tela responder por Pernambuco sob a palavra CAMAÇARI.
   */
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
  /** Nenhuma vigência de trecho na unidade — outra frase, outra causa. */
  const semTrechoNaUnidade = semParPossivel && daUnidade.length === 0;

  const comparacao = useQuery({
    queryKey: ["km-rodado", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeKm>(
        `/km-rodado/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["km-rodado", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeKm>(`/km-rodado/totais?base=${base}&comparada=${comparada}`),
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
      `km-rodado-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  const razoes = comparacao.data?.resumo.impacto.razoesAlteradas ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Km Rodado
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências · por trecho
            </span>
          </span>
        }
        icone={Route}
        descricao="Quanto custa o quilômetro contratado de cada trecho entre duas vigências — e se o preço de cada um foi montado sobre a distância que ele declara."
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
            idPrefixo="km-rodado"
          />
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={Route}
            titulo={
              semTrechoNaUnidade
                ? "Esta unidade não tem vigência de trecho importada"
                : "Esta unidade não tem duas vigências de trecho para comparar"
            }
            descricao={
              semTrechoNaUnidade
                ? "O custo variável é por trecho, e a tabela de frete desta unidade ainda não chegou ao acervo. As vigências de cavalo e carreta que ela tem alimentam as telas de custo fixo, não esta."
                : "A comparação de km rodado precisa de duas vigências de trecho da mesma unidade. Escolha outra unidade na lateral ou importe a tabela de frete seguinte."
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
            what="a comparação de km rodado"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeKm resumo={comparacao.data.resumo} />

            {comparacao.data.resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(comparacao.data.resumo.impacto.foraDaSoma, 0)}{" "}
                {comparacao.data.resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora de toda soma por serem de R$/viagem — que é o R$/km do mesmo componente
                multiplicado pelo km do ciclo. Somar as duas formas conta o mesmo dinheiro duas
                vezes; elas aparecem no detalhe, onde servem para conferir o km.
              </p>
            )}

            {/*
              A conferência vem em largura inteira, e logo abaixo dos indicadores,
              por ser a leitura própria desta tela — a única que nenhuma outra do
              produto faz. Espremê-la numa das colunas de gráfico a deixaria com
              cara de painel auxiliar.
            */}
            <ConferenciaDoKm
              conferencias={totais.data?.conferencias ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <PrecoPorKm
                preco={totais.data?.preco ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <ComposicaoDoPreco
                composicao={totais.data?.composicao ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={comparacao.data.alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={comparacao.data.distribuicaoPorEstado} />
            </div>

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
                  id="km-rodado-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar trecho ou variável…"
                  aria-label="Buscar trecho ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O filtro de unidade é o que a tela por placa não precisava ter:
                aqui a mesma coluna de valores mistura R$/km, quilômetros e
                viagens, e ler uma delas de cada vez é o que torna a tabela
                comparável linha a linha.
              */}
              <Select
                value={filtros.papel}
                onValueChange={(papel) =>
                  setFiltros((f) => ({ ...f, papel: papel as FiltrosDeKm["papel"] }))
                }
              >
                <SelectTrigger className="w-[12rem]" aria-label="Unidade da variável">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todas as unidades</SelectItem>
                  <SelectItem value="RAZAO">R$/km</SelectItem>
                  <SelectItem value="DISTANCIA">Quilômetros</SelectItem>
                  <SelectItem value="POR_VIAGEM">R$/viagem</SelectItem>
                  <SelectItem value="VOLUME">Viagens previstas</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[16rem]" aria-label="Variável de km rodado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_KM, ...VARIAVEIS_DE_DETALHE_DE_KM].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="km-rodado-so-preco"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="km-rodado-so-preco"
                  checked={filtros.soPrecoPorKm}
                  onCheckedChange={(soPrecoPorKm) =>
                    setFiltros((f) => ({ ...f, soPrecoPorKm }))
                  }
                />
                Só o preço por km
                {razoes > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {formatNumber(razoes, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="km-rodado-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="km-rodado-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar trechos sem alteração
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
                  icone={Route}
                  titulo="Nenhuma variável de km rodado mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.trechosComparados,
                    0,
                  )} trechos comparados, e o preço do quilômetro de todos eles chegou igual nas duas tabelas. A conferência do km, acima, continua valendo — ela não olha o que mudou, olha se cada trecho fecha as próprias contas.`}
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
                <TabelaDeKm
                  linhas={naPagina}
                  justificadaPor={justificar.justificadaPor}
                  onAbrir={(l) => setAberto({ entityLabel: l.entityLabel })}
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

            <DetalheDoTrecho
              trecho={aberto}
              linhas={linhas as LinhaDeKm[]}
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
