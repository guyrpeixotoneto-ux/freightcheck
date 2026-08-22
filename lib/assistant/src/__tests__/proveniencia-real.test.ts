/**
 * ETAPA 4 (auditoria) — "de onde saiu esse número?" passa a ter resposta.
 *
 * **Contra o export real promovido, e não contra fixture.** A cadeia que esta
 * ferramenta percorre — `fact → raw_cell → raw_row → raw_sheet → import_run →
 * source_file` — só é interessante quando as células vieram de uma planilha de
 * verdade: um fixture escreve a célula que quiser e provaria apenas que o JOIN
 * compila. Aqui a asserção é outra: o arquivo que a resposta cita é o arquivo
 * que a operação importou, e o valor bruto é o que estava escrito na planilha.
 *
 * **O que se prova.** Que a ferramenta chega ao arquivo e à célula pelo
 * vocabulário de quem pergunta (placa, parâmetro, vigência), que ela distingue
 * as três formas de não achar em vez de devolver um "não encontrei" único, e que
 * o que ela autoriza citar é exatamente o que ela mostrou — placa como
 * identificador, valor e linha como número.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { sql } from "drizzle-orm";
import { executar, registroPadrao } from "../ferramentas/registro";
import { sanear, type Dossie } from "../orquestrador";
import type { Evidencia } from "../ferramentas";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

interface Alvo {
  placa: string;
  atributo: string;
  vigencia: string;
}

rodar("Etapa 4 — proveniência contra o export real", () => {
  let db: Database;
  let alvo: Alvo;

  beforeAll(async () => {
    ({ db } = createDb(URL_DO_BANCO!));
    /*
      O alvo é escolhido do banco, e não escrito à mão: um teste que fixasse
      placa e atributo passaria a medir o seed em vez da ferramenta, e
      quebraria na primeira reimportação. O critério é o mais estável possível —
      qualquer fato numérico com célula de origem.
    */
    const { rows } = await db.execute<{
      placa: string;
      atributo: string;
      vigencia: string;
    }>(sql`
      SELECT ei.identifier_value AS placa,
             a.code              AS atributo,
             s.effective_date::text AS vigencia
        FROM fact f
        JOIN attribute a          ON a.id = f.attribute_id
        JOIN entity e             ON e.id = f.entity_id
        JOIN entity_identifier ei ON ei.entity_id = e.id
                                 AND ei.identifier_type = 'PLACA'
                                 AND ei.is_current
        JOIN snapshot s           ON s.id = f.snapshot_id
       WHERE f.value_numeric IS NOT NULL
         AND f.raw_cell_id IS NOT NULL
         AND s.status <> 'SUPERSEDED'
       ORDER BY s.effective_date DESC, ei.identifier_value
       LIMIT 1
    `);
    expect(rows[0], "o banco de avaliação precisa ter fato com célula").toBeTruthy();
    alvo = rows[0]!;
  }, 120_000);

  async function origemDe(args: Record<string, unknown>) {
    return executar(registroPadrao(), "proveniencia", args, { db, recorte: {} });
  }

  it("chega ao arquivo e à célula pelo vocabulário de quem pergunta", async () => {
    const r = await origemDe({ alvo: "valor", ...alvo });
    expect(r.ok).toBe(true);
    const c = r.conteudo as Record<string, any>;

    expect(c.encontrado).toBe(true);
    expect(c.veiculo.placa).toBe(alvo.placa);
    expect(c.parametro.codigo).toBe(alvo.atributo);
    expect(c.vigencia.data).toBe(alvo.vigencia);

    // O arquivo: nome, hash e quando foi recebido.
    expect(c.arquivo.nome).toMatch(/\.xlsx?$/i);
    expect(c.arquivo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.arquivo.recebidoEm).toBeTruthy();

    // A célula: aba, linha, coluna e o texto como estava na planilha.
    expect(c.celula.aba).toBeTruthy();
    expect(c.celula.linha).toBeGreaterThan(0);
    expect(c.celula.coluna).toMatch(/^[A-Z]+$/);
    expect(c.celula.valorBruto ?? c.celula.textoFormatado).toBeTruthy();
  }, 60_000);

  it("o arquivo citado é o que a importação de fato registrou", async () => {
    const r = await origemDe({ alvo: "valor", ...alvo });
    const c = r.conteudo as Record<string, any>;
    /*
      A asserção que separa "o JOIN compila" de "a resposta é verdadeira": o
      nome e o hash saem conferidos contra `source_file`, pela importação que a
      própria resposta nomeia.
    */
    const { rows } = await db.execute<{ filename: string; content_sha256: string }>(sql`
      SELECT sf.filename, sf.content_sha256
        FROM import_run ir
        JOIN source_file sf ON sf.id = ir.source_file_id
       WHERE ir.id = ${c.arquivo.importacao}::uuid
    `);
    expect(rows[0]?.filename).toBe(c.arquivo.nome);
    expect(rows[0]?.content_sha256).toBe(c.arquivo.sha256);
  }, 60_000);

  it("a evidência autoriza a placa como identificador, e não como número", async () => {
    const r = await origemDe({ alvo: "valor", ...alvo });
    const evidencia = r.evidencias[0] as Evidencia;
    expect(evidencia.identificadores).toContain(alvo.placa);

    const dossie = { evidencias: [evidencia], trechos: [], documentos: [], anexos: [], lacunas: [] } as unknown as Dossie;
    const frase = `O valor do ${alvo.placa} veio do arquivo ${(r.conteudo as any).arquivo.nome}, linha ${(r.conteudo as any).celula.linha} [1].`;
    const s = sanear(frase, dossie);
    expect(s.recusados, `recusados: ${s.recusados.join(", ")}`).toEqual([]);
    expect(s.removidas).toBe(0);
  }, 60_000);

  it("uma placa que não existe é dita como placa desconhecida", async () => {
    const r = await origemDe({ alvo: "valor", placa: "ZZZ9Z99", atributo: alvo.atributo });
    const c = r.conteudo as Record<string, any>;
    expect(c.encontrado).toBe(false);
    expect(c.motivo).toBe("PLACA_DESCONHECIDA");
    expect(c.explicacao).toContain("ZZZ9Z99");
    // Sem evidência: nada aqui autoriza afirmação nenhuma.
    expect(r.evidencias).toHaveLength(0);
  }, 60_000);

  it("um parâmetro que o veículo não tem lista o que ele tem", async () => {
    const r = await origemDe({
      alvo: "valor",
      placa: alvo.placa,
      atributo: "cavalo.parametro_que_nao_existe",
      vigencia: alvo.vigencia,
    });
    const c = r.conteudo as Record<string, any>;
    expect(c.encontrado).toBe(false);
    expect(c.motivo).toBe("SEM_FATO");
    /*
      A recusa que aponta o próximo passo: quem perguntou pelo nome errado
      recebe a lista dos nomes certos, em vez de "não encontrei".
    */
    expect(c.explicacao).toMatch(/Nesta vigência ele tem: \w/);
  }, 60_000);

  it("a origem das duas pontas de uma alteração, com a célula de cada uma", async () => {
    /*
      Uma alteração de verdade, escolhida do banco. Sem nenhuma, o caso se
      declara em vez de passar em silêncio: um teste que só passa quando não há
      o que testar é um teste que não protege nada.
    */
    const { rows } = await db.execute<{
      placa: string;
      atributo: string;
      vigencia: string;
    }>(sql`
      SELECT c.entity_label AS placa,
             c.attribute_code AS atributo,
             s.effective_date::text AS vigencia
        FROM "change" c
        JOIN change_set cs ON cs.id = c.change_set_id
        JOIN snapshot s    ON s.id = cs.snapshot_b_id
       WHERE c.value_before IS NOT NULL
         AND c.value_after IS NOT NULL
       ORDER BY s.effective_date DESC
       LIMIT 1
    `);
    expect(rows[0], "o banco precisa ter ao menos uma alteração com as duas pontas").toBeTruthy();
    const daAlteracao = rows[0]!;

    const r = await origemDe({ alvo: "alteracao", ...daAlteracao });
    const c = r.conteudo as Record<string, any>;
    expect(c.encontrado).toBe(true);
    expect(c.attribute_code).toBe(daAlteracao.atributo);

    const evidencia = r.evidencias[0] as Evidencia;
    const rotulos = evidencia.fatos.map((f) => f.rotulo);
    expect(rotulos).toEqual(["Antes", "Depois"]);
    // Cada ponta traz a célula que a originou.
    for (const fato of evidencia.fatos) {
      expect(fato.detalhe).toMatch(/aba .+, linha \d+, coluna/);
    }
  }, 60_000);

  it("um parâmetro sem alteração diz isso, e diz o que consultar", async () => {
    const r = await origemDe({
      alvo: "alteracao",
      placa: alvo.placa,
      atributo: "cavalo.parametro_que_nao_existe",
    });
    const c = r.conteudo as Record<string, any>;
    expect(c.encontrado).toBe(false);
    expect(c.motivo).toBe("SEM_ALTERACAO");
    expect(c.explicacao).toContain("alvo='valor'");
  }, 60_000);

  it("está no catálogo do agente — sem isso nada disto é alcançável", () => {
    const nomes = registroPadrao().lista().map((f) => f.nome);
    expect(nomes).toContain("proveniencia");
  });
});
