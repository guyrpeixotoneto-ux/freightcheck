import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { resolveContext } from "@workspace/comparison";
import { interpretar } from "../interpretacao";
import { planejar } from "../plano";
import { orquestrar } from "../orquestrador";
import { semearBookDeTeste } from "./fixtures/book";

/**
 * A Fase 5 — o assistente deixa de esperar a pergunta certa.
 *
 * As fases anteriores corrigiram o caminho entre a pergunta e o dossiê. Estas
 * duas capacidades são sobre o que ele faz **por conta própria** quando a
 * pergunta não sabe o que pedir: ordenar o que merece atenção, e ir ler a regra
 * do que ele mesmo acabou de descobrir que pesa.
 */

describe("a ordem do plano separa o que foi pedido do que foi acrescentado", () => {
  const plano = (pergunta: string) =>
    planejar({
      pergunta,
      leitura: interpretar(pergunta),
      assunto: null,
      temConversa: false,
      herdada: null,
      temRegraDoBook: false,
    });

  /*
    Os dois lados da mesma regra, e a razão de ela existir. Uma ordem fixa tinha
    de errar num destes dois casos.
  */
  it("quem pede alterações recebe alterações — com a fila junto", () => {
    const p = plano("Quais foram as principais alterações de agosto?");
    expect(p.principal).toBe("MOVIMENTO");
    expect(p.necessidades).toContain("ATENCAO");
  });

  it("quem não pede nada explicitamente recebe a fila", () => {
    for (const pergunta of [
      "O que eu deveria investigar primeiro?",
      "Tem alguma coisa fora do padrão?",
      "Me diga apenas o que merece minha atenção.",
      "Resuma agosto para a diretoria.",
    ]) {
      expect(plano(pergunta).principal, pergunta).toBe("ATENCAO");
    }
  });

  it("e o conceito continua ganhando quando a frase pede conceito", () => {
    expect(
      plano(
        "Explique isso como se estivesse falando com o diretor da operação.",
      ).principal,
    ).toBe("CONCEITUAL");
  });
});

import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

rodar("Fase 5 — o que o assistente faz por conta própria", () => {
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
    ---- P3.2 -----------------------------------------------------------------

    A fila de investigação existia no motor e alimentava a tela de Alterações; o
    assistente não a alcançava. "Tem algo fora do padrão?" recebia o agregado da
    vigência — verdadeiro, e sem nenhuma opinião sobre o que estava fora do
    padrão.
  */
  describe("P3.2 — a fila de investigação", () => {
    it("responde o que merece atenção, ordenado e com o porquê", async () => {
      const dossie = await orquestrar(
        db,
        "O que eu deveria investigar primeiro?",
      );
      const fila = dossie.evidencias.find(
        (e) => e.ferramenta === "filaDeInvestigacao",
      );

      expect(fila, "a pergunta tinha de montar a fila").toBeTruthy();
      expect(fila!.fatos.length).toBeGreaterThan(0);

      /*
        Cada posição diz de que parâmetro fala. Sem isso, dois grupos que
        sofreram a mesma coisa viram duas linhas idênticas e a fila perde a
        única função que tem — dizer por onde começar.
      */
      const rotulos = fila!.fatos.map((f) => f.rotulo);
      expect(
        new Set(rotulos).size,
        `posições repetidas: ${rotulos.join(" | ")}`,
      ).toBe(rotulos.length);

      /*
        E cada posição diz por que está ali. Uma ordem sem motivos é um oráculo,
        e este produto não exibe o que não pode sustentar.
      */
      expect(fila!.fatos.every((f) => Boolean(f.detalhe))).toBe(true);
    });

    it("o movimento da vigência acompanha, para dar tamanho ao que foi ordenado", async () => {
      const dossie = await orquestrar(db, "Tem alguma coisa fora do padrão?");
      const ferramentas = dossie.evidencias.map((e) => e.ferramenta);
      expect(ferramentas).toContain("filaDeInvestigacao");
      expect(ferramentas).toContain("resumoDaVigencia");
    });

    it("uma pergunta de parâmetro não monta fila nenhuma", async () => {
      const dossie = await orquestrar(
        db,
        "Quanto mudou o pneu desde dezembro?",
      );
      expect(dossie.evidencias.map((e) => e.ferramenta)).not.toContain(
        "filaDeInvestigacao",
      );
    });
  });

  /*
    ---- P3.3 -----------------------------------------------------------------

    Quem pergunta "o que devo investigar?" não sabe o nome do parâmetro que vai
    sair na frente — e por isso não tem como pedir a regra dele na mesma frase.
    A primeira busca no Book usou as palavras da pergunta, que não continham o
    assunto porque ele ainda não era conhecido.
  */
  describe("P3.3 — o segundo salto", () => {
    it("vai buscar a regra do que a consulta descobriu que pesa", async () => {
      const dossie = await orquestrar(
        db,
        "O que eu deveria investigar primeiro?",
      );

      expect(dossie.etapas.map((e) => e.nome)).toContain("segundoSalto");
      expect(
        dossie.documentos.length,
        "o salto tinha de trazer a regra do assunto em destaque",
      ).toBeGreaterThan(0);
    });

    it("não salta quando a primeira busca já respondeu com confiança", async () => {
      const dossie = await orquestrar(db, "O que o Book diz sobre pneu?");
      expect(dossie.etapas.map((e) => e.nome)).not.toContain("segundoSalto");
      expect(dossie.documentos[0]?.trecho.bloco).toBe("PNEU");
    });

    /*
      O limiar continua decidindo depois do salto: um assunto sem regra
      registrada não traz nada, e o silêncio é a resposta correta.
    */
    it("e o que ele traz continua passando pelo limiar", async () => {
      const dossie = await orquestrar(
        db,
        "O que eu deveria investigar primeiro?",
      );
      for (const documento of dossie.documentos) {
        expect(documento.pontos).toBeGreaterThanOrEqual(0.35);
      }
    });
  });
});
