/**
 * ETAPA 5 — a sequência de seis turnos como uma investigação só.
 *
 * **O padrão do defeito, dito uma vez.** O estado da conversa guardava *sobre o
 * quê* se falava — assunto, período, bloco do Book — e não *como se estava
 * recortando*. Unidade, equipamento e posição na lista eram lidos corretamente
 * pela interpretação e morriam no fim do turno. O efeito é uma conversa que
 * parece funcionar e escorrega: o terceiro turno volta à frota inteira, o sexto
 * repete a primeira página, e a única pista de qualquer um dos dois é o número
 * mudar.
 *
 * **O que este arquivo prova, e como.** A sequência inteira é executada contra
 * um banco real, turno a turno, alimentando o estado de um no seguinte — que é
 * exatamente o que a rota faz. As asserções são sobre o **recorte efetivo** de
 * cada turno, e não sobre a prosa: qual unidade, qual equipamento, qual página.
 *
 * **O que ele deliberadamente não prova.** Que a resposta é boa. Isso depende do
 * modelo, e o caminho do agente não pode ser exercido sem chave — a sequência
 * aqui roda com `semIa`, que é o que isola a mecânica do estado da qualidade da
 * redação. Cada turno é o dossiê, não o texto.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { computeMissingChangeSets } from "@workspace/comparison";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { scopeTable, snapshotScopeTable } from "@workspace/db";
import { orquestrar } from "../orquestrador";
import { avancarEstado, ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import { executar, registroPadrao } from "../ferramentas/registro";
import { createDb } from "@workspace/db";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

const ATRIBUTOS: AttributeSpec[] = [
  {
    code: "cavalo.finame",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

describe("Etapa 5 — o fio da conversa carrega os filtros", () => {
  let ctx: TestDb;
  let db: Database;

  beforeAll(async () => {
    ctx = await createTestDatabase("conversa_encadeada");
    db = ctx.db;

    async function unidade(nome: string, hash: string, cnpj: string, prefixo: string, tipo: "CAVALO" | "CARRETA") {
      const antes: Record<string, Record<string, number>> = {};
      const depois: Record<string, Record<string, number>> = {};
      for (let i = 0; i < 12; i++) {
        const placa = `${prefixo}${(i % 9) + 1}X${String(i + 10).padStart(2, "0")}`;
        antes[placa] = { "cavalo.finame": 9000 + i * 10 };
        depois[placa] = { "cavalo.finame": 4000 + i * 10 };
      }
      const fixture = await buildFixture(
        db,
        ATRIBUTOS,
        [
          { label: `antes-${prefixo}`, effectiveDate: "2026-07-02", data: antes },
          { label: `depois-${prefixo}`, effectiveDate: "2026-08-01", data: depois },
        ],
        { entityType: tipo, scopeHash: hash, canal: "EMPURRADA" },
      );
      const [escopo] = await db
        .insert(scopeTable)
        .values({ scopeType: "UNIDADE", code: cnpj, name: nome })
        .returning();
      for (const snapshotId of Object.values(fixture.snapshotIds)) {
        await db.insert(snapshotScopeTable).values({ snapshotId, scopeId: escopo!.id });
      }
    }

    /*
      Uma unidade por contexto, e um tipo de equipamento por contexto.

      A identidade canônica de uma vigência é (sistema, família, canal, data,
      escopo) — duas famílias de equipamento no mesmo canal e na mesma data
      colidem nela. Na importação real elas chegam no **mesmo** snapshot, e é por
      isso que os casos que precisam dos dois tipos juntos rodam contra o banco
      de avaliação, logo abaixo, em vez de contra um fixture que não consegue
      reproduzir essa forma.
    */
    await unidade("CAMAÇARI", "hash-cam", "11111111000111", "CAV", "CAVALO");
    await unidade("UBERLÂNDIA", "hash-ube", "22222222000122", "UBE", "CAVALO");
    await computeMissingChangeSets(db, "teste:conversa");
  }, 180_000);

  afterAll(async () => {
    await ctx?.drop();
  });

  it("os seis turnos mantêm unidade, equipamento e página", async () => {
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    const trilha: {
      pergunta: string;
      unidade: string | null;
      equipamento: string | null;
      pagina: number | null;
      herdado: string[];
    }[] = [];

    const perguntar = async (pergunta: string) => {
      const dossie = await orquestrar(db, pergunta, {
        estado,
        // A tela aponta para Uberlândia o tempo todo: o que muda o recorte é a conversa.
        recorte: { scopeHash: "hash-ube" },
      });
      estado = avancarEstado(estado, dossie);
      trilha.push({
        pergunta,
        unidade: dossie.plano.contexto?.info.label ?? null,
        equipamento: dossie.leitura.entidades.equipamento,
        pagina: estado.pagina?.apartirDe ?? null,
        herdado: dossie.plano.herdado,
      });
      return dossie;
    };

    await perguntar("O que mudou em agosto?");
    await perguntar("Só Camaçari.");
    await perguntar("E somente cavalos.");
    await perguntar("Qual teve maior perda?");
    await perguntar("Por quê?");
    await perguntar("Me mostre os 5 seguintes.");

    // Turno 1 — sem unidade na frase: vale a tela.
    expect(trilha[0]!.unidade).toContain("UBERLÂNDIA");
    expect(trilha[0]!.equipamento).toBeNull();

    // Turno 2 — a frase nomeia a unidade, e ela vence a tela.
    expect(trilha[1]!.unidade).toContain("CAMAÇARI");
    expect(trilha[1]!.herdado.join(" ")).toContain("CAMAÇARI");

    // Turno 3 — o equipamento entra e a unidade **não se perde**.
    expect(trilha[2]!.equipamento).toBe("CAVALO");
    expect(trilha[2]!.unidade).toContain("CAMAÇARI");

    /*
      Turnos 4 e 5 são a prova principal: nenhum deles nomeia unidade nem
      equipamento, e os dois continuam em Camaçari e em cavalo. Era aqui que a
      conversa escorregava de volta para a frota inteira.
    */
    for (const turno of [trilha[3]!, trilha[4]!]) {
      expect(turno.unidade, turno.pergunta).toContain("CAMAÇARI");
      expect(turno.equipamento, turno.pergunta).toBe("CAVALO");
    }
    expect(trilha[3]!.herdado.join(" ")).toContain("equipamento cavalo");

    // Turno 6 — a lista anda, e continua no mesmo recorte.
    expect(trilha[5]!.pagina).toBe(20);
    expect(trilha[5]!.unidade).toContain("CAMAÇARI");
    expect(trilha[5]!.equipamento).toBe("CAVALO");
  }, 180_000);

  it("uma pergunta nova zera a página — a lista dela é outra", async () => {
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    estado = avancarEstado(estado, await orquestrar(db, "O que mudou em agosto?", { estado, recorte: { scopeHash: "hash-cam" } }));
    estado = avancarEstado(estado, await orquestrar(db, "Me mostre os 5 seguintes.", { estado, recorte: { scopeHash: "hash-cam" } }));
    expect(estado.pagina?.apartirDe).toBe(20);

    estado = avancarEstado(estado, await orquestrar(db, "O que mudou em julho?", { estado, recorte: { scopeHash: "hash-cam" } }));
    expect(estado.pagina, "a lista mudou; o deslocamento não sobrevive").toBeNull();
  }, 120_000);

});

