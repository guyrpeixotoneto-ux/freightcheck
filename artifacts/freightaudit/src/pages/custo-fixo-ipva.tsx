import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Receipt, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import {
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
  parDePartida,
  rotulosDasVigencias,
  TIPOS_DE_EQUIPAMENTO,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
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
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoVeiculo } from "@/components/ipva/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { type CandidatosDoPar } from "@/lib/candidatos";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeIpva,
  type FiltrosDeIpva,
  type TotaisDeIpva,
} from "@/lib/ipva";
import { lerRecorte } from "@/lib/recorte";
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
export default function AuditoriaDeIpva() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
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
  const daUnidade = useMemo(
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
   * mantê-lo faria a tela responder por Pernambuco sob a palavra CAMAÇARI. Ao
   * abrir sem par nenhum, é `parDePartida` quem escolhe, com as duas recusas do
   * motor antecipadas: mesma cobertura e mesmo escopo.
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

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * Três decisões, e nenhuma é de estilo — são as mesmas da Auditoria de
   * FINAME, e é de propósito que sejam: a pergunta é a mesma, e duas telas
   * irmãs respondendo com cadências diferentes seria diferença sem motivo.
   *
   * **Só quando o menu abre.** Calcular comparações para quem nunca abriu o
   * seletor seria cobrar do banco por uma pergunta que ninguém fez. E a
   * abertura não espera a resposta: o menu aparece inteiro na hora, os números
   * entram depois.
   *
   * **A chave carrega o Para e a unidade.** Trocar qualquer um dos dois é
   * pergunta nova, então é chave nova — não há invalidação manual a esquecer.
   *
   * **Os pendentes voltam.** O servidor calcula o que couber no orçamento dele
   * e diz quantas ficaram de fora; pergunta-se de novo enquanto a fila andar, e
   * a chamada seguinte continua de onde a anterior parou, porque o que foi
   * calculado ficou gravado. Uma fila que não anda encerra a pergunta.
   */
  const [menuDeAberto, setMenuDeAberto] = useState(false);
  /** Quantas ficaram pendentes na resposta anterior — a régua do progresso. */
  const pendentesAnteriores = useRef<number | null>(null);
  const candidatos = useQuery({
    queryKey: ["ipva", "candidatos", escopoAberto, comparada],
    enabled: menuDeAberto && Boolean(comparada),
    staleTime: 5 * 60_000,
    queryFn: () => fetchJson<CandidatosDoPar>(`/ipva/candidatos?para=${comparada}`),
    refetchInterval: (query) => {
      const dados = query.state.data;
      if (!dados || dados.pendentes === 0) {
        pendentesAnteriores.current = null;
        return false;
      }
      const anterior = pendentesAnteriores.current;
      pendentesAnteriores.current = dados.pendentes;
      if (anterior === null) return 1_500;
      return dados.pendentes < anterior ? 1_500 : false;
    },
  });

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
              Comparação entre vigências
            </span>
          </span>
        }
        icone={Receipt}
        descricao="O que mudou no IPVA e no licenciamento de cada veículo entre duas vigências — e qual alíquota do valor de nota cada vigência está aplicando."
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
            idPrefixo="ipva"
            candidatos={candidatos.data}
            carregandoCandidatos={candidatos.isFetching}
            onAbrirDe={setMenuDeAberto}
            erroDosCandidatos={
              candidatos.error instanceof Error ? candidatos.error.message : null
            }
          />
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={Receipt}
            titulo="Esta unidade não tem duas vigências para comparar"
            descricao={
              escopoAberto
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
            <CartoesDeIpva resumo={comparacao.data.resumo} />

            {comparacao.data.resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(comparacao.data.resumo.impacto.foraDaSoma, 0)}{" "}
                {comparacao.data.resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora do impacto por serem da coluna “mensal” da carreta, que não é 1/12 da
                anual — elas aparecem na tabela e no detalhe, nunca numa soma.
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
                  id="ipva-busca"
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
                  icone={Receipt}
                  titulo="Nenhuma variável de IPVA mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.veiculosComparados,
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
              linhas={linhas as LinhaDeIpva[]}
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
