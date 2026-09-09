/**
 * A FROTA, QUINZENA A QUINZENA — quantos veículos ativos e quantos parados, na
 * altura da leitura executiva.
 *
 * **Este módulo é puro, e não é financeiro.** Entram as placas que o Promax
 * reportou em cada quinzena; sai a contagem de cada situação, com a variação
 * entre quinzenas. Nenhuma função daqui soma dinheiro, forma devido ou é
 * importada por `apuracao.ts` — é a mesma fronteira que
 * `frota-promax-comparacao.ts` declara, e pela mesma razão.
 *
 * ---------------------------------------------------------------------------
 * "Parado" é o que o Promax marca como inativo, e o nome disso importa
 * ---------------------------------------------------------------------------
 *
 * Um veículo **parado** aqui é o que aparece no 01.22.08.00 — a frota inativa
 * do Promax — na quinzena. É um retrato de **cadastro**: o veículo está na
 * frota e está marcado como inativo.
 *
 * Não é, e a distinção precisa ficar escrita porque as três leituras convivem
 * neste acervo e discordam de propósito:
 *
 * - não é *"não rodou"* — quem responde por viagem é o diário 2Art
 *   (`fechamento_viagem`), e uma placa ativa no cadastro pode passar a quinzena
 *   sem viagem nenhuma;
 * - não é *"o gap da disponibilidade"* — a frota contratada contra a que rodou
 *   é o 03.08.18, é medida por dia e é a origem dos descontos no fixo
 *   (`fechamento_disponibilidade`). Ali "parado" tem consequência financeira;
 *   aqui não tem nenhuma;
 * - não é *"fora do contrato"* — quantos veículos o contrato declara é a
 *   conferência que `frota-promax-comparacao.ts` já faz, dentro de uma quinzena.
 *
 * Esta leitura responde uma pergunta só, e responde a série dela: **quantos
 * estão ativos e quantos estão parados, quinzena a quinzena**.
 *
 * ---------------------------------------------------------------------------
 * Quinzena sem relatório não é quinzena sem frota
 * ---------------------------------------------------------------------------
 *
 * É o erro que esta leitura existe para não cometer. Se o 01.22.08.00 de uma
 * quinzena não chegou, contar zero parados desenharia uma queda a pique num
 * gráfico — e o que aconteceu foi um arquivo que não veio.
 *
 * Por isso cada quinzena carrega {@link CoberturaDaQuinzena}: quais das duas
 * casinhas do Promax responderam, e quantas unidades do recorte reportaram. A
 * contagem de uma situação cuja fonte não veio é `null`, e `null` atravessa
 * todas as contas derivadas — total, percentual e variação — sem virar zero em
 * nenhuma delas.
 */

/**
 * O teto e o padrão da janela — vocabulário da leitura, e não do banco.
 *
 * Vinte e quatro quinzenas é um ano, e é o que uma tela lê de uma vez; doze é o
 * semestre, que é o recorte com que se abre. Moram aqui, e não na persistência,
 * porque a rota precisa deles para recusar um pedido fora da faixa **antes** de
 * abrir consulta nenhuma.
 */
export const MAXIMO_DE_QUINZENAS = 24;
export const QUINZENAS_POR_PADRAO = 12;

/** As duas situações que o Promax declara. */
export type SituacaoDaFrota = "ATIVA" | "INATIVA";

/** Uma placa reportada numa quinzena, como o relatório a escreveu. */
export interface PlacaReportada {
  /** `2026-07-Q2` — a competência a que esta linha pertence. */
  competencia: string;
  /** A unidade do recorte que reportou esta linha (o código, `081-0443`). */
  unidadeCodigo: string;
  placa: string;
  situacao: SituacaoDaFrota;
}

