import type { Database } from "@workspace/db";
import {
  computeChangeSet,
  getChangeSetForPair,
  listChanges,
  listComparableSnapshots,
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

/** Os números de um par, no recorte de uma rubrica. */
export interface NumerosDoPar {
  alteracoes: number;
  impacto: { porPeriodicidade: Record<string, number> };
}

export interface CandidatasDoPar {
  para: string;
  candidatos: { id: string; numeros: NumerosDoPar | null }[];
  /** Quantas candidatas não couberam no orçamento desta chamada. */
  pendentes: number;
}

export interface RecorteDaRubrica {
  /** Os atributos que a rubrica lê — `CODIGOS_DO_DETALHE` da rubrica. */
  attributeCodes: readonly string[];
  /**
   * As linhas e os números daquela rubrica, a partir do que o motor devolveu.
   *
   * Recebe as linhas cruas e responde o que a tela publica. Quem implementa
   * chama o próprio `linhasDeX` e o próprio `resumirX` — e é por isso que este
   * módulo não conhece rubrica nenhuma.
   */
  numeros: (rows: Awaited<ReturnType<typeof listChanges>>["rows"]) => NumerosDoPar;
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
  const candidatas = vigencias
    .filter(
      (v) =>
        v.id !== destino.id &&
        v.scopeHash === destino.scopeHash &&
        v.entityTypeSet === destino.entityTypeSet,
    )
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
    candidatos.push({ id: candidata.id, numeros: recorte.numeros(rows) });
  }

  return { para: destino.id, candidatos, pendentes };
}
