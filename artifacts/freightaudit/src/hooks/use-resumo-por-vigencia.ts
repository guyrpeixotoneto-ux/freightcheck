import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
import type { Movimentos } from "@/lib/analise";
import type { FamiliesView } from "@/components/inicio/types";

/** O que o seletor de vigência diz de uma vigência, além do nome dela. */
export interface ResumoDaVigencia {
  alteracoes: number;
  /**
   * O líquido da vigência na periodicidade da coluna — `null` quando ela não
   * apurou nada nessa periodicidade.
   *
   * `null` e `0` são fatos diferentes, e a lista escreve os dois de formas
   * diferentes: "nada apurado aqui" não vira `R$ 0`, que é o saldo de uma
   * vigência em que ganhos e perdas se anularam.
   */
  impacto: number | null;
}

/**
 * A coluna inteira do seletor: uma linha por vigência e a periodicidade em que
 * o impacto está escrito.
 *
 * A periodicidade é **uma só para a lista toda**, e não uma por linha. R$/mês e
 * R$/ano não se comparam — uma coluna que alternasse entre as duas conforme a
 * vigência convidaria a ler `−R$ 30.000` acima de `−R$ 2.500` como "doze vezes
 * pior" quando o de cima é anual e o de baixo é mensal. Escolhida uma, as
 * outras não somem caladas: quem quiser vê-las abre a Linha do Tempo, que é a
 * tela que separa periodicidade a periodicidade.
 */
export interface ResumoDasVigencias {
  porVigencia: Map<string, ResumoDaVigencia>;
  /** `null` quando nenhuma vigência do intervalo tem impacto apurado. */
  periodicidade: string | null;
}

/** O que a série de um intervalo precisa ter para virar coluna — `RangeMovement` e `RangeOverviewPoint`. */
export interface LinhaDoIntervalo {
  period: string;
  changes: number;
  impact: { byPeriodicity: Record<string, number> };
}

/**
 * A periodicidade que manda na coluna, e a coluna escrita nela.
 *
 * Dominante é a que **mais moveu dinheiro no intervalo** — soma dos módulos,
 * não do líquido: uma periodicidade em que ganhos e perdas se anulam moveu
 * tudo o que moveu, e um líquido perto de zero não a torna irrelevante. É a
 * mesma régua de `impactosDaVigencia` e da série do Dashboard, para que o
 * menu não abra numa periodicidade e o gráfico atrás dele em outra.
 *
 * O desempate por nome existe só para a escolha ser estável entre duas
 * renderizações com o mesmo dado; empate exato entre periodicidades é raro e
 * não tem resposta melhor.
 */
