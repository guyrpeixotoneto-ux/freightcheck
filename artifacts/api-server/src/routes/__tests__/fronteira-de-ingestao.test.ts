import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IRouter } from "express";

/**
 * A fronteira de ingestão — duas portas, e nenhuma terceira, nem adormecida.
 *
 * O contrato que este arquivo transforma em máquina:
 *
 *   > Dado operacional que alimenta o modelo canônico entra por **duas**
 *   > portas: Importações e Alterações → Chamados. Nenhum outro módulo, tela,
 *   > endpoint, job, script ou serviço cria ou promove dado canônico.
 *
 * A auditoria encontrou uma terceira porta viva no repositório — `overview.ts`
 * reimplementava `POST /imports` e `POST /imports/:id/promote` inteiros — e o
 * que a mantinha inalcançável era **uma linha de ordem** em `routes/index.ts`.
 * Uma regra que depende da ordem de montagem de um arquivo não é uma regra: é
 * uma coincidência que ainda não foi desfeita.
 *
 * Por isso a proteção aqui é em três alturas, e cada uma pega o que as outras
 * deixam passar:
 *
 * 1. **A rota.** Nenhum par (método, caminho) pode ser registrado duas vezes no
 *    router do produto — e `POST /imports` e `POST /imports/:id/promote`, em
 *    particular, têm exatamente um dono. É a altura que teria pegado
 *    `overview.ts` no dia em que ele foi escrito.
 * 2. **A superfície.** Só `routes/imports.ts` alcança o pipeline de vigência, e
 *    só `routes/tickets.ts` alcança o de chamados. É a altura que pega a porta
 *    escrita com **outro** caminho — `POST /upload`, `POST /v2/imports`.
 * 3. **A tabela.** Só um conjunto declarado de arquivos escreve no núcleo
 *    canônico. É a altura que pega o que não passa por rota nenhuma: um job, um
 *    script, um `INSERT` dentro de um módulo de leitura.
 *
 * **O que esta prova não é.** A terceira altura é varredura textual, não
 * análise de AST: ela reconhece as formas diretas de escrita — `.insert(X)`,
 * `INSERT INTO x` — e não segue uma escrita passada por indireção. É uma rede,
 * não uma prisão; a prisão é a autoridade de escrita centralizada, que é
 * mudança de comportamento e tem PR próprio. Enquanto ela não existe, esta rede
 * é o que impede a regressão silenciosa, e ela vem com caso de controle para
 * que uma varredura quebrada não passe fingindo que está tudo bem.
 */

const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

// ---------------------------------------------------------------------------
// Altura 1 — a rota
// ---------------------------------------------------------------------------

interface RotaRegistrada {
  metodo: string;
  caminho: string;
}

/**
 * Todo par (método, caminho) que o router do produto registra.
 *
 * O Express aninha: `router.use(outroRouter)` vira uma camada cujo `handle`
 * tem a própria pilha. Descer por ela é o que permite ver as rotas dos dezoito
 * arquivos como uma lista só — que é como o Express as vê ao casar um pedido, e
 * portanto a única forma de enxergar duas registrando o mesmo caminho.
 */
function rotasDe(camadas: unknown[], saida: RotaRegistrada[] = []): RotaRegistrada[] {
  for (const camada of camadas as {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: unknown[] };
  }[]) {
    if (camada.route) {
      for (const [metodo, ativo] of Object.entries(camada.route.methods)) {
        if (ativo) saida.push({ metodo: metodo.toUpperCase(), caminho: camada.route.path });
      }
      continue;
    }
    if (camada.handle?.stack) rotasDe(camada.handle.stack, saida);
  }
  return saida;
}

async function rotasDoProduto(): Promise<RotaRegistrada[]> {
  const { default: router } = (await import("../index")) as { default: IRouter };
  return rotasDe((router as unknown as { stack: unknown[] }).stack);
}

