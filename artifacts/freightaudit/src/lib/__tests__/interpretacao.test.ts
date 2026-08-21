import { describe, expect, it } from "vitest";
import {
  avisoDeParecido,
  familiaDaCategoria,
  leituraDe,
  leituraDoSintetico,
  motivoDoVazio,
  oQueFalta,
  podeConfirmar,
  precisaDoPeriodo,
  previaDaCriacao,
  resumo,
  significadoAtual,
  sugerir,
  textoParaCriar,
  vigenciaDoDado,
  type CampoEmConfirmacao,
  type Escolhas,
  type OpcaoDeCategoria,
  type OpcaoDeSignificado,
  type OpcaoDeSintetico,
} from "../interpretacao";
import {
  derivarSemantica,
  SIGNIFICADOS_PADRAO,
} from "@workspace/curation/significado";

/**
 * O que a tela "Confirmar interpretação do campo" decide.
 *
 * A tela pergunta duas coisas e habilita um botão. Cada teste aqui é uma frase
 * que alguém lê antes de confirmar dinheiro — quantas informações faltam, se a
 * opção digitada já existe com outro acento, o que vai ser criado se clicar em
 * criar. Nenhuma delas deveria precisar de um DOM montado para ser conferida, e
 * nenhuma delas pode ser uma segunda cópia da autoridade: `derivarSemantica` é
 * importada do mesmo pacote que a API usa para gravar.
 */

/** O catálogo como a API o devolve: significado + derivação junto. */
const CATALOGO: OpcaoDeSignificado[] = SIGNIFICADOS_PADRAO.map((s) => {
  const d = derivarSemantica(s);
  return {
    code: s.code,
    label: s.label,
    forma: s.forma,
    base: s.base,
    unit: d.unit,
    periodicity: d.periodicity,
    aggregation: d.aggregation,
    isMonetary: d.isMonetary,
  };
});

/** Uma categoria como a API a entrega: o caminho já partido nos dois níveis. */
const categoria = (
  id: string,
  code: string,
  caminho: string,
  classeCode: string,
): OpcaoDeCategoria => {
  const [sintetico, ...resto] = caminho.split("›").map((parte) => parte.trim());
  return {
    id,
    code,
    name: resto.at(-1) ?? sintetico,
    caminho,
    sintetico,
    analitico: resto.join(" › "),
    classeCode,
  };
};

const CATEGORIAS: OpcaoDeCategoria[] = [
  categoria("1", "cv_combustivel", "Consumo e operação › Combustível", "operacao"),
  categoria("2", "cv_manutencao", "Consumo e operação › Manutenção", "operacao"),
  categoria("3", "cv_pneus", "Consumo e operação › Pneus", "operacao"),
];

const campo = (over: Partial<CampoEmConfirmacao> = {}): CampoEmConfirmacao => ({
  meaningCode: null,
  unit: null,
  periodicity: null,
  aggregation: null,
  isMonetary: null,
  taxonomyCode: null,
  semanticsStatus: "UNKNOWN",
  dataType: "NUMERIC",
  history: [
    { snapshotLabel: "JUL_2026", effectiveDate: "2026-07-01" },
    { snapshotLabel: "AGO_2026", effectiveDate: "2026-08-01" },
  ],
  ...over,
});

const escolhas = (over: Partial<Escolhas> = {}): Escolhas => ({
  meaningCode: null,
  taxonomyCode: null,
  periodicity: null,
  ...over,
});

describe("a vigência do dado", () => {
  it("é a mais recente em que o dado foi importado", () => {
    expect(vigenciaDoDado(campo().history)).toBe("Ago/2026");
  });

  it("não vira o mês anterior num fuso a oeste de Greenwich", () => {
    // `new Date("2026-08-01")` nasce à meia-noite UTC e volta como julho em
    // qualquer navegador brasileiro. A data é cortada do texto por isso.
    expect(vigenciaDoDado([{ effectiveDate: "2026-01-01" }])).toBe("Jan/2026");
    expect(vigenciaDoDado([{ effectiveDate: "2026-12-31" }])).toBe("Dez/2026");
  });

  it("sem vigência, não inventa nenhuma", () => {
    expect(vigenciaDoDado([])).toBeNull();
  });
});

