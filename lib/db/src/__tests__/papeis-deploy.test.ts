import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";
import { bridgeDown, bridgeUp } from "../bridge";
import { reconvergirSchema } from "../reconvergencia";
import { diffDoPublishing } from "./diff-do-publishing";

/**
 * A `0037` como problema de migration/deploy — os cenários que um Publish real
 * atravessa, cada um contra Postgres de verdade.
 *
 * A pergunta que este arquivo responde não é "a coluna existe?": é **"todo
 * caminho pelo qual um banco chega ao estado da 0037 chega ao MESMO estado"**
 * — fila do zero, fila sobre banco pré-0037 com gente dentro, bridge
 * down→deploy→up, reconvergência pós-mutilação, e a segunda passada de
 * qualquer um deles. Estados iguais por fora e diferentes por dentro é
 * exatamente a classe de defeito que a reconvergência teve aqui: a coluna
 * voltava nullable e sem default, silenciosamente diferente da original.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

let sequencia = 0;
const criados: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

const poolsAbertos: pg.Pool[] = [];

async function bancoNovo(): Promise<{ url: string; pool: pg.Pool }> {
  const nome = `fc_papeis_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const pool = new pg.Pool({ connectionString: urlDe(nome) });
  poolsAbertos.push(pool);
  return { url: urlDe(nome), pool };
}

/**
 * A fila até `ate` (inclusive), COM registro — o estado de uma Production real
 * parada ali: schema e carimbos coerentes, para que `runMigrations` aplique
 * exatamente o que falta, como faria na partida do deploy.
 */
async function migradoAte(pool: pg.Pool, ate: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
      [m.hash, m.when],
    );
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

async function criarUsuario(
  pool: pg.Pool,
  email: string,
  role?: string,
): Promise<void> {
  await pool.query(
    role
      ? `INSERT INTO "app_user" ("name","email","password_hash","role") VALUES ($1,$1,'scrypt$x',$2)`
      : `INSERT INTO "app_user" ("name","email","password_hash") VALUES ($1,$1,'scrypt$x')`,
    role ? [email, role] : [email],
  );
}

async function papeis(pool: pg.Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ email: string; role: string }>(
    `SELECT email, role FROM "app_user" ORDER BY email`,
  );
  return Object.fromEntries(rows.map((r) => [r.email, r.role]));
}

/** A forma da coluna e do CHECK, como o catálogo os descreve. */
async function formaDoPapel(pool: pg.Pool): Promise<{ coluna: string; check: string }> {
  const { rows: col } = await pool.query<{ v: string }>(
    `SELECT data_type||'|'||is_nullable||'|'||coalesce(column_default,'-') AS v
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='app_user' AND column_name='role'`,
  );
  const { rows: ck } = await pool.query<{ v: string }>(
    `SELECT pg_get_constraintdef(oid) AS v FROM pg_constraint
      WHERE conname='app_user_role_ck' AND connamespace='public'::regnamespace`,
  );
  return { coluna: col[0]?.v ?? "AUSENTE", check: ck[0]?.v ?? "AUSENTE" };
}

