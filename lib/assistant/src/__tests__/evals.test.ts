import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@workspace/db";
import { getFamiliesView, listPeriods, resolveContext } from "@workspace/comparison";
import {
  citacoesSemFonte,
  itensCitaveis,
  numerosSemLastro,
  orquestrar,
} from "../orquestrador";
import { responder } from "../resposta";
import { avancarEstado, ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import { resolverParametro } from "../parametros";
import { CASOS, CONVERSAS } from "./bateria";
import { semearBookDeTeste } from "./fixtures/book";

/**
 * A bateria — perguntas reais contra o banco real.
 *
 * **Por que ela não usa mock.** Um assistente que responde certo sobre dados
 * inventados não prova nada: o defeito que importa é o número que diverge da
 * tela, e ele só aparece quando os dois olham a mesma linha. Cada caso
 * quantitativo aqui executa **também** o serviço que a tela usa, e compara.
 *
 * **O que cada caso afirma.** Intenção esperada (onde o assistente foi
 * procurar), ferramenta esperada (o que ele consultou), e — quando há número —
 * o valor que o motor devolve. Um caso que passa sem essas três coisas estaria
 * medindo a fluência do texto, que é o que menos importa aqui.
 *
 * Sem `ASSISTANT_EVAL_DATABASE_URL` a suíte não roda: ela precisa de um banco
 * com o export real promovido, e inventar um banco vazio para ela passar seria
 * o mesmo que apagá-la.
 */

const URL_DO_BANCO = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const rodar = URL_DO_BANCO ? describe : describe.skip;


rodar("bateria do assistente", () => {
  let db: Database;

  beforeAll(async () => {
    ({ db } = createDb(URL_DO_BANCO!));
    const contexto = await resolveContext(db);
    expect(contexto, "a bateria precisa de um banco com vigência promovida").toBeTruthy();
    await semearBookDeTeste(db);
  });

  describe("intenção e ferramenta", () => {
    it.each(CASOS)("$pergunta", async (caso) => {
      const dossie = await orquestrar(db, caso.pergunta);

      expect(dossie.plano.intencao, `intenção de "${caso.pergunta}"`).toBe(caso.intencao);

      if (caso.ferramentas) {
        const usadas = dossie.evidencias.map((e) => e.ferramenta);
        expect(
          caso.ferramentas.some((f) => usadas.includes(f)),
          `esperava uma de [${caso.ferramentas}], usou [${usadas}]`,
        ).toBe(true);
      }

      if (caso.lacuna) {
        expect(
          dossie.lacunas.map((l) => l.tipo),
          `lacuna de "${caso.pergunta}"`,
        ).toContain(caso.lacuna);
      }

      if (caso.semLacuna) {
        expect(
          dossie.lacunas.map((l) => l.explicacao),
          `"${caso.pergunta}" foi respondida e não deve declarar lacuna`,
        ).toEqual([]);
      }

      if (caso.desambigua) {
        expect(dossie.desambiguacao, `"${caso.pergunta}" precisa perguntar de volta`).toBeTruthy();
        expect(dossie.desambiguacao!.opcoes.length).toBeGreaterThan(1);
      }

      /*
        Pergunta conceitual não pode arrastar vigência.

        É o defeito que originou esta reescrita: "como funciona o combustível?"
        respondia com o resumo de agosto. Nenhuma evidência com recorte de
        vigência pode entrar numa resposta conceitual.
      */
      if (caso.semRecorte) {
        const comVigencia = dossie.evidencias.filter((e) => e.recorte?.vigencia);
        expect(
          comVigencia.map((e) => e.titulo),
          "resposta conceitual não carrega vigência",
        ).toEqual([]);
      }

      const resposta = await responder(db, caso.pergunta, { semIa: true });
      for (const texto of caso.contem ?? []) {
        expect(resposta.texto.toLowerCase()).toContain(texto.toLowerCase());
      }
      for (const texto of caso.naoContem ?? []) {
        expect(resposta.texto).not.toContain(texto);
      }
    });
  });

  // ── confronto de números ───────────────────────────────────────────────────

  describe("os números batem com o motor", () => {
    it("o resumo da vigência cita o que getFamiliesView devolve", async () => {
      const contexto = await resolveContext(db);
      const visao = await getFamiliesView(db, undefined, contexto!);
      expect(visao).toBeTruthy();

      const resposta = await responder(db, "O que mudou na última vigência?", { semIa: true });

      const alteracoes = visao!.summary.changes.toLocaleString("pt-BR");
      const veiculos = visao!.summary.vehiclesTouched.toLocaleString("pt-BR");
      expect(resposta.texto, "alterações").toContain(alteracoes);
      expect(resposta.texto, "veículos").toContain(veiculos);
    });

    it("o parâmetro cita o que a tela de Parâmetros mostra", async () => {
      const contexto = await resolveContext(db);
      const visao = await getFamiliesView(db, undefined, contexto!);
      const gaveta = visao!.families
        .flatMap((f) => f.parameters)
        .find((p) => p.changes > 0);
      expect(gaveta, "o banco precisa ter alguma gaveta que mudou").toBeTruthy();

      const resposta = await responder(db, `quanto mudou ${gaveta!.name}?`, { semIa: true });
      expect(resposta.texto).toContain(gaveta!.changes.toLocaleString("pt-BR"));
    });

    it("nenhum número da resposta fica sem lastro", async () => {
      for (const pergunta of [
        "O que mudou em agosto?",
        "Onde perdemos mais dinheiro?",
        "Quais veículos foram mais impactados?",
        "O que temos importado?",
      ]) {
        const resposta = await responder(db, pergunta, { semIa: true });
        expect(resposta.tecnico.numerosRecusados, pergunta).toEqual([]);
      }
    });
  });

  // ── citações ───────────────────────────────────────────────────────────────

  describe("toda citação aponta para uma fonte que existe", () => {
    it("a numeração do texto casa com a lista de fontes", async () => {
      for (const pergunta of [
        "Como funciona preço de combustível?",
        "O que mudou em agosto?",
        "Onde perdemos mais dinheiro?",
        "Qual a regra do bloco PNEU?",
      ]) {
        const resposta = await responder(db, pergunta, { semIa: true });
        const citadas = [...resposta.texto.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
        for (const n of citadas) {
          expect(
            resposta.fontes.some((f) => f.id === String(n)),
            `"${pergunta}" citou [${n}] com ${resposta.fontes.length} fontes`,
          ).toBe(true);
        }
      }
    });

    it("uma citação além das fontes é recusada como número inventado", async () => {
      const dossie = await orquestrar(db, "O que mudou em agosto?");
      // A contagem vem de `itensCitaveis`, que é a única que numera — antes
      // este teste refazia a soma à mão e passaria a divergir dela em silêncio.
      const quantas = itensCitaveis(dossie).length;

      expect(citacoesSemFonte(`Mudou bastante [${quantas}].`, dossie)).toEqual([]);
      expect(citacoesSemFonte(`Mudou bastante [${quantas + 1}].`, dossie)).toEqual([
        `[${quantas + 1}]`,
      ]);
    });

    it("o marcador de citação não conta como número sem lastro", async () => {
      /*
        `[10]` é "a décima fonte", não a quantia dez. Sem esta separação, a
        própria instrução de citar derrubaria toda resposta que chegasse à
        décima fonte — e são as respostas mais ricas que chegam lá.
      */
      const dossie = await orquestrar(db, "O que mudou em agosto?");
      expect(numerosSemLastro("Houve alteração no período [10].", dossie)).toEqual([]);
      expect(numerosSemLastro("Houve 9999 alterações no período.", dossie)).toContain("9999");
    });
  });

  // ── etapas ─────────────────────────────────────────────────────────────────

  describe("as etapas relatadas são as que rodaram", () => {
    it("cada etapa chega pelo callback, na ordem, e nenhuma a mais", async () => {
      const recebidas: string[] = [];
      const dossie = await orquestrar(db, "O que mudou em agosto?", {
        aoAvancar: (e) => recebidas.push(e.rotulo),
      });
      expect(recebidas).toEqual(dossie.etapas.map((e) => e.rotulo));
      expect(recebidas.length).toBeGreaterThan(0);
    });

    it("pergunta conceitual não anuncia cálculo de impacto", async () => {
      /*
        A tela animava uma lista fixa por tempo, e dizia "calculando impacto"
        para uma pergunta que nunca calcula impacto. Agora só sai o que rodou.
      */
      const recebidas: string[] = [];
      await orquestrar(db, "Como funciona preço de combustível?", {
        aoAvancar: (e) => recebidas.push(e.rotulo),
      });
      expect(recebidas.join(" | ")).not.toMatch(/impacto|alteraç|vigência/i);
    });
  });

  // ── o documento do Book ────────────────────────────────────────────────────

  /**
   * Estes três casos são a conversa que chegou da tela.
   *
   * Alguém perguntou a regra de um bloco cujo conteúdo é um arquivo anexado e
   * ouviu, do assistente, que ele não transcreve documento que não leu — com o
   * documento já dentro do dossiê. Depois perguntou por um bloco sem casar
   * padrão nenhum ("QLP ADM como está de Camaçari?"), e o Book nem foi
   * consultado. E as duas respostas terminavam repetindo o parágrafo com que
   * tinham começado.
   */
  describe("o bloco que tem arquivo entrega o arquivo", () => {
    /** O bloco com documento anexado que este banco tiver — se tiver algum. */
    async function blocoComDocumento(): Promise<string | null> {
      const { rows } = await db.execute<{ titulo: string }>(sql`
        SELECT block_title AS titulo
          FROM book_entry
         WHERE kind = 'DOCUMENTO'
         ORDER BY revision DESC
         LIMIT 1
      `);
      return rows[0]?.titulo ?? null;
    }

    it("o conteúdo do documento entra no dossiê, com bloco e seção", async () => {
      const titulo = await blocoComDocumento();
      if (!titulo) return; // Banco sem documento anexado não tem o que provar.

      const dossie = await orquestrar(db, `qual a regra de ${titulo}?`);

      /*
        Formato legado (.doc, .xls antigos) e arquivo acima do teto continuam
        sem leitura — e aí a ressalva do registro tem de dizer isso. Nos demais,
        o texto do documento é o que responde.
      */
      const registro = dossie.evidencias.find((e) => e.ferramenta === "regraDoBook");
      if (dossie.documentos.length === 0) {
        expect(registro?.nota ?? "").toMatch(/não pôde ser lido/i);
        return;
      }

      const primeiro = dossie.documentos[0].trecho;
      expect(primeiro.texto.length, "o trecho traz conteúdo, não metadado").toBeGreaterThan(20);
      expect(primeiro.bloco).toBeTruthy();
      expect(registro?.nota ?? "", "documento lido não carrega ressalva").toBe("");
    });

    /*
      O conteúdo do Book é conferível como qualquer outra evidência: os números
      escritos no documento passam a ter lastro porque o texto deles está no
      dossiê. Era a diferença entre uma resposta rica ser publicada e ser
      descartada.
    */
    it("os números do documento têm lastro", async () => {
      const titulo = await blocoComDocumento();
      if (!titulo) return;

      const dossie = await orquestrar(db, `qual a regra de ${titulo}?`);
      const numeros = (dossie.documentos[0]?.trecho.texto ?? "").match(/\d[\d.,]*/g) ?? [];
      const comDoisDigitos = numeros.find((n) => n.replace(/\D/g, "").length > 1);
      if (!comDoisDigitos) return;

      expect(numerosSemLastro(`O documento diz ${comDoisDigitos} [1].`, dossie)).toEqual([]);
    });

    it("nomear o bloco basta, mesmo quando a pergunta não parece do Book", async () => {
      const titulo = await blocoComDocumento();
      if (!titulo) return;

      // Sem "book", sem "regra", sem verbo de valor: a forma que caía em
      // DESCONHECIDA e era respondida só pelo índice.
      const dossie = await orquestrar(db, `${titulo} como está de Camaçari?`);
      expect(dossie.plano.intencao).toBe("DESCONHECIDA");
      expect(
        dossie.documentos.length + dossie.evidencias.length,
        "o Book é consultado por qualquer pergunta que nomeie assunto",
      ).toBeGreaterThan(0);
    });

    /*
      Multi-fonte: a mesma pergunta que pede a regra e o movimento tem de sair
      com as duas coisas. Antes não havia caminho que trouxesse as duas — a
      intenção escolhia uma e a outra não era nem consultada.
    */
    it("uma pergunta pode combinar Book e dado na mesma resposta", async () => {
      const dossie = await orquestrar(db, "o que o Book diz sobre pneu e quanto ele mudou?");
      expect(dossie.documentos.length + dossie.trechos.length).toBeGreaterThan(0);
    });

    it("a resposta não mostra a mecânica do Book a quem perguntou", async () => {
      const titulo = await blocoComDocumento();
      if (!titulo) return;

      const resposta = await responder(db, `o que é ${titulo}?`, { semIa: true });
      for (const proibido of ["Revisão vigente", "revisão guardada", "documento anexado"]) {
        expect(resposta.texto, `"${proibido}" não pertence a uma resposta`).not.toContain(proibido);
      }
    });

    it("a redação em código não repete o parágrafo com que abriu", async () => {
      for (const pergunta of [
        "O que é o Book do Operador?",
        "Qual a regra do bloco PNEU?",
        "Como funciona IPVA?",
      ]) {
        const resposta = await responder(db, pergunta, { semIa: true });
        const paragrafos = resposta.texto
          .split(/\n{2,}/)
          .map((p) => p.replace(/\s*\[\d{1,2}\]\s*$/, "").trim())
          // Linha curta pode repetir sem ser repetição: um rótulo, um "—".
          .filter((p) => p.length > 40);
        expect(new Set(paragrafos).size, `"${pergunta}" repetiu um parágrafo`).toBe(
          paragrafos.length,
        );
      }
    });
  });

  // ── isolamento de contexto ─────────────────────────────────────────────────

  describe("isolamento por unidade e canal", () => {
    it("toda evidência com número declara o recorte que a produziu", async () => {
      for (const pergunta of [
        "O que mudou em agosto?",
        "Onde perdemos mais dinheiro?",
        "O que temos importado?",
        "Quais vigências existem?",
        "Quais veículos foram mais impactados?",
      ]) {
        const dossie = await orquestrar(db, pergunta);
        for (const e of dossie.evidencias) {
          // O Book não tem recorte: uma regra vale para o contrato, não para
          // uma operação. Fora dele, evidência sem recorte é vazamento.
          if (e.ferramenta.toLowerCase().includes("book")) continue;
          expect(e.recorte, `${pergunta} → ${e.ferramenta}`).toBeTruthy();
        }
      }
    });

    it("uma resposta nunca mistura dois contextos", async () => {
      for (const pergunta of ["O que mudou em agosto?", "O que temos importado?"]) {
        const dossie = await orquestrar(db, pergunta);
        const contextos = new Set(
          dossie.evidencias.map((e) => e.recorte?.contexto).filter(Boolean),
        );
        expect(contextos.size, `${pergunta} citou ${[...contextos]}`).toBeLessThanOrEqual(1);
      }
    });

    it("o panorama respeita o recorte, e não soma o banco inteiro", async () => {
      const contexto = await resolveContext(db);
      const periodos = await listPeriods(db, contexto!);

      const dossie = await orquestrar(db, "o que temos importado?");
      const panorama = dossie.evidencias.find((e) => e.ferramenta === "panoramaDoContexto");
      expect(panorama, "o panorama precisa ter rodado").toBeTruthy();

      const vigencias = panorama!.fatos.find((f) => f.rotulo === "Vigências");
      expect(vigencias?.valor).toBe(periodos.length.toLocaleString("pt-BR"));
    });
  });

  // ── conversa ───────────────────────────────────────────────────────────────

  describe("continuidade da conversa", () => {
    it('"E julho?" mantém o assunto e troca o período', async () => {
      const primeira = await responder(db, "Quanto mudou o IPVA desde dezembro?", {
        semIa: true,
      });
      expect(primeira.intencao).toBe("EVOLUCAO");

      const segunda = await responder(db, "E julho?", {
        semIa: true,
        estado: primeira.estado,
      });

      expect(segunda.tecnico.herdado).toContain("assunto");
      expect(segunda.recorte, "a resposta descreve julho").toMatch(/julho/i);
      expect(segunda.intencao, "a intenção passa a ser sobre aquele mês").toBe("VALOR");
    });

    it('"Por quê?" herda o assunto e desce até a origem', async () => {
      const primeira = await responder(db, "Quanto mudou o IPVA em agosto?", { semIa: true });
      const segunda = await responder(db, "Por quê?", {
        semIa: true,
        estado: primeira.estado,
      });

      expect(segunda.intencao).toBe("PROCEDENCIA");
      expect(segunda.tecnico.herdado.length).toBeGreaterThan(0);
      expect(segunda.tecnico.ferramentas.length, "precisa consultar de novo").toBeGreaterThan(0);
    });

    it("uma pergunta nova troca o assunto em vez de herdar", async () => {
      const primeira = await responder(db, "Quanto mudou o IPVA em agosto?", { semIa: true });
      const segunda = await responder(db, "E o pneu?", {
        semIa: true,
        estado: primeira.estado,
      });
      expect(segunda.estado.assunto).toContain("pneu");
    });

    it('"E na vigência anterior?" troca só o recorte', async () => {
      const primeira = await responder(db, "O que mudou na última vigência?", { semIa: true });
      const segunda = await responder(db, "E na vigência anterior?", {
        semIa: true,
        estado: primeira.estado,
      });

      expect(segunda.tecnico.herdado.length, "precisa herdar o assunto").toBeGreaterThan(0);
      expect(segunda.recorte, "a resposta descreve outra vigência").not.toBe(primeira.recorte);
      expect(segunda.tecnico.ferramentas.length).toBeGreaterThan(0);
    });

    it('"Compare as duas." completa a outra ponta pelo estado', async () => {
      const primeira = await responder(db, "O que mudou em julho?", { semIa: true });
      const segunda = await responder(db, "Compare as duas.", {
        semIa: true,
        estado: primeira.estado,
      });

      expect(segunda.intencao).toBe("COMPARACAO");
      expect(segunda.tecnico.ferramentas).toContain("compararIntervalo");
    });

    it("uma continuação nunca sai do recorte da conversa", async () => {
      const primeira = await responder(db, "Quanto mudou o IPVA desde dezembro?", {
        semIa: true,
      });
      const contexto = primeira.estado.contexto;
      expect(contexto).toBeTruthy();

      let estado = primeira.estado;
      for (const seguinte of ["E julho?", "Por quê?", "E o pneu?"]) {
        const r = await responder(db, seguinte, { semIa: true, estado });
        estado = r.estado;
        expect(estado.contexto, `"${seguinte}" mudou de unidade/canal`).toBe(contexto);
      }
    });

    it.each(CONVERSAS)("$nome", async (conversa) => {
      let estado: EstadoDaConversa | undefined;
      for (const passo of conversa.passos) {
        const r = await responder(db, passo.pergunta, {
          semIa: true,
          ...(estado ? { estado } : {}),
        });
        estado = r.estado;

        expect(r.intencao, `"${passo.pergunta}"`).toBe(passo.intencao);
        if (passo.herda) {
          expect(r.tecnico.herdado.length, `"${passo.pergunta}" precisa herdar`).toBeGreaterThan(0);
        }
        if (passo.recorte) {
          expect(r.recorte ?? "", `recorte de "${passo.pergunta}"`).toMatch(passo.recorte);
        }
        if (passo.ferramentas) {
          expect(
            passo.ferramentas.some((f) => r.tecnico.ferramentas.includes(f)),
            `"${passo.pergunta}" esperava uma de [${passo.ferramentas}], usou [${r.tecnico.ferramentas}]`,
          ).toBe(true);
        }
        if (passo.naoVazio) {
          expect(
            r.tecnico.ferramentas.length,
            `"${passo.pergunta}" respondeu sem consultar nada`,
          ).toBeGreaterThan(0);
        }
        if (passo.semRecorte) {
          expect(r.recorte, `"${passo.pergunta}" não deve carregar vigência`).toBeNull();
        }
      }
    });

    it("o estado sobrevive a ida e volta em JSON", async () => {
      const primeira = await responder(db, "Quanto mudou o IPVA desde dezembro?", {
        semIa: true,
      });
      const estado = primeira.estado;
      expect(estado.assunto).toBe("ipva");
      expect(estado.contexto).toBeTruthy();
    });
  });

  // ── ordem das fontes ───────────────────────────────────────────────────────

  describe("a fonte certa vem primeiro", () => {
    /*
      Recuperar a fonte certa em terceiro lugar é quase o mesmo que não
      recuperá-la: a primeira é a que abre a resposta. Cada par aqui é um erro
      de ordenação que existiu e foi corrigido — não uma preferência estética.
    */
    const PARES: [string, RegExp][] = [
      // Casava "funciona" no bloco "Transferências", cujo texto de origem
      // começa com "Como funciona transferir frotas entre unidades".
      ["Como funciona IPVA?", /IPVA/i],
      // O empurrão por ligação premiava o inventário de 60 colunas da Carreta
      // tanto quanto o cartão que trata do assunto.
      ["Como funciona preço de combustível?", /^Combustível$/],
      // O título curto com uma palavra comum vencia o artigo que se chama
      // exatamente como a pergunta.
      ["por que o impacto é acumulado por periodicidade?", /total único de impacto/i],
      ["O que significa semântica UNKNOWN?", /Curadoria/i],
    ];

    it.each(PARES)("%s", async (pergunta, esperado) => {
      const dossie = await orquestrar(db, pergunta);
      expect(dossie.trechos[0]?.trecho.titulo ?? "", pergunta).toMatch(esperado);
    });
  });

  // ── resolução de parâmetro ─────────────────────────────────────────────────

  describe("resolução por vocabulário", () => {
    it("o termo de quem opera chega na gaveta certa", async () => {
      const casos: [string, string][] = [
        ["combustível", "Combustível"],
        ["IPVA", "IPVA e licenciamento"],
        ["ipvaLicenciamento", "IPVA e licenciamento"],
        ["pneu", "Pneu"],
        ["financiamento", "Financiamento"],
      ];
      for (const [termo, gaveta] of casos) {
        const r = await resolverParametro(db, termo);
        expect(r.escolhido?.parametro, `"${termo}"`).toBe(gaveta);
        expect(r.escolhido?.evidencia, `evidência de "${termo}"`).toBeTruthy();
      }
    });

    it("termo desconhecido não vira palpite", async () => {
      const r = await resolverParametro(db, "xpto quimera");
      expect(r.escolhido).toBeNull();
    });
  });

  // ── estado ─────────────────────────────────────────────────────────────────

  describe("avanço do estado", () => {
    it("guarda o que a próxima pergunta precisa herdar", async () => {
      const dossie = await orquestrar(db, "Quanto mudou o IPVA em agosto?");
      const estado: EstadoDaConversa = avancarEstado(ESTADO_VAZIO, dossie);
      expect(estado.intencao).toBeTruthy();
      expect(estado.assunto).toBe("ipva");
      expect(estado.scopeHash).toBeTruthy();
    });
  });
});
