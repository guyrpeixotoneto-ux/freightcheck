import { describe, expect, it } from "vitest";
import {
  decodificarTexto,
  ehPlanilha,
  matrizDelimitada,
  separadorDe,
} from "../leitores/formato";
import { lerOperacao } from "../leitores/operacao";
import { lerCtes } from "../leitores/cte";
import { lerRequisicoes } from "../leitores/requisicoes";
import { lerDisponibilidade } from "../leitores/disponibilidade";
import { lerConciliacao } from "../leitores/conciliacao";
import { lerPagamento } from "../leitores/pagamento";
import { CabecalhoNaoEncontrado, TabelaNaoDelimitada } from "../leitores/planilha";
import {
  fixtureConciliacao,
  fixtureConciliacaoEmCsv,
  fixtureCtes,
  fixtureCtesEmCsv,
  fixtureDisponibilidade,
  fixtureDisponibilidadeDeUmaFrota,
  fixtureDisponibilidadeEmCsv,
  fixtureOperacao,
  fixtureOperacaoEmCsv,
  fixturePagamento,
  fixturePagamentoEmCsv,
  fixtureRequisicoes,
  fixtureRequisicoesEmPlanilha,
  fixtureRequisicoesEmUtf8,
} from "./fixtures";

/**
 * O formato não muda a conta.
 *
 * As seis fontes chegam em mais de um formato — o mesmo relatório sai do
 * Promax em `.xlsx` pela tela e em `.csv` pela fila, e chega em `.txt` quando o
 * caminho passou por um sistema que renomeia. O que estes testes guardam é a
 * única promessa que interessa a quem opera: **o mesmo relatório, em qualquer
 * dos formatos aceitos, produz a mesma leitura.**
 *
 * Por isso quase toda asserção aqui compara uma leitura com outra em vez de
 * comparar com números escritos à mão. Um número copiado nos dois lados
 * provaria que alguém copiou certo; a comparação prova o que se quer.
 */

describe("de que forma o arquivo chegou", () => {
  it("reconhece a planilha pelos bytes, e não pelo nome", () => {
    expect(ehPlanilha(fixtureCtes())).toBe(true);
    expect(ehPlanilha(fixtureCtesEmCsv())).toBe(false);
    expect(ehPlanilha(fixtureRequisicoes())).toBe(false);
  });

  it("acha o ponto e vírgula do SRTrans", () => {
    const texto = decodificarTexto(fixtureRequisicoes());
    expect(separadorDe(texto)).toBe(";");
  });

  it("não confunde a casa decimal com separador no relatório de largura fixa", () => {
    /*
      A defesa que este módulo existe para ter. O 03.02.59.02 é feito de valores
      em português, e uma vírgula lida como separador partiria cada número ao
      meio e trocaria as duas colunas de lugar — sem erro nenhum na tela.
    */
    expect(separadorDe(fixtureConciliacao())).toBeNull();
    expect(separadorDe(decodificarTexto(fixturePagamento()))).toBeNull();
  });

  it("aceita a vírgula quando nenhuma vírgula do arquivo é decimal", () => {
    expect(separadorDe("a,b,c\n1,2,3\nx,y,z")).toBe(",");
  });

  it("lê o campo entre aspas com separador e quebra de linha dentro", () => {
    const { matriz, linhaFisica } = matrizDelimitada(
      'a;"b;b";c\r\n"quebra\nde linha";2;3\r\ndepois;5;6',
      ";",
    );
    expect(matriz).toEqual([
      ["a", "b;b", "c"],
      ["quebra\nde linha", "2", "3"],
      ["depois", "5", "6"],
    ]);
    /* A terceira linha do arquivo é a quarta linha física: a quebra conta. */
    expect(linhaFisica).toEqual([1, 2, 4]);
  });

  it("o caminho rápido do arquivo sem aspas dá o mesmo que o autômato", () => {
    /*
      O corte por linha e por separador só é legítimo enquanto não há aspas —
      é por isso que ele é condicional. Este caso guarda a equivalência: o
      mesmo conteúdo, com e sem um campo entre aspas que não muda nada.
    */
    const semAspas = matrizDelimitada("a;b;c\r\n1;2;3", ";");
    const comAspas = matrizDelimitada('a;b;"c"\r\n1;2;3', ";");
    expect(semAspas.matriz).toEqual(comAspas.matriz);
    expect(semAspas.linhaFisica).toEqual(comAspas.linhaFisica);
  });

  it("respeita a BOM que o Excel grava, sem sair adivinhando codificação", () => {
    expect(decodificarTexto(fixtureRequisicoesEmUtf8())).toContain("Requisição");
    expect(decodificarTexto(fixtureRequisicoes())).toContain("Requisição");
  });
});

