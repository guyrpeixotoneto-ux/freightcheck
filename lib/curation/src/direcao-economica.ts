import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { attributeSemanticsTable, attributeTable, curationEventTable } from "@workspace/db";

/**
 * A direção econômica de um atributo, do ponto de vista da transportadora.
 *
 * Vocabulário fixado pela migration `0026_direcao_economica`: `HIGHER_IS_BETTER`
 * quando subir aumenta a remuneração ou reduz o custo, `HIGHER_IS_WORSE` no
 * inverso, `NEUTRAL` para cadastro (não é grandeza econômica) e
 * `DEPENDS_ON_FORMULA` quando a fórmula que usa o atributo decide o sinal.
 */
export const DIRECOES_ECONOMICAS = [
  {
    direcao: "HIGHER_IS_BETTER" as const,
    rotulo: "Maior é melhor",
    ajuda: "Subir aumenta a remuneração ou reduz o custo da transportadora.",
  },
  {
    direcao: "HIGHER_IS_WORSE" as const,
    rotulo: "Maior é pior",
    ajuda: "Subir reduz a remuneração ou aumenta o custo da transportadora.",
  },
  {
    direcao: "NEUTRAL" as const,
    rotulo: "Neutro",
    ajuda: "É cadastro, não grandeza econômica — não deve afetar o veredito do trecho.",
  },
  {
    direcao: "DEPENDS_ON_FORMULA" as const,
    rotulo: "Depende da fórmula",
    ajuda: "O sentido depende de que conta usa este atributo — não classificar sem essa conta.",
  },
];

export type DirecaoEconomica = (typeof DIRECOES_ECONOMICAS)[number]["direcao"];

export interface DirecaoEconomicaResult {
  desfecho: "GRAVADA" | "JA_ESTAVA";
  code: string;
  de: string | null;
  para: DirecaoEconomica;
}

/**
 * Dizer para que lado o dinheiro anda quando este atributo anda.
 *
 * Espelha {@link definirClasseDeCusto} (`./catalogo.ts`) propositalmente: mesma
 * dupla de escrita (a projeção em `attribute` e a versão em vigor em
 * `attribute_semantics`), mesmo evento de auditoria, mesma exigência de
 * responsável. A diferença é o campo e o vocabulário — a razão de existir é a
 * mesma: sem responsável identificado e sem o antes/depois gravado, uma
 * curadoria que decide "isto é bom ou ruim para a transportadora" não é
 * auditável.
 *
 * Não toca `semantics_status`: dizer a direção não confirma unidade,
 * periodicidade ou agregação — os portões que destravam soma continuam onde
 * estavam.
 */
export async function definirDirecaoEconomica(
  db: Database,
  entrada: {
    code: string;
    direcao: DirecaoEconomica;
    /** A frase que explica o mecanismo, no espírito de `economic_effect`. */
    efeito?: string | null;
    actor: string;
    reason?: string | null;
  },
): Promise<DirecaoEconomicaResult> {
  if (!entrada.actor?.trim()) {
    throw new Error("Definir a direção econômica exige um responsável identificado.");
  }
  if (!DIRECOES_ECONOMICAS.some((d) => d.direcao === entrada.direcao)) {
    throw new Error(
      `Direção "${entrada.direcao}" não existe. As quatro são ${DIRECOES_ECONOMICAS.map((d) => d.direcao).join(", ")}.`,
    );
  }

  const [atributo] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, entrada.code));
  if (!atributo) throw new Error(`Atributo "${entrada.code}" não encontrado.`);

  const efeito = entrada.efeito ?? null;
  if (atributo.economicDirection === entrada.direcao && atributo.economicEffect === efeito) {
    return {
      desfecho: "JA_ESTAVA",
      code: atributo.code,
      de: atributo.economicDirection,
      para: entrada.direcao,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(attributeTable)
      .set({ economicDirection: entrada.direcao, economicEffect: efeito })
      .where(eq(attributeTable.id, atributo.id));

    await tx
      .update(attributeSemanticsTable)
      .set({ economicDirection: entrada.direcao, economicEffect: efeito })
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
      field: "economic_direction",
      valueBefore: atributo.economicDirection,
      valueAfter: entrada.direcao,
      actor: entrada.actor,
      reason: entrada.reason ?? null,
    });
  });

  return {
    desfecho: "GRAVADA",
    code: atributo.code,
    de: atributo.economicDirection,
    para: entrada.direcao,
  };
}
