import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lightbulb,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";
import { opcoesDoIntervalo, opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicityAdjective, periodicitySuffix } from "@/lib/format";
import { linkDeAlteracoes, type Recorte } from "@/lib/recorte";
import type {
  Movimentos,
  ParameterRollup,
  RangeMovement,
  RangeOverview,
  RangeOverviewUnit,
  ResumoDoIntervalo,
} from "@/lib/analise";
import { DetalheDoIntervalo, type AberturaDoIntervalo } from "@/components/linha-do-tempo/detalhe-do-intervalo";

export const CARTAO = "bg-card border rounded-xl shadow-sm";

/**
 * O impacto líquido de cada vigência do histórico, no tempo.
 *
 * O cartão de Impacto líquido só mostra a vigência aberta contra a anterior a
 * ela — o resto da história (quantas vigências tiveram alteração, quando o
 * impacto foi maior, se ele vem crescendo ou oscilando) fica sem resposta
 * nesta tela. Esta seção lê `/changes/range` do início ao fim do histórico do
 * contexto, e mostra o mesmo número oficial que o cartão de cima publica —
 * `movement.impact.byPeriodicity`, já sem dupla contagem.
 *
 * A tela sai daqui em quatro peças, na ordem em que a reunião pergunta: o
 * placar do intervalo (`CartoesDeResumo`), a evolução vigência a vigência com
 * o acumulado embaixo (`EvolucaoDasVigencias`), o que ainda falta valorar e
 * onde o impacto está na coluna ao lado, e o parágrafo que resume tudo.
 */
export function LinhaDoTempoDeImpacto({
  consulta,
  periods,
  currentPeriod,
}: {
  consulta: URLSearchParams;
  periods: { date: string; label: string }[];
  currentPeriod: string;
}) {
  const ordenadas = [...periods].sort((a, b) => a.date.localeCompare(b.date));
  const primeira = ordenadas[0]?.date;

  // A mesma unidade e canal em toda a linha do tempo — só a vigência muda de
  // linha para linha, e é ela que cada linha acrescenta ao clicar.
  const recorteBase: Recorte = {
    period: null,
    scopeHash: consulta.get("scopeHash"),
    canal: consulta.get("canal"),
  };

  const [abertura, setAbertura] = useState<AberturaDoIntervalo | null>(null);
  const abrirParametro = (parameterKey: string, periodicidade: string) =>
    setAbertura({ tipo: "parametro", parameterKey, periodicidade });

  // Qual periodicidade a linha do tempo mostra — MENSAL e ANUAL contam a
  // mesma vigência de formas diferentes, então mostrá-las ao mesmo tempo faz
  // o mesmo mês parecer repetido. Uma aba de cada vez resolve isso.
  const [periodicidadeDaAba, setPeriodicidadeDaAba] = useState<string | null>(null);

  /*
    A chave é a mesma que `LinhaDoTempoDeAlteracoes`, `useAlteracoesPorVigencia`
    e o prefetch da página usam para este mesmo endpoint — todos leem
    `/changes/range` para o mesmo contexto e, no carregamento inicial da tela,
    para o mesmo `from`/`to` (histórico inteiro). Chaves próprias por
    componente faziam o React Query tratá-las como perguntas diferentes e
    disparar requisições idênticas ao abrir a tela; com a chave montada por
    `opcoesDoIntervalo`, elas compartilham cache e a requisição em voo — uma só
    chamada cara. É por esse compartilhamento que o prefetch da página
    (`pages/linha-do-tempo.tsx`) chega aqui: quando este componente monta, a
    resposta ou já está no cache, ou está a caminho.
  */
  const movimentos = useQuery({
    ...opcoesDoIntervalo(consulta, primeira ?? currentPeriod, currentPeriod),
    enabled: ordenadas.length > 1,
  });

  /*
    A mesma pergunta, entre todas as unidades — "onde está o impacto" só faz
    sentido sobre o intervalo, não sobre unidade/canal (que aqui identificam a
    própria pergunta). Por isso a consulta desta seção não herda `scopeHash`
    nem `canal` de `query`: são só as pontas do intervalo — a chave vem de
    `opcoesDoIntervaloGeral`, a mesma que o Dashboard e o seletor de vigência
    usam, para que as três telas façam uma requisição só.

    E ela só sai **depois** que a leitura desta unidade chegou.

    Não é atraso por precaução: `/changes/range/overview` roda a análise
    completa do intervalo uma vez por unidade × contexto, todas de uma vez
    (ver `getRangeOverview`). Disparada junto com a leitura da unidade aberta,
    ela disputa o mesmo pool de conexões com a resposta que a tela de fato
    espera — e atrasa o conteúdo principal para adiantar um cartão lateral.

    O cartão que ela alimenta não some por esperar: `OndeEstaOImpacto` não
    desenha nada enquanto a resposta não chega, e passa a desenhar quando ela
    chega. O que muda é a ordem — primeiro o que a tela veio mostrar, depois o
    ranking entre unidades.
  */
  const overview = useQuery({
    ...opcoesDoIntervaloGeral(primeira ?? null, currentPeriod),
    enabled: ordenadas.length > 1 && movimentos.isSuccess,
  });

  // Uma vigência só não tem linha do tempo a desenhar.
  if (ordenadas.length <= 1) return null;
  if (movimentos.isLoading) {
    return (
      <section className={cn(CARTAO, "p-5")}>
        <p className="text-sm text-muted-foreground">Carregando a linha do tempo…</p>
      </section>
    );
  }

  const dados = movimentos.data;
  if (!dados || dados.movements.length === 0) return null;

  // A mais antiga primeiro — daqui em diante a linha do tempo corre da
  // esquerda para a direita, e é esta ordem que a janela paginada recorta.
  const linhas = [...dados.movements].reverse();
  const periodicidades = [
    ...new Set(linhas.flatMap((m) => Object.keys(m.impact.byPeriodicity))),
  ].sort();

  /*
    A periodicidade que a tela conta — a de maior movimento absoluto no
    intervalo inteiro, até o leitor escolher outra no seletor da linha do tempo.

    Uma só, e a mesma para tudo: os cartões do topo, a linha do tempo, o
    acumulado e o parágrafo final falam sempre da periodicidade selecionada.
    Antes o seletor movia só a linha do tempo enquanto os cartões seguiam na
    principal — duas periodicidades na mesma tela, sem a tela dizer qual era
    qual. Somá-las nunca foi opção: MENSAL e ANUAL contam a mesma vigência de
    formas diferentes, e somar as duas conta o mesmo mês duas vezes.
  */
  const principal = [...periodicidades].sort(
    (a, b) => Math.abs(dados.impact.byPeriodicity[b] ?? 0) - Math.abs(dados.impact.byPeriodicity[a] ?? 0),
  )[0] as string | undefined;
  const periodicidadeSelecionada = periodicidadeDaAba ?? principal ?? periodicidades[0];

  const ranking = rankingDeUnidades(overview.data ?? null, periodicidadeSelecionada ?? null);
  const temLateral = ranking.length > 0 || dados.impact.notCalculable > 0;

  return (
    <>
      {periodicidadeSelecionada !== undefined && (
        <CartoesDeResumo
          dados={dados}
          periodicidade={periodicidadeSelecionada}
          onAbrir={() => setAbertura({ tipo: "consolidado", periodicidade: periodicidadeSelecionada })}
        />
      )}

      {/*
        A coluna lateral só reserva largura quando tem o que dizer: sem
        pendências e sem ranking entre unidades, ela viraria 21rem de vazio ao
        lado de uma linha do tempo espremida.
      */}
      <div
        className={cn(
          "grid gap-5 xl:items-start",
          temLateral && "xl:grid-cols-[minmax(0,1fr)_21rem]",
        )}
      >
        <section className={cn(CARTAO, "p-5")}>
          {periodicidades.length === 0 ? (
            <>
              <CabecalhoDaEvolucao dados={dados} />
              <ContagemPorVigencia linhas={linhas} recorteBase={recorteBase} />
            </>
          ) : (
            <EvolucaoDasVigencias
              dados={dados}
              linhas={linhas}
              periodicidades={periodicidades}
              periodicidade={periodicidadeSelecionada as string}
              onPeriodicidade={setPeriodicidadeDaAba}
              recorteBase={recorteBase}
              onAbrirVigencia={(linha) =>
                setAbertura({
                  tipo: "vigencia",
                  period: linha.period,
                  periodicidade: periodicidadeSelecionada as string,
                })
              }
            />
          )}
        </section>

        {temLateral && (
          <div className="space-y-4">
            <PendenciasDeValoracao dados={dados} recorteBase={recorteBase} />
            <OndeEstaOImpacto ranking={ranking} />
          </div>
        )}
      </div>

      {periodicidadeSelecionada !== undefined && (
        <Narrativa dados={dados} periodicidade={periodicidadeSelecionada} linhas={linhas} />
      )}

      <AtributosDeMaiorImpacto
        byParameter={dados.byParameter}
        periodicidades={periodicidades}
        onAbrir={abrirParametro}
      />

      <DetalheDoIntervalo
        abertura={abertura}
        dados={dados}
        recorteBase={recorteBase}
        onFechar={() => setAbertura(null)}
        onAbrirParametro={abrirParametro}
      />
    </>
  );
}

