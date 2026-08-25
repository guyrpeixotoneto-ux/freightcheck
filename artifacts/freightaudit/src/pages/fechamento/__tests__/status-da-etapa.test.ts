import { describe, expect, it } from "vitest";
import type { Documento, Divergencia, Fonte, TipoDeFonte } from "@/lib/fechamento";
import { ROTEIRO, etapaDaFonte, fontesForaDoRoteiro } from "../roteiro";
import {
  divergenciasDaEtapa,
  primeiraEtapaQuePede,
  resumoDaEtapa,
  situacaoDaEtapa,
} from "../status-da-etapa";

/**
 * O estado de cada etapa do roteiro.
 *
 * O que estes casos protegem é a honestidade da tela: o status de uma etapa é
 * derivado só de arquivo, recusa e divergência, e cada um desses sinais tem um
 * significado que não pode ser trocado por outro. "Concluída" onde falta
 * arquivo, ou "concluída" onde o leitor recusou linhas, é a forma exata de um
 * fechamento passar por conferido sem ter sido.
 */

const fonte = (tipo: TipoDeFonte, rotina: string, quinzenas: (1 | 2)[] = [1, 2]): Fonte =>
  ({
    tipo,
    rotina,
    nome: rotina,
    papel: "",
    lado: "DEVIDO",
    extensoes: [".txt"],
    quinzenas,
    quinzenasOpcionais: [],
  }) as Fonte;

const doc = (tipo: TipoDeFonte, recusas: number = 0): Documento => ({
  id: `doc-${tipo}`,
  tipo,
  nomeDoArquivo: `${tipo}.txt`,
  linhasLidas: 10,
  recusas: Array.from({ length: recusas }, (_, i) => ({
    linha: i + 1,
    motivo: "não reconhecido",
    original: "linha",
  })),
  vigente: true,
  enviadoEm: "2026-08-20T00:00:00Z",
  verbas: null,
});

const divergencia = (tipo: string): Divergencia => ({
  id: `div-${tipo}`,
  tipo,
  canal: "ROTA",
  titulo: tipo,
  valor: 100,
  onde: "alguma fonte",
  sentido: "A_RECEBER",
  desfecho: "",
});

/** A etapa 3 (disponibilidade) — a que tem duas fontes cobradas nas duas quinzenas. */
const ETAPA_3 = ROTEIRO.find((e) => e.numero === 3)!;
const CATALOGO_3 = [
  fonte("DISPONIBILIDADE_FF", "03.08.18 FF"),
  fonte("DISPONIBILIDADE_VAN", "03.08.18 Vans"),
];

const situacao = (
  documentos: Documento[],
  divergencias: Divergencia[] = [],
  etapa = ETAPA_3,
  catalogo = CATALOGO_3,
) =>
  situacaoDaEtapa(etapa, {
    catalogo,
    documentos: new Map(documentos.map((d) => [d.tipo, d])),
    divergencias,
    quinzena: 2,
  });

