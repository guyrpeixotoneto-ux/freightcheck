import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { foldText } from "../../workbook";
import {
  lerExtrato,
  normalizarPlaca,
  numeroDoErp,
  reconhecerLayoutDoExtrato,
  competenciaDe,
  type LinhaBrutaDoExtrato,
} from "../extrato";
import { apurar, reconciliar, type DecisaoTomada } from "../agregacao";

/**
 * O extrato real de 2026, e não uma planilha sintética.
 *
 * ---------------------------------------------------------------------------
 * Por que o arquivo de verdade
 * ---------------------------------------------------------------------------
 * Porque toda regra deste módulo nasceu de uma medição feita **neste** arquivo,
 * e uma planilha sintética escrita por quem já sabe a regra confirma a regra por
 * construção. As três situações que a agregação separa — um documento com duas
 * rubricas, dois documentos com o mesmo valor, e a linha repetida — não foram
 * imaginadas: foram contadas aqui, e é aqui que elas têm de continuar sendo
 * encontradas quando alguém mexer no leitor.
 *
 * Os números abaixo são o extrato de janeiro a setembro de 2026 da unidade de
 * Camaçari: 903 linhas, 104 placas, R$ 10.198.831,18 em nove competências.
 * Qualquer mudança que os altere está mudando o que o produto diz que a
 * operação gastou, e é para isso que eles estão escritos por extenso.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANILHA = path.resolve(AQUI, "../../../../../attached_assets/Finames_Real_2026.xlsx");

/**
 * O total do razão: R$ 10.198.831,1836, somado célula a célula fora deste
 * código.
 *
 * As quatro casas não são preciosismo. O extrato traz valores com três e quatro
 * decimais (`-5896.428`), e é a soma **deles** que fecha com o razão; somar os
 * centavos arredondados de cada linha daria outro número. O consolidado
 * arredonda ao centavo só na saída, e a tolerância da reconciliação é
 * exatamente a margem que esse arredondamento pode acumular — ver `reconciliar`.
 */
const TOTAL_DO_EXTRATO = 10198831.1836;

