import { describe, expect, it } from "vitest";
import type { Etapa, FluxoCompleto } from "../modelo";
import {
  colher,
  coletorFixo,
  conferirCobertura,
  estadoDasEtapas,
  monitorarFluxo,
  monitorarFluxos,
  montarMonitoramento,
  piorFarol,
  registroDeColetores,
  RegistroDeColetores,
  type Coletor,
  type Leitura,
} from "../monitoramento";
import { RecusaDeFluxo } from "../validacao";

/**
 * O MODO MONITORAMENTO — a bateria que prova o coletor sem banco e sem tela.
 *
 * Tudo aqui é função pura sobre um `FluxoCompleto` montado à mão e coletores de
 * mentira: o desenho inteiro foi feito para poder ser provado assim, e o dia em
 * que uma destas afirmações precisar de Postgres para valer é o dia em que o
 * monitoramento passou a saber ler fluxo — que é justamente o que ele não pode.
 *
 * As afirmações que importam são três, e nenhuma é sobre cor: **ninguém pinta o
 * que não é seu**, **dado velho não é dado**, e **nada fica verde por acidente**.
 */

const AGORA = new Date("2026-08-28T12:00:00.000Z");

function etapa(id: string, nome: string, chave: string | null): Etapa {
  return {
    id,
    fluxoId: "fluxo-1",
    nome,
    descricao: null,
    tipo: "PROCESSO",
    ordem: 0,
    responsavel: null,
    area: null,
    departamentoId: null,
    cargoId: null,
    pessoaId: null,
    objetivo: null,
    sistemaPrincipal: null,
    regras: null,
    informacoesConsultadas: null,
    falhas: null,
    gargalos: null,
    informacoes: null,
    observacoes: null,
    status: "ATIVO",
    posX: 0,
    posY: 0,
    chaveMonitoramento: chave,
    subfluxoId: null,
    itens: [],
    indicadores: [],
    acoes: [],
  } as Etapa;
}

function fluxoCom(etapas: Etapa[]): FluxoCompleto {
  return {
    fluxo: {
      id: "fluxo-1",
      empresaId: "empresa-1",
      nome: "Emissão de CTe até Recebimento",
      slug: "cte-ate-recebimento",
      descricao: null,
      objetivo: null,
      categoria: "FISCAL",
      status: "ATIVO",
      versao: 1,
      dono: null,
      criadoEm: AGORA.toISOString(),
      atualizadoEm: AGORA.toISOString(),
      criadoPor: null,
      atualizadoPor: null,
    },
    etapas,
    conexoes: [],
    subfluxos: [],
    trilha: [],
  } as FluxoCompleto;
}

function leitura(
  chave: string,
  farol: Leitura["farol"],
  minutosAtras = 0,
): Leitura {
  return {
    chave,
    farol,
    medidoEm: new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString(),
  };
}

describe("o registro", () => {
  it("entrega a chave ao prefixo mais longo que a alcança", () => {
    const geral = coletorFixo([leitura("cte.emissao", "VERDE")], {
      nome: "fiscal",
    });
    const especifico: Coletor = {
      nome: "sefaz",
      prefixos: ["cte.autorizacao_sefaz"],
      ler: async () => [],
    };
    const registro = registroDeColetores(
      { ...geral, prefixos: ["cte."] },
      especifico,
    );

    expect(registro.responsavelPor("cte.emissao")?.nome).toBe("fiscal");
    expect(registro.responsavelPor("cte.autorizacao_sefaz")?.nome).toBe(
      "sefaz",
    );
    expect(registro.responsavelPor("financeiro.cobranca")).toBeNull();
  });

  it("recusa dois coletores no mesmo prefixo, em vez de escolher em silêncio", () => {
    const registro = new RegistroDeColetores();
    registro.registrar({ nome: "a", prefixos: ["cte."], ler: async () => [] });
    expect(() =>
      registro.registrar({
        nome: "b",
        prefixos: ["cte."],
        ler: async () => [],
      }),
    ).toThrow(RecusaDeFluxo);
  });

  it("distribui sem repetir a chave que duas etapas declaram, e separa as órfãs", () => {
    const registro = registroDeColetores({
      nome: "fiscal",
      prefixos: ["cte."],
      ler: async () => [],
    });
    const { lotes, orfas } = registro.distribuir([
      "cte.emissao",
      "CTE.Emissao ",
      "financeiro.cobranca",
    ]);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]!.chaves).toEqual(["cte.emissao"]);
    expect(orfas).toEqual(["financeiro.cobranca"]);
  });
});

