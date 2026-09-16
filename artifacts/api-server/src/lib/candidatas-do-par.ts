import type { Database } from "@workspace/db";
import {
  computeChangeSet,
  formamParDeVigencias,
  getChangeSetForPair,
  listChanges,
  listComparableSnapshots,
  type NaturezaEconomica,
  type Operacao,
} from "@workspace/comparison";

/**
 * O QUE CADA CANDIDATA A "DE" PRODUZ CONTRA O "PARA" ESCOLHIDO.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é um módulo e não um trecho de rota
 * ---------------------------------------------------------------------------
 * Porque a parte difícil não é a consulta — é o **orçamento**, e ele precisa
 * ser um só. Calcular uma comparação nova custa segundos; calcular cinco de uma
 * vez estoura o prazo de qualquer proxy no caminho. A regra que decide o que
 * cabe, o que volta sem número e como o cliente continua de onde parou é
 * sutil, e duas cópias dela envelhecem diferente: no dia em que uma ganhasse um
 * segundo a mais, o FINAME e o IPVA responderiam com fôlegos distintos à mesma
 * pergunta, sem que nada na tela dissesse por quê.
 *
 * O que muda de uma rubrica para outra é só o recorte — quais atributos ler e
 * como contar o que mudou —, e isso entra por parâmetro.
 *
 * ---------------------------------------------------------------------------
 * As três garantias
 * ---------------------------------------------------------------------------
 * **A lista é da mesma unidade e da mesma cobertura.** São as recusas do motor
 * antecipadas (`engine.ts`), e ficam aqui e não na tela: um `para` de Camaçari
 * nunca devolve candidata de Pernambuco, mesmo que alguém monte o endereço à
 * mão.
 *
 * **Nada é recalculado à toa.** `getChangeSetForPair` responde por quem já foi
 * comparado alguma vez; só quem nunca foi passa por `computeChangeSet`. É o
 * mesmo caminho das rotas de comparação, de modo que o número do menu é o mesmo
 * que a tela mostra depois do clique — nunca uma segunda conta.
 *
 * **Quem não coube volta sem número, e isso é dito.** `numeros: null` quer
 * dizer *ainda não sei*, e nunca *zero*. O cliente pede de novo e a rota
 * continua de onde parou, porque o que foi calculado ficou gravado.
 */

/** Quanto tempo esta rota gasta calculando comparações que ainda não existem. */
export const ORCAMENTO_DE_CANDIDATAS_MS = 8_000;

/** O teto de conexão da rota — folgado sobre o orçamento, e bem abaixo do pool. */
export const TETO_DE_CANDIDATAS_MS = 12_000;

/**
 * Um balde de dinheiro de um par — a periodicidade, a natureza e o líquido.
 *
 * `natureza` é `null` no recorte de uma rubrica só, e é isso que mantém a linha
 * do menu das quatro auditorias exatamente como sempre foi: `+R$ 7.238,85/mês`,
 * sem prefixo. FINAME, IPVA e Impostos são custo inteiro; Lucro Fixo é receita
 * inteira. Dizer "Custo" ao lado de um número numa tela cujo nome já é o da
 * rubrica é repetir o que a tela inteira diz.
 *
 * Ela deixa de ser `null` no primeiro recorte que mistura as duas — o Monitor
 * Custo Fixo, que lê os quatro módulos de uma vez. Ali o prefixo é obrigatório:
 * um número só, somando o custo que subiu com a receita que subiu, é
 * exatamente o escalar que `CartoesDoMonitor` recusa publicar ("não há cartão
 * de Impacto líquido"), e o menu não pode ser a porta dos fundos por onde ele
 * entra.
 *
 * Por que uma lista e não um `Record<string, number>`: porque a chave passou a
 * ser **dupla** — periodicidade e natureza —, e um objeto de chave composta
 * (`CUSTO:MENSAL`) seria um formato que só o cliente sabe abrir. Uma lista diz
 * os dois campos com o nome de cada um.
 */
export interface BaldeDoImpacto {
  periodicidade: string;
  /** `null` quando o recorte é de uma natureza só — as quatro rubricas. */
  natureza: NaturezaEconomica | null;
  valor: number;
}

/** Os números de um par, no recorte de quem perguntou. */
export interface NumerosDoPar {
  alteracoes: number;
  impacto: { baldes: BaldeDoImpacto[] };
}

