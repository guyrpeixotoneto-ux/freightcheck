import { describe, expect, it } from "vitest";
import {
  conferirPreenchimento,
  montarLinhas,
  type AtributoDoModelo,
  type LinhaPreenchida,
} from "../planilha-de-atributos";

/**
 * A planilha de atributos tem quatro colunas, e as três promessas que este
 * arquivo guarda vêm justamente de ela ser tão curta:
 *
 * 1. **A chave é o par aba + atributo.** Sem a coluna de código, é o nome de
 *    origem dentro da aba do equipamento que diz de que coluna a linha fala —
 *    e `seguro`, que existe no cavalo e na carreta, não pode casar com um dos
 *    dois por sorteio.
 * 2. **Célula em branco não apaga.** Quem preenche 12 de 121 linhas devolve 109
 *    vazias, e lê-las como "apague" faria um arquivo pela metade destruir o
 *    trabalho da tela.
 * 3. **Não cria coluna.** Nome que a base não tem é linha ignorada com o motivo
 *    escrito — inclusive o motivo que ninguém adivinha, que é a coluna de chave
 *    (vigência, placa) não virar atributo.
 */

const base: AtributoDoModelo[] = [
  {
    code: "cavalo.seguro",
    sourceName: "seguro",
    entityType: "CAVALO",
    semanticsStatus: "PRESUMED",
    displayName: "Seguro do cavalo",
    definition: null,
    taxonomyCode: null,
  },
  {
    code: "carreta.seguro",
    sourceName: "seguro",
    entityType: "CARRETA",
    semanticsStatus: "PRESUMED",
    displayName: null,
    definition: "Seguro contratado para o implemento.",
    taxonomyCode: "cf_seguros",
  },
  {
    code: "cavalo.valor_pneu",
    sourceName: "valorPneu",
    entityType: "CAVALO",
    semanticsStatus: "PRESUMED",
    displayName: null,
    definition: null,
    taxonomyCode: null,
  },
];

const catalogos = {
  categorias: [
    { code: "cf_seguros", caminho: "Custo Fixo › Seguros e tributos" },
    { code: "cv_pneus", caminho: "Custo Variável › Pneus" },
    // O nome da classe na base tem parênteses, e isso não é detalhe: é o que
    // volta escrito no arquivo exportado.
    { code: "cad_escopo", caminho: "Cadastral (não remuneratório) › Escopo organizacional" },
    { code: "cad_contrato", caminho: "Cadastral (não remuneratório) › Contrato e vigência" },
  ],
};

const linha = (parcial: Partial<LinhaPreenchida>): LinhaPreenchida => ({
  aba: "Cavalo",
  linha: 2,
  atributo: "seguro",
  ...parcial,
});

describe("montarLinhas", () => {
  it("sai preenchida com o que a base já sabe — a planilha é ida e volta", () => {
    const [cavalo, carreta] = montarLinhas(base, catalogos);
    expect(cavalo).toMatchObject({
      atributo: "seguro",
      entityType: "CAVALO",
      displayName: "Seguro do cavalo",
      definition: "",
      categoria: "",
    });
    expect(carreta).toMatchObject({
      definition: "Seguro contratado para o implemento.",
      categoria: "Custo Fixo › Seguros e tributos",
    });
  });

  it("escreve a categoria em nome de negócio, e não no caminho técnico", () => {
    const [, carreta] = montarLinhas(base, catalogos);
    expect(carreta.categoria).not.toContain("cf_seguros");
  });
});

