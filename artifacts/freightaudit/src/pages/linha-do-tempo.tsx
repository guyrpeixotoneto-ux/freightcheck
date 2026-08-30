import { useEffect, useMemo } from "react";
import { Layers, Truck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEITURA_DE_APURACAO } from "@/lib/frescor-das-leituras";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { ApiError, fetchJson } from "@/lib/api";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { LINHA_DO_TEMPO } from "@/lib/ambiente";
import { opcoesDoIntervalo } from "@/lib/intervalo-da-linha-do-tempo";
import { cn } from "@/lib/utils";
import { LinhaDoTempoDeImpacto } from "@/components/linha-do-tempo/linha-do-tempo-de-impacto";
import { LinhaDoTempoDeAlteracoes } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import { LinhaDoTempoConsolidada } from "@/components/linha-do-tempo/linha-do-tempo-consolidada";
import { nomeDaUnidade } from "@/lib/recorte";
import { useVoltaDeVigencia } from "@/components/vigencia/voltar-de-vigencia";
import { VisaoGeralConteudo } from "@/components/inicio/visao-geral-consolidada";
import {
  SeletorDeVigencia,
  SeletorDeVigenciaGeral,
} from "@/components/vigencia/seletor-de-vigencia";
import { AbaBotao } from "@/components/changes/cartoes";
import { ehTipoDaLinhaDoTempo, type TipoDaLinhaDoTempo } from "@workspace/comparison/tipos";
import { useAmbiente } from "@/lib/ambiente-aberto";
import {
  contracaoDoTipo,
  equipamentosDoAmbiente,
  nomeDaAbaPorTipo,
  palavrasDoTipo,
  rotuloDoTipo,
} from "@/lib/frota";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";

/**
 * Linha do Tempo — o histórico de vigências da unidade aberta.
 *
 * Tela própria, e não mais um cartão dentro do Resumo executivo: lá o cartão
 * disputava rolagem com os cinco números do instante atual, e aqui a
 * pergunta é outra — como o impacto se moveu vigência a vigência, e o que
 * mudou em cada uma. Cada linha do histórico agora leva até as alterações
 * daquela vigência, o que faltava quando isto era só um cartão de leitura.
 *
 * A unidade e o canal moram na URL, como no Resumo executivo: o seletor da
 * lateral (`components/layout/sidebar.tsx`) é o que permite ver a linha do
 * tempo de outra unidade, ou a Visão Geral, sem sair da tela.
 *
 * Duas abas, e as duas percorrem o mesmo histórico:
 *
 * - **Geral** é a leitura de sempre — a frota inteira, cavalo e carreta
 *   somados, sem o trecho (que vive numa série própria).
 * - **Cavalo, Carreta e Trecho** é o mesmo histórico com a população trocada:
 *   um tipo de cada vez. Trocar de população, e não filtrar a lista, é o que
 *   faz o placar do topo, o gráfico e a gaveta falarem todos do mesmo
 *   universo — quem recorta é o servidor (`getRangeAnalysis`), pela mesma
 *   razão que `lib/escopos.ts` dá para o Cavalo 360°: `vehiclesTouched` são
 *   ativos distintos, e uma soma feita na tela daria mais caminhões do que a
 *   frota tem.
 *
 * **Quais tipos a segunda aba oferece é do ambiente aberto.** Cavalo, carreta e
 * trecho são o que a empurrada roda; o Rota e o AS rodam com caminhão e
 * carroceria, e o Apoio com empilhadeira. A lista é `EQUIPAMENTOS_DO_AMBIENTE`
 * (`lib/frota.ts`), a mesma que o menu, as telas 360° e o Painel de
 * Justificativas leem — uma aba escrita à mão com os três nomes da empurrada
 * ficaria certa numa auditoria e prometeria, nas outras, filas que a operação
 * não tem.
 *
 * O que o servidor **aceita** é outra lista, e mais larga: os seis
 * equipamentos (`TIPOS_DA_LINHA_DO_TEMPO`, em `@workspace/comparison/tipos`),
 * que é quem explica por que conjunto e QLP ficam de fora. As duas se encaixam
 * — o ambiente escolhe dentro do que o recorte aceita —, e é esse encaixe que
 * impede uma auditoria de ter aba que o servidor recusa.
 */