describe("o resumo — o que a IA identificou, o que falta confirmar", () => {
  it("separa em dois, e a vigência entra no lado do que já se sabe", () => {
    const r = resumo(campo(), escolhas(), CATALOGO);
    expect(r.identificado).toContain("Vigência: Ago/2026");
    expect(r.faltaConfirmar).toEqual([
      "O que este valor representa?",
      "Categoria",
    ]);
  });

  it("'é um valor financeiro' é o que se sabe mesmo sem saber o significado exato", () => {
    // O caso do enunciado: a leitura reconhece dinheiro e não reconhece a
    // forma. Esconder a metade que se sabe faria a pessoa procurar do zero.
    const r = resumo(
      campo({ unit: "BRL", isMonetary: true, aggregation: "SUM" }),
      escolhas(),
      CATALOGO,
    );
    expect(r.identificado).toContain("É um valor financeiro");
    expect(r.faltaConfirmar).toContain("O que este valor representa?");
  });

  it("com o significado escolhido, ele sai do lado do que falta", () => {
    const r = resumo(
      campo(),
      escolhas({ meaningCode: "taxa_litro", taxonomyCode: "cv_combustivel" }),
      CATALOGO,
    );
    expect(r.identificado).toContain("Representa: R$ por litro");
    expect(r.faltaConfirmar).toEqual([]);
  });

  it("o período em aberto aparece como coisa que falta, em português", () => {
    const r = resumo(
      campo(),
      escolhas({ meaningCode: "montante_veiculo", taxonomyCode: "cf_pneus" }),
      CATALOGO,
    );
    expect(r.faltaConfirmar).toContain(
      "De quanto em quanto tempo este valor é pago",
    );
  });
});

describe("o que já estava confirmado continua aparecendo", () => {
  it("uma coluna curada no vocabulário antigo é lida como significado", () => {
    // Os atributos confirmados em 10/08/2026 têm unidade e periodicidade e não
    // têm `meaning_id`. Sem a leitura de volta, a tela nova os mostraria como
    // dois campos vazios — e a mudança de interface pareceria perda de
    // curadoria para quem opera.
    const lido = significadoAtual(
      campo({
        unit: "BRL",
        periodicity: "MENSAL",
        aggregation: "SUM",
        isMonetary: true,
        semanticsStatus: "CONFIRMED",
      }),
      CATALOGO,
    );
    expect(lido?.code).toBe("montante_mes");
    expect(lido?.label).toBe("R$ por mês");
  });

  it("o significado gravado manda sobre a leitura de volta", () => {
    const lido = significadoAtual(
      campo({ meaningCode: "taxa_km", unit: "BRL_KM" }),
      CATALOGO,
    );
    expect(lido?.code).toBe("taxa_km");
  });

  it("o atributo intocado não recebe significado inventado", () => {
    expect(significadoAtual(campo(), CATALOGO)).toBeNull();
  });
});

describe("a confirmação incompleta", () => {
  it("diz quantas informações faltam e quais são", () => {
    expect(oQueFalta(escolhas(), CATALOGO)).toBe(
      "Faltam 2 informações para confirmar: o significado do valor e sua categoria.",
    );
  });

  it("no singular, escreve no singular", () => {
    expect(oQueFalta(escolhas({ meaningCode: "taxa_litro" }), CATALOGO)).toBe(
      "Falta 1 informação para confirmar: sua categoria.",
    );
  });

  it("conta o período quando o significado o deixa em aberto", () => {
    const falta = oQueFalta(
      escolhas({
        meaningCode: "montante_veiculo",
        taxonomyCode: "cf_pneus",
      }),
      CATALOGO,
    );
    expect(falta).toContain("de quanto em quanto tempo ele é pago");
  });

  it("o botão só habilita quando não falta nada", () => {
    const completo = escolhas({
      meaningCode: "taxa_litro",
      taxonomyCode: "cv_combustivel",
    });
    expect(podeConfirmar(completo, CATALOGO)).toBe(true);
    expect(oQueFalta(completo, CATALOGO)).toBeNull();
  });

  it("não habilita com o período em aberto sem resposta", () => {
    const quase = escolhas({
      meaningCode: "montante_veiculo",
      taxonomyCode: "cf_pneus",
    });
    expect(podeConfirmar(quase, CATALOGO)).toBe(false);
    expect(
      podeConfirmar({ ...quase, periodicity: "MENSAL" }, CATALOGO),
    ).toBe(true);
  });

  it("o período só é pedido para o significado que o deixa em aberto", () => {
    expect(
      precisaDoPeriodo(escolhas({ meaningCode: "montante_veiculo" }), CATALOGO),
    ).toBe(true);
    for (const code of ["montante_mes", "taxa_km", "proporcao"]) {
      expect(precisaDoPeriodo(escolhas({ meaningCode: code }), CATALOGO)).toBe(false);
    }
  });
});

