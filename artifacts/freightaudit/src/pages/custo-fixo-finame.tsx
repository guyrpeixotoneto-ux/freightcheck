import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Download, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { VARIAVEIS_DE_FINAME } from "@workspace/comparison/finame";
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
import { CartoesDeFiname } from "@/components/finame/cartoes";
import {
  AlteracoesPorVariavel,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/finame/graficos";
import { TabelaDeFiname } from "@/components/finame/tabela";
import { DetalheDoVeiculo } from "@/components/finame/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeFiname,
  type FiltrosDeFiname,
  type TotaisDeFiname,
} from "@/lib/finame";
import {
  parDePartida,
  rotulosDasVigencias,
  vigenciasDaUnidade,
} from "@workspace/comparison/recorte-de-rubrica";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE FINAME — o que mudou no financiamento entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * A pergunta desta tela, e a razão de ela abrir mostrando só o que mudou
 * ---------------------------------------------------------------------------
 * Quem a abre quer saber **o que se moveu** de uma planilha para a outra. O
 * acervo tem centenas de veículos e catorze variáveis de FINAME; listar as
 * ~4.000 linhas iguais ao lado das que mudaram esconderia o achado dentro da
 * massa. Por isso a tabela abre no recorte das alterações, e "Mostrar veículos
 * sem alteração" é um alternador desligado — quando ligado, o servidor lê as
 * duas vigências inteiras e devolve também as linhas iguais.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto e
 * agregados vêm de `@workspace/comparison/finame`, que o servidor importa do
 * mesmo jeito. O que a página faz é escolher o par, filtrar, paginar e exportar
 * — e mesmo o filtro é uma função só, compartilhada com a contagem das abas,
 * para que a aba nunca prometa doze linhas e a tabela mostre nove.
 *
 * **A comparação é sempre do motor.** `/finame/comparacao` reaproveita o change
 * set quando ele existe e manda calcular quando não existe: é o mesmo caminho
 * de Comparar vigências, de modo que as duas telas respondem o mesmo número
 * para o mesmo par. As recusas do motor — escopo diferente, cobertura diferente,
 * canal diferente — chegam com a frase dele.
 *
 * ---------------------------------------------------------------------------
 * E a tela é **de uma unidade por vez**
 * ---------------------------------------------------------------------------
 * `/snapshots` responde pela operação inteira, e dentro dela duas unidades
 * importadas do mesmo arquivo têm o mesmo rótulo e a mesma data: no seletor,
 * duas linhas idênticas. Enquanto esta tela não lia a unidade aberta, o par
 * padrão podia casar uma com a outra — o único par que o motor recusa por
 * construção — e a tela abria num aviso de erro sem ninguém ter escolhido nada.
 *
 * Agora ela lê a unidade aberta — `scopeHash` da URL quando há um, e o contexto
 * que a lateral nomeia quando não há (`contextoAberto`) —, recorta a lista por
 * ela e escolhe o par dentro do recorte (`vigenciasDaUnidade` e `parDePartida`,
 * em `lib/finame.ts`). Aberta CAMAÇARI, o seletor oferece Camaçari e nada mais.
 * É o que a põe em `TELAS_QUE_HONRAM_ESCOPO` (`lib/navegacao-do-escopo.ts`):
 * trocar de unidade na lateral troca o dado desta tela em vez de expulsar quem
 * trocou para Parâmetros. Uma unidade sem duas vigências abre **vazia, dizendo
 * isso** — que é a resposta certa, e não uma falha.
 */
