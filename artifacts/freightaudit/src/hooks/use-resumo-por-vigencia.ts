import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { periodicitySuffix } from "@workspace/comparison/labels";
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
  /**
   * As periodicidades em que esta vigência **tem** dinheiro, quando a da
   * coluna não é uma delas.
   *
   * Existe para a linha muda poder dizer por que está muda. Uma vigência com
   * `impacto: null` e esta lista cheia não é uma vigência sem impacto: é uma
   * vigência cujo impacto está escrito noutra régua, e a coluna — que é de uma
   * régua só, ver `periodicidade` — não tem onde publicá-lo. Sem isso a linha
   * fica igual à da vigência que realmente não apurou nada, e as duas são
   * fatos diferentes.
   *
   * Vazia quando a vigência tem o balde da coluna, ou quando não tem balde
   * nenhum.
   */
  outrasPeriodicidades: string[];
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
  /**
   * As vigências que estão importadas e **não** têm comparação — as `gaps` da
   * leitura do intervalo.
   *
   * Elas nunca aparecem em `porVigencia`, e é por isso que este conjunto
   * precisa existir: sem ele, "não comparada" e "ainda não li" são a mesma
   * linha vazia na tela, e quem lê conclui o que quiser da ausência — em
   * geral, que a vigência não foi importada, que é o contrário do que houve.
   */
  semComparacao: Set<string>;
  /**
   * A vigência mais antiga da leitura — a ponta de partida do intervalo.
   *
   * Ela também sai sem números, e pela terceira razão possível: é a primeira
   * do histórico, não há uma anterior contra a qual compará-la. Não é lacuna
   * (não há comparação faltando) e não é falta de leitura; é a régua.
   *
   * `null` enquanto a leitura não chegou — e é esse `null` que impede a tela
   * de chamar de "primeira do histórico" a linha que ela só ainda não leu.
   */
  primeira: string | null;
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
 * ---------------------------------------------------------------------------
 * Dominante é a que aparece em **mais vigências**, e não a que moveu mais
 * dinheiro
 * ---------------------------------------------------------------------------
 * Era o volume, e a régua parecia óbvia: a periodicidade que virou o intervalo
 * do avesso é a que merece a coluna. O que ela produzia, medido em Camaçari em
 * 17/09/2026: uma única vigência com −R$ 590.438/ano ganhava de oito vigências
 * com dezenas de milhares de reais **por mês** cada, e a coluna saía escrita
 * em R$/ano — muda em nove das onze linhas, porque as outras não têm balde
 * anual. Um menu em branco não diz "esta régua não se aplica aqui"; diz "não
 * teve nada", que é falso, e que o FINAME desmentia na tela ao lado.
 *
 * A cobertura não tem esse defeito: ela pergunta em quantas vigências aquela
 * régua **existe**, que é exatamente a pergunta de quem escolhe uma coluna
 * para comparar linhas. O volume continua no desempate, e é ele que decide
 * entre duas periodicidades igualmente presentes — ali a régua antiga estava
 * certa, e continua: soma dos módulos, não do líquido, porque uma
 * periodicidade em que ganhos e perdas se anularam moveu tudo o que moveu.
 *
 * Quem tem dinheiro fora da coluna não some: a linha diz em que régua ele está
 * (`outrasPeriodicidades`, e a nota que `motivoSemNumeros` escreve a partir
 * dela). A recusa que não muda é a de misturar as duas numa coluna só — R$/mês
 * e R$/ano não se comparam, e uma coluna que alternasse convidaria a ler
 * −R$ 30.000/ano acima de −R$ 2.500/mês como "doze vezes pior".
 *
 * O desempate por nome existe só para a escolha ser estável entre duas
 * renderizações com o mesmo dado; empate exato é raro e não tem resposta
 * melhor.
 */
