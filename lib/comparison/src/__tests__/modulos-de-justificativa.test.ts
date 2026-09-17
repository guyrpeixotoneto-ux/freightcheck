import { describe, expect, it } from "vitest";
import {
  MODULOS_DE_JUSTIFICATIVA,
  descreverRubrica,
  moduloDaAlteracao,
  rubricaDaAlteracao,
  rubricasComTela,
  telasQueReivindicam,
} from "../modulos-de-justificativa";
import { dobrarEmRubricas, type ContagemPorAtributo } from "../painel-de-justificativas";
import { mappedAttributeCodes } from "../families";

/**
 * O mapa que diz **onde se justifica** cada alteração.
 *
 * O Monitor de Justificativas não justifica nada: ele cobra, e cobrar é dizer
 * para que tela mandar quem deve a explicação. Este teste prende as três coisas
 * que fariam a cobrança apontar para o lugar errado — uma alteração sem módulo,
 * uma rubrica que soma num módulo e abre noutro, e uma rubrica que suma da
 * conta por não estar em catálogo nenhum.
 */

const NADA = { attributeCode: null, entityType: null, costClass: null };

describe("de que módulo é a alteração", () => {
  it("segue a classe de custo que a comparação gravou", () => {
    expect(
      moduloDaAlteracao({ ...NADA, attributeCode: "cavalo.qualquer", costClass: "FIXO" }),
    ).toBe("CUSTO_FIXO");
    expect(
      moduloDaAlteracao({ ...NADA, attributeCode: "cavalo.qualquer", costClass: "VARIAVEL" }),
    ).toBe("CUSTO_VARIAVEL");
  });

  it("não empurra para o módulo maior o que a curadoria ainda não classificou", () => {
    /*
      650 das alterações da prova local chegam sem classe. Somá-las ao Custo
      Fixo faria o módulo afirmar um tamanho que não é dele; escondê-las faria
      os módulos somarem menos do que o cartão do total. Elas têm módulo
      próprio, com esse nome.
    */
    expect(moduloDaAlteracao({ ...NADA, attributeCode: "cavalo.ativo" })).toBe("SEM_CLASSE");
  });

  it("manda o quadro de pessoal para o QLP pelo tipo, e não pela classe", () => {
    const alteracao = {
      attributeCode: "qlp_operacional.salario_unitario",
      entityType: "QLP_OPERACIONAL",
      /* Custo fixo pela natureza — e ainda assim não é o módulo Custo Fixo. */
      costClass: "FIXO",
    };
    expect(moduloDaAlteracao(alteracao)).toBe("QLP");
  });

  it("deixa a rubrica com tela mandar na classe", () => {
    /*
      O Finame é Custo Fixo na lateral, na tela e no menu. Uma alteração dele
      que chegue sem classificação não pode cair em "Sem classe": a linha do
      Monitor e a tela que ela abre diriam módulos diferentes sobre a mesma
      rubrica.
    */
    expect(
      moduloDaAlteracao({ ...NADA, attributeCode: "cavalo.finame_cavalo", costClass: null }),
    ).toBe("CUSTO_FIXO");
  });
});

