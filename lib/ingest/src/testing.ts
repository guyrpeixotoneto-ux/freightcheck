import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Database } from "@workspace/db";
import { MIGRATIONS_FOLDER, runMigrations } from "@workspace/db/migrate";

/**
 * Each test file gets a scratch database created from the versioned
 * migrations — never from `drizzle push`. If a migration is broken, the tests
 * cannot run, which is the point.
 */

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

function urlFor(dbName: string): string {
  return ADMIN_URL.replace("/postgres?", `/${dbName}?`);
}

type Pool = ReturnType<typeof createDb>["pool"];

export interface TestDb {
  db: Database;
  pool: Pool;
  url: string;
  drop: () => Promise<void>;
}

export async function createTestDatabase(name: string): Promise<TestDb> {
  const dbName = `fc_test_${name}_${process.pid}`;
  const admin = createDb(ADMIN_URL);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.pool.query(`CREATE DATABASE "${dbName}"`);
  await admin.pool.end();

  const url = urlFor(dbName);
  await runMigrations(url);

  const { db, pool } = createDb(url);
  return {
    db,
    pool,
    url,
    drop: async () => {
      await pool.end();
      const cleanup = createDb(ADMIN_URL);
      await cleanup.pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanup.pool.end();
    },
  };
}

/**
 * Um banco descartável **clonado** de um preparo caro que já foi feito uma vez.
 *
 * O problema que isto resolve é a maior conta da suíte. Dezesseis arquivos
 * começam com o mesmo `beforeAll` — migrations, importar os workbooks reais,
 * semear a taxonomia, propor e aplicar semânticas — e cada um o refazia do
 * zero. Medido: 25.958 ms por arquivo, 63% do passo de testes, e em `cockpit`,
 * `families`, `grouped` e `range-real` esse preparo é **100% do tempo do
 * arquivo** — as asserções custam zero.
 *
 * A saída é do Postgres, e não nossa: `CREATE DATABASE x TEMPLATE y` copia os
 * arquivos de `y` no nível do sistema de arquivos. Medido no mesmo banco de
 * 105 MB: **269 ms**, contra 25.958 ms para refazer. 96,7× mais barato, e sem
 * serializar — quatro clones concorrentes custaram 313 ms cada, 9% acima do
 * clone solitário.
 *
 * **O que continua valendo, e é o que importa.** Cada arquivo recebe um banco
 * **físico próprio**: dois arquivos não enxergam a escrita um do outro, como
 * antes. As migrations versionadas continuam sendo executadas de verdade — uma
 * vez, no template —, e uma migration quebrada continua impedindo a suíte de
 * rodar. Nenhum teste passou a falar com dado inventado: o template nasce do
 * mesmo pipeline de importação que o produto usa.
 *
 * **O que muda.** O preparo roda uma vez por processo de CI em vez de dezesseis.
 * Quem precisa observar o preparo acontecendo — as suítes de `lib/ingest`, cujo
 * objeto **é** a importação — continua usando `createTestDatabase`.
 *
 * **Por que não `pg_dump`/`pg_restore`.** Quando isto foi medido, o restore
 * falhava com `function freightcheck_norm_canal(text) does not exist` — as
 * funções da identidade chamavam irmãs sem schema e o `pg_restore` roda com
 * `search_path` vazio. A `0036` corrigiu isso (e `backup-restore.test.ts`
 * prova o ciclo), mas o TEMPLATE continua sendo o caminho certo aqui pelo
 * custo: 269 ms contra segundos de dump+restore por arquivo.
 */

/** Constrói o conteúdo do template. Roda uma vez, contra um banco já migrado. */
export type FixtureBuilder = (db: Database) => Promise<void>;

