/**
 * Como a bateria de testes se divide entre os jobs do CI.
 *
 * **Por que por pacote, e não pelo `--shard` do vitest.** O sharding nativo
 * distribui *arquivos* por hash do caminho, e aqui isso desfaria o ganho que
 * dá o tempo atual: as suítes que partem de dado real clonam um banco-template
 * construído uma vez (ver `lib/ingest/src/testing.ts`), e o template vive
 * dentro do Postgres **daquele job**. Espalhar `comparison`, `curation`,
 * `composition` e `dre` por jobs diferentes faria cada um reconstruir o mesmo
 * template — 26 s medidos, quatro vezes, para economizar segundos de fila.
 *
 * A divisão abaixo é, então, primeiro por **localidade de template** e só
 * depois por peso:
 *
 *   export_real_promovido -> comparison, curation, composition, dre
 *   modelos_curados       -> comparison
 *   modelos_promovidos    -> balance
 *
 * Tempos medidos por pacote, isolados, com cache e template frios:
 *
 *   ingest 96.9s · comparison 56.1s · balance 58.4s · composition 33.8s
 *   dre 30.7s · curation 26.8s · api-server 26.9s · db 18.4s · assistant 16.5s
 *   scripts 2.5s · freightaudit 1.3s · simulation 1.0s · knowledge 0.7s
 *
 * Manter isto honesto é a única obrigação de quem mexer aqui: um pacote com
 * testes que não apareça em nenhum shard **não roda no CI**, e o verde deixaria
 * de querer dizer o que diz. É o que `conferirCobertura` impede, e é por isso
 * que ela roda como teste — não como etapa opcional de lint.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Nome do job -> pacotes que ele roda.
 *
 * `assistente` fica sozinho porque é o único que precisa do banco **semeado**:
 * a bateria confere que o número que o assistente cita é o mesmo que o motor
 * devolve, e para isso o export real precisa estar promovido. Os outros jobs
 * criam os seus próprios bancos e não pagam o seed.
 */
export const SHARDS = {
  unit: [
    "@workspace/knowledge",
    "@workspace/simulation",
    "@workspace/scripts",
    "@workspace/freightaudit",
  ],
  ingest: ["@workspace/ingest", "@workspace/db"],
  curado: [
    "@workspace/comparison",
    "@workspace/curation",
    "@workspace/composition",
    "@workspace/dre",
  ],
  balance: ["@workspace/balance", "@workspace/api-server"],
  assistente: ["@workspace/assistant"],
};

/** Os shards que precisam do banco semeado antes de rodar. */
export const SHARDS_COM_SEED = new Set(["assistente"]);

/** Todo pacote do workspace que declara um script `test`. */
export function pacotesComTeste() {
  const encontrados = [];
  for (const dir of ["lib", "artifacts", "."]) {
    const base = path.join(RAIZ, dir);
    let entradas;
    try {
      entradas = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      if (!e.isDirectory() && dir !== ".") continue;
      const pkg = path.join(base, e.name, "package.json");
      try {
        const json = JSON.parse(readFileSync(pkg, "utf8"));
        if (json.scripts?.test) encontrados.push(json.name);
      } catch {
        // não é pacote, ou não tem package.json — segue
      }
    }
  }
  return encontrados.sort();
}

/**
 * Todo pacote com testes está em exatamente um shard?
 *
 * Devolve o que está errado em vez de lançar, para que o teste que a usa possa
 * dizer **quais** pacotes faltam em vez de só reprovar.
 */
export function conferirCobertura() {
  const declarados = Object.values(SHARDS).flat();
  const noDisco = pacotesComTeste();

  const contagem = new Map();
  for (const p of declarados) contagem.set(p, (contagem.get(p) ?? 0) + 1);

  return {
    /** Tem `test` e nenhum shard o roda — o buraco que produz falso verde. */
    semShard: noDisco.filter((p) => !contagem.has(p)),
    /** Rodaria duas vezes, gastando o dobro sem cobrir mais nada. */
    duplicados: [...contagem.entries()]
      .filter(([, n]) => n > 1)
      .map(([p]) => p),
    /** Está num shard e não existe (ou perdeu o script `test`). */
    inexistentes: declarados.filter((p) => !noDisco.includes(p)),
    noDisco,
    declarados,
  };
}

/** `--filter @workspace/a --filter @workspace/b`, para o pnpm. */
export function filtrosDoShard(nome) {
  const pacotes = SHARDS[nome];
  if (!pacotes) {
    throw new Error(
      `shard "${nome}" não existe. Os que existem: ${Object.keys(SHARDS).join(", ")}`,
    );
  }
  return pacotes.map((p) => `--filter ${p}`).join(" ");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [comando, argumento] = process.argv.slice(2);
  if (comando === "filtros") {
    process.stdout.write(filtrosDoShard(argumento));
  } else if (comando === "precisa-seed") {
    // Código de saída, para o `if` do shell no workflow.
    process.exit(SHARDS_COM_SEED.has(argumento) ? 0 : 1);
  } else if (comando === "conferir") {
    const r = conferirCobertura();
    const problemas = [
      ...r.semShard.map((p) => `sem shard: ${p}`),
      ...r.duplicados.map((p) => `em dois shards: ${p}`),
      ...r.inexistentes.map((p) => `no shard mas sem testes: ${p}`),
    ];
    for (const p of problemas) console.error(p);
    console.log(
      `${r.noDisco.length} pacotes com teste, ${Object.keys(SHARDS).length} shards`,
    );
    process.exit(problemas.length > 0 ? 1 : 0);
  } else {
    console.error("uso: shards.mjs filtros <nome> | shards.mjs conferir");
    process.exit(2);
  }
}
