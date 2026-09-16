import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Fuel, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeConsumo } from "@workspace/comparison/consumo";
import {
  TIPO_DO_CONSUMO,
  VARIAVEIS_DE_CONSUMO,
  VARIAVEIS_DE_DETALHE_DE_CONSUMO,
} from "@workspace/comparison/consumo";
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
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { CartoesDeConsumo } from "@/components/consumo/cartoes";
import {
  AlteracoesPorVariavel,
  ColunasDoEquipamento,
  ConferenciaDoConsumo,
  DistribuicaoPorEstado,
  RendimentoPorVigencia,
} from "@/components/consumo/graficos";
import { TabelaDeConsumo } from "@/components/consumo/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoTrecho } from "@/components/consumo/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeConsumo,
  type FiltrosDeConsumo,
  type TotaisDeConsumo,
} from "@/lib/consumo";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE CONSUMO — o rendimento do trecho, e o preço do litro que ele
 * embute.
 *
 * ---------------------------------------------------------------------------
 * A maior parcela do preço, e a única que não se explicava
 * ---------------------------------------------------------------------------
 * O diesel é a primeira das nove parcelas que a Auditoria de Km Rodado soma, e
 * era a única que este produto mostrava por um número só: `R$/km do diesel`. De
 * onde ele vinha, nenhuma tela dizia.
 *
 * Ele vem de duas coisas, e as duas estão no acervo: o **rendimento** — quantos
 * quilômetros o conjunto faz por litro naquele percurso, declarado em duas
 * colunas, a do trecho e a ajustada pela carga — e o **preço do litro**, que não
 * é declarado em coluna nenhuma.
 *
 * E é por isso que esta tela existe: o preço do litro **é recuperável**, porque
 * `R$/km = preço do litro ÷ km por litro`. Multiplicando as duas colunas do
 * trecho, o diesel sobre o qual aquele percurso foi precificado aparece — e numa
 * mesma vigência ele tem de ser um só. Quem devolve outro foi montado sobre outra
 * premissa de combustível, e nenhuma coluna do export diz isso.
 *
 * **Um delta entre vigências nunca veria isso.** As duas colunas de cada trecho
 * continuam coerentes entre si, cada uma na sua linha. Só o produto delas,
 * comparado entre trechos da mesma vigência, enxerga a divergência.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela recusa responder
 * ---------------------------------------------------------------------------
 * Quanto diesel a operação queimou. Isso exigiria o abastecimento realizado por
 * quinzena, que este export não traz — o mesmo realizado que falta a Km Rodado, a
 * Velocidade Média e ao TMA. O rendimento aqui é o **parametrizado**: um
 * parametrizado acima do praticado é diesel que a operação gasta e ninguém
 * remunera; abaixo, é combustível pago que não foi queimado.
 *
 * As seis colunas de combustível do `Modelo_Cavalo` ficam fora da tabela, e
 * aparecem no aviso: são o modelo de consumo do **veículo**, e o que precifica o
 * frete é o do **percurso**.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * rendimento por vigência, preço do litro e as três conferências vêm de
 * `@workspace/comparison/consumo`, que o servidor importa do mesmo jeito.
 */
