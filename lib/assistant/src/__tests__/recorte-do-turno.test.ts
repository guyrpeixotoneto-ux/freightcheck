/**
 * ETAPA 0 — o chão: de que unidade e de que vigência esta resposta fala.
 *
 * **Por que duas unidades, e não uma.** O banco de avaliação tem uma só, e num
 * banco de uma unidade *toda* resposta é sobre a unidade certa por acidente: a
 * asserção "'só Camaçari' consultou Camaçari" passa com o código que ignora a
 * frase inteira. O que prova alguma coisa é a segunda unidade — a que a resposta
 * **não** pode descrever. Por isso esta suíte monta o seu próprio banco com
 * CAMAÇARI e UBERLÂNDIA, e a asserção é sempre dupla: consultou a pedida **e**
 * não consultou a outra.
 *
 * **A ordem do banco é a armadilha, e ela é reproduzida de propósito.**
 * `listContexts` ordena por vigência mais recente, então quem tem a última
 * importação vira `contexts[0]` — o padrão de quem não escolheu. Aqui
 * UBERLÂNDIA é montada com a vigência mais recente justamente para ser esse
 * padrão: se o código ignorar a pergunta, a resposta sai sobre Uberlândia e o
 * teste reprova. Um fixture em que a unidade citada já fosse o padrão não
 * distinguiria as duas implementações.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scopeTable, snapshotScopeTable, type Database } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { listContexts } from "@workspace/comparison";
import { orquestrar } from "../orquestrador";
import { resolverRecorteDoTurno, unidadeCitada } from "../recorte";

const ATRIBUTOS: AttributeSpec[] = [
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

/** Uma unidade com nome, duas vigências e uma alteração entre elas. */
async function unidade(
  db: Database,
  nome: string,
  scopeHash: string,
  /** O CNPJ do escopo — distinto por unidade, porque `scope` é único por (tipo, código). */
  cnpj: string,
  placa: string,
  vigencias: [string, string],
  valores: [number, number],
) {
  const fixture = await buildFixture(
    db,
    ATRIBUTOS,
    [
      {
        label: "antes",
        effectiveDate: vigencias[0],
        data: { [placa]: { "cavalo.ipva_licenciamento": valores[0] } },
      },
      {
        label: "depois",
        effectiveDate: vigencias[1],
        data: { [placa]: { "cavalo.ipva_licenciamento": valores[1] } },
      },
    ],
    { entityType: "CAVALO", scopeHash, canal: "EMPURRADA" },
  );

  /*
    O nome do escopo é o que o reconhecimento lê — e é justamente o que
    `buildFixture` não escreve, porque nenhum teste anterior precisava dele.
    Escrever aqui é o mínimo: uma linha em `scope` e o vínculo com cada
    vigência, que é o mesmo que a importação faz.
  */
  const [escopo] = await db
    .insert(scopeTable)
    .values({
      scopeType: "UNIDADE",
      code: cnpj,
      name: nome,
    })
    .returning();

  for (const snapshotId of Object.values(fixture.snapshotIds)) {
    await db.insert(snapshotScopeTable).values({ snapshotId, scopeId: escopo!.id });
  }
  /*
    O status fica em DRAFT, que é o que `buildFixture` grava e o que
    `listContexts` lê: o filtro de lá é `status <> 'SUPERSEDED'`, não
    `status = 'ACTIVE'` — este último nem existe no enum.
  */
  return fixture;
}