/** O que uma quinzena recebeu — a diferença entre "não tem" e "não veio". */
export interface CoberturaDaQuinzena {
  /** Unidades do recorte com competência aberta nesta quinzena. */
  unidades: string[];
  /** Dessas, as que enviaram o relatório da frota **ativa**. */
  comFrotaAtiva: string[];
  /** Dessas, as que enviaram o relatório da frota **inativa** (os parados). */
  comFrotaInativa: string[];
}

/** Uma quinzena, já contada. */
export interface QuinzenaDaFrota {
  /** `2026-07-Q2`. */
  competencia: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
  /**
   * Placas distintas marcadas como ativas. `null` quando nenhuma unidade do
   * recorte enviou o relatório da frota ativa — ausência, nunca zero.
   */
  ativos: number | null;
  /** Placas distintas marcadas como inativas. `null` pela mesma razão. */
  parados: number | null;
  /** `ativos + parados`, e `null` se qualquer um dos dois for `null`. */
  total: number | null;
  /** `parados / total`, de 0 a 1. `null` sem os dois números. */
  percentualParado: number | null;
  /**
   * Placas que aparecem nas **duas** situações na mesma quinzena.
   *
   * Elas contam nas duas contagens, porque o relatório as declarou nas duas — e
   * o número fica aqui para que a soma não pareça consistente quando não é.
   * Escolher uma das duas situações seria arbitrar uma contradição do arquivo,
   * que é o que este módulo não faz.
   */
  emAmbasAsSituacoes: number;
  cobertura: CoberturaDaQuinzena;
  /** A comparação com a quinzena anterior da série. `null` na primeira. */
  variacao: VariacaoDaQuinzena | null;
}

/**
 * A variação contra a quinzena imediatamente anterior da série.
 *
 * Cada campo é `null` quando qualquer uma das duas pontas é `null` — uma
 * quinzena sem relatório não produz "caiu 40 veículos", produz "não sei".
 */
export interface VariacaoDaQuinzena {
  /** A competência com que se comparou. */
  contra: string;
  ativos: number | null;
  parados: number | null;
  total: number | null;
  /** Em pontos percentuais, e não em porcentagem da porcentagem. */
  pontosDeParado: number | null;
}

export interface SerieDaFrota {
  /** Da mais antiga para a mais recente — é assim que se lê uma evolução. */
  quinzenas: QuinzenaDaFrota[];
}

/** A competência, no mínimo que esta leitura precisa. */
export interface CompetenciaDaSerie {
  competencia: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
  cobertura: CoberturaDaQuinzena;
}

/**
 * A placa que identifica — caixa alta, sem pontuação.
 *
 * A mesma régua de `normalizeIdentifier` (`lib/ingest`), replicada aqui em vez
 * de importada porque `@workspace/fechamento` não depende de `@workspace/ingest`
 * e criar essa dependência para uma linha inverteria a direção que o módulo
 * respeita. Se um dia divergirem, quem manda é a de `lib/ingest`.
 */
