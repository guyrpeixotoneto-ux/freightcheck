import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@workspace/db";
import { resolveContext } from "@workspace/comparison";
import { semearBookDeTeste } from "./fixtures/book";
import { orquestrar } from "../orquestrador";
import { responder } from "../resposta";
import { ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";

/**
 * Os quatro defeitos da Fase 1, cada um como o teste que o reproduz.
 *
 * Estes casos nasceram da auditoria, e não de uma suspeita: cada `describe`
 * abaixo é um comportamento que foi observado no banco real e que a correção
 * precisa eliminar. Eles ficam separados da bateria porque a bateria mede
 * cobertura — quantas perguntas o assistente responde bem — e estes medem
 * ausência: nenhum deles pode voltar a passar por acidente.
 *
 * Sem `ASSISTANT_EVAL_DATABASE_URL` a suíte não roda: os quatro dependem de um
 * banco com o export promovido, e três deles dependem de qual é o estado
 * derivado desse banco no instante da pergunta.
 */

import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

rodar("Fase 1 — confiabilidade e perda da pergunta", () => {
  let db: Database;

  beforeAll(async () => {
    ({ db } = createDb(URL_DO_BANCO!));
    expect(
      await resolveContext(db),
      "esta suíte precisa de um banco promovido",
    ).toBeTruthy();
    await semearBookDeTeste(db);
  });

  /*
    ---- P0.1 -----------------------------------------------------------------

    O conjunto de alteração é estado derivado, materializado por quem abre a
    tela de Alterações. O assistente só o lia — e lia ausência de linha como
    ausência de movimento, que é a pior resposta que este produto pode dar:
    "0 alterações" com fonte citada, num banco com 124 mil fatos.

    O teste apaga o estado derivado antes de perguntar. É a forma exata do
    defeito em produção: um banco recém-promovido em que ninguém abriu a tela.
  */
  describe("P0.1 — o conjunto de alteração é garantido antes de responder", () => {
    it("responde o movimento real num banco sem nenhum change set calculado", async () => {
      await db.execute(sql`DELETE FROM change`);
      await db.execute(sql`DELETE FROM change_set`);

      const dossie = await orquestrar(db, "Teve alteração na remuneração?");
      const resumo = dossie.evidencias.find(
        (e) => e.ferramenta === "resumoDaVigencia",
      );

      expect(
        resumo,
        "a pergunta tinha de consultar o resumo da vigência",
      ).toBeTruthy();

      const alteracoes = resumo!.fatos.find((f) => f.rotulo === "Alterações");
      expect(
        alteracoes?.valor,
        "sem o change set garantido, esta pergunta responde 0 e parece uma consulta legítima",
      ).not.toBe("0");
      expect(
        resumo!.numeros.some((n) => n > 0),
        "nenhum número maior que zero",
      ).toBe(true);
    });

    it("é idempotente: perguntar de novo não recalcula nem muda o número", async () => {
      const primeira = await orquestrar(db, "Teve alteração na remuneração?");
      const segunda = await orquestrar(db, "Teve alteração na remuneração?");

      const numero = (d: typeof primeira) =>
        d.evidencias
          .find((e) => e.ferramenta === "resumoDaVigencia")
          ?.fatos.find((f) => f.rotulo === "Alterações")?.valor;

      expect(numero(segunda)).toBe(numero(primeira));
    });
  });

  /*
    ---- P0.2 -----------------------------------------------------------------

    `extrairTermoDoParametro` devolvia tudo o que não estivesse numa lista de
    bloqueio escrita à mão. Qualquer palavra que faltasse na lista virava nome
    de parâmetro, não resolvia, e o portão `alvoPerdido` desligava todas as
    consultas — a pergunta terminava sem evidência nenhuma.

    O que separa os dois grupos abaixo não é o assunto: é se a pessoa **nomeou
    uma coisa**. Quem não nomeou recebe o agregado; quem nomeou algo que o
    produto conhece sem ter coluna recebe a lacuna. Nenhum dos dois pode
    terminar sem consultar nada.
  */
  describe("P0.2 — resíduo da frase não vira parâmetro fantasma", () => {
    const semAssuntoProprio = [
      "Qual foi o impacto dessas alterações?",
      "Quanto isso custou?",
      "Quais são as três alterações mais importantes?",
      "Tem alguma alteração relevante que eu deveria investigar?",
      "Quais mudanças podem reduzir minha remuneração?",
      "cê consegue ver o que mudou?",
    ];

    it.each(semAssuntoProprio)(
      "%s → consulta o agregado, não um fantasma",
      async (pergunta) => {
        const dossie = await orquestrar(db, pergunta);

        expect(
          dossie.plano.alvo,
          `"${pergunta}" não nomeia gaveta nenhuma — nenhum alvo deveria ser resolvido`,
        ).toBeNull();
        expect(
          dossie.evidencias.length,
          `"${pergunta}" terminou sem consultar nada`,
        ).toBeGreaterThan(0);
        expect(
          dossie.lacunas.map((l) => l.tipo),
          "não existe assunto inexistente quando não houve assunto",
        ).not.toContain("NAO_EXISTE_NO_PRODUTO");
      },
    );

    it("o que a pessoa nomeia e o produto conhece sem ter coluna continua virando lacuna", async () => {
      const dossie = await orquestrar(db, "Quanto mudou o pedágio?");
      expect(
        dossie.lacunas.length,
        "pedágio existe no Book e não no export — isso é uma lacuna, não um agregado",
      ).toBeGreaterThan(0);
    });

    it("uma gaveta de verdade continua sendo resolvida", async () => {
      const dossie = await orquestrar(
        db,
        "Quanto mudou o pneu desde dezembro?",
      );
      expect(dossie.plano.alvo?.parametro).toMatch(/pneu/i);
    });
  });

  /*
    ---- P1.4 -----------------------------------------------------------------

    "E nos cavalos?" resolvia para a gaveta "Manutenção cavalo" — o nome do
    equipamento casava o nome de uma gaveta que por acaso o contém. A resposta
    ficava verdadeira sobre um assunto que ninguém pediu.
  */
  describe("P1.4 — equipamento é dimensão, não gaveta", () => {
    it.each([
      "E nos cavalos?",
      "O que mudou na remuneração dos cavalos?",
      "e o cavalo?",
    ])(
      "%s não resolve para uma gaveta que só contém a palavra",
      async (pergunta) => {
        const dossie = await orquestrar(db, pergunta, {
          estado: { ...ESTADO_VAZIO, intencao: "MOVIMENTO" },
        });
        expect(
          dossie.plano.alvo?.parametro ?? null,
          `"${pergunta}" nomeia um equipamento, não uma gaveta`,
        ).toBeNull();
        expect(dossie.leitura.entidades.equipamento).toBe("CAVALO");
        expect(
          dossie.evidencias.length,
          "e mesmo assim tem de consultar",
        ).toBeGreaterThan(0);
      },
    );

    it("a carreta é reconhecida pelo mesmo caminho", async () => {
      const dossie = await orquestrar(db, "O que mudou nas carretas?");
      expect(dossie.leitura.entidades.equipamento).toBe("CARRETA");
      expect(dossie.plano.alvo?.parametro ?? null).toBeNull();
    });
  });

  /*
    ---- P1.3 -----------------------------------------------------------------

    O estado guardava o resíduo cru. Um turno que não resolvia nada gravava
    lixo — `assunto: "maior"` —, e os turnos seguintes herdavam esse
    lixo e paravam de consultar. A conversa degradava e não se recuperava.

    Esta é a sequência exata da auditoria, e ela é obrigatória.
  */
  describe("P1.3 — o estado só guarda conhecimento resolvido", () => {
    it("a sequência de cinco turnos não perde o fio", async () => {
      const sequencia = [
        "O que mudou em agosto?",
        "E nos cavalos?",
        "Qual teve maior impacto?",
        "Por quê?",
        "O Book fala alguma coisa sobre isso?",
      ];

      let estado: EstadoDaConversa = ESTADO_VAZIO;
      const consultas: number[] = [];

      for (const pergunta of sequencia) {
        const resposta = await responder(db, pergunta, { estado, semIa: true });
        consultas.push(resposta.tecnico.ferramentas.length);

        expect(
          resposta.estado.assunto ?? "",
          `turno "${pergunta}" gravou resíduo no estado`,
        ).not.toMatch(/^(maior|isso|dessas|relevante|ver)$/i);

        expect(
          resposta.estado.periodo?.mes,
          `turno "${pergunta}" perdeu a vigência da conversa`,
        ).toBe("agosto");

        estado = resposta.estado;
      }

      expect(
        consultas.filter((n) => n === 0).length,
        `turnos sem consulta nenhuma: ${JSON.stringify(consultas)}`,
      ).toBe(0);
    });

    it("um turno que não resolve assunto não apaga o assunto anterior", async () => {
      const primeira = await responder(db, "Quanto mudou o pneu?", {
        semIa: true,
      });
      expect(primeira.estado.parametro).toMatch(/pneu/i);

      const segunda = await responder(db, "Qual teve maior impacto?", {
        estado: primeira.estado,
        semIa: true,
      });
      expect(
        segunda.estado.parametro,
        "um turno sem assunto próprio não pode apagar o da conversa",
      ).toBe(primeira.estado.parametro);
    });
  });

  /*
    ---- P0.3 -----------------------------------------------------------------

    A busca no Book só rodava quando havia assunto extraído — e "remuneração"
    estava na lista de bloqueio, então a pergunta mais frequente do produto
    nunca chegava ao Book. A correção não é jogar Book em toda resposta: é
    procurar sempre e deixar o limiar decidir o que entra.
  */
  describe("P0.3 — o Book não depende de haver assunto extraído", () => {
    it("uma pergunta sobre remuneração de pneu alcança o Book", async () => {
      const dossie = await orquestrar(
        db,
        "Teve alteração na remuneração de pneu?",
      );
      expect(
        dossie.documentos.length,
        "a busca no Book tinha de ter rodado e encontrado o bloco",
      ).toBeGreaterThan(0);
    });

    it("procurar sempre não significa entregar sempre: o limiar continua decidindo", async () => {
      const dossie = await orquestrar(db, "Quantos veículos temos no banco?");
      for (const documento of dossie.documentos) {
        expect(documento.pontos).toBeGreaterThanOrEqual(0.35);
      }
    });

    it("uma saudação continua não procurando nada", async () => {
      const dossie = await orquestrar(db, "bom dia");
      expect(dossie.documentos).toHaveLength(0);
      expect(dossie.evidencias).toHaveLength(0);
    });
  });
});
