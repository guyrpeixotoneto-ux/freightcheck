import { describe, expect, it } from "vitest";
import {
  codigoDe,
  COMO_ESCREVER,
  derivarSemantica,
  interpretarRotulo,
  lerSignificado,
  normalizarRotulo,
  periodoEmAberto,
  procurarProximos,
  semelhanca,
  significadoPara,
  SIGNIFICADOS_PADRAO,
  unidadeDeTaxa,
} from "../significado";
import { baseQueFalta, ehRazao, podeSomar, viraDinheiro } from "../agregacao";

/**
 * A autoridade semântica, sozinha.
 *
 * Nenhum destes testes toca banco, e é essa pureza que sustenta o desenho: a
 * tela, a API e a migration consultam a mesma função, e se ela precisasse de
 * uma conexão nenhuma das três poderia. O arquivo irmão em `catalogo.test.ts`
 * prova que elas de fato consultam.
 */

const de = (rotulo: string) => {
  const lido = interpretarRotulo(rotulo);
  if (!lido) throw new Error(`"${rotulo}" não foi interpretado`);
  return lido;
};

describe("a derivação — o significado vira campo técnico", () => {
  it("R$ por mês é montante mensal e somável na frota", () => {
    expect(derivarSemantica(de("R$ por mês"))).toMatchObject({
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      currency: "BRL",
      valueKind: "AMOUNT",
    });
  });

  it("R$ por ano é montante anual — e não é dividido por doze", () => {
    expect(derivarSemantica(de("R$ por ano"))).toMatchObject({
      periodicity: "ANUAL",
      aggregation: "SUM",
      isMonetary: true,
    });
  });

  it("Valor total em R$ é grandeza de aquisição, não fluxo periódico", () => {
    // É a semântica com que `valorNfCompra` foi confirmada em 10/08/2026, e a
    // gaveta AQUISICAO existe justamente para o preço do caminhão não entrar na
    // conta do mês.
    expect(derivarSemantica(de("Valor total em R$")).periodicity).toBe("PONTUAL");
  });

  it.each([
    ["R$ por litro", "BRL_LITRO", "LITRO"],
    ["R$ por km", "BRL_KM", "KM"],
    ["R$ por viagem", "BRL_VIAGEM", "VIAGEM"],
    ["R$ por hora", "BRL_HORA", "HORA"],
  ])("%s é taxa: unidade %s, sem periodicidade e sem soma", (rotulo, unit, base) => {
    expect(derivarSemantica(de(rotulo))).toMatchObject({
      unit,
      periodicity: null,
      aggregation: "NONE",
      isMonetary: false,
      valueKind: "RATE",
      denominator: base,
    });
  });

  it("R$/km continua produzindo a unidade que nove meses de dados já usam", () => {
    // Uma unidade nova para a mesma coisa faria a comparação entre vigências
    // enxergar mudança de semântica onde não houve nenhuma.
    expect(unidadeDeTaxa("KM")).toBe("BRL_KM");
  });

  it("percentual e consumo não são montante nem admitem soma", () => {
    expect(derivarSemantica(de("Percentual"))).toMatchObject({
      unit: "PERCENT",
      aggregation: "NONE",
      isMonetary: false,
    });
    expect(derivarSemantica(de("Quilômetros por litro"))).toMatchObject({
      unit: "KM_L",
      aggregation: "NONE",
      isMonetary: false,
    });
  });

  it("grandezas físicas descrevem a frota pela média, nunca pela soma", () => {
    // Somar "meses de vida útil" de 62 cavalos não descreve nada.
    for (const rotulo of ["Meses", "Litros", "Quilômetros", "Quantidade"]) {
      expect(derivarSemantica(de(rotulo)).aggregation).toBe("AVG");
    }
  });

  it("todo significado do catálogo padrão é coerente com a autoridade de agregação", () => {
    // A ponte entre os dois módulos: nenhum significado pode derivar um estado
    // que `coerenciaDaSemantica` — e a constraint que a espelha — recusaria.
    for (const significado of SIGNIFICADOS_PADRAO) {
      const d = derivarSemantica(significado);
      if (d.aggregation === "SUM") {
        expect(ehRazao(d.unit), `${significado.code} soma uma razão`).toBe(false);
      }
      if (d.isMonetary === true) {
        expect(d.unit, `${significado.code} é monetário fora de BRL`).toBe("BRL");
      }
    }
  });
});