describe("o estado de uma etapa", () => {
  it("sem nenhum arquivo, cobra os que a quinzena espera", () => {
    const s = situacao([]);
    expect(s.estado).toBe("PENDENTE");
    expect(s.faltando.map((f) => f.rotina)).toEqual(["03.08.18 FF", "03.08.18 Vans"]);
    expect(s.proximaAcao).toBe("Envie 03.08.18 FF e 03.08.18 Vans.");
  });

  it("com um dos dois, continua pendente e nomeia só o que falta", () => {
    const s = situacao([doc("DISPONIBILIDADE_FF")]);
    expect(s.estado).toBe("PENDENTE");
    expect(s.faltando.map((f) => f.rotina)).toEqual(["03.08.18 Vans"]);
    expect(s.proximaAcao).toBe("Envie o 03.08.18 Vans.");
  });

  it("com os dois e nada apontado, conclui", () => {
    const s = situacao([doc("DISPONIBILIDADE_FF"), doc("DISPONIBILIDADE_VAN")]);
    expect(s.estado).toBe("CONCLUIDA");
    expect(s.proximaAcao).toBeNull();
  });

  it("divergência da etapa muda o estado, e a de outra etapa não", () => {
    const documentos = [doc("DISPONIBILIDADE_FF"), doc("DISPONIBILIDADE_VAN")];

    expect(situacao(documentos, [divergencia("DESCONTO_DE_DISPONIBILIDADE")]).estado).toBe(
      "DIVERGENCIA",
    );
    /* REQUISICAO_NAO_FATURADA é da etapa 7 — não pode sujar a 3. */
    expect(situacao(documentos, [divergencia("REQUISICAO_NAO_FATURADA")]).estado).toBe(
      "CONCLUIDA",
    );
  });

  /*
    A precedência que mais importa. Linha recusada é dado do arquivo que não
    entrou em conta nenhuma: a divergência calculada sobre o resto pode estar
    aritmeticamente certa e ainda assim ser sobre um universo incompleto. Quem
    lê "divergência" vai conferir números; quem lê "recusa" vai conferir o
    arquivo — que é o que este caso pede.
  */
  it("recusa de linha vence divergência", () => {
    const s = situacao(
      [doc("DISPONIBILIDADE_FF", 2), doc("DISPONIBILIDADE_VAN")],
      [divergencia("DESCONTO_DE_DISPONIBILIDADE")],
    );
    expect(s.estado).toBe("COM_RECUSA");
    expect(s.linhasRecusadas).toBe(2);
    expect(s.proximaAcao).toContain("2 linhas recusadas");
  });

  it("recusa vence até quando ainda falta arquivo", () => {
    const s = situacao([doc("DISPONIBILIDADE_FF", 1)]);
    expect(s.estado).toBe("COM_RECUSA");
    expect(s.proximaAcao).toContain("a linha recusada");
    /* O que falta continua visível ao lado, mesmo não sendo o estado. */
    expect(s.faltando.map((f) => f.rotina)).toEqual(["03.08.18 Vans"]);
  });

  it("divergência não bloqueia: a próxima ação diz que dá para seguir", () => {
    const s = situacao(
      [doc("DISPONIBILIDADE_FF"), doc("DISPONIBILIDADE_VAN")],
      [divergencia("DESCONTO_DE_DISPONIBILIDADE")],
    );
    expect(s.proximaAcao).toContain("não impede");
  });

  /*
    Fonte que a quinzena não cobra não pode virar pendência. Sem isto, toda
    primeira quinzena nasceria cobrando um arquivo que ninguém pode enviar.
  */
  it("fonte não esperada na quinzena não conta como faltando", () => {
    const soNaSegunda = [fonte("CONCILIACAO", "03.02.59.02", [2])];
    const etapa5 = ROTEIRO.find((e) => e.numero === 5)!;
    const s = situacaoDaEtapa(etapa5, {
      catalogo: soNaSegunda,
      documentos: new Map(),
      divergencias: [],
      quinzena: 1,
    });
    expect(s.faltando).toEqual([]);
    expect(s.estado).toBe("NAO_DISPONIVEL");
  });

  /*
    Uma etapa sem arquivo nenhum (Base FT, Conciliação) não pode se declarar
    concluída: não há arquivo cuja chegada signifique que ela terminou, e dizer
    "concluída" seria afirmar sobre trabalho que o sistema não observou.
  */
  it("etapa que não recebe arquivo nunca se declara concluída", () => {
    for (const numero of [1, 8]) {
      const etapa = ROTEIRO.find((e) => e.numero === numero)!;
      const s = situacaoDaEtapa(etapa, {
        catalogo: [],
        documentos: new Map(),
        divergencias: [],
        quinzena: 2,
      });
      expect(s.estado).not.toBe("CONCLUIDA");
    }
  });
});

describe("a distribuição das divergências pelo roteiro", () => {
  /*
    O motor pode ganhar um tipo de divergência novo sem que este mapa saiba
    dele. O achado não pode sumir da tela por causa disso — cai na conciliação,
    que é a etapa que olha o fechamento inteiro.
  */
  it("tipo desconhecido cai na conciliação em vez de sumir", () => {
    const nova = divergencia("ALGO_QUE_O_MOTOR_PASSOU_A_APONTAR");
    expect(divergenciasDaEtapa([nova], 8)).toEqual([nova]);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(divergenciasDaEtapa([nova], n)).toEqual([]);
    }
  });

  it("toda divergência conhecida cai em exatamente uma etapa", () => {
    const conhecidas = [
      "VERBA_SEM_ORIGEM",
      "VERBA_NAO_FECHA",
      "PAGAMENTO_DIVERGE_DO_CTE",
      "REQUISICAO_NAO_FATURADA",
      "DESCONTO_FRETE_MINIMO",
      "SALDO_ATRAVESSANDO",
      "AVISO_DA_CONCILIACAO",
      "OPERACAO_NAO_FECHA",
      "DESCONTO_DE_DISPONIBILIDADE",
    ];
    for (const tipo of conhecidas) {
      const d = divergencia(tipo);
      const etapas = ROTEIRO.filter((e) => divergenciasDaEtapa([d], e.numero).length > 0);
      expect(etapas, `${tipo} deveria cair em uma etapa só`).toHaveLength(1);
    }
  });
});