afterAll(async () => {
  // Fechar os pools ANTES de derrubar os bancos: um terminate num cliente
  // ocioso vira exceção não tratada e mancha uma suíte verde.
  await Promise.all(poolsAbertos.map((p) => p.end().catch(() => {})));
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1`,
        [nome],
      );
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

describe("cenário 1 — banco vazio, fila completa", () => {
  it("a coluna nasce na forma final, e um INSERT que esqueça o papel não fabrica admin", async () => {
    const b = await bancoNovo();
    expect((await runMigrations(b.url)).failure).toBeUndefined();

    expect(await formaDoPapel(b.pool)).toEqual({
      coluna: "text|NO|'OPERADOR'::text",
      check: "CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERADOR'::text])))",
    });

    // Banco vazio: o backfill não inventou ninguém.
    const { rows } = await b.pool.query(`SELECT count(*)::int AS n FROM "app_user"`);
    expect(rows[0].n).toBe(0);

    // Fail-closed: sem papel declarado, OPERADOR; papel inválido, recusado.
    await criarUsuario(b.pool, "sem-papel@x.com");
    expect(await papeis(b.pool)).toEqual({ "sem-papel@x.com": "OPERADOR" });
    await expect(criarUsuario(b.pool, "root@x.com", "ROOT")).rejects.toThrow(
      /app_user_role_ck/,
    );
  });
});

describe("cenário 2 — deploy sobre Production pré-0037, com gente dentro", () => {
  it("caminho normal (proposta recusada): o diff é aditivo, a fila aplica, o backfill acerta", async () => {
    const prod = await bancoNovo();
    await migradoAte(prod.pool, "0036_funcoes_restauraveis");
    for (const email of ["a@x.com", "b@x.com", "c@x.com"]) {
      await prod.pool.query(
        `INSERT INTO "app_user" ("name","email","password_hash","created_by")
         VALUES ($1,$1,'scrypt$original','fixture')`,
        [email],
      );
    }

    const dev = await bancoNovo();
    expect((await runMigrations(dev.url)).failure).toBeUndefined();

    /*
      O diff que o Publishing veria ANTES do deploy: só criação — a coluna, o
      CHECK e as treze tabelas do ambiente Fechamento — e nada de DROP nem ALTER. É o
      diff que a política "recuse a proposta, publique só build e start"
      atravessa sem risco: recusar deixa Production intacta e o servidor novo
      aplica a fila na partida.

      As tabelas são conferidas por conjunto e não por lista ordenada: a ordem
      em que o diff as devolve é a de leitura do catálogo, e prendê-la aqui
      transformaria uma reordenação inofensiva em teste vermelho.
    */
    const antes = await diffDoPublishing(dev.pool, prod.pool);
    expect(antes.drop).toEqual([]);
    expect(antes.alter).toEqual([]);
    expect(new Set(antes.addTable)).toEqual(
      new Set([
        "fechamento_competencia",
        "fechamento_documento",
        "fechamento_viagem",
        "fechamento_cte",
        "fechamento_requisicao",
        "fechamento_disponibilidade",
        "fechamento_conciliacao_item",
        "fechamento_apuracao",
        "fechamento_apuracao_verba",
        "fechamento_divergencia",
        /* As duas do 03.08.20, da `0043` — mesmo caso: Production não as tem. */
        "fechamento_pagamento_item",
        "fechamento_pagamento_desconto",
        /* O cadastro de partes, da `0044` — o mesmo caso outra vez. */
        "fechamento_parte",
        /* A planilha informada, da `0045` — idem: Production não a tem. */
        "remuneracao_planilha",
        /* O conteúdo guardado da importação, da `0047` — idem. */
        "fechamento_documento_conteudo",
        /*
          A unidade cadastrada à mão, da `0048` — idem. Ela é aditiva como as
          demais: nada existente muda de forma, e Production a ganha quando o
          servidor novo aplicar a fila na partida.
        */
        "remuneracao_unidade",
        /*
          A unidade canônica, da `0049` — a autoridade única sobre "qual unidade
          é esta". Aditiva como as demais: nenhuma tabela existente muda de
          forma, as duas colunas `unidade_id` que a referenciam nascem nulas, e
          Production a ganha quando o servidor novo aplicar a fila na partida.
        */
        "unidade",
        /*
          As três da referência de conferência, da `0051` — a planilha anexada a
          um mês para se conferir contra ela. Aditivas como as demais: nenhuma
          tabela existente muda de forma, nenhuma coluna nova sai de tabela do
          cálculo, e Production as ganha quando o servidor novo aplicar a fila.

          Elas guardam o arquivo e os números que ele imprime, e **nada** do que
          está aqui alimenta conta nenhuma: a referência entra na tela como
          coluna ao lado do devido, depois de ele estar calculado.
        */
        "fechamento_referencia",
        "fechamento_referencia_conteudo",
        "fechamento_referencia_linha",
        /*
          A frota Promax, da `0056`, e o total do pagamento, da `0057` — as duas
          últimas filhas do documento de fechamento. Aditivas como as demais:
          Production não tem nenhuma das tabelas desse ambiente, e elas chegam
          inteiras quando o servidor novo aplicar a fila na partida.
        */
        "fechamento_frota_promax",
        "fechamento_pagamento_total",
        /*
          A justificativa, da `0058`/`0059` — a frase que explica uma alteração.
          Aditiva pelo mesmo critério: tabela nova, que Production ganha pela
          fila. O que ela guarda é decisão humana, e é por isso que o `down` do
          bridge exige encontrá-la vazia antes de derrubá-la.
        */
        "justificativa",
        /*
          As seis de Fluxos Operacionais, da `0068` — o mapa dos processos da
          empresa. Aditivas pelo mesmo critério de todas as acima: nenhuma
          tabela existente muda de forma (a única referência para fora é
          `fluxo_operacional.empresa_id → unidade.id`, e `unidade` também é
          nova aqui), nenhuma coluna nova sai de tabela do cálculo, e Production
          as ganha quando o servidor novo aplicar a fila na partida.

          O que elas guardam é decisão humana — levantamento de processo —, e é
          por isso que o `down` do bridge exige encontrá-las vazias antes de
          derrubá-las.
        */
        "fluxo_operacional",
        "fluxo_etapa",
        "fluxo_conexao",
        "fluxo_etapa_item",
        "fluxo_etapa_indicador",
        "fluxo_etapa_acao",
      ]),
    );
    /*
      As colunas aditivas, todas elas — e a lista é fechada de propósito.

      `app_user.role` é da `0037`; as duas de `import_run` são da `0040`, o
      reprocessamento: elas dizem qual leitura um run releu e por quê.
      `assistant_message.trace` é da `0053`: o rastro de uma resposta do
      Assistente — de que unidade ela falava, o que foi consultado, o que a trava
      podou. `attribute.change_rule` é da `0054`: a regra pela qual aquela coluna
      muda de valor, escrita por quem cura. As cinco são aditivas e nulas, que é
      o que faz este diff atravessável — o servidor novo aplica a fila na partida
      e Production as ganha lá.

      Prendê-las aqui é o ponto: uma coluna nova que apareça neste diff sem
      alguém ter vindo escrevê-la nesta linha é uma mudança de schema que
      ninguém avaliou contra a política de deploy.
    */
    expect(new Set(antes.addColumn)).toEqual(
      new Set([
        "app_user.role",
        "import_run.reprocess_of_run_id",
        "import_run.reprocess_reason",
        "assistant_message.trace",
        "attribute.change_rule",
        /*
          As três da `0060` — ocultar uma importação dos agregados. Aditivas e
          nulas como as cinco acima: `NULL` em `hidden_at` é "esta importação
          conta", que é o estado de toda importação que ninguém escondeu.
        */
        "import_run.hidden_at",
        "import_run.hidden_by",
        "import_run.hidden_reason",
        /*
          A origem do fato, da `0061` — e esta **não** é aditiva e nula, que é
          a informação que esta linha existe para dar.

          A coluna é `NOT NULL`, e a `0061` só a fecha depois de um backfill
          pela cadeia `raw_cell → raw_row → raw_sheet → import_run` e de uma
          conferência linha a linha. O gerador do Publishing não sabe nada
          disso: a proposta dele para esta coluna é um `ADD COLUMN` que a
          primeira linha de `fact` em Production recusaria.

          É exatamente por isso que a política deste cenário é **recusar a
          proposta** e deixar a fila aplicar na partida — e o dia em que
          alguém aceitá-la, é aqui que está escrito por que não devia.
        */
        "fact.origin_import_run_id",
        /*
          As três da `0062` — o progresso da leitura. `progress_step` é nula;
          as outras duas são `NOT NULL DEFAULT 0`, e o default é o que as torna
          aplicáveis mesmo assim: o Postgres não reescreve a tabela, e zero é a
          verdade sobre uma leitura que não está acontecendo. Ainda assim
          valem a mesma regra das de cima: quem aplica a fila é o servidor
          novo, não o Provision.
        */
        "import_run.progress_step",
        "import_run.progress_done",
        "import_run.progress_total",
        /*
          As duas da `0064` — a direção econômica snapshotada em `change`.

          Aditivas e nulas, como as cinco primeiras, e sem backfill nenhum: a
          `0064` as deixa `NULL` de propósito em todo change-set anterior, que
          é o estado "não classificado" que o Radar já lê. É a forma que
          atravessa este diff sem que Production precise reescrever linha.

          Elas chegam aqui porque este cenário mede o diff **antes** da fila:
          o servidor novo aplica a `0064` na partida, e Production as ganha lá.
        */
        "change.economic_direction",
        "change.economic_effect",
        /*
          A coluna que a `0046` acrescentou a `fechamento_competencia` **não**
          entra aqui, e a ausência é a informação: o diff a reporta pela tabela,
          não pela coluna, porque Production não tem nenhuma das treze do
          Fechamento — ela chega inteira, com a coluna dentro, no `addTable`
          acima. Uma coluna nova numa tabela que Production **já tem** apareceria
          nesta lista, e é para esse dia que ela é fechada.
        */
      ]),
    );
    /*
      As constraints das tabelas novas — chave primária, estrangeira e CHECK —
      vêm junto, e são conferidas pela regra "pertencem a uma tabela do
      Fechamento ou à planilha informada da `0045`" em vez de por uma lista de
      trinta e dois nomes. A lista
      congelaria a nomenclatura interna de dez tabelas num teste que não fala
      sobre ela; o que este cenário precisa provar é que **nada além** do que as
      duas mudanças trazem aparece no diff.
    */
    expect(
      new Set(
        antes.addConstraint.filter(
          (c) =>
            !c.startsWith("fechamento_") &&
            !c.startsWith("remuneracao_") &&
            /* A `unidade`, da `0049`, pela mesma regra: as constraints dela vêm
               junto com a tabela nova, e nomeá-las uma a uma congelaria a
               nomenclatura interna num teste que não fala sobre ela. */
            !c.startsWith("unidade_") &&
            /* As de Fluxos Operacionais, da `0068`, pela mesma regra: são
               dezenas — chave primária, seis chaves compostas, as `CHECK` de
               nome não vazio e a de rota interna — e todas vêm junto com as
               seis tabelas novas. Nomeá-las uma a uma congelaria a nomenclatura
               interna do módulo num teste que não fala sobre ele. */
            !c.startsWith("fluxo_"),
        ),
      ),
    ).toEqual(
      new Set([
        "app_user_role_ck",
        // As duas da `0040`. Aditivas como a de cima: o FK e o CHECK do
        // reprocessamento nascem sobre colunas que ninguém tinha preenchido, e
        // por isso não há linha em Production que elas possam recusar.
        "import_run_reprocess_of_fk",
        "import_run_reprocess_completo",
        /*
          A FK da origem do fato, da `0061`, e as três da justificativa, da
          `0058`/`0059`. Vêm com as colunas e a tabela novas, e nascem sobre
          dado que Production não tem — não há linha lá que elas possam
          recusar.

          A chave primária da justificativa aparece nominalmente porque o
          filtro acima só dispensa as constraints das tabelas do Fechamento, da
          remuneração e da unidade: nomear é o preço de a tabela nova não estar
          entre essas famílias, e é ele que faz uma constraint inesperada
          continuar aparecendo neste teste.
        */
        "fact_origin_import_run_id_import_run_id_fk",
        "justificativa_pkey",
        "justificativa_change_set_id_fk",
        "justificativa_change_id_fk",
      ]),
    );

    // A partida do servidor novo: exatamente as migrations que faltavam.
    const report = await runMigrations(prod.url);
    expect(report.failure).toBeUndefined();
    /*
      A fila inteira a partir da `0037`, e nem uma a menos.

      Estava escrita à mão e parou na `0055`: as sete migrations seguintes
      derrubavam este teste sem que houvesse defeito no que ele mede — a falha
      dizia "0056 sobrando" sobre uma partida que aplicou exatamente o que
      devia. O que a prova quer é que o servidor novo aplique **tudo** o que
      faltava, em ordem; quem sabe isso é o journal, e a lista literal apenas
      o repetia com direito a discordar dele.
    */
    const daFilaAPartirDa0037 = readMigrations()
      .map((m) => m.tag)
      .filter((tag) => tag >= "0037_papeis");
    expect(daFilaAPartirDa0037[0]).toBe("0037_papeis");
    expect(report.applied).toEqual(daFilaAPartirDa0037);

    // Preservação + backfill: as três contas continuam com o hash original e
    // viram ADMIN — era o que todas já podiam fazer.
    const { rows } = await prod.pool.query(
      `SELECT email, role, password_hash, created_by FROM "app_user" ORDER BY email`,
    );
    expect(rows).toEqual([
      { email: "a@x.com", role: "ADMIN", password_hash: "scrypt$original", created_by: "fixture" },
      { email: "b@x.com", role: "ADMIN", password_hash: "scrypt$original", created_by: "fixture" },
      { email: "c@x.com", role: "ADMIN", password_hash: "scrypt$original", created_by: "fixture" },
    ]);

    // DEPOIS do deploy o diff é vazio: os dois bancos na mesma fila.
    const depois = await diffDoPublishing(dev.pool, prod.pool);
    expect(depois.addColumn).toEqual([]);
    expect(depois.addConstraint).toEqual([]);
    expect(depois.drop).toEqual([]);
    expect(depois.alter).toEqual([]);
  }, 120_000);

  it("caminho bridge (Production na réplica histórica): o down tira o papel do diff, a fila migra tudo, o up devolve Development inteiro", async () => {
    /*
      O bridge é ferramenta de UM baseline: a Production presa na `0012` com
      registro vazio, como medida em 15/08/2026 — é para esse estado que o
      `down` molda Development. Contra uma Production que já anda com a fila
      (cenário anterior), o bridge é a ferramenta errada e o caminho é o
      normal: proposta aditiva, recusada, fila na partida. Este caso prova que
      a 0037 atravessa o caminho-bridge sem vazar para o diff.
    */
    const prod = await bancoNovo();
    // A réplica histórica: schema até a 0012, SEM registro — como lá.
    for (const m of readMigrations()) {
      for (const comando of m.statements) await prod.pool.query(comando);
      if (m.tag === "0012_chamados") break;
    }
    await prod.pool.query(
      `INSERT INTO "app_user" ("name","email","password_hash") VALUES ('p','p@x.com','scrypt$p')`,
    );

    const dev = await bancoNovo();
    expect((await runMigrations(dev.url)).failure).toBeUndefined();
    // Development com uma conta e uma decisão de papel que o down vai levar —
    // e que o up precisa devolver ao estado pós-migration, nunca deixar sem.
    await criarUsuario(dev.pool, "dev@x.com", "ADMIN");

    const down = await bridgeDown(dev.url);
    expect(down.falha).toBeUndefined();

    /*
      Com o down, o papel saiu do diff INTEIRO: não está no que o Publishing
      criaria, nem no que removeria, nem no que alteraria. O resto do diff — a
      allowlist de seis ADD COLUMN nullable — é contrato do bridge e já é
      provado em bridge.test.ts; aqui a pergunta é só sobre a 0037.
    */
    const durante = await diffDoPublishing(dev.pool, prod.pool);
    const sobreOPapel = (linhas: string[]) =>
      linhas.filter((l) => l.includes("role") || l.includes("app_user_role_ck"));
    expect(sobreOPapel(durante.addColumn)).toEqual([]);
    expect(sobreOPapel(durante.addConstraint)).toEqual([]);
    expect(sobreOPapel(durante.drop)).toEqual([]);
    expect(sobreOPapel(durante.alter)).toEqual([]);

    /*
      O deploy: o servidor novo aplica a fila na partida. Registro vazio com o
      schema de pé é o caso já domado ("Um banco que tem o schema e não tem o
      registro"): a fila atravessa reentrante da 0000 e aplica de verdade o que
      falta — inclusive a 0037 e o backfill dela.
    */
    const report = await runMigrations(prod.url);
    expect(report.failure).toBeUndefined();
    expect(report.applied).toContain("0037_papeis");
    expect(report.applied).toContain("0038_reconciliar_papeis");
    expect(await formaDoPapel(prod.pool)).toEqual({
      coluna: "text|NO|'OPERADOR'::text",
      check: "CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERADOR'::text])))",
    });
    expect(await papeis(prod.pool)).toEqual({ "p@x.com": "ADMIN" });

    // O up: Development volta à forma canônica, com o backfill da sentinela —
    // a conta que existia volta ADMIN, nunca fica sem papel.
    const up = await bridgeUp(dev.url);
    expect(up.falha).toBeUndefined();
    expect(await formaDoPapel(dev.pool)).toEqual(await formaDoPapel(prod.pool));
    expect(await papeis(dev.pool)).toEqual({ "dev@x.com": "ADMIN" });

    // E depois do deploy nada do papel separa os dois bancos.
    const depois = await diffDoPublishing(dev.pool, prod.pool);
    expect(sobreOPapel(depois.addColumn)).toEqual([]);
    expect(sobreOPapel(depois.addConstraint)).toEqual([]);
    expect(sobreOPapel(depois.drop)).toEqual([]);
    expect(sobreOPapel(depois.alter)).toEqual([]);
  }, 240_000);
});

describe("cenário 3 — o estado híbrido: mutilação reposta pela reconvergência", () => {
  it("a estrutura volta byte a byte; a perda de conteúdo é dita e tem saída", async () => {
    const b = await bancoNovo();
    expect((await runMigrations(b.url)).failure).toBeUndefined();
    await criarUsuario(b.pool, "chefe@x.com", "ADMIN");
    await criarUsuario(b.pool, "op@x.com", "OPERADOR");

    // A mutilação que um Provision aceito produziria: a coluna some, e o CHECK
    // some junto (depende dela).
    await b.pool.query(`ALTER TABLE "app_user" DROP COLUMN "role"`);

    const relatorio = await reconvergirSchema(b.url);
    expect(relatorio.falhas).toEqual([]);
    expect(relatorio.semComando).toEqual([]);
    expect(relatorio.aplicados.map((a) => a.alvo)).toEqual(
      expect.arrayContaining(["coluna app_user.role", "constraint app_user_role_ck"]),
    );

    // Byte a byte: a forma restaurada é a de um banco criado do zero.
    const referencia = await bancoNovo();
    expect((await runMigrations(referencia.url)).failure).toBeUndefined();
    expect(await formaDoPapel(b.pool)).toEqual(await formaDoPapel(referencia.pool));

    /*
      A honestidade do reparo: a reconvergência repõe ESTRUTURA, nunca escreve
      linha — todo mundo volta OPERADOR (o default fail-closed), inclusive quem
      era ADMIN. É perda de conteúdo, e é dita em vez de remendada: o estado é
      coerente (o CHECK vale), o portão fica fechado para todos (nenhum falso
      admin), e a saída é a documentada. A estrutura volta SOZINHA no próximo
      boot (reconvergência) — nenhum passo manual. O conteúdo perdido se
      recupera pelo mecanismo versionado: restore do backup automático (B3,
      RPO ≤ 24h). Criar um ADMIN pelo terminal é break-glass extraordinário —
      para quando o backup também se perdeu — e nunca faz parte do
      procedimento de deploy. O INSERT abaixo só prova que o estado reparado
      ACEITA a recuperação (o CHECK e o backfill-sentinela não a bloqueiam),
      não que ela seja o caminho normal.
    */
    expect(await papeis(b.pool)).toEqual({
      "chefe@x.com": "OPERADOR",
      "op@x.com": "OPERADOR",
    });
    await criarUsuario(b.pool, "recuperacao@x.com", "ADMIN");
    expect((await papeis(b.pool))["recuperacao@x.com"]).toBe("ADMIN");
  }, 120_000);
});

describe("cenário 4 — a segunda passada não muda nada", () => {
  it("fila, reconvergência e os próprios statements da 0037 são inertes num banco em dia", async () => {
    const b = await bancoNovo();
    expect((await runMigrations(b.url)).failure).toBeUndefined();
    // Um banco vivido: um admin e um operador — o alvo clássico da escalada.
    await criarUsuario(b.pool, "chefe@x.com", "ADMIN");
    await criarUsuario(b.pool, "op@x.com", "OPERADOR");

    const segunda = await runMigrations(b.url);
    expect(segunda.failure).toBeUndefined();
    expect(segunda.applied).toEqual([]);

    const reparo = await reconvergirSchema(b.url);
    expect(reparo.aplicados).toEqual([]);
    expect(reparo.semComando).toEqual([]);
    expect(reparo.falhas).toEqual([]);

    /*
      O rerun bruto da 0037 (o cenário registro-perdido): a sentinela do
      backfill — "só quando não existe nenhum ADMIN" — é o que impede a
      reaplicação de promover operadores. Sem ela, todo rerun seria uma
      escalada de privilégio silenciosa.
    */
    const m37 = readMigrations().find((m) => m.tag === "0037_papeis")!;
    for (const comando of m37.statements) {
      if (comando.startsWith("COMMENT")) continue;
      await b.pool.query(comando);
    }
    expect(await papeis(b.pool)).toEqual({
      "chefe@x.com": "ADMIN",
      "op@x.com": "OPERADOR",
    });
  }, 120_000);
});