describe("Etapa 0 — o recorte do turno", () => {
  let ctx: TestDb;
  let db: Database;
  /** O contexto que o banco devolve primeiro — o padrão de quem não escolheu. */
  let padrao: string;

  beforeAll(async () => {
    ctx = await createTestDatabase("recorte_do_turno");
    db = ctx.db;

    await unidade(db, "CAMAÇARI", "hash-camacari", "11111111000111", "AAA1A11", ["2026-07-02", "2026-08-01"], [1000, 1200]);
    /*
      UBERLÂNDIA tem a vigência mais recente e por isso é o `contexts[0]` — o
      recorte que sai quando ninguém escolhe. É a unidade que a resposta sobre
      Camaçari não pode tocar.
    */
    await unidade(db, "UBERLÂNDIA", "hash-uberlandia", "22222222000122", "BBB2B22", ["2026-08-02", "2026-09-01"], [500, 700]);

    const contextos = await listContexts(db);
    padrao = contextos[0]!.label;
  }, 120_000);

  afterAll(async () => {
    await ctx?.drop();
  });

  it("o padrão do banco é a outra unidade — sem isso o teste não prova nada", () => {
    expect(padrao).toContain("UBERLÂNDIA");
  });

  describe("a unidade citada na pergunta", () => {
    it("reconhece a unidade pelo nome que o banco tem", async () => {
      const contextos = await listContexts(db);
      const achada = unidadeCitada("Só Camaçari.", contextos);
      expect(achada?.nome).toBe("CAMAÇARI");
      expect(achada?.tipo).toBe("UNIDADE");
    });

    it("não reconhece o que não foi importado", async () => {
      const contextos = await listContexts(db);
      expect(unidadeCitada("E em Xique-Xique?", contextos)).toBeNull();
    });

    it("não inventa unidade numa pergunta que não nomeia nenhuma", async () => {
      const contextos = await listContexts(db);
      expect(unidadeCitada("O que mudou em agosto?", contextos)).toBeNull();
    });

    it("a pergunta vence a tela e a conversa", async () => {
      const contextos = await listContexts(db);
      const r = resolverRecorteDoTurno({
        pergunta: "Só Camaçari.",
        pedidoDaTela: { scopeHash: "hash-uberlandia" },
        estado: {
          intencao: null, assunto: null, parametro: null, blocoDoBook: null,
          periodo: null, intervalo: null, equipamento: null, pagina: null, origemDoRecorte: null, telaScopeHash: null, scopeHash: "hash-uberlandia",
          canal: "EMPURRADA", contexto: "UBERLÂNDIA", evidenciasAnteriores: [],
        foco: null,
        sustentacaoAnterior: null,
        },
        contextos,
      });
      expect(r.origem).toBe("PERGUNTA");
      expect(r.pedido.scopeHash).toBe("hash-camacari");
    });

    it("sem unidade na pergunta, a tela vence a conversa", async () => {
      const contextos = await listContexts(db);
      const r = resolverRecorteDoTurno({
        pergunta: "O que mudou?",
        pedidoDaTela: { scopeHash: "hash-camacari" },
        estado: {
          intencao: null, assunto: null, parametro: null, blocoDoBook: null,
          periodo: null, intervalo: null, equipamento: null, pagina: null, origemDoRecorte: null, telaScopeHash: null, scopeHash: "hash-uberlandia",
          canal: null, contexto: null, evidenciasAnteriores: [],
        foco: null,
        sustentacaoAnterior: null,
        },
        contextos,
      });
      expect(r.origem).toBe("TELA");
      expect(r.pedido.scopeHash).toBe("hash-camacari");
    });

    it("sem tela e sem pergunta, o fio da conversa decide", async () => {
      const contextos = await listContexts(db);
      const r = resolverRecorteDoTurno({
        pergunta: "E o IPVA?",
        estado: {
          intencao: null, assunto: null, parametro: null, blocoDoBook: null,
          periodo: null, intervalo: null, equipamento: null, pagina: null, origemDoRecorte: null, telaScopeHash: null, scopeHash: "hash-camacari",
          canal: "EMPURRADA", contexto: "CAMAÇARI", evidenciasAnteriores: [],
        foco: null,
        sustentacaoAnterior: null,
        },
        contextos,
      });
      expect(r.origem).toBe("CONVERSA");
      expect(r.pedido.scopeHash).toBe("hash-camacari");
    });
  });

  describe("PROVA 1 — “Só Camaçari” consulta Camaçari", () => {
    it("orquestra sobre Camaçari mesmo com a tela apontando para Uberlândia", async () => {
      const dossie = await orquestrar(db, "Só Camaçari.", {
        recorte: { scopeHash: "hash-uberlandia" },
        estado: {
          intencao: "MOVIMENTO", assunto: null, parametro: null, blocoDoBook: null,
          periodo: null, intervalo: null, equipamento: null, pagina: null, origemDoRecorte: null, telaScopeHash: null, scopeHash: "hash-uberlandia",
          canal: "EMPURRADA", contexto: "UBERLÂNDIA", evidenciasAnteriores: [],
        foco: null,
        sustentacaoAnterior: null,
        },
      });

      expect(dossie.plano.origemDoRecorte).toBe("PERGUNTA");
      expect(dossie.plano.unidadeCitada).toBe("CAMAÇARI");
      expect(dossie.plano.contexto?.info.label).toContain("CAMAÇARI");

      /*
        A asserção que importa não é "falou de Camaçari" — é "não falou da
        outra". Uma resposta pode citar o nome certo e ter sido montada sobre o
        recorte errado; o que decide é de onde cada evidência veio.
      */
      const recortes = dossie.evidencias
        .map((e) => e.recorte?.contexto)
        .filter((c): c is string => Boolean(c));
      expect(recortes.length).toBeGreaterThan(0);
      for (const recorte of recortes) {
        expect(recorte).toContain("CAMAÇARI");
        expect(recorte).not.toContain("UBERLÂNDIA");
      }
    }, 60_000);

    it("o estado da conversa passa a ser Camaçari — o turno seguinte herda", async () => {
      const dossie = await orquestrar(db, "Só Camaçari.", {
        recorte: { scopeHash: "hash-uberlandia" },
      });
      expect(dossie.plano.contexto?.contexto.scopeHash).toBe("hash-camacari");
    }, 60_000);

    it("sem a frase, a resposta é sobre a unidade da tela — o controle do experimento", async () => {
      const dossie = await orquestrar(db, "O que mudou?", {
        recorte: { scopeHash: "hash-uberlandia" },
      });
      expect(dossie.plano.origemDoRecorte).toBe("TELA");
      expect(dossie.plano.contexto?.info.label).toContain("UBERLÂNDIA");
    }, 60_000);
  });

  describe("PROVA 2 — “fevereiro de 1998” não responde com outra vigência", () => {
    it("declara a lacuna e não consulta nada", async () => {
      const dossie = await orquestrar(db, "O que mudou em fevereiro de 1998?", {
        recorte: { scopeHash: "hash-camacari" },
      });

      expect(dossie.plano.periodoImpossivel).not.toBeNull();
      expect(dossie.plano.periodoImpossivel?.pedido).toContain("1998");
      expect(dossie.plano.periodo).toBeNull();

      /*
        Nenhuma evidência de dado: é a asserção que separa "declarou a lacuna"
        de "declarou a lacuna e mesmo assim mostrou os números de agosto".
      */
      const deDado = dossie.evidencias.filter(
        (e) => !e.ferramenta.toLowerCase().includes("book"),
      );
      expect(deDado).toHaveLength(0);

      const lacuna = dossie.lacunas.find((l) => l.explicacao.includes("1998"));
      expect(lacuna, "a lacuna do período tem de existir").toBeTruthy();
      expect(lacuna!.explicacao).toContain("julho/2026");
    }, 60_000);

    it("nenhum número de outra vigência chega ao dossiê", async () => {
      const dossie = await orquestrar(db, "Quanto mudou o IPVA em março de 2019?", {
        recorte: { scopeHash: "hash-camacari" },
      });
      const numeros = dossie.evidencias.flatMap((e) => e.numeros);
      expect(numeros).toHaveLength(0);
    }, 60_000);

    it("um período que existe continua respondendo — a lacuna não é um freio geral", async () => {
      const dossie = await orquestrar(db, "O que mudou em agosto?", {
        recorte: { scopeHash: "hash-camacari" },
      });
      expect(dossie.plano.periodoImpossivel).toBeNull();
      expect(dossie.plano.periodo).toBe("2026-08-01");
      expect(dossie.evidencias.length).toBeGreaterThan(0);
    }, 60_000);

    it("um intervalo com uma ponta impossível também recusa", async () => {
      const dossie = await orquestrar(db, "Compare fevereiro de 1998 com agosto", {
        recorte: { scopeHash: "hash-camacari" },
      });
      expect(dossie.plano.periodoImpossivel).not.toBeNull();
      const deDado = dossie.evidencias.filter(
        (e) => !e.ferramenta.toLowerCase().includes("book"),
      );
      expect(deDado).toHaveLength(0);
    }, 60_000);
  });
});
