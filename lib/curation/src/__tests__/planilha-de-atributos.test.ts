import { describe, expect, it } from "vitest";
import {
  conferirPreenchimento,
  montarLinhas,
  normalizarEquipamento,
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

/**
 * Uma categoria como o servidor a entrega: o caminho, e ele já partido nos dois
 * níveis. Parte aqui do caminho pela mesma razão que `listarCategorias` parte da
 * árvore — sintético e analítico são duas alturas de uma coisa só, e escrevê-los
 * à mão nos testes deixaria passar um par que a produção nunca produz.
 */
const categoria = (code: string, caminho: string) => {
  const [sintetico, ...resto] = caminho.split("›").map((parte) => parte.trim());
  return { code, caminho, sintetico, analitico: resto.join(" › ") };
};

const catalogos = {
  categorias: [
    categoria("cf_seguros", "Custo Fixo › Seguros e tributos"),
    categoria("cv_pneus", "Custo Variável › Pneus"),
    // O nome da classe na base tem parênteses, e isso não é detalhe: é o que
    // volta escrito no arquivo exportado.
    categoria("cad_escopo", "Cadastral (não remuneratório) › Escopo organizacional"),
    categoria("cad_contrato", "Cadastral (não remuneratório) › Contrato e vigência"),
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
      categoriaSintetica: "",
      categoriaAnalitica: "",
    });
    expect(carreta).toMatchObject({
      definition: "Seguro contratado para o implemento.",
      categoriaSintetica: "Custo Fixo",
      categoriaAnalitica: "Seguros e tributos",
    });
  });

  it("escreve a categoria em nome de negócio, e não no caminho técnico", () => {
    const [, carreta] = montarLinhas(base, catalogos);
    expect(carreta.categoriaSintetica).not.toContain("cf_seguros");
    expect(carreta.categoriaAnalitica).not.toContain("cf_seguros");
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
    expect(linhas[0].problemas[0]).toMatch(/é o mesmo que não classificar/);
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
        categoria("cf_seguros", "Custo Fixo › Seguros"),
        categoria("cv_seguros", "Custo Variável › Seguros"),
      ],
    });
    expect(linhas[0].problemas[0]).toMatch(/mais de uma categoria/);
  });

  /*
    Os dois níveis, e por que a coluna do sintético existe.

    Sozinho, "Seguros" em dois galhos é uma pergunta de verdade, e a planilha de
    uma coluna só respondia "escreva o caminho inteiro" — cobrando uma sintaxe
    com `›` que ninguém digita. Com a classe ao lado, a mesma pergunta é
    respondida por duas listas suspensas.
  */
  describe("sintético e analítico", () => {
    const homonimas = {
      categorias: [
        categoria("cf_seguros", "Custo Fixo › Seguros"),
        categoria("cv_seguros", "Custo Variável › Seguros"),
      ],
    };

    it("desambigua pelo sintético o que sozinho seria ambíguo", () => {
      const { linhas } = conferirPreenchimento(
        [
          linha({
            categoriaSintetica: "Custo Variável",
            categoriaAnalitica: "Seguros",
          }),
        ],
        base,
        homonimas,
      );
      expect(linhas[0].problemas).toEqual([]);
      expect(linhas[0].mudancas[0]).toMatchObject({
        campo: "categoria",
        codigo: "cv_seguros",
        para: "Custo Variável › Seguros",
      });
    });

    it("grava uma mudança só, e ela vale pelo caminho inteiro", () => {
      const { linhas, resumo } = conferirPreenchimento(
        [
          linha({
            categoriaSintetica: "Custo Variável",
            categoriaAnalitica: "Pneus",
          }),
        ],
        base,
        catalogos,
      );
      // Duas colunas no arquivo, um campo gravado: o que se guarda é o nó em
      // que o caminho termina.
      expect(linhas[0].mudancas).toHaveLength(1);
      expect(resumo).toMatchObject({ mudam: 1, campos: 1 });
    });

    it("recusa o par que não existe, e diz onde o analítico mora de verdade", () => {
      const { linhas } = conferirPreenchimento(
        [
          linha({
            categoriaSintetica: "Custo Fixo",
            categoriaAnalitica: "Pneus",
          }),
        ],
        base,
        catalogos,
      );
      expect(linhas[0].mudancas).toEqual([]);
      expect(linhas[0].problemas[0]).toMatch(/não fica em "Custo Fixo"/);
      expect(linhas[0].problemas[0]).toMatch(/Custo Variável › Pneus/);
    });

    /*
      Aceitar o analítico e ignorar em silêncio um sintético que ninguém
      entendeu seria gravar metade de uma resposta — e a metade ignorada é
      justamente a que nomeia a linha da DRE.
    */
    it("recusa sintético fora da lista mesmo quando o analítico resolveria", () => {
      const { linhas } = conferirPreenchimento(
        [
          linha({
            categoriaSintetica: "Resultado financeiro",
            categoriaAnalitica: "Pneus",
          }),
        ],
        base,
        catalogos,
      );
      expect(linhas[0].mudancas).toEqual([]);
      expect(linhas[0].problemas[0]).toMatch(/não é uma das linhas da DRE/);
      expect(linhas[0].problemas[0]).toMatch(/Custo Fixo/);
    });

    it("sintético sozinho não classifica, e devolve o que existe dentro dele", () => {
      const { linhas } = conferirPreenchimento(
        [linha({ categoriaSintetica: "Custo Variável" })],
        base,
        catalogos,
      );
      expect(linhas[0].mudancas).toEqual([]);
      expect(linhas[0].problemas[0]).toMatch(/é o mesmo que não classificar/);
      expect(linhas[0].problemas[0]).toMatch(/Pneus/);
    });

    it("aceita o analítico sozinho quando ele é único", () => {
      const { linhas } = conferirPreenchimento(
        [linha({ categoriaAnalitica: "Pneus" })],
        base,
        catalogos,
      );
      expect(linhas[0].problemas).toEqual([]);
      expect(linhas[0].mudancas[0]).toMatchObject({ codigo: "cv_pneus" });
    });

    /*
      O modelo de uma coluna só saiu por e-mail antes desta mudança. Um arquivo
      daqueles que volta preenchido é trabalho feito, e recusá-lo pelo cabeçalho
      seria jogá-lo fora.
    */
    it("ainda lê o arquivo antigo, de uma coluna só", () => {
      const { linhas } = conferirPreenchimento(
        [linha({ categoria: "Custo Variável › Pneus" })],
        base,
        catalogos,
      );
      expect(linhas[0].problemas).toEqual([]);
      expect(linhas[0].mudancas[0]).toMatchObject({ codigo: "cv_pneus" });
    });

    it("a coluna nova ganha da antiga quando as duas vêm no mesmo arquivo", () => {
      const { linhas } = conferirPreenchimento(
        [
          linha({
            categoriaSintetica: "Custo Variável",
            categoriaAnalitica: "Pneus",
            categoria: "Custo Fixo › Seguros e tributos",
          }),
        ],
        base,
        catalogos,
      );
      expect(linhas[0].mudancas[0]).toMatchObject({ codigo: "cv_pneus" });
    });
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

/**
 * O normalizador do recorte, agora que ele atravessa a rede.
 *
 * A tela põe a aba aberta em `?equipamento=` e o servidor decide por ela que
 * abas escrever no arquivo. As duas pontas leem esta função — é o que impede um
 * arquivo vazio de significar "a tela e o servidor discordam sobre o que é
 * `cavalo`" em vez de "não há atributo de cavalo".
 */
describe("normalizarEquipamento", () => {
  it("lê o tipo como a base o guarda, venha como vier do endereço", () => {
    expect(normalizarEquipamento("cavalo")).toBe("CAVALO");
    expect(normalizarEquipamento(" Carreta ")).toBe("CARRETA");
    expect(normalizarEquipamento("TRECHO")).toBe("TRECHO");
  });

  it('trata ausência e vazio como "todos", e não como um tipo inexistente', () => {
    // Um endereço truncado baixa o arquivo inteiro. A alternativa seria um 404
    // dizendo que não há atributo de "" nesta base.
    expect(normalizarEquipamento(null)).toBeNull();
    expect(normalizarEquipamento(undefined)).toBeNull();
    expect(normalizarEquipamento("")).toBeNull();
    expect(normalizarEquipamento("   ")).toBeNull();
  });
});
