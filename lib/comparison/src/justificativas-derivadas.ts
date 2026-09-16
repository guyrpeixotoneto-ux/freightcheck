import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { changeTable, justificativaTable } from "@workspace/db";

import { resumoDaJustificativa } from "./justificativa-estruturada";
import {
  formulaDoTotalDerivado,
  regraDoTotalDerivado,
  rotuloDaVariavel,
  totalDerivado,
} from "./totais-derivados";

/**
 * A justificativa que ninguém precisa escrever — a do total, deduzida das
 * parcelas dele.
 *
 * ---------------------------------------------------------------------------
 * Por que ela existe
 * ---------------------------------------------------------------------------
 * A Parcela FINAME é juros mais amortização. Quando as três mudam na mesma
 * placa, pedir três justificativas pede a mesma coisa duas vezes: a do total é
 * a conta das outras duas, e escrevê-la à mão só abre espaço para ela
 * **contradizer** as parcelas — um "conforme" no total com uma exceção nos
 * juros, e nada no produto notando.
 *
 * Então a fila não pergunta pelo total (ver `justificar-dialog.tsx`), e o total
 * também não fica pendente para sempre: assim que todas as parcelas que se
 * moveram estão justificadas, esta função grava a do total, derivada delas. A
 * cobertura de Chamados fecha sem ninguém escrever a mesma frase duas vezes, e
 * sem ninguém marcar como explicada uma alteração que não está.
 *
 * ---------------------------------------------------------------------------
 * As quatro condições, e o que cada uma impede
 * ---------------------------------------------------------------------------
 * 1. **O total ainda não tem justificativa.** Quem escreveu a do total à mão
 *    decidiu alguma coisa; sobrescrevê-la com uma dedução seria trocar a
 *    decisão de uma pessoa pela conta de um servidor. (Gravar de novo é
 *    histórico, e a tela lê a mais recente — por isso "não tem" é a condição,
 *    e não "não tem uma derivada".)
 * 2. **Ao menos uma parcela mudou.** Total que se moveu sem nenhuma parcela se
 *    mover não é derivado de nada — é uma inconsistência aritmética, e é
 *    exatamente o caso que a auditoria quer ver perguntado a uma pessoa. Fica
 *    pendente.
 * 3. **Todas as parcelas que mudaram estão justificadas.** Falta uma, não há de
 *    onde deduzir.
 * 4. **Nenhuma delas é anterior a `0098`.** Justificativa antiga tem `texto` e
 *    não tem `conforme`: dela não se deduz conformidade nenhuma, e afirmar uma
 *    seria inventar a resposta de uma pergunta que ninguém respondeu.
 *
 * A conformidade do total é a conjunção das parcelas — exceção em qualquer uma
 * faz do total uma exceção, com o motivo dizendo de qual parcela ela veio e o
 * responsável sendo quem aprovou lá. É a única leitura que não mente: um total
 * que se moveu por causa de uma exceção não é um total conforme.
 */
export interface JustificativaDerivada {
  changeId: number;
  entityLabel: string;
}

export async function gravarJustificativasDerivadas(
  db: Database,
  params: {
    changeSetId: string;
    /** As entidades tocadas pelo POST — o recorte que evita varrer a comparação inteira. */
    entityIds: readonly string[];
    criadoPor: string;
  },
): Promise<(typeof justificativaTable.$inferSelect)[]> {
  const entityIds = [...new Set(params.entityIds)];
  if (entityIds.length === 0) return [];

  const alteracoes = await db
    .select({
      id: changeTable.id,
      entityId: changeTable.entityId,
      entityLabel: changeTable.entityLabel,
      entityType: changeTable.entityType,
      attributeCode: changeTable.attributeCode,
      attributeName: changeTable.attributeName,
    })
    .from(changeTable)
    .where(
      and(
        eq(changeTable.changeSetId, params.changeSetId),
        inArray(changeTable.entityId, entityIds),
        isNotNull(changeTable.attributeCode),
      ),
    );

  /* Sem nenhum total entre as alterações da entidade, não há o que deduzir —
     e não vale a segunda consulta. */
  const totais = alteracoes.filter((a) => totalDerivado(a.attributeCode) !== null);
  if (totais.length === 0) return [];

  const justificadas = await db
    .select({
      changeId: justificativaTable.changeId,
      conforme: justificativaTable.conforme,
      responsavelAprovacao: justificativaTable.responsavelAprovacao,
    })
    .from(justificativaTable)
    .where(
      and(
        eq(justificativaTable.changeSetId, params.changeSetId),
        inArray(
          justificativaTable.changeId,
          alteracoes.map((a) => a.id),
        ),
      ),
    )
    .orderBy(desc(justificativaTable.criadoEm));

  /* A mais recente de cada alteração — a lista já vem da mais nova para a mais
     antiga, como a leitura da fila faz. */
  const maisRecente = new Map<number, (typeof justificadas)[number]>();
  for (const j of justificadas) if (!maisRecente.has(j.changeId)) maisRecente.set(j.changeId, j);

  const porEntidadeECodigo = new Map<string, (typeof alteracoes)[number]>();
  for (const a of alteracoes) porEntidadeECodigo.set(`${a.entityId}|${a.attributeCode}`, a);

  const aGravar: (typeof justificativaTable.$inferInsert)[] = [];
  for (const total of totais) {
    if (maisRecente.has(total.id)) continue; // (1)

    const composicao = totalDerivado(total.attributeCode)!;
    const parcelas = composicao.parcelas
      .map((codigo) => porEntidadeECodigo.get(`${total.entityId}|${codigo}`))
      .filter((a): a is (typeof alteracoes)[number] => !!a);
    if (parcelas.length === 0) continue; // (2)

    const suasJustificativas = parcelas.map((p) => maisRecente.get(p.id));
    if (suasJustificativas.some((j) => !j)) continue; // (3)
    if (suasJustificativas.some((j) => typeof j!.conforme !== "boolean")) continue; // (4)

    /* O rótulo do catálogo primeiro: `attribute_name` é o nome cru da coluna
       importada (`jurosFinameCavalo`), e não o que a tabela mostra. */
    const rotulo = (a: (typeof alteracoes)[number]) =>
      rotuloDaVariavel(a.attributeCode) ?? a.attributeName ?? a.attributeCode ?? "—";
    const rotulosDasParcelas = parcelas.map(rotulo);
    const excecoes = parcelas.filter((_, i) => suasJustificativas[i]!.conforme === false);
    const conforme = excecoes.length === 0;

    const justificativa = {
      formula: formulaDoTotalDerivado(rotulo(total), composicao.forma, rotulosDasParcelas),
      regra: regraDoTotalDerivado(rotulosDasParcelas),
      conforme,
      motivoExcecao: conforme
        ? null
        : `Total calculado: acompanha a exceção de ${excecoes.map(rotulo).join(", ")}.`,
      responsavelAprovacao: conforme
        ? null
        : [
            ...new Set(
              excecoes
                .map((p) => maisRecente.get(p.id)!.responsavelAprovacao)
                .filter((nome): nome is string => !!nome),
            ),
          ].join(", ") || "—",
    };

    aGravar.push({
      changeSetId: params.changeSetId,
      changeId: total.id,
      entityLabel: total.entityLabel ?? "",
      entityType: total.entityType,
      texto: resumoDaJustificativa(justificativa),
      ...justificativa,
      criadoPor: params.criadoPor,
    });
  }

  if (aGravar.length === 0) return [];
  return db.insert(justificativaTable).values(aGravar).returning();
}
