import { describe, expect, it } from "vitest";
import {
  CLASSES,
  classeAtual,
  consequenciaDe,
  emOutrasLinhas,
  filtrar,
  jaClassificadas,
  motivoDeNaoPoder,
  oQueFalta,
  podeClassificar,
  precisamDeClasse,
  SEM_CLASSE,
  type Categoria,
} from "../categorias";

/**
 * O que a tela de Categorias decide.
 *
 * O caso que mais importa aqui é o mais fácil de errar: **"Não é custo" é uma
 * resposta, e não a falta de uma.** As duas chegam com `costClass: null` — a
 * categoria cadastral porque cadastro não é custo, a recém-criada porque
 * ninguém decidiu ainda —, e uma tela que as confundisse cobraria para sempre
 * uma decisão de quem já a tomou.
 */

const cat = (over: Partial<Categoria> = {}): Categoria => ({
  id: "1",
  code: "pedagio",
  name: "Pedágio",
  caminho: "Não classificado › Pedágio",
  sintetico: "Não classificado",
  classeCode: SEM_CLASSE,
  atributos: 0,
  isSeed: false,
  ...over,
});

const combustivel = cat({
  id: "2",
  code: "cv_combustivel",
  name: "Combustível",
  caminho: "Consumo e operação › Combustível",
  sintetico: "Consumo e operação",
  classeCode: "operacao",
  atributos: 7,
  isSeed: true,
});

const pneus = cat({
  id: "3",
  code: "cf_pneus",
  name: "Pneus",
  caminho: "Frota e equipamento › Pneus",
  sintetico: "Frota e equipamento",
  classeCode: "frota",
  atributos: 2,
  isSeed: true,
});

const identificacao = cat({
  id: "4",
  code: "cad_identificacao",
  name: "Identificação do ativo",
  caminho: "Cadastro e identificação › Identificação do ativo",
  sintetico: "Cadastro e identificação",
  // A família cadastral descreve o ativo e não mede grandeza econômica. É o
  // caso que distingue "sem família" de "posta numa que não é de custo".
  classeCode: "cadastro",
  atributos: 12,
  isSeed: true,
});

describe("quem ainda precisa de classe", () => {
  it("é quem mora em Não classificado — e só", () => {
    const fila = precisamDeClasse([combustivel, pneus, identificacao, cat()]);
    expect(fila.map((c) => c.code)).toEqual(["pedagio"]);
  });

  it("cadastro não volta para a fila — é família, e família é decisão tomada", () => {
    // Só `classeCode` separa a decisão tomada da adiada. A classe de custo saiu
    // da categoria e virou do atributo; aqui a pergunta é outra.
    expect(precisamDeClasse([identificacao])).toEqual([]);
    expect(classeAtual(identificacao)).toBe("cadastro");
  });

  it("ordena por quantas colunas dependem da decisão", () => {
    const muitas = cat({ id: "9", code: "lavagem", name: "Lavagem", atributos: 5 });
    const nenhuma = cat({ id: "8", code: "arla", name: "ARLA", atributos: 0 });
    const fila = precisamDeClasse([nenhuma, muitas]);
    expect(fila.map((c) => c.name)).toEqual(["Lavagem", "ARLA"]);
  });

  it("empata pelo nome, e não pela ordem que o banco devolveu", () => {
    // Uma lista que troca de ordem entre dois carregamentos faz quem está lendo
    // perder o lugar.
    const b = cat({ id: "7", code: "b", name: "Balsa" });
    const a = cat({ id: "6", code: "a", name: "ARLA" });
    expect(precisamDeClasse([b, a]).map((c) => c.name)).toEqual(["ARLA", "Balsa"]);
    expect(precisamDeClasse([a, b]).map((c) => c.name)).toEqual(["ARLA", "Balsa"]);
  });
});

