import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * O caminho que abre a porta não passa pelo gerenciador de pacotes.
 *
 * O sintoma foi este: **nem a Web nem o API Server abriram suas portas em 90
 * segundos**, os dois ao mesmo tempo, sem mensagem. A causa não estava em
 * nenhum dos dois — estava no que os dois faziam antes de abrir a porta.
 *
 * `scripts/dev.mjs api` chamava `pnpm install --frozen-lockfile` como primeira
 * coisa de `supervisor.start()`, e `startWeb()` subia o Vite por
 * `pnpm --filter … run dev`. Num contêiner onde o bootstrap do pnpm do Replit
 * entra em laço — `pnpm add pnpm@10.33.0` falhando em série, que é o mesmo erro
 * que derrubou o build da publicação —, nenhum dos dois chega ao ponto de
 * escutar. E como ninguém escuta, o roteador devolve 502 e o diagnóstico que
 * chega a quem opera não tem relação com a causa.
 *
 * O conserto é de ordem, não de ferramenta: **primeiro a porta, depois o
 * resto**. Instalar dependência deixa de acontecer na partida (é ato
 * explícito), e o que sobra no caminho é invocado direto — `node` para o build
 * do api-server, o binário local do `vite` para a interface.
 *
 * Invocar direto duplica o que o `package.json` declara, e duplicação sem
 * prova vira deriva na primeira vez que alguém mudar o script. Por isso a
 * segunda metade destas provas: o comando daqui tem de continuar sendo o mesmo
 * que o pacote declara.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");
const pacote = (rel) => JSON.parse(ler(rel));

/** O que sobra de `dev.mjs` quando os comentários saem. */
function executavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

describe("a partida não depende do gerenciador de pacotes", () => {
  it("dev.mjs não invoca pnpm em lugar nenhum do caminho executável", () => {
    const fonte = executavel("scripts/dev.mjs");
    // Nem para instalar, nem para construir, nem para subir a interface.
    expect(fonte).not.toMatch(/["']pnpm["']/);
    expect(fonte).toMatch(/runInstall:\s*null/);
    expect(fonte).toMatch(/runMigrations:\s*null/);
  });

  it("o supervisor tolera a ausência do passo de install", () => {
    // `runInstall` é opcional por contrato; `runMigrations` não é, e por isso
    // continua sendo passado explicitamente como `null`.
    expect(ler("scripts/lib/api-supervisor.mjs")).toMatch(/runInstall\s*=\s*null/);
  });
});

describe("o comando invocado direto continua sendo o que o pacote declara", () => {
  it("o build do api-server", () => {
    // package.json: "build": "node ./build.mjs" — e dev.mjs chama o mesmo
    // arquivo pela raiz, o que funciona porque `build.mjs` resolve tudo a
    // partir de `import.meta.url` e não do diretório de trabalho.
    expect(pacote("artifacts/api-server/package.json").scripts.build).toBe(
      "node ./build.mjs",
    );
    expect(executavel("scripts/dev.mjs")).toMatch(
      /runCaptured\("node",\s*\["artifacts\/api-server\/build\.mjs"\]\)/,
    );
  });

  it("o dev da interface", () => {
    const declarado = pacote("artifacts/freightaudit/package.json").scripts.dev;
    expect(declarado).toBe("vite --config vite.config.ts --host 0.0.0.0");

    // Os mesmos argumentos, na mesma ordem, pelo binário local do artifact.
    const fonte = executavel("scripts/dev.mjs");
    expect(fonte).toMatch(/"\.\/node_modules\/\.bin\/vite"/);
    for (const arg of declarado.split(" ").slice(1)) {
      expect(fonte).toContain(`"${arg}"`);
    }
    // E rodando dentro do artifact, senão o binário e o config não existem.
    expect(fonte).toMatch(/path\.join\(root,\s*"artifacts\/freightaudit"\)/);
  });
});