describe("conferirPreenchimento", () => {
  it("casa pela aba e pelo nome de origem, e grava o que voltou escrito", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [linha({ definition: "Seguro do cavalo mecânico, por apólice anual." })],
      base,
      catalogos,
    );
    expect(linhas[0]).toMatchObject({ code: "cavalo.seguro", desfecho: "MUDA" });
    expect(linhas[0].mudancas).toEqual([
      {
        campo: "definition",
        de: null,
        para: "Seguro do cavalo mecânico, por apólice anual.",
      },
    ]);
    expect(resumo).toEqual({
      mudam: 1,
      campos: 1,
      iguais: 0,
      ignoradas: 0,
      naoEntendidas: 0,
    });
  });

  it("a aba decide qual dos homônimos é — cavalo e carreta têm o mesmo `seguro`", () => {
    const { linhas } = conferirPreenchimento(
      [
        linha({ aba: "Cavalo", definition: "Do cavalo." }),
        linha({ aba: "Carreta", linha: 2, definition: "Do implemento." }),
      ],
      base,
      catalogos,
    );
    expect(linhas.map((l) => l.code)).toEqual(["cavalo.seguro", "carreta.seguro"]);
  });

  it("sem aba reconhecível, o nome único ainda casa", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ aba: "Planilha1", atributo: "valorPneu", definition: "Preço do pneu." })],
      base,
      catalogos,
    );
    expect(linhas[0]).toMatchObject({ code: "cavalo.valor_pneu", desfecho: "MUDA" });
  });

  it("sem aba reconhecível, o nome repetido não é sorteado", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ aba: "Planilha1", atributo: "seguro", definition: "Algum seguro." })],
      base,
      catalogos,
    );
    expect(linhas[0]).toMatchObject({ desfecho: "AMBIGUO", code: null });
    expect(linhas[0].problemas[0]).toMatch(/CAVALO e CARRETA/);
  });

  it("célula em branco não apaga o que está gravado", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [linha({ displayName: "", definition: undefined })],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("IGUAL");
    expect(linhas[0].mudancas).toEqual([]);
    expect(resumo.mudam).toBe(0);
  });

  it("texto igual ao gravado não vira mudança — o modelo volta preenchido", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ displayName: "  Seguro do cavalo  " })],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("IGUAL");
  });

  it("recusa criar coluna que a base não tem, e explica a coluna de chave", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [linha({ atributo: "Vigencia", displayName: "Quinzena" })],
      base,
      catalogos,
    );
    expect(linhas[0]).toMatchObject({ desfecho: "SEM_ATRIBUTO", code: null });
    expect(linhas[0].problemas[0]).toMatch(/não cria coluna/);
    expect(linhas[0].problemas[0]).toMatch(/vigência, placa/);
    expect(resumo.ignoradas).toBe(1);
  });

  it("linha preenchida sem atributo é erro de quem preencheu, não linha em branco", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ atributo: "", definition: "Alguma coisa." })],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("SEM_ATRIBUTO_NA_LINHA");
  });

  it("casa a categoria pelo caminho, sem se importar com acento e caixa", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "custo fixo › SEGUROS E TRIBUTOS" })],
      base,
      catalogos,
    );
    expect(linhas[0].mudancas).toEqual([
      {
        campo: "categoria",
        de: null,
        para: "Custo Fixo › Seguros e tributos",
        codigo: "cf_seguros",
      },
    ]);
  });

  it("aceita a categoria pela folha quando ela é única", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "Pneus" })],
      base,
      catalogos,
    );
    expect(linhas[0].mudancas[0]).toMatchObject({ codigo: "cv_pneus" });
  });

  /*
    A lista que já existe escrita nomeia a classe, com a explicação entre
    parênteses: "Cadastral (não entra na DRE)". O parêntese é para quem lê, e
    "Cadastral" é um galho inteiro — responder "não está no catálogo" a quem
    escreveu o nome de um galho que existe é inútil.
  */
  it("a classe não classifica, e a recusa devolve as opções do galho", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "Cadastral (não entra na DRE)" })],
      base,
      catalogos,
    );
    expect(linhas[0].mudancas).toEqual([]);
    expect(linhas[0].problemas[0]).toMatch(/é uma classe inteira/);
    expect(linhas[0].problemas[0]).toMatch(/Escopo organizacional/);
    expect(linhas[0].problemas[0]).toMatch(/Contrato e vigência/);
  });

  /*
    O defeito que apareceu rodando o ciclo contra a base real: a classe se chama
    "Cadastral (não remuneratório)", parênteses inclusos, e o caminho que o
    próprio arquivo exporta os carrega. Limpar os parênteses antes de comparar
    fazia a planilha recusar 68 categorias que ela mesma tinha escrito.
  */
  it("aceita de volta o caminho que ela mesma exportou, parênteses e tudo", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "Cadastral (não remuneratório) › Contrato e vigência" })],
      base,
      catalogos,
    );
    expect(linhas[0].problemas).toEqual([]);
    expect(linhas[0].mudancas[0]).toMatchObject({ codigo: "cad_contrato" });
  });

  it("recusa categoria que não existe em lugar nenhum", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "Lucro" })],
      base,
      catalogos,
    );
    expect(linhas[0].problemas[0]).toMatch(/não está no catálogo/);
  });

  it("não adivinha entre duas folhas de mesmo nome", () => {
    const { linhas } = conferirPreenchimento([linha({ categoria: "Seguros" })], base, {
      categorias: [
        { code: "cf_seguros", caminho: "Custo Fixo › Seguros" },
        { code: "cv_seguros", caminho: "Custo Variável › Seguros" },
      ],
    });
    expect(linhas[0].problemas[0]).toMatch(/mais de uma categoria/);
  });

  /*
    O caso que a primeira volta de um arquivo real produziu: categoria digitada
    à mão, os outros campos escritos com cuidado. A célula errada não pode levar
    os outros junto — se levar, quem preencheu preenche tudo de novo.
  */
  it("a célula fora do catálogo não derruba o resto da linha", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [
        linha({
          displayName: "Seguro",
          definition: "Seguro do cavalo mecânico.",
          categoria: "Lucro",
        }),
      ],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("MUDA");
    expect(linhas[0].mudancas.map((m) => m.campo)).toEqual([
      "displayName",
      "definition",
    ]);
    expect(resumo).toMatchObject({ mudam: 1, campos: 2, naoEntendidas: 1 });
  });

  it("conta campos, e não linhas, no número que a prévia mostra", () => {
    const { resumo } = conferirPreenchimento(
      [
        linha({
          displayName: "Seguro",
          definition: "Seguro do cavalo.",
          categoria: "Pneus",
        }),
        linha({ aba: "Carreta", atributo: "seguro", displayName: "Seguro da carreta" }),
      ],
      base,
      catalogos,
    );
    expect(resumo).toMatchObject({ mudam: 2, campos: 4 });
  });

  /*
    A categoria decide em que linha da DRE o número cai, e num atributo
    confirmado isso já foi assinado por alguém. Uma planilha que voltou por
    e-mail não desfaz uma assinatura — e a recusa é só da categoria: nome e
    descrição continuam entrando, porque prosa não move dinheiro.
  */
  it("não troca a Categoria DRE de um atributo já confirmado", () => {
    const confirmado: AtributoDoModelo[] = [
      { ...base[0], semanticsStatus: "CONFIRMED", taxonomyCode: "cf_seguros" },
    ];
    const { linhas } = conferirPreenchimento(
      [
        linha({
          displayName: "Seguro do cavalo mecânico",
          categoria: "Custo Variável › Pneus",
        }),
      ],
      confirmado,
      catalogos,
    );
    expect(linhas[0].mudancas.map((m) => m.campo)).toEqual(["displayName"]);
    expect(linhas[0].problemas[0]).toMatch(/já está confirmado/);
    expect(linhas[0].problemas[0]).toMatch(/justificativa assinada/);
  });

  it("aponta a aba e a linha do problema — o arquivo tem várias abas", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ aba: "Trecho", linha: 47, atributo: "pedagio", definition: "Pedágio." })],
      base,
      catalogos,
    );
    expect(linhas[0]).toMatchObject({
      aba: "Trecho",
      linha: 47,
      desfecho: "SEM_ATRIBUTO",
    });
  });
});
