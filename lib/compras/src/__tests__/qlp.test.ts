import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha } from "@workspace/ingest/testing/planilha";
import { remuneradoDoQlp, papelDaColuna, type ConsultaDoQlp } from "../qlp";
import { matrizDoQlp, type MatrizDoQlp } from "../matriz-qlp";

/**
 * O balcão do QLP administrativo, sobre o pipeline real de importação.
 *
 * O material é sintético e os **nomes das colunas são os do dicionário**
 * (`docs/tabela-de-qlp-adm-dicionario.csv`), letra por letra: um teste com nomes
 * inventados exercitaria um caminho que a produção nunca percorre, e o que se
 * está provando aqui é justamente que a coluna que a Ambev manda chega ao
 * produto certo com o papel certo.
 *
 * A aritmética das linhas foi escolhida para escrever três estados que a tela
 * promete distinguir:
 *
 * 1. **fecha** — `despesa = unitário × quantidade`, o caso normal;
 * 2. **não fecha** — a fonte se contradiz, e o número exibido continua sendo o
 *    dela;
 * 3. **não confere** — falta um dos três fatores, e a ausência de conferência
 *    não é alarme.
 */

let ctx: TestDb;
let consulta: ConsultaDoQlp;

/** As colunas do dicionário que este teste exercita. */
const COLUNAS = [
  "Valor Uniformes",
  "Quantidade Uniformes",
  "Despesa Uniformes",
  "Valor Telefonia",
  "Quantidade Telefonia",
  "Despesa Telefonia",
  "Valor Frota Leve",
  "Quantidade Frota Leve",
  "Despesa Frota Leve",
  "Vale Transporte",
  "Quantidade Ordenados",
  "Salário Ordenados",
  "Despesa Ordenados",
];

interface Valores {
  uniformeValor?: number;
  uniformeQtd?: number;
  uniformeDespesa?: number;
  telefoniaValor?: number;
  telefoniaQtd?: number;
  telefoniaDespesa?: number;
  frotaLeveValor?: number;
  frotaLeveQtd?: number;
  frotaLeveDespesa?: number;
  valeTransporte?: number;
  ordenadosQtd?: number;
  ordenadosSalario?: number;
  ordenadosDespesa?: number;
}

const cargo = (nome: string, v: Valores) => ({
  placa: nome,
  valores: {
    ...(v.uniformeValor !== undefined ? { "Valor Uniformes": v.uniformeValor } : {}),
    ...(v.uniformeQtd !== undefined ? { "Quantidade Uniformes": v.uniformeQtd } : {}),
    ...(v.uniformeDespesa !== undefined ? { "Despesa Uniformes": v.uniformeDespesa } : {}),
    ...(v.telefoniaValor !== undefined ? { "Valor Telefonia": v.telefoniaValor } : {}),
    ...(v.telefoniaQtd !== undefined ? { "Quantidade Telefonia": v.telefoniaQtd } : {}),
    ...(v.telefoniaDespesa !== undefined ? { "Despesa Telefonia": v.telefoniaDespesa } : {}),
    ...(v.frotaLeveValor !== undefined ? { "Valor Frota Leve": v.frotaLeveValor } : {}),
    ...(v.frotaLeveQtd !== undefined ? { "Quantidade Frota Leve": v.frotaLeveQtd } : {}),
    ...(v.frotaLeveDespesa !== undefined ? { "Despesa Frota Leve": v.frotaLeveDespesa } : {}),
    ...(v.valeTransporte !== undefined ? { "Vale Transporte": v.valeTransporte } : {}),
    ...(v.ordenadosQtd !== undefined ? { "Quantidade Ordenados": v.ordenadosQtd } : {}),
    ...(v.ordenadosSalario !== undefined ? { "Salário Ordenados": v.ordenadosSalario } : {}),
    ...(v.ordenadosDespesa !== undefined ? { "Despesa Ordenados": v.ordenadosDespesa } : {}),
  },
});