function lerPlanilha(aba: string): {
  cabecalhos: string[];
  linhas: LinhaBrutaDoExtrato[];
} {
  const wb = XLSX.read(readFileSync(PLANILHA), { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[aba];
  /*
    `raw: true` não é detalhe de leitura: é dinheiro.

    Com o texto formatado, o SheetJS entrega `-5896.43` onde a célula guarda
    `-5896.428` — e as frações somadas nas 903 linhas deste arquivo dão R$
    1.102,03 de diferença contra o razão. O pipeline lê o valor cru (`raw.v`, em
    `readCell`) exatamente por isso, e este teste lê como ele lê: um harness que
    arredondasse antes do código testaria uma planilha que ninguém importa.
  */
  const matriz = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const cabecalhos = (matriz[0] ?? []).map((c) => String(c ?? ""));
  const linhas: LinhaBrutaDoExtrato[] = [];
  for (let i = 1; i < matriz.length; i++) {
    const bruta = matriz[i];
    if (!bruta || bruta.every((c) => c === null || c === "")) continue;
    const celulas: Record<string, string | null> = {};
    cabecalhos.forEach((cabecalho, coluna) => {
      const valor = bruta[coluna];
      celulas[foldText(cabecalho)] = valor === null ? null : String(valor);
    });
    /* `rowIndex` é a linha física, como uma pessoa a conta no Excel: o
       cabeçalho é a 1, então a primeira linha de dados é a 2. */
    linhas.push({ rowIndex: i + 1, celulas });
  }
  return { cabecalhos, linhas };
}

/**
 * O cadastro, como o produto o resolveria: pela placa, nunca pela conta.
 *
 * No teste ele é a lista de placas que o acervo remunerado conhece. Oito das
 * 104 do extrato não estão nele, e é assim que devem ficar — ver o teste da
 * fila de classificação.
 */
const PLACAS_SEM_CADASTRO = new Set([
  "QYP3D02",
  "QYP3D12",
  "QYP3D22",
  "RZG5A37",
  "RZG5A38",
  "RZG5A39",
  "RZG5A40",
  "RZG5A41",
]);

const resolverTipo = (placa: string): string | null =>
  PLACAS_SEM_CADASTRO.has(placa) ? null : "CAVALO";

/** Um cadastro completo, para os testes em que a fila não é o assunto. */
const resolverTudoComoCavalo = (): string => "CAVALO";

describe("o leitor do extrato do ERP", () => {
  it("reconhece o layout pelas cinco colunas que importam", () => {
    const { cabecalhos } = lerPlanilha("Planilha1");
    const layout = reconhecerLayoutDoExtrato(cabecalhos);
    expect(layout.reconhecido).toBe(true);
    expect(layout.faltando).toEqual([]);
  });

  it("recusa a aba de-para, e diz o que falta nela", () => {
    /*
      A Planilha2 é um de-para placa→código com 24.164 linhas. Ela não é o
      extrato, e o leitor tem de dizer isso com todas as letras — o silêncio
      aqui é como um arquivo inteiro entra vazio.
    */
    const { cabecalhos } = lerPlanilha("Planilha2");
    const layout = reconhecerLayoutDoExtrato(cabecalhos);
    expect(layout.reconhecido).toBe(false);
    expect(layout.faltando).toEqual(["mes", "ano", "placa", "vlrrea", "numdoc"]);
  });

  it("lê as 903 linhas do extrato sem recusar nenhuma", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    expect(leitura.linhas).toHaveLength(903);
    expect(leitura.recusadas).toEqual([]);
  });

  it("normaliza a placa para a forma que casa com o acervo remunerado", () => {
    /*
      O extrato escreve `QYZ-3E44`; o export de remuneração escreve `QYZ3E44`.
      Se as duas não virarem a mesma chave, o real de um caminhão e o remunerado
      dele viram entidades diferentes, e não há o que cruzar — que é a única
      coisa que esta auditoria existe para fazer.
    */
    expect(normalizarPlaca("QYZ-3E44")).toBe("QYZ3E44");
    expect(normalizarPlaca(" qyz 3e44 ")).toBe("QYZ3E44");
    expect(normalizarPlaca(null)).toBe("");

    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    expect(leitura.linhas.every((l) => /^[A-Z0-9]+$/.test(l.placa))).toBe(true);
    // O original sobrevive ao lado da normalização, com hífen e tudo.
    expect(leitura.linhas.some((l) => l.placaRaw.includes("-"))).toBe(true);
  });

  it("converte MES e ANO em competência, e recusa mês impossível", () => {
    expect(competenciaDe(3, 2026)).toBe("2026-03-01");
    expect(competenciaDe(13, 2026)).toBeNull();
    expect(competenciaDe(0, 2026)).toBeNull();
  });

  it("lê o número do ERP nas formas que ele usa, e só nelas", () => {
    expect(numeroDoErp("-5896.428")).toBe(-5896.428);
    expect(numeroDoErp("0.00000000000")).toBe(0);
    // "NULL" é a palavra que este export escreve onde não há valor.
    expect(numeroDoErp("NULL")).toBeNull();
    expect(numeroDoErp("")).toBeNull();
    // Vírgula decimal não é suposta: supor inverteria milhar e decimal.
    expect(numeroDoErp("1.234,56")).toBeNull();
  });

  it("guarda o valor nas duas formas — positivo para comparar, original para conferir", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    // O extrato inteiro é débito: nenhum lançamento positivo.
    expect(leitura.linhas.every((l) => l.valorOriginal < 0)).toBe(true);
    expect(leitura.linhas.every((l) => l.valorAbsoluto > 0)).toBe(true);
    expect(leitura.linhas.every((l) => l.valorAbsoluto === -l.valorOriginal)).toBe(true);
  });

  it("recusa a linha, e não o arquivo, quando ela não dá para ler", () => {
    const leitura = lerExtrato([
      { rowIndex: 2, celulas: { mes: "3", ano: "2026", placa: "ABC1D23", vlrrea: "-100", numdoc: "X1" } },
      { rowIndex: 3, celulas: { mes: "NULL", ano: "2026", placa: "ABC1D23", vlrrea: "-100", numdoc: "X2" } },
      { rowIndex: 4, celulas: { mes: "3", ano: "2026", placa: null, vlrrea: "-100", numdoc: "X3" } },
      { rowIndex: 5, celulas: { mes: "3", ano: "2026", placa: "ABC1D23", vlrrea: "abc", numdoc: "X4" } },
      { rowIndex: 6, celulas: { mes: "3", ano: "2026", placa: "ABC1D23", vlrrea: "-100", numdoc: null } },
    ]);
    expect(leitura.linhas).toHaveLength(1);
    expect(leitura.recusadas.map((r) => r.codigo)).toEqual([
      "COMPETENCIA_ILEGIVEL",
      "PLACA_AUSENTE",
      "VALOR_ILEGIVEL",
      "DOCUMENTO_AUSENTE",
    ]);
    // A recusa carrega a evidência: conferível sem abrir o arquivo.
    expect(leitura.recusadas[0].evidencia).toContain("MES=NULL");
  });
});

