import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Briefcase,
  Download,
  Info,
  Search,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { TIPO_DO_QUADRO, ROTULO_DO_QUADRO } from "@workspace/comparison/qlp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiErrorNotice } from "@/components/api-error";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { TabelaDaComparacaoDeQlp } from "@/components/qlp-comparacao/tabela";
import { DetalheDoCargo } from "@/components/qlp-comparacao/detalhe";
import {
  AlteracoesPorVariavel,
  DistribuicaoPorEstado,
} from "@/components/qlp-comparacao/graficos";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorEstado,
  escreverRubrica,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeQlp,
  type FiltrosDeComparacaoDeQlp,
  type QuadroDeQlp,
} from "@/lib/qlp-comparacao";

/**
 * A COMPARAÇÃO DE UM QUADRO DE QLP — o recorte de rubrica, por cargo.
 *
 * ---------------------------------------------------------------------------
 * Um componente, e não duas telas
 * ---------------------------------------------------------------------------
 * A mesma decisão da auditoria do quadro, pelo mesmo motivo: o administrativo e
 * o operacional têm colunas e grãos diferentes, e a **forma da pergunta** é
 * idêntica — o que mudou neste cargo entre estas duas quinzenas. Duas telas
 * escritas separadamente seriam duas chances de a mesma leitura ser apresentada
 * de dois jeitos, e a primeira a divergir seria a do quadro que ninguém abre.
 *
 * ---------------------------------------------------------------------------
 * O que ela substituiu, e por quê
 * ---------------------------------------------------------------------------
 * A aba de Alterações mostrava o diff genérico do motor: uma linha por atributo
 * alterado, a mesma lista de Comparar Vigências. Ela responde "o que mudou" e
 * não responde **de quem**: num quadro de 41 cargos, cinquenta alterações
 * soltas não dizem qual cargo perdeu efetivo. A comparação é a mesma — mesmo
 * `change_set`, mesmo motor —, e o que muda é o grão da leitura.
 *
 * ---------------------------------------------------------------------------
 * Por que não há cartão de impacto em reais
 * ---------------------------------------------------------------------------
 * Porque as colunas do QLP chegam sem semântica confirmada, e somar o que a
 * curadoria não confirmou seria adivinhação — é o mesmo portão da aba do
 * Quadro. No lugar dele a tela escreve o motivo, e soma o que pode: o efetivo,
 * que é de gente.
 */