describe("o combobox pesquisável", () => {
  it("filtra por pedaço do rótulo, e não por começo", () => {
    const s = sugerir("litro", CATALOGO, (o) => o.label, (o) => o.code);
    expect(s.opcoes.map((o) => o.code)).toContain("taxa_litro");
    expect(s.opcoes.map((o) => o.code)).toContain("consumo");
  });

  it("selecionar um significado existente é achá-lo pela busca", () => {
    const s = sugerir("R$ por mês", CATALOGO, (o) => o.label, (o) => o.code);
    expect(s.opcoes[0].code).toBe("montante_mes");
    // E não oferece criar o que já está na lista.
    expect(s.criar).toBeNull();
  });

  it("oferece criar exatamente o que foi digitado, quando não existe", () => {
    const s = sugerir("R$ por hora", CATALOGO, (o) => o.label, (o) => o.code);
    expect(s.criar).toBe("R$ por hora");
  });

  it("não oferece criar o equivalente do que já existe", () => {
    // `R$/litro` é outro texto e a mesma economia. Oferecer criar seria
    // convidar a duplicar o cadastro por desatenção.
    const s = sugerir("R$/litro", CATALOGO, (o) => o.label, (o) => o.code);
    expect(s.criar).toBeNull();
    expect(s.opcoes.map((o) => o.code)).toContain("taxa_litro");
  });

  it("campo vazio mostra tudo e não oferece criar nada", () => {
    const s = sugerir("", CATALOGO, (o) => o.label, (o) => o.code);
    expect(s.opcoes).toHaveLength(CATALOGO.length);
    expect(s.criar).toBeNull();
  });

  it("com formulário do outro lado, o campo vazio oferece cadastrar do zero", () => {
    // O `""` é o formulário abrindo em branco — a saída que a lista ainda vazia
    // não tinha, e que não pode depender de adivinhar que digitar um nome
    // inexistente faz surgir um botão.
    const s = sugerir("", CATALOGO, (o) => o.label, (o) => o.code);
    expect(textoParaCriar(s.criar, "", true)).toBe("");
    expect(textoParaCriar(s.criar, "   ", true)).toBe("");
  });

  it("sem formulário do outro lado, o campo vazio continua sem linha de criar", () => {
    // `aoCriar("")` seria uma recusa do servidor a um clique que a tela não
    // devia ter oferecido.
    const s = sugerir("", CATALOGO, (o) => o.label, (o) => o.code);
    expect(textoParaCriar(s.criar, "", false)).toBeNull();
  });

  it("o que foi digitado manda, e o idêntico continua desligando o criar", () => {
    const novo = sugerir("R$ por hora", CATALOGO, (o) => o.label, (o) => o.code);
    expect(textoParaCriar(novo.criar, "R$ por hora", true)).toBe("R$ por hora");

    const existente = sugerir("R$ por mês", CATALOGO, (o) => o.label, (o) => o.code);
    expect(textoParaCriar(existente.criar, "R$ por mês", true)).toBeNull();
  });

  it("selecionar categoria existente: 'combustivel' encontra 'Combustível'", () => {
    const s = sugerir("combustivel", CATEGORIAS, (c) => c.name);
    expect(s.opcoes[0].code).toBe("cv_combustivel");
    expect(s.criar).toBeNull();
  });

  it("categoria nova é oferecida para criação, com o texto à vista", () => {
    const s = sugerir("Pedágio", CATEGORIAS, (c) => c.name);
    expect(s.criar).toBe("Pedágio");
    expect(s.opcoes).toHaveLength(0);
  });

  it("o parecido aparece antes do criar, e não bloqueia", () => {
    const s = sugerir("Pneu", CATEGORIAS, (c) => c.name);
    expect(s.parecidos.map((p) => p.item.name)).toContain("Pneus");
    // Continua possível criar: quem digitou pode estar certo.
    expect(s.criar).toBe("Pneu");
    expect(avisoDeParecido(s.parecidos, (c) => c.name)).toContain('"Pneus"');
  });

  it("sem parecido, não inventa aviso", () => {
    const s = sugerir("Lavagem de tanque", CATEGORIAS, (c) => c.name);
    expect(avisoDeParecido(s.parecidos, (c) => c.name)).toBeNull();
  });
});

