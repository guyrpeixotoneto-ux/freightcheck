import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Key, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeAluguel } from "@workspace/comparison/aluguel";
import {
  agruparPorVeiculoDeAluguel,
  VARIAVEIS_DE_ALUGUEL,
  VARIAVEIS_DE_DETALHE_DE_ALUGUEL,
} from "@workspace/comparison/aluguel";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
  TIPOS_DE_EQUIPAMENTO,
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
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { CartoesDeAluguel } from "@/components/aluguel/cartoes";
import {
  AlteracoesPorVariavel,
  AluguelPorVigencia,
  ConferenciaDaParcela,
  DistribuicaoPorEstado,
} from "@/components/aluguel/graficos";
import { TabelaDeAluguel } from "@/components/aluguel/tabela";
import { DetalheDoVeiculo } from "@/components/aluguel/detalhe";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeAluguel,
  type FiltrosDeAluguel,
  type TotaisDeAluguel,
} from "@/lib/aluguel";
import { lerRecorte } from "@/lib/recorte";
import { PainelDaEvolucao } from "@/components/comparacao/evolucao/painel";
import { EVOLUCAO_DO_ALUGUEL } from "@/components/aluguel/evolucao";
import {
  ehModoDaAuditoria,
  ehRecorteDeTipo,
  trocaNaRota,
  type ModoDaAuditoria,
} from "@/lib/modo-da-auditoria";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE ALUGUEL DE FROTA — o implemento que se aluga em vez de financiar.
 *
 * ---------------------------------------------------------------------------
 * A frase que desenha esta tela
 * ---------------------------------------------------------------------------
 * É da curadoria, na entrada que confirmou a coluna: o aluguel *"fica na classe
 * do financiamento porque é o que ocupa o lugar dele"*. Nos implementos
 * alugados, amortização e juros são zero e a parcela FINAME **é** o aluguel —
 * `docs/ACHADO-ALUGUEL.md` mede a identidade em 1.314 de 1.314 linhas do acervo.
 *
 * Por isso esta tela fica ao lado do FINAME no menu, e por isso a parcela dele
 * aparece na tabela daqui: ela é o que **confere** o aluguel.
 *
 * ---------------------------------------------------------------------------
 * As três coisas que a fazem diferente das irmãs
 * ---------------------------------------------------------------------------
 * 1. **A frota alugada é uma minoria**, e o filtro "só os alugados" é o que
 *    torna a lista legível. Ele é da placa, e não da linha: as linhas de parcela
 *    de um implemento alugado sobrevivem ao filtro, ou a conferência que a tela
 *    existe para mostrar desapareceria justamente quando alguém a liga.
 * 2. **A cor é invertida.** Nas quatro rubricas de remuneração do Custo Fixo,
 *    subir é verde — é o que a operação recebe. O aluguel é o que ela paga: aqui
 *    subir é vermelho.
 * 3. **O total é mensal**, confirmado, e não se soma ao IPVA anual nem à nota
 *    pontual. O rótulo do painel diz isso onde o número aparece.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * total mensal e a conferência da parcela vêm de `@workspace/comparison/aluguel`,
 * que o servidor importa do mesmo jeito.
 */
/**
 * A rota desta auditoria — uma só, para os dois modos.
 *
 * `trocarNoEndereco` preserva tudo que não foi pedido: entrar na Evolução e
 * voltar devolve a comparação exatamente como estava — mesma unidade, mesmo
 * canal, mesmo par de vigências, mesmo recorte de equipamento.
 */
const ROTA = "/custo-fixo-aluguel";
const trocarNoEndereco = trocaNaRota(ROTA);