beforeAll(async () => {
  ctx = await createTestDatabase("compras_qlp");

  const arquivo = escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "TABELA DE QLP ADM",
        identificador: "Cargo",
        colunas: COLUNAS,
        linhas: [
          // Fecha nos três produtos: 2×180=360, 1×95=95, 3×4600=13800.
          cargo("ANALISTA ADM", {
            uniformeValor: 180,
            uniformeQtd: 2,
            uniformeDespesa: 360,
            telefoniaValor: 95,
            telefoniaQtd: 1,
            telefoniaDespesa: 95,
            valeTransporte: 264,
            ordenadosQtd: 3,
            ordenadosSalario: 4600,
            ordenadosDespesa: 13800,
          }),
          // Uniforme não fecha: 4×180 = 720, e a fonte declara 700.
          cargo("AUXILIAR ADM", {
            uniformeValor: 180,
            uniformeQtd: 4,
            uniformeDespesa: 700,
            ordenadosQtd: 4,
            ordenadosSalario: 2400,
            ordenadosDespesa: 9600,
          }),
          // Frota leve sem quantidade: não há o que conferir, e isso não é alarme.
          cargo("COORDENADOR ADM", {
            frotaLeveValor: 2100,
            frotaLeveDespesa: 2100,
            ordenadosQtd: 1,
            ordenadosSalario: 9800,
            ordenadosDespesa: 9800,
          }),
        ],
      },
    ],
  });

  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType: "QLP_ADMINISTRATIVO",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  expect(relatorio.blockingErrors).toBe(0);
  await promote(ctx.db, recebido.importRunId);

  consulta = (await remuneradoDoQlp(ctx.db))!;
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const produto = (chave: string) => consulta.produtos.find((p) => p.produto.chave === chave)!;
const linha = (chave: string, cargoNome: string) =>
  produto(chave).linhas.find((l) => l.cargo === cargoNome)!;
const celula = (chave: string, cargoNome: string, papel: string) =>
  linha(chave, cargoNome).celulas.find((c) => c.papel === papel)!;

describe("o balcão abre", () => {
  it("responde na vigência importada", () => {
    expect(consulta.effectiveDate).toBe("2026-08-01");
    expect(consulta.registrosFaltando).toBe(0);
  });

  it("devolve null quando não há QLP nenhum importado", async () => {
    const vazio = await createTestDatabase("compras_qlp_vazio");
    try {
      expect(await remuneradoDoQlp(vazio.db)).toBeNull();
    } finally {
      await vazio.drop();
    }
  }, 120_000);

  it("oferece todos os produtos do balcão administrativo", () => {
    const chaves = consulta.produtos.map((p) => p.produto.chave);
    expect(chaves).toContain("uniformes");
    expect(chaves).toContain("telefonia");
    expect(chaves).toContain("frota-leve");
    expect(chaves).toContain("vale-transporte");
    expect(chaves).toContain("ordenados");
  });

  /**
   * O balcão que ainda não abriu aparece, vazio, dizendo o que falta. Omiti-lo
   * faria quem procura o uniforme do motorista concluir que o produto não
   * existe, quando o que não existe é o dado.
   */
  it("declara o balcão operacional e o que falta para ele abrir", () => {
    expect(consulta.operacional.balcao).toBe("QLP_OPERACIONAL");
    expect(consulta.operacional.falta).toContain("QLP operacional");
  });

  /**
   * Um produto cujo export não trouxe coluna nenhuma diz `semColuna`, e não
   * some. Benefícios e encargos não estão nesta planilha de propósito.
   */
  it("um produto sem coluna nesta vigência diz que não tem, em vez de sumir", () => {
    expect(produto("beneficios").semColuna).toBe(true);
    expect(produto("beneficios").linhas).toEqual([]);
    expect(produto("uniformes").semColuna).toBe(false);
  });
});

describe("os três papéis de cada produto", () => {
  it("uniformes chega com valor unitário, quantidade e despesa, nessa ordem", () => {
    expect(produto("uniformes").colunas.map((c) => c.papel)).toEqual([
      "UNITARIO",
      "QUANTIDADE",
      "DESPESA",
    ]);
  });

  it("o valor unitário é o preço de um — é o número que responde ao pedido", () => {
    expect(celula("uniformes", "ANALISTA ADM", "UNITARIO").valor).toBe(180);
    expect(celula("uniformes", "ANALISTA ADM", "QUANTIDADE").valor).toBe(2);
    expect(celula("uniformes", "ANALISTA ADM", "DESPESA").valor).toBe(360);
  });

  /**
   * Vale-transporte tem uma coluna só, e ela é despesa. Lê-la como preço
   * unitário por começar com outra palavra seria exatamente o erro que o mapa
   * declarado existe para não cometer.
   */
  it("vale-transporte tem uma coluna só, e ela é despesa", () => {
    expect(produto("vale-transporte").colunas.map((c) => c.papel)).toEqual(["DESPESA"]);
    expect(celula("vale-transporte", "ANALISTA ADM", "DESPESA").valor).toBe(264);
  });

  it("uma coluna fora do mapa não recebe papel por parecer com o nome de um", () => {
    expect(papelDaColuna("qlp_administrativo.unidade_nome")).toBeNull();
    expect(papelDaColuna("qlp_administrativo.valor_uniformes")).toBe("UNITARIO");
  });
});

