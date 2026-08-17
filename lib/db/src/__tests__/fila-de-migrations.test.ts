/**
 * A fila de migrations não pode ter dois donos do mesmo número.
 *
 * **O defeito que este arquivo existe para impedir já aconteceu.** Um branch
 * longo criou `0023_direcao_economica`; a `main` avançou, no mesmo período, com
 * `0023_semantica_coerente`. O merge não acusou nada — são arquivos com nomes
 * diferentes — e o journal ficou com duas entradas disputando o índice 23.
 *
 * O que isso produz é pior do que um erro: `runMigrations` segue o **carimbo**
 * gravado no banco, viu o índice 23 como aplicado, e devolveu *"Nada a aplicar:
 * as 24 migrations já estavam no banco"*. Sucesso declarado, coluna nunca
 * criada, e a falha só apareceu três passos adiante como `column
 * a.economic_direction does not exist` — longe da causa, e parecendo defeito de
 * quem escreveu a consulta.
 *
 * Uma fila versionada que aceita duplicata em silêncio não é uma fila. Estes
 * casos são baratos, rodam sem banco, e falham no commit em vez de no deploy.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const PASTA = path.join(import.meta.dirname, "../../migrations");

interface Entrada {
  idx: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(path.join(PASTA, "meta", "_journal.json"), "utf8"),
) as { entries: Entrada[] };

const arquivos = readdirSync(PASTA)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("a fila de migrations", () => {
  it("não tem dois donos do mesmo índice", () => {
    const porIdx = new Map<number, string[]>();
    for (const e of journal.entries) {
      porIdx.set(e.idx, [...(porIdx.get(e.idx) ?? []), e.tag]);
    }
    const duplicados = [...porIdx.entries()].filter(([, tags]) => tags.length > 1);

    expect(
      duplicados.map(([idx, tags]) => `${idx}: ${tags.join(" × ")}`),
      "duas migrations disputando o mesmo carimbo. O banco aplica a primeira e " +
        "declara a fila em dia; a segunda é pulada em silêncio. Renumere a mais " +
        "nova para o próximo índice livre.",
    ).toEqual([]);
  });

  it("os índices são contínuos e começam em zero", () => {
    const idx = journal.entries.map((e) => e.idx);
    expect(idx).toEqual(idx.map((_, i) => i));
  });

  it("o número do arquivo é o índice do journal", () => {
    /*
      O nome do arquivo é o que uma pessoa lê ao decidir "qual é a próxima
      livre?", e o índice é o que a máquina aplica. Divergirem faz um humano
      escolher um número que a máquina já usou — que foi exatamente como a
      colisão nasceu.
    */
    const divergentes = journal.entries
      .map((e) => ({ e, numero: Number(e.tag.slice(0, 4)) }))
      .filter(({ e, numero }) => numero !== e.idx)
      .map(({ e }) => `${e.tag} tem carimbo ${e.idx}`);

    expect(divergentes).toEqual([]);
  });

  it("todo arquivo .sql está no journal, e vice-versa", () => {
    /*
      Um `.sql` fora do journal nunca roda — e é indistinguível, na pasta, de um
      que roda. Uma entrada sem arquivo derruba a fila inteira na partida.
    */
    const noJournal = new Set(journal.entries.map((e) => `${e.tag}.sql`));
    const naPasta = new Set(arquivos);

    expect([...naPasta].filter((f) => !noJournal.has(f)), "arquivo fora do journal").toEqual([]);
    expect([...noJournal].filter((f) => !naPasta.has(f)), "entrada sem arquivo").toEqual([]);
  });

  it("nenhuma tag se repete", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags.length).toBe(new Set(tags).size);
  });

  /*
    ---- a cadeia de snapshots ------------------------------------------------

    Os casos acima cuidam do journal, e não bastam: a colisão de índice se
    resolve renumerando, e renumerar mexe nos snapshots do drizzle, que são uma
    lista encadeada — cada um traz o `id` do seu e o `prevId` do anterior.

    Aconteceu no merge seguinte, exatamente como o primeiro: a `main` trouxe
    `0025_semantica_inicial`, o branch trazia `0025_direcao_economica`, e a
    renumeração para `0026` deixou o snapshot novo com o **mesmo `id`** do
    `0024`. O journal ficava impecável; a cadeia, partida. `drizzle-kit generate`
    lê essa cadeia para saber o que já existe, e uma cadeia partida produz o
    próximo diff em cima do estado errado — DDL que refaz o que já foi feito, ou
    que não vê o que falta.

    Foi encontrado à mão, conferindo ids um a um. Uma vez é investigação; duas
    seria desperdício.
  */
  /*
    ---- quem cita migration pelo nome ----------------------------------------

    O journal conhece os índices; ele não conhece quem escreveu o nome de uma
    migration dentro de uma string. `bridge.ts` escreve — o plano de restauração
    do Publishing é montado procurando statements dentro de migrations
    específicas, e a busca é por nome.

    Na segunda renumeração de `direcao_economica` o journal ficou impecável e
    esse literal continuou em `0025_direcao_economica`. O efeito foram onze
    casos do `bridge` falhando de uma vez com "o plano de restauração não pôde
    ser construído" — mensagem que descreve o sintoma e não nomeia a causa, num
    arquivo que ninguém liga a uma renumeração.

    Este caso é a ponte que faltava entre as duas verdades.
  */
  it("toda migration citada por nome no código existe na fila", () => {
    const fonte = path.join(import.meta.dirname, "..");
    const arquivosTs = readdirSync(fonte)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ nome: f, texto: readFileSync(path.join(fonte, f), "utf8") }));

    const tags = new Set(journal.entries.map((e) => e.tag));
    const orfas: string[] = [];

    for (const { nome, texto } of arquivosTs) {
      // Só o que está entre aspas: comentários citam números antigos de propósito.
      for (const [, citada] of texto.matchAll(/["'`](\d{4}_[a-z0-9_]+)["'`]/g)) {
        if (!tags.has(citada)) orfas.push(`${nome}: "${citada}"`);
      }
    }

    expect(
      [...new Set(orfas)],
      "migration citada em código e ausente da fila. Costuma ser sequela de " +
        "renumeração: o journal é corrigido, a string fica para trás, e a falha " +
        "aparece longe daqui — em `bridge.ts` ela derruba o plano de restauração " +
        "inteiro com uma mensagem que não fala em renumeração.",
    ).toEqual([]);
  });

  describe("a cadeia de snapshots do drizzle", () => {
    const snapshots = journal.entries.map((e) => {
      const arquivo = `${String(e.idx).padStart(4, "0")}_snapshot.json`;
      const s = JSON.parse(readFileSync(path.join(PASTA, "meta", arquivo), "utf8")) as {
        id: string;
        prevId: string;
      };
      return { ...e, arquivo, id: s.id, prevId: s.prevId };
    });

    it("cada snapshot tem id próprio", () => {
      const porId = new Map<string, string[]>();
      for (const s of snapshots) porId.set(s.id, [...(porId.get(s.id) ?? []), s.tag]);

      expect(
        [...porId.entries()].filter(([, tags]) => tags.length > 1).map(([id, tags]) => `${id}: ${tags.join(" × ")}`),
        "dois snapshots com o mesmo `id`. O drizzle percorre a cadeia por id, e " +
          "uma repetição a fecha num laço ou a corta antes do fim — o próximo " +
          "`generate` passa a diferenciar contra o estado errado. Gere um id novo " +
          "para o mais recente.",
      ).toEqual([]);
    });

    it("cada snapshot aponta para o anterior", () => {
      const quebras = snapshots
        .slice(1)
        .filter((s, i) => s.prevId !== snapshots[i]!.id)
        .map((s) => `${s.tag} aponta para ${s.prevId}`);

      expect(
        quebras,
        "elo partido: o `prevId` não é o `id` do snapshot anterior. Costuma ser " +
          "sequela de renumeração — ao mover uma migration para o fim da fila, o " +
          "`prevId` dela tem de passar a ser o `id` de quem virou seu antecessor.",
      ).toEqual([]);
    });
  });
});