/**
 * Os quatro números do intervalo — o líquido, os dois lados que o formam e a
 * contagem de alterações —, todos sobre a **mesma** periodicidade.
 *
 * Separar "o que somou" e "o que subtraiu" em cartões próprios, e não só numa
 * barra dentro do cartão de líquido, é a resposta ao mesmo problema que
 * `DoisLados` resolve na Visão geral: um líquido negativo não distingue "quase
 * nada se moveu" de "dois movimentos grandes quase se cancelaram", e é
 * exatamente essa segunda leitura que a conversa com o cliente precisa.
 *
 * Ficam soltos no topo da tela, e não dentro do cartão da linha do tempo: são
 * o placar do intervalo inteiro, não uma legenda do gráfico — e é como placar,
 * na largura toda, que eles são lidos primeiro.
 */
export function CartoesDeResumo({
  dados,
  periodicidade,
  onAbrir,
  avisoDeAtivos,
}: {
  dados: ResumoDoIntervalo;
  periodicidade: string;
  /**
   * Ressalva sob a contagem de ativos. A Visão Geral precisa dela: entre
   * unidades, `vehiclesTouched` é soma simples e não deduplicada por placa —
   * a mesma nota que o cartão de veículos da Visão Geral já publica.
   */
  avisoDeAtivos?: string;
  /**
   * Abrir a decomposição do líquido. Opcional porque a Visão Geral não a tem:
   * a gaveta decompõe o número por parâmetro, e parâmetro não se soma entre
   * unidades (ver `getRangeOverview`). Sem ela, os cartões são leitura.
   */
  onAbrir?: () => void;
}) {
  const liquido = dados.impact.byPeriodicity[periodicidade] ?? 0;
  const ganhos = dados.gainsByPeriodicity[periodicidade] ?? 0;
  const perdas = dados.lossesByPeriodicity[periodicidade] ?? 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CartaoDeResumo
        icone={liquido < 0 ? ArrowDownRight : ArrowUpRight}
        tom={liquido < 0 ? "perda" : "ganho"}
        titulo={`Impacto líquido${periodicitySuffix(periodicidade)}`}
        valor={formatBrlShort(liquido)}
        onClique={onAbrir}
        rotulo="Ver o que somou e o que subtraiu"
      />
      <CartaoDeResumo
        icone={Clock}
        tom="perda"
        titulo={`Perdas identificadas${periodicitySuffix(periodicidade)}`}
        valor={formatBrlShort(perdas)}
        onClique={onAbrir}
        rotulo="Ver o que subtraiu da remuneração"
      />
      <CartaoDeResumo
        icone={ArrowUpRight}
        tom="ganho"
        titulo={`Ganhos identificados${periodicitySuffix(periodicidade)}`}
        valor={`+${formatBrlShort(ganhos)}`}
        onClique={onAbrir}
        rotulo="Ver o que somou à remuneração"
      />
      <div className={cn(CARTAO, "flex items-center gap-3.5 p-5")}>
        <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-accent">
          <SlidersHorizontal className="w-5 h-5 text-brand" />
        </span>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">Alterações</div>
          <div className="text-2xl font-extrabold tabular-nums leading-tight">
            {dados.totals.changes.toLocaleString("pt-BR")}
          </div>
          <div className="text-xs text-muted-foreground">
            em {contar(dados.totals.vehiclesTouched, "ativo", "ativos")}
          </div>
          {avisoDeAtivos && (
            <div className="text-[0.6875rem] text-muted-foreground leading-snug mt-0.5">
              {avisoDeAtivos}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CartaoDeResumo({
  icone: Icone,
  tom,
  titulo,
  valor,
  onClique,
  rotulo,
}: {
  icone: typeof ArrowUpRight;
  tom: "ganho" | "perda";
  titulo: string;
  valor: string;
  onClique?: () => void;
  rotulo: string;
}) {
  // Sem gaveta para abrir, o cartão não finge ser botão: um `<button>` que não
  // leva a lugar nenhum promete um clique que a tela não honra.
  const Elemento = onClique ? "button" : "div";
  return (
    <Elemento
      {...(onClique
        ? { type: "button" as const, onClick: onClique, "aria-label": `${titulo}: ${rotulo}`, title: rotulo }
        : {})}
      className={cn(
        CARTAO,
        "flex items-center gap-3.5 p-5 text-left",
        onClique && "hover:border-brand/40 transition-colors",
      )}
    >
      <span
        className={cn(
          "w-11 h-11 rounded-full flex items-center justify-center shrink-0",
          tom === "perda" ? "bg-red-50" : "bg-emerald-50",
        )}
      >
        <Icone className={cn("w-5 h-5", tom === "perda" ? "text-red-600" : "text-emerald-600")} />
      </span>
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{titulo}</div>
        <div
          className={cn(
            "text-2xl font-extrabold tabular-nums leading-tight",
            tom === "perda" ? "text-red-700" : "text-emerald-700",
          )}
        >
          {valor}
        </div>
      </div>
    </Elemento>
  );
}

/** O cabeçalho da seção — o mesmo com ou sem impacto apurado no intervalo. */
function CabecalhoDaEvolucao({
  dados,
  children,
}: {
  dados: ResumoDoIntervalo;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-accent">
          <ChartNoAxesCombined className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-tight">Evolução das vigências</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dados.fromLabel} → {dados.toLabel} · da mais antiga para a mais recente
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Quantas vigências cabem numa janela da linha do tempo. */
const VIGENCIAS_POR_JANELA = 5;

/**
 * A evolução do intervalo — a linha do tempo na horizontal, e o acumulado
 * logo abaixo dela.
 *
 * Horizontal porque é assim que o tempo se lê: a vigência mais antiga à
 * esquerda, a mais recente à direita, e o mês crítico nomeado onde ele
 * acontece. A versão anterior empilhava uma vigência por linha com uma barra
 * divergente — dizia o tamanho de cada mês, mas não a **forma** do período, e
 * era a forma que a reunião perguntava.
 *
 * Uma janela de {@link VIGENCIAS_POR_JANELA} vigências por vez, e não o
 * histórico inteiro espremido: cinco colunas ainda cabem com o número, a
 * contagem e o selo legíveis; doze viram tarja. O paginador começa na janela
 * mais recente — a pergunta usual é "e agora?", não "e no começo?".
 */
export function EvolucaoDasVigencias({
  dados,
  linhas,
  periodicidades,
  periodicidade,
  onPeriodicidade,
  recorteBase,
  onAbrirVigencia,
  rotuloDeAbrir = "Ver o que somou e o que tirou nesta vigência",
}: {
  dados: ResumoDoIntervalo;
  linhas: RangeMovement[];
  periodicidades: string[];
  periodicidade: string;
  onPeriodicidade: (periodicidade: string) => void;
  /**
   * Para onde cada vigência leva. `null` em Visão Geral: "todas as unidades"
   * não é recorte que a tela de Alterações saiba honrar — sem `scopeHash` ela
   * cai na unidade padrão e mostra outro assunto com a mesma cara (ver
   * `lib/recorte.ts`). Lá o clique abre `onAbrirVigencia`, que decompõe a
   * competência unidade a unidade antes de oferecer qualquer endereço.
   */
  recorteBase: Recorte | null;
  onAbrirVigencia?: (linha: RangeMovement) => void;
  /** O que o clique numa vigência promete — muda entre a unidade e a Visão Geral. */
  rotuloDeAbrir?: string;
}) {
  const janelas = Math.max(1, Math.ceil(linhas.length / VIGENCIAS_POR_JANELA));
  const [janelaPedida, setJanela] = useState(janelas - 1);
  // Trocar de unidade encurta o histórico sem desmontar o componente: a janela
  // guardada pode não existir mais, e é aqui que ela volta para dentro do fim.
  const janela = Math.min(Math.max(janelaPedida, 0), janelas - 1);
  const inicio = janela * VIGENCIAS_POR_JANELA;
  const visiveis = linhas.slice(inicio, inicio + VIGENCIAS_POR_JANELA);

  // O mês crítico é o do intervalo inteiro, não o da janela: o selo tem de
  // seguir apontando o mesmo mês que os cartões e o parágrafo contam.
  const comValor = linhas.filter((l) => l.impact.byPeriodicity[periodicidade] !== undefined);
  const critico = comValor.reduce<RangeMovement | undefined>(
    (a, b) =>
      a === undefined ||
      Math.abs(b.impact.byPeriodicity[periodicidade] ?? 0) >
        Math.abs(a.impact.byPeriodicity[periodicidade] ?? 0)
        ? b
        : a,
    undefined,
  );

  return (
    <>
      <CabecalhoDaEvolucao dados={dados}>
        {janelas > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <BotaoDeJanela
              rotulo="Vigências anteriores"
              desabilitado={janela === 0}
              onClique={() => setJanela(janela - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </BotaoDeJanela>
            <span className="rounded-lg border px-3.5 py-2 text-sm font-semibold tabular-nums">
              {rotuloDaJanela(visiveis)}
            </span>
            <BotaoDeJanela
              rotulo="Vigências seguintes"
              desabilitado={janela === janelas - 1}
              onClique={() => setJanela(janela + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </BotaoDeJanela>
          </div>
        )}
      </CabecalhoDaEvolucao>

      {periodicidades.length > 1 && (
        <div className="inline-flex rounded-lg border p-0.5 text-xs font-bold mb-4">
          {periodicidades.map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => onPeriodicidade(opcao)}
              aria-pressed={opcao === periodicidade}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                opcao === periodicidade
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              R${periodicitySuffix(opcao)}
            </button>
          ))}
        </div>
      )}

      {dados.gaps.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {dados.gaps.length} {dados.gaps.length === 1 ? "vigência" : "vigências"} do histórico
          sem comparação calculada — não aparecem abaixo, e não estão contadas como zero.
        </p>
      )}

      <LinhaDoTempoHorizontal
        visiveis={visiveis}
        periodicidade={periodicidade}
        critico={critico?.period ?? null}
        recorteBase={recorteBase}
        onAbrirVigencia={onAbrirVigencia}
        rotuloDeAbrir={rotuloDeAbrir}
      />

      <ImpactoAcumulado visiveis={visiveis} periodicidade={periodicidade} />
    </>
  );
}

function BotaoDeJanela({
  rotulo,
  desabilitado,
  onClique,
  children,
}: {
  rotulo: string;
  desabilitado: boolean;
  onClique: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClique}
      disabled={desabilitado}
      aria-label={rotulo}
      title={rotulo}
      className="rounded-lg border p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );
}

/**
 * A janela desenhada: data, marco, cartão e selo, uma coluna por vigência.
 *
 * As quatro faixas são grades independentes com o mesmo número de colunas, e
 * não uma grade só de quatro linhas: assim o eixo horizontal pode ser um
 * elemento absoluto dentro da sua própria faixa, atravessando os marcos, sem
 * que nada precise adivinhar a altura das faixas de cima.
 */
function LinhaDoTempoHorizontal({
  visiveis,
  periodicidade,
  critico,
  recorteBase,
  onAbrirVigencia,
  rotuloDeAbrir,
}: {
  visiveis: RangeMovement[];
  periodicidade: string;
  critico: string | null;
  recorteBase: Recorte | null;
  onAbrirVigencia?: (linha: RangeMovement) => void;
  rotuloDeAbrir: string;
}) {
  const grade = { gridTemplateColumns: `repeat(${visiveis.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[34rem]">
        <div className="grid gap-3" style={grade}>
          {visiveis.map((linha) => (
            <div key={linha.period} className="flex justify-center h-5">
              {linha.period === critico && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-red-700">
                  Mês crítico
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-3 mt-1.5" style={grade}>
          {visiveis.map((linha) => (
            <span
              key={linha.period}
              className={cn(
                "text-center text-sm font-semibold tabular-nums truncate",
                corDoTom(tomDaVigencia(linha, periodicidade, critico)),
              )}
              title={linha.label}
            >
              {linha.label}
            </span>
          ))}
        </div>

        <div className="relative grid gap-3 py-3" style={grade}>
          <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          {visiveis.map((linha) => (
            <span key={linha.period} className="relative flex justify-center">
              <Marco tom={tomDaVigencia(linha, periodicidade, critico)} />
            </span>
          ))}
        </div>

        <div className="grid gap-3 items-stretch" style={grade}>
          {visiveis.map((linha) => (
            <CartaoDaVigencia
              key={linha.period}
              linha={linha}
              periodicidade={periodicidade}
              tom={tomDaVigencia(linha, periodicidade, critico)}
              recorteBase={recorteBase}
              onAbrir={onAbrirVigencia}
              rotuloDeAbrir={rotuloDeAbrir}
            />
          ))}
        </div>

        <div className="grid gap-3 mt-2.5" style={grade}>
          {visiveis.map((linha) => {
            const tom = tomDaVigencia(linha, periodicidade, critico);
            return (
              <div key={linha.period} className="flex justify-center">
                <span
                  className={cn(
                    "rounded-md px-2 py-1 text-[0.625rem] font-bold uppercase tracking-wide",
                    tom === "perda" || tom === "critico"
                      ? "bg-red-50 text-red-700"
                      : tom === "ganho"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {tom === "ganho" ? "Ganho" : tom === "neutro" ? "Sem valoração" : "Perda"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** O que a vigência foi na periodicidade aberta — é isto que pinta a coluna inteira. */
type TomDaVigencia = "critico" | "perda" | "ganho" | "neutro";

function tomDaVigencia(
  linha: RangeMovement,
  periodicidade: string,
  critico: string | null,
): TomDaVigencia {
  const valor = linha.impact.byPeriodicity[periodicidade];
  if (valor === undefined || valor === 0) return "neutro";
  if (linha.period === critico) return "critico";
  return valor < 0 ? "perda" : "ganho";
}

function corDoTom(tom: TomDaVigencia): string {
  if (tom === "critico" || tom === "perda") return "text-red-700";
  if (tom === "ganho") return "text-emerald-700";
  return "text-foreground";
}

function Marco({ tom }: { tom: TomDaVigencia }) {
  if (tom === "critico") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100">
        <span className="h-3 w-3 rounded-full bg-red-600 ring-2 ring-card" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "h-3.5 w-3.5 rounded-full ring-4 ring-card",
        tom === "ganho" ? "bg-emerald-600" : tom === "perda" ? "bg-red-600" : "bg-slate-400",
      )}
    />
  );
}

/** O cartão sob o marco — a contagem, o que falta valorar e o número da vigência. */
function CartaoDaVigencia({
  linha,
  periodicidade,
  tom,
  recorteBase,
  onAbrir,
  rotuloDeAbrir,
}: {
  linha: RangeMovement;
  periodicidade: string;
  tom: TomDaVigencia;
  recorteBase: Recorte | null;
  onAbrir?: (linha: RangeMovement) => void;
  rotuloDeAbrir: string;
}) {
  const valor = linha.impact.byPeriodicity[periodicidade];
  const semValoracao = valor === undefined && linha.changes > 0;

  const classe = cn(
    "block h-full w-full rounded-lg border p-3 text-center transition-colors",
    (recorteBase !== null || onAbrir) && "hover:border-brand/40 hover:bg-accent",
    tom === "critico" && "border-red-200 bg-red-50/50",
    tom === "ganho" && "border-emerald-200 bg-emerald-50/50",
  );

  const conteudo = (
    <>
      <div className={cn("text-xs font-bold tabular-nums", tom === "critico" && "text-red-700")}>
        {contar(linha.changes, "alteração", "alterações")}
      </div>
      {linha.impact.notCalculable > 0 && (
        <div className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
          {linha.impact.notCalculable.toLocaleString("pt-BR")} sem valoração
        </div>
      )}
      {/*
        Vigência sem número apurado não ganha linha de valor: o selo embaixo do
        cartão já diz "sem valoração", e repeti-lo aqui gastava a linha do
        número dizendo duas vezes a mesma coisa. Sem alteração nenhuma é outro
        caso — esse não tem selo que o conte, e continua escrito.
      */}
      {valor !== undefined ? (
        <div
          className={cn(
            "mt-1.5 text-sm font-extrabold tabular-nums",
            valor < 0 ? "text-red-700" : "text-emerald-700",
          )}
        >
          {formatBrlShort(valor)}
        </div>
      ) : (
        !semValoracao && (
          <div className="mt-1.5 text-xs font-semibold italic text-muted-foreground">
            sem alteração
          </div>
        )
      )}
    </>
  );

  /*
    Três destinos possíveis, na ordem em que a tela os prefere.

    A gaveta vem antes do link para a Planilha, e a troca foi deliberada: a
    coluna diz "714 alterações, −R$ 302.261" e o clique caía em 714 linhas
    cruas para responder uma pergunta de duas linhas — o que puxou o mês para
    baixo, e o que puxou para cima. A gaveta responde isso primeiro, e leva
    para a Planilha de dentro dela (por atributo, ou a vigência inteira).
  */
  if (onAbrir) {
    return (
      <button
        type="button"
        onClick={() => onAbrir(linha)}
        aria-label={`${rotuloDeAbrir} — ${linha.label}`}
        title={rotuloDeAbrir}
        className={classe}
      >
        {conteudo}
      </button>
    );
  }

  if (recorteBase !== null) {
    return (
      <Link
        href={linkDeAlteracoes({ recorte: { ...recorteBase, period: linha.period } })}
        aria-label={`Ver as alterações de ${linha.label}`}
        title="Ver as alterações desta vigência"
        className={classe}
      >
        {conteudo}
      </Link>
    );
  }

  return <div className={classe}>{conteudo}</div>;
}

/**
 * O acumulado da janela — para onde o período caminhou, não só quanto cada
 * vigência pesou.
 *
 * Soma as vigências visíveis na ordem em que aconteceram: a linha do tempo
 * acima responde "quanto neste mês", e esta responde "e no fim das contas".
 * Cada trecho é vermelho quando o acumulado desceu e verde quando subiu — a
 * recuperação de um mês ruim aparece como subida, e não como mais uma barra.
 *
 * Vigência sem valoração entra como degrau zero, nunca como queda: ela não é
 * um impacto de R$ 0, é um impacto que ninguém apurou ainda — e é o cartão de
 * pendências, ao lado, que responde por ela.
 */
function ImpactoAcumulado({
  visiveis,
  periodicidade,
}: {
  visiveis: RangeMovement[];
  periodicidade: string;
}) {
  if (visiveis.length < 2) return null;

  let soma = 0;
  const pontos = visiveis.map((linha) => {
    soma += linha.impact.byPeriodicity[periodicidade] ?? 0;
    return { linha, acumulado: soma };
  });

  const teto = Math.max(0, ...pontos.map((p) => p.acumulado));
  const piso = Math.min(0, ...pontos.map((p) => p.acumulado));
  const amplitude = teto - piso || 1;

  const L = 900;
  const A = 210;
  const MARGEM_X = 46;
  const TOPO_UTIL = 26;
  const BASE_UTIL = 34;

  const x = (i: number) => MARGEM_X + ((i + 0.5) * (L - 2 * MARGEM_X)) / pontos.length;
  const y = (valor: number) =>
    TOPO_UTIL + ((teto - valor) / amplitude) * (A - TOPO_UTIL - BASE_UTIL);

  const minimo = pontos.reduce((a, b) => (b.acumulado < a.acumulado ? b : a), pontos[0]);
  const ultimo = pontos[pontos.length - 1];
  const rotulados = new Set([minimo, ultimo]);

  return (
    <div className="mt-5 rounded-lg border p-4">
      <div className="text-xs font-bold text-muted-foreground mb-1">
        Impacto líquido acumulado (R${periodicitySuffix(periodicidade)})
      </div>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Impacto líquido acumulado de ${pontos[0].linha.label} a ${ultimo.linha.label}: ${formatBrlShort(ultimo.acumulado)}`}
      >
        {/* O zero, para a linha ter contra o que subir e descer. */}
        <line
          x1={MARGEM_X / 2}
          x2={L - MARGEM_X / 2}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          strokeDasharray="4 4"
          className="text-border"
        />
        <text
          x={MARGEM_X / 2}
          y={y(0) - 6}
          fontSize="12"
          fill="currentColor"
          className="text-muted-foreground"
        >
          0
        </text>

        {pontos.slice(1).map((ponto, i) => (
          <line
            key={ponto.linha.period}
            x1={x(i)}
            y1={y(pontos[i].acumulado)}
            x2={x(i + 1)}
            y2={y(ponto.acumulado)}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={ponto.acumulado < pontos[i].acumulado ? "text-red-600" : "text-emerald-600"}
          />
        ))}

        {pontos.map((ponto, i) => (
          <g key={ponto.linha.period}>
            <circle
              cx={x(i)}
              cy={y(ponto.acumulado)}
              r="5"
              fill="currentColor"
              className="text-card"
            />
            <circle
              cx={x(i)}
              cy={y(ponto.acumulado)}
              r="5"
              fill="none"
              strokeWidth="2.5"
              stroke="currentColor"
              className={
                ponto.acumulado < 0
                  ? "text-red-600"
                  : ponto.acumulado > 0
                    ? "text-emerald-600"
                    : "text-slate-400"
              }
            >
              <title>{`${ponto.linha.label}: ${formatBrlShort(ponto.acumulado)}`}</title>
            </circle>

            {rotulados.has(ponto) && (
              <text
                x={x(i)}
                /*
                  Sempre acima do ponto: abaixo, o ponto mais baixo da série
                  (que é justamente o que sempre ganha rótulo) escrevia por
                  cima da data do eixo. Só desce quando não há acima — ponto
                  colado no teto do desenho.
                */
                y={y(ponto.acumulado) < TOPO_UTIL + 6 ? y(ponto.acumulado) + 20 : y(ponto.acumulado) - 12}
                fontSize="13"
                fontWeight="700"
                textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"}
                fill="currentColor"
                className={ponto.acumulado < 0 ? "text-red-700" : "text-emerald-700"}
              >
                {formatBrlShort(ponto.acumulado)}
              </text>
            )}

            <text
              x={x(i)}
              y={A - 8}
              fontSize="12"
              textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"}
              fill="currentColor"
              className="text-muted-foreground"
            >
              {ponto.linha.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const MESES_CURTOS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

/**
 * Como a janela aberta se chama no paginador — "Jun–Ago 2026".
 *
 * Mês e ano saem da data da vigência (`period`, sempre ISO), e não do rótulo,
 * que muda de forma conforme o histórico. Data que não seja ISO cai no rótulo
 * das pontas, que é sempre exibível.
 */
export function rotuloDaJanela(visiveis: { period: string; label: string }[]): string {
  const primeira = visiveis[0];
  const ultima = visiveis[visiveis.length - 1];
  if (primeira === undefined || ultima === undefined) return "";

  const de = mesEAno(primeira.period);
  const ate = mesEAno(ultima.period);
  if (de === null || ate === null) {
    return primeira === ultima ? primeira.label : `${primeira.label} – ${ultima.label}`;
  }
  if (de.ano !== ate.ano) return `${de.mes} ${de.ano} – ${ate.mes} ${ate.ano}`;
  if (de.mes === ate.mes) return `${de.mes} ${de.ano}`;
  return `${de.mes}–${ate.mes} ${de.ano}`;
}

function mesEAno(data: string): { mes: string; ano: string } | null {
  const [ano, mes] = data.split("-");
  const indice = Number(mes) - 1;
  if (ano === undefined || !Number.isInteger(indice) || indice < 0 || indice > 11) return null;
  return { mes: MESES_CURTOS[indice], ano };
}

/** Quando nenhuma vigência do intervalo tem impacto apurado: a mesma linha do tempo, contando alterações. */
export function ContagemPorVigencia({
  linhas,
  recorteBase,
  onAbrirVigencia,
}: {
  linhas: RangeMovement[];
  recorteBase: Recorte | null;
  onAbrirVigencia?: (linha: RangeMovement) => void;
}) {
  const teto = Math.max(...linhas.map((l) => l.changes), 1);
  const maior = linhas.reduce((a, b) => (b.changes > a.changes ? b : a), linhas[0]);

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Alterações por vigência — nenhuma com impacto apurado
      </div>
      <div className="space-y-1.5">
        {linhas.map((linha) => {
          const destaque = linha.period === maior.period && maior.changes > 0;
          const Linha = ({ children }: { children: React.ReactNode }) => {
            const classe =
              "grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3 text-sm rounded px-1 -mx-1 w-full text-left" +
              (recorteBase !== null || onAbrirVigencia ? " hover:bg-accent transition-colors" : "");
            if (recorteBase !== null) {
              return (
                <Link
                  href={linkDeAlteracoes({ recorte: { ...recorteBase, period: linha.period } })}
                  aria-label={`Ver as alterações de ${linha.label}`}
                  title="Ver as alterações desta vigência"
                  className={classe}
                >
                  {children}
                </Link>
              );
            }
            if (onAbrirVigencia) {
              return (
                <button
                  type="button"
                  onClick={() => onAbrirVigencia(linha)}
                  aria-label={`Ver ${linha.label} unidade a unidade`}
                  title="Ver esta vigência unidade a unidade"
                  className={classe}
                >
                  {children}
                </button>
              );
            }
            return <div className={classe}>{children}</div>;
          };
          return (
            <Linha key={linha.period}>
              <span
                className={cn("truncate", destaque ? "font-bold" : "text-muted-foreground")}
              >
                {linha.label}
              </span>
              <div className="h-4 flex items-center">
                <span
                  className="h-2.5 bg-slate-400 block"
                  style={{ width: `${(linha.changes / teto) * 100}%` }}
                />
              </div>
              <span className="text-right tabular-nums text-xs">
                {linha.changes.toLocaleString("pt-BR")}
              </span>
            </Linha>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onde está o impacto — o ranking por unidade
// ---------------------------------------------------------------------------

const TOPO_DE_UNIDADES = 6;

export interface UnidadeNoRanking extends RangeOverviewUnit {
  valor: number;
}

/**
 * As unidades do intervalo, da que mais moveu para a que menos moveu.
 *
 * Fica fora do componente porque a página precisa da resposta antes de
 * desenhar: é ela que decide se a coluna lateral existe. Um ranking de uma
 * unidade só não é ranking — é o mesmo número que os cartões do topo já
 * publicam — e por isso volta vazio.
 */
export function rankingDeUnidades(
  overview: RangeOverview | null,
  periodicidade: string | null,
): UnidadeNoRanking[] {
  if (overview === null || periodicidade === null) return [];

  const ranking = overview.unitsIncluded
    .map((u) => ({ ...u, valor: u.impact.byPeriodicity[periodicidade] ?? 0 }))
    .filter((u) => u.valor !== 0)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

  return ranking.length <= 1 ? [] : ranking;
}

/**
 * O ranking de unidades pelo líquido do intervalo — a mesma pergunta de
 * `LinhaDoTempoDaPeriodicidade`, respondida por "onde" em vez de "quando".
 *
 * Vem de `/changes/range/overview`, que soma o mesmo intervalo por unidade em
 * vez de por unidade única — ver `getRangeOverview` em
 * `@workspace/comparison`. Sem essa resposta ainda (carregando, ou nenhuma
 * outra unidade elegível), o cartão não aparece: um ranking de uma unidade só
 * não é ranking, é o mesmo número que os cartões acima já mostram.
 */
export function OndeEstaOImpacto({ ranking }: { ranking: UnidadeNoRanking[] }) {
  if (ranking.length === 0) return null;

  const teto = Math.max(...ranking.map((u) => Math.abs(u.valor)), 1);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
        <MapPin className="w-3.5 h-3.5" />
        Onde está o impacto?
      </div>
      <ol className="space-y-2.5">
        {ranking.slice(0, TOPO_DE_UNIDADES).map((unidade, indice) => (
          <li key={unidade.unidade}>
            <Link
              href={linkDeAlteracoes({
                recorte: {
                  period: null,
                  scopeHash: unidade.contexts[0]?.scopeHash ?? null,
                  canal: unidade.contexts[0]?.channel ?? null,
                },
              })}
              aria-label={`Ver as alterações de ${unidade.label}`}
              title="Ver as alterações desta unidade"
              className="block rounded px-1 -mx-1 hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-muted-foreground w-3 shrink-0">{indice + 1}</span>
                  <span className="font-semibold truncate" title={unidade.label}>
                    {unidade.label}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xs font-bold tabular-nums shrink-0",
                    unidade.valor < 0 ? "text-red-700" : "text-emerald-700",
                  )}
                >
                  {formatBrlShort(unidade.valor)}
                </span>
              </div>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full", unidade.valor < 0 ? "bg-red-600" : "bg-emerald-600")}
                  style={{ width: `${Math.max(4, (Math.abs(unidade.valor) / teto) * 100)}%` }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {ranking.length > TOPO_DE_UNIDADES && (
        <p className="mt-2.5 text-xs text-muted-foreground">
          + {contar(ranking.length - TOPO_DE_UNIDADES, "outra unidade", "outras unidades")} com
          impacto menor que as acima.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pendências de valoração
// ---------------------------------------------------------------------------

/**
 * Quantas alterações do intervalo ainda não têm impacto apurado — o mesmo
 * `notCalculable` que o cartão "Sem impacto calculável" mostra numa vigência
 * só, aqui somado ao intervalo inteiro.
 */
export function PendenciasDeValoracao({
  dados,
  recorteBase,
}: {
  dados: ResumoDoIntervalo;
  /** `null` em Visão Geral: o filtro de valoração precisa de uma unidade. */
  recorteBase: Recorte | null;
}) {
  if (dados.impact.notCalculable === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-800">
        <AlertTriangle className="w-3.5 h-3.5" />
        Pendências de valoração
      </div>
      <div className="text-xl font-extrabold tabular-nums mt-1.5 text-amber-900">
        {dados.impact.notCalculable.toLocaleString("pt-BR")}
      </div>
      <p className="text-xs text-amber-800 mt-1">
        {contar(dados.impact.notCalculable, "alteração", "alterações")} ainda sem impacto
        financeiro calculado.
        {recorteBase === null &&
          " Abra uma vigência da linha do tempo para ver de que unidades elas são."}
      </p>
      {recorteBase !== null && (
        <Link
          href={linkDeAlteracoes({
            recorte: recorteBase,
            filtros: { impactConfidence: "NOT_CALCULABLE" },
          })}
          aria-label="Ver as alterações ainda sem valoração"
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 transition-colors"
        >
          Ver alterações
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A narrativa
// ---------------------------------------------------------------------------

/**
 * O parágrafo que resume o intervalo — a mesma leitura que os cartões e a
 * linha do tempo já publicam, só que em frase corrida, para quem quer levar
 * uma linha para a reunião em vez de uma tela.
 *
 * Monta-se inteiramente a partir do que os componentes acima já leram —
 * nenhuma causa é inventada, só o que o motor apurou.
 */
export function Narrativa({
  dados,
  periodicidade,
  linhas,
}: {
  dados: ResumoDoIntervalo;
  periodicidade: string;
  linhas: RangeMovement[];
}) {
  const liquido = dados.impact.byPeriodicity[periodicidade] ?? 0;
  const ganhos = dados.gainsByPeriodicity[periodicidade] ?? 0;
  const perdas = dados.lossesByPeriodicity[periodicidade] ?? 0;

  const comValor = linhas.filter((l) => l.impact.byPeriodicity[periodicidade] !== undefined);
  const critico = comValor.reduce(
    (a, b) =>
      Math.abs(b.impact.byPeriodicity[periodicidade] ?? 0) >
      Math.abs(a.impact.byPeriodicity[periodicidade] ?? 0)
        ? b
        : a,
    comValor[0],
  );

  const frases: string[] = [
    `No período, as alterações geraram impacto líquido ${liquido < 0 ? "desfavorável" : "favorável"} de ${formatBrlShort(Math.abs(liquido))}${periodicitySuffix(periodicidade)}.`,
  ];

  if (critico && ganhos !== 0 && perdas !== 0) {
    frases.push(
      `${critico.label} concentrou o maior impacto ${(critico.impact.byPeriodicity[periodicidade] ?? 0) < 0 ? "negativo" : "positivo"}, com perdas de ${formatBrlShort(Math.abs(perdas))} parcialmente compensadas por ${formatBrlShort(ganhos)} em ganhos.`,
    );
  } else if (critico) {
    frases.push(`${critico.label} concentrou o maior impacto do período.`);
  }

  if (dados.impact.notCalculable > 0) {
    frases.push("Existem alterações ainda sem valoração que exigem revisão.");
  }

  return (
    <div className={cn(CARTAO, "flex gap-3.5 p-5")}>
      <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-accent">
        <Lightbulb className="w-5 h-5 text-brand" />
      </span>
      <div className="text-sm text-muted-foreground space-y-1">
        {frases.map((frase, i) => (
          <p key={i}>
            {frase}
            {i === frases.length - 1 && (
              <span className="ml-1 text-xs uppercase tracking-wide">
                ({periodicityAdjective(periodicidade)})
              </span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Os atributos de maior impacto
// ---------------------------------------------------------------------------

const TOPO = 6;

/**
 * Os parâmetros que mais somaram e mais tiraram no intervalo inteiro, uma
 * periodicidade por vez.
 *
 * A lista vigência a vigência acima responde "quando" o impacto aconteceu; esta
 * responde "o quê" — que atributo produziu esse impacto, somado por todas as
 * vigências do intervalo. Sai de `byParameter`, o mesmo rollup que a resposta
 * de `/changes/range` já calcula, e não de um pedido novo.
 *
 * Cada lista é a **soma no intervalo**, não uma vigência só — por isso o clique
 * numa linha não abre direto a Planilha (que filtraria por uma vigência que a
 * soma acima já deixou de ser). Em vez disso abre `DetalheDoIntervalo`, que
 * decompõe a soma vigência a vigência, e só ali oferece o link para cada uma.
 */
function AtributosDeMaiorImpacto({
  byParameter,
  periodicidades,
  onAbrir,
}: {
  byParameter: ParameterRollup[];
  periodicidades: string[];
  onAbrir: (parameterKey: string, periodicidade: string) => void;
}) {
  if (byParameter.length === 0 || periodicidades.length === 0) return null;

  return (
    <section className={cn(CARTAO, "p-5")}>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-accent">
          <BarChart3 className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[0.8125rem] font-bold leading-tight">
            Atributos de maior impacto
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            O que mais somou e o que mais tirou no intervalo inteiro, por periodicidade
          </p>
        </div>
      </div>

      <div className="space-y-7">
        {periodicidades.map((periodicidade) => (
          <RankingDaPeriodicidade
            key={periodicidade}
            periodicidade={periodicidade}
            byParameter={byParameter}
            onAbrir={onAbrir}
          />
        ))}
      </div>
    </section>
  );
}

interface ItemDoRanking extends ParameterRollup {
  valor: number;
}

function RankingDaPeriodicidade({
  periodicidade,
  byParameter,
  onAbrir,
}: {
  periodicidade: string;
  byParameter: ParameterRollup[];
  onAbrir: (parameterKey: string, periodicidade: string) => void;
}) {
  const comValor: ItemDoRanking[] = byParameter
    .map((p) => ({ ...p, valor: p.impact.byPeriodicity[periodicidade] ?? 0 }))
    .filter((p) => p.impact.byPeriodicity[periodicidade] !== undefined && p.valor !== 0);

  if (comValor.length === 0) return null;

  const positivos = comValor.filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
  const negativos = comValor.filter((p) => p.valor < 0).sort((a, b) => a.valor - b.valor);
  const teto = Math.max(...comValor.map((p) => Math.abs(p.valor)), 1);

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Impacto em R${periodicitySuffix(periodicidade)}
      </div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-6">
        <ColunaDeAtributos
          titulo="O que mais somou"
          ganho
          itens={positivos}
          teto={teto}
          periodicidade={periodicidade}
          onAbrir={onAbrir}
        />
        <ColunaDeAtributos
          titulo="O que mais tirou"
          ganho={false}
          itens={negativos}
          teto={teto}
          periodicidade={periodicidade}
          onAbrir={onAbrir}
        />
      </div>
    </div>
  );
}

function ColunaDeAtributos({
  titulo,
  ganho,
  itens,
  teto,
  periodicidade,
  onAbrir,
}: {
  titulo: string;
  ganho: boolean;
  itens: ItemDoRanking[];
  teto: number;
  periodicidade: string;
  onAbrir: (parameterKey: string, periodicidade: string) => void;
}) {
  const cor = ganho ? "text-emerald-700" : "text-red-700";
  const barra = ganho ? "bg-emerald-600" : "bg-red-600";

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-1.5">
        {ganho ? (
          <ArrowUpRight className="w-4 h-4 text-emerald-600" />
        ) : (
          <ArrowDownRight className="w-4 h-4 text-red-600" />
        )}
        {titulo}
      </h3>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum parâmetro {ganho ? "somou" : "tirou"} nesta periodicidade.
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {itens.slice(0, TOPO).map((item) => (
              <li key={item.parameterKey}>
                <button
                  type="button"
                  onClick={() => onAbrir(item.parameterKey, periodicidade)}
                  aria-label={`Ver o detalhe de ${item.parameterName}`}
                  className="w-full text-left rounded px-1.5 py-1 -mx-1.5 hover:bg-accent transition-colors"
                >
                  <span className="flex-1 min-w-0 block">
                    <span
                      className="block text-sm font-semibold truncate"
                      title={item.parameterName}
                    >
                      {item.parameterName}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {item.familyName} · {contar(item.changes, "alteração", "alterações")} em{" "}
                      {contar(item.vehicles, "ativo", "ativos")}
                    </span>
                  </span>
                  <span className="mt-1.5 h-2 w-full block overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", barra)}
                      style={{ width: `${Math.max(2, (Math.abs(item.valor) / teto) * 100)}%` }}
                    />
                  </span>
                  <span className={cn("mt-1 block text-xs font-bold tabular-nums", cor)}>
                    {formatBrlShort(item.valor)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {itens.length > TOPO && (
            <p className="mt-2.5 text-xs text-muted-foreground">
              + {contar(itens.length - TOPO, "outro parâmetro", "outros parâmetros")}{" "}
              {ganho ? "somando" : "tirando"} menos que os acima.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** `3 alterações`, `1 alteração` — o número por extenso com a palavra que ele rege. */
export function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