export function resumirIntervalo(
  linhas: readonly LinhaDoIntervalo[],
  contorno?: {
    /** As vigências importadas sem comparação — `gaps` de `/changes/range`. */
    gaps?: readonly { period: string }[];
    /** A ponta de partida que o servidor resolveu para o intervalo. */
    inicio?: string | null;
  },
): ResumoDasVigencias {
  const movimento = new Map<string, number>();
  const vigencias = new Map<string, number>();
  for (const linha of linhas) {
    for (const [periodicidade, valor] of Object.entries(linha.impact.byPeriodicity)) {
      movimento.set(periodicidade, (movimento.get(periodicidade) ?? 0) + Math.abs(valor));
      vigencias.set(periodicidade, (vigencias.get(periodicidade) ?? 0) + 1);
    }
  }

  const dominante =
    [...movimento.entries()].sort(
      (a, b) =>
        // Em quantas vigências ela existe — ver o cabeçalho.
        (vigencias.get(b[0]) ?? 0) - (vigencias.get(a[0]) ?? 0) ||
        // Empatadas na presença, decide o que moveu.
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    )[0]?.[0] ?? null;

  return {
    periodicidade: dominante,
    semComparacao: new Set((contorno?.gaps ?? []).map((g) => g.period)),
    primeira: contorno?.inicio ?? null,
    porVigencia: new Map(
      linhas.map((linha) => {
        // `?? null`, e não `?? 0`: o balde ausente é a vigência sem valor
        // apurado nesta periodicidade, e a lista não inventa um saldo zero
        // para preencher a coluna.
        const impacto = dominante === null ? null : (linha.impact.byPeriodicity[dominante] ?? null);
        return [
          linha.period,
          {
            alteracoes: linha.changes,
            impacto,
            /*
              **Todas** as outras periodicidades em que esta vigência tem
              dinheiro — e não só quando a coluna ficou vazia.

              Era só no caso vazio, com o argumento de não roubar a atenção do
              número publicado. O preço disso apareceu no dado real: julho/2026
              tem `MENSAL −11.712,30` **e** `ANUAL −144.874,50`, a coluna é
              mensal, e o anual — dez vezes maior — não aparecia em lugar
              nenhum desta lista. Não roubar a atenção não vale esconder a
              maior parte do dinheiro; a linha secundária é discreta, e existir
              é o mínimo.
            */
            outrasPeriodicidades: Object.entries(linha.impact.byPeriodicity)
              .filter(([p, valor]) => p !== dominante && valor !== 0)
              .map(([p]) => p)
              .sort(),
          },
        ];
      }),
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
  return useMemo(
    () =>
      resumirIntervalo(movimentos.data?.movements ?? [], {
        gaps: movimentos.data?.gaps,
        // A ponta vem da resposta, e não de `ordenadas[0]`: é o servidor quem
        // resolve `from` contra o histórico do contexto, e é a ponta que ele
        // leu que a lista precisa marcar como primeira.
        inicio: movimentos.data?.from ?? null,
      }),
    [movimentos.data],
  );
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
 * A leitura sai **com a tela**, como a do seletor da unidade — e não na
 * abertura do menu. Ela já esperou o clique, e o que isso produzia era um menu
 * que abre sem as duas colunas e as ganha um segundo depois, debaixo do cursor
 * de quem já estava escolhendo: os números existem para decidir a escolha, e
 * chegar depois dela é chegar tarde.
 *
 * O custo dessa antecipação é menor do que parece. Onde a tela já faz essa
 * mesma leitura por conta própria — o Dashboard em Visão Geral, para o gráfico
 * de impacto por vigência, e a Linha do Tempo, para o ranking entre unidades —,
 * a chave compartilhada (`opcoesDoIntervaloGeral`) faz as duas virarem uma só
 * resposta; nas outras, é uma requisição por tela, servida do cache por
 * `staleTime` no resto da navegação.
 */
export function useResumoPorVigenciaGeral(periodos: string[]): ResumoDasVigencias {
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
    enabled: ordenadas.length > 1,
  });

  return useMemo(
    () =>
      resumirIntervalo(overview.data?.serie ?? [], {
        gaps: overview.data?.gaps,
        inicio: overview.data?.from ?? null,
      }),
    [overview.data],
  );
}

/**
 * O que escrever na linha de uma vigência que saiu sem números — e quando não
 * escrever nada.
 *
 * A linha em branco era ambígua por construção. Três coisas diferentes
 * produzem uma: a vigência está importada e ninguém a comparou; ela é a
 * primeira do histórico e não tem anterior; ou a leitura do intervalo ainda
 * não chegou. As três somem na mesma ausência, e quem lê preenche o silêncio
 * sozinho — a leitura mais natural é "esse mês não teve importação", que é
 * justamente a única das três que não pode ser: uma vigência que não foi
 * importada não estaria na lista.
 *
 * Então a lista diz qual das três é, e diz `null` para a terceira: enquanto a
 * leitura não chegou, "não sei ainda" é a verdade, e escrevê-la como "sem
 * comparação" seria trocar uma ambiguidade por uma afirmação falsa que some
 * um segundo depois.
 *
 * Há uma quarta, e ela não deixa a linha inteira em branco — só a metade de
 * cima, a do dinheiro: a vigência apurou impacto, mas noutra periodicidade que
 * não a da coluna. Ali a contagem continua escrita, e sem a nota o espaço
 * vazio acima dela seria lido como "não saiu preço de nada aqui", quando saiu.
 */
/**
 * A grandeza que a coluna **não** publica — a linha discreta sob o número.
 *
 * A coluna é de uma periodicidade só, e essa recusa continua certa: R$/mês e
 * R$/ano não se comparam, e alternar entre as duas na mesma lista convidaria a
 * ler um anual como doze vezes um mensal. O que estava errado era a outra
 * grandeza **sumir**: julho/2026, no export real, tem −R$ 11.712,30/mês na
 * coluna e −R$ 144.874,50/ano fora dela — dez vezes mais dinheiro, invisível.
 *
 * `null` quando a vigência só tem a grandeza da coluna, que é o caso comum.
 */
export function tambemEmOutraPeriodicidade(
  data: string,
  resumo: ResumoDasVigencias,
): { curto: string; porque: string } | null {
  const lida = resumo.porVigencia.get(data);
  if (!lida || lida.impacto === null || lida.outrasPeriodicidades.length === 0) return null;
  const delas = lida.outrasPeriodicidades.map((p) => `R$${periodicitySuffix(p)}`).join(" e ");
  return {
    curto: `+ ${delas}`,
    porque:
      `Esta vigência também apurou impacto em ${delas}, que a coluna não publica — ` +
      `ela é de uma periodicidade só, porque R$/mês e R$/ano não se comparam. ` +
      `A Linha do Tempo separa as duas e mostra as duas.`,
  };
}

export function motivoSemNumeros(
  data: string,
  resumo: ResumoDasVigencias,
): { curto: string; porque: string } | null {
  const lida = resumo.porVigencia.get(data);
  if (lida) {
    const outras = lida.outrasPeriodicidades;
    if (lida.impacto !== null || outras.length === 0 || resumo.periodicidade === null) return null;
    const daColuna = `R$${periodicitySuffix(resumo.periodicidade)}`;
    const delas = outras.map((p) => `R$${periodicitySuffix(p)}`).join(" e ");
    return {
      curto: `sem ${daColuna}`,
      porque:
        `Esta vigência apurou impacto em ${delas}, e não em ${daColuna}. A ` +
        `coluna é de uma periodicidade só — R$/mês e R$/ano não se comparam, e ` +
        `alternar entre as duas na mesma lista convidaria a ler um valor anual ` +
        `como se fosse doze vezes um mensal. A Linha do Tempo separa as duas e ` +
        `mostra as duas.`,
    };
  }
  if (resumo.semComparacao.has(data)) {
    return {
      curto: "sem comparação",
      porque:
        "Vigência importada sem comparação: a comparação com a anterior ainda " +
        "não foi calculada. O que houve aqui não está somado — e não está " +
        "contado como zero.",
    };
  }
  if (resumo.primeira === data) {
    return {
      curto: "primeira do histórico",
      porque:
        "É a vigência mais antiga da leitura: não há uma anterior contra a " +
        "qual compará-la, então nem a contagem nem o impacto são perguntas " +
        "com resposta aqui.",
    };
  }
  return null;
}