describe("o roteiro em si", () => {
  it("numera de 1 a 8, sem buraco nem repetição", () => {
    expect(ROTEIRO.map((e) => e.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("nenhuma fonte aparece em duas etapas", () => {
    const todas = ROTEIRO.flatMap((e) => e.fontes);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("cada fonte do roteiro encontra a própria etapa", () => {
    for (const etapa of ROTEIRO) {
      for (const tipo of etapa.fontes) {
        expect(etapaDaFonte(tipo)?.numero).toBe(etapa.numero);
      }
    }
  });

  /*
    O 2Art entra pela etapa 5, junto com a conciliação, e por isso não conta
    mais como fora do roteiro. O teste fixa que o catálogo inteiro cai em
    alguma etapa, para que acrescentar uma fonte nova ao domínio sem
    colocá-la no roteiro apareça aqui, em vez de a fonte sumir calada da tela.
  */
  it("todo o catálogo conhecido está em alguma etapa do roteiro", () => {
    const todas: TipoDeFonte[] = [
      "OPERACAO",
      "CTE",
      "PAGAMENTO",
      "DISPONIBILIDADE_FF",
      "DISPONIBILIDADE_VAN",
      "REQUISICOES",
      "CONCILIACAO",
      "FROTA_PROMAX_ATIVA",
      "FROTA_PROMAX_INATIVA",
    ];
    expect(fontesForaDoRoteiro(todas)).toEqual([]);
  });

  /*
    Uma etapa cujo `verifica` esteja vazio afirmaria, na tela, que o sistema
    confere algo sem dizer o quê. Se uma etapa não confere nada hoje, o lugar
    disso é `aindaNao`.
  */
  it("toda etapa declara o que verifica e por que existe", () => {
    for (const e of ROTEIRO) {
      expect(e.verifica.length, `etapa ${e.numero}`).toBeGreaterThan(0);
      expect(e.confere.length).toBeGreaterThan(20);
      expect(e.curto.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("o resumo que o cabeçalho fechado carrega", () => {
  /*
    Com uma etapa aberta por vez, sete ficam representadas só pelo cabeçalho.
    Se ele não disser o número, fechar a etapa apaga da tela a informação de que
    ela depende — e quem fecha a quinzena passa a ter de abrir as oito para
    saber onde está.
  */
  it("conta os arquivos que chegaram sobre o total", () => {
    expect(resumoDaEtapa(situacao([doc("DISPONIBILIDADE_FF")]))).toBe("1 de 2");
  });

  it("com tudo no lugar, diz o total por extenso", () => {
    const s = situacao([doc("DISPONIBILIDADE_FF"), doc("DISPONIBILIDADE_VAN")]);
    expect(resumoDaEtapa(s)).toBe("2 de 2 arquivos");
  });

  it("soma recusas e diferenças ao lado dos arquivos", () => {
    const s = situacao(
      [doc("DISPONIBILIDADE_FF", 3), doc("DISPONIBILIDADE_VAN")],
      [divergencia("DESCONTO_DE_DISPONIBILIDADE")],
    );
    expect(resumoDaEtapa(s)).toBe("2 de 2 arquivos · 3 linhas recusadas · 1 diferença");
  });

  it("etapa sem arquivo e sem achado não inventa frase", () => {
    const etapa1 = ROTEIRO.find((e) => e.numero === 1)!;
    const s = situacaoDaEtapa(etapa1, {
      catalogo: [],
      documentos: new Map(),
      divergencias: [],
      quinzena: 2,
    });
    expect(resumoDaEtapa(s)).toBeNull();
  });
});

describe("qual etapa a tela abre sozinha", () => {
  const situacoesCom = (pedindo: number[]) =>
    new Map(
      ROTEIRO.map((e) => [
        e.numero,
        {
          estado: pedindo.includes(e.numero) ? "PENDENTE" : "CONCLUIDA",
          faltando: [],
          chegaram: [],
          linhasRecusadas: 0,
          divergencias: [],
          proximaAcao: null,
        } as ReturnType<typeof situacaoDaEtapa>,
      ]),
    );
  const ordem = ROTEIRO.map((e) => e.numero);

  it("abre a primeira que pede alguma coisa, na ordem do roteiro", () => {
    expect(primeiraEtapaQuePede(situacoesCom([5, 3]), ordem)).toBe(3);
  });

  /*
    Nada pedindo não é "nada a fazer": é uma quinzena recém-aberta ou uma já
    conferida. Nos dois casos a primeira etapa é o começo do processo, e abrir
    ali não afirma nada sobre o que falta.
  */
  it("quando nada pede, abre a primeira", () => {
    expect(primeiraEtapaQuePede(situacoesCom([]), ordem)).toBe(1);
  });

  it("recusa e divergência também pedem, não só arquivo faltando", () => {
    for (const estado of ["COM_RECUSA", "DIVERGENCIA"] as const) {
      const m = situacoesCom([]);
      m.set(4, { ...m.get(4)!, estado });
      expect(primeiraEtapaQuePede(m, ordem)).toBe(4);
    }
  });
});