export function ComparacaoDoQuadro({
  quadro,
  /** Os parâmetros de contexto da tela — unidade, canal, operação. */
  query,
}: {
  quadro: QuadroDeQlp;
  query: URLSearchParams;
}) {
  /*
    O par que o endereço traz, quando traz.

    É o que faz um link para esta comparação abrir no mesmo par que quem o
    mandou estava vendo — a mesma decisão das seis auditorias de rubrica
    (`parDaUrl`, em `lib/par-de-vigencias.ts`). Sem os parâmetros, as duas
    pontas nascem vazias e o par de partida entra pelo efeito abaixo.
  */
  const [par, setPar] = useState(() => ({
    base: query.get("base") ?? "",
    comparada: query.get("comparada") ?? "",
  }));
  const [filtros, setFiltros] = useState<FiltrosDeComparacaoDeQlp>(FILTROS_VAZIOS);
  const [rubrica, setRubrica] = useState("TODAS");
  const [comSemAlteracao, setComSemAlteracao] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [cargoAberto, setCargoAberto] = useState<string | null>(null);

  /*
    A família é pedida ao servidor, e não recortada depois: `/snapshots` responde
    pela de equipamento quando ninguém pede outra, e é o que fazia uma quinzena
    de cargos entrar na leitura de placas. A constante é escrita à mão porque
    `@workspace/ingest` carrega o pipeline inteiro, que não tem por que ir para
    o bundle do navegador — a mesma escolha que a aba anterior já fazia.
  */
  const { data: snapshots = [], error: erroDasVigencias } = useQuery({
    queryKey: ["snapshots", "QUADRO_DE_PESSOAL"],
    queryFn: () =>
      fetchJson<VigenciaEscolhivel[]>("/snapshots?datasetFamily=QUADRO_DE_PESSOAL"),
  });

  /*
    Só as vigências que cobrem **este** quadro entram no seletor.

    O administrativo e o operacional são a mesma família e formam séries
    próprias: o motor recusa um par entre coberturas diferentes (`engine.ts`), e
    um seletor que as oferecesse juntas produziria essa recusa depois do clique.
  */
  const doQuadro = useMemo(
    () => vigenciasQueCobrem(snapshots, TIPO_DO_QUADRO[quadro]),
    [snapshots, quadro],
  );

  const rotulosDoSeletor = useMemo(() => rotulosDasVigencias(doQuadro), [doQuadro]);

  /*
    O que está na lista fica; o par de partida só entra quando nada sobreviveu.

    **A lista vazia não reconcilia nada**, e essa guarda é o que faz o par do
    endereço sobreviver: `/snapshots` chega depois da primeira renderização, e
    sem ela o efeito rodava uma vez contra a lista vazia, achava que nenhuma das
    duas pontas existia e limpava as duas — o link abria no par mais recente, e
    não no par que ele nomeava.
  */
  useEffect(() => {
    if (doQuadro.length === 0) return;
    setPar((atual) => {
      const reconciliado = parReconciliado(doQuadro, atual);
      return reconciliado.base === atual.base && reconciliado.comparada === atual.comparada
        ? atual
        : reconciliado;
    });
  }, [doQuadro]);

  const parametros = useMemo(() => {
    const q = new URLSearchParams(query);
    q.set("quadro", quadro);
    q.set("base", par.base);
    q.set("comparada", par.comparada);
    if (rubrica !== "TODAS") q.set("rubrica", rubrica);
    if (comSemAlteracao) q.set("semAlteracao", "true");
    return q.toString();
  }, [query, quadro, par, rubrica, comSemAlteracao]);

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * O recorte vai junto porque o número do menu tem de ser o número que o
   * clique entrega: com a tela em "refeição", um menu que contasse o quadro
   * inteiro prometeria alterações que o clique não mostraria. É a mesma razão
   * pela qual o Monitor manda os filtros dele.
   *
   * Quem recorta a lista de candidatas é o servidor, pela série do destino
   * (`candidatasDoPar`) — a tela não filtra nada. O `scopeHash` entra só na
   * chave da consulta, para que trocar de unidade seja pergunta nova em vez de
   * cache reaproveitado.
   */
  const recorteDoMenu = useMemo(() => {
    const q = new URLSearchParams();
    q.set("quadro", quadro);
    if (rubrica !== "TODAS") q.set("rubrica", rubrica);
    return q.toString();
  }, [quadro, rubrica]);

  const candidatos = useCandidatosDoPar(
    "qlp",
    par.comparada,
    query.get("scopeHash"),
    recorteDoMenu,
  );

  const comparacao = useQuery({
    queryKey: ["qlp", "comparacao", parametros],
    queryFn: () => fetchJson<ComparacaoDeQlp>(`/qlp/comparacao?${parametros}`),
    enabled: par.base !== "" && par.comparada !== "" && par.base !== par.comparada,
    retry: false,
  });

  const dados = comparacao.data;
  const rotulos = dados?.rotulos ?? {};
  const linhas = useMemo(() => dados?.linhas ?? [], [dados]);
  const filtradas = useMemo(
    () => filtrar(linhas, filtros, rotulos),
    [linhas, filtros, rotulos],
  );
  const contagens = useMemo(
    () => contagemPorEstado(linhas, filtros, rotulos),
    [linhas, filtros, rotulos],
  );
  const naPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
  );

  useEffect(() => setPagina(1), [filtros, parametros]);

  const rotuloBase = dados?.base.sourceLabel ?? "De";
  const rotuloComparada = dados?.comparada.sourceLabel ?? "Para";

  /*
    Justificar sem sair daqui — a mesma caixa de Chamados, o mesmo POST, e a
    vigência escrita nela: quem justifica a partir desta tela escolheu o par no
    seletor acima, e um diálogo que não diz onde grava deixa a decisão sem a
    metade que a torna verificável.
  */
  const justificar = useJustificarNaTabela(
    dados?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada} do ${ROTULO_DO_QUADRO[quadro]}`,
  );

  /*
    A frase da tela vazia sai do motivo, e não de um palpite: `motivoSemPar`
    separa "não importaram" de "importaram uma só" de "são de unidades
    diferentes", e cada um pede uma frase diferente de quem lê.
  */
  const semPar = motivoSemPar(doQuadro);
  if (semPar) {
    const aviso = avisoDoParImpossivel(semPar);
    return (
      <EstadoVazio
        icone={ArrowRightLeft}
        titulo={
          aviso?.titulo ??
          `Não há par de vigências para comparar o ${ROTULO_DO_QUADRO[quadro]}`
        }
        descricao={
          aviso?.descricao ??
          `Comparar exige duas vigências do ${ROTULO_DO_QUADRO[quadro]} na mesma unidade. A segunda quinzena importada destrava esta aba.`
        }
      />
    );
  }

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, rotulos, justificar.justificadaPor));
    const nome = paraNomeDeArquivo(
      `${dados?.base.sourceLabel ?? "de"}-${dados?.comparada.sourceLabel ?? "para"}`,
    );
    salvarArquivo(blob, `qlp-${quadro.toLowerCase()}-comparacao-${nome}.csv`);
  }

  return (
    <div className="flex flex-col gap-4">
      <SeletorDoPar
        vigencias={doQuadro}
        rotulos={rotulosDoSeletor}
        base={par.base}
        comparada={par.comparada}
        onBase={(id) => setPar((p) => ({ ...p, base: id }))}
        onComparada={(id) => setPar((p) => ({ ...p, comparada: id }))}
        onInverter={() => setPar((p) => ({ base: p.comparada, comparada: p.base }))}
        carregando={comparacao.isFetching}
        idPrefixo={`qlp-${quadro.toLowerCase()}`}
        candidatos={candidatos.data}
      />

      {erroDasVigencias && (
        <ApiErrorNotice
          error={erroDasVigencias}
          what="As vigências do quadro não puderam ser carregadas."
        />
      )}

      {comparacao.error && (
        <ApiErrorNotice
          error={comparacao.error}
          what={`a comparação do ${ROTULO_DO_QUADRO[quadro]}`}
          onTentarDeNovo={() => void comparacao.refetch()}
          tentando={comparacao.isFetching}
        />
      )}

      {comparacao.isLoading && (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {dados && (
        <>
          <Cartoes dados={dados} />

          <div className="grid gap-3 lg:grid-cols-2">
            <AlteracoesPorVariavel dados={dados.alteracoesPorVariavel} />
            <DistribuicaoPorEstado dados={dados.distribuicaoPorEstado} />
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{dados.resumo.semImpactoFinanceiro}</span>
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[13rem] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id={`qlp-comparacao-busca-${quadro}`}
                value={filtros.busca}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="Buscar cargo ou variável…"
                aria-label="Buscar cargo ou variável"
                className="pl-9"
              />
            </div>

            <Select value={rubrica} onValueChange={setRubrica}>
              <SelectTrigger className="w-[13rem]" aria-label="Rubrica">
                <SelectValue placeholder="Todas as rubricas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas as rubricas</SelectItem>
                {dados.rubricasDoQuadro.map((r) => (
                  <SelectItem key={r} value={r}>
                    {escreverRubrica(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filtros.variavel}
              onValueChange={(v) => setFiltros((f) => ({ ...f, variavel: v }))}
            >
              <SelectTrigger className="w-[15rem]" aria-label="Variável">
                <SelectValue placeholder="Todas as variáveis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                {dados.alteracoesPorVariavel.map((v) => (
                  <SelectItem key={v.variavel} value={v.variavel}>
                    {v.rotulo}
                    {v.alteracoes > 0 ? ` (${formatNumber(v.alteracoes, 0)})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={comSemAlteracao} onCheckedChange={setComSemAlteracao} />
              Mostrar o que não mudou
            </label>

            <Button type="button" variant="outline" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Exportar CSV
            </Button>
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
                {aba.rotulo} ({formatNumber(contagens[aba.chave] ?? 0, 0)})
              </button>
            ))}
          </div>

          {filtradas.length === 0 ? (
            <EstadoVazio
              icone={ArrowRightLeft}
              titulo="Nenhuma alteração neste recorte"
              descricao={
                linhas.length === 0
                  ? "As duas vigências deste par dizem a mesma coisa sobre todos os cargos deste quadro — nenhuma variável mudou de valor. Ligue “Mostrar o que não mudou” para ver o quadro inteiro lado a lado."
                  : "O recorte de busca, rubrica, variável e estado não deixou nenhuma linha. Limpe um dos filtros para ver as demais."
              }
            />
          ) : (
            <>
              <TabelaDaComparacaoDeQlp
                linhas={naPagina}
                rotulos={rotulos}
                justificadaPor={justificar.justificadaPor}
                onAbrir={setCargoAberto}
                onJustificar={justificar.abrir}
              />
              <Paginacao
                pagina={pagina}
                porPagina={porPagina}
                total={filtradas.length}
                onPagina={setPagina}
                onPorPagina={setPorPagina}
                unidade="linhas"
                unidadeSingular="linha"
              />
            </>
          )}
          <DetalheDoCargo
            cargo={cargoAberto}
            linhas={linhas}
            rotulos={rotulos}
            rotuloBase={rotuloBase}
            rotuloComparada={rotuloComparada}
            onFechar={() => setCargoAberto(null)}
          />
          <JustificarDialog {...justificar.propsDoDialogo} />
        </>
      )}
    </div>
  );
}