describe("a agregação é consequência, e a taxa nunca é o montante", () => {
  const semantica = (rotulo: string) => {
    const d = derivarSemantica(de(rotulo));
    return {
      unit: d.unit,
      aggregation: d.aggregation,
      isMonetary: d.isMonetary,
      semanticsStatus: "CONFIRMED",
      dataType: "NUMERIC",
    };
  };

  it("R$ 0,42/km não vira R$ 42/km somando 100 cavalos", () => {
    const veredito = podeSomar(semantica("R$ por km"));
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("razão");
    expect(viraDinheiro(semantica("R$ por km")).ok).toBe(false);
  });

  it("R$/litro também não soma — e o cadastro dela é novo, não previsto à mão", () => {
    // A diferença que a regra por prefixo compra: `BRL_LITRO` não existia
    // quando a lista de razões foi escrita, e mesmo assim não soma.
    expect(ehRazao("BRL_LITRO")).toBe(true);
    const veredito = podeSomar(semantica("R$ por litro"));
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("razão");
  });

  it("uma taxa diz o que faltaria para virar dinheiro, e não só que não dá", () => {
    expect(baseQueFalta(semantica("R$ por km"))).toContain("quilometragem rodada");
    // Base cadastrada depois: a frase é montada, mas continua existindo — dizer
    // `null` faria a composição classificar a lacuna como "não é montante".
    expect(baseQueFalta(semantica("R$ por viagem"))).toContain("viagem");
  });

  it("montante por veículo é somável, e é o que produz o total da frota", () => {
    expect(podeSomar(semantica("R$ por mês")).ok).toBe(true);
    expect(viraDinheiro(semantica("R$ por mês")).ok).toBe(true);
  });

  it("mesmo somável, o montante só vira dinheiro depois da confirmação humana", () => {
    const presumido = { ...semantica("R$ por mês"), semanticsStatus: "PRESUMED" };
    expect(podeSomar(presumido).ok).toBe(true);
    expect(viraDinheiro(presumido).ok).toBe(false);
  });

  it("a leitura em português diz a mesma coisa que os campos", () => {
    const taxa = lerSignificado(de("R$ por litro"));
    expect(taxa.agregacao).toMatch(/não se somam/i);
    expect(lerSignificado(de("R$ por mês")).agregacao).toMatch(/se somam/i);
  });
});

describe("interpretar o que a pessoa digitou", () => {
  it.each([
    ["R$ por litro", "taxa_litro"],
    ["R$/litro", "taxa_litro"],
    ["r$ / litros", "taxa_litro"],
    ["reais por litro", "taxa_litro"],
    ["R$ por Litro", "taxa_litro"],
  ])("%s é sempre o mesmo significado econômico", (rotulo, code) => {
    // O código canônico vem de forma + base, e não do texto. É o que impede o
    // cadastro de ganhar cinco linhas para a mesma economia.
    expect(de(rotulo).code).toBe(code);
  });

  it("uma base que ninguém previu é aceita como a operação a escreve", () => {
    const pallet = de("R$ por pallet");
    expect(pallet.forma).toBe("TAXA");
    expect(pallet.base).toBe("PALLET");
    expect(derivarSemantica(pallet).unit).toBe("BRL_PALLET");
  });

  it("o plural não cria um segundo cadastro", () => {
    expect(de("R$ por viagens").code).toBe(de("R$ por viagem").code);
    expect(de("R$ por pallets").code).toBe(de("R$ por pallet").code);
  });

  it("período e base não se confundem", () => {
    // "R$ por mês" é montante que se acumula; "R$ por hora" é preço. A leitura
    // errada aqui é a diferença entre entrar e não entrar no total mensal.
    expect(de("R$ por mês").forma).toBe("MONTANTE");
    expect(de("R$ por hora").forma).toBe("TAXA");
    // E "Meses" sozinho é grandeza física, não dinheiro nenhum.
    expect(de("Meses").forma).toBe("GRANDEZA");
  });

  it("devolve null para o que não sabe traduzir, com o formato ensinado", () => {
    expect(interpretarRotulo("por litro")).toBeNull();
    expect(interpretarRotulo("xyzzy")).toBeNull();
    expect(interpretarRotulo("   ")).toBeNull();
    expect(COMO_ESCREVER).toContain("R$ por litro");
  });

  it("todo rótulo do catálogo padrão volta a ser ele mesmo", () => {
    // Se um rótulo do catálogo não fosse interpretável, a criação inline do
    // mesmo texto criaria um segundo cadastro para o que já existe.
    for (const significado of SIGNIFICADOS_PADRAO) {
      expect(de(significado.label).code, significado.label).toBe(significado.code);
    }
  });
});