export default function LinhaDoTempo() {
  const ambiente = useAmbiente();
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);

  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";

  /*
    "Visão Geral" é uma opção de unidade — vive no seletor da lateral —
    nunca um valor de `period`. Ver a mesma decisão em `inicio.tsx`.
  */
  const visaoGeral = parametros.get("visaoGeral") === "1";

  /*
    Qual aba, e — na segunda — qual tipo. As duas moram na URL, como a vigência
    e a unidade: uma leitura desta tela é para ser colada num chat e continuar
    querendo dizer a mesma coisa do outro lado.

    `?tipo=` fora dos três cai em Cavalo, e não em erro nem em tela vazia: é a
    mesma régua de `ehFiltroDeTipo` e `ehEscopo`, que já protegem os outros
    recortes de um endereço adulterado. A aba Geral é o padrão, e por isso não
    se escreve no endereço — um `?aba=geral` em todo link do produto é ruído
    que não muda nada.
  */
  const equipamentos = equipamentosDoAmbiente(ambiente);
  const porTipo = parametros.get("aba") === "tipos";
  const tipoPedido = parametros.get("tipo");
  /*
    O `?tipo=` vale quando é um equipamento **deste ambiente**: um endereço de
    empurrada aberto no Rota pediria cavalo a uma auditoria que só tem caminhão,
    e honrá-lo daria uma tela vazia sob uma pastilha que ninguém pode desmarcar.
    Fora disso, o primeiro da lista do ambiente. `ehTipoDaLinhaDoTempo` continua
    sendo a régua do que o servidor aceita — as duas condições, e não uma.
  */
  const tipo: TipoDaLinhaDoTempo =
    tipoPedido !== null &&
    ehTipoDaLinhaDoTempo(tipoPedido) &&
    (equipamentos as readonly string[]).includes(tipoPedido)
      ? tipoPedido
      : equipamentos[0];

  const vigencia = useQuery({
    queryKey: ["families", "linha-do-tempo", consulta.toString()],
    enabled: !visaoGeral,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families${sufixo}`);
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
    /*
      Uma vigência fechada não muda entre duas importações, e esta leitura é a
      primeira de uma cascata: enquanto ela não responde, nada mais desta tela
      pode sair. Sem `staleTime`, voltar para cá refazia a chamada inteira —
      e refazia a espera junto. O minuto é o mesmo das outras leituras da
      tela; uma importação nova invalida a chave, não o relógio.

      O `placeholderData` que acompanha o minuto é o que faltava: a chave
      carrega o recorte, e trocar de unidade a esvaziava. A constante mora em
      `lib/frescor-das-leituras.ts` — o minuto não mudou, ganhou nome.
    */
    ...LEITURA_DE_APURACAO,
  });

  const contextos = useContextosDaCasca();
  const view = visaoGeral ? null : (vigencia.data ?? null);

  /*
    O intervalo, pedido antes de a vigência responder.

    `periods` e `currentPeriod` — as duas pontas que `/changes/range` precisa —
    chegam hoje pelo `/changes/families` acima, e é só por isso que a leitura
    do intervalo esperava por ele: duas ondas em série para uma dependência que
    é só de dois valores. Mas esses dois valores já estão em `/contexts`, que a
    casca carrega para montar a lateral e que a esta altura está no cache
    (`periodosDisponiveis`, `latestPeriod`).

    Então a página pergunta na hora, com a mesma chave que os dois cartões vão
    usar (`opcoesDoIntervalo`): quando eles montarem, a resposta já está no
    cache ou a caminho. As duas leituras caras da tela passam a sair juntas em
    vez de uma atrás da outra.

    A régua de resolução é a do servidor, e precisa continuar sendo — uma ponta
    diferente aqui não daria resposta errada, mas viraria uma segunda chamada
    cara em vez de um prefetch aproveitado. Contexto pedido, ou o primeiro da
    lista (o padrão de `resolveContext`); competência pedida só se ela existe
    no histórico daquele contexto, senão a mais recente dele (o padrão de
    `getRangeAnalysis`).
  */
  const cliente = useQueryClient();
  const contextoAberto = useMemo(() => {
    if (visaoGeral || contextos.contextos.length === 0) return null;
    const scopeHash = parametros.get("scopeHash");
    const canal = parametros.get("canal");
    if (scopeHash === null && canal === null) return contextos.contextos[0];
    return (
      contextos.contextos.find(
        (c) =>
          (scopeHash === null || c.scopeHash === scopeHash) &&
          (canal === null || c.channel === canal),
      ) ?? null
    );
  }, [visaoGeral, contextos.contextos, search]);

  const chaveDaConsulta = consulta.toString();
  useEffect(() => {
    if (!contextoAberto) return;
    const historico = contextoAberto.periodosDisponiveis;
    if (historico.length <= 1) return;
    const pedida = parametros.get("period");
    const fim =
      pedida !== null && historico.includes(pedida)
        ? pedida
        : contextoAberto.latestPeriod;
    void cliente.prefetchQuery(
      opcoesDoIntervalo(
        new URLSearchParams(chaveDaConsulta),
        historico[0],
        fim,
        // A aba aberta faz parte da pergunta: adiantar a leitura sem recorte
        // enquanto a tela vai pedir a de cavalo seria pagar duas chamadas
        // caras para usar uma.
        porTipo ? tipo : null,
      ),
    );
    // `chaveDaConsulta` é a forma estável de `consulta`; `parametros` sai dela.
  }, [cliente, contextoAberto, chaveDaConsulta, porTipo, tipo]);

  /*
    A união de competências de todas as unidades — o mesmo cálculo de
    `inicio.tsx`, para "Ir para vigência" oferecer datas que pelo menos uma
    unidade tem, em vez do histórico de uma unidade só.
  */
  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [contextos.contextos],
  );

  /*
    Sem `?period=` abre na competência **mais recente**: `periodosOverview` vem
    em ordem decrescente, e pegar a última da lista abria a tela na competência
    mais antiga do histórico — a que não tem vigência anterior contra a qual ser
    comparada, e por isso não tem alteração nenhuma a mostrar.
  */
  const periodoOverviewEfetivo = parametros.get("period") ?? periodosOverview[0] ?? null;

  /*
    A Visão Geral aqui soma só o último passo comum — a competência pedida
    contra a vigência imediatamente anterior de cada unidade, o mesmo
    `ExecutiveSummary` que o Resumo executivo já consolida. Não é um
    histórico: é o mesmo `/changes/families/overview`, reaproveitado.
  */
  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, {
    enabled: visaoGeral,
  });

  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;

  /*
    De onde a leitura saiu, para o botão de voltar do cartão de gráficos. Mora
    aqui porque trocar a vigência refaz a consulta e desmonta o cartão
    enquanto ela não responde.
  */
  const volta = useVoltaDeVigencia({
    periodo: view?.period ?? null,
    label: view?.periods.find((p) => p.date === view.period)?.label ?? null,
  });

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${LINHA_DO_TEMPO}?${texto}` : LINHA_DO_TEMPO);
  };

  return (
    <Layout>
      <Cabecalho
        view={view}
        overview={overview}
        tipo={porTipo ? tipo : null}
        visaoGeral={visaoGeral}
        periodosOverview={periodosOverview}
        consulta={consulta}
        onTrocar={trocarPara}
        atualizando={
          visaoGeral ? overviewQuery.isPlaceholderData : vigencia.isPlaceholderData
        }
      />

      <div className="px-8 border-b">
        <nav className="flex items-center gap-1 max-w-[1600px]" role="tablist">
          <AbaBotao
            active={!porTipo}
            onClick={() => trocarPara({ aba: null, tipo: null })}
            icon={<Layers className="w-4 h-4" />}
            label="Geral"
            hint="a frota inteira, cavalo e carreta somados"
          />
          <AbaBotao
            active={porTipo}
            onClick={() => trocarPara({ aba: "tipos" })}
            icon={<Truck className="w-4 h-4" />}
            label={nomeDaAbaPorTipo(equipamentos)}
            hint="o mesmo histórico, um tipo de cada vez"
          />
        </nav>
      </div>

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {porTipo ? (
          <AbaPorTipo
            tipo={tipo}
            equipamentos={equipamentos}
            onTrocarTipo={(escolhido) => trocarPara({ tipo: escolhido })}
            visaoGeral={visaoGeral}
            vigencia={vigencia}
            view={view}
            consulta={consulta}
            onEscolherVigencia={(periodo) => {
              volta.registrar();
              trocarPara({ period: periodo });
            }}
            voltarPara={volta.destino}
            onVoltar={(periodo) => {
              volta.limpar();
              trocarPara({ period: periodo });
            }}
          />
        ) : visaoGeral ? (
          <>
            {/*
              O histórico somado entre unidades vem primeiro, e não depende da
              leitura de competência abaixo: é ele que responde à pergunta que
              traz alguém a esta tela — como o impacto se moveu vigência a
              vigência —, agora também quando a unidade escolhida é "todas".
            */}
            <LinhaDoTempoConsolidada periodos={periodosOverview} ate={periodoOverviewEfetivo} />

            {overviewQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a Visão Geral…</p>
            )}
            {overviewQuery.error && (
              <ApiErrorNotice
                error={overviewQuery.error}
                what="Não foi possível montar a Visão Geral."
              />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && (
              <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
                Nenhuma unidade tem vigência importada nesta competência.
              </section>
            )}
            {overview && (
              <div className={cn("space-y-5", classeDeAtualizacao(overviewQuery.isPlaceholderData))}>
                <div className="pt-2">
                  <h2 className="text-base font-bold leading-tight">
                    A competência aberta, unidade a unidade
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Só o último passo — a competência aberta contra a vigência imediatamente
                    anterior de cada unidade —, para comparar unidade com unidade e entrar no
                    detalhe de uma delas. O histórico inteiro é o da linha do tempo acima.
                  </p>
                </div>
                <VisaoGeralConteudo
                  overview={overview}
                  search={search}
                  onTrocar={trocarPara}
                  notaExtra="Este bloco soma só o último passo — a competência contra a vigência imediatamente anterior de cada unidade. O histórico inteiro está na linha do tempo acima."
                />
              </div>
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
            )}

            {vigencia.error && (
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar a linha do tempo." />
            )}

            {!vigencia.isLoading && !vigencia.error && view === null && (
              <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
                Nenhuma vigência importada ainda para este recorte.
              </section>
            )}

            {view && (
              <div className={cn("space-y-5", classeDeAtualizacao(vigencia.isPlaceholderData))}>
              <LinhaDoTempoDeImpacto
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
              />

              <LinhaDoTempoDeAlteracoes
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
                onEscolherVigencia={(periodo) => {
                  volta.registrar();
                  trocarPara({ period: periodo });
                }}
                voltarPara={volta.destino}
                onVoltar={(periodo) => {
                  volta.limpar();
                  trocarPara({ period: periodo });
                }}
              />
              </div>
            )}

            {view && view.periods.length <= 1 && (
              <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
                Esta unidade tem uma vigência só no histórico — a linha do tempo
                compara vigência com vigência, e ainda não há com o que comparar.
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// A aba de tipo — Cavalo, Carreta e Trecho
// ---------------------------------------------------------------------------

/**
 * O mesmo histórico da aba Geral, com a população trocada.
 *
 * Os dois cartões são exatamente os da aba Geral — não há uma segunda linha do
 * tempo escrita aqui, e não deveria haver: a pergunta é a mesma, e duas
 * implementações dela discordariam no dia em que uma das duas mudasse. O que
 * muda é o `tipo`, que viaja até `/changes/range` e recorta a leitura no
 * servidor.
 *
 * A Visão Geral fica de fora, e não é lacuna a preencher depois: o recorte por
 * tipo vive na leitura de **uma** unidade (`/changes/range`), e a soma entre
 * unidades (`/changes/range/overview`) não sabe recortar. Somar na tela o que o
 * servidor não somou daria um placar que não fecha com nenhuma das unidades —
 * a tela prefere dizer o que falta e mostrar o caminho.
 */
function AbaPorTipo({
  tipo,
  equipamentos,
  onTrocarTipo,
  visaoGeral,
  vigencia,
  view,
  consulta,
  onEscolherVigencia,
  voltarPara,
  onVoltar,
}: {
  tipo: TipoDaLinhaDoTempo;
  /**
   * Os equipamentos do ambiente aberto — ver `EQUIPAMENTOS_DO_AMBIENTE`.
   *
   * São `TipoDaLinhaDoTempo` porque a lista do ambiente é sempre um
   * subconjunto do que o recorte aceita: os seis equipamentos, menos o QLP.
   * Quem garante isso é `equipamentos-do-ambiente.test.ts`, e não este tipo —
   * ele só recusa que alguém passe outra lista por aqui sem reparar.
   */
  equipamentos: readonly TipoDaLinhaDoTempo[];
  onTrocarTipo: (tipo: TipoDaLinhaDoTempo) => void;
  visaoGeral: boolean;
  vigencia: { isLoading: boolean; error: unknown; isPlaceholderData: boolean };
  view: FamiliesView | null;
  consulta: URLSearchParams;
  /** O clique num ponto leva a tela para aquela vigência — igual à aba Geral. */
  onEscolherVigencia: (periodo: string) => void;
  voltarPara: { periodo: string; label: string } | null;
  onVoltar: (periodo: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">
          Tipo
        </span>
        {equipamentos.map((code) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={code === tipo}
            onClick={() => onTrocarTipo(code)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-bold transition-colors",
              code === tipo
                ? "border-brand bg-brand text-white"
                : "bg-card hover:bg-accent",
            )}
          >
            {rotuloDoTipo(code)}
          </button>
        ))}
      </div>

      {/* O mesmo vocabulário de frota do Painel de Justificativas — as duas
          telas dizem "dos cavalos" e "das carretas" pela mesma função. */}
      <p className="text-sm text-muted-foreground">
        Tudo abaixo — o placar, a evolução vigência a vigência e a gaveta de
        detalhe — fala só {contracaoDoTipo(tipo, "de")} {palavrasDoTipo(tipo).plural}.
      </p>

      {visaoGeral ? (
        <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
          A leitura por tipo é de uma unidade de cada vez — a soma entre
          unidades não sabe recortar por cavalo, carreta ou trecho, e somá-la
          aqui daria um placar que não fecha com o de nenhuma delas. Escolha uma
          unidade no seletor da lateral, ou volte para a aba Geral.
        </section>
      ) : (
        <>
          {vigencia.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
          )}

          {vigencia.error !== null && vigencia.error !== undefined && (
            <ApiErrorNotice
              error={vigencia.error}
              what="Não foi possível montar a linha do tempo."
            />
          )}

          {!vigencia.isLoading && !vigencia.error && view === null && (
            <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
              Nenhuma vigência importada ainda para este recorte.
            </section>
          )}

          {view && (
            <div
              className={cn(
                "space-y-5",
                classeDeAtualizacao(vigencia.isPlaceholderData),
              )}
            >
              <LinhaDoTempoDeImpacto
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
                tipo={tipo}
              />

              <LinhaDoTempoDeAlteracoes
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
                tipo={tipo}
                onEscolherVigencia={onEscolherVigencia}
                voltarPara={voltarPara}
                onVoltar={onVoltar}
              />
            </div>
          )}

          {view && view.periods.length <= 1 && (
            <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
              Esta unidade tem uma vigência só no histórico — a linha do tempo
              compara vigência com vigência, e ainda não há com o que comparar.
            </section>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// O cabeçalho
// ---------------------------------------------------------------------------

function Cabecalho({
  view,
  overview,
  tipo,
  visaoGeral,
  periodosOverview,
  consulta,
  onTrocar,
  atualizando,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  /** O tipo aberto, quando a aba é a de tipo. Vira uma das partes da linha. */
  tipo: TipoDaLinhaDoTempo | null;
  visaoGeral: boolean;
  periodosOverview: string[];
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  /** O corpo ainda é o recorte anterior — ver `components/ui/em-atualizacao.tsx`. */
  atualizando: boolean;
}) {
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const partes = visaoGeral
    ? [
        overview
          ? `${overview.unitsIncluded.length} de ${overview.unitsIncluded.length + overview.unitsExcluded.length} unidades incluídas`
          : null,
        /*
          A mesma linha que a unidade traz — "N vigências no histórico" —, aqui
          sobre a união das competências: é o eixo que a linha do tempo
          consolidada percorre.
        */
        periodosOverview.length > 0
          ? `${periodosOverview.length} ${periodosOverview.length === 1 ? "vigência" : "vigências"} no histórico`
          : null,
      ].filter((p): p is string => p !== null)
    : [
        view?.context.channel ?? null,
        tipo ? rotuloDoTipo(tipo) : null,
        view
          ? `${view.periods.length} ${view.periods.length === 1 ? "vigência" : "vigências"} no histórico`
          : null,
      ].filter((p): p is string => p !== null);

  return (
    <header className="px-8 pt-7 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight">
              Linha do Tempo — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
            </h1>
            <EmAtualizacao ativo={atualizando} />
          </div>
          {partes.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1.5">{partes.join(" · ")}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {visaoGeral
            ? (
                <SeletorDeVigenciaGeral
                  periodos={periodosOverview}
                  ativa={overview?.period ?? null}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                  rotulo="Ir para vigência"
                />
              )
            : (
                <SeletorDeVigencia
                  view={view}
                  consulta={consulta}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                  rotulo="Ir para vigência"
                />
              )}
        </div>
      </div>
    </header>
  );
}

const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";
