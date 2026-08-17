import { describe, expect, it } from "vitest";
import {
  conferirPreenchimento,
  montarLinhas,
  type AtributoDoModelo,
  type LinhaPreenchida,
} from "../planilha-de-atributos";

/**
 * A planilha de atributos promete três coisas, e são as três que este arquivo
 * guarda:
 *
 * 1. **Célula em branco não apaga.** É a promessa que sustenta o round-trip:
 *    quem preenche 12 de 121 linhas devolve 109 células vazias, e lê-las como
 *    "apague" faria um arquivo pela metade destruir o trabalho da tela.
 * 2. **Não cria coluna.** Código que a base não tem é linha ignorada com o
 *    motivo escrito, nunca atributo novo — atributo nasce de dado importado.
 * 3. **Valor fora do catálogo não entra.** Nem como texto solto no lugar do
 *    código: significado e categoria casam contra o cadastro, e o que não casar
 *    volta para quem preencheu em vez de virar uma classificação inventada.
 */

const base: AtributoDoModelo[] = [
  {
    code: "cavalo.seguro",
    sourceName: "seguro",
    entityType: "CAVALO",
    semanticsStatus: "PRESUMED",
    valueCount: 558,
    displayName: "Seguro do cavalo",
    definition: null,
    calculationBasis: null,
    meaningCode: null,
    taxonomyCode: null,
  },
  {
    code: "carreta.seguro",
    sourceName: "seguro",
    entityType: "CARRETA",
    semanticsStatus: "CONFIRMED",
    valueCount: 720,
    displayName: null,
    definition: "Seguro contratado para o implemento.",
    calculationBasis: null,
    meaningCode: "brl_mes",
    taxonomyCode: "cf_seguros",
  },
];

const catalogos = {
  significados: [
    { code: "brl_mes", label: "R$ por mês" },
    { code: "brl_km", label: "R$ por km" },
  ],
  categorias: [
    { code: "cf_seguros", caminho: "Custo Fixo › Seguros" },
    { code: "cv_manutencao", caminho: "Custo Variável › Manutenção" },
  ],
};

const linha = (parcial: Partial<LinhaPreenchida>): LinhaPreenchida => ({
  aba: "Cavalo",
  linha: 2,
  code: "cavalo.seguro",
  ...parcial,
});

describe("montarLinhas", () => {
  it("sai preenchida com o que a base já sabe — a planilha é ida e volta", () => {
    const [cavalo, carreta] = montarLinhas(base, catalogos);
    expect(cavalo.displayName).toBe("Seguro do cavalo");
    expect(carreta.definition).toBe("Seguro contratado para o implemento.");
    expect(carreta.significado).toBe("R$ por mês");
    expect(carreta.categoria).toBe("Custo Fixo › Seguros");
  });

  it("escreve o status em português, e o campo vazio como texto vazio", () => {
    const [cavalo, carreta] = montarLinhas(base, catalogos);
    expect(cavalo.status).toBe("Presumido");
    expect(carreta.status).toBe("Confirmado");
    expect(cavalo.definition).toBe("");
  });

  it("avisa que a mesma coluna existe no outro equipamento", () => {
    const [cavalo, carreta] = montarLinhas(base, catalogos);
    expect(cavalo.tambemEm).toBe("CARRETA");
    expect(carreta.tambemEm).toBe("CAVALO");
  });
});

describe("conferirPreenchimento", () => {
  it("grava o que voltou escrito", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [linha({ definition: "Seguro do cavalo mecânico, por apólice anual." })],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("MUDA");
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

  it("recusa criar coluna que a base não tem, e diz por quê", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [linha({ code: "trecho.pedagio", definition: "Pedágio do trecho." })],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("SEM_ATRIBUTO");
    expect(linhas[0].mudancas).toEqual([]);
    expect(linhas[0].problemas[0]).toMatch(/não existe nesta base/);
    expect(resumo.ignoradas).toBe(1);
  });

  it("linha preenchida sem código é erro de quem preencheu, não linha em branco", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ code: "", definition: "Alguma coisa." })],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("SEM_CODIGO");
  });

  it("casa o significado pelo rótulo, sem se importar com acento e caixa", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ significado: "r$ POR MÊS" })],
      base,
      catalogos,
    );
    expect(linhas[0].mudancas).toEqual([
      { campo: "significado", de: null, para: "R$ por mês", codigo: "brl_mes" },
    ]);
  });

  it("recusa significado que não está no catálogo", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ significado: "R$ por viagem" })],
      base,
      catalogos,
    );
    expect(linhas[0].mudancas).toEqual([]);
    expect(linhas[0].problemas[0]).toMatch(/catálogo de significados/);
  });

  /*
    O caso que a primeira volta de um arquivo real produziu: categoria digitada
    à mão, os outros três campos escritos com cuidado. A célula errada não pode
    levar os três junto — se levar, quem preencheu preenche tudo de novo.
  */
  it("a célula fora do catálogo não derruba o resto da linha", () => {
    const { linhas, resumo } = conferirPreenchimento(
      [
        linha({
          definition: "Seguro do cavalo mecânico.",
          calculationBasis: "Apólice anual rateada.",
          categoria: "Lucro",
        }),
      ],
      base,
      catalogos,
    );
    expect(linhas[0].desfecho).toBe("MUDA");
    expect(linhas[0].mudancas.map((m) => m.campo)).toEqual([
      "definition",
      "calculationBasis",
    ]);
    expect(linhas[0].problemas[0]).toMatch(/Categoria/);
    expect(resumo).toMatchObject({ mudam: 1, campos: 2, naoEntendidas: 1 });
  });

  it("aceita a categoria pela folha quando ela é única", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "Manutenção" })],
      base,
      catalogos,
    );
    expect(linhas[0].mudancas).toEqual([
      {
        campo: "categoria",
        de: null,
        para: "Custo Variável › Manutenção",
        codigo: "cv_manutencao",
      },
    ]);
  });

  it("não adivinha entre duas categorias de mesmo nome", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ categoria: "Seguros" })],
      base,
      {
        ...catalogos,
        categorias: [
          { code: "cf_seguros", caminho: "Custo Fixo › Seguros" },
          { code: "cv_seguros", caminho: "Custo Variável › Seguros" },
        ],
      },
    );
    expect(linhas[0].mudancas).toEqual([]);
    expect(linhas[0].problemas[0]).toMatch(/mais de uma categoria/);
  });

  it("conta campos, e não linhas, no número que a prévia mostra", () => {
    const { resumo } = conferirPreenchimento(
      [
        linha({
          definition: "Seguro do cavalo.",
          calculationBasis: "1% do valor da nota.",
          significado: "R$ por mês",
        }),
        linha({ aba: "Carreta", linha: 2, code: "carreta.seguro", displayName: "Seguro" }),
      ],
      base,
      catalogos,
    );
    expect(resumo).toEqual({
      mudam: 2,
      campos: 4,
      iguais: 0,
      ignoradas: 0,
      naoEntendidas: 0,
    });
  });

  it("aponta a aba e a linha do problema — o arquivo tem várias abas", () => {
    const { linhas } = conferirPreenchimento(
      [linha({ aba: "Trecho", linha: 47, code: "trecho.km", definition: "Km." })],
      base,
      catalogos,
    );
    expect(linhas[0]).toMatchObject({ aba: "Trecho", linha: 47, desfecho: "SEM_ATRIBUTO" });
  });
});
