import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { resolveContext } from "@workspace/comparison";
import { orquestrar } from "../../orquestrador";
import { BENCHMARK, type Fonte } from "./perguntas";

/**
 * O benchmark, como proteção contra regressão.
 *
 * **O que ele mede.** Não a redação — o caminho. Para cada pergunta: a intenção
 * resolvida, as fontes consultadas, a ferramenta que rodou, se sobrou evidência
 * e se a lacuna obrigatória foi declarada. São as cinco coisas que decidem se a
 * resposta pode estar certa; a prosa vem depois delas.
 *
 * **Por que ele não falha caso a caso.** Uma parte dos casos falha hoje, de
 * propósito: eles descrevem o comportamento que o produto deve ter, não o que
 * ele tem. Falhar em cada um transformaria a suíte num alarme permanente que
 * ninguém lê. Em vez disso, o teste guarda um **piso por categoria** — e o piso
 * é o número medido hoje. Subir o piso é a forma de registrar progresso; cair
 * abaixo dele é a regressão que este arquivo existe para pegar.
 *
 * Sem `ASSISTANT_EVAL_DATABASE_URL` a suíte não roda: ela precisa do banco com
 * o export promovido e os conjuntos de alteração calculados.
 */

const URL_DO_BANCO = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const rodar = URL_DO_BANCO ? describe : describe.skip;

/** O piso medido em 15/08/2026. Subir é progresso; cair é regressão. */
const PISO: Record<string, number> = {
  alteracoes: 13, parametros: 9, impacto: 7, equipamentos: 8, combustivel: 6,
  book: 6, comparacao: 4, cruzada: 3, informal: 5, executiva: 2, impossivel: 6,
};

rodar("benchmark do assistente", () => {
  let db: Database;
  const porCategoria = new Map<string, { ok: number; total: number; falhas: string[] }>();

  beforeAll(async () => {
    ({ db } = createDb(URL_DO_BANCO!));
    expect(await resolveContext(db), "o benchmark precisa de um banco promovido").toBeTruthy();

    for (const caso of BENCHMARK) {
      if (caso.categoria === "followup") continue;
      const d = await orquestrar(db, caso.pergunta);
      const fontes: Fonte[] = [];
      if (d.evidencias.length) fontes.push("DADO");
      if (d.documentos.length) fontes.push("BOOK");
      if (d.trechos.length) fontes.push("CONCEITO");
      if (!fontes.length) fontes.push("NENHUMA");
      const ferramentas = d.evidencias.map((e) => e.ferramenta);

      const passou =
        caso.intencao.includes(d.plano.intencao) &&
        caso.fontes.some((f) => fontes.includes(f)) &&
        (!caso.ferramentas || caso.ferramentas.some((f) => ferramentas.includes(f))) &&
        (!caso.exigeEvidencia || d.evidencias.length > 0) &&
        (!caso.lacuna || d.lacunas.some((l) => l.tipo === caso.lacuna));

      const acc = porCategoria.get(caso.categoria) ?? { ok: 0, total: 0, falhas: [] };
      acc.total += 1;
      if (passou) acc.ok += 1;
      else acc.falhas.push(`"${caso.pergunta}" → ${d.plano.intencao} / ${fontes.join("+")}`);
      porCategoria.set(caso.categoria, acc);
    }
  });

  for (const [categoria, piso] of Object.entries(PISO)) {
    it(`${categoria}: pelo menos ${piso} casos completos`, () => {
      const r = porCategoria.get(categoria);
      expect(r, `categoria ${categoria} não foi medida`).toBeTruthy();
      expect(
        r!.ok,
        `${categoria}: ${r!.ok}/${r!.total} (piso ${piso})\n  ${r!.falhas.join("\n  ")}`,
      ).toBeGreaterThanOrEqual(piso);
    });
  }
});