describe("a leitura de volta — o que já estava gravado continua legível", () => {
  it.each([
    [{ unit: "BRL", periodicity: "MENSAL" }, "montante_mes"],
    [{ unit: "BRL", periodicity: "ANUAL" }, "montante_ano"],
    [{ unit: "BRL", periodicity: "PONTUAL" }, "montante_aquisicao"],
    [{ unit: "BRL", periodicity: null }, "montante_veiculo"],
    [{ unit: "BRL_KM", periodicity: null }, "taxa_km"],
    [{ unit: "PERCENT", periodicity: null }, "proporcao"],
    [{ unit: "KM_L", periodicity: null }, "consumo"],
    [{ unit: "MESES", periodicity: null }, "grandeza_mes"],
    [{ unit: "ANO", periodicity: null }, "descritor_ano_calendario"],
  ])("%o é lido como %s", (tecnico, code) => {
    const lido = significadoPara({
      unit: tecnico.unit,
      periodicity: tecnico.periodicity,
      aggregation: null,
      isMonetary: null,
    });
    expect(lido?.code).toBe(code);
  });

  it("o atributo intocado não é lido como significado nenhum", () => {
    // A maioria da fila. Inventar um significado para ela seria afirmar sobre
    // uma coluna que ninguém abriu.
    expect(
      significadoPara({
        unit: null,
        periodicity: null,
        aggregation: null,
        isMonetary: null,
      }),
    ).toBeNull();
  });

  it("uma taxa de base cadastrada depois também volta legível", () => {
    const lido = significadoPara({
      unit: "BRL_PALLET",
      periodicity: null,
      aggregation: "NONE",
      isMonetary: false,
    });
    expect(lido?.code).toBe("taxa_pallet");
    expect(lido?.label).toBe("R$ por pallet");
  });

  it("ida e volta fecham para todo o catálogo padrão", () => {
    for (const significado of SIGNIFICADOS_PADRAO) {
      const d = derivarSemantica(significado);
      const volta = significadoPara(d);
      // `descritor` sem base não tem unidade nenhuma: não há campo técnico a
      // partir do qual reconhecê-lo, e afirmar que há seria falso.
      if (d.unit === null) {
        expect(volta, significado.code).toBeNull();
        continue;
      }
      expect(volta?.code, significado.code).toBe(significado.code);
    }
  });
});

describe("o período em aberto — o caso que o desenho não fecha sozinho", () => {
  it("R$ por veículo é dinheiro somável que não diz de que período", () => {
    expect(periodoEmAberto(de("R$ por veículo"))).toBe(true);
  });

  it("os significados com período declarado não perguntam nada", () => {
    for (const rotulo of ["R$ por mês", "R$ por ano", "Valor total em R$"]) {
      expect(periodoEmAberto(de(rotulo)), rotulo).toBe(false);
    }
  });

  it("uma taxa nunca pergunta período: ela não se acumula com o tempo", () => {
    expect(periodoEmAberto(de("R$ por km"))).toBe(false);
  });
});

describe("procurar antes de criar", () => {
  const catalogo = SIGNIFICADOS_PADRAO;

  it("acha o existente a menos de acento e caixa", () => {
    // O caso do pedido, na versão do significado.
    expect(normalizarRotulo("Quilômetros por litro")).toBe(normalizarRotulo("quilometros por LITRO"));
    const achados = procurarProximos(
      "quilometros por litro",
      catalogo,
      (s) => s.label,
      (s) => s.code,
    );
    expect(achados[0]?.tipo).toBe("IGUAL");
    expect(achados[0]?.item.code).toBe("consumo");
  });

  it("acha o equivalente mesmo com outro texto", () => {
    const achados = procurarProximos("R$/litro", catalogo, (s) => s.label, (s) => s.code);
    expect(achados[0]?.tipo).toBe("EQUIVALENTE");
    expect(achados[0]?.item.code).toBe("taxa_litro");
  });

  it("acha o parecido por erro de digitação", () => {
    const achados = procurarProximos("Percentul", catalogo, (s) => s.label, (s) => s.code);
    expect(achados[0]?.tipo).toBe("PARECIDO");
    expect(achados[0]?.item.code).toBe("proporcao");
  });

  it("não inventa parentesco entre coisas diferentes", () => {
    const achados = procurarProximos("Pedágio", catalogo, (s) => s.label, (s) => s.code);
    expect(achados).toEqual([]);
  });

  it("a semelhança é simétrica e vale 1 só para o mesmo texto", () => {
    expect(semelhanca("Combustível", "combustivel")).toBe(1);
    expect(semelhanca("a", "b")).toBe(0);
    expect(semelhanca("Pneus", "Pneu")).toBeGreaterThan(0.7);
  });

  it("sem código canônico, sobram texto e semelhança — o caso da categoria", () => {
    const categorias = [{ name: "Combustível" }, { name: "Manutenção" }];
    const achados = procurarProximos("combustivel", categorias, (c) => c.name);
    expect(achados[0]?.tipo).toBe("IGUAL");
    expect(achados[0]?.item.name).toBe("Combustível");
  });
});

describe("o código canônico", () => {
  it("é derivado de forma e base, e nunca do rótulo", () => {
    expect(codigoDe("TAXA", "LITRO")).toBe("taxa_litro");
    expect(codigoDe("PROPORCAO", null)).toBe("proporcao");
  });

  it("é único no catálogo padrão", () => {
    const codigos = SIGNIFICADOS_PADRAO.map((s) => s.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("os rótulos do catálogo padrão também não colidem depois de normalizados", () => {
    const rotulos = SIGNIFICADOS_PADRAO.map((s) => normalizarRotulo(s.label));
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });
});