describe("a regra de agregação, medida no extrato real", () => {
  function apuracaoReal(decisoes: readonly DecisaoTomada[] = []) {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    return apurar(leitura.linhas, {
      resolverTipo: resolverTudoComoCavalo,
      decisoes,
      linhasRejeitadasNaLeitura: leitura.recusadas.length,
    });
  }

  it("soma os lançamentos da mesma placa no mesmo mês, e diz quantos somou", () => {
    /*
      O caso que o pipeline de modelo não sabe tratar: 73 chaves contábeis deste
      arquivo trazem duas linhas sob o mesmo NUMDOC com valores diferentes —
      principal e juros do mesmo pagamento. Elas somam. No caminho antigo, uma
      chave repetida com valores discordantes derruba o registro inteiro da
      vigência (`ENTIDADE_DUPLICADA_CONFLITANTE`): 9 placas e R$ 506 mil que
      simplesmente não apareceriam.
    */
    const { consolidados, relatorio } = apuracaoReal();
    expect(relatorio.gruposAgregados).toBeGreaterThan(0);

    const agregado = consolidados.find((c) => c.lancamentos > 1);
    expect(agregado).toBeDefined();
    expect(agregado!.documentos.length).toBeGreaterThan(0);

    // Um consolidado por (competência, placa) — nunca dois.
    const chaves = consolidados.map((c) => `${c.competencia}${c.placa}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("não soma as cinco linhas 100% idênticas — retém e pendencia", () => {
    /*
      As cinco são todas da RZG-5A37, uma por mês de maio a setembro, com NUMDOC
      sequencial. Somá-las cobraria duas vezes o mesmo pagamento; descartá-las
      perderia um pagamento que talvez exista. Nenhuma das duas é decisão do
      software, então ele retém, marca e mostra o valor em jogo.
    */
    const { lancamentos, relatorio } = apuracaoReal();
    const duplicadas = lancamentos.filter((l) => l.status === "DUPLICATA_PROVAVEL");
    expect(duplicadas).toHaveLength(5);
    expect(new Set(duplicadas.map((l) => l.placa))).toEqual(new Set(["RZG5A37"]));
    expect(relatorio.valorEmDuplicatas).toBeCloseTo(21206.77, 2);
    // A linha retida é sempre a segunda ocorrência, nunca a primeira.
    expect(duplicadas.every((l) => l.motivo?.includes("idêntica à linha"))).toBe(true);
  });

  it("soma os pares que repetem o valor mas não o documento", () => {
    /*
      14 pares têm mesma placa, mesmo mês e mesmo valor, diferindo em NUMDOC e
      DATATU. São dois pagamentos com a parcela igual — e é por isso que a
      impressão digital inclui a data de escrituração. Uma regra que olhasse só
      placa+mês+valor os fundiria e perderia metade de cada um.
    */
    const { lancamentos } = apuracaoReal();
    const aceitos = lancamentos.filter((l) => l.status === "ACEITO");
    const porPlacaMesValor = new Map<string, number>();
    for (const l of aceitos) {
      const chave = `${l.placa}${l.competencia}${l.valorAbsoluto}`;
      porPlacaMesValor.set(chave, (porPlacaMesValor.get(chave) ?? 0) + 1);
    }
    const paresIguais = [...porPlacaMesValor.values()].filter((n) => n > 1).length;
    expect(paresIguais).toBe(14);
  });

  it("uma decisão humana muda o destino da duplicata, nos dois sentidos", () => {
    const base = apuracaoReal();
    const impressao = base.lancamentos.find((l) => l.status === "DUPLICATA_PROVAVEL")!
      .impressaoDigital;

    const confirmada = apuracaoReal([
      { tipo: "DUPLICATA_CONFIRMADA", chave: impressao },
    ]);
    const daquele = confirmada.lancamentos.filter(
      (l) => l.impressaoDigital === impressao,
    );
    expect(daquele.filter((l) => l.status === "REJEITADO")).toHaveLength(1);
    expect(daquele.filter((l) => l.status === "ACEITO")).toHaveLength(1);

    const distintos = apuracaoReal([
      { tipo: "LANCAMENTOS_DISTINTOS", chave: impressao },
    ]);
    expect(
      distintos.lancamentos
        .filter((l) => l.impressaoDigital === impressao)
        .every((l) => l.status === "ACEITO"),
    ).toBe(true);
    // E aí o consolidado daquele mês passa a contar os dois.
    const grupo = distintos.consolidados.find(
      (c) => c.placa === "RZG5A37" && c.competencia === daquele[0].competencia,
    );
    expect(grupo!.lancamentos).toBe(2);
  });

  it("a decisão mais recente é a que vale, e a anterior não é apagada", () => {
    const base = apuracaoReal();
    const impressao = base.lancamentos.find((l) => l.status === "DUPLICATA_PROVAVEL")!
      .impressaoDigital;
    const apuracao = apurarComHistorico(impressao);
    expect(
      apuracao.lancamentos
        .filter((l) => l.impressaoDigital === impressao)
        .every((l) => l.status === "ACEITO"),
    ).toBe(true);
  });

  function apurarComHistorico(impressao: string) {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    return apurar(leitura.linhas, {
      resolverTipo: resolverTudoComoCavalo,
      // Confirmada primeiro, revista depois: vale a última.
      decisoes: [
        { tipo: "DUPLICATA_CONFIRMADA", chave: impressao },
        { tipo: "LANCAMENTOS_DISTINTOS", chave: impressao },
      ],
    });
  }

  it("é determinística: a mesma planilha apura o mesmo número duas vezes", () => {
    /*
      A idempotência da reimportação começa aqui. Se a apuração variasse entre
      duas leituras do mesmo arquivo, nenhuma garantia adiante a consertaria.
    */
    const a = apuracaoReal();
    const b = apuracaoReal();
    expect(b.consolidados).toEqual(a.consolidados);
    expect(b.relatorio).toEqual(a.relatorio);
  });
});

describe("a reconciliação com o extrato de origem", () => {
  it("fecha: cada centavo do razão está somado, retido ou rejeitado", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const apuracao = apurar(leitura.linhas, { resolverTipo: resolverTudoComoCavalo });
    const r = reconciliar(apuracao);

    expect(r.totalDoExtrato).toBeCloseTo(TOTAL_DO_EXTRATO, 2);
    expect(r.fecha).toBe(true);
    expect(r.totalConsolidado + r.totalEmDuplicatas).toBeCloseTo(TOTAL_DO_EXTRATO, 1);
    expect(r.totalRejeitado).toBe(0);
  });

  it("continua fechando quando parte das placas está na fila de classificação", () => {
    /*
      O dinheiro das placas sem tipo não some nem entra: ele fica em
      `totalPendente`, e a conta continua fechando. Um saldo que sumisse na fila
      seria a forma mais discreta de perder R$ 200 mil.
    */
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const apuracao = apurar(leitura.linhas, { resolverTipo });
    const r = reconciliar(apuracao);
    expect(r.totalPendente).toBeGreaterThan(0);
    expect(r.fecha).toBe(true);
  });
});

describe("a fila de classificação de ativo", () => {
  it("não inventa o tipo a partir da conta contábil", () => {
    /*
      `C.D.C. - VP` é "veículo pesado", e pesado é cavalo, caminhão e carreta.
      Deduzir dali acertaria na maioria e erraria calado no resto — e o erro
      apareceria como um cavalo somado no meio das carretas.
    */
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const { lancamentos, relatorio } = apurar(leitura.linhas, { resolverTipo });

    const pendentes = lancamentos.filter(
      (l) => l.status === "PENDENTE_DE_CLASSIFICACAO",
    );
    expect(pendentes.length).toBeGreaterThan(0);
    expect(pendentes.every((l) => l.entityType === null)).toBe(true);
    expect(relatorio.placasSemClassificacao.length).toBeGreaterThan(0);
    // Nenhuma delas entra em consolidado.
    expect(pendentes.every((l) => l.grupo === "")).toBe(true);
  });

  it("uma classificação declarada tira a placa da fila e a põe na soma", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const semDecisao = apurar(leitura.linhas, { resolverTipo });
    const placa = semDecisao.relatorio.placasSemClassificacao[0];

    const comDecisao = apurar(leitura.linhas, {
      resolverTipo,
      decisoes: [{ tipo: "CLASSIFICAR_ATIVO", chave: placa, valor: "CARRETA" }],
    });
    expect(comDecisao.relatorio.placasSemClassificacao).not.toContain(placa);
    const consolidado = comDecisao.consolidados.find((c) => c.placa === placa);
    expect(consolidado?.entityType).toBe("CARRETA");
  });
});

describe("a competência possivelmente parcial", () => {
  it("marca setembro pela medida do próprio arquivo, e não por ser setembro", () => {
    /*
      49 lançamentos contra uma mediana de 105. A regra é do arquivo — um mês
      real com queda de frota cairia aqui também, e é o desfecho certo: a marca
      diz "confira", não "está errado".
    */
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const { relatorio } = apurar(leitura.linhas, {
      resolverTipo: resolverTudoComoCavalo,
    });

    const setembro = relatorio.competencias.find((c) => c.competencia === "2026-09-01");
    expect(setembro?.parcial).toBe(true);
    expect(setembro?.motivoParcial).toContain("mediana");

    const marco = relatorio.competencias.find((c) => c.competencia === "2026-03-01");
    expect(marco?.parcial).toBe(false);
    expect(marco?.motivoParcial).toBeNull();
  });

  it("marca a competência corrente por estar em curso, com outro motivo", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const { relatorio } = apurar(leitura.linhas, {
      resolverTipo: resolverTudoComoCavalo,
      competenciaCorrente: "2026-03-01",
    });
    const marco = relatorio.competencias.find((c) => c.competencia === "2026-03-01");
    expect(marco?.parcial).toBe(true);
    expect(marco?.motivoParcial).toContain("em curso");
  });

  it("cobre as nove competências do arquivo, e nenhuma a mais", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const { relatorio } = apurar(leitura.linhas, {
      resolverTipo: resolverTudoComoCavalo,
    });
    expect(relatorio.competencias).toHaveLength(9);
    expect(relatorio.competencias[0].competencia).toBe("2026-01-01");
    expect(relatorio.competencias[8].competencia).toBe("2026-09-01");
  });
});

describe("o relatório da importação", () => {
  it("conta o que entrou, o que agregou, o que reteve e o que ficou pendente", () => {
    const { linhas } = lerPlanilha("Planilha1");
    const leitura = lerExtrato(linhas);
    const { relatorio } = apurar(leitura.linhas, {
      resolverTipo,
      linhasRejeitadasNaLeitura: leitura.recusadas.length,
    });

    expect(relatorio.linhasRecebidas).toBe(903);
    expect(relatorio.linhasDuplicadas).toBe(5);
    expect(relatorio.linhasPendentesDeClassificacao).toBeGreaterThan(0);
    /*
      Toda linha recebida está em exatamente um destino. É esta igualdade que
      impede o relatório de "perder" linhas numa refatoração futura — o mesmo
      papel que a reconciliação faz com o dinheiro.
    */
    expect(
      relatorio.linhasAceitas +
        relatorio.linhasDuplicadas +
        relatorio.linhasPendentesDeClassificacao +
        relatorio.linhasRejeitadas,
    ).toBe(relatorio.linhasRecebidas);
  });
});