describe("as que moram numa linha da DRE cadastrada por quem opera", () => {
  const fretePeso = cat({
    id: "10",
    code: "frete_peso",
    name: "Frete peso",
    caminho: "Receita de frete › Frete peso",
    sintetico: "Receita de frete",
    classeCode: "receita_de_frete",
    atributos: 4,
  });
  const fretePedagio = cat({
    id: "11",
    code: "frete_pedagio",
    name: "Frete pedágio",
    caminho: "Receita de frete › Frete pedágio",
    sintetico: "Receita de frete",
    classeCode: "receita_de_frete",
    atributos: 9,
  });

  it("aparecem agrupadas pela linha, e não somem da tela", () => {
    const grupos = emOutrasLinhas([combustivel, fretePeso, cat(), fretePedagio]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].linha).toBe("Receita de frete");
    // Mesma ordem das outras listas: mais colunas dependendo da decisão em cima.
    expect(grupos[0].itens.map((c) => c.name)).toEqual(["Frete pedágio", "Frete peso"]);
  });

  it("não entram na fila nem nas três casas — quem as pôs ali já decidiu", () => {
    expect(precisamDeClasse([fretePeso])).toEqual([]);
    expect(jaClassificadas([fretePeso])).toEqual([]);
    expect(oQueFalta([fretePeso])).toBeNull();
  });

  it("as três casas e 'Não classificado' continuam fora daqui", () => {
    expect(emOutrasLinhas([combustivel, pneus, identificacao, cat()])).toEqual([]);
  });
});

describe("as já classificadas, agrupadas pela casa em que moram", () => {
  it("agrupa pelas famílias, na ordem da árvore", () => {
    const grupos = jaClassificadas([combustivel, pneus, identificacao, cat()]);
    // Na ordem da árvore, e não na ordem em que a lista chegou.
    expect(grupos.map((g) => g.classe)).toEqual(["cadastro", "frota", "operacao"]);
    expect(grupos[0].itens.map((c) => c.name)).toEqual(["Identificação do ativo"]);
  });

  it("não mostra grupo vazio", () => {
    expect(jaClassificadas([combustivel]).map((g) => g.classe)).toEqual(["operacao"]);
  });

  it("a categoria sem classe não entra em grupo nenhum", () => {
    expect(jaClassificadas([cat()])).toEqual([]);
  });
});

describe("a frase do topo", () => {
  it("diz quantas faltam e quantas colunas dependem disso", () => {
    expect(
      oQueFalta([cat({ atributos: 3 }), cat({ id: "9", code: "arla", atributos: 2 })]),
    ).toBe(
      "2 categorias ainda não têm classe, e 5 colunas dependem dessa decisão para entrar do lado certo da conta.",
    );
  });

  it("no singular, escreve no singular — nos dois lugares", () => {
    expect(oQueFalta([cat({ atributos: 1 })])).toBe(
      "1 categoria ainda não tem classe, e 1 coluna depende dessa decisão para entrar do lado certo da conta.",
    );
  });

  it("sem coluna dentro, não alarma à toa", () => {
    // "0 colunas dependem" faria a tela pedir urgência para uma decisão que
    // ainda não move número nenhum.
    expect(oQueFalta([cat({ atributos: 0 })])).toBe(
      "1 categoria ainda não tem classe. Nenhuma coluna depende delas ainda.",
    );
  });

  it("some quando não falta nada — a ausência é o sinal", () => {
    expect(oQueFalta([combustivel, pneus, identificacao])).toBeNull();
  });
});