describe("a família da categoria, dita para quem escolhe", () => {
  /*
    Isto era a classe de custo, lida da posição na árvore. Deixou de ser: a
    classe é do atributo, e a árvore agrupa por natureza. O detalhe agora serve
    para separar duas categorias de nome parecido, que é o que quem escolhe
    precisa.
  */
  it("nomeia a família em que a categoria mora", () => {
    expect(familiaDaCategoria(CATEGORIAS[0])).toBe("Consumo e operação");
    expect(
      familiaDaCategoria(
        categoria("9", "cad_identificacao", "Cadastro e identificação › Identificação do ativo", "cadastro"),
      ),
    ).toBe("Cadastro e identificação");
  });

  it("só quem mora em Não classificado é anunciado como sem família", () => {
    const nova = categoria("8", "pedagio", "Não classificado › Pedágio", "nao_classificado");
    expect(familiaDaCategoria(nova)).toBe("Ainda sem família");
  });
});

describe("a família, lida no campo do sintético", () => {
  const linha = (parcial: Partial<OpcaoDeSintetico>): OpcaoDeSintetico => ({
    id: "1",
    code: "frota",
    nome: "Frota e equipamento",
    categorias: 8,
    isSeed: true,
    ...parcial,
  });

  /*
    A leitura dizia o lado da conta — "Custo fixo · 8 categorias" —, e não diz
    mais: nenhuma família decide classe de custo desde que ela virou coluna do
    atributo. O que sobrou é o que de fato ajuda a escolher: quanto já mora
    dentro.
  */
  it("diz quanto já mora dentro", () => {
    expect(leituraDoSintetico(linha({}))).toBe("8 categorias");
    expect(leituraDoSintetico(linha({ categorias: 1 }))).toBe("1 categoria");
  });

  it("a família recém-criada se anuncia vazia, e não some da lista", () => {
    // O contrário — derivar as famílias das categorias — esconderia a nova no
    // instante seguinte ao do clique que a criou.
    const nova = linha({
      code: "receita_de_frete",
      nome: "Receita de frete",
      categorias: 0,
      isSeed: false,
    });
    expect(leituraDoSintetico(nova)).toBe("nenhuma categoria ainda");
  });
});

describe("a prévia da criação — criar sabendo o que vai virar", () => {
  it("diz o que a autoridade entendeu do texto digitado", () => {
    const previa = previaDaCriacao("R$ por hora");
    expect(previa?.significado.code).toBe("taxa_hora");
    expect(previa?.natureza).toContain("por hora");
  });

  it("devolve null para o que a autoridade não traduz", () => {
    // A tela mostra o formato em vez de um botão que só falharia depois do
    // clique.
    expect(previaDaCriacao("por litro")).toBeNull();
  });
});

describe("a leitura do significado escolhido", () => {
  it("diz que a taxa não se soma entre veículos — e por quê", () => {
    const taxa = CATALOGO.find((o) => o.code === "taxa_km")!;
    const leitura = leituraDe(taxa);
    expect(leitura.agregacao).toMatch(/não se somam/i);
    expect(leitura.agregacao).toContain("multiplicada");
  });

  it("diz que o montante por equipamento produz o total da frota", () => {
    const montante = CATALOGO.find((o) => o.code === "montante_mes")!;
    expect(leituraDe(montante).agregacao).toMatch(/total da frota/i);
  });

  it("a leitura e os campos derivados são a mesma decisão", () => {
    // Uma tela que dissesse "não se soma" ao lado de `aggregation: SUM` seria
    // pior do que tela nenhuma.
    for (const opcao of CATALOGO) {
      const naoSoma = /não se somam|não se soma|não entra em soma/i.test(
        leituraDe(opcao).agregacao,
      );
      if (naoSoma) expect(opcao.aggregation, opcao.code).not.toBe("SUM");
    }
  });
});

describe("o vazio da lista — dois motivos, duas saídas", () => {
  it("lista vazia é falta de cadastro, e não busca sem resultado", () => {
    // O caso do seletor de unidade antes do primeiro cadastro: mandar procurar
    // melhor sobre lista nenhuma é a instrução que não leva a lugar nenhum.
    expect(motivoDoVazio(0, 0)).toBe("SEM_CADASTRO");
  });

  it("cadastro cheio e filtro sem casar é busca sem resultado", () => {
    expect(motivoDoVazio(12, 0)).toBe("SEM_RESULTADO");
  });

  it("com opção na tela não há vazio a explicar", () => {
    expect(motivoDoVazio(12, 3)).toBeNull();
    // Nem quando o que se vê veio inteiro da busca por proximidade — o que
    // conta é haver o que escolher.
    expect(motivoDoVazio(0, 1)).toBeNull();
  });
});