export default function AuditoriaDeAluguel() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeAluguel>(FILTROS_VAZIOS);
  /*
    Ligado por padrão, como na Auditoria de Aquisição e pelo mesmo motivo
    invertido: lá porque nada muda; aqui porque quase nada muda **nesta
    minoria**. Um par em que nenhum contrato foi renegociado ainda tem
    implementos alugados para mostrar, e uma tela que abrisse vazia esconderia a
    frota que ela existe para vigiar.
  */
  const [comSemAlteracao, setComSemAlteracao] = useState(true);
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

  /** A unidade aberta na lateral — sem isto, trocar de unidade trocaria de tela. */
  const busca = useSearch();
  const recorte = lerRecorte(busca);

  /**
   * O modo aberto, e o recorte **da evolução** — duas chaves próprias no mesmo
   * endereço.
   *
   * São chaves separadas de `filtros.tipo` de propósito, e é isso que faz a ida
   * e volta não custar nada: entrar na Evolução não toca no recorte da
   * comparação, que continua no estado e volta como estava ao sair. Unidade,
   * canal, `scopeHash` e o par de vigências nem são mencionados aqui.
   *
   * Valor adulterado cai no padrão em vez de quebrar: `comparacao` para o modo,
   * que é a tela que sempre existiu, e `TODOS` para o recorte da evolução.
   */
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

  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /** A série aberta — cavalo, carreta, ou as duas. É ela que recorta a lista. */
  const recorteDeTipo = (filtros.tipo === "TODOS" ? "TODOS" : filtros.tipo) as RecorteDeTipo;

  /** As vigências de equipamento da unidade — **antes** da aba. */
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
   * Sai de `daUnidadeTodas` (o acervo da unidade, antes da aba): quais anos
   * existem é pergunta sobre a unidade, e não sobre o recorte aberto. Recortada
   * pela aba, a lista de anos mudaria ao trocar de equipamento.
   */
  const datasDaUnidade = useMemo(
    () => [...new Set(daUnidadeTodas.map((v) => v.effectiveDate))],
    [daUnidadeTodas],
  );

  /** A lista que o seletor do par oferece — a da aba aberta. */
  const daUnidade = useMemo(
    () =>
      recorteDeTipo === "TODOS"
        ? daUnidadeTodas
        : vigenciasQueCobrem(daUnidadeTodas, [recorteDeTipo]),
    [daUnidadeTodas, recorteDeTipo],
  );

  /** Quais séries esta unidade tem — o que habilita cada aba. */
  const disponiveis = useMemo(
    () =>
      ({
        TODOS: true,
        CAVALO: vigenciasQueCobrem(daUnidadeTodas, ["CAVALO"]).length > 0,
        CARRETA: vigenciasQueCobrem(daUnidadeTodas, ["CARRETA"]).length > 0,
      }) as Record<RecorteDeTipo, boolean>,
    [daUnidadeTodas],
  );

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidadeTodas, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidadeTodas, nomePorEscopo],
  );

  /** Os números de cada candidata a "De", contra o "Para" aberto. */
  const candidatos = useCandidatosDoPar("aluguel", comparada, escopoAberto);

  /** O par aberto, mantido dentro da lista que o seletor oferece — e só ele. */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const par = parReconciliado(daUnidade, { base, comparada });
    if (par.base !== base) setBase(par.base);
    if (par.comparada !== comparada) setComparada(par.comparada);
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  const semPar =
    Boolean(vigencias.data) && unidadeResolvida ? motivoSemPar(daUnidade) : null;
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  const semParPossivel = semPar !== null && !(base && comparada);

  const comparacao = useQuery({
    queryKey: ["aluguel", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeAluguel>(
        `/aluguel/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["aluguel", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeAluguel>(`/aluguel/totais?base=${base}&comparada=${comparada}`),
  });

  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);

  /** Os agregados do recorte aberto — calculados no servidor, nunca aqui. */
  const agregados =
    recorteDeTipo === "TODOS" ? comparacao.data : comparacao.data?.porTipo?.[recorteDeTipo];

  /** As séries do recorte aberto — já vêm por tipo. */
  const totaisDoRecorte = useMemo(() => {
    const todos = totais.data?.totais ?? [];
    return recorteDeTipo === "TODOS"
      ? todos
      : todos.filter((t) => t.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);

  const conferenciasDoRecorte = useMemo(() => {
    const todas = totais.data?.conferencias ?? [];
    return recorteDeTipo === "TODOS"
      ? todas
      : todas.filter((c) => c.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);

  const contagens = useMemo(
    () => contagemPorAba(linhas, { ...filtros, estado: "TODAS" }),
    [linhas, filtros],
  );

  /**
   * As placas — o que a tabela lista.
   *
   * **Agrupa depois de filtrar, e não antes.** As abas, a busca e os seletores
   * continuam sendo sobre a linha, e a placa entra na lista quando sobra alguma
   * linha dela no recorte.
   */
  const veiculos = useMemo(() => agruparPorVeiculoDeAluguel(filtradas), [filtradas]);
  const naPagina = useMemo(
    () => veiculos.slice((pagina - 1) * porPagina, pagina * porPagina),
    [veiculos, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  const rotuloBase =
    rotulos.get(base) ?? vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    rotulos.get(comparada) ??
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ??
    "Para";

  const justificar = useJustificarNaTabela(
    comparacao.data?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada}`,
  );

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificar.justificadaPor));
    salvarArquivo(
      blob,
      `aluguel-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  /** Quantos implementos alugados o recorte aberto tem, na ponta comparada. */
  const alugadosNaComparada = totaisDoRecorte
    .filter((t) => t.ponta === "COMPARADA")
    .reduce((acc, t) => acc + t.alugados, 0);

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Aluguel de Frota
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              {modo === "evolucao" ? "Evolução anual" : "Comparação entre vigências · por ativo"}
            </span>
          </span>
        }
        icone={Key}
        descricao={
          modo === "evolucao"
            ? "Como o aluguel de cada implemento se moveu ao longo do ano, uma coluna por vigência — com o impacto dos movimentos e a variação ponta a ponta lidos separadamente."
            : "O implemento que a frota aluga em vez de financiar: quanto custa por mês, em quais placas, e se a parcela FINAME desses ativos é exatamente o aluguel."
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
              idPrefixo="aluguel"
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
              motivoDoVazio={{
                TODOS: "",
                CAVALO:
                  "Nenhuma vigência desta unidade tem cavalo. E, mesmo onde há, o aluguel de cavalo é zero em todas as linhas do acervo — a coluna existe e aparece no detalhe.",
                CARRETA:
                  "Nenhuma vigência desta unidade tem carreta. O aluguel de implemento é a rubrica desta tela, então sem carreta ela não tem o que auditar.",
              }}
            />
            {modo === "evolucao" && (
              <PainelDaEvolucao
                rubrica={EVOLUCAO_DO_ALUGUEL}
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
              idPrefixo="aluguel"
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
            icone={Key}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : "Esta unidade não tem duas vigências de equipamento para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : "A auditoria de aluguel precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
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
            what="a comparação de aluguel"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeAluguel resumo={(agregados ?? comparacao.data).resumo} />

            {totais.error && (
              <ApiErrorNotice
                error={totais.error}
                what="o total de aluguel"
                onTentarDeNovo={() => void totais.refetch()}
                tentando={totais.isFetching}
              />
            )}

            {/*
              A conferência vem em largura inteira, e antes dos gráficos da
              comparação, por ser a leitura própria desta tela — a única que
              nenhuma outra do produto faz. Espremê-la numa coluna de gráfico a
              deixaria com cara de painel auxiliar, e ela é o painel principal.
            */}
            <ConferenciaDaParcela
              conferencias={conferenciasDoRecorte}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <AluguelPorVigencia
                totais={totaisDoRecorte}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel
                dados={(agregados ?? comparacao.data).alteracoesPorVariavel}
              />
              <DistribuicaoPorEstado
                dados={(agregados ?? comparacao.data).distribuicaoPorEstado}
              />
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
                      alterações — e nesta tela ele nasce ligado, então chamar as
                      linhas iguais de "alterações" seria o rótulo contradizendo
                      a coluna Status já na primeira renderização. */}
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
                  id="aluguel-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar placa ou variável…"
                  aria-label="Buscar placa ou variável"
                  className="pl-9"
                />
              </div>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[16rem]" aria-label="Variável de aluguel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_ALUGUEL, ...VARIAVEIS_DE_DETALHE_DE_ALUGUEL].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/*
                O filtro que esta tela não pode não ter: a frota alugada é uma
                minoria dentro da frota lida, e sem ele a lista mistura as placas
                que interessam com as dezenas que só têm a parcela do
                financiamento delas.
              */}
              <label
                htmlFor="aluguel-so-alugados"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="aluguel-so-alugados"
                  checked={filtros.soAlugados}
                  onCheckedChange={(soAlugados) => setFiltros((f) => ({ ...f, soAlugados }))}
                />
                Só os alugados
                {alugadosNaComparada > 0 && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                    {formatNumber(alugadosNaComparada, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="aluguel-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="aluguel-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar ativos sem alteração
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

            {veiculos.length === 0 ? (
              linhas.length === 0 ? (
                <EstadoVazio
                  icone={Key}
                  titulo="Nenhuma coluna de aluguel mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    (agregados ?? comparacao.data).resumo.veiculosComparados,
                    0,
                  )} ativos comparados, e nenhum contrato de locação mudou de valor. Ligue "Mostrar ativos sem alteração" para ver quais implementos são alugados e quanto custam hoje.`}
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao={
                    filtros.soAlugados
                      ? "Nenhuma placa deste recorte declara aluguel — esta unidade financia ou possui a frota inteira. O filtro “Só os alugados” abre ligado; desligue-o para ver todas as placas e as parcelas de financiamento delas."
                      : "O recorte atual não tem nenhuma linha. Limpe os filtros para ver as demais."
                  }
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
                <TabelaDeAluguel
                  veiculos={naPagina}
                  justificadaPor={justificar.justificadaPor}
                  onAbrir={(v) => setAberto(v)}
                  onJustificar={justificar.abrir}
                />
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={veiculos.length}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade="ativos"
                  unidadeSingular="ativo"
                />
              </>
            )}

            <JustificarDialog {...justificar.propsDoDialogo} />

            <DetalheDoVeiculo
              veiculo={aberto}
              linhas={linhas as LinhaDeAluguel[]}
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
