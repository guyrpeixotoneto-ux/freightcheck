/**
 * A direção econômica como dado — a alternativa a escrevê-la no prompt.
 *
 * **A pergunta que motiva o campo.** "Esse aumento de combustível é bom ou ruim
 * para mim?" tinha duas saídas antes desta migration, e as duas eram ruins: o
 * modelo chuta a partir do que sabe de logística — proibido, porque é
 * afirmação sem lastro —, ou alguém escreve uma frase por variável dentro do
 * prompt, que é a dependência de código por pergunta reaparecendo noutro
 * lugar. Semântica é dado, e o teste que importa é que ela chegue ao modelo
 * como dado.
 *
 * **A distinção que mais importa aqui é `null` × `NEUTRAL`.** A primeira é
 * ausência de curadoria; a segunda é uma afirmação de que subir não muda nada.
 * Lidas como a mesma coisa, produzem a resposta mais perigosa que este campo
 * pode gerar: "esse aumento não te afeta", dita sobre uma coluna que ninguém
 * curou.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@workspace/db";
import { carregarDicionario, limparCacheDoDicionario } from "../parametros";
import { executar, registroPadrao } from "../ferramentas/registro";
import type { ContextoDaFerramenta } from "../ferramentas/registro";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

comBanco("direção econômica", () => {
  let db: Database;
  let ctx: ContextoDaFerramenta;

  beforeAll(() => {
    db = createDb(url!).db;
    ctx = { db, recorte: {} };
  });

  it("as colunas existem nas duas tabelas — projeção e versão", async () => {
    const { rows } = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_name IN ('attribute', 'attribute_semantics')
         AND column_name IN ('economic_direction', 'economic_effect')
       ORDER BY table_name, column_name
    `);

    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "attribute.economic_direction",
      "attribute.economic_effect",
      "attribute_semantics.economic_direction",
      "attribute_semantics.economic_effect",
    ]);
  });

  it("nascem nulas — ninguém curou ainda, e isso não é NEUTRAL", async () => {
    const { rows } = await db.execute<{ curados: number; total: number }>(sql`
      SELECT count(*) FILTER (WHERE economic_direction IS NOT NULL)::int AS curados,
             count(*)::int AS total
        FROM attribute
    `);

    expect(rows[0]!.total).toBeGreaterThan(0);
    // A migration não inventou leitura econômica para 138 colunas. Se um dia
    // alguém puser um default aqui, este caso é o que avisa.
    expect(rows[0]!.curados).toBe(0);
  });

  it("a migration não mexeu no portão da semântica", async () => {
    /*
      Escrever prosa não destrava dinheiro. `semantics_status` continua sendo o
      único portão de agregação financeira, e uma migration que o tocasse por
      engano faria valores presumidos entrarem em soma — o defeito mais caro
      que este banco pode ter.
    */
    const { rows } = await db.execute<{ status: string; n: number }>(sql`
      SELECT semantics_status::text AS status, count(*)::int AS n
        FROM attribute GROUP BY 1 ORDER BY 1
    `);
    const porStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));

    expect(porStatus.CONFIRMED).toBeGreaterThan(0);
    expect(porStatus.PRESUMED ?? 0).toBeGreaterThan(0);
  });

  it("o dicionário carrega os campos, e a ferramenta os entrega ao modelo", async () => {
    limparCacheDoDicionario();
    const dicionario = await carregarDicionario(db);

    expect(dicionario[0]).toHaveProperty("direcaoEconomica");
    expect(dicionario[0]).toHaveProperty("efeitoEconomico");
    expect(dicionario[0]).toHaveProperty("definicao");

    const c = await executar(registroPadrao(), "parametros", { busca: "ipva", limite: 3 }, ctx);
    const p = (c.conteudo as { parametros: Record<string, unknown>[] }).parametros[0]!;

    expect(c.ok).toBe(true);
    expect(p).toHaveProperty("direcaoEconomica");
    expect(p).toHaveProperty("efeitoEconomico");
  });

  it("a ferramenta avisa que nulo não autoriza dizer que não muda nada", async () => {
    const c = await executar(registroPadrao(), "parametros", { busca: "combustivel" }, ctx);
    const observacao = (c.conteudo as { observacao: string }).observacao;

    // A ressalva vai no material, e não na instrução do sistema: ela é uma
    // propriedade destes dados, e o prompt não é lugar de regra de domínio.
    expect(observacao).toContain("null");
    expect(observacao.toLowerCase()).toContain("transportadora");
  });

  it("uma direção curada chega ao modelo pela ferramenta, com a frase junto", async () => {
    /*
      O caminho de ponta a ponta, exercitado com uma curadoria de mentira que é
      desfeita no fim. É a única forma de provar que o campo atravessa — hoje
      nenhuma linha do banco tem valor, e um teste sobre colunas vazias não
      diz se elas chegariam.
    */
    const codigo = "cavalo.combustivel_vida_cavalo";
    await db.execute(sql`
      UPDATE attribute
         SET economic_direction = 'HIGHER_IS_WORSE',
             economic_effect = 'mais km por litro reconhecido reduz o litro remunerado para a mesma distância'
       WHERE code = ${codigo}
    `);

    try {
      limparCacheDoDicionario();
      const c = await executar(registroPadrao(), "parametros", { busca: codigo }, ctx);
      const achado = (c.conteudo as { parametros: { codigo: string; direcaoEconomica: string | null; efeitoEconomico: string | null }[] })
        .parametros.find((p) => p.codigo === codigo);

      expect(achado?.direcaoEconomica).toBe("HIGHER_IS_WORSE");
      expect(achado?.efeitoEconomico).toContain("litro remunerado");
    } finally {
      await db.execute(sql`
        UPDATE attribute SET economic_direction = NULL, economic_effect = NULL WHERE code = ${codigo}
      `);
      limparCacheDoDicionario();
    }
  });
});
