import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  arestasDeclaradas,
  arestasQuebradas,
  conferirArestas,
  explicarFalhaDeResolucao,
  frase,
  globosDoWorkspace,
  lerPacotes,
} from "../lib/arestas-do-workspace.mjs";

/**
 * O estado que produziu `Could not resolve "@workspace/coverage"`.
 *
 * Ele foi medido, e não imaginado: com o link no lugar, `import.meta.resolve` e
 * o esbuild resolvem os dois; removendo **só**
 * `lib/assistant/node_modules/@workspace/coverage` — e deixando de pé o
 * `artifacts/api-server/node_modules/@workspace/coverage`, que é o que faz
 * alguém concluir "o symlink existe" —, os dois falham, e o esbuild falha com
 * aquela mensagem exata, apontando para `lib/assistant/src/aprofundar.ts`.
 *
 * Não havia nada de particular no `coverage`: ele era a aresta mais nova do
 * repositório, e por isso a única que um `node_modules` anterior não tinha.
 * Por isso estas provas não citam o `coverage` como caso especial — elas fixam
 * a classe.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Um workspace de mentira, para a parte pura: sem tocar em disco nenhum. */
const PACOTES = [
  {
    nome: "@workspace/assistant",
    dir: "/w/lib/assistant",
    manifesto: {
      dependencies: { "@workspace/coverage": "workspace:*", "pg": "^8" },
      devDependencies: { vitest: "^3" },
    },
  },
  {
    nome: "@workspace/coverage",
    dir: "/w/lib/coverage",
    manifesto: { dependencies: { "@workspace/db": "workspace:*" } },
  },
  {
    nome: "@workspace/api-server",
    dir: "/w/artifacts/api-server",
    manifesto: { dependencies: { "@workspace/coverage": "workspace:*" } },
  },
];

describe("as arestas declaradas", () => {
  it("são só as do escopo, e vêm das duas listas de dependência", () => {
    const arestas = arestasDeclaradas(PACOTES);

    expect(arestas).toContainEqual({
      pacote: "@workspace/assistant",
      dir: "/w/lib/assistant",
      dependencia: "@workspace/coverage",
    });
    // `pg` e `vitest` não são arestas do workspace.
    expect(arestas.map((a) => a.dependencia)).not.toContain("pg");
    expect(arestas.map((a) => a.dependencia)).not.toContain("vitest");
  });

  it("devDependencies conta: a suíte resolve pelo mesmo node_modules", () => {
    const comDev = [
      {
        nome: "@workspace/x",
        dir: "/w/lib/x",
        manifesto: { devDependencies: { "@workspace/curation": "workspace:*" } },
      },
    ];
    expect(arestasDeclaradas(comDev)).toHaveLength(1);
  });
});

describe("a aresta quebrada é a que não está no node_modules de quem declara", () => {
  /** O disco do dia do defeito: o link existe no api-server e não no assistant. */
  const disco = new Set([
    "/w/artifacts/api-server/node_modules/@workspace/coverage",
    "/w/lib/coverage/node_modules/@workspace/db",
  ]);
  const existe = (p) => disco.has(p);

  it("acha exatamente a que faltava, e nenhuma outra", () => {
    const quebradas = arestasQuebradas(arestasDeclaradas(PACOTES), existe);

    expect(quebradas).toEqual([
      {
        pacote: "@workspace/assistant",
        dir: "/w/lib/assistant",
        dependencia: "@workspace/coverage",
      },
    ]);
  });

  it("o mesmo pacote linkado em outro lugar não conta como resolvido", () => {
    // É a armadilha inteira do defeito: `@workspace/coverage` estava linkado —
    // no diretório errado. O pnpm liga por pacote que declara.
    const quebradas = arestasQuebradas(arestasDeclaradas(PACOTES), existe);
    expect(existe("/w/artifacts/api-server/node_modules/@workspace/coverage")).toBe(true);
    expect(quebradas).toHaveLength(1);
  });

  it("link pendurado é aresta quebrada — `existsSync` segue o symlink", () => {
    // Nada a montar: o contrato é `existe` responder pelo alvo, não pelo link.
    const quebradas = arestasQuebradas(arestasDeclaradas(PACOTES), () => false);
    expect(quebradas).toHaveLength(arestasDeclaradas(PACOTES).length);
  });

  it("workspace inteiro no lugar não produz aresta nenhuma", () => {
    expect(arestasQuebradas(arestasDeclaradas(PACOTES), () => true)).toEqual([]);
  });
});