describe("a colheita", () => {
  const pedido = {
    empresaId: "empresa-1",
    chaves: ["cte.emissao", "financeiro.cobranca"],
  };

  it("isola o coletor quebrado — o resto do fluxo continua pintado", async () => {
    const registro = registroDeColetores(
      coletorFixo([leitura("cte.emissao", "VERMELHO")], { nome: "fiscal" }),
      coletorFixo([leitura("financeiro.cobranca", "VERDE")], {
        nome: "financeiro",
        falharCom: "conexão recusada",
      }),
    );
    const colheita = await colher(registro, pedido, { agora: AGORA });

    expect(colheita.leituras.get("cte.emissao")?.farol).toBe("VERMELHO");
    expect(colheita.leituras.has("financeiro.cobranca")).toBe(false);
    expect(colheita.falhas).toEqual([
      {
        coletor: "financeiro",
        motivo: "erro_do_coletor",
        mensagem: "conexão recusada",
        chaves: ["financeiro.cobranca"],
      },
    ]);
  });

  it("corta o coletor lento no tempo limite, sem travar a tela", async () => {
    const registro = registroDeColetores(
      coletorFixo([leitura("cte.emissao", "VERDE")], {
        nome: "lento",
        demorarEmMs: 50,
      }),
    );
    const colheita = await colher(
      registro,
      { empresaId: "empresa-1", chaves: ["cte.emissao"] },
      { agora: AGORA, tempoLimiteEmMs: 5 },
    );
    expect(colheita.leituras.size).toBe(0);
    expect(colheita.falhas[0]?.motivo).toBe("tempo_esgotado");
  });

  it("descarta a leitura de chave que não é do coletor, e registra a tentativa", async () => {
    const invasor: Coletor = {
      nome: "financeiro",
      prefixos: ["financeiro."],
      ler: async () => [
        leitura("cte.emissao", "VERDE"),
        leitura("financeiro.cobranca", "VERDE"),
      ],
    };
    const registro = registroDeColetores(invasor, {
      nome: "fiscal",
      prefixos: ["cte."],
      ler: async () => [],
    });
    const colheita = await colher(registro, pedido, { agora: AGORA });

    expect(colheita.leituras.get("cte.emissao")).toBeUndefined();
    expect(colheita.falhas[0]).toMatchObject({
      coletor: "financeiro",
      motivo: "leitura_alheia",
    });
  });

  it("descarta a leitura sem farol conhecido — cor inventada é pior que ausência", async () => {
    const torto: Coletor = {
      nome: "torto",
      prefixos: ["cte."],
      ler: async () => [
        { chave: "cte.emissao", farol: "AZUL", medidoEm: "ontem" } as never,
      ],
    };
    const colheita = await colher(
      registroDeColetores(torto),
      { empresaId: "empresa-1", chaves: ["cte.emissao"] },
      { agora: AGORA },
    );
    expect(colheita.leituras.size).toBe(0);
    expect(colheita.falhas[0]?.motivo).toBe("leitura_invalida");
  });
});