describe("altura 1 — uma rota, um dono", () => {
  it("`POST /imports` e `POST /imports/:id/promote` têm exatamente um dono", async () => {
    const rotas = await rotasDoProduto();
    for (const caminho of ["/imports", "/imports/:id/promote"]) {
      const donos = rotas.filter((r) => r.metodo === "POST" && r.caminho === caminho);
      expect(
        donos.length,
        `POST ${caminho} registrado ${donos.length}× — uma segunda porta de ` +
          `entrada, alcançável por uma reordenação de routes/index.ts`,
      ).toBe(1);
    }
  });

  it("`POST /ticket-imports` tem exatamente um dono", async () => {
    const rotas = await rotasDoProduto();
    const donos = rotas.filter(
      (r) => r.metodo === "POST" && r.caminho === "/ticket-imports",
    );
    expect(donos.length).toBe(1);
  });

  it("nenhum par (método, caminho) é registrado duas vezes", async () => {
    const rotas = await rotasDoProduto();
    const contagem = new Map<string, number>();
    for (const r of rotas) {
      const chave = `${r.metodo} ${r.caminho}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    const duplicadas = [...contagem.entries()]
      .filter(([, n]) => n > 1)
      .map(([chave, n]) => `${chave} (${n}×)`);

    // Uma rota registrada duas vezes é sempre uma das duas coisas, e as duas
    // são defeito: código morto que ninguém sabe que é morto, ou duas respostas
    // diferentes para o mesmo endereço, decididas pela ordem de montagem.
    expect(duplicadas).toEqual([]);
  });

  it("o levantamento de rotas de fato enxerga as rotas — o controle da prova", async () => {
    const rotas = await rotasDoProduto();
    expect(rotas.length).toBeGreaterThan(50);
    expect(rotas).toContainEqual({ metodo: "POST", caminho: "/imports" });
    expect(rotas).toContainEqual({ metodo: "GET", caminho: "/overview" });
  });
});

// ---------------------------------------------------------------------------
// Altura 2 — a superfície
// ---------------------------------------------------------------------------

/** Os passos que escrevem, do pipeline de vigência. */
const PIPELINE_DE_VIGENCIA = [
  "receiveFile",
  "captureRaw",
  "stage",
  "preview",
  "promote",
  "deleteImportRun",
  "markRunFailed",
];

/** Os passos que escrevem, do pipeline de chamados. */
const PIPELINE_DE_CHAMADOS = [
  "receiveTicketFile",
  "readTicketImport",
  "deleteTicketImport",
  "markTicketImportFailed",
];

function arquivosDeRota(): string[] {
  const dir = path.join(RAIZ, "artifacts/api-server/src/routes");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(dir, f));
}

/** O bloco `import … from "@workspace/ingest"` de um arquivo, se houver. */
function importaDoIngest(fonte: string): string[] {
  const nomes: string[] = [];
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*["']@workspace\/ingest["']/g;
  for (let m = re.exec(fonte); m !== null; m = re.exec(fonte)) {
    for (const parte of m[1].split(",")) {
      const nome = parte.trim().split(/\s+as\s+/)[0].trim();
      if (nome !== "" && !nome.startsWith("type ")) nomes.push(nome);
    }
  }
  return nomes;
}

describe("altura 2 — só duas rotas alcançam a ingestão", () => {
  it("o pipeline de vigência é alcançado apenas por routes/imports.ts", () => {
    const alcancam = arquivosDeRota().filter((arquivo) => {
      const importados = importaDoIngest(readFileSync(arquivo, "utf8"));
      return PIPELINE_DE_VIGENCIA.some((passo) => importados.includes(passo));
    });

    expect(
      alcancam.map((f) => path.basename(f)).sort(),
      "uma segunda rota passou a alcançar o pipeline de vigência",
    ).toEqual(["imports.ts"]);
  });

  it("o pipeline de chamados é alcançado apenas por routes/tickets.ts", () => {
    const alcancam = arquivosDeRota().filter((arquivo) => {
      const importados = importaDoIngest(readFileSync(arquivo, "utf8"));
      return PIPELINE_DE_CHAMADOS.some((passo) => importados.includes(passo));
    });

    expect(alcancam.map((f) => path.basename(f)).sort()).toEqual(["tickets.ts"]);
  });
});

// ---------------------------------------------------------------------------
// Altura 3 — a tabela
// ---------------------------------------------------------------------------

/**
 * O núcleo canônico: o fato e a identidade a que ele pertence.
 *
 * É o que precisa ser rastreável até a célula do arquivo de origem, e por isso
 * é o que não pode nascer fora da importação.
 */
const NUCLEO: { tabela: string; simbolo: string }[] = [
  { tabela: "fact", simbolo: "factTable" },
  { tabela: "snapshot", simbolo: "snapshotTable" },
  { tabela: "snapshot_scope", simbolo: "snapshotScopeTable" },
  { tabela: "snapshot_attribute", simbolo: "snapshotAttributeTable" },
  { tabela: "snapshot_entity_type", simbolo: "snapshotEntityTypeTable" },
  { tabela: "snapshot_merge", simbolo: "snapshotMergeTable" },
  { tabela: "entity", simbolo: "entityTable" },
  { tabela: "entity_identifier", simbolo: "entityIdentifierTable" },
  { tabela: "scope", simbolo: "scopeTable" },
];

/**
 * O dicionário e a classificação.
 *
 * Ficam separados do núcleo porque têm **dois** donos legítimos, e a diferença
 * é do domínio: a importação **descobre** uma coluna nova; a curadoria decide o
 * que ela significa e onde ela mora na árvore. Um fato não tem esse segundo
 * dono — ninguém "decide" um fato depois que ele foi lido.
 */
const DICIONARIO: { tabela: string; simbolo: string }[] = [
  { tabela: "attribute", simbolo: "attributeTable" },
  { tabela: "attribute_alias", simbolo: "attributeAliasTable" },
  { tabela: "taxonomy_node", simbolo: "taxonomyNodeTable" },
];

/**
 * Quem pode escrever no núcleo canônico, e por quê.
 *
 * Cada linha é uma autorização nomeada. Acrescentar uma é uma decisão de
 * arquitetura, e é para isso que ela mora numa lista e não na cabeça de quem
 * revisa.
 */
const AUTORIZADOS_NO_NUCLEO: Record<string, string> = {
  "lib/ingest/src/pipeline.ts":
    "a promoção — o único lugar que cria fato, vigência, entidade e escopo",
  "lib/ingest/src/deletion.ts":
    "a exclusão de importação, que é a porta de Importações desfazendo o que ela fez",
  "lib/comparison/src/testing.ts":
    "o construtor de fixtures sintéticas, exportado como `@workspace/comparison/testing` e usado só por teste",
  "lib/db/src/bridge.ts":
    "a ponte de deploy: ela não escreve statement próprio — levanta o da migration que criou a tabela e o reexecuta",
};

const AUTORIZADOS_NO_DICIONARIO: Record<string, string> = {
  ...AUTORIZADOS_NO_NUCLEO,
  "lib/curation/src/engine.ts": "a curadoria propondo semântica",
  "lib/curation/src/taxonomy.ts": "a curadoria semeando a árvore de remuneração",
  "lib/curation/src/versioning.ts": "a curadoria versionando a semântica de um atributo",
};

/**
 * A fonte sem os comentários.
 *
 * Sem isto, o parágrafo de `routes/imports.ts` que **cita** uma mensagem de
 * erro do driver (`Failed query: INSERT INTO "snapshot_entity_type" …`) seria
 * lido como uma escrita. A regra é de linha inteira, e só derruba linha que
 * começa como comentário: uma linha de código nunca começa com `//` ou `*`, e
 * limitar-se a essas é o que evita cortar código junto.
 */
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .filter((linha) => {
      const t = linha.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

function arquivosDeFonte(dir: string, saida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const caminho = path.join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      if (entrada === "__tests__" || entrada === "node_modules" || entrada === "dist") {
        continue;
      }
      arquivosDeFonte(caminho, saida);
      continue;
    }
    if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

/** Todo `src/` de produção do workspace: os pacotes e os artefatos. */
function fontesDoWorkspace(): string[] {
  const raizes: string[] = [];
  for (const grupo of ["lib", "artifacts"]) {
    const dir = path.join(RAIZ, grupo);
    for (const pacote of readdirSync(dir)) {
      const src = path.join(dir, pacote, "src");
      try {
        if (statSync(src).isDirectory()) raizes.push(src);
      } catch {
        /* pacote sem src — api-spec, por exemplo */
      }
    }
  }
  raizes.push(path.join(RAIZ, "scripts/src"));
  return raizes.flatMap((r) => arquivosDeFonte(r));
}

/**
 * As formas em que uma escrita aparece, e por que são quatro e não duas.
 *
 * As duas primeiras são as óbvias. As duas últimas entraram porque a própria
 * prova de controle deste arquivo as encontrou faltando: `pipeline.ts` — o
 * escritor mais importante do sistema — **não era detectado** pelas duas
 * primeiras. Ele insere fato por um helper genérico (`insertChunked(tx,
 * factTable, …)`) e por SQL com o símbolo interpolado (`INSERT INTO
 * ${factTable} (…)`), e nenhuma das duas se parece com `.insert(factTable)`.
 *
 * É exatamente o buraco por onde uma escrita nova passaria sem ser vista, e foi
 * o controle que o mostrou — motivo pelo qual ele existe.
 */
function padroesDeEscrita(tabela: string, simbolo: string): RegExp[] {
  return [
    /* 1. drizzle direto: `db.insert(factTable)` */
    new RegExp(`\\.(insert|update|delete)\\(\\s*${simbolo}\\b`),
    /* 2. SQL cru com o nome da tabela: `INSERT INTO fact` */
    new RegExp(`(INSERT\\s+INTO|DELETE\\s+FROM|UPDATE)\\s+"?${tabela}"?[\\s("]`, "i"),
    /* 3. SQL com o símbolo interpolado: `INSERT INTO ${factTable} (` */
    new RegExp(`(INSERT\\s+INTO|DELETE\\s+FROM|UPDATE)\\s+\\$\\{\\s*${simbolo}\\b`, "i"),
    /*
      4. helper cujo nome começa por um verbo de escrita, recebendo a tabela:
      `insertChunked(tx, factTable, …)`. Ancorado no início do nome de
      propósito — `filterDeleted(x, factTable)` é leitura e não pode ser
      acusada por conter "Deleted" no meio.
    */
    new RegExp(`\\b(insert|update|delete|upsert)[A-Za-z]*\\([^)]*\\b${simbolo}\\b`),
  ];
}

/** Os arquivos que escrevem numa tabela, pelas formas conhecidas de escrita. */
function escritoresDe(tabela: string, simbolo: string): string[] {
  const padroes = padroesDeEscrita(tabela, simbolo);
  return fontesDoWorkspace()
    .filter((arquivo) => {
      const fonte = semComentarios(readFileSync(arquivo, "utf8"));
      return padroes.some((p) => p.test(fonte));
    })
    .map((arquivo) => path.relative(RAIZ, arquivo))
    .sort();
}

describe("altura 3 — só o caminho autorizado escreve no canônico", () => {
  it.each(NUCLEO)(
    "`$tabela` só é escrita por quem está autorizado",
    ({ tabela, simbolo }) => {
      const naoAutorizados = escritoresDe(tabela, simbolo).filter(
        (arquivo) => !(arquivo in AUTORIZADOS_NO_NUCLEO),
      );
      expect(
        naoAutorizados,
        `escrita em \`${tabela}\` fora do caminho autorizado. Dado canônico ` +
          `nasce na importação e em mais lugar nenhum — ver ` +
          `docs/AUDITORIA-COMPLEMENTO-BASELINE.md, Parte A.`,
      ).toEqual([]);
    },
  );

  it.each(DICIONARIO)(
    "`$tabela` só é escrita pela importação ou pela curadoria",
    ({ tabela, simbolo }) => {
      const naoAutorizados = escritoresDe(tabela, simbolo).filter(
        (arquivo) => !(arquivo in AUTORIZADOS_NO_DICIONARIO),
      );
      expect(naoAutorizados).toEqual([]);
    },
  );

  it("nenhuma rota do api-server escreve no núcleo canônico", () => {
    // A altura 2 prova que nenhuma rota *chama* o pipeline; esta prova que
    // nenhuma o contorna, escrevendo na tabela por conta própria.
    const rotas = new Set(
      arquivosDeRota().map((f) => path.relative(RAIZ, f)),
    );
    for (const { tabela, simbolo } of [...NUCLEO, ...DICIONARIO]) {
      const infratoras = escritoresDe(tabela, simbolo).filter((f) => rotas.has(f));
      expect(infratoras, `rota escrevendo em \`${tabela}\``).toEqual([]);
    }
  });

  it("a varredura encontra os escritores que existem — o controle da prova", () => {
    // Uma asserção de ausência que não sabe encontrar presença não prova nada.
    // A promoção escreve fato e vigência; a exclusão apaga os dois. Se a
    // varredura deixar de vê-los, ela deixou de ver qualquer coisa.
    expect(escritoresDe("fact", "factTable")).toContain("lib/ingest/src/pipeline.ts");
    expect(escritoresDe("snapshot", "snapshotTable")).toContain(
      "lib/ingest/src/pipeline.ts",
    );
    expect(escritoresDe("fact", "factTable")).toContain("lib/ingest/src/deletion.ts");
    expect(escritoresDe("taxonomy_node", "taxonomyNodeTable")).toContain(
      "lib/curation/src/taxonomy.ts",
    );
  });

  it("toda autorização declarada é usada — nenhuma sobra de uma correção antiga", () => {
    // Uma lista de exceções que ninguém poda cresce até deixar de ser lista de
    // exceções. Se um arquivo autorizado parou de escrever, a autorização sai.
    const escrevemDeFato = new Set(
      [...NUCLEO, ...DICIONARIO].flatMap(({ tabela, simbolo }) =>
        escritoresDe(tabela, simbolo),
      ),
    );
    const orfas = Object.keys(AUTORIZADOS_NO_DICIONARIO).filter(
      (arquivo) => !escrevemDeFato.has(arquivo),
    );
    expect(orfas).toEqual([]);
  });
});