/**
 * Os casos que precisam de cavalo **e** carreta no mesmo recorte.
 *
 * Eles rodam contra o banco de avaliação porque é lá que essa forma existe: a
 * importação real junta os dois modelos numa vigência só, e o fixture sintético
 * não consegue reproduzi-la sem violar a identidade canônica. Medir o filtro de
 * equipamento contra um recorte que só tem um tipo não mediria nada.
 */
rodar("Etapa 5 — o filtro de equipamento contra o export real", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = createDb(URL_DO_BANCO!));
  });

  it("o filtro do fio chega à ferramenta sem o modelo repeti-lo", async () => {
    const reg = registroPadrao();
    const semFiltro = await executar(reg, "alteracoes", { nivel: "grupos", limite: 100 }, {
      db,
      recorte: {},
    });
    const comFiltro = await executar(reg, "alteracoes", { nivel: "grupos", limite: 100 }, {
      db,
      recorte: {},
      filtros: { equipamento: "CARRETA" },
    });

    const equipamentosDe = (r: typeof semFiltro) =>
      new Set(((r.conteudo as { grupos: { equipamento: string }[] }).grupos ?? []).map((g) => g.equipamento));

    expect(equipamentosDe(semFiltro).size).toBeGreaterThan(1);
    expect([...equipamentosDe(comFiltro)]).toEqual(["CARRETA"]);
  }, 120_000);

  it("o argumento explícito vence o filtro do fio", async () => {
    const r = await executar(registroPadrao(), "alteracoes", { nivel: "grupos", equipamento: "CAVALO", limite: 100 }, {
      db,
      recorte: {},
      filtros: { equipamento: "CARRETA" },
    });
    const equipamentos = new Set(
      ((r.conteudo as { grupos: { equipamento: string }[] }).grupos ?? []).map((g) => g.equipamento),
    );
    expect([...equipamentos]).toEqual(["CAVALO"]);
  }, 120_000);

  it("a paginação anda de verdade na ferramenta, e diz quanto falta", async () => {
    const reg = registroPadrao();
    const base = { db, recorte: {} };
    const primeira = await executar(reg, "alteracoes", { nivel: "grupos", limite: 1, apartirDe: 0 }, base);
    const segunda = await executar(reg, "alteracoes", { nivel: "grupos", limite: 1, apartirDe: 1 }, base);

    const item = (r: typeof primeira) =>
      (r.conteudo as { grupos: { atributo: string; equipamento: string }[] }).grupos[0];
    const c1 = primeira.conteudo as { apartirDe: number; restantes: number };

    expect(c1.apartirDe).toBe(0);
    expect(c1.restantes).toBeGreaterThan(0);
    /*
      A asserção que impede "paginou" de querer dizer "devolveu outra vez o
      mesmo": o segundo item tem de ser um item diferente do primeiro.
    */
    expect(item(segunda)).not.toEqual(item(primeira));
  }, 120_000);

  it("o total avisa quando há filtro em pé — ele não é do equipamento", async () => {
    const r = await executar(registroPadrao(), "alteracoes", { nivel: "total" }, {
      db,
      recorte: {},
      filtros: { equipamento: "CAVALO" },
    });
    const c = r.conteudo as { avisoDoFiltro?: string };
    expect(c.avisoDoFiltro, "sem o aviso, um total da frota vira total dos cavalos").toContain(
      "frota inteira",
    );
    expect(c.avisoDoFiltro).toContain("grupos");
  }, 120_000);
});