/**
 * A identidade do template é o **conteúdo** que ele terá.
 *
 * Entram no hash as migrations, o código do próprio construtor, o código deste
 * módulo — que é onde mora o `importFixture` que os construtores chamam — e os
 * workbooks lidos do disco. Mudar qualquer um deles muda o nome do template, e
 * o próximo processo constrói um novo em vez de clonar um desatualizado. É o
 * que impede a otimização de virar cache mentiroso.
 *
 * **O pipeline entra no hash, e entrou pagando o preço de não estar.** Os
 * construtores chamam `./pipeline`, e o que a promoção faz mudou: ela passou a
 * garantir a semântica inicial, a árvore da taxonomia e as confirmações
 * canônicas dentro da própria transação. Com o hash cego a esse código, uma
 * máquina de desenvolvimento clonava um template construído *antes* da mudança
 * e a suíte inteira passava — enquanto o CI, que constrói do zero a cada job,
 * reprovava. Foi exatamente o que aconteceu em 17/08/2026: verde aqui,
 * vermelho lá, e a diferença era o template.
 *
 * Por isso o digest cobre agora `lib/ingest/src` inteiro e os módulos de
 * `@workspace/db` que a promoção executa. Custa uma leitura de alguns milhares
 * de linhas por processo, uma vez, e compra a única coisa que importa num
 * cache: que ele não minta.
 *
 * **O que o hash ainda não alcança**: um teste que, *depois* de clonar,
 * chame função de outro pacote (a curadoria, o motor de comparação) não vê
 * aquele código mudar — mas isso também não afeta o conteúdo do template, que
 * é o que ele identifica. Na dúvida, `pnpm run test:limpar-templates`.
 */
function hashDoDiretorio(h: ReturnType<typeof createHash>, dir: string): void {
  for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    // Os testes do próprio pacote não constroem template nenhum.
    if (entrada.name === "__tests__") continue;
    const alvo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      hashDoDiretorio(h, alvo);
    } else if (entrada.name.endsWith(".ts")) {
      h.update(entrada.name);
      h.update(readFileSync(alvo));
    }
  }
}

function digestDoTemplate(chave: string, builder: FixtureBuilder): string {
  const h = createHash("sha256");
  h.update(chave);
  h.update(builder.toString());
  h.update(readFileSync(fileURLToPath(import.meta.url)));

  // O pipeline que os construtores executam.
  hashDoDiretorio(h, path.dirname(fileURLToPath(import.meta.url)));

  /*
    E o que a promoção chama do `@workspace/db`: a semântica inicial, a árvore
    da taxonomia e o registro de confirmações. São três arquivos, e não o pacote
    inteiro, porque é este o código que decide o **conteúdo** do template.
  */
  const dbSrc = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../db/src",
  );
  for (const arquivo of [
    "semantica-inicial.ts",
    "taxonomia-canonica.ts",
    "semantica-confirmada.ts",
  ]) {
    h.update(arquivo);
    h.update(readFileSync(path.join(dbSrc, arquivo)));
  }

  const migrations = MIGRATIONS_FOLDER;
  for (const arquivo of readdirSync(migrations).sort()) {
    if (!arquivo.endsWith(".sql")) continue;
    h.update(arquivo);
    h.update(readFileSync(path.join(migrations, arquivo)));
  }

  const assets = assetsDir();
  for (const arquivo of readdirSync(assets).sort()) {
    if (!arquivo.endsWith(".xlsx")) continue;
    h.update(arquivo);
    h.update(readFileSync(path.join(assets, arquivo)));
  }

  return h.digest("hex").slice(0, 12);
}

/**
 * Chave do lock consultivo que serializa a construção.
 *
 * Vários workers do vitest chegam aqui ao mesmo tempo no primeiro arquivo que
 * pede a fixture. Sem o lock, todos constroem — que é exatamente o desperdício
 * que este módulo existe para eliminar. O lock é por banco no Postgres, e a
 * conexão é a de administração, então um número derivado do nome basta.
 */
function chaveDoLock(nome: string): number {
  const h = createHash("sha256").update(nome).digest();
  // 31 bits: cabe com folga no `int` que `pg_advisory_lock` aceita.
  return h.readUInt32BE(0) & 0x7fff_ffff;
}

