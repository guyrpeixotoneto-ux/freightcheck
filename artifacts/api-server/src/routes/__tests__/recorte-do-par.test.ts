import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * **Nenhuma rota lê o acervo sem dizer de quem é o recorte.**
 *
 * `getEntityTable` aceita o contexto como opcional, e é aí que mora a armadilha:
 * omitido, ele resolve para `contexts[0]` — o primeiro contexto do acervo, que
 * não tem relação nenhuma com o par que a tela abriu. Como a leitura é
 * recortada depois pela data, o resultado não vem vazio: vem da unidade errada.
 * Foi assim que a Evolução do FINAME somou uma frota que não era a comparada, e
 * as outras cinco telas de comparação tinham a mesma chamada.
 *
 * Um caso de comportamento prova a rota que ele exercita; este prende a
 * **classe** do defeito, inclusive na rota que ainda não existe. Sem ele, a
 * próxima tela de comparação nasce com o mesmo `undefined` — ele é o caminho
 * mais curto, e o único cujo erro não aparece na tela.
 *
 * O que a regra pede é só isto: passe alguma coisa. Qual recorte é certo é
 * decisão da rota — `contextoDoPar` para as de par, `parseContext` para as que
 * recebem o recorte na URL.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROTAS = path.resolve(AQUI, "..");

/** `getEntityTable(...)` com `undefined` no lugar do contexto, em qualquer forma. */
const SEM_RECORTE = [
  /getEntityTable\([^)]*?,\s*undefined\s*,[^)]*?\)/s,
  /getEntityTable\([^)]*?,\s*undefined\s*\)/s,
];

describe("a leitura direta do acervo", () => {
  it("nunca deixa o contexto em undefined numa rota", () => {
    const culpadas: string[] = [];
    for (const arquivo of readdirSync(ROTAS).filter((f) => f.endsWith(".ts"))) {
      const fonte = readFileSync(path.join(ROTAS, arquivo), "utf8");
      if (!fonte.includes("getEntityTable(")) continue;
      if (SEM_RECORTE.some((marca) => marca.test(fonte))) culpadas.push(arquivo);
    }
    expect(culpadas).toEqual([]);
  });
});