describe("em que rubrica ela entra", () => {
  it("reconhece a rubrica que tem tela, e devolve o endereço dela", () => {
    const rubrica = rubricaDaAlteracao({
      ...NADA,
      attributeCode: "cavalo.finame_cavalo",
      costClass: "FIXO",
    });
    expect(rubrica.rotulo).toBe("Finame");
    expect(rubrica.rota).toBe("/custo-fixo-finame");
  });

  it("nomeia pelo parâmetro da família o que não tem tela de rubrica", () => {
    /*
      `carreta.frota_emprestada` não está em catálogo de rubrica nenhum, e ainda
      assim é pendência de alguém. Ela aparece com o nome que o Freightech lhe
      dá, e não numa gaveta chamada "outras".
    */
    const rubrica = rubricaDaAlteracao({
      ...NADA,
      attributeCode: "carreta.frota_emprestada",
    });
    expect(rubrica.rotulo).not.toBe("");
    expect(rubrica.rotulo).not.toContain("|");
    /* Sem tela própria: quem justifica é a fila, e o link é montado lá. */
    expect(rubrica.rota).toBeNull();
  });

  it("nunca devolve rubrica vazia — nem para um atributo que ninguém conhece", () => {
    const rubrica = rubricaDaAlteracao({ ...NADA, attributeCode: "cavalo.inventado_ontem" });
    expect(rubrica.chave).toBeTruthy();
    expect(rubrica.rotulo).toBe("cavalo.inventado_ontem");
  });

  it("dá a cada atributo do dicionário uma rubrica com nome", () => {
    /* A régua de `families.ts`: nada é descartado. */
    for (const codigo of mappedAttributeCodes()) {
      const rubrica = rubricaDaAlteracao({ ...NADA, attributeCode: codigo });
      expect(rubrica.rotulo, codigo).toBeTruthy();
    }
  });

  it("volta inteira a partir da chave — é assim que a tela a lê", () => {
    /*
      A contagem chega do servidor com a chave e o módulo, e a tela reconstrói
      dali o nome e o link. Se `descreverRubrica` discordasse de
      `rubricaDaAlteracao`, a linha somaria um número e abriria outro.
    */
    const casos = [
      { attributeCode: "cavalo.finame_cavalo", entityType: "CAVALO", costClass: "FIXO" },
      { attributeCode: "carreta.frota_emprestada", entityType: "CARRETA", costClass: null },
      {
        attributeCode: "qlp_operacional.salario_unitario",
        entityType: "QLP_OPERACIONAL",
        costClass: "FIXO",
      },
    ];
    for (const caso of casos) {
      const direta = rubricaDaAlteracao(caso);
      expect(descreverRubrica(direta.chave, direta.modulo)).toEqual(direta);
    }
  });

  it("não dá a uma rubrica o atributo que várias telas mostram e nenhuma reivindica", () => {
    /*
      `trecho.km_rodado` está no catálogo do KM rodado e no da Velocidade média,
      e nenhuma das duas se declara dona dele. Atribuí-lo ao primeiro do menu
      faria a linha da outra tela contar menos do que a própria tela mostra. Ele
      é nomeado pelo parâmetro da família, como todo atributo sem rubrica
      própria.
    */
    expect(telasQueReivindicam("trecho.km_rodado").length).toBeGreaterThan(1);
    const rubrica = rubricaDaAlteracao({
      ...NADA,
      attributeCode: "trecho.km_rodado",
      costClass: "VARIAVEL",
    });
    expect(rubrica.chave.startsWith("parametro:")).toBe(true);
    expect(rubrica.chave).not.toBe("km-rodado");
  });

  it("dá o atributo à rubrica que se declara dona dele, ainda que várias o mostrem", () => {
    /*
      O valor da nota está no catálogo do Finame, no do IPVA e no dos Impostos —
      as três o mostram como base do próprio número, e cada uma diz no próprio
      `foraDaSoma` que ele não é rubrica dela. Enquanto ninguém era a rubrica
      dele, ele caía no parâmetro da família: dar ao Finame, por ser o primeiro
      do menu, seria inventar uma escolha que ninguém tomou.

      A Auditoria de Aquisição tomou essa escolha, e a declara em `proprios`.
      Este teste prende a mudança de posse como decisão — e é o que obriga quem
      a desfizer a dizê-lo por escrito.
    */
    expect(telasQueReivindicam("cavalo.valor_nf_compra").length).toBeGreaterThan(1);
    const rubrica = rubricaDaAlteracao({
      ...NADA,
      attributeCode: "cavalo.valor_nf_compra",
      costClass: "FIXO",
    });
    expect(rubrica.chave).toBe("aquisicao");
    expect(rubrica.modulo).toBe("CUSTO_FIXO");
    expect(rubrica.rota).toBe("/custo-fixo-aquisicao");
  });

  it("deixa a aquisição mandar na classe das colunas de compra", () => {
    /*
      A data e o mês de entrada são `NAO_APLICAVEL` na curadoria — não são custo.
      Ainda assim a rubrica é da Aquisição, que é Custo Fixo na lateral e no
      menu: a linha do Monitor e a tela que ela abre precisam dizer o mesmo
      módulo. É a mesma regra que o Finame já tinha.
    */
    for (const codigo of ["cavalo.data", "cavalo.mes_de_entrada", "carreta.ano"]) {
      const rubrica = rubricaDaAlteracao({ ...NADA, attributeCode: codigo });
      expect(rubrica.chave).toBe("aquisicao");
      expect(rubrica.modulo).toBe("CUSTO_FIXO");
    }
  });

  it("mantém a rubrica de quem é reivindicado por uma tela só", () => {
    expect(telasQueReivindicam("cavalo.juros_finame_cavalo")).toEqual(["finame"]);
    expect(
      rubricaDaAlteracao({ ...NADA, attributeCode: "cavalo.juros_finame_cavalo" }).chave,
    ).toBe("finame");
  });

  it("aponta cada rubrica com tela para um módulo que existe", () => {
    const chaves = MODULOS_DE_JUSTIFICATIVA.map((m) => m.chave);
    for (const rubrica of rubricasComTela()) {
      expect(chaves).toContain(rubrica.modulo);
    }
  });
});