async function garantirTemplate(
  nomeDoTemplate: string,
  builder: FixtureBuilder,
): Promise<void> {
  const admin = createDb(ADMIN_URL);
  /*
    Uma conexão **reservada** para a seção inteira, e não `pool.query`.

    O lock consultivo pertence à sessão, e o `pg.Pool` devolve a conexão ao
    ocioso assim que a consulta termina. Enquanto o construtor trabalha — 26
    segundos, em outro pool —, essa conexão fica parada; passados os 10 s do
    `idleTimeoutMillis` padrão o driver a fecha, e **o lock morre com ela**. Foi
    exatamente o que aconteceu: três workers entraram juntos na seção crítica e
    a suíte reprovou com `database "..._parcial" is being accessed by other
    users` e `... does not exist`. Reservar o cliente prende a sessão.
  */
  const client = await admin.pool.connect();
  try {
    const existe = async () =>
      (
        await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
          nomeDoTemplate,
        ])
      ).rowCount === 1;

    if (await existe()) return;

    const lock = chaveDoLock(nomeDoTemplate);
    await client.query(`SELECT pg_advisory_lock($1)`, [lock]);
    try {
      // Outro worker pode tê-lo construído enquanto esperávamos o lock.
      if (await existe()) return;

      /*
        Constrói sob um nome provisório e só então renomeia. Se o processo
        morrer no meio — e neste ambiente o Postgres já foi derrubado no meio de
        uma medição —, o que sobra é um `..._parcial` que ninguém clona, e não
        um template pela metade que passaria por pronto.
      */
      const provisorio = `${nomeDoTemplate}_parcial`;
      await client.query(`DROP DATABASE IF EXISTS "${provisorio}"`);
      await client.query(`CREATE DATABASE "${provisorio}"`);

      const url = urlFor(provisorio);
      const relatorio = await runMigrations(url);
      if (relatorio.failure) {
        throw new Error(
          `migration ${relatorio.failure.tag} falhou ao preparar a fixture "${nomeDoTemplate}": ${relatorio.failure.message}`,
        );
      }

      const { db, pool } = createDb(url);
      try {
        await builder(db);
      } finally {
        // Um template com sessão aberta não pode ser clonado.
        await pool.end();
      }

      await client.query(
        `ALTER DATABASE "${provisorio}" RENAME TO "${nomeDoTemplate}"`,
      );
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lock]);
    }
  } finally {
    client.release();
    await admin.pool.end();
  }
}

/**
 * O banco de um arquivo de teste, clonado da fixture `chave`.
 *
 * `builder` roda no máximo uma vez por conteúdo — ver `digestDoTemplate`. Toda
 * chamada seguinte é um `CREATE DATABASE ... TEMPLATE`.
 */
export async function createTestDatabaseFrom(
  chave: string,
  builder: FixtureBuilder,
  name: string,
): Promise<TestDb> {
  const nomeDoTemplate = `fc_tpl_${chave}_${digestDoTemplate(chave, builder)}`;
  await garantirTemplate(nomeDoTemplate, builder);

  const dbName = `fc_test_${name}_${process.pid}`;
  const admin = createDb(ADMIN_URL);
  try {
    await admin.pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.pool.query(
      `CREATE DATABASE "${dbName}" TEMPLATE "${nomeDoTemplate}"`,
    );
  } finally {
    await admin.pool.end();
  }

  const url = urlFor(dbName);
  const { db, pool } = createDb(url);
  return {
    db,
    pool,
    url,
    drop: async () => {
      await pool.end();
      const cleanup = createDb(ADMIN_URL);
      await cleanup.pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanup.pool.end();
    },
  };
}

/**
 * Fixtures resolved from the repo rather than hardcoded.
 *
 * These used to be "the first .xlsx in the folder", which held while there was
 * exactly one. The moment the Ambev's per-equipment files landed beside it,
 * every test silently changed which workbook it was asserting against. Each
 * fixture now names what it wants; filenames are matched on a distinctive
 * fragment because the accented ones arrive in a decomposed form.
 */
function assetsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../attached_assets",
  );
}

function findAsset(fragment: string): string {
  const assets = assetsDir();
  const needle = fragment.toLowerCase();
  const found = readdirSync(assets).find(
    (f) => f.toLowerCase().includes(needle) && f.endsWith(".xlsx"),
  );
  if (!found) {
    throw new Error(`Nenhum .xlsx com "${fragment}" em ${assets}`);
  }
  return path.join(assets, found);
}