/**
 * O impacto de uma rubrica — `Record<periodicidade, líquido>` — como baldes.
 *
 * As quatro auditorias publicam o impacto nesse formato desde sempre
 * (`impactoPorPeriodicidade` e irmãs), e nenhuma delas tem duas naturezas para
 * separar. Esta é a tradução de uma ponta à outra, num lugar só, para que as
 * quatro não escrevam quatro vezes o mesmo `Object.entries`.
 */
export function baldesDeUmaNatureza(
  porPeriodicidade: Record<string, number>,
): BaldeDoImpacto[] {
  return Object.entries(porPeriodicidade).map(([periodicidade, valor]) => ({
    periodicidade,
    natureza: null,
    valor,
  }));
}

export interface CandidatasDoPar {
  para: string;
  candidatos: { id: string; numeros: NumerosDoPar | null }[];
  /** Quantas candidatas não couberam no orçamento desta chamada. */
  pendentes: number;
}

/** De qual par saíram as linhas — o que o recorte precisa saber além delas. */
export interface ParCalculado {
  /** A candidata a "De". */
  baseId: string;
  /** O "Para" fixado. */
  comparadaId: string;
  changeSetId: string;
}

export interface RecorteDaRubrica {
  /** Os atributos que a rubrica lê — `CODIGOS_DO_DETALHE` da rubrica. */
  attributeCodes: readonly string[];
  /**
   * As linhas e os números daquele recorte, a partir do que o motor devolveu.
   *
   * Recebe as linhas cruas e responde o que a tela publica. Quem implementa
   * chama o próprio `linhasDeX` e o próprio `resumirX` — e é por isso que este
   * módulo não conhece rubrica nenhuma.
   *
   * O segundo argumento é o par de onde as linhas vieram. As quatro auditorias
   * não o usam — o número delas sai das linhas e de mais nada —, e ele está
   * aqui pelo Monitor: `normalizarLinhas` carimba o par e o `change_set` em
   * cada linha, e sem os três identificadores ele teria de inventá-los para
   * chamar a mesma função que a tela chama. Inventar identificador para
   * satisfazer uma assinatura é como um dado errado entra num agregado.
   */
  numeros: (
    rows: Awaited<ReturnType<typeof listChanges>>["rows"],
    par: ParCalculado,
  ) => NumerosDoPar;
}

export async function candidatasDoPar(
  db: Database,
  para: string,
  recorte: RecorteDaRubrica,
  opts: { operacao?: Operacao | null; computedBy: string } = { computedBy: "api" },
): Promise<CandidatasDoPar | { naoEncontrada: true }> {
  const vigencias = await listComparableSnapshots(db, { operacao: opts.operacao ?? null });
  const destino = vigencias.find((v) => v.id === para);
  if (!destino) return { naoEncontrada: true };

  /* A mesma série do destino, da mais recente para a mais antiga: quem abre o
     menu olha primeiro as de cima, então são elas que ganham o orçamento. */
  /* `formamParDeVigencias` é a mesma função que o seletor das telas usa para montar a
     lista (`recorte-de-rubrica.ts`). Era aqui que a regra morava escrita à mão,
     e o seletor não a tinha: o menu oferecia vigências que esta rota nem
     considerava candidatas, e elas apareciam lá sem número nenhum — uma linha
     em branco que quem lê a tela confunde com "nada mudou". Uma função só, e as
     duas pontas do produto recortam igual. */
  const candidatas = vigencias
    .filter((v) => formamParDeVigencias(v, destino))
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  const limite = Date.now() + ORCAMENTO_DE_CANDIDATAS_MS;
  const candidatos: CandidatasDoPar["candidatos"] = [];
  let pendentes = 0;

  for (const candidata of candidatas) {
    const gravado = await getChangeSetForPair(db, candidata.id, destino.id);
    if (!gravado && Date.now() >= limite) {
      candidatos.push({ id: candidata.id, numeros: null });
      pendentes++;
      continue;
    }

    const resumo =
      gravado ??
      (await computeChangeSet(db, candidata.id, destino.id, {
        computedBy: opts.computedBy,
      }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...recorte.attributeCodes],
      limit: 5000,
    });
    candidatos.push({
      id: candidata.id,
      numeros: recorte.numeros(rows, {
        baseId: candidata.id,
        comparadaId: destino.id,
        changeSetId: resumo.id,
      }),
    });
  }

  return { para: destino.id, candidatos, pendentes };
}
