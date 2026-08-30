import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  semanticMeaningTable,
} from "@workspace/db";
import { acharSignificado, ESCOPO_GLOBAL, type Escopo } from "./catalogo";

/**
 * O tipo do valor — dizer que a coluna é `R$/km` sem ainda vouchar por ela.
 *
 * ---------------------------------------------------------------------------
 * Por que existe, tendo a confirmação
 * ---------------------------------------------------------------------------
 * "Qual é o tipo desta coluna?" já era perguntado na tela, mas só dentro da
 * confirmação — junto com a categoria da DRE e com a assinatura que destrava
 * soma financeira. Quem abre a planilha e reconhece `odometroEntrada` como
 * quilometragem sabe a resposta no primeiro segundo e frequentemente não sabe
 * nenhuma das outras duas, e o preço de registrá-la era responder as três. O
 * resultado é o mesmo que {@link saveMeaning} foi escrito para desfazer do lado
 * da prosa: o conhecimento existia e não havia onde pô-lo sem tomar uma decisão
 * sobre dinheiro.
 *
 * Então esta operação é a metade barata do significado econômico, e espelha
 * {@link definirClasseDeCusto} e {@link definirDirecaoEconomica} de propósito:
 * mesma dupla de escrita (a projeção em `attribute` e a versão em vigor em
 * `attribute_semantics`), mesmo evento de auditoria, mesma exigência de
 * responsável, e nenhuma exigência de justificativa.
 *
 * ---------------------------------------------------------------------------
 * O que ela deliberadamente **não** grava
 * ---------------------------------------------------------------------------
 * - **`semantics_status`.** O portão continua sendo a confirmação. Declarar o
 *   tipo não põe a coluna em soma nenhuma.
 * - **`unit`, `periodicity`, `aggregation`, `is_monetary`.** São a derivação
 *   do significado, e quem as escreve é `confirmAttribute` — pelo mesmo motivo
 *   pelo qual o campo derivado nunca é digitável: os quatro são o que o motor
 *   financeiro lê, e escrevê-los aqui faria uma declaração sem assinatura ter
 *   o mesmo efeito de uma confirmação assinada. `meaning_id` sozinho não é
 *   lido por motor nenhum; ele é lido pela tela, que passa a abrir a
 *   confirmação com o tipo já escolhido — que é exatamente o proveito de ter
 *   declarado antes.
 *
 * A leitura de volta pelos quatro campos técnicos (`significadoAtual`) continua
 * valendo para tudo que foi curado antes desta coluna existir: `meaning_id`
 * ganha da derivação quando os dois existem, e é o que se espera — um é
 * afirmação de alguém, o outro é dedução.
 */

export interface TipoDoValorResult {
  desfecho: "GRAVADO" | "JA_ESTAVA";
  code: string;
  /** O código do significado que estava lá. `null` quando não havia nenhum. */
  de: string | null;
  para: string;
  /** O rótulo do tipo declarado, para a frase da tela. */
  label: string;
}

/**
 * Declarar o que a coluna é, economicamente, sem confirmá-la.
 *
 * O significado tem de existir no cadastro: um código que a tela mandou e o
 * cadastro não conhece é tela desatualizada ou pedido forjado, e gravar um
 * `meaning_id` inventado é pior do que recusar — a tela mostraria um tipo que
 * o catálogo não sabe traduzir. Cadastrar um tipo novo continua sendo
 * `criarSignificado`, e a tela faz as duas coisas no mesmo clique.
 */
export async function declararTipoDoValor(
  db: Database,
  entrada: {
    code: string;
    /** O código do significado no cadastro — `taxa_km`, `descritor`… */
    meaningCode: string;
    actor: string;
    reason?: string | null;
  },
  escopo: Escopo = ESCOPO_GLOBAL,
): Promise<TipoDoValorResult> {
  if (!entrada.actor?.trim()) {
    throw new Error("Declarar o tipo do valor exige um responsável identificado.");
  }
  if (!entrada.meaningCode?.trim()) {
    throw new Error("Informe o tipo do valor (meaningCode).");
  }

  const significado = await acharSignificado(db, entrada.meaningCode, escopo);
  if (!significado) {
    throw new Error(
      `Tipo "${entrada.meaningCode}" não existe no cadastro de significados. ` +
        `Cadastre-o antes de declará-lo.`,
    );
  }

  const [atributo] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, entrada.code));
  if (!atributo) throw new Error(`Atributo "${entrada.code}" não encontrado.`);

  if (atributo.meaningId === significado.id) {
    return {
      desfecho: "JA_ESTAVA",
      code: atributo.code,
      de: significado.code,
      para: significado.code,
      label: significado.label,
    };
  }

  /*
    O antes sai como *código*, e não como o uuid guardado na coluna: o evento é
    o que um revisor lê, e `montante_mes` diz o que `4f3a…` não diz. Custa uma
    consulta a mais quando havia um tipo anterior, e só nesse caso.
  */
  const anterior = atributo.meaningId
    ? ((
        await db
          .select({ code: semanticMeaningTable.code })
          .from(semanticMeaningTable)
          .where(eq(semanticMeaningTable.id, atributo.meaningId))
      )[0]?.code ?? null)
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(attributeTable)
      .set({ meaningId: significado.id })
      .where(eq(attributeTable.id, atributo.id));

    await tx
      .update(attributeSemanticsTable)
      .set({ meaningId: significado.id })
      .where(
        and(
          eq(attributeSemanticsTable.attributeId, atributo.id),
          isNull(attributeSemanticsTable.effectiveUntil),
        ),
      );

    await tx.insert(curationEventTable).values({
      targetKind: "ATTRIBUTE",
      targetId: atributo.id,
      targetLabel: atributo.code,
      field: "meaning_id",
      valueBefore: anterior,
      valueAfter: significado.code,
      actor: entrada.actor,
      reason: entrada.reason ?? null,
      // Mesma marca da prosa: isto descreve a coluna, não confirma nada. É o
      // que separa este evento do `meaning_id` que sai de `confirmAttribute`,
      // que vem acompanhado de `semantics_status`.
      detail: { changeKind: "MEANING" },
    });
  });

  return {
    desfecho: "GRAVADO",
    code: atributo.code,
    de: anterior,
    para: significado.code,
    label: significado.label,
  };
}