describe("a conferência da fonte contra ela mesma", () => {
  it("fecha quando despesa é unitário × quantidade", () => {
    const conferencia = linha("uniformes", "ANALISTA ADM").conferencia!;
    expect(conferencia.fecha).toBe(true);
    expect(conferencia.esperado).toBe(360);
    expect(conferencia.declarado).toBe(360);
    expect(conferencia.diferenca).toBe(0);
  });

  /**
   * Quando não fecha, **o número exibido continua sendo o da fonte**, porque é
   * ele que a Ambev paga. A conferência informa; ela não corrige.
   */
  it("não fecha quando a fonte se contradiz, e não corrige o número", () => {
    const conferencia = linha("uniformes", "AUXILIAR ADM").conferencia!;
    expect(conferencia.fecha).toBe(false);
    expect(conferencia.esperado).toBe(720);
    expect(conferencia.declarado).toBe(700);
    expect(conferencia.diferenca).toBe(-20);
    expect(celula("uniformes", "AUXILIAR ADM", "DESPESA").valor).toBe(700);
  });

  it("não confere quando falta um dos três fatores — e isso não é alarme", () => {
    expect(linha("frota-leve", "COORDENADOR ADM").conferencia).toBeNull();
    expect(linha("vale-transporte", "ANALISTA ADM").conferencia).toBeNull();
  });

  it("os ordenados fecham nos três cargos", () => {
    for (const l of produto("ordenados").linhas) {
      expect(l.conferencia?.fecha).toBe(true);
    }
  });
});

describe("o que não vira linha", () => {
  /**
   * Um cargo sem nenhum valor do produto não vira linha. É o caso comum no
   * export real — nem todo cargo tem frota leve —, e uma tabela cheia de linhas
   * de travessão esconderia as que têm número.
   */
  it("cargo sem valor nenhum do produto fica de fora da tabela dele", () => {
    expect(produto("frota-leve").linhas.map((l) => l.cargo)).toEqual(["COORDENADOR ADM"]);
    expect(produto("telefonia").linhas.map((l) => l.cargo)).toEqual(["ANALISTA ADM"]);
    expect(produto("ordenados").linhas).toHaveLength(3);
  });

  /**
   * Célula vazia é `null`, e não zero. A diferença decide se alguém compra
   * achando que não recebe nada.
   */
  it("célula vazia é null, e não zero", () => {
    const coordenador = linha("frota-leve", "COORDENADOR ADM");
    expect(coordenador.celulas.find((c) => c.papel === "QUANTIDADE")!.valor).toBeNull();
    expect(coordenador.celulas.find((c) => c.papel === "UNITARIO")!.valor).toBe(2100);
  });

  /**
   * A semântica viaja junto porque é ela que decide se o número pode ser
   * escrito com cifrão. Numa importação nova todo atributo nasce UNKNOWN, e a
   * tela tem de mostrar o número sem afirmar que é dinheiro.
   */
  it("a semântica de cada célula viaja junto, para a tela não inventar cifrão", () => {
    const c = celula("uniformes", "ANALISTA ADM", "UNITARIO");
    expect(c.semantica.status).toBe("UNKNOWN");
    expect(c.semantica.isMonetary).toBeNull();
  });
});

/**
 * A matriz — o mesmo balcão com o eixo virado.
 *
 * O que este bloco protege é que a transposição não inventa nem perde nada: a
 * célula da matriz é o **mesmo objeto** que a linha da tabela do produto, a
 * lista de cargos é a união de todos os produtos, e as somas recusam o que não
 * se soma.
 */