/** The combined export: one workbook, sheets `carretas` and `cavalos`. */
export function realExportPath(): string {
  return findAsset("Remunera");
}

/**
 * The per-equipment delivery: the same content split into one file each, with
 * sheets named `Modelo_Carreta` and `Modelo_Cavalo`.
 */
export function modelExportPaths(): { carreta: string; cavalo: string } {
  return {
    carreta: findAsset("Modelo_Carreta"),
    cavalo: findAsset("Modelo_Cavalo"),
  };
}

/**
 * Importar um fixture do começo ao fim, declarando o equipamento novo.
 *
 * As quatro etapas eram copiadas em cada `beforeAll`, e a cópia passou a ter
 * consequência quando a promoção começou a exigir que equipamento novo fosse
 * **declarado** por quem promove: o segundo arquivo de uma fixture — o cavalo,
 * depois da carreta — é recusado sem essa declaração, como deve ser.
 *
 * Aqui a declaração vem do que a própria pré-visualização apontou como
 * pendente. Isso é legítimo numa fixture, e é o que um operador faz quando os
 * dois equipamentos são reais; o portão em si não fica sem prova — ele é
 * testado de frente em `identidade-por-conteudo.test.ts`, com a recusa e com o
 * que o banco tem depois dela.
 */
export async function importFixture(
  db: Database,
  filePath: string,
): Promise<{ importRunId: string; pendingIdentities: string[] }> {
  const { captureRaw, preview, promote, receiveFile, stage } = await import("./pipeline");
  const received = await receiveFile(db, { filePath });
  await captureRaw(db, received.importRunId);
  await stage(db, received.importRunId);
  const report = await preview(db, received.importRunId);
  await promote(db, received.importRunId, {
    confirmNewEntityTypes: report.pendingIdentities,
  });
  return {
    importRunId: received.importRunId,
    pendingIdentities: report.pendingIdentities,
  };
}

/**
 * O export combinado, importado e **promovido** — e nada além disso.
 *
 * O corte é deliberado. Cinco arquivos de quatro pacotes começam com esta mesma
 * importação e depois divergem: cada um semeia a taxonomia e propõe semânticas
 * com o **seu** rótulo, e alguns aplicam confirmações e outros não. Pôr a
 * curadoria dentro do template unificaria esses rótulos e mudaria, sem avisar,
 * o estado que cada suíte afirma observar.
 *
 * A importação é 24 s dos 26 s; a curadoria que fica de fora custa cerca de um
 * segundo. Compartilhar só a parte cara mantém cada arquivo dizendo exatamente
 * o que dizia.
 *
 * `promote` vai sem `confirmNewEntityTypes` porque, para este arquivo num banco
 * novo, `preview` devolve `pendingIdentities: []` — medido. Passar a lista
 * vazia e não passar nada são a mesma chamada, e é por isso que `dre-real`,
 * que passava a lista, pode usar este mesmo template.
 */
export async function criarBancoComExportRealPromovido(
  name: string,
): Promise<TestDb> {
  return createTestDatabaseFrom(
    "export_real_promovido",
    async (db) => {
      const { captureRaw, preview, promote, receiveFile, stage } =
        await import("./pipeline");
      const received = await receiveFile(db, { filePath: realExportPath() });
      await captureRaw(db, received.importRunId);
      await stage(db, received.importRunId);
      await preview(db, received.importRunId);
      await promote(db, received.importRunId);
    },
    name,
  );
}

/**
 * Os dois arquivos por equipamento, importados e promovidos — sem curadoria.
 *
 * Mesmo corte do anterior, para quem parte do par `Modelo_Carreta` /
 * `Modelo_Cavalo` em vez do export combinado.
 */
export async function criarBancoComModelosPromovidos(
  name: string,
): Promise<TestDb> {
  return createTestDatabaseFrom(
    "modelos_promovidos",
    async (db) => {
      const { carreta, cavalo } = modelExportPaths();
      for (const filePath of [carreta, cavalo])
        await importFixture(db, filePath);
    },
    name,
  );
}