/**
 * Os indicadores do topo.
 *
 * **Cargos e efetivo continuam sendo dois números diferentes** — é a primeira
 * coisa que toda tela de QLP ensina, e não muda por a leitura ser comparativa.
 * O que muda é que aqui os dois vêm com sinal: quantos cargos mexeram, e
 * quantas posições o quadro ganhou ou perdeu.
 */
function Cartoes({ dados }: { dados: ComparacaoDeQlp }) {
  const { resumo } = dados;
  const efetivo = resumo.efetivo;
  /* Nulo é "não sei", e não zero: uma ponta que não trouxe a coluna do efetivo
     não é um quadro sem gente. O cartão escreve o travessão de sempre. */
  const diferenca = efetivo.diferenca;
  const sinal = diferenca === null ? "" : diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      aria-label="Indicadores da comparação do quadro"
    >
      <CartaoDeIndicador
        rotulo="Cargos comparados"
        valor={formatNumber(resumo.cargosComparados, 0)}
        nota="presentes nas duas pontas"
        ajuda="Sai da contagem da vigência, e não da lista de alterações: um cargo em que nada mudou não produz alteração nenhuma."
        icone={Briefcase}
      />
      <CartaoDeIndicador
        destaque
        rotulo="Cargos com alteração"
        valor={formatNumber(resumo.cargosComAlteracao, 0)}
        nota={
          resumo.variaveisAlteradas === 0
            ? "nada mudou neste par"
            : `${formatNumber(resumo.variaveisAlteradas, 0)} variáveis alteradas`
        }
        ajuda={
          resumo.alteracoesForaDaSoma > 0
            ? `${formatNumber(resumo.alteracoesForaDaSoma, 0)} dessas alterações são de colunas que não entram em soma — subtotais e benchmark mudam junto com as parcelas deles.`
            : "Um cargo conta uma vez, ainda que várias variáveis dele tenham mudado."
        }
        icone={TriangleAlert}
        corDoIcone="bg-warning/15 text-warning-foreground"
      />
      <CartaoDeIndicador
        rotulo="Efetivo movimentado"
        valor={
          diferenca === null
            ? "—"
            : `${sinal}${formatNumber(Math.abs(diferenca), Number.isInteger(diferenca) ? 0 : 2)}`
        }
        nota={
          diferenca === null
            ? "uma das pontas não declarou o efetivo"
            : diferenca === 0
              ? "o quadro remunera as mesmas posições"
              : `de ${formatNumber(efetivo.base ?? 0, 0)} para ${formatNumber(efetivo.comparada ?? 0, 0)} posições`
        }
        ajuda="A única soma desta tela, e ela é de gente: somar posições não depende da curadoria de semântica monetária. Dinheiro continua travado."
        icone={Users}
      />
      <CartaoDeIndicador
        rotulo="Cargos que entraram"
        valor={`+${formatNumber(resumo.novosNaVigencia, 0)}`}
        nota="não existiam na vigência De"
        icone={UserPlus}
        corDoIcone="bg-brand/10 text-brand"
      />
      <CartaoDeIndicador
        rotulo="Cargos que saíram"
        valor={`−${formatNumber(resumo.ausentesNaComparada, 0)}`}
        nota="não existem na vigência Para"
        icone={UserMinus}
        corDoIcone="bg-destructive/10 text-destructive"
      />
    </div>
  );
}