describe("a matriz do QLP", () => {
  let matriz: MatrizDoQlp;

  beforeAll(() => {
    matriz = matrizDoQlp(consulta);
  });

  it("tem um cargo por linha e um produto por coluna", () => {
    expect(matriz.colunas.map((c) => c.produto.chave)).toEqual(
      consulta.produtos.map((p) => p.produto.chave),
    );
    expect(matriz.linhas.map((l) => l.cargo).sort()).toEqual([
      "ANALISTA ADM",
      "AUXILIAR ADM",
      "COORDENADOR ADM",
    ]);
    for (const linha of matriz.linhas) {
      expect(linha.celulas).toHaveLength(matriz.colunas.length);
    }
    expect(matriz.resumo.cargos).toBe(3);
    expect(matriz.resumo.unidades).toBe(1);
  });

  /**
   * A união, e não a lista de um produto tomado como referência: o coordenador
   * só tem frota leve e ordenados, e sumiria da matriz se os cargos saíssem da
   * tabela de uniformes.
   */
  it("um cargo que só existe em um produto continua na matriz", () => {
    const coordenador = matriz.linhas.find((l) => l.cargo === "COORDENADOR ADM")!;
    const i = matriz.colunas.findIndex((c) => c.produto.chave === "frota-leve");
    const j = matriz.colunas.findIndex((c) => c.produto.chave === "uniformes");
    expect(coordenador.celulas[i]!.celulas.length).toBeGreaterThan(0);
    /* Sem uniforme não é zero: é célula vazia, e a tela diz qual vazio. */
    expect(coordenador.celulas[j]!.celulas).toEqual([]);
  });

  it("a célula da matriz é o mesmo objeto da linha do produto", () => {
    for (const [i, coluna] of matriz.colunas.entries()) {
      const doBalcao = produto(coluna.produto.chave);
      for (const linha of matriz.linhas) {
        const daTabela = doBalcao.linhas.find((l) => l.entityId === linha.entityId);
        expect(linha.celulas[i]!.celulas).toEqual(daTabela?.celulas ?? []);
        expect(linha.celulas[i]!.conferencia).toEqual(daTabela?.conferencia ?? null);
      }
    }
  });

  /**
   * A recusa própria deste eixo: preço unitário não se soma. Somar o valor de
   * um uniforme com o de outro cargo responde a pergunta nenhuma, e o número
   * embaixo de "total" seria lido como o que a Ambev paga.
   */
  it("unitário sai sem total; quantidade e despesa somam", () => {
    const uniformes = matriz.colunas.find((c) => c.produto.chave === "uniformes")!;
    const unitario = uniformes.totais.find((t) => t.papel === "UNITARIO")!;
    expect(unitario.total).toBeNull();
    expect(unitario.semTotal).toBe("UNITARIO_NAO_SOMA");
    /* Continua contando quantos cargos têm o preço — a recusa é da soma, não da leitura. */
    expect(unitario.cargosComValor).toBe(2);

    const quantidade = uniformes.totais.find((t) => t.papel === "QUANTIDADE")!;
    expect(quantidade.total).toBe(6); // 2 + 4
    const despesa = uniformes.totais.find((t) => t.papel === "DESPESA")!;
    expect(despesa.total).toBe(1060); // 360 + 700, o que a fonte declara
  });

  it("um produto sem coluna nesta vigência sai sem papel nenhum, e não some", () => {
    const beneficios = matriz.colunas.find((c) => c.produto.chave === "beneficios")!;
    expect(beneficios.semColuna).toBe(true);
    expect(beneficios.papeis).toEqual([]);
    expect(beneficios.totais).toEqual([]);
  });

  /**
   * A conferência sobrevive à inversão do eixo: o auxiliar declara R$ 700 onde
   * 4 × 180 dariam 720, e o número exibido continua sendo o da fonte.
   */
  it("a conferência que não fecha viaja na célula e é contada no resumo", () => {
    const auxiliar = matriz.linhas.find((l) => l.cargo === "AUXILIAR ADM")!;
    const i = matriz.colunas.findIndex((c) => c.produto.chave === "uniformes");
    const conferencia = auxiliar.celulas[i]!.conferencia!;
    expect(conferencia.fecha).toBe(false);
    expect(conferencia.declarado).toBe(700);
    expect(conferencia.esperado).toBe(720);
    expect(matriz.resumo.cargosComDivergencia).toBe(1);
  });
});
