import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { captureRaw, preview, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { balancoDaImportacao } from "../balanco";
import type { DestinoCode } from "../destinos";

/**
 * As saídas que o arquivo do cliente nunca exercita.
 *
 * O export real da Ambev é limpo: toda célula dele vira fato, cabeçalho ou
 * grão, e nenhuma se perde. Isso é ótimo para o cliente e péssimo para a
 * confiança nesta tela — as saídas que existem justamente para dar nome ao que
 * se perde ficariam sem nunca ter sido vistas funcionando, e a primeira vez que
 * uma delas contasse seria em produção, sobre um número que ninguém poderia
 * conferir.
 *
 * Então aqui a planilha é construída com os defeitos dentro: uma linha sem
 * placa, uma com rótulo de vigência ilegível, uma linha vazia, uma coluna sem
 * cabeçalho, duas colunas que colidem no mesmo código e uma aba de pivô. Cada
 * célula é contada à mão no comentário de cada caso, e o teste exige o número
 * exato — não "maior que zero", que passaria com a classificação errada.
 *
 * A afirmação central é a que dá sentido à separação entre perda e resíduo:
 * **mesmo com perdas, o balanço fecha.** Perda declarada é massa que o sistema
 * recusou com motivo e endereço; resíduo é massa que sumiu. Um balanço que não
 * fechasse por causa de uma linha sem placa treinaria quem opera a ignorar o
 * alarme que importa.
 */

let ctx: TestDb;
let importRunId: string;

/**
 * A planilha com os defeitos, montada célula a célula.
 *
 * Colunas: as duas de grão, uma boa, uma que colide com a boa (`valorFrota` e
 * `Valor Frota` produzem o mesmo código), e uma sem cabeçalho nenhum.
 */
function planilhaComDefeitos(): string {
  const abaFonte = XLSX.utils.aoa_to_sheet([
    ["Vigencia", "Placa", "valorFrota", "Valor Frota", null],
    ["EMPURRADA_1_8_2026", "ABC1D23", 10, 20, 30],
    ["EMPURRADA_1_8_2026", null, 11, 21, 31],
    [null, null, null, null, null],
    ["ISTO_NAO_E_VIGENCIA", "ABC1D23", 13, 23, 33],
  ]);
  // A linha em branco só existe se o intervalo da aba a alcançar; `aoa_to_sheet`
  // encolhe o intervalo até a última célula preenchida quando a linha final é
  // vazia, e aqui ela é do meio, então o intervalo já a cobre.
  const abaPivo = XLSX.utils.aoa_to_sheet([
    ["Rótulos de Linha", "Soma de valor"],
    ["CAVALO", 1234],
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, abaFonte, "Modelo_Teste");
  XLSX.utils.book_append_sheet(workbook, abaPivo, "Resumo");

  const destino = path.join(
    mkdtempSync(path.join(tmpdir(), "balance-perdas-")),
    "planilha-com-defeitos.xlsx",
  );
  writeFileSync(destino, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  return destino;
}

beforeAll(async () => {
  ctx = await createTestDatabase("balance_perdas");
  const recebido = await receiveFile(ctx.db, { filePath: planilhaComDefeitos() });
  importRunId = recebido.importRunId;
  await captureRaw(ctx.db, importRunId);
  await stage(ctx.db, importRunId);
  await preview(ctx.db, importRunId);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

function contagem(destinos: { code: DestinoCode; celulas: number }[]) {
  return Object.fromEntries(destinos.map((d) => [d.code, d.celulas]));
}

describe("as saídas de perda", () => {
  it("conta cada célula na saída certa, sem sobra", async () => {
    const balanco = (await balancoDaImportacao(ctx.db, importRunId))!;

    /*
      A conta, célula a célula, das 5 colunas × 5 linhas da aba fonte:

      - linha 1 (cabeçalho): 5 células nomeiam colunas             → CABECALHO
      - linha 2 (boa):       vigência e placa                      → COLUNA_DE_GRAO
                             valorFrota                            → FATO_PREPARADO
                             "Valor Frota", que colide com a de cima → COLUNA_AMBIGUA
                             a coluna sem cabeçalho                → COLUNA_SEM_CABECALHO
      - linha 3 (sem placa): 5 células                             → LINHA_RECUSADA
      - linha 4 (vazia):     5 células                             → LINHA_EM_BRANCO
      - linha 5 (rótulo ilegível): 5 células                       → LINHA_RECUSADA

      E a aba de pivô inteira, 2 × 2                               → ABA_DE_APOIO
    */
    expect(contagem(balanco.destinos)).toEqual({
      FATO_PREPARADO: 1,
      ABA_DE_APOIO: 4,
      CABECALHO: 5,
      LINHA_EM_BRANCO: 5,
      LINHA_RECUSADA: 10,
      COLUNA_SEM_CABECALHO: 1,
      COLUNA_AMBIGUA: 1,
      COLUNA_DE_GRAO: 2,
      ABA_SEM_GRAO: 0,
      SEM_DESTINO: 0,
    });

    expect(balanco.entrada).toBe(29);
    expect(balanco.entradaRegistrada).toBe(29);
  });

  it("fecha mesmo perdendo, porque a perda é declarada", async () => {
    const balanco = (await balancoDaImportacao(ctx.db, importRunId))!;

    expect(balanco.porNatureza.PERDA).toBe(12);
    expect(balanco.residuo).toBe(0);
    expect(balanco.fecha).toBe(true);
  });

  it("separa descarte de perda em vez de somar os dois", async () => {
    const balanco = (await balancoDaImportacao(ctx.db, importRunId))!;

    // A aba de pivô e a linha vazia não perderam informação nenhuma; a linha
    // sem placa e as duas colunas recusadas perderam. Um "não aproveitado"
    // único diria 21 e esconderia exatamente o número que alguém precisa ver.
    expect(balanco.porNatureza.DESCARTE).toBe(9);
    expect(balanco.porNatureza.FATO).toBe(1);
    expect(balanco.porNatureza.OUTRO_PAPEL).toBe(7);
  });

  it("dá o endereço na planilha de cada célula que não entrou", async () => {
    const { etapa1 } = (await balancoDaImportacao(ctx.db, importRunId))!;
    const amostras = etapa1.amostras;

    /*
      Doze células perdidas, dez amostras: as dez de linha recusada são cortadas
      em oito. O corte é declarado na tela ("até oito por destino") e o total
      verdadeiro continua vindo da contagem, não desta lista — uma amostra
      truncada apresentada como se fosse a lista completa faria alguém concluir
      que o problema é menor do que é.
    */
    expect(amostras.length).toBe(10);
    for (const amostra of amostras) {
      expect(amostra.sheetName).toBe("Modelo_Teste");
    }

    const semCabecalho = amostras.filter((a) => a.code === "COLUNA_SEM_CABECALHO");
    expect(semCabecalho).toHaveLength(1);
    expect(semCabecalho[0].columnLetter).toBe("E");
    expect(semCabecalho[0].rowIndex).toBe(2);
    expect(semCabecalho[0].columnHeader).toBeNull();
    expect(semCabecalho[0].rawValue).toBe("30");

    const ambigua = amostras.filter((a) => a.code === "COLUNA_AMBIGUA");
    expect(ambigua).toHaveLength(1);
    expect(ambigua[0].columnHeader).toBe("Valor Frota");

    // As duas linhas recusadas, com o número da linha como quem abre a planilha
    // as conta — 3 e 5, não 2 e 4.
    const recusadas = amostras.filter((a) => a.code === "LINHA_RECUSADA");
    expect(recusadas).toHaveLength(8);
    expect([...new Set(recusadas.map((a) => a.rowIndex))].sort()).toEqual([3, 5]);
  });

  it("mostra a aba de pivô com o motivo pelo qual ela não vira fato", async () => {
    const { etapa1 } = (await balancoDaImportacao(ctx.db, importRunId))!;
    const pivo = etapa1.porAba.find((a) => a.sheetName === "Resumo")!;

    expect(pivo.role).toBe("PIVOT");
    // A razão nomeia o que faltou e o que serviria: sem vigência, e sem
    // nenhuma das colunas que identificam uma linha.
    expect(pivo.roleReason).toMatch(/não traz vigencia/);
    expect(pivo.roleReason).toMatch(/identificador de linha/);
    expect(pivo.celulas).toBe(4);
    expect(pivo.virouFato).toBe(0);
    expect(pivo.perda).toBe(0);

    const fonte = etapa1.porAba.find((a) => a.sheetName === "Modelo_Teste")!;
    expect(fonte.role).toBe("SOURCE");
    expect(fonte.celulas).toBe(25);
    expect(fonte.perda).toBe(12);
    expect(fonte.residuo).toBe(0);
  });
});
