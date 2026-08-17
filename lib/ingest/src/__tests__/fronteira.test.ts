import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A fronteira da importação, prendida como teste.
 *
 * Duas correções seguidas moveram conhecimento para `@workspace/db` — o
 * registro de semânticas confirmadas e a árvore da taxonomia — e as duas
 * tiveram o mesmo motivo: a importação precisa garantir aquilo, e não pode
 * importar a curadoria para consegui-lo. A pilha é `db → {ingest, curation}`, e
 * `curation` depende de `ingest` nos próprios testes; uma dependência de volta
 * fecharia o ciclo e, pior, poria a inferência do motor de curadoria dentro da
 * transação que grava os fatos da Ambev.
 *
 * O que este arquivo impede é a regressão silenciosa: um `import` de
 * `@workspace/curation` dentro de `lib/ingest` compila, roda, e desfaz a
 * fronteira sem que nenhum teste de comportamento perceba.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arquivosFonte(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const alvo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "__tests__") continue;
      saida.push(...arquivosFonte(alvo));
    } else if (entrada.name.endsWith(".ts")) {
      saida.push(alvo);
    }
  }
  return saida;
}

describe("a importação não depende da curadoria", () => {
  it("não a declara como dependência", () => {
    const manifesto = JSON.parse(
      readFileSync(path.join(RAIZ, "../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifesto.dependencies ?? {})).not.toContain(
      "@workspace/curation",
    );
  });

  it("não a importa em arquivo nenhum do pipeline", () => {
    const ofensores = arquivosFonte(RAIZ).filter((arquivo) =>
      /from\s+["']@workspace\/curation["']/.test(readFileSync(arquivo, "utf8")),
    );
    expect(ofensores.map((f) => path.relative(RAIZ, f))).toEqual([]);
  });

  /**
   * O que a promoção garante, e de onde vem cada peça.
   *
   * As três moram em `@workspace/db` e são chamadas nesta ordem dentro da mesma
   * transação. A ordem é regra, não estilo: a confirmação canônica vincula o
   * atributo ao nó da taxonomia, e vincular exige que o nó já exista.
   */
  it("garante semântica inicial, árvore e confirmações — nessa ordem, do @workspace/db", () => {
    const pipeline = readFileSync(path.join(RAIZ, "pipeline.ts"), "utf8");

    const posicoes = [
      "garantirSemanticaInicial",
      "garantirTaxonomiaCanonica",
      "aplicarConfirmacoesCanonicas",
    ].map((fn) => {
      const chamada = pipeline.indexOf(`await ${fn}(`);
      expect(chamada, `${fn} não é chamada na promoção`).toBeGreaterThan(-1);
      return chamada;
    });
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));

    // E as três vêm do piso comum, num único import.
    const doDb = /import\s*\{([^}]+)\}\s*from\s+["']@workspace\/db["']/s.exec(pipeline);
    expect(doDb).not.toBeNull();
    for (const fn of [
      "garantirSemanticaInicial",
      "garantirTaxonomiaCanonica",
      "aplicarConfirmacoesCanonicas",
    ]) {
      expect(doDb![1]).toContain(fn);
    }
  });

  /**
   * O que a promoção **não** faz.
   *
   * `runProposalPass` move atributos para PRESUMED com a justificativa do
   * motor: é inferência, e inferência não é verdade estrutural do produto.
   * Continua sendo ato de curadoria, na tela ou por CLI.
   */
  it("não roda a passada de proposta", () => {
    const pipeline = readFileSync(path.join(RAIZ, "pipeline.ts"), "utf8");
    // Uma *chamada*, e não a menção: o comentário que explica por que ela fica
    // de fora é parte do que se quer manter no arquivo.
    expect(pipeline).not.toMatch(/\brunProposalPass\s*\(/);
  });
});