describe("o 03.08.15 em CSV", () => {
  const daPlanilha = lerCtes(fixtureCtes());
  const doCsv = lerCtes(fixtureCtesEmCsv());

  it("lê as mesmas verbas e os mesmos valores da planilha", () => {
    expect(doCsv.recusas).toEqual([]);
    expect(doCsv.linhas.map((l) => [l.verba.vbz, l.canal, l.valorCte, l.valorFrete])).toEqual(
      daPlanilha.linhas.map((l) => [l.verba.vbz, l.canal, l.valorCte, l.valorFrete]),
    );
  });

  it("lê a data escrita em dd/mm/aaaa, que é como um CSV a escreve", () => {
    expect(doCsv.linhas.map((l) => l.dia)).toEqual(daPlanilha.linhas.map((l) => l.dia));
    expect(doCsv.linhas[0].dia).toBe("2026-07-16");
  });

  it("aponta a linha física do arquivo, contando as três de antes do cabeçalho", () => {
    expect(doCsv.linhas[0].linha).toBe(5);
  });

  it("lê igual quando o Excel regrava o mesmo CSV em UTF-8 com BOM", () => {
    const comBom = lerCtes(fixtureCtesEmCsv({ bom: true }));
    expect(comBom.linhas).toEqual(doCsv.linhas);
  });
});

describe("o 2Art em CSV", () => {
  const daPlanilha = lerOperacao(fixtureOperacao());
  const doCsv = lerOperacao(fixtureOperacaoEmCsv());
  const conta = (v: (typeof daPlanilha.linhas)[number]) => [
    v.dia, v.canal, v.frota, v.placa, v.mapa, v.entregas, v.caixasCarregadas,
    v.caixasEntregues, v.valorFrete, v.percentualDeImposto, v.valorDeImposto, v.valorFaturado,
  ];

  it("lê as mesmas viagens que a planilha, com a data escrita por extenso", () => {
    expect(doCsv.linhas.map(conta)).toEqual(daPlanilha.linhas.map(conta));
    expect(doCsv.linhas[0].dia).toBe("2026-07-16");
  });

  it("recusa a mesma viagem que a planilha recusa, e pelo mesmo motivo", () => {
    /* A recusa não pode depender do formato: o canal ilegível é do dado. */
    expect(doCsv.recusas.map((r) => r.motivo)).toEqual(daPlanilha.recusas.map((r) => r.motivo));
    expect(doCsv.recusas[0].original).toBe("Entrega?");
  });
});

describe("o 03.08.12.09 nos três formatos em que ele chega", () => {
  const doCsv = lerRequisicoes(fixtureRequisicoes());

  it("lê a planilha em que alguém salvou o CSV", () => {
    const daPlanilha = lerRequisicoes(fixtureRequisicoesEmPlanilha());
    expect(daPlanilha.linhas).toEqual(doCsv.linhas);
    expect(daPlanilha.recusas).toEqual(doCsv.recusas);
  });

  it("lê o CSV regravado em UTF-8 com o acento inteiro", () => {
    const emUtf8 = lerRequisicoes(fixtureRequisicoesEmUtf8());
    expect(emUtf8.linhas).toEqual(doCsv.linhas);
    expect(emUtf8.linhas[3].tipoDeDespesa.nome).toBe("Pedágio");
  });

  it("recusa o arquivo que não tem o cabeçalho do relatório", () => {
    expect(() => lerRequisicoes(Buffer.from("a;b;c\n1;2;3", "latin1"))).toThrow(
      CabecalhoNaoEncontrado,
    );
  });
});