describe("a dobra de atributo em rubrica", () => {
  const base = {
    changeSetId: "cs-1",
    entityType: "CAVALO",
    costClass: "FIXO",
    ultimaEm: null,
    ultimoAutor: null,
  };

  it("soma os atributos de uma mesma rubrica numa linha só", () => {
    const linhas: ContagemPorAtributo[] = [
      { ...base, attributeCode: "cavalo.finame_cavalo", alteracoes: 10, justificadas: 4 },
      { ...base, attributeCode: "cavalo.juros_finame_cavalo", alteracoes: 6, justificadas: 1 },
    ];
    const dobradas = dobrarEmRubricas(linhas);
    expect(dobradas).toHaveLength(1);
    expect(dobradas[0]).toMatchObject({
      rubrica: "finame",
      modulo: "CUSTO_FIXO",
      alteracoes: 16,
      justificadas: 5,
    });
  });

  it("mantém separadas a mesma rubrica em vigências e tipos diferentes", () => {
    /* É o que permite à tela recortar por vigência e por aba sem voltar ao
       servidor — a mesma razão de `coberturaDeJustificativas` guardar as duas
       chaves. */
    const linhas: ContagemPorAtributo[] = [
      { ...base, attributeCode: "cavalo.finame_cavalo", alteracoes: 1, justificadas: 0 },
      {
        ...base,
        changeSetId: "cs-2",
        attributeCode: "cavalo.finame_cavalo",
        alteracoes: 1,
        justificadas: 0,
      },
      {
        ...base,
        entityType: "CARRETA",
        attributeCode: "carreta.finame_implemento",
        alteracoes: 1,
        justificadas: 0,
      },
    ];
    expect(dobrarEmRubricas(linhas)).toHaveLength(3);
  });

  it("guarda o autor da justificativa mais recente da rubrica", () => {
    /*
      `max(criado_em)` de um atributo com o `criado_por` de outro seria um nome
      ao lado de uma data que não é dele — o defeito clássico do agregado que
      escolhe as duas colunas por caminhos diferentes.
    */
    const antiga = new Date("2026-01-10T12:00:00Z");
    const recente = new Date("2026-03-02T08:30:00Z");
    const linhas: ContagemPorAtributo[] = [
      {
        ...base,
        attributeCode: "cavalo.finame_cavalo",
        alteracoes: 2,
        justificadas: 2,
        ultimaEm: recente,
        ultimoAutor: "marina@ambev.com",
      },
      {
        ...base,
        attributeCode: "cavalo.juros_finame_cavalo",
        alteracoes: 2,
        justificadas: 1,
        ultimaEm: antiga,
        ultimoAutor: "joao@ambev.com",
      },
    ];
    const [linha] = dobrarEmRubricas(linhas);
    expect(linha.ultimaEm).toEqual(recente);
    expect(linha.ultimoAutor).toBe("marina@ambev.com");
  });

  it("não perde alteração nenhuma na dobra", () => {
    const linhas: ContagemPorAtributo[] = [
      { ...base, attributeCode: "cavalo.finame_cavalo", alteracoes: 3, justificadas: 1 },
      { ...base, attributeCode: "cavalo.ativo", costClass: null, alteracoes: 7, justificadas: 0 },
      {
        ...base,
        attributeCode: null,
        costClass: null,
        alteracoes: 2,
        justificadas: 2,
      },
    ];
    const total = dobrarEmRubricas(linhas).reduce((s, l) => s + l.alteracoes, 0);
    expect(total).toBe(12);
  });
});
