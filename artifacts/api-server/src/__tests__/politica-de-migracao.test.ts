import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deveMigrarNaPartida } from "../lib/migrations";

/**
 * Quem pode avançar a fila só por ter subido.
 *
 * O defeito que estas provas prendem foi medido, não imaginado: um `pnpm dev`
 * com banco configurado aplicou `0020_chamados_exclusao` e `0021_cobertura` no
 * banco de desenvolvimento enquanto o console, na mesma partida, dizia que não
 * aplicaria. A regra existia — em `scripts/dev.mjs` — e o processo que abria a
 * conexão não a conhecia; ele olhava `DATABASE_URL` e concluía dali quem era.
 *
 * Por isso a prova central desta suíte não é "development não migra", e sim
 * **`DATABASE_URL` não decide nada**. Enquanto ela decidir, todo ambiente com
 * banco vira Production por acidente, e a regra volta a valer só no arquivo
 * onde está escrita.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Development converge pela fila na partida", () => {
  /*
    Reversão medida: a regra anterior ("Development só avança à mão") existiu
    para a era em que Production estava atrás da fila. Depois que Production
    alcançou a cabeça, Development atrás virou o estado que faz o Provision do
    Publishing propor REMOVER de Production o que as migrations criaram — o
    diff destrutivo que apagou dado real em 17 e 18/08/2026. Development à
    frente produz, no pior caso, um deploy recusado; Development atrás produz
    perda de decisão humana. Esta prova prende o sentido seguro.
  */
  it("migra com NODE_ENV=development — é o que mantém a proposta do Publishing vazia", () => {
    const decisao = deveMigrarNaPartida({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://user:senha@localhost:5432/freightcheck",
    });

    expect(decisao.migrar).toBe(true);
    expect(decisao.motivo).toContain("development");
  });

  it("é o que `scripts/dev.mjs` passa ao servidor, e não uma suposição", () => {
    const dev = readFileSync(path.join(RAIZ, "../..", "scripts/dev.mjs"), "utf8");
    // Se alguém trocar este env, a política de Development muda junto — e é
    // melhor que esta prova caia aqui do que Development ficar atrás em
    // silêncio e o próximo Publish propor remoção.
    expect(dev).toMatch(/NODE_ENV:\s*"development"/);
  });

  it("um Development que precise ficar parado fixa isso pela chave, como um Preview", () => {
    const decisao = deveMigrarNaPartida({
      NODE_ENV: "development",
      DB_MIGRATE_ON_BOOT: "0",
    });
    expect(decisao.migrar).toBe(false);
  });
});

describe("Production segue a política definida", () => {
  it("migra por NODE_ENV=production", () => {
    const decisao = deveMigrarNaPartida({ NODE_ENV: "production" });
    expect(decisao.migrar).toBe(true);
    expect(decisao.motivo).toContain("production");
  });

  it("migra por DB_MIGRATE_ON_BOOT, que é o que o artifact escreve", () => {
    const decisao = deveMigrarNaPartida({ DB_MIGRATE_ON_BOOT: "1" });
    expect(decisao.migrar).toBe(true);
    expect(decisao.motivo).toContain("DB_MIGRATE_ON_BOOT");
  });

  it("o artifact de produção diz as duas coisas por extenso", () => {
    const artifact = readFileSync(
      path.join(RAIZ, ".replit-artifact/artifact.toml"),
      "utf8",
    );
    const producao = artifact.slice(artifact.indexOf("[services.production.run.env]"));
    expect(producao).toMatch(/NODE_ENV\s*=\s*"production"/);
    expect(producao).toMatch(/DB_MIGRATE_ON_BOOT\s*=\s*"1"/);
  });

  it("um valor de chave sem sentido não derruba Production — cai no NODE_ENV", () => {
    // Erro de digitação numa variável de deploy tem que aparecer no log e
    // deixar a fila de pé, não virar "não migre" em silêncio.
    const decisao = deveMigrarNaPartida({
      NODE_ENV: "production",
      DB_MIGRATE_ON_BOOT: "sim, por favor",
    });

    expect(decisao.migrar).toBe(true);
    expect(decisao.motivo).toContain("não é um valor reconhecido");
  });
});

