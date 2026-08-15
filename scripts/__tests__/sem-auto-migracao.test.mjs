import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Development não migra sozinho — e isso é pré-condição do bridge deploy.
 *
 * O Publishing do Replit calcula o diff comparando **Development com
 * Production**. Enquanto `pnpm dev` e o `postMerge` aplicavam a fila
 * automaticamente, qualquer `Run` ou merge levava o banco de desenvolvimento
 * para a migration seguinte sem ninguém decidir isso — e a publicação seguinte
 * encontrava uma diferença fabricada, com DDL destrutivo e DDL impossível
 * dentro. Foi assim que Development chegou à `0018` com Production no registro
 * vazio.
 *
 * Depois do `bridge-down` isso passa a ser pior do que incômodo: um `Run` antes
 * do Publishing restauraria o schema novo em Development e **recriaria
 * exatamente o diff perigoso** que o bridge acabou de desmontar. Por isso a
 * ausência da migração automática é prova, e não convenção.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");

/**
 * **Executar** a fila, que é diferente de citá-la.
 *
 * Em `dev.mjs` a fila só roda por um processo filho, e todo processo filho sai
 * por `runCaptured` ou `spawnChild`. É isso que o teste procura — e não a
 * palavra "migrate", que aparece de propósito na mensagem que ensina o comando
 * a quem sobe o projeto. Um teste que proibisse a palavra proibiria a
 * documentação junto.
 */
const EXECUCAO = /(runCaptured|spawnChild|spawn)\s*\([^)]*migrate/s;

describe("Development não avança sozinho", () => {
  it("scripts/dev.mjs não aplica migrations na partida", () => {
    const fonte = ler("scripts/dev.mjs");

    // O supervisor recebe `runMigrations: null` — o passo existe na interface,
    // e é declarado ausente de propósito.
    expect(fonte).toMatch(/runMigrations:\s*null/);

    // E nenhuma linha executável invoca a fila. Comentários podem citá-la: é
    // onde está escrito como aplicá-la à mão.
    const executavel = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(executavel).not.toMatch(EXECUCAO);
  });

  it("scripts/post-merge.sh não aplica migrations depois do merge", () => {
    const fonte = ler("scripts/post-merge.sh");
    const executavel = fonte
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");

    // `echo` explicando como aplicar à mão é o que se espera encontrar.
    expect(executavel).not.toMatch(/^\s*pnpm .*run migrate/m);
    expect(fonte).toMatch(/migrations NÃO aplicadas/);
  });

  it("a instrução de aplicar à mão continua no lugar, nos dois", () => {
    // Tirar o automatismo sem dizer o que fazer no lugar troca um defeito por
    // outro: quem abre o projeto precisa achar o comando onde ele sumiu.
    expect(ler("scripts/dev.mjs")).toMatch(/@workspace\/db.*run migrate/s);
    expect(ler("scripts/post-merge.sh")).toMatch(/@workspace\/db.*run migrate/s);
  });
});
