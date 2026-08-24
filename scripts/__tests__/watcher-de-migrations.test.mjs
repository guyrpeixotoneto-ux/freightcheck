import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diretoriosObservados } from "../lib/observados.mjs";

/**
 * Migration nova chega ao processo que está de pé.
 *
 * O defeito que estas provas fecham tem data: 24/08/2026. A `0056` e a `0057`
 * entraram por merge, o Development continuou servindo o bundle anterior, e a
 * tela de login passou a recusar com `MIGRATIONS_PENDENTES` — o portão de
 * prontidão fazendo exatamente o que deve. O que faltava era um degrau antes:
 * o watcher do `dev.mjs` observava só os `src/`, e um pull que trouxesse apenas
 * `.sql` não disparava rebuild nenhum. Sem rebuild não há reinício; sem
 * reinício não há partida; e quem aplica a fila é o servidor **na partida**.
 *
 * O que se prova aqui é o degrau, e só ele: que a mudança é **detectada** e
 * produz um rebuild. O que acontece depois do rebuild — reiniciar o servidor, e
 * o servidor decidir migrar por `deveMigrarNaPartida` — é de outros dois donos,
 * com provas próprias (`api-supervisor.test.mjs` e `sem-auto-migracao.test.mjs`);
 * nada aqui os duplica nem os altera.
 */
const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** O mesmo debounce que o `dev.mjs` usa; a espera é folgada em cima dele. */
const DEBOUNCE = 250;
const ESPERA = 3000;

/**
 * Uma árvore de mentira com a forma do repositório.
 *
 * De mentira de propósito: prender a prova ao repositório de verdade a faria
 * passar ou falhar por causa de um pacote que alguém acrescentou noutro dia.
 */
async function arvore() {
  const root = await mkdtemp(path.join(tmpdir(), "observados-"));
  await mkdir(path.join(root, "artifacts/api-server/src"), { recursive: true });
  await mkdir(path.join(root, "artifacts/api-server/dist/migrations"), {
    recursive: true,
  });
  await mkdir(path.join(root, "lib/db/src"), { recursive: true });
  await mkdir(path.join(root, "lib/db/migrations/meta"), { recursive: true });
  await mkdir(path.join(root, "lib/db/node_modules/@workspace"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "lib/db/migrations/0001_inicial.sql"),
    "-- \n",
  );
  await writeFile(
    path.join(root, "artifacts/api-server/src/index.ts"),
    "// \n",
  );
  return root;
}

/**
 * O watcher do `dev.mjs`, montado sobre os mesmos diretórios e com o mesmo
 * debounce, contando quantos rebuilds ele pediria.
 *
 * A fiação é reproduzida, e não importada, porque `dev.mjs` sobe processo ao
 * ser carregado. O que impede a cópia de virar deriva é a última prova deste
 * arquivo: o `dev.mjs` tem de continuar montando o watcher sobre
 * `diretoriosObservados`.
 */
function observar(root) {
  const rebuilds = [];
  let debounce = null;
  const watchers = diretoriosObservados(root).map((dir) =>
    watch(dir, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => rebuilds.push(Date.now()), DEBOUNCE);
    }),
  );
  return {
    rebuilds,
    async esperarRebuild() {
      const limite = Date.now() + ESPERA;
      while (Date.now() < limite && rebuilds.length === 0) {
        await new Promise((r) => setTimeout(r, 25));
      }
      return rebuilds.length;
    },
    /** Deixa o debounce fechar e devolve o total, para provar que não repetiu. */
    async assentar() {
      await new Promise((r) => setTimeout(r, DEBOUNCE * 3));
      return rebuilds.length;
    },
    fechar() {
      clearTimeout(debounce);
      for (const w of watchers) w.close();
    },
  };
}

describe("o que o dev.mjs observa", () => {
  it("inclui a fila versionada, e não só os `src/`", async () => {
    const root = await arvore();
    const dirs = diretoriosObservados(root);

    expect(dirs).toContain(path.join(root, "lib/db/migrations"));
    expect(dirs).toContain(path.join(root, "artifacts/api-server/src"));
    expect(dirs).toContain(path.join(root, "lib/db/src"));
  });

  it("inclui a fila versionada do repositório de verdade", () => {
    expect(diretoriosObservados(RAIZ)).toContain(
      path.join(RAIZ, "lib/db/migrations"),
    );
  });

  it("não observa nada que o próprio rebuild escreve", async () => {
    const root = await arvore();
    /*
      O `build.mjs` copia `lib/db/migrations` para `dist/migrations`. Observar o
      destino faria o rebuild disparar a si mesmo, sem parar — é o laço que a
      condição de nunca observar `dist/` existe para impedir. `node_modules`
      pela mesma razão, e porque arrastá-lo custaria o watcher inteiro.
    */
    for (const dir of diretoriosObservados(root)) {
      expect(dir).not.toMatch(/[\\/]dist([\\/]|$)/);
      expect(dir).not.toMatch(/[\\/]node_modules([\\/]|$)/);
    }
  });
});

describe("os três cenários de mudança", () => {
  it("mudança só em migration `.sql` é detectada", async () => {
    const root = await arvore();
    const olho = observar(root);
    try {
      await writeFile(
        path.join(root, "lib/db/migrations/0002_frota_promax.sql"),
        "CREATE TABLE frota_promax ();\n",
      );
      expect(await olho.esperarRebuild()).toBeGreaterThan(0);
      expect(await olho.assentar()).toBe(1);
    } finally {
      olho.fechar();
    }
  });

  it("mudança só em código `src` continua sendo detectada", async () => {
    const root = await arvore();
    const olho = observar(root);
    try {
      await writeFile(
        path.join(root, "artifacts/api-server/src/index.ts"),
        "// mudou\n",
      );
      expect(await olho.esperarRebuild()).toBeGreaterThan(0);
      expect(await olho.assentar()).toBe(1);
    } finally {
      olho.fechar();
    }
  });

  it("mudança nos dois pede um rebuild só, não dois", async () => {
    const root = await arvore();
    const olho = observar(root);
    try {
      await writeFile(
        path.join(root, "lib/db/migrations/0003_total_do_pagamento.sql"),
        "ALTER TABLE x ADD COLUMN y numeric;\n",
      );
      await writeFile(path.join(root, "lib/db/src/schema.ts"), "// mudou\n");
      expect(await olho.esperarRebuild()).toBeGreaterThan(0);
      expect(await olho.assentar()).toBe(1);
    } finally {
      olho.fechar();
    }
  });

  it("aplicar a fila não mexe em pasta observada — não há laço", async () => {
    const root = await arvore();
    const olho = observar(root);
    try {
      /*
        Aplicar migrations escreve no banco, não no disco; o que o rebuild
        escreve vai para `dist/`. Esta prova mostra o segundo: mexer no destino
        da cópia não devolve o watcher ao começo.
      */
      await writeFile(
        path.join(
          root,
          "artifacts/api-server/dist/migrations/0001_inicial.sql",
        ),
        "-- copiado pelo build\n",
      );
      expect(await olho.assentar()).toBe(0);
    } finally {
      olho.fechar();
    }
  });
});

describe("a fiação, para que a cópia acima não vire deriva", () => {
  it("o dev.mjs monta o watcher sobre `diretoriosObservados`", async () => {
    const fonte = await readFile(path.join(RAIZ, "scripts/dev.mjs"), "utf8");
    expect(fonte).toMatch(/diretoriosObservados\(root\)/);
    expect(fonte).toMatch(/watch\(dir,\s*\{\s*recursive:\s*true\s*\}/);
  });
});