describe("o 03.08.18 em CSV", () => {
  it("lê as duas frotas quando o arquivo diz de qual é cada linha", () => {
    const daPlanilha = lerDisponibilidade(fixtureDisponibilidade());
    const doCsv = lerDisponibilidade(fixtureDisponibilidadeEmCsv());
    expect(doCsv.recusas).toEqual([]);
    expect(
      doCsv.linhas.map((l) => [l.tipoDeFrota, l.dia, l.contratada, l.descontos.total]),
    ).toEqual(daPlanilha.linhas.map((l) => [l.tipoDeFrota, l.dia, l.contratada, l.descontos.total]));
  });

  it("recusa o arquivo inteiro quando nenhuma coluna diz a frota", () => {
    /*
      A van e o caminhão descontam coisas diferentes. Escolher `FF` por omissão
      daria uma conta plausível e errada — a recusa diz o que fazer no lugar.
    */
    expect(() =>
      lerDisponibilidade(fixtureDisponibilidadeEmCsv({ comTipoDeFrota: false })),
    ).toThrow(/frota FF ou da Van/);
  });
});

/**
 * O 03.08.18 lido pela casinha em que ele foi enviado.
 *
 * O relatório sai do Promax em dois arquivos, um por frota, e cada um tem a sua
 * casinha. O que se prova aqui é o corte: a casinha da FF grava caminhão, a das
 * vans grava van, e nenhuma das duas grava a frota da outra — nem quando o
 * arquivo traz as duas abas juntas.
 */
describe("o 03.08.18 recortado pela frota da casinha", () => {
  it("cada casinha lê a sua frota do arquivo que traz as duas abas", () => {
    const inteiro = lerDisponibilidade(fixtureDisponibilidade());
    const ff = lerDisponibilidade(fixtureDisponibilidade(), "FF");
    const van = lerDisponibilidade(fixtureDisponibilidade(), "VAN");

    expect(ff.linhas.every((l) => l.tipoDeFrota === "FF")).toBe(true);
    expect(van.linhas.every((l) => l.tipoDeFrota === "VAN")).toBe(true);
    /* Somadas, as duas casinhas dão o arquivo inteiro: nada se perde no corte,
       e nada entra duas vezes. */
    expect(ff.linhas.length + van.linhas.length).toBe(inteiro.linhas.length);
  });

  it("lê o arquivo de uma frota só, que é como o Promax o exporta", () => {
    const ff = lerDisponibilidade(fixtureDisponibilidadeDeUmaFrota("FF"), "FF");
    const van = lerDisponibilidade(fixtureDisponibilidadeDeUmaFrota("Van"), "VAN");

    expect(ff.linhas.map((l) => l.descontos.total)).toEqual([300, 0]);
    expect(van.linhas.map((l) => l.descontos.total)).toEqual([50]);
  });

  it("recusa o arquivo da outra frota, e diz em que casinha ele cabe", () => {
    /*
      Mandar o arquivo das vans na casinha da FF é trocar a aba de envio. Aceitá-lo
      vazio deixaria a FF "presente" sem um desconto dentro — que é pior do que a
      falta, porque a falta é nomeada e isto não seria.
    */
    expect(() =>
      lerDisponibilidade(fixtureDisponibilidadeDeUmaFrota("Van"), "FF"),
    ).toThrow(/03\.08\.18 Vans/);
    expect(() =>
      lerDisponibilidade(fixtureDisponibilidadeDeUmaFrota("FF"), "VAN"),
    ).toThrow(/03\.08\.18 FF/);
  });

  it("o CSV de uma tabela só também é recortado pela coluna da frota", () => {
    const ff = lerDisponibilidade(fixtureDisponibilidadeEmCsv(), "FF");
    const van = lerDisponibilidade(fixtureDisponibilidadeEmCsv(), "VAN");
    expect(ff.linhas.map((l) => l.tipoDeFrota)).toEqual(["FF", "FF"]);
    expect(van.linhas.map((l) => l.tipoDeFrota)).toEqual(["VAN"]);
  });
});