describe("a frase diz a causa, e não o sintoma", () => {
  const quebradas = [
    {
      pacote: "@workspace/assistant",
      dir: path.join(RAIZ, "lib/assistant"),
      dependencia: "@workspace/coverage",
    },
  ];

  it("nomeia o link ausente pelo caminho, e o comando que o repõe", () => {
    const texto = frase(quebradas, RAIZ, () => false);

    expect(texto).toContain("lib/assistant/node_modules/@workspace/coverage");
    expect(texto).toContain("@workspace/assistant");
    expect(texto).toContain("pnpm install --frozen-lockfile");
  });

  it("avisa quando o mesmo pacote está linkado em outro lugar", () => {
    // A observação que mais custou: "o symlink existe" era verdade, e sobre o
    // diretório errado. Sem esta linha, quem lê confere o link certo, encontra
    // um, e volta a procurar defeito no pacote importado.
    const texto = frase(quebradas, RAIZ, (p) => !p.includes("lib/assistant"));

    expect(texto).toContain("está linkado em outro pacote");
  });

  it("silêncio quando não há o que dizer", () => {
    expect(frase([], RAIZ)).toBeNull();
  });
});

describe("a explicação de uma falha de resolução já acontecida", () => {
  it("separa link ausente de subcaminho fora do exports", () => {
    const saida = 'ERROR: Could not resolve "@workspace/curation/significado"';
    const texto = explicarFalhaDeResolucao(saida, RAIZ, () => true);

    // Com o link no lugar, mandar rodar install seria mandar repetir um
    // comando que não muda nada.
    expect(texto).toContain("exports");
    expect(texto).not.toContain("--frozen-lockfile");
  });

  it("manda instalar quando o pacote declarado não está linkado", () => {
    const saida = 'ERROR: Could not resolve "@workspace/coverage"';
    const texto = explicarFalhaDeResolucao(saida, RAIZ, () => false);

    expect(texto).toContain("pnpm install --frozen-lockfile");
    expect(texto).toContain("lib/assistant");
  });

  it("não fala de uma saída que não é sobre resolução", () => {
    expect(explicarFalhaDeResolucao("ERROR: syntax error", RAIZ)).toBeNull();
  });
});

describe("sobre este repositório, agora", () => {
  it("os globos saem do pnpm-workspace.yaml, e não de uma cópia aqui", () => {
    const globos = globosDoWorkspace(
      readFileSync(path.join(RAIZ, "pnpm-workspace.yaml"), "utf8"),
    );
    expect(globos).toContain("lib/*");
    expect(globos).toContain("artifacts/*");
  });

  it("lê os pacotes reais, incluindo os que o defeito envolveu", () => {
    const nomes = lerPacotes(RAIZ).map((p) => p.nome);
    expect(nomes).toContain("@workspace/assistant");
    expect(nomes).toContain("@workspace/coverage");
    expect(nomes).toContain("@workspace/api-server");
  });

  it("com node_modules instalado, nenhuma aresta está quebrada", () => {
    // Sem `node_modules` (CI que só faz checkout, por exemplo) a pergunta não
    // se aplica: não há grafo no disco para conferir contra.
    if (!existsSync(path.join(RAIZ, "lib/assistant/node_modules"))) return;

    const { quebradas, frase: texto } = conferirArestas(RAIZ);
    expect(quebradas, texto ?? "").toEqual([]);
    expect(texto).toBeNull();
  });
});