describe("o farol", () => {
  const completo = fluxoCom([
    etapa("e1", "Emissão", "cte.emissao"),
    etapa("e2", "Cobrança", "financeiro.cobranca"),
    etapa("e3", "Conferência de mesa", null),
  ]);

  async function apurar(coletores: Coletor[], opcoes = {}) {
    return monitorarFluxo(
      registroDeColetores(...coletores),
      "empresa-1",
      completo,
      {
        agora: AGORA,
        ...opcoes,
      },
    );
  }

  it("acende o que foi medido e nomeia a causa de cada apagado", async () => {
    const resultado = await apurar([
      coletorFixo([leitura("cte.emissao", "AMARELO")], { nome: "fiscal" }),
    ]);
    const porEtapa = new Map(resultado.etapas.map((e) => [e.etapaId, e]));

    expect(porEtapa.get("e1")).toMatchObject({
      farol: "AMARELO",
      motivo: null,
    });
    expect(porEtapa.get("e2")).toMatchObject({
      farol: "SEM_DADO",
      motivo: "sem_coletor",
    });
    expect(porEtapa.get("e3")).toMatchObject({
      farol: "SEM_DADO",
      motivo: "sem_chave",
    });
    expect(resultado.semColetor).toEqual(["financeiro.cobranca"]);
  });

  it("apaga a medição vencida sem perdê-la — 'o último era vermelho, há 2h'", async () => {
    const resultado = await apurar([
      coletorFixo([leitura("cte.emissao", "VERMELHO", 120)], {
        nome: "fiscal",
      }),
    ]);
    const e1 = resultado.etapas.find((e) => e.etapaId === "e1")!;

    expect(e1.farol).toBe("SEM_DADO");
    expect(e1.motivo).toBe("vencida");
    expect(e1.vencida).toBe(true);
    expect(e1.leitura?.farol).toBe("VERMELHO");
    expect(e1.idadeEmSegundos).toBe(7200);
  });

  it("respeita a validade que o coletor declara para a própria métrica", async () => {
    const lenta: Leitura = {
      ...leitura("financeiro.cobranca", "VERDE", 60 * 24),
      validadeEmSegundos: 60 * 60 * 48,
    };
    const resultado = await apurar([
      coletorFixo([lenta], { nome: "financeiro" }),
    ]);
    expect(resultado.etapas.find((e) => e.etapaId === "e2")?.farol).toBe(
      "VERDE",
    );
  });

  it("não transforma ausência em normalidade no resumo do fluxo", async () => {
    const resultado = await apurar([
      coletorFixo([leitura("cte.emissao", "VERDE")], { nome: "fiscal" }),
    ]);
    expect(resultado.resumo).toMatchObject({
      etapas: 3,
      medidas: 1,
      semDado: 2,
      pior: "VERDE",
    });
    expect(piorFarol(["SEM_DADO", "SEM_DADO"])).toBeNull();
    expect(piorFarol(["VERDE", "VERMELHO", "AMARELO"])).toBe("VERMELHO");
  });

  it("conta separado quem respondeu e quem respondeu velho", async () => {
    /*
      As duas contas existem porque pedem consertos diferentes: `respondidas`
      diz que o coletor está de pé, `vencidas` diz que o dado dele envelheceu.
      Somá-las em `medidas` esconderia o segundo caso — a etapa apagaria com a
      mesma cara de quem nunca teve dono.
    */
    const resultado = await apurar([
      coletorFixo([leitura("cte.emissao", "VERDE")], { nome: "fiscal" }),
      coletorFixo([leitura("financeiro.cobranca", "VERMELHO", 60 * 5)], {
        nome: "financeiro",
      }),
    ]);
    expect(resultado.resumo).toMatchObject({
      etapas: 3,
      medidas: 1,
      respondidas: 2,
      vencidas: 1,
      semDado: 2,
    });
    expect(resultado.etapas.find((e) => e.etapaId === "e2")).toMatchObject({
      farol: "SEM_DADO",
      motivo: "vencida",
      vencida: true,
    });
  });

  it("mantém o farol apagado quando o coletor falha, e diz que foi ele", async () => {
    const resultado = await apurar([
      coletorFixo([leitura("cte.emissao", "VERDE")], {
        nome: "fiscal",
        falharCom: "500",
      }),
    ]);
    expect(resultado.etapas.find((e) => e.etapaId === "e1")).toMatchObject({
      farol: "SEM_DADO",
      motivo: "coletor_falhou",
    });
    expect(resultado.falhas[0]?.coletor).toBe("fiscal");
  });

  it("acende as duas etapas que compartilham a mesma chave, com uma medição só", async () => {
    const duplicado = fluxoCom([
      etapa("e1", "Integração", "cte.integracao"),
      etapa("e2", "Reprocessamento", "cte.integracao"),
    ]);
    const colheita = await colher(
      registroDeColetores(
        coletorFixo([leitura("cte.integracao", "VERMELHO")], {
          nome: "fiscal",
        }),
      ),
      { empresaId: "empresa-1", chaves: ["cte.integracao", "cte.integracao"] },
      { agora: AGORA },
    );
    const estados = estadoDasEtapas(duplicado, colheita, {});
    expect(estados.map((e) => e.farol)).toEqual(["VERMELHO", "VERMELHO"]);
    expect(montarMonitoramento(duplicado, colheita).resumo.pior).toBe(
      "VERMELHO",
    );
  });
});