describe("nenhum ambiente é classificado pela existência de DATABASE_URL", () => {
  it("banco configurado, sem mais nada, não migra", () => {
    const decisao = deveMigrarNaPartida({
      DATABASE_URL: "postgres://user:senha@localhost:5432/freightcheck",
    });
    expect(decisao.migrar).toBe(false);
  });

  it("a decisão é idêntica com e sem DATABASE_URL, em todo ambiente", () => {
    for (const NODE_ENV of ["development", "test", "production", undefined]) {
      const sem = deveMigrarNaPartida({ ...(NODE_ENV ? { NODE_ENV } : {}) });
      const com = deveMigrarNaPartida({
        ...(NODE_ENV ? { NODE_ENV } : {}),
        DATABASE_URL: "postgres://user:senha@localhost:5432/freightcheck",
      });
      expect(com).toEqual(sem);
    }
  });

  it("a função não lê DATABASE_URL em lugar nenhum do código", () => {
    const fonte = readFileSync(path.join(RAIZ, "src/lib/migrations.ts"), "utf8");
    const corpo = fonte.slice(
      fonte.indexOf("export function deveMigrarNaPartida"),
      fonte.indexOf("let ultimoRelatorio"),
    );
    expect(corpo).not.toMatch(/DATABASE_URL/);
  });
});

describe("testes e Preview não migram", () => {
  it("NODE_ENV=test não migra — a suíte cria banco descartável das migrations", () => {
    expect(deveMigrarNaPartida({ NODE_ENV: "test" }).migrar).toBe(false);
  });

  it("ambiente sem NODE_ENV não migra: o padrão é o seguro", () => {
    const decisao = deveMigrarNaPartida({});
    expect(decisao.migrar).toBe(false);
    expect(decisao.motivo).toContain("não definido");
  });

  it("a chave desliga mesmo em produção, que é o que fixa um Preview", () => {
    const decisao = deveMigrarNaPartida({
      NODE_ENV: "production",
      DB_MIGRATE_ON_BOOT: "0",
    });
    expect(decisao.migrar).toBe(false);
  });
});

describe("o servidor sobe com a migração automática desligada", () => {
  const index = readFileSync(path.join(RAIZ, "src/index.ts"), "utf8");
  const executavel = index
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

  it("a política é consultada antes de `DATABASE_URL` ser sequer lida", () => {
    const politica = executavel.indexOf("deveMigrarNaPartida()");
    const url = executavel.indexOf('process.env["DATABASE_URL"]');

    expect(politica).toBeGreaterThan(-1);
    expect(url).toBeGreaterThan(-1);
    // A ordem é a correção: invertida, a presença de um banco volta a ser o
    // que classifica o ambiente.
    expect(politica).toBeLessThan(url);
  });

  it("desligada, a função retorna sem tocar no banco", () => {
    const corpo = executavel.slice(
      executavel.indexOf("async function applyMigrationsInBackground"),
      executavel.indexOf("app.listen("),
    );
    const guarda = corpo.slice(corpo.indexOf("if (!decisao.migrar)"), corpo.indexOf("const url"));

    expect(guarda).toMatch(/return;/);
    expect(guarda).not.toMatch(/runMigrations\(/);
  });

  it("abrir a porta não depende da migração — `app.listen` é incondicional", () => {
    // `applyMigrationsInBackground` é chamada de dentro do callback do listen e
    // sem `await`: nada nela pode adiar ou impedir a porta.
    expect(executavel).toMatch(/app\.listen\(\s*port\s*,/);
    expect(executavel).toMatch(/void applyMigrationsInBackground\(\)/);
  });
});
