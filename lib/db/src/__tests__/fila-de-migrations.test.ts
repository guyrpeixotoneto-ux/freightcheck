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
});