describe("a consequência, dita antes do clique", () => {
  it("diz para onde vai e quantas colunas vão junto", () => {
    const texto = consequenciaDe(cat({ atributos: 4 }), "operacao");
    expect(texto).toContain('"Pedágio" passa a viver em consumo e operação');
    expect(texto).toContain("4 colunas passam a entrar por aí");
  });

  it("diz também o que **não** muda — a metade que costuma faltar", () => {
    // `change.cost_class` é materializada quando a comparação roda. Reescrevê-la
    // aqui seria a curadoria editando um resultado apurado.
    expect(consequenciaDe(cat(), "frota")).toContain(
      "comparações já calculadas seguem com a classe que tinham",
    );
  });

  it("não promete movimento onde não há coluna nenhuma", () => {
    expect(consequenciaDe(cat({ atributos: 0 }), "frota")).toContain(
      "nada muda de lugar agora",
    );
  });
});

describe("quando o botão habilita", () => {
  const justificativa = "O contrato de agosto repassa pedágio por viagem.";

  it("com classe escolhida e justificativa escrita", () => {
    expect(podeClassificar(cat(), { classe: "operacao", justificativa })).toBe(true);
  });

  it("nunca sem justificativa — a decisão é assinada", () => {
    expect(podeClassificar(cat(), { classe: "operacao", justificativa: "   " })).toBe(
      false,
    );
    expect(motivoDeNaoPoder(cat(), { classe: "operacao", justificativa: "" })).toContain(
      "assinatura",
    );
  });

  it("nunca sem classe escolhida", () => {
    expect(podeClassificar(cat(), { classe: null, justificativa })).toBe(false);
    expect(motivoDeNaoPoder(cat(), { classe: null, justificativa })).toBe(
      "Escolha uma classe.",
    );
  });

  it("nunca para a classe em que ela já está — não há o que decidir ali", () => {
    expect(podeClassificar(combustivel, { classe: "operacao", justificativa })).toBe(
      false,
    );
    expect(
      motivoDeNaoPoder(combustivel, { classe: "operacao", justificativa }),
    ).toContain("já está aí");
  });

  it("reclassificar é permitido: a fonte muda de regra, e a classe de agosto deixa de valer", () => {
    expect(podeClassificar(combustivel, { classe: "frota", justificativa })).toBe(true);
  });

  it("sem impedimento, não inventa motivo", () => {
    expect(motivoDeNaoPoder(cat(), { classe: "frota", justificativa })).toBeNull();
  });
});

describe("o filtro", () => {
  const todas = [combustivel, pneus, identificacao, cat()];

  it("acha sem acento e sem caixa", () => {
    expect(filtrar(todas, "combustivel").map((c) => c.code)).toEqual([
      "cv_combustivel",
    ]);
    expect(filtrar(todas, "PEDAGIO").map((c) => c.code)).toEqual(["pedagio"]);
  });

  it("acha pelo caminho, que é como se fala da família numa reunião", () => {
    expect(filtrar(todas, "frota e equipamento").map((c) => c.code)).toEqual([
      "cf_pneus",
    ]);
  });

  it("vazio devolve tudo", () => {
    expect(filtrar(todas, "   ")).toHaveLength(4);
  });
});

describe("as famílias da árvore", () => {
  it("são as famílias semânticas, e 'Não classificado' não é uma delas", () => {
    // "Não classificado" é de onde se sai, nunca um destino. Oferecê-lo como
    // opção transformaria a fila num lugar de onde não se sai.
    //
    // Eram três e eram econômicas — custo fixo, variável, não é custo. Deixaram
    // de ser quando a classe de custo saiu da árvore: a mesma natureza tem
    // classes diferentes conforme o contexto, e mantê-las aqui obrigava a
    // duplicar o nó.
    expect(CLASSES.map((c) => c.no)).toEqual([
      "cadastro",
      "frota",
      "operacao",
      "pessoal",
      "protecao",
      "tributos",
      "capital",
      "remuneracao_transportador",
      "direcionador",
    ]);
    expect(CLASSES.map((c) => c.no)).not.toContain(SEM_CLASSE);
  });

  it("cada uma explica o que reúne, para a escolha não ser por eliminação", () => {
    for (const classe of CLASSES) {
      expect(classe.ajuda.length).toBeGreaterThan(40);
    }
  });
});
