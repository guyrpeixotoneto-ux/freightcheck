import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { resolveContext } from "@workspace/comparison";
import { semearBookDeTeste } from "../fixtures/book";
import { orquestrar } from "../../orquestrador";
import { ADVERSARIAL, type Fonte } from "./adversarial";

/**
 * A prova contra o overfitting.
 *
 * A bateria de 103 fechou na Fase 6, e um benchmark fechado tem um defeito
 * novo: ele não distingue mais "o produto entende a pergunta" de "o produto
 * decorou estas frases". Estas 28 perguntas foram escritas depois do fecho, a
 * partir das razões corrigidas e não dos casos, e nenhuma delas foi consultada
 * durante a correção.
 *
 * **Por que o piso aqui não é 100%.** Ele é uma medida honesta, não uma meta:
 * o eixo `fora` é absoluto — inventar ali é o defeito que este produto não pode
 * ter, e ele reprova em qualquer nível — e os outros quatro são exploratórios
 * por natureza. Um piso alto demais neles transformaria a bateria adversarial
 * numa segunda bateria a que ajustar o código, que é exatamente o que ela
 * existe para não ser.
 */

const URL_DO_BANCO = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const rodar = URL_DO_BANCO ? describe : describe.skip;

/**
 * O piso por eixo — **medido**, e não escolhido.
 *
 * Estes números são o resultado da primeira execução, registrados como saíram.
 * A tentação era outra: três casos de `sinonimo` falharam, as três causas são
 * conhecidas e as três se corrigiriam em vinte minutos alargando o vocabulário
 * mais uma vez. Não foram corrigidas de propósito.
 *
 * A razão é o que esta bateria é. Ela existe para dizer se a Fase 6 corrigiu as
 * razões ou decorou as frases da bateria de 103 — e uma bateria contra a qual se
 * ajusta o código deixa de responder isso no instante em que o primeiro ajuste
 * é feito. Ajustar aqui produziria 28/28 e nenhuma informação.
 *
 * **Os cinco buracos, com nome, para a fase que vier.** Resultado: 23/28, com
 * `fora` em 6/6 e `composta` em 5/5 — os dois eixos que mais importam.
 *
 * - "Qual o **montante** do IPVA?" → BOOK. `montante` não está no vocabulário
 *   de VALOR, que agora conhece valor, preço, custo e tarifa.
 * - "Quanto **sai** o pneu por mês?" → DESCONHECIDA. `quanto sai` é a forma
 *   coloquial de `quanto custa`.
 * - "Onde a **receita encolheu**?" → DESCONHECIDA, e **sem fonte nenhuma** —
 *   o pior dos cinco. Nem `receita` nem `encolher` são conhecidos, e uma
 *   pergunta claramente do domínio termina sem consultar nada.
 * - "O combustível ficou **estável**?" → DESCONHECIDA. A forma de igualdade
 *   aprendeu `igual` e `na mesma`, e não `estável`.
 * - "**qto foi** o impacto de agosto?" → VALOR em vez de MOVIMENTO. Este é
 *   diferente dos outros quatro: a resposta veio com dado, e o que erra é o
 *   nome dela. `qual foi o impacto` está em MOVIMENTO e `quanto foi` cai em
 *   VALOR — uma inconsistência dentro do vocabulário que já existe.
 *
 * Os cinco são a mesma coisa: um vocabulário fechado tem buracos, e cada buraco
 * custa uma família inteira de perguntas. É o mesmo defeito que a R1 corrigiu
 * para `preço`, e a lição é que corrigi-lo palavra a palavra não termina — o
 * que a próxima fase precisa atacar é o mecanismo, não a lista.
 */
const PISO: Record<string, number> = {
  informal: 5,
  sinonimo: 3,
  negativa: 4,
  composta: 5,
  fora: 6,
};

rodar("bateria adversarial", () => {
  let db: Database;
  const porEixo = new Map<string, { ok: number; total: number; falhas: string[] }>();

  beforeAll(async () => {
    ({ db } = createDb(URL_DO_BANCO!));
    expect(await resolveContext(db), "esta bateria precisa de um banco promovido").toBeTruthy();
    await semearBookDeTeste(db);

    for (const caso of ADVERSARIAL) {
      const d = await orquestrar(db, caso.pergunta);
      const fontes: Fonte[] = [];
      if (d.evidencias.length) fontes.push("DADO");
      if (d.documentos.length) fontes.push("BOOK");
      if (d.trechos.length) fontes.push("CONCEITO");
      if (!fontes.length) fontes.push("NENHUMA");
      const ferramentas = d.evidencias.map((e) => e.ferramenta);

      const okIntencao = caso.intencao.includes(d.plano.intencao);
      const okFonte = caso.fontes.some((f) => fontes.includes(f));
      const okProibidas = !caso.proibidas?.some((f) => ferramentas.includes(f));
      const okEvidencia = !caso.exigeEvidencia || d.evidencias.length > 0;

      const acc = porEixo.get(caso.eixo) ?? { ok: 0, total: 0, falhas: [] };
      acc.total += 1;
      if (okIntencao && okFonte && okProibidas && okEvidencia) acc.ok += 1;
      else {
        acc.falhas.push(
          `"${caso.pergunta}" → ${d.plano.intencao} / ${fontes.join("+")}` +
            (okProibidas ? "" : ` / PROIBIDA: ${ferramentas.join(",")}`),
        );
      }
      porEixo.set(caso.eixo, acc);
    }
  });

  for (const [eixo, piso] of Object.entries(PISO)) {
    it(`${eixo}: pelo menos ${piso} casos completos`, () => {
      const r = porEixo.get(eixo);
      expect(r, `eixo ${eixo} não foi medido`).toBeTruthy();
      expect(
        r!.ok,
        `${eixo}: ${r!.ok}/${r!.total} (piso ${piso})\n  ${r!.falhas.join("\n  ")}`,
      ).toBeGreaterThanOrEqual(piso);
    });
  }

  /*
    E a garantia que não é estatística.

    Os pisos acima medem tendência. Este mede uma promessa: nenhuma pergunta
    sobre coisa que este produto não tem pode receber o agregado da vigência.
    Um número verdadeiro sobre o assunto errado é a pior resposta que este
    assistente sabe dar, porque é a única que parece uma resposta.
  */
  it("nenhuma pergunta fora do domínio recebe o agregado da vigência", () => {
    const r = porEixo.get("fora")!;
    const inventadas = r.falhas.filter((f) => f.includes("PROIBIDA"));
    expect(inventadas, inventadas.join("\n  ")).toEqual([]);
  });
});