function normalizarPlaca(bruta: string): string {
  return bruta
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Uma casinha do Promax respondeu por esta quinzena? */
function houveFonte(
  cobertura: CoberturaDaQuinzena,
  situacao: SituacaoDaFrota,
): boolean {
  const fonte =
    situacao === "ATIVA" ? cobertura.comFrotaAtiva : cobertura.comFrotaInativa;
  return fonte.length > 0;
}

function subtrair(agora: number | null, antes: number | null): number | null {
  return agora === null || antes === null ? null : agora - antes;
}

/**
 * A série, contada — **a função que os testes exercitam**.
 *
 * `competencias` entra da mais antiga para a mais recente; `placas` pode vir em
 * qualquer ordem, e as linhas de uma competência que não está na lista são
 * ignoradas em silêncio (o recorte é de quem chamou, não desta função).
 */
export function contarFrotaPorQuinzena(
  competencias: readonly CompetenciaDaSerie[],
  placas: readonly PlacaReportada[],
): SerieDaFrota {
  const porCompetencia = new Map<string, Map<string, Set<SituacaoDaFrota>>>();
  for (const c of competencias) porCompetencia.set(c.competencia, new Map());

  for (const linha of placas) {
    const daQuinzena = porCompetencia.get(linha.competencia);
    if (!daQuinzena) continue;
    const placa = normalizarPlaca(linha.placa);
    if (placa === "") continue;
    const situacoes = daQuinzena.get(placa) ?? new Set<SituacaoDaFrota>();
    situacoes.add(linha.situacao);
    daQuinzena.set(placa, situacoes);
  }

  const quinzenas: QuinzenaDaFrota[] = [];
  let anterior: QuinzenaDaFrota | null = null;

  for (const c of competencias) {
    const situacoesPorPlaca = porCompetencia.get(c.competencia)!;

    let ativas = 0;
    let inativas = 0;
    let emAmbas = 0;
    for (const situacoes of situacoesPorPlaca.values()) {
      if (situacoes.has("ATIVA")) ativas += 1;
      if (situacoes.has("INATIVA")) inativas += 1;
      if (situacoes.size > 1) emAmbas += 1;
    }

    /*
      Sem a fonte, a contagem é `null` — e não o zero que ela mediria. Com a
      fonte, zero é uma medição: o relatório veio e não trouxe placa nenhuma
      naquela situação.
    */
    const ativos = houveFonte(c.cobertura, "ATIVA") ? ativas : null;
    const parados = houveFonte(c.cobertura, "INATIVA") ? inativas : null;
    const total = ativos === null || parados === null ? null : ativos + parados;
    const percentualParado =
      total === null || total === 0 ? null : parados! / total;

    const atual: QuinzenaDaFrota = {
      competencia: c.competencia,
      ano: c.ano,
      mes: c.mes,
      quinzena: c.quinzena,
      inicio: c.inicio,
      fim: c.fim,
      ativos,
      parados,
      total,
      percentualParado,
      emAmbasAsSituacoes: emAmbas,
      cobertura: c.cobertura,
      variacao: anterior
        ? {
            contra: anterior.competencia,
            ativos: subtrair(ativos, anterior.ativos),
            parados: subtrair(parados, anterior.parados),
            total: subtrair(total, anterior.total),
            pontosDeParado: emPontos(
              percentualParado,
              anterior.percentualParado,
            ),
          }
        : null,
    };

    quinzenas.push(atual);
    anterior = atual;
  }

  return { quinzenas };
}

/** A diferença de percentual, em pontos — `null` se faltar qualquer ponta. */
function emPontos(agora: number | null, antes: number | null): number | null {
  return agora === null || antes === null ? null : (agora - antes) * 100;
}

/**
 * A quinzena mais recente que de fato mediu alguma coisa — o que os cartões do
 * topo da tela mostram.
 *
 * Percorre de trás para a frente e devolve a primeira com pelo menos uma
 * contagem. Uma quinzena aberta e sem relatório nenhum não é a manchete: ela é
 * o aviso de cobertura, e a manchete continua sendo o último número real.
 */
export function ultimaQuinzenaMedida(
  serie: SerieDaFrota,
): QuinzenaDaFrota | null {
  for (let i = serie.quinzenas.length - 1; i >= 0; i -= 1) {
    const q = serie.quinzenas[i]!;
    if (q.ativos !== null || q.parados !== null) return q;
  }
  return null;
}

/** As unidades do recorte que abriram a quinzena e não enviaram o relatório. */
export function unidadesSemRelatorio(
  quinzena: QuinzenaDaFrota,
  situacao: SituacaoDaFrota,
): string[] {
  const enviaram = new Set(
    situacao === "ATIVA"
      ? quinzena.cobertura.comFrotaAtiva
      : quinzena.cobertura.comFrotaInativa,
  );
  return quinzena.cobertura.unidades.filter((u) => !enviaram.has(u));
}