describe("o 03.02.59.02 delimitado", () => {
  const doTxt = lerConciliacao(fixtureConciliacao());

  it("lê as mesmas rubricas, nas mesmas colunas que o TXT", () => {
    const doCsv = lerConciliacao(fixtureConciliacaoEmCsv());
    const comparavel = (c: typeof doTxt) =>
      c.itens.map((i) => [i.secao, i.bloco, i.rubrica, i.conciliado, i.emitido, i.calculado]);
    expect(comparavel(doCsv)).toEqual(comparavel(doTxt));
  });

  it("mantém o que a coluna quer dizer: desconto no calculado, recebido no emitido", () => {
    const doCsv = lerConciliacao(fixtureConciliacaoEmCsv());
    const desconto = doCsv.itens.find((i) => i.rubrica === "Desconto Frete Minimo");
    expect(desconto).toMatchObject({ emitido: null, calculado: 200 });
    const recebidos = doCsv.itens.find((i) => i.rubrica === "CT-es Recebidos");
    expect(recebidos).toMatchObject({ emitido: 1700, calculado: null });
  });

  it("lê o cabeçalho e o aviso de rodapé como o TXT lê", () => {
    const doCsv = lerConciliacao(fixtureConciliacaoEmCsv());
    expect(doCsv.transportadora).toEqual(doTxt.transportadora);
    expect(doCsv.periodo).toEqual(doTxt.periodo);
    expect(doCsv.opcao).toBe("Sintetico");
    expect(doCsv.avisos).toEqual(doTxt.avisos);
  });

  it("acha as colunas sem o cabeçalho, quando só duas trazem valor", () => {
    const semCabecalho = lerConciliacao(fixtureConciliacaoEmCsv({ comCabecalho: false }));
    const doCsv = lerConciliacao(fixtureConciliacaoEmCsv());
    expect(semCabecalho.itens.map((i) => [i.rubrica, i.emitido, i.calculado])).toEqual(
      doCsv.itens.map((i) => [i.rubrica, i.emitido, i.calculado]),
    );
  });

  it("não confia num cabeçalho que aponta para colunas vazias", () => {
    /*
      O cabeçalho é a primeira via, e não a única: se ele apontar para colunas
      onde não há valor, seguir por ele daria um relatório inteiro lido em
      branco — sem erro, sem recusa e sem número. A evidência de onde o
      dinheiro está manda sobre o rótulo.
    */
    const cabecalhoTorto = Buffer.from(
      [
        "Rubrica;(Emitido);(Calculado);R$ CT-e;R$ SRTrans",
        "Frota Fixa;;;1.000,00;900,00",
        "Freteiro;;;500,00;450,00",
      ].join("\r\n"),
      "latin1",
    );
    const lido = lerConciliacao(cabecalhoTorto);
    expect(lido.itens.map((i) => [i.rubrica, i.emitido, i.calculado])).toEqual([
      ["Frota Fixa", 1000, 900],
      ["Freteiro", 500, 450],
    ]);
  });

  it("recusa quando não dá para saber qual coluna é qual", () => {
    /*
      Uma coluna de valor só: não há como dizer se aquilo é emitido ou
      calculado, e as duas leituras levam a conversas opostas com a Ambev.
    */
    const ambiguo = Buffer.from(
      ["Rubrica;Valor", "Frota Fixa;1.000,00", "Freteiro;500,00"].join("\r\n"),
      "latin1",
    );
    expect(() => lerConciliacao(ambiguo)).toThrow(/emitido/);
  });
});

describe("o 03.08.20 delimitado", () => {
  const doTxt = lerPagamento(fixturePagamento());
  const doCsv = lerPagamento(fixturePagamentoEmCsv());

  it("lê as seis colunas de cada verba como o TXT lê", () => {
    expect(
      doCsv.itens.map((i) => [i.verba.vbz, i.canal, i.bloco, i.semImposto, i.ctrcIcms, i.vlcCtrcIcms]),
    ).toEqual(
      doTxt.itens.map((i) => [i.verba.vbz, i.canal, i.bloco, i.semImposto, i.ctrcIcms, i.vlcCtrcIcms]),
    );
  });

  it("lê o período que o arquivo declara, que é o que trava a competência errada", () => {
    expect(doCsv.periodo).toEqual(doTxt.periodo);
  });

  it("lê os descontos, com o rótulo que diz de qual VBZ eles já saíram", () => {
    expect(doCsv.descontos.map((d) => [d.tipo, d.canal, d.valor])).toEqual(
      doTxt.descontos.map((d) => [d.tipo, d.canal, d.valor]),
    );
  });

  it("lê o total que o relatório fecha", () => {
    expect(doCsv.totais).toEqual(doTxt.totais);
  });
});

describe("o arquivo enviado na fonte errada", () => {
  it("diz que o texto não tem colunas, em vez de falar de cabeçalho", () => {
    /* O 03.08.20 (largura fixa) enviado na aba do 03.08.15 (tabular). */
    expect(() => lerCtes(fixturePagamento())).toThrow(TabelaNaoDelimitada);
  });
});
