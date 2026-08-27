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
 * Tempos medidos de cada shard, cada um como o job o roda — banco vazio, sem
 * template, cache do vitest frio:
 *
 *   ingest      101.6s   <- caminho crítico
 *   balance      66.0s
 *   curado       65.8s
 *   assistente   59.1s   (29.8s de seed + 20.2s de testes + 9.2s de benchmark)
 *   unit         19.8s
 *
 * `ingest` é 1,5× o seguinte e não dá para dividir por aqui: é um pacote só, e
 * o que pesa nele são quatro arquivos que importam o workbook de verdade
 * porque **a importação é o objeto do teste** — eles não podem clonar um banco
 * já importado. Quebrá-lo exigiria sharding por arquivo dentro do pacote, o
 * que é possível (ele não usa template, então não há localidade a preservar) e
 * levaria o caminho crítico a ~60s. Não está feito porque 101s já cabe com
 * folga no alvo, e um shard a mais custa mais manutenção do que os 40s valem.
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
  // `unit` é o shard **leve**, e não o shard "sem banco" — `db` e `coverage`
  // falam com Postgres, que o job sobe para todos os shards de qualquer jeito.
  // Os dois entram aqui por balanceamento medido: com `db` junto do `ingest` o
  // caminho crítico eram 111.1s contra 3.4s deste, a divisão mais desequilibrada
  // possível entre os cinco. `coverage` (38.9s) não usa template, então não tem
  // localidade a preservar e cabe onde sobra espaço.
  // `advisory` entrou aqui quando a bateria dele era só de função pura, e fica
  // pelo mesmo critério de peso agora que ela não é mais: o recorte da pauta num
  // ativo (`pauta-do-ativo.test.ts`) monta um banco sintético descartável, sem
  // template e sem seed — 2,5s medidos com ele dentro.
  unit: [
    "@workspace/knowledge",
    "@workspace/advisory",
    "@workspace/simulation",
    "@workspace/scripts",
    "@workspace/freightaudit",
    "@workspace/db",
    "@workspace/coverage",
    // `fechamento` tem duas metades e nenhuma delas é pesada: 32 testes de
    // aritmética pura sobre fixtures sintéticas, e 6 de integração que criam um
    // banco descartável a partir das migrations — o mesmo padrão de `db`, e por
    // isso ao lado dele. Não usa template nem seed, então não há localidade a
    // preservar; 2,3s medidos com o banco local.
    "@workspace/fechamento",
    // `remuneracao` tem exatamente o mesmo perfil, e por isso o mesmo lugar: 45
    // testes de aritmética pura sobre material sintético — as medições do
    // cadastro e a comparação das duas quinzenas — e 15 de leitura que criam um
    // banco descartável a partir das migrations, sem template e sem seed. 4,7s
    // medidos com o banco local.
    "@workspace/remuneracao",
    // `fluxos` é o motor de Fluxos Operacionais: metade função pura (catálogo,
    // validação, layout, o endereço de uma ação) e metade banco descartável
    // criado a partir das migrations — o mesmo perfil de `fechamento` e
    // `remuneracao`, e por isso o mesmo lugar. Sem template e sem seed.
    "@workspace/fluxos",
  ],
  ingest: ["@workspace/ingest"],
  curado: [
    "@workspace/comparison",
    "@workspace/curation",
    "@workspace/composition",
    "@workspace/dre",
    // `qlp` ainda não tem bateria própria — o quadro é exercitado de fora, por
    // `families-qlp` em comparison, `apresentacao` no front e `qlp.test.ts` no
    // api-server. Fica declarado aqui mesmo assim: o pacote já anuncia script
    // `test`, e um pacote com script e sem shard é exatamente o verde mentiroso
    // que esta lista existe para impedir. Quando a bateria dele nascer, nasce
    // junto de comparison e curation, de quem ele lê.
    "@workspace/qlp",
    // `compras` fica aqui por localidade de template, que é o primeiro critério
    // desta divisão: `frota-real.test.ts` clona `export_real_promovido`, o mesmo
    // template de `composition` e `dre`. Num outro shard ele o reconstruiria do
    // zero — os 26 s que o comentário do topo já contabiliza — para rodar 14
    // testes. As outras duas baterias do pacote não pesam: o catálogo é função
    // pura, e o QLP monta um banco sintético descartável, sem template e sem
    // seed.
    "@workspace/compras",
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
