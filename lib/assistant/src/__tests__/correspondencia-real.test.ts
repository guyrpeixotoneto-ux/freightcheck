/**
 * O portão de correspondência atravessando a pilha inteira, contra o banco real.
 *
 * `correspondencia.test.ts`, ao lado, prova a regra como função pura. Este prova
 * o que só o caminho inteiro pode provar: que a recusa **chega à resposta** —
 * que o material substituído sai do dossiê, que a lacuna aparece, que o vizinho
 * vive em `desambiguacao` e não no texto, e que quem escreve a resposta não
 * desfaz a decisão da orquestração.
 *
 * A divisão importa: foi exatamente entre essas duas camadas que o defeito
 * conseguiu se esconder da primeira vez. A orquestração recuperava um vizinho, a
 * redação o escrevia como resposta, e nenhuma das duas achava que estava
 * trocando nada.
 *
 * Sem `ASSISTANT_EVAL_DATABASE_URL` (ou `DATABASE_URL`) esta suíte não roda: as
 * perguntas precisam de um banco com o export promovido, senão elas passariam
 * por falta de dado em vez de por causa do portão — que é o falso verde mais
 * caro que este arquivo poderia produzir. Quem decide o que fazer com a
 * ausência é `comBancoDeAvaliacao`: na máquina de quem desenvolve, pula e diz
 * por quê; no CI, reprova, porque lá um `skip` silencioso é o verde valendo
 * menos do que diz.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { responder, type Resposta } from "../resposta";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

let db: Database;

/** As respostas são caras; cada pergunta roda uma vez e os casos leem daqui. */
const respostas = new Map<string, Resposta>();

const PERGUNTAS = [
  "Me explique o QLP ADMINISTRATIVO DE FROTA.",
  "Qual o IPVA do cavalo XYZ9Z99?",
  "Como está a operação de Uberlândia?",
  "O que o Book do Operador diz sobre CONSUMO?",
  "O que o Book diz sobre IPVA?",
  "Me fale sobre manutenção.",
  "O que mudou na última vigência?",
  "Qual foi o impacto financeiro de julho/2026 para agosto/2026?",
  "Quais veículos foram mais impactados em agosto/2026?",
  "Qual o valor de Manutenção cavalo em agosto/2026?",
];

const de = (pergunta: string): Resposta => {
  const r = respostas.get(pergunta);
  if (!r) throw new Error(`sem resposta para "${pergunta}"`);
  return r;
};

rodar("o portão de correspondência, de ponta a ponta", () => {
  beforeAll(async () => {
    db = createDb(URL_DO_BANCO!).db;
    for (const p of PERGUNTAS) {
      // `semIa` porque o que se mede é o dossiê e a decisão, não a redação do
      // modelo — e porque a suíte tem de valer num ambiente sem chave.
      respostas.set(p, await responder(db, p, { semIa: true }));
    }
  }, 300_000);

  describe("placa que não existe no recorte", () => {
    const pergunta = "Qual o IPVA do cavalo XYZ9Z99?";

    it("declara NAO_ENCONTREI em vez de responder", () => {
      expect(de(pergunta).lacunas.map((l) => l.tipo)).toContain("NAO_ENCONTREI");
    });

    it("não cai na regra genérica do Book como se fosse dado daquela placa", () => {
      const r = de(pergunta);
      /*
        Era isto que acontecia: o dossiê vinha com `CUSTO FIXO DE EQUIPAMENTOS ›
        IPVA`, e a resposta abria em "### Componentes — Depreciação e
        amortização…". Nada ali era falso; tudo ali se lia como sendo daquele
        veículo.
      */
      expect(r.fontes).toHaveLength(0);
      expect(r.texto).not.toMatch(/depreciação e amortização/i);
      expect(r.texto).toMatch(/XYZ9Z99/);
      expect(r.texto).toMatch(/não encontrei/i);
    });

    it("não oferece outra placa como candidata", () => {
      expect(de(pergunta).desambiguacao).toBeNull();
    });
  });

  describe("unidade que não existe", () => {
    const pergunta = "Como está a operação de Uberlândia?";

    it("declara NAO_ENCONTREI e não responde com conteúdo de outra tela", () => {
      const r = de(pergunta);
      expect(r.lacunas.map((l) => l.tipo)).toContain("NAO_ENCONTREI");
      expect(r.fontes).toHaveLength(0);
      // O cartão "Parâmetros operação" do catálogo era a resposta anterior.
      expect(r.texto).not.toMatch(/parâmetros operação/i);
      expect(r.texto).toMatch(/Uberlândia/);
    });
  });

  describe("bloco que não existe", () => {
    const pergunta = "Me explique o QLP ADMINISTRATIVO DE FROTA.";

    it("não troca silenciosamente por DESCONTO QLP ADM", () => {
      const r = de(pergunta);
      expect(r.lacunas.map((l) => l.tipo)).toContain("NAO_ENCONTREI");
      expect(r.fontes).toHaveLength(0);
      // A resposta anterior abria com "## DESCONTO QLP ADM ### Objetivo …".
      expect(r.texto).not.toMatch(/define o desconto aplicado/i);
    });

    it("o candidato próximo aparece em desambiguacao, e o texto pergunta por ele", () => {
      const r = de(pergunta);
      expect(r.desambiguacao).not.toBeNull();
      expect(r.desambiguacao!.opcoes.join(" ")).toMatch(/QLP ADM/);
      expect(r.texto).toMatch(/não encontrei/i);
      expect(r.texto).toMatch(/quis dizer/i);
    });
  });

  describe("as correspondências válidas continuam respondendo", () => {
    it.each([
      ["O que o Book do Operador diz sobre CONSUMO?", /consumo/i],
      ["O que o Book diz sobre IPVA?", /ipva/i],
      ["Me fale sobre manutenção.", /manutenção/i],
    ])("%s", (pergunta, esperado) => {
      const r = de(pergunta);
      expect(r.lacunas.map((l) => l.tipo)).not.toContain("NAO_ENCONTREI");
      expect(r.fontes.length).toBeGreaterThan(0);
      expect(r.texto).toMatch(esperado);
    });

    it.each([
      "O que mudou na última vigência?",
      "Qual foi o impacto financeiro de julho/2026 para agosto/2026?",
      "Quais veículos foram mais impactados em agosto/2026?",
      "Qual o valor de Manutenção cavalo em agosto/2026?",
    ])("as perguntas de dado seguem com evidência: %s", (pergunta) => {
      const r = de(pergunta);
      expect(r.lacunas.map((l) => l.tipo)).not.toContain("NAO_ENCONTREI");
      expect(r.fontes.length).toBeGreaterThan(0);
    });
  });

  describe("a lacuna do qualificador não inventa mais coluna", () => {
    it("nem ano, nem mês, nem número viram 'coluna ausente'", () => {
      /*
        `Qual o valor de Manutenção cavalo em agosto/2026?` produzia, por
        `orquestrador.ts`, a frase "não traz valor, 2026" e mais adiante "a conta
        completa de valor, 2026 por equipamento": o assistente afirmando que
        falta uma coluna chamada 2026.
      */
      const texto = de("Qual o valor de Manutenção cavalo em agosto/2026?").lacunas
        .map((l) => l.explicacao)
        .join(" ");

      expect(texto).not.toMatch(/não traz[^.]*\b2026\b/);
      expect(texto).not.toMatch(/conta completa de[^.]*\b2026\b/);
      expect(texto).not.toMatch(/\bagosto\b/);
    });
  });
});