describe("a cobertura", () => {
  it("mostra o retrato honesto: quantas chaves, quantas com dono, quais tortas", () => {
    const completo = fluxoCom([
      etapa("e1", "Emissão", "cte.emissao"),
      etapa("e2", "Cobrança", "financeiro.cobranca"),
      etapa("e3", "Conferência", "Taxa de rejeição"),
      etapa("e4", "Mesa", null),
    ]);
    const cobertura = conferirCobertura(
      completo,
      registroDeColetores({
        nome: "fiscal",
        prefixos: ["cte."],
        ler: async () => [],
      }),
    );

    expect(cobertura).toMatchObject({
      etapas: 4,
      etapasComChave: 3,
      etapasCobertas: 1,
      semColetor: ["financeiro.cobranca", "taxa de rejeição"],
      malFormadas: ["taxa de rejeição"],
    });
  });
});

describe("o painel cruzado", () => {
  /*
    A afirmação é uma só, e é a razão de `monitorarFluxos` existir em vez de um
    laço de `monitorarFluxo`: dois fluxos que declaram a mesma chave são **uma**
    pergunta ao coletor. Um laço faria duas, e o custo cresceria com o número de
    fluxos cadastrados.
  */
  it("colhe uma vez só para todos os fluxos, e data todos no mesmo instante", async () => {
    const fiscal = fluxoCom([
      etapa("e1", "Emissão", "cte.emissao"),
      etapa("e2", "Mesa", null),
    ]);
    const financeiro: FluxoCompleto = {
      ...fluxoCom([etapa("e3", "Cobrança", "cte.emissao")]),
      fluxo: { ...fluxoCom([]).fluxo, id: "fluxo-2", slug: "financeiro" },
    };

    let pedidos = 0;
    const coletor: Coletor = {
      nome: "fiscal",
      prefixos: ["cte."],
      async ler(pedido) {
        pedidos += 1;
        expect(pedido.chaves).toEqual(["cte.emissao"]);
        return [leitura("cte.emissao", "VERMELHO")];
      },
    };

    const painel = await monitorarFluxos(
      registroDeColetores(coletor),
      "empresa-1",
      [fiscal, financeiro],
      { agora: AGORA },
    );

    expect(pedidos).toBe(1);
    expect(painel.map((m) => m.fluxoId)).toEqual(["fluxo-1", "fluxo-2"]);
    expect(painel[0]!.apuradoEm).toBe(painel[1]!.apuradoEm);
    expect(painel[0]!.resumo).toMatchObject({ pior: "VERMELHO", semDado: 1 });
    expect(painel[1]!.resumo).toMatchObject({ pior: "VERMELHO", semDado: 0 });
  });

  it("mostra a falha do coletor em todo fluxo que dependia dele", async () => {
    const a = fluxoCom([etapa("e1", "Emissão", "cte.emissao")]);
    const b: FluxoCompleto = {
      ...fluxoCom([etapa("e2", "Reemissão", "cte.emissao")]),
      fluxo: { ...fluxoCom([]).fluxo, id: "fluxo-2", slug: "outro" },
    };
    const painel = await monitorarFluxos(
      registroDeColetores(
        coletorFixo([leitura("cte.emissao", "VERDE")], {
          nome: "fiscal",
          falharCom: "conexão recusada",
        }),
      ),
      "empresa-1",
      [a, b],
      { agora: AGORA },
    );
    for (const monitoramento of painel) {
      expect(monitoramento.falhas[0]?.coletor).toBe("fiscal");
      expect(monitoramento.etapas[0]).toMatchObject({
        farol: "SEM_DADO",
        motivo: "coletor_falhou",
      });
    }
  });

  it("sem fluxo nenhum, não chama coletor e devolve lista vazia", async () => {
    let chamou = false;
    const painel = await monitorarFluxos(
      registroDeColetores({
        nome: "fiscal",
        prefixos: ["cte."],
        ler: async () => {
          chamou = true;
          return [];
        },
      }),
      "empresa-1",
      [],
      { agora: AGORA },
    );
    expect(painel).toEqual([]);
    expect(chamou).toBe(false);
  });
});