export function resumirIntervalo(linhas: readonly LinhaDoIntervalo[]): ResumoDasVigencias {
  const movimento = new Map<string, number>();
  for (const linha of linhas) {
    for (const [periodicidade, valor] of Object.entries(linha.impact.byPeriodicity)) {
      movimento.set(periodicidade, (movimento.get(periodicidade) ?? 0) + Math.abs(valor));
    }
  }

  const dominante =
    [...movimento.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  return {
    periodicidade: dominante,
    porVigencia: new Map(
      linhas.map((linha) => [
        linha.period,
        {
          alteracoes: linha.changes,
          // `?? null`, e não `?? 0`: o balde ausente é a vigência sem valor
          // apurado nesta periodicidade, e a lista não inventa um saldo zero
          // para preencher a coluna.
          impacto: dominante === null ? null : (linha.impact.byPeriodicity[dominante] ?? null),
        },
      ]),
    ),
  };
}

/**
 * Quantas alterações cada vigência do histórico carrega e quanto elas somaram —
 * a mesma leitura que a Linha do Tempo já faz via `/changes/range`, aqui só
 * reaproveitada para o dropdown de troca de vigência.
 *
 * A vigência mais antiga do histórico não entra no mapa: não há uma anterior
 * contra a qual compará-la, então nem "quantas alterações" nem "quanto custou"
 * são perguntas com resposta para ela.
 */
export function useResumoPorVigencia(
  view: FamiliesView | null,
  consulta: URLSearchParams,
): ResumoDasVigencias {
  const ordenadas = useMemo(
    () => (view ? [...view.periods].sort((a, b) => a.date.localeCompare(b.date)) : []),
    [view],
  );

  const query = new URLSearchParams(consulta);
  query.delete("period");
  if (ordenadas.length > 0 && view) {
    query.set("from", ordenadas[0].date);
    query.set("to", view.period);
  }

  /*
    Mesma chave de `LinhaDoTempoDeImpacto` e `LinhaDoTempoDeAlteracoes` — as
    três leem `/changes/range` do início ao fim do histórico do contexto no
    carregamento inicial da tela. Chaves próprias por componente faziam o
    React Query disparar a mesma requisição cara três vezes; com a chave
    alinhada por parâmetros, a primeira a resolver serve as outras duas do
    cache.
  */
  const movimentos = useQuery({
    queryKey: ["changes-range", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    enabled: ordenadas.length > 1,
    staleTime: 60_000,
  });

  // `?? []` e não `movimentos.data ?`: a resposta pode vir sem a série (é o
  // que `fetchJsonOrNull` devolve num 204, e o que um servidor de teste
  // devolve quando só o resto do corpo interessa), e a lista abre com as
  // vigências e sem as colunas em vez de derrubar o cabeçalho da tela.
  return useMemo(() => resumirIntervalo(movimentos.data?.movements ?? []), [movimentos.data]);
}

/**
 * O mesmo resumo em Visão Geral — somado entre todas as unidades.
 *
 * Vem de `/changes/range/overview`, que já lê o intervalo inteiro por unidade
 * × contexto para o ranking "Onde está o impacto?" da Linha do Tempo e devolve
 * `changes` e `impact` por competência na série consolidada. Somar no
 * navegador exigiria a lista de alterações de N unidades para escrever seis
 * linhas.
 *
 * `habilitado` existe porque essa leitura é cara: os quatro cabeçalhos que
 * abrem este seletor (Visão Geral, Linha do Tempo, Dashboard e Gestão à Vista)
 * a disparam **quando o menu abre**, e não ao carregar a tela. O menu já está
 * em tela quando a resposta chega; as colunas aparecem com ela, como no
 * seletor da unidade enquanto `/changes/range` não voltou.
 *
 * Onde a tela já faz essa mesma leitura por conta própria — o Dashboard em
 * Visão Geral, para o gráfico de impacto por vigência, e a Linha do Tempo,
 * para o ranking entre unidades —, a chave compartilhada
 * (`opcoesDoIntervaloGeral`) faz o resumo já estar no cache: lá o menu abre
 * preenchido, sem esperar requisição nenhuma.
 */
export function useResumoPorVigenciaGeral(
  periodos: string[],
  habilitado = true,
): ResumoDasVigencias {
  const ordenadas = useMemo(() => [...periodos].sort((a, b) => a.localeCompare(b)), [periodos]);

  /*
    A mesma chave de `LinhaDoTempoDeImpacto` e do gráfico do Dashboard em
    Visão Geral (`opcoesDoIntervaloGeral`) — quando as pontas do intervalo
    coincidem, uma resposta serve as três em vez de três varreduras iguais do
    histórico inteiro. É por esse compartilhamento que o resumo do menu do
    Dashboard já está no cache quando alguém abre o menu.
  */
  const overview = useQuery({
    ...opcoesDoIntervaloGeral(
      ordenadas[0] ?? null,
      ordenadas[ordenadas.length - 1] ?? null,
    ),
    enabled: habilitado && ordenadas.length > 1,
  });

  return useMemo(() => resumirIntervalo(overview.data?.serie ?? []), [overview.data]);
}