export default function AuditoriaDeFiname() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeFiname>(FILTROS_VAZIOS);
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
   * Sem isto, trocar de unidade aqui não trocava o dado: trocava de tela.
   * `enderecoDe` (`lib/navegacao-do-escopo.ts`) desvia para Parâmetros toda tela
   * que não sabe ler o recorte, e esta não sabia — *"eu tento mudar de
   * PERNAMBUCO para CAMAÇARI e saio do módulo"*. Estar naquela lista é uma
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
   * o nome da unidade e a tela volta a listar o acervo: é degradação, não
   * quebra.
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
   * `recorte.scopeHash` sozinho não responde isto. Sem ele na URL — quem chega
   * por um link nu, ou pelo menu antes de escolher unidade —, a caixa "Unidade
   * atual" continua escrevendo uma unidade: ela cai no primeiro contexto
   * (`contextoAberto`). A tela, lendo só a URL, listava as cinco. É exatamente o
   * desencontro que o cabeçalho de `contextoAberto` descreve, e que custou o
   * mesmo defeito na Cobertura de dados: a lateral escrevendo PERNAMBUCO sobre
   * uma tela que mostrava o acervo inteiro.
   *
   * Com a mesma função dos dois lados, a resposta é uma só: se a lateral diz
   * CAMAÇARI, o seletor oferece as vigências de Camaçari e nada mais.
   */
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;

  /**
   * Recortar antes de saber qual é a unidade daria a lista errada por um
   * instante — e, pior, um par escolhido nela. Enquanto `/contexts` não
   * responde e a URL não traz unidade, não há lista: nem a de todas, nem a de
   * uma.
   */
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /** As vigências da unidade aberta — a lista que o seletor oferece. */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida ? vigenciasDaUnidade(vigencias.data ?? [], escopoAberto) : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  /**
   * O texto de cada opção do seletor, distinto por construção.
   *
   * O arquivo que a Ambev entrega traz as cinco unidades juntas, e uma
   * importação vira cinco vigências de mesmo rótulo e mesma data — medido no
   * `EMPURRADA_Cavalo.xlsx`: seis vigências × cinco unidades = trinta. O
   * seletor mostrava as cinco como a mesma frase, cinco vezes seguidas, e
   * escolher ali era adivinhar. `rotulosDasVigencias` acrescenta a unidade — e
   * só ela, e só onde desempata.
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
   * mantê-lo faria a tela responder por Pernambuco sob a palavra CAMAÇARI. Ao
   * abrir sem par nenhum, é `parDePartida` quem escolhe, com as duas recusas do
   * motor antecipadas (mesma cobertura, mesmo escopo).
   *
   * Sem par possível, as duas pontas ficam vazias e a consulta nem sai: uma
   * unidade com uma vigência só não tem comparação, e pedi-la ao servidor
   * traria a recusa dele para uma tela onde ninguém escolheu nada.
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
    queryKey: ["finame", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeFiname>(
        `/finame/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["finame", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () => fetchJson<TotaisDeFiname>(`/finame/totais?base=${base}&comparada=${comparada}`),
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

  const rotuloBase =
    vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "Vigência Base";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Vigência Comparada";

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas));
    salvarArquivo(
      blob,
      `finame-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de FINAME
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências
            </span>
          </span>
        }
        icone={Banknote}
        descricao="O que mudou no financiamento de cada veículo entre duas vigências: parcela, juros, amortização, taxa, prazo, carência, entrada e base de compra."
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
            idPrefixo="finame"
          />
        )}

        {/*
          A unidade sem par não é uma falha, e não deve chegar como uma: é a
          resposta certa para "o que mudou no FINAME de Camaçari?" quando
          Camaçari entregou uma vigência só. Antes desta tela recortar por
          unidade, o mesmo caso abria na recusa do motor — um aviso âmbar
          dizendo que a comparação falhou, sobre uma comparação que nunca
          existiu.
        */}
        {semParPossivel && (
          <EstadoVazio
            icone={Banknote}
            titulo="Esta unidade não tem duas vigências para comparar"
            descricao={
              escopoAberto
                ? "A comparação de FINAME precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
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
            what="a comparação de FINAME"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeFiname resumo={comparacao.data.resumo} />

            {comparacao.data.resumo.impacto.cobertasPorParcelas > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(comparacao.data.resumo.impacto.cobertasPorParcelas, 0)}{" "}
                {comparacao.data.resumo.impacto.cobertasPorParcelas === 1
                  ? "parcela saiu"
                  : "parcelas saíram"}{" "}
                do total por já estarem representadas nas partes — o mesmo dinheiro não é
                contado duas vezes.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <TotalPorVigencia
                totais={totais.data?.totais ?? []}
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
                      alterações — chamar 1.589 linhas iguais de "alterações"
                      seria o rótulo contradizendo a própria coluna Status. */}
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
                  id="finame-busca"
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

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[13rem]" aria-label="Variável de FINAME">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {VARIAVEIS_DE_FINAME.map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="finame-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="finame-sem-alteracao"
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
                  icone={Banknote}
                  titulo="Nenhuma variável de FINAME mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.veiculosComparados,
                    0,
                  )} veículos comparados, e o financiamento de todos eles chegou igual nas duas planilhas.`}
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao="O recorte atual não tem nenhuma alteração. Limpe os filtros para ver as demais."
                  acao={
                    <Button type="button" variant="outline" onClick={() => setFiltros(FILTROS_VAZIOS)}>
                      Limpar filtros
                    </Button>
                  }
                />
              )
            ) : (
              <>
                <TabelaDeFiname
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
              linhas={linhas as LinhaDeFiname[]}
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