export default function AuditoriaDeConsumo() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeConsumo>(FILTROS_VAZIOS);
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
   * que não sabe ler o recorte.
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

  const candidatos = useCandidatosDoPar("consumo", comparada, escopoAberto);

  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * As vigências que o seletor oferece: as da unidade aberta **que cobrem
   * trecho**.
   *
   * O segundo filtro é o mesmo das demais telas de trecho: no acervo, a mesma
   * unidade entrega o arquivo de equipamento e o de trecho em vigências
   * separadas. Sem ele, o par de partida cai numa vigência de cavalo e a tela
   * abre vazia sem dizer por quê.
   */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPO_DO_CONSUMO,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidade, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidade, nomePorEscopo],
  );

  /**
   * O par aberto, mantido dentro da lista que o seletor oferece — e só ele.
   *
   * Ao trocar de unidade, o par anterior deixa de estar nela — e mantê-lo faria a
   * tela responder por Pernambuco sob a palavra CAMAÇARI.
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
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  const semParPossivel = semPar !== null && !(base && comparada);
  const semTrechoNaUnidade = semPar?.motivo === "LISTA_VAZIA";

  const comparacao = useQuery({
    queryKey: ["consumo", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeConsumo>(
        `/consumo/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["consumo", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeConsumo>(`/consumo/totais?base=${base}&comparada=${comparada}`),
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

  /**
   * O diesel praticado na vigência comparada — a referência da gaveta.
   *
   * Vem da régua da vigência, e não é recalculado aqui: a mediana entre os
   * trechos é da tabela inteira, e a gaveta só conhece um trecho. Duas medianas
   * com o mesmo nome — uma da tabela, outra do recorte aberto — seriam dois
   * números que se contradizem a dois centímetros de distância.
   */
  const dieselDaComparada = useMemo(
    () =>
      totais.data?.conferencias.find((c) => c.ponta === "COMPARADA")
        ?.precoDoLitroDeReferencia ?? null,
    [totais.data],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  const rotuloBase = vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Para";

  /*
    Justificar sem sair daqui — a mesma caixa de Chamados, o mesmo POST, e a
    vigência escrita nela: quem justifica a partir desta tela escolheu o par no
    seletor acima.
  */
  const justificar = useJustificarNaTabela(
    comparacao.data?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada}`,
  );

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificar.justificadaPor));
    salvarArquivo(
      blob,
      `consumo-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  const rendimentos = comparacao.data?.resumo.impacto.rendimentosAlterados ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Consumo
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências · por trecho
            </span>
          </span>
        }
        icone={Fuel}
        descricao="Quantos quilômetros o litro faz em cada trecho, quanto se perde pela carga e pela região — e qual preço de diesel cada trecho embute, que é o número que nenhuma coluna do acervo declara."
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
            idPrefixo="consumo"
            candidatos={candidatos.data}
            carregandoCandidatos={candidatos.isFetching}
            erroDosCandidatos={
              candidatos.error instanceof Error ? candidatos.error.message : null
            }
          />
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={Fuel}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : semTrechoNaUnidade
                  ? "Esta unidade não tem vigência de trecho importada"
                  : "Esta unidade não tem duas vigências de trecho para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : semTrechoNaUnidade
                  ? "O consumo que precifica o frete é por trecho, e a tabela de frete desta unidade ainda não chegou ao acervo. As vigências de cavalo e carreta que ela tem alimentam as telas de custo fixo, não esta."
                  : "A comparação de consumo precisa de duas vigências de trecho da mesma unidade. Escolha outra unidade na lateral ou importe a tabela de frete seguinte."
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
            what="a comparação de consumo"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeConsumo resumo={comparacao.data.resumo} />

            {/*
              O preço do litro vem em largura inteira, e logo abaixo dos
              indicadores, por ser a leitura própria desta tela — a única que
              nenhuma outra do produto faz. Espremê-lo numa das colunas de gráfico
              o deixaria com cara de painel auxiliar.
            */}
            <ConferenciaDoConsumo
              conferencias={totais.data?.conferencias ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <RendimentoPorVigencia
                rendimento={totais.data?.rendimento ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={comparacao.data.alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={comparacao.data.distribuicaoPorEstado} />
              <ColunasDoEquipamento />
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
                  id="consumo-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar trecho ou variável…"
                  aria-label="Buscar trecho ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O filtro de unidade é o que esta tabela não pode não ter, e por um
                motivo que só ela tem: `2,50` e `2,40` na mesma coluna são um
                rendimento e um custo, e sobem em sentidos opostos.
              */}
              <Select
                value={filtros.papel}
                onValueChange={(papel) =>
                  setFiltros((f) => ({ ...f, papel: papel as FiltrosDeConsumo["papel"] }))
                }
              >
                <SelectTrigger className="w-[12rem]" aria-label="Unidade da variável">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todas as unidades</SelectItem>
                  <SelectItem value="RENDIMENTO">km/l</SelectItem>
                  <SelectItem value="RAZAO">R$/km</SelectItem>
                  <SelectItem value="PERDA">Perdas</SelectItem>
                  <SelectItem value="POR_VIAGEM">R$/viagem</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[18rem]" aria-label="Variável de consumo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_CONSUMO, ...VARIAVEIS_DE_DETALHE_DE_CONSUMO].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="consumo-so-rendimento"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="consumo-so-rendimento"
                  checked={filtros.soRendimento}
                  onCheckedChange={(soRendimento) =>
                    setFiltros((f) => ({ ...f, soRendimento }))
                  }
                />
                Só o rendimento
                {rendimentos > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {formatNumber(rendimentos, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="consumo-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="consumo-sem-alteracao"
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
                  icone={Fuel}
                  titulo="Nenhuma variável de consumo mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.trechosComparados,
                    0,
                  )} trechos comparados, e o consumo de todos eles chegou igual nas duas tabelas. O preço do litro embutido, acima, continua valendo — ele não olha o que mudou, olha se os trechos concordam entre si sobre o diesel.`}
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
                <TabelaDeConsumo
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
              linhas={linhas as LinhaDeConsumo[]}
              precoDeReferencia={dieselDaComparada}
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
