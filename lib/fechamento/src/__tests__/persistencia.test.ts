import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  fechamentoCompetenciaTable,
  fechamentoPagamentoItemTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  abrirCompetencia,
  apurarCompetencia,
  buscarCompetencia,
  lerResumoDoMes,
  TipoDeOperacaoAusente,
  descartarDadosDaCompetencia,
  encerrarCompetencia,
  excluirCompetencia,
  explicarPainelAusente,
  fraseDoPainelAusente,
  informarTipoDeOperacao,
  lerApuracaoVigente,
  lerDiaDaCompetencia,
  lerDiarioDaCompetencia,
  listarApuracoes,
  listarCompetencias,
  listarDocumentos,
  listarPartes,
  reabrirCompetencia,
  reimportarDocumento,
  lerConteudoDoDocumento,
  lerDeParaDaCompetencia,
  receberDocumento,
  registrarParte,
  RecusaDeFechamento,
} from "../persistencia";
import { lerPagamento } from "../leitores/pagamento";
import {
  fixtureConciliacao,
  fixtureConciliacaoEmCsv,
  fixtureCtes,
  fixtureCtesEmCsv,
  fixtureDisponibilidade,
  fixtureDisponibilidadeEmCsv,
  fixtureOperacao,
  fixtureOperacaoEmCsv,
  fixturePagamento,
  fixturePagamento1aQuinzenaReal,
  fixturePagamentoDoPainel,
  fixturePagamentoEmCsv,
  fixtureRequisicoes,
  fixtureRequisicoesEmPlanilha,
} from "./fixtures";

/**
 * A prova de que a apuração roda **sobre o que o banco guardou**.
 *
 * Os testes de `fechamento.test.ts` conferem a aritmética sem banco nenhum, que
 * é o certo para aritmética. Este confere a outra metade: que o documento
 * recebido vira linha gravada, que a linha gravada volta como fonte, e que a
 * conta refeita a partir dela é a mesma. Sem ele, os dois lados poderiam
 * divergir sem que nada acusasse.
 *
 * Precisa de um Postgres, e o que ele faz sem um depende de onde está rodando.
 * Na máquina de quem desenvolve, pula: quem mexeu num leitor não deveria
 * precisar de banco para conferir a mudança. **No CI, não pula** — lá o banco é
 * um serviço declarado do job, e um arquivo que se cala quando ele some é a
 * mesma classe de falso verde que `scripts/ci/shards.mjs` existe para impedir.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_fechamento_${process.pid}`;

/**
 * A mesma conexão, apontada para outro banco.
 *
 * Trocar o nome com `replace` sobre a string parecia bastar e não bastava: a
 * URL do CI tem query (`?application_name=ci`) e a de uma máquina local pode
 * não ter, e a expressão que casava com uma passava batido na outra — deixando
 * a URL intacta e o teste prestes a derrubar o banco de trabalho de alguém.
 * `URL` resolve as duas formas pela mesma regra.
 */
function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

/*
  A frase do painel ausente não precisa de banco — e é justamente ela que
  mentia. Fica fora do `skipIf` de propósito: quem mexer no texto vê as três
  formas quebrarem na máquina dele, sem subir Postgres nenhum. O que **precisa**
  de banco é dizer qual das três é o caso, e isso está lá dentro.
*/
describe("a frase que a tela mostra no lugar do painel", () => {
  const enviadoEm = new Date("2026-08-20T12:00:00Z");

  it("só diz 'não foi importado' quando nenhum 03.08.20 chegou", () => {
    const frase = fraseDoPainelAusente({ motivo: "SEM_DOCUMENTO" });
    expect(frase).toContain("03.08.20");
    expect(frase).toContain("não foi importado nesta competência");
  });

  it("sobre o arquivo em quarentena, diz que ele chegou e não valeu", () => {
    const frase = fraseDoPainelAusente({
      motivo: "EM_QUARENTENA",
      nomeDoArquivo: "03.08.20 (truncado).txt",
      enviadoEm,
      recusas: [{ linha: 12, motivo: "faltam 1 coluna(s) de valor", original: "01 - Frota Fixa" }],
    });
    expect(frase).not.toContain("não foi importado");
    expect(frase).toContain("03.08.20 (truncado).txt");
    expect(frase).toContain("20/08/2026");
    expect(frase).toContain("quarentena");
    expect(frase).toContain("faltam 1 coluna(s) de valor");
  });

  it("sobre o arquivo vigente sem verba, afirma que ele foi importado", () => {
    /* O defeito relatado da tela: a lista de relatórios mostrava o 03.08.20 com
       o visto verde e o painel, ao lado, dizia que ele não fora importado. */
    const frase = fraseDoPainelAusente({
      motivo: "SEM_VERBA",
      nomeDoArquivo: "03.08.20.txt",
      enviadoEm,
      descontos: 28,
      recusas: [],
    });
    expect(frase).not.toContain("não foi importado");
    expect(frase).toContain("foi importado");
    expect(frase).toContain("03.08.20.txt");
    expect(frase).toContain("28 desconto(s)");
    /* Sem recusa não se inventa pista: o arquivo pode ter sido lido inteiro e
       ainda assim não trazer verba — e dizer "o leitor recusou 0 linha(s)"
       mandaria procurar o que não existe. */
    expect(frase).not.toContain("O leitor recusou");
    /* E a saída que não custa nada vem primeiro. A frase mandava só "envie o
       03.08.20 completo por cima", o que põe quem opera a procurar um arquivo
       melhor do que o que já está guardado — e, quando o guardado é o certo, o
       reenvio dele era recusado pelo sha. */
    expect(frase).toContain("reimporte-o");
    expect(frase).toContain("sem reenviar nada");
  });

  it("quando nem desconto sobrou, diz que nenhuma linha foi reconhecida", () => {
    const frase = fraseDoPainelAusente({
      motivo: "SEM_VERBA",
      nomeDoArquivo: "03.08.20 (formato desconhecido).txt",
      enviadoEm,
      descontos: 0,
      recusas: [],
    });
    expect(frase).toContain("não reconheceu nenhuma linha");
  });
});

describe.skipIf(!temBanco)("a apuração a partir do banco", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  const unidade = { codigo: "443", nome: "CDD FICTICIO" };
  const transportadora = { codigo: "36", nome: "TRANSPORTES FICTICIA LTDA" };
  /*
    O tipo de operação entra em toda abertura desde a `0046`: ele faz parte da
    chave, e o compilador o cobre em cada chamada. Aqui ele é sempre o mesmo,
    porque estes casos são sobre outra coisa; os dois que **são** sobre ele
    estão no bloco "o tipo de operação separa dois fechamentos", mais abaixo.
  */
  const tipoDeOperacao = "EMPURRADA";

  it("abrir a mesma competência duas vezes devolve a mesma", async () => {
    const a = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    const b = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    expect(b.id).toBe(a.id);
    expect(a.chave).toBe("2026-07-Q2");
  });

  /*
    O quarto eixo da chave, da `0046`.

    O caso central é o segundo: sem o tipo, a abertura de ROTA encontrava a de
    EMPURRADA e devolvia **o fechamento da outra operação** — em silêncio, e
    pelo caminho feliz, porque repetir a abertura é o gesto de quem volta à tela
    no dia seguinte. Quem abrisse ROTA passaria a mandar os relatórios de rota
    para dentro do fechamento de empurrada.
  */
  describe("o tipo de operação separa dois fechamentos", () => {
    it("a mesma quinzena com tipos diferentes são duas competências", async () => {
      const empurrada = await abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 1, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });
      const rota = await abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 1, unidade, transportadora, tipoDeOperacao: "ROTA",
      });

      expect(rota.id).not.toBe(empurrada.id);
      expect(rota.chave).toBe(empurrada.chave);
      expect(empurrada.tipoDeOperacao).toBe("EMPURRADA");
      expect(rota.tipoDeOperacao).toBe("ROTA");
    });

    it("e cada uma continua idempotente dentro do seu tipo", async () => {
      const uma = await abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 2, unidade, transportadora, tipoDeOperacao: "ROTA",
      });
      const outra = await abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 2, unidade, transportadora, tipoDeOperacao: "ROTA",
      });
      expect(outra.id).toBe(uma.id);
    });

    /*
      A normalização é o que impede "Empurrada" e "EMPURRADA" de virarem dois
      fechamentos do mesmo mês — o eixo é o do rótulo da vigência, que é caixa
      alta.
    */
    it("normaliza a caixa antes de comparar", async () => {
      const alta = await abrirCompetencia(db, {
        ano: 2026, mes: 10, quinzena: 1, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });
      const baixa = await abrirCompetencia(db, {
        ano: 2026, mes: 10, quinzena: 1, unidade, transportadora, tipoDeOperacao: " empurrada ",
      });
      expect(baixa.id).toBe(alta.id);
      expect(baixa.tipoDeOperacao).toBe("EMPURRADA");
    });

    /*
      `NAO_INFORMADO` é o carimbo do backfill, e nada além dele pode escrevê-lo:
      deixá-lo passar daria a quem abre uma forma de dizer "não sei" num campo
      que a operação decidiu que é obrigatório.
    */
    it("recusa abrir sem tipo, e recusa o carimbo do backfill", async () => {
      for (const tipo of ["", "   ", "NAO_INFORMADO", "nao_informado"]) {
        await expect(
          abrirCompetencia(db, {
            ano: 2026, mes: 11, quinzena: 1, unidade, transportadora, tipoDeOperacao: tipo,
          }),
          `tipo ${JSON.stringify(tipo)}`,
        ).rejects.toThrow(TipoDeOperacaoAusente);
      }
    });

    it("o resumo do mês é de uma operação, e não da unidade", async () => {
      await abrirCompetencia(db, {
        ano: 2026, mes: 12, quinzena: 1, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });
      await abrirCompetencia(db, {
        ano: 2026, mes: 12, quinzena: 2, unidade, transportadora, tipoDeOperacao: "ROTA",
      });

      const deEmpurrada = await lerResumoDoMes(db, {
        unidade: unidade.codigo,
        transportadora: transportadora.codigo,
        tipoDeOperacao: "EMPURRADA",
        ano: 2026,
        mes: 12,
      });
      /*
        O resumo sempre nomeia as **duas** quinzenas — a que falta aparece
        vazia, e não some, para que meio mês não tenha cara de mês inteiro. O
        que o recorte por tipo decide é qual delas tem competência: sem ele, as
        duas competências cairiam nas mesmas duas colunas e o mês somaria duas
        operações num total só.
      */
      const comCompetencia = (r: Awaited<ReturnType<typeof lerResumoDoMes>>) =>
        r.quinzenas.filter((q) => q.competenciaId !== null).map((q) => q.quinzena);

      expect(comCompetencia(deEmpurrada)).toEqual([1]);

      const deRota = await lerResumoDoMes(db, {
        unidade: unidade.codigo,
        transportadora: transportadora.codigo,
        tipoDeOperacao: "ROTA",
        ano: 2026,
        mes: 12,
      });
      expect(comCompetencia(deRota)).toEqual([2]);
    });
  });

  /*
    Informar o tipo depois — o que faltava para o carimbo da `0046` ter saída.

    Até aqui só a abertura escrevia esta coluna, e por isso toda competência
    anterior à migration ficava presa em `NAO_INFORMADO`: legível na lista,
    ausente do Resumo de qualquer operação real. Estes casos são sobre as duas
    coisas que a função separa — preencher um branco, que é reparo, e trocar uma
    declaração, que é mudança de conteúdo e tem o preço dela.
  */
  describe("informar o tipo de operação de uma competência que já existe", () => {
    /*
      A competência do backfill não pode ser aberta pela porta da frente —
      `abrirCompetencia` recusa `NAO_INFORMADO` de propósito. Aqui ela é
      fabricada como a `0046` a deixou: aberta com tipo, e depois carimbada por
      fora. É o único jeito honesto de testar o caso que existe no banco de
      produção e não pode mais ser criado pela API.
    */
    async function comoOBackfillDeixou(entrada: {
      ano: number;
      mes: number;
      quinzena: 1 | 2;
      encerrada?: boolean;
    }) {
      const comp = await abrirCompetencia(db, {
        ano: entrada.ano,
        mes: entrada.mes,
        quinzena: entrada.quinzena,
        unidade,
        transportadora,
        tipoDeOperacao: "EMPURRADA",
      });
      await db
        .update(fechamentoCompetenciaTable)
        .set({
          tipoDeOperacao: "NAO_INFORMADO",
          ...(entrada.encerrada ? { estado: "ENCERRADA", encerradaEm: new Date() } : {}),
        })
        .where(eq(fechamentoCompetenciaTable.id, comp.id));
      return comp.id;
    }

    it("preenche o branco que o backfill deixou", async () => {
      const id = await comoOBackfillDeixou({ ano: 2027, mes: 1, quinzena: 1 });

      const depois = await informarTipoDeOperacao(db, id, { tipoDeOperacao: "ROTA" });

      expect(depois.tipoDeOperacao).toBe("ROTA");
      expect((await buscarCompetencia(db, id))?.tipoDeOperacao).toBe("ROTA");
    });

    /*
      O caso que motivou a função: as competências do backfill são justamente as
      antigas, e as antigas são justamente as fechadas. Recusá-las aqui deixaria
      o acervo inteiro sem endereço para sempre — e o que o encerramento congela
      é o dinheiro apurado, não a resposta a "de qual operação era".
    */
    it("informa mesmo na encerrada: preencher um branco não reescreve declaração nenhuma", async () => {
      const id = await comoOBackfillDeixou({ ano: 2027, mes: 1, quinzena: 2, encerrada: true });

      const depois = await informarTipoDeOperacao(db, id, { tipoDeOperacao: "EMPURRADA" });

      expect(depois.tipoDeOperacao).toBe("EMPURRADA");
      expect(depois.estado).toBe("ENCERRADA");
    });

    it("corrige o tipo declarado enquanto a quinzena não fechou", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2027, mes: 2, quinzena: 1, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });

      const depois = await informarTipoDeOperacao(db, comp.id, { tipoDeOperacao: "ROTA" });

      expect(depois.tipoDeOperacao).toBe("ROTA");
      expect(depois.id).toBe(comp.id);
    });

    /*
      Trocar um tipo declarado numa encerrada move um total já cobrado do mês de
      uma operação para o da outra. O caminho existe e é o de sempre: reabrir,
      com motivo — o que separa uma correção de uma alteração silenciosa depois
      do fato.
    */
    it("recusa trocar o tipo declarado de uma encerrada — reabrir vem antes", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2027, mes: 2, quinzena: 2, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });
      await db
        .update(fechamentoCompetenciaTable)
        .set({ estado: "ENCERRADA", encerradaEm: new Date() })
        .where(eq(fechamentoCompetenciaTable.id, comp.id));

      await expect(
        informarTipoDeOperacao(db, comp.id, { tipoDeOperacao: "ROTA" }),
      ).rejects.toMatchObject({ codigo: "COMPETENCIA_ENCERRADA" });
      expect((await buscarCompetencia(db, comp.id))?.tipoDeOperacao).toBe("EMPURRADA");
    });

    /*
      E repetir o tipo que já está lá não é conflito: é o clique duplo, ou a
      segunda aba. O estado desejado já é o estado atual — inclusive na
      encerrada, que a regra acima recusaria se houvesse troca a fazer.
    */
    it("repetir o tipo que já está lá devolve a competência, e não um conflito", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2027, mes: 3, quinzena: 1, unidade, transportadora, tipoDeOperacao: "ROTA",
      });
      await db
        .update(fechamentoCompetenciaTable)
        .set({ estado: "ENCERRADA", encerradaEm: new Date() })
        .where(eq(fechamentoCompetenciaTable.id, comp.id));

      const depois = await informarTipoDeOperacao(db, comp.id, { tipoDeOperacao: " rota " });

      expect(depois.id).toBe(comp.id);
      expect(depois.tipoDeOperacao).toBe("ROTA");
    });

    it("recusa desinformar: `NAO_INFORMADO` é carimbo do backfill, não escolha", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2027, mes: 3, quinzena: 2, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });

      for (const tipo of ["", "  ", "NAO_INFORMADO", "nao_informado"]) {
        await expect(
          informarTipoDeOperacao(db, comp.id, { tipoDeOperacao: tipo }),
          `tipo ${JSON.stringify(tipo)}`,
        ).rejects.toThrow(TipoDeOperacaoAusente);
      }
      expect((await buscarCompetencia(db, comp.id))?.tipoDeOperacao).toBe("EMPURRADA");
    });

    /*
      O destino ocupado. O índice único recusaria de qualquer forma, com a
      mensagem do Postgres; a recusa do domínio diz **qual** competência está no
      lugar, que é o que permite decidir entre corrigir a outra ou excluir esta.
    */
    it("recusa quando a outra operação da mesma quinzena já existe, e diz qual é", async () => {
      const empurrada = await abrirCompetencia(db, {
        ano: 2027, mes: 4, quinzena: 1, unidade, transportadora, tipoDeOperacao: "EMPURRADA",
      });
      const rota = await abrirCompetencia(db, {
        ano: 2027, mes: 4, quinzena: 1, unidade, transportadora, tipoDeOperacao: "ROTA",
      });

      await expect(
        informarTipoDeOperacao(db, rota.id, { tipoDeOperacao: "EMPURRADA" }),
      ).rejects.toMatchObject({
        codigo: "TIPO_DE_OPERACAO_EM_USO",
        detalhe: { competenciaId: empurrada.id },
      });
      expect((await buscarCompetencia(db, rota.id))?.tipoDeOperacao).toBe("ROTA");
    });

    it("recusa uma competência que não existe", async () => {
      await expect(
        informarTipoDeOperacao(db, "00000000-0000-0000-0000-000000000000", {
          tipoDeOperacao: "ROTA",
        }),
      ).rejects.toMatchObject({ codigo: "COMPETENCIA_NAO_ENCONTRADA" });
    });

    /*
      E o desfecho que a função serve: a quinzena que estava fora de todo Resumo
      passa a estar dentro de um. É a frase inteira do reparo, e o único caso
      aqui que a olha de fora do registro.
    */
    it("a quinzena informada passa a aparecer no resumo daquela operação", async () => {
      const id = await comoOBackfillDeixou({ ano: 2027, mes: 5, quinzena: 1 });
      const comCompetencia = (r: Awaited<ReturnType<typeof lerResumoDoMes>>) =>
        r.quinzenas.filter((q) => q.competenciaId !== null).map((q) => q.quinzena);
      const resumoDe = (tipoDeOperacao: string) =>
        lerResumoDoMes(db, {
          unidade: unidade.codigo,
          transportadora: transportadora.codigo,
          tipoDeOperacao,
          ano: 2027,
          mes: 5,
        });

      expect(comCompetencia(await resumoDe("EMPURRADA"))).toEqual([]);

      await informarTipoDeOperacao(db, id, { tipoDeOperacao: "EMPURRADA" });

      expect(comCompetencia(await resumoDe("EMPURRADA"))).toEqual([1]);
    });
  });

  it("recebe as cinco fontes e reproduz, do banco, a conta que a aritmética dá", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    const fontes = [
      ["OPERACAO", "2art.xlsx", fixtureOperacao()],
      ["CTE", "03.08.15.xlsx", fixtureCtes()],
      ["REQUISICOES", "03.08.12.09.csv", fixtureRequisicoes()],
      ["DISPONIBILIDADE", "03.08.18.xlsx", fixtureDisponibilidade()],
      ["CONCILIACAO", "03.02.59.02.txt", Buffer.from(fixtureConciliacao(), "latin1")],
    ] as const;
    for (const [tipo, nome, conteudo] of fontes) {
      await receberDocumento(db, {
        competenciaId: comp.id,
        tipo,
        nomeDoArquivo: nome,
        conteudo: conteudo as Buffer,
      });
    }

    await apurarCompetencia(db, comp.id);
    const apuracao = (await lerApuracaoVigente(db, comp.id))!;

    /* O 03.08.20 fica de fora aqui de propósito: ele é o assunto do bloco
       "o 03.08.20 no banco", e é a ausência dele que mantém o não conferido
       de 2.000,00 visível neste teste. */
    expect(apuracao.fontesAusentes).toEqual(["PAGAMENTO"]);
    /* Os mesmos números do teste sem banco — é essa igualdade que importa. */
    expect(apuracao.totais.emitido).toBe(4450);
    expect(apuracao.totais.naoConferido).toBe(2000);
    expect(apuracao.verbas.find((v) => v.vbz === 7)?.esperado).toBe(750);
    expect(apuracao.verbas.find((v) => v.vbz === 1)?.esperado).toBeNull();
    expect(apuracao.divergencias.some((d) => d.tipo === "DESCONTO_FRETE_MINIMO" && d.valor === 200)).toBe(true);
  }, 60_000);

  it("chega à mesma conta com os relatórios nos outros formatos em que eles saem", async () => {
    /*
      A promessa que a tela faz a quem opera: o formato do arquivo não muda o
      número. Aqui as seis fontes entram **todas** pela outra forma — o 2Art e o
      03.08.15 em CSV no lugar da planilha, o 03.08.18 em CSV com a coluna que
      diz a frota, as requisições em planilha no lugar do CSV, e os dois
      relatórios de largura fixa delimitados — e a apuração que sai do banco é
      conferida contra a que saiu dos formatos de sempre.

      São duas unidades próprias (`447` e `448`) pela mesma razão do descarte e
      da exclusão: os dois lados da comparação recebem os *mesmos* arquivos, e
      reenviá-los na competência do `443` seria o caso de substituição, que é
      outro teste.
    */
    const noFormatoDeSempre = { codigo: "447", nome: "CDD DOS FORMATOS" };
    const receber = async (
      competenciaId: string,
      fontes: readonly (readonly [string, string, Buffer])[],
    ) => {
      for (const [tipo, nome, conteudo] of fontes) {
        await receberDocumento(db, {
          competenciaId,
          tipo: tipo as Parameters<typeof receberDocumento>[1]["tipo"],
          nomeDoArquivo: nome,
          conteudo,
        });
      }
    };

    const deSempre = await abrirCompetencia(db, {
      ano: 2026, mes: 7, quinzena: 2, unidade: noFormatoDeSempre, transportadora, tipoDeOperacao,
    });
    await receber(deSempre.id, [
      ["OPERACAO", "2art.xlsx", fixtureOperacao()],
      ["CTE", "03.08.15.xlsx", fixtureCtes()],
      ["REQUISICOES", "03.08.12.09.csv", fixtureRequisicoes()],
      ["DISPONIBILIDADE", "03.08.18.xlsx", fixtureDisponibilidade()],
      ["PAGAMENTO", "03.08.20.txt", fixturePagamento()],
      ["CONCILIACAO", "03.02.59.02.txt", Buffer.from(fixtureConciliacao(), "latin1")],
    ]);
    await apurarCompetencia(db, deSempre.id);

    const nosOutros = await abrirCompetencia(db, {
      ano: 2026, mes: 7, quinzena: 2, unidade: { codigo: "448", nome: "CDD DOS FORMATOS 2" },
      transportadora,
      tipoDeOperacao,
    });
    await receber(nosOutros.id, [
      ["OPERACAO", "2art.csv", fixtureOperacaoEmCsv()],
      ["CTE", "03.08.15_1Q_JUL.csv", fixtureCtesEmCsv()],
      ["REQUISICOES", "03.08.12.09.xlsx", fixtureRequisicoesEmPlanilha()],
      ["DISPONIBILIDADE", "03.08.18.csv", fixtureDisponibilidadeEmCsv()],
      ["PAGAMENTO", "03.08.20_1Q_JUL.csv", fixturePagamentoEmCsv()],
      ["CONCILIACAO", "03.02.59.02_1Q_JUL.csv", fixtureConciliacaoEmCsv()],
    ]);
    await apurarCompetencia(db, nosOutros.id);

    const a = (await lerApuracaoVigente(db, deSempre.id))!;
    const b = (await lerApuracaoVigente(db, nosOutros.id))!;

    expect(b.fontesAusentes).toEqual(a.fontesAusentes);
    expect(b.totais).toEqual(a.totais);
    expect(b.verbas.map((v) => [v.vbz, v.emitido, v.esperado, v.diferenca])).toEqual(
      a.verbas.map((v) => [v.vbz, v.emitido, v.esperado, v.diferenca]),
    );
    expect(b.divergencias.map((d) => [d.tipo, d.valor])).toEqual(
      a.divergencias.map((d) => [d.tipo, d.valor]),
    );

    /* E os dias da quinzena — que saem só do 2Art — também são os mesmos. */
    const diasDe = async (id: string) =>
      (await lerDiarioDaCompetencia(db, id))!.dias.map((d) => [d.dia, d.totais.viagens]);
    expect(await diasDe(nosOutros.id)).toEqual(await diasDe(deSempre.id));
  }, 120_000);

  it("guarda a memória de cálculo de cada parcela, com o fator medido", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    const apuracao = (await lerApuracaoVigente(db, comp.id))!;
    const freteiro = apuracao.verbas.find((v) => v.vbz === 7)!;
    expect(freteiro.memoria).toHaveLength(2);
    const daRequisicao = freteiro.memoria.find((m) => m.origem === "REQUISICOES")!;
    expect(daRequisicao.semImposto).toBe(200);
    expect(daRequisicao.comImposto).toBe(250);
    expect(daRequisicao.fator).toBeCloseTo(1.25, 6);
  });

  it("recusa o mesmo arquivo duas vezes — recebê-lo de novo dobraria a conta", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "CTE",
        nomeDoArquivo: "03.08.15 (cópia).xlsx",
        conteudo: fixtureCtes(),
      }),
    ).rejects.toBeInstanceOf(RecusaDeFechamento);
  });

  /*
    Cada teste de quarentena abre a **sua** competência, num mês que nenhum outro
    usa. `abrirCompetencia` devolve a existente quando ela existe, e o banco é
    um só para a suíte inteira: compartilhar a competência faria um teste ver o
    documento do outro — e o `sha256` único por competência recusaria o segundo
    envio do mesmo fixture como repetido.
  */
  /*
    Varia a **unidade**, e não o período: a competência é a trinca (unidade,
    transportadora, chave), e o fixture do 03.08.20 declara 16–31/07/2026 no
    cabeçalho — `recusarPagamentoDeOutroPeriodo` recusaria qualquer outro mês.
  */
  let proximaUnidade = 1;
  const competenciaSo = () =>
    abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 2,
      unidade: { codigo: `QUARENTENA-${proximaUnidade++}`, nome: "CDD DE TESTE" },
      transportadora,
      tipoDeOperacao,
    });

  /*
    A mesma coisa para a 1ª quinzena, que é o período que o arquivo real declara
    (`Periodo: 01/07/2026 a 15/07/2026`). Duas fixtures, dois períodos: usar a
    competência errada faria `recusarPagamentoDeOutroPeriodo` recusar na porta, e
    o teste passaria a medir a recusa em vez do que ele quer medir.
  */
  const competenciaDaPrimeira = () =>
    abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 1,
      unidade: { codigo: `QUARENTENA-${proximaUnidade++}`, nome: "CDD DE TESTE" },
      transportadora,
      tipoDeOperacao,
    });

  /** O fixture bom, com uma coluna de valor a menos em cada linha de verba. */
  function semVerbaPorColunaAMenos(): Buffer {
    const texto = fixturePagamentoDoPainel().toString("utf8");
    return Buffer.from(
      texto
        .split(/\r?\n/)
        .map((l) => {
          const m = /^(\s*\d{1,3}\s*-\s*.+?\s{2,})((?:-?[\d.]+,\d{2}\s+){5})(-?[\d.]+,\d{2})\s*$/.exec(l);
          return m ? `${m[1]}${m[2]!.trimEnd()}` : l;
        })
        .join("\r\n"),
      "utf8",
    );
  }

  /**
   * O arquivo real da 1ª quinzena com uma coluna de valor a menos.
   *
   * O truncado do outro período não serve aqui: `recusarPagamentoDeOutroPeriodo`
   * o recusaria na porta, e o teste passaria a medir a recusa de período em vez
   * da quarentena. Vai e volta em latin-1, que é a codificação do arquivo — um
   * `toString("utf8")` trocaria os acentos do rodapé por outros bytes e faria o
   * "mesmo arquivo" deixar de ser o mesmo.
   */
  function realDaPrimeiraSemUmaColuna(): Buffer {
    const texto = fixturePagamento1aQuinzenaReal().toString("latin1");
    return Buffer.from(
      texto
        .split(/\r?\n/)
        .map((l) => {
          const m = /^(\s*\d{1,3}\s*-\s*.+?\s{2,})((?:-?[\d.]+,\d{2}\s+){5})(-?[\d.]+,\d{2})\s*$/.exec(l);
          return m ? `${m[1]}${m[2]!.trimEnd()}` : l;
        })
        .join("\r\n"),
      "latin1",
    );
  }

  /** O fixture bom, sem os cabeçalhos de seção que tornam a verba elegível. */
  function semVerbaPorFaltarSecao(): Buffer {
    const texto = fixturePagamentoDoPainel().toString("utf8");
    return Buffer.from(texto.replace("FRETE\r\n", "").replace("OUTROS CUSTOS\r\n", ""), "utf8");
  }

  it("o arquivo que leu e do qual não tirou nada fica em quarentena, guardado", async () => {
    /* O caso real, relatado da tela: "eu importei o arquivo sim, mas diz que não
       importei". Os leitores do fechamento são máquinas de estado sobre texto e
       não lançam quando a estrutura não é a esperada — devolvem listas vazias.
       A importação gravava o documento, inseria zero fatos e respondia sucesso.

       Recusar jogaria fora a evidência. Guardar sem promover conserva as duas
       coisas: o arquivo, que agora pode ser examinado, e a conta anterior, que
       continua de pé. */
    const comp = await competenciaSo();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (formato desconhecido).txt",
      conteudo: Buffer.from("relatorio qualquer\nsem nenhuma linha que o leitor reconheca\n", "utf8"),
    });

    expect(recebido.desfecho).toBe("EM_QUARENTENA");
    expect(recebido.motivoDaQuarentena).toContain("03.08.20");
    expect(recebido.substituiu).toBeNull();
    /* Não virou fonte da conta. */
    expect(await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" })).toBeNull();
    /* E ainda assim está guardado, inteiro. */
    const guardado = await lerConteudoDoDocumento(db, recebido.id);
    expect(guardado?.conteudo.toString("utf8")).toContain("sem nenhuma linha");
  });

  it("PAGAMENTO com descontos e nenhuma verba não vale como demonstrativo", async () => {
    /* O caso de produção: catorze descontos, zero verbas. Ler não é valer — o
       demonstrativo existe para abrir a parcela fixa verba a verba, e sem verba
       ele não abre nada. */
    const comp = await competenciaSo();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (so descontos).txt",
      conteudo: semVerbaPorColunaAMenos(),
    });

    expect(recebido.desfecho).toBe("EM_QUARENTENA");
    expect(recebido.linhasLidas).toBeGreaterThan(0);
    expect(recebido.motivoDaQuarentena).toContain("nenhuma verba");
    /* As recusas detalhadas sobrevivem, com linha e texto original. */
    expect(recebido.recusas.length).toBeGreaterThan(0);
    expect(recebido.recusas[0]?.motivo).toContain("coluna(s) de valor");
    expect(recebido.recusas[0]?.original).toContain("Frota Fixa Ativa");
  });

  it("layout sem FRETE/OUTROS CUSTOS entra em quarentena com o motivo do recorte", async () => {
    const comp = await competenciaSo();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (sem secao).txt",
      conteudo: semVerbaPorFaltarSecao(),
    });
    expect(recebido.desfecho).toBe("EM_QUARENTENA");
    expect(recebido.recusas[0]?.motivo).toContain("fora de uma seção");
  });

  it("um PAGAMENTO válido é promovido e vira a conta", async () => {
    const comp = await competenciaSo();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: fixturePagamentoDoPainel(),
    });
    expect(recebido.desfecho).toBe("PROMOVIDO");
    expect(recebido.motivoDaQuarentena).toBeNull();
    expect(recebido.recusas).toEqual([]);
    expect(await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" })).not.toBeNull();
  });

  it("reenvio inválido não destrói a importação válida anterior", async () => {
    /* O modo de falhar mais caro: o segundo envio despromovia o primeiro e
       apagava as linhas dele **antes** de saber se prestava. */
    const comp = await competenciaSo();
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: fixturePagamentoDoPainel(),
    });
    const antes = await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" });
    expect(antes).not.toBeNull();

    const segundo = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (truncado).txt",
      conteudo: semVerbaPorColunaAMenos(),
    });
    expect(segundo.desfecho).toBe("EM_QUARENTENA");

    const depois = await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" });
    expect(depois).not.toBeNull();
    expect(depois?.totalDoRelatorio).toBe(antes?.totalDoRelatorio);
  });

  /*
    A outra metade do mesmo caso: a quarentena impede que a competência **fique**
    sem parcela fixa daqui para a frente, e estes testes cobrem o que a tela diz
    quando ela já está assim — inclusive nas competências importadas antes de a
    quarentena existir. Dizer "não foi importado" sobre um arquivo que a lista de
    relatórios mostra com nome, data e visto verde foi o defeito que sobrou.
  */
  it("sem 03.08.20 nenhum, a ausência é a de um arquivo que não chegou", async () => {
    const comp = await competenciaSo();
    const ausencia = await explicarPainelAusente(db, comp.id);

    expect(ausencia.motivo).toBe("SEM_DOCUMENTO");
    expect(fraseDoPainelAusente(ausencia)).toContain("não foi importado nesta competência");
  });

  it("com o 03.08.20 em quarentena, a tela diz que ele chegou e não valeu", async () => {
    const comp = await competenciaSo();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (truncado).txt",
      conteudo: semVerbaPorColunaAMenos(),
    });
    expect(recebido.desfecho).toBe("EM_QUARENTENA");

    const ausencia = await explicarPainelAusente(db, comp.id);
    expect(ausencia.motivo).toBe("EM_QUARENTENA");

    const frase = fraseDoPainelAusente(ausencia);
    expect(frase).not.toContain("não foi importado");
    expect(frase).toContain("03.08.20 (truncado).txt");
    expect(frase).toContain("quarentena");
    /* A pista do porquê vem junto, e é a mesma que o envio devolveu. */
    expect(frase).toContain("coluna(s) de valor");
  });

  it("com um 03.08.20 vigente e nenhuma verba, a tela não diz que ele não foi importado", async () => {
    /* O estado em que as competências anteriores à quarentena ficaram: o
       documento foi promovido, apagou as verbas do envio anterior e não gravou
       nenhuma no lugar. A tela mostrava o visto verde na lista de relatórios e,
       um cartão abaixo, "não foi importado nesta competência" — as duas coisas
       sobre o mesmo arquivo. Aqui o estado é reproduzido por dentro, apagando as
       verbas do documento vigente, porque a importação de hoje já não o produz. */
    const comp = await competenciaSo();
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: fixturePagamentoDoPainel(),
    });
    await db
      .delete(fechamentoPagamentoItemTable)
      .where(eq(fechamentoPagamentoItemTable.competenciaId, comp.id));

    /* O documento continua lá, vigente, é o que a lista de relatórios mostra. */
    const documento = (await listarDocumentos(db, comp.id)).find((d) => d.tipo === "PAGAMENTO");
    expect(documento?.vigente).toBe(true);
    /* E o painel não tem de onde sair. */
    expect(await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" })).toBeNull();

    const ausencia = await explicarPainelAusente(db, comp.id);
    expect(ausencia.motivo).toBe("SEM_VERBA");
    expect(ausencia).toMatchObject({ nomeDoArquivo: "03.08.20.txt" });

    const frase = fraseDoPainelAusente(ausencia);
    expect(frase).not.toContain("não foi importado");
    expect(frase).toContain("foi importado");
    expect(frase).toContain("03.08.20.txt");
    /* Os descontos do mesmo documento continuam gravados, e são contados: é a
       diferença entre "o arquivo é outro" e "o corpo dele não foi reconhecido". */
    expect(ausencia.motivo === "SEM_VERBA" && ausencia.descontos).toBeGreaterThan(0);
    expect(frase).toContain("desconto(s) dele e nenhuma verba");
  });

  it("a lista de relatórios conta as verbas do 03.08.20, que `linhasLidas` não separa", async () => {
    /* O número que a tela mostrava era `linhasLidas`, e ele soma verbas e
       descontos: o demonstrativo do qual o leitor só tirou descontos aparecia
       com um número respeitável de linhas e visto verde. `verbas` é a pergunta
       que a lista de fato faz — e é `null` nas outras fontes, que não têm verba
       a ter, para que a tela não acuse quem não deve nada. */
    const comp = await competenciaSo();
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: fixturePagamentoDoPainel(),
    });
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "DISPONIBILIDADE",
      nomeDoArquivo: "03.08.18.xlsx",
      conteudo: fixtureDisponibilidade(),
    });

    const comVerba = await listarDocumentos(db, comp.id);
    const pagamento = comVerba.find((d) => d.tipo === "PAGAMENTO")!;
    expect(pagamento.verbas).toBeGreaterThan(0);
    expect(pagamento.verbas).toBeLessThan(pagamento.linhasLidas);
    /* As outras cinco fontes não respondem a esta pergunta. */
    expect(comVerba.find((d) => d.tipo === "DISPONIBILIDADE")?.verbas).toBeNull();

    /* E o estado que a tela precisa acusar: documento vigente, zero verbas. */
    await db
      .delete(fechamentoPagamentoItemTable)
      .where(eq(fechamentoPagamentoItemTable.competenciaId, comp.id));
    const semVerba = await listarDocumentos(db, comp.id);
    expect(semVerba.find((d) => d.tipo === "PAGAMENTO")).toMatchObject({
      vigente: true,
      verbas: 0,
    });
  });

  /*
    As duas quinzenas, pelo caminho de verdade — upload, gravação, painel. O
    caso relatado da tela era o de um 03.08.20 que a lista mostrava e o painel
    negava, e a única forma de provar que isso não é o leitor é levar o arquivo
    real inteiro até o painel e conferir o total contra o rodapé do papel.
  */
  it("a 1ª quinzena: o 03.08.20 real vira dez verbas e enche o painel dos dois canais", async () => {
    const comp = await competenciaDaPrimeira();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });

    expect(recebido.desfecho).toBe("PROMOVIDO");
    expect(recebido.motivoDaQuarentena).toBeNull();
    expect(recebido.recusas).toEqual([]);
    /* O mesmo 14 que a tela mostra — e dez dele são verba. */
    expect(recebido.linhasLidas).toBe(14);
    expect(
      (await listarDocumentos(db, comp.id)).find((d) => d.tipo === "PAGAMENTO"),
    ).toMatchObject({ vigente: true, verbas: 10 });

    const rota = await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" });
    const as = await lerDeParaDaCompetencia(db, comp.id, { canal: "AS" });
    expect(rota?.totalDoRelatorio).toBe(1084580.45);
    expect(as?.totalDoRelatorio).toBe(42587.82);
  });

  it("a 2ª quinzena: o 03.08.20 do período seguinte enche o painel pelo mesmo caminho", async () => {
    const comp = await competenciaSo();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_2Q_JUL.txt",
      conteudo: fixturePagamentoDoPainel(),
    });

    expect(recebido.desfecho).toBe("PROMOVIDO");
    expect(
      (await listarDocumentos(db, comp.id)).find((d) => d.tipo === "PAGAMENTO")?.verbas,
    ).toBeGreaterThan(0);
    expect(await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" })).not.toBeNull();
  });

  it("sobre o 03.08.20 real, um envio sem verba fica em quarentena e não apaga nada", async () => {
    /* O modo de falhar mais caro, agora contra o arquivo de verdade: o segundo
       envio despromovia o primeiro e apagava as linhas dele **antes** de saber
       se prestava. O painel tem de sair do outro lado com o mesmo total. */
    const comp = await competenciaDaPrimeira();
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });

    const segundo = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL (truncado).txt",
      conteudo: realDaPrimeiraSemUmaColuna(),
    });
    expect(segundo.desfecho).toBe("EM_QUARENTENA");
    expect(segundo.motivoDaQuarentena).toContain("nenhuma verba");
    expect(segundo.substituiu).toBeNull();

    /* O vigente continua sendo o real, com as dez verbas dele. */
    const vigente = (await listarDocumentos(db, comp.id)).find(
      (d) => d.tipo === "PAGAMENTO" && d.vigente,
    );
    expect(vigente).toMatchObject({ nomeDoArquivo: "03.08.20_1Q_JUL.txt", verbas: 10 });
    expect((await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" }))?.totalDoRelatorio).toBe(
      1084580.45,
    );
    /* E o que não valeu está guardado inteiro, para exame. */
    expect((await lerConteudoDoDocumento(db, segundo.id))?.conteudo.length).toBeGreaterThan(0);
  });

  /*
    O beco relatado da tela, e a saída dele.

    O estado: o documento vigente no banco sem verba nenhuma, a lista mostrando
    o nome do arquivo com o triângulo, e o painel sem de onde sair. Quem opera
    clica em "Substituir", escolhe **o mesmo arquivo** — que é o certo, e o
    diagnóstico dos bytes guardados diz que é — e o índice `(competência,
    sha256)` o recusa. Sobrava descartar a competência inteira.
  */
  it("o 03.08.20 sem verba no banco volta a si reimportando os bytes guardados", async () => {
    const comp = await competenciaDaPrimeira();
    const enviado = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });
    /* O estado relatado, reproduzido por dentro: a importação de hoje não o
       produz mais, e é justamente por isso que ele precisa de conserto e não de
       reenvio — o arquivo no banco é o certo. */
    await db
      .delete(fechamentoPagamentoItemTable)
      .where(eq(fechamentoPagamentoItemTable.documentoId, enviado.id));
    expect(
      (await listarDocumentos(db, comp.id)).find((d) => d.tipo === "PAGAMENTO"),
    ).toMatchObject({ vigente: true, verbas: 0 });
    expect(await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" })).toBeNull();

    const refeito = await reimportarDocumento(db, enviado.id);

    /* O mesmo documento, e não um segundo: o histórico não ganha uma linha por
       um conserto que não trocou arquivo nenhum. */
    expect(refeito.id).toBe(enviado.id);
    expect(refeito.desfecho).toBe("PROMOVIDO");
    expect(refeito.substituiu).toBeNull();
    expect(refeito.linhasLidas).toBe(14);
    const documentos = await listarDocumentos(db, comp.id);
    expect(documentos.filter((d) => d.tipo === "PAGAMENTO")).toHaveLength(1);
    expect(documentos[0]).toMatchObject({ vigente: true, verbas: 10 });
    /* E o painel, que é a razão de tudo isto, fecha no total do rodapé. */
    expect((await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" }))?.totalDoRelatorio).toBe(
      1084580.45,
    );
  });

  it("reenviar o mesmo arquivo conserta o documento que não sustenta nada", async () => {
    /* A porta da frente, que é por onde quem opera vai tentar: o mesmo arquivo,
       pelo botão "Substituir". Não há conta a dobrar num documento que não
       sustenta uma linha, e recusá-lo era barrar o único conserto. */
    const comp = await competenciaDaPrimeira();
    const enviado = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });
    await db
      .delete(fechamentoPagamentoItemTable)
      .where(eq(fechamentoPagamentoItemTable.documentoId, enviado.id));

    const denovo = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });

    expect(denovo.id).toBe(enviado.id);
    expect(denovo.desfecho).toBe("PROMOVIDO");
    const documentos = await listarDocumentos(db, comp.id);
    expect(documentos.filter((d) => d.tipo === "PAGAMENTO")).toHaveLength(1);
    expect(documentos[0]).toMatchObject({ verbas: 10 });
  });

  it("o reenvio continua recusado enquanto o documento sustentar linhas", async () => {
    /* A outra metade da mesma regra, e a que não pode ceder: com as verbas
       gravadas, receber o mesmo arquivo de novo somaria as mesmas dez duas
       vezes. A abertura acima vale para zero linhas, e só para zero. */
    const comp = await competenciaDaPrimeira();
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });

    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "PAGAMENTO",
        nomeDoArquivo: "03.08.20_1Q_JUL (cópia).txt",
        conteudo: fixturePagamento1aQuinzenaReal(),
      }),
    ).rejects.toMatchObject({ codigo: "DOCUMENTO_JA_RECEBIDO" });
  });

  it("a reimportação não promove o que continua sem verba, e não toca no vigente", async () => {
    /* Reimportar refaz a leitura; não a perdoa. O truncado passa pelos mesmos
       portões do envio e volta para a quarentena de onde saiu — e o documento
       bom, que está valendo, não perde uma linha por causa disso. */
    const comp = await competenciaDaPrimeira();
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });
    const emQuarentena = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL (truncado).txt",
      conteudo: realDaPrimeiraSemUmaColuna(),
    });
    expect(emQuarentena.desfecho).toBe("EM_QUARENTENA");

    const refeito = await reimportarDocumento(db, emQuarentena.id);
    expect(refeito.desfecho).toBe("EM_QUARENTENA");
    expect(refeito.motivoDaQuarentena).toContain("nenhuma verba");

    const vigente = (await listarDocumentos(db, comp.id)).find(
      (d) => d.tipo === "PAGAMENTO" && d.vigente,
    );
    expect(vigente).toMatchObject({ nomeDoArquivo: "03.08.20_1Q_JUL.txt", verbas: 10 });
    expect((await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" }))?.totalDoRelatorio).toBe(
      1084580.45,
    );
  });

  it("a reimportação serve às seis fontes, e não só ao 03.08.20", async () => {
    /* A pergunta que ela responde — "a linha do banco discorda do arquivo?" —
       é de qualquer fonte derivada, e escrever o conserto só para uma seria
       garantir que a próxima precisasse de outro. */
    const comp = await competenciaSo();
    const enviado = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "CTE",
      nomeDoArquivo: "03.08.15.xlsx",
      conteudo: fixtureCtes(),
    });
    await pool.query("delete from fechamento_cte where documento_id = $1", [enviado.id]);

    const refeito = await reimportarDocumento(db, enviado.id);
    expect(refeito.id).toBe(enviado.id);
    expect(refeito.desfecho).toBe("PROMOVIDO");
    expect(refeito.linhasLidas).toBe(enviado.linhasLidas);
    const { rows } = await pool.query<{ quantas: string }>(
      "select count(*) as quantas from fechamento_cte where documento_id = $1",
      [enviado.id],
    );
    expect(Number(rows[0]!.quantas)).toBe(enviado.linhasLidas);
  });

  it("a reimportação recusa a competência encerrada, com a saída junto", async () => {
    const comp = await competenciaDaPrimeira();
    const enviado = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });
    await pool.query("update fechamento_competencia set estado = 'ENCERRADA' where id = $1", [
      comp.id,
    ]);

    await expect(reimportarDocumento(db, enviado.id)).rejects.toMatchObject({
      codigo: "COMPETENCIA_ENCERRADA",
    });
  });

  it("sem os bytes guardados, a reimportação diz o que fazer em vez de falhar", async () => {
    /* O documento anterior à `0047`: existe, e o original não. Dizer "não
       encontrado" mandaria procurar o documento que está ali na tela; o que
       falta é o arquivo, e o caminho é o reenvio — que este documento agora
       aceita, justamente por não sustentar nada. */
    const comp = await competenciaDaPrimeira();
    const enviado = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });
    await db
      .delete(fechamentoPagamentoItemTable)
      .where(eq(fechamentoPagamentoItemTable.documentoId, enviado.id));
    await pool.query("delete from fechamento_documento_conteudo where documento_id = $1", [
      enviado.id,
    ]);

    await expect(reimportarDocumento(db, enviado.id)).rejects.toMatchObject({
      codigo: "CONTEUDO_NAO_GUARDADO",
    });
    /* E a saída que a mensagem promete funciona de verdade. */
    const denovo = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      conteudo: fixturePagamento1aQuinzenaReal(),
    });
    expect(denovo.id).toBe(enviado.id);
    expect(
      (await listarDocumentos(db, comp.id)).find((d) => d.tipo === "PAGAMENTO"),
    ).toMatchObject({ verbas: 10 });
  });

  it("o arquivo volta do banco byte a byte, e é reprocessável sem o .txt", async () => {
    const comp = await competenciaSo();
    const original = fixturePagamentoDoPainel();
    const recebido = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: original,
    });

    const guardado = await lerConteudoDoDocumento(db, recebido.id);
    expect(guardado?.conteudo.equals(original)).toBe(true);
    expect(guardado?.nomeDoArquivo).toBe("03.08.20.txt");
    expect(guardado?.tipo).toBe("PAGAMENTO");
    /* Reprocessável: o leitor roda sobre o que voltou e dá o mesmo resultado. */
    expect(lerPagamento(guardado!.conteudo).itens.length).toBe(
      lerPagamento(original).itens.length,
    );
  });

  it("recusa o 2Art de outro período em vez de gravar viagens que nenhuma conta usa", async () => {
    /* O caso real: o 2Art de 16–31/07 enviado numa competência de 01–15/08. Ele
       entrava com visto verde e "6 linhas", gravava tudo, e a grade de dias
       nascia inteira vazia — a mentira mais cara que uma importação pode contar
       é a de ter dado certo. A recusa nomeia os dois períodos, que é o que
       responde "importei o arquivo, por que não tem viagem?" na hora do erro.

       A fronteira é *nenhuma* linha cair dentro, e não alguma cair fora: o
       mesmo arquivo entra sem reclamação na competência de julho (ver o teste
       que recebe as cinco fontes, e o `viagensForaDoPeriodo` de 1 mais abaixo),
       porque o 2Art é mensal e a quinzena é meio mês. */
    const agosto = await abrirCompetencia(db, { ano: 2026, mes: 8, quinzena: 1, unidade, transportadora, tipoDeOperacao });
    const recusa = await receberDocumento(db, {
      competenciaId: agosto.id,
      tipo: "OPERACAO",
      nomeDoArquivo: "2art.xlsx",
      conteudo: fixtureOperacao(),
    }).catch((e: unknown) => e);

    expect(recusa).toBeInstanceOf(RecusaDeFechamento);
    expect((recusa as RecusaDeFechamento).codigo).toBe("DOCUMENTO_FORA_DO_PERIODO");
    expect((recusa as Error).message).toContain("01/07/2026 a 17/07/2026");
    expect((recusa as Error).message).toContain("01/08/2026 a 15/08/2026");

    /* E nada ficou para trás: o documento recusado não grava meia competência. */
    expect(await listarDocumentos(db, agosto.id)).toHaveLength(0);
    const diario = (await lerDiarioDaCompetencia(db, agosto.id))!;
    expect(diario.fonte).toBeNull();
    expect(diario.viagensForaDoPeriodo).toBe(0);
  }, 60_000);

  it("reenviar uma exportação corrigida substitui a anterior e mantém as duas no histórico", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 8, quinzena: 1, unidade, transportadora, tipoDeOperacao });
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "REQUISICOES",
      nomeDoArquivo: "requisicoes.csv",
      conteudo: fixtureRequisicoes(),
    });
    const corrigido = Buffer.concat([
      fixtureRequisicoes(),
      Buffer.from(
        "\r\n443;CDD FICTICIO;GEO NO;3006;16/07/2026;Rota;Não;Não;036;TRANSPORTES FICTICIA;013;Incentivo;000009;Rota - Outras Despesas;Incentivo esquecido;Aprovada;10,00;27/07/2026;21:21;28/07/2026;15:45;;;1;2;;;;;;",
        "latin1",
      ),
    ]);
    const segundo = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "REQUISICOES",
      nomeDoArquivo: "requisicoes (corrigido).csv",
      conteudo: corrigido,
    });

    expect(segundo.substituiu).not.toBeNull();
    const documentos = await listarDocumentos(db, comp.id);
    expect(documentos).toHaveLength(2);
    expect(documentos.filter((d) => d.vigente)).toHaveLength(1);
    expect(documentos.find((d) => d.vigente)?.linhasLidas).toBe(6);
  }, 60_000);

  it("devolve a quinzena dia a dia, e a viagem do outro meio do mês fica de fora", async () => {
    /* A grade da tela: um item por dia do período, com ou sem operação. A
       viagem de 01/07 está no mesmo 2Art e pertence à 1ª quinzena — ela é
       contada como fora do período, e não somada em dia nenhum daqui. */
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    const diario = (await lerDiarioDaCompetencia(db, comp.id))!;

    expect(diario.fonte?.nomeDoArquivo).toBe("2art.xlsx");
    expect(diario.dias).toHaveLength(16);
    expect(diario.viagensForaDoPeriodo).toBe(1);
    expect(diario.dias[0]).toMatchObject({ dia: "2026-07-16", numeroDoDia: 16 });
    expect(diario.dias[0].totais.freteComImposto).toBe(1800);
    expect(diario.dias[2].totais.viagens).toBe(0);
  }, 60_000);

  it("abre o dia com a viagem inteira — o retrato atravessa o banco", async () => {
    /* A prova de que a tela do dia mostra o que o 2Art trouxe, e não uma
       versão empobrecida dele: o retrato sai do arquivo, vira coluna, e volta. */
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    const aberto = (await lerDiaDaCompetencia(db, comp.id, "2026-07-16"))!;

    expect(aberto.dia.viagens).toHaveLength(3);
    expect(aberto.dia.porFrota).toEqual([
      expect.objectContaining({ frota: "PADRAO", freteComImposto: 1500 }),
      expect.objectContaining({ frota: "SPOT", freteComImposto: 300 }),
    ]);

    const completa = aberto.dia.viagens.find((v) => v.placa === "AAA1A11")!;
    expect(completa.detalhe).toMatchObject({
      veiculo: "63",
      ocupacao: 55.23,
      horaDeSaida: "16/07/2026 7:39",
      tempoPrevisto: "9:14",
      kmPrevisto: 124.87,
      unidadeDeOrigem: "30229",
    });

    /* O que a exportação não trouxe continua nulo depois de ir e voltar. */
    const parcial = aberto.dia.viagens.find((v) => v.placa === "BBB2B22")!;
    expect(parcial.detalhe?.ocupacao).toBeNull();
    expect(parcial.detalhe?.valorDaEquipeDeEntregaMotorista).toBeNull();
    expect(parcial.detalhe?.horaDeSaida).toBe("");
  }, 60_000);

  it("dia fora da quinzena não existe — e não é um dia vazio", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    expect(await lerDiaDaCompetencia(db, comp.id, "2026-07-01")).toBeNull();
  });

  it("salvar a quinzena exige ter apurado — congelar o que não se sabe quanto vale é pior", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 10, quinzena: 1, unidade, transportadora, tipoDeOperacao });
    await expect(encerrarCompetencia(db, comp.id)).rejects.toMatchObject({
      codigo: "COMPETENCIA_NAO_APURADA",
    });
  });

  it("salva a quinzena, e salvar de novo é um clique repetido e não um erro", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    const fechada = await encerrarCompetencia(db, comp.id);
    expect(fechada.estado).toBe("ENCERRADA");
    expect(fechada.encerradaEm).not.toBeNull();
    expect((await encerrarCompetencia(db, comp.id)).estado).toBe("ENCERRADA");
  });

  it("a quinzena salva não aceita mais nem documento nem reapuração", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "OPERACAO",
        nomeDoArquivo: "tarde-demais.xlsx",
        conteudo: fixtureOperacao(),
      }),
    ).rejects.toMatchObject({ codigo: "COMPETENCIA_ENCERRADA" });
    await expect(apurarCompetencia(db, comp.id)).rejects.toMatchObject({
      codigo: "COMPETENCIA_ENCERRADA",
    });
  });

  it("reabrir exige motivo escrito, e o motivo fica no registro", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    await expect(reabrirCompetencia(db, comp.id, { motivo: "   " })).rejects.toMatchObject({
      codigo: "MOTIVO_OBRIGATORIO",
    });

    const reaberta = await reabrirCompetencia(db, comp.id, {
      motivo: "A Ambev reenviou o 03.08.15 com a VBZ 29 corrigida.",
    });
    /* Volta para APURADA e não para ABERTA: a apuração que estava lá continua valendo. */
    expect(reaberta.estado).toBe("APURADA");
    expect(reaberta.encerradaEm).toBeNull();
    expect(reaberta.motivoDaReabertura).toContain("VBZ 29");
    /*
      E volta a aceitar escrita. Reapurar é a prova mais direta que existe: a
      apuração grava em `fechamento_apuracao`, que é uma das tabelas que o
      gatilho congela — se ela passa, o descongelamento é real e não uma
      etiqueta trocada.
    */
    const { apuracao } = await apurarCompetencia(db, comp.id);
    expect(apuracao.totais.emitido).toBe(4450);
  }, 60_000);

  it("reabrir o que não está encerrado é recusado", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora, tipoDeOperacao });
    await expect(reabrirCompetencia(db, comp.id, { motivo: "qualquer" })).rejects.toMatchObject({
      codigo: "COMPETENCIA_NAO_ESTA_ENCERRADA",
    });
  });

  it("as partes saem das competências, com o nome mais recente de cada código", async () => {
    const partes = await listarPartes(db);
    const cdd = partes.unidades.find((u) => u.codigo === "443");
    expect(cdd?.nome).toBe("CDD FICTICIO");
    expect(cdd?.competencias).toBeGreaterThan(1);
    expect(partes.transportadoras.map((t) => t.codigo)).toContain("36");
  });

  /*
    O cadastro de partes — a metade da lista que não depende de competência
    nenhuma.

    Os três casos abaixo são o defeito relatado e as duas regras que o
    conserto não pode quebrar: a parte cadastrada **sobrevive à exclusão** da
    importação que a usou; recadastrar com nome novo **renomeia**; e
    recadastrar sem nome **não apaga** o nome que já estava lá. Os códigos são
    próprios (`901`, `902`) para não mexer com o `443` dos testes acima.
  */
  it("a parte cadastrada continua na lista depois de a competência ser excluída", async () => {
    const nova = { codigo: "901", nome: "CDD DO CADASTRO" };
    const comp = await abrirCompetencia(db, {
      ano: 2026,
      mes: 11,
      quinzena: 1,
      unidade: nova,
      transportadora,
      tipoDeOperacao,
    });

    /* Antes: a unidade aparece com a competência que a estreou. */
    const durante = (await listarPartes(db)).unidades.find((u) => u.codigo === "901");
    expect(durante).toEqual({ codigo: "901", nome: "CDD DO CADASTRO", competencias: 1 });

    await excluirCompetencia(db, comp.id);

    /*
      Depois: a competência foi embora e o nome ficou. Era exatamente isto que
      se perdia — quem excluía a importação aberta por engano voltava para um
      campo que dizia "Nada encontrado" sobre o CDD que tinha acabado de
      escrever.
    */
    const depois = (await listarPartes(db)).unidades.find((u) => u.codigo === "901");
    expect(depois).toEqual({ codigo: "901", nome: "CDD DO CADASTRO", competencias: 0 });
  });

  it("recadastrar com nome novo renomeia, e sem nome mantém o que estava lá", async () => {
    const soCodigo = await registrarParte(db, { tipo: "UNIDADE", codigo: "902" });
    expect(soCodigo).toEqual({ codigo: "902", nome: null, competencias: 0 });

    const nomeada = await registrarParte(db, {
      tipo: "UNIDADE",
      codigo: "902",
      nome: "CDD SEGUNDO NOME",
    });
    expect(nomeada.nome).toBe("CDD SEGUNDO NOME");

    /* Sem nome não é "apague o nome": é "não tenho um para dar". */
    const semNomeDeNovo = await registrarParte(db, { tipo: "UNIDADE", codigo: "902" });
    expect(semNomeDeNovo.nome).toBe("CDD SEGUNDO NOME");

    /* E o vazio digitado vale o mesmo que a ausência — nunca um nome em branco. */
    const comEspaco = await registrarParte(db, { tipo: "UNIDADE", codigo: " 902 ", nome: "   " });
    expect(comEspaco).toEqual({ codigo: "902", nome: "CDD SEGUNDO NOME", competencias: 0 });

    const unidades = (await listarPartes(db)).unidades.filter((u) => u.codigo === "902");
    expect(unidades).toHaveLength(1);
  });

  it("o mesmo código pode ser um CDD e uma transportadora — são dois cadastros", async () => {
    await registrarParte(db, { tipo: "TRANSPORTADORA", codigo: "902", nome: "OUTRA COISA" });
    const partes = await listarPartes(db);
    expect(partes.unidades.find((u) => u.codigo === "902")?.nome).toBe("CDD SEGUNDO NOME");
    expect(partes.transportadoras.find((x) => x.codigo === "902")?.nome).toBe("OUTRA COISA");
  });

  it("o código em branco é recusado — não é uma parte, é um campo vazio", async () => {
    await expect(registrarParte(db, { tipo: "UNIDADE", codigo: "   " })).rejects.toMatchObject({
      codigo: "PARTE_SEM_CODIGO",
    });
  });

  /*
    O resumo que a tela de Apurações lê, conferido contra as mesmas linhas de
    onde ele sai. É o caso que impede as duas formas de errar uma lista somada
    no banco: contar documento substituído como se ainda valesse, e deixar a
    soma das divergências inflar por causa do `join` (ver `listarApuracoes`).
  */
  it("resume cada competência sem contar documento substituído nem inflar a soma", async () => {
    const resumos = await listarApuracoes(db);

    /* Da quinzena mais recente para a mais antiga — a ordem da tela. */
    const chaves = resumos.map((r) => r.competencia.chave);
    expect([...chaves].sort().reverse()).toEqual(chaves);

    /* A chave sozinha não identifica uma competência: a trinca é (unidade,
       transportadora, período), e outras unidades têm a mesma quinzena aberta
       nesta suíte. O resumo conferido aqui é o do CDD que recebeu as cinco. */
    const q2 = resumos.find(
      (r) => r.competencia.chave === "2026-07-Q2" && r.competencia.unidade.codigo === "443",
    )!;
    expect(q2.relatorios).toEqual([
      "OPERACAO",
      "CTE",
      "DISPONIBILIDADE",
      "REQUISICOES",
      "CONCILIACAO",
    ]);
    expect(q2.apuracao?.emitido).toBe(4450);
    expect(q2.apuracao?.naoConferido).toBe(2000);

    /*
      A soma que o `sum(abs(...))` devolveu tem de bater, ao centavo, com a
      soma das mesmas divergências linha a linha. Um `join` a mais na consulta
      multiplicaria as linhas e este número dobraria sem que nada mais mudasse.
    */
    const vigente = (await lerApuracaoVigente(db, q2.competencia.id))!;
    const aQuestionar = vigente.divergencias
      .filter((d) => d.sentido !== "INFORMATIVO" && d.desfecho !== "ACEITA" && d.desfecho !== "RESOLVIDA")
      .reduce((soma, d) => soma + Math.abs(d.valor), 0);
    expect(aQuestionar).toBeGreaterThan(0);
    expect(q2.apuracao?.aQuestionar).toBeCloseTo(aQuestionar, 2);

    /* O reenvio corrigido deixou dois documentos, e só um vigente. */
    const q1 = resumos.find((r) => r.competencia.chave === "2026-08-Q1")!;
    expect(q1.relatorios).toEqual(["REQUISICOES"]);

    /* Sem apuração é `null`, e não zero: ela não vale zero, ela não rodou. */
    const semNada = resumos.find((r) => r.competencia.chave === "2026-10-Q1")!;
    expect(semNada.relatorios).toEqual([]);
    expect(semNada.apuracao).toBeNull();
  }, 60_000);

  /*
    O 03.08.20 tem unidade própria (`445`) pelo mesmo motivo do descarte: ele
    muda o não conferido da competência em que entra, e as asserções acima leem
    a de `443`.
  */
  describe("o 03.08.20 no banco", () => {
    const unidadeDoPagamento = { codigo: "445", nome: "CDD DO PAGAMENTO" };

    it("fecha o fixo que as outras fontes deixavam sem quem conferisse", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2026,
        mes: 7,
        quinzena: 2,
        unidade: unidadeDoPagamento,
        transportadora,
      tipoDeOperacao,
      });
      await receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "CTE",
        nomeDoArquivo: "03.08.15.xlsx",
        conteudo: fixtureCtes(),
      });

      /*
        Só o 03.08.15: sem nenhuma fonte que confira, o emitido inteiro
        (4.450,00) é não conferido. É o retrato mais honesto que a apuração
        consegue dar de uma competência com um arquivo só.
      */
      await apurarCompetencia(db, comp.id);
      const semEle = (await lerApuracaoVigente(db, comp.id))!;
      expect(semEle.totais.naoConferido).toBe(4450);
      expect(semEle.verbas.find((v) => v.vbz === 1)?.esperado).toBeNull();

      const recebido = await receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "PAGAMENTO",
        nomeDoArquivo: "03.08.20.txt",
        conteudo: fixturePagamento(),
      });
      /* Três verbas e seis descontos: o relatório inteiro, não só o que a
         conta usa. */
      expect(recebido.linhasLidas).toBe(9);

      /* Com ele, os 2.000,00 do fixo saem do não conferido — e só eles: as
         variáveis continuam esperando as fontes que as reconstroem. */
      await apurarCompetencia(db, comp.id);
      const comEle = (await lerApuracaoVigente(db, comp.id))!;
      expect(comEle.totais.naoConferido).toBe(4450 - 2000);

      /* A memória volta do banco com a parcela, e não recalculada na leitura. */
      const fixa = comEle.verbas.find((v) => v.vbz === 1)!;
      expect(fixa.esperado).toBe(2000);
      expect(fixa.memoria.map((m) => m.origem)).toEqual(["PAGAMENTO"]);
      expect(fixa.memoria[0]?.semImposto).toBe(1600);
    }, 60_000);

    it("o resumo do mês lê o demonstrativo do banco, e diz o que falta da outra quinzena", async () => {
      const resumo = await lerResumoDoMes(db, {
        unidade: unidadeDoPagamento.codigo,
        transportadora: transportadora.codigo,
        tipoDeOperacao,
        ano: 2026,
        mes: 7,
      });

      /*
        `canal` aqui é o outro eixo — `ROTA` | `AS`, distribuição urbana contra
        área de serviço —, e não o `tipoDeOperacao` que acabou de recortar a
        busca. As duas palavras colidem em "ROTA" e vivem no mesmo objeto, que é
        precisamente por que a coluna da `0046` não se chama `canal`.
      */
      const rota = resumo.canais.find((c) => c.canal === "ROTA")!;
      /* Só a 2ª quinzena existe: a coluna da 1ª fica vazia, e o total do mês é
         o que existe — não meio mês com cara de mês inteiro. */
      expect(rota.emitido.primeira).toBeNull();
      expect(rota.emitido.segunda).toBe(4350);
      expect(rota.emitido.total).toBe(4350);
      expect(resumo.quinzenas.find((q) => q.quinzena === 1)).toMatchObject({
        competenciaId: null,
        apurada: false,
      });

      /* `Total Remuneração` do 03.08.20: frete 3.000,00 + outros 500,00. */
      expect(rota.demonstrativo.segunda).toBe(3500);
      expect(rota.diferenca.segunda).toBe(4350 - 3500);
      /* O frete mínimo do relatório chega inteiro, e fora das somas. */
      expect(rota.descontos.find((d) => d.tipo === "FRETE_MINIMO")?.valores.segunda).toBe(50);
    }, 60_000);

    it("recusa o demonstrativo de outro período, pelo que ele mesmo declara", async () => {
      /*
        O caso que motivou a checagem: julho lançado em agosto. O 03.08.20 é a
        única fonte que escreve o período no cabeçalho, e por isso é a única em
        que o erro pode ser pego na porta em vez de uma quinzena depois.
      */
      const agosto = await abrirCompetencia(db, {
        ano: 2026,
        mes: 8,
        quinzena: 1,
        unidade: unidadeDoPagamento,
        transportadora,
      tipoDeOperacao,
      });
      const recusa = await receberDocumento(db, {
        competenciaId: agosto.id,
        tipo: "PAGAMENTO",
        nomeDoArquivo: "03.08.20.txt",
        conteudo: fixturePagamento(),
      }).catch((e: unknown) => e);

      expect(recusa).toBeInstanceOf(RecusaDeFechamento);
      expect((recusa as RecusaDeFechamento).codigo).toBe("DOCUMENTO_FORA_DO_PERIODO");
      /* Os dois períodos aparecem por extenso: é o que responde "qual dos
         arquivos eu troquei?" na hora do erro. */
      expect((recusa as RecusaDeFechamento).message).toContain("16/07/2026 a 31/07/2026");
      expect((recusa as RecusaDeFechamento).message).toContain("01/08/2026 a 15/08/2026");
      expect(await listarDocumentos(db, agosto.id)).toEqual([]);
    });
  });

  /*
    O descarte — o desfazer de quem lançou a quinzena no período errado.

    Ele mora numa unidade própria (`444`) porque apaga tudo que encontra, e as
    asserções acima leem a competência de `443` que os testes anteriores
    montaram. Duas quinzenas iguais em unidades diferentes é o caso real de
    qualquer forma: a chave de uma competência é (unidade, transportadora,
    quinzena), não a quinzena sozinha.
  */
  describe("o descarte dos dados", () => {
    const unidadeDoDescarte = { codigo: "444", nome: "CDD DO DESCARTE" };

    it("apaga arquivos, linhas e apuração, e deixa a competência aberta", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2026,
        mes: 7,
        quinzena: 2,
        unidade: unidadeDoDescarte,
        transportadora,
      tipoDeOperacao,
      });
      const fontes = [
        ["OPERACAO", "2art.xlsx", fixtureOperacao()],
        ["CTE", "03.08.15.xlsx", fixtureCtes()],
        ["REQUISICOES", "03.08.12.09.csv", fixtureRequisicoes()],
        ["DISPONIBILIDADE", "03.08.18.xlsx", fixtureDisponibilidade()],
        ["CONCILIACAO", "03.02.59.02.txt", Buffer.from(fixtureConciliacao(), "latin1")],
      ] as const;
      for (const [tipo, nome, conteudo] of fontes) {
        await receberDocumento(db, {
          competenciaId: comp.id,
          tipo,
          nomeDoArquivo: nome,
          conteudo: conteudo as Buffer,
        });
      }
      await apurarCompetencia(db, comp.id);
      expect(await lerApuracaoVigente(db, comp.id)).not.toBeNull();

      const saiu = await descartarDadosDaCompetencia(db, comp.id);

      expect(saiu.documentos).toBe(5);
      expect(saiu.apuracoes).toBe(1);
      expect(saiu.linhas.OPERACAO).toBeGreaterThan(0);
      expect(saiu.linhas.CTE).toBeGreaterThan(0);
      expect(saiu.linhas.CONCILIACAO).toBeGreaterThan(0);
      expect(saiu.competencia.estado).toBe("ABERTA");

      /* Nada do que a tela lê sobrevive ao descarte — nem a conta, nem a grade. */
      expect(await listarDocumentos(db, comp.id)).toEqual([]);
      expect(await lerApuracaoVigente(db, comp.id)).toBeNull();
      expect((await lerDiarioDaCompetencia(db, comp.id))!.fonte).toBeNull();

      /* A competência sobrevive: as datas e as partes nunca estiveram erradas. */
      const sobrevivente = await buscarCompetencia(db, comp.id);
      expect(sobrevivente?.chave).toBe("2026-07-Q2");
      expect(sobrevivente?.estado).toBe("ABERTA");
      expect(sobrevivente?.apuradaEm).toBeNull();
    }, 60_000);

    it("depois dele o mesmo arquivo entra de novo — é para isso que ele apaga", async () => {
      /*
        A prova de que despromover não bastaria. O índice
        `(competência, sha256)` recusa o mesmo conteúdo duas vezes na mesma
        competência, e é assim que tem de ser enquanto o documento existe: é o
        que impede a conta de dobrar. Quem lançou o período errado precisa
        justamente reenviar o mesmo arquivo depois de corrigir a data — se o
        descarte deixasse o registro para trás, o conserto seria impossível
        pela porta da frente.
      */
      const comp = await abrirCompetencia(db, {
        ano: 2026,
        mes: 7,
        quinzena: 2,
        unidade: unidadeDoDescarte,
        transportadora,
      tipoDeOperacao,
      });
      const enviar = () =>
        receberDocumento(db, {
          competenciaId: comp.id,
          tipo: "CTE" as const,
          nomeDoArquivo: "03.08.15.xlsx",
          conteudo: fixtureCtes(),
        });

      const primeiro = await enviar();
      expect(primeiro.linhasLidas).toBeGreaterThan(0);
      await expect(enviar()).rejects.toMatchObject({ codigo: "DOCUMENTO_JA_RECEBIDO" });

      await descartarDadosDaCompetencia(db, comp.id);

      const denovo = await enviar();
      expect(denovo.linhasLidas).toBe(primeiro.linhasLidas);
      expect(denovo.substituiu).toBeNull();
    }, 60_000);

    it("recusa a competência encerrada em vez de deixar o gatilho falar sozinho", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2026,
        mes: 11,
        quinzena: 1,
        unidade: unidadeDoDescarte,
        transportadora,
      tipoDeOperacao,
      });
      await pool.query("update fechamento_competencia set estado = 'ENCERRADA' where id = $1", [
        comp.id,
      ]);
      await expect(descartarDadosDaCompetencia(db, comp.id)).rejects.toMatchObject({
        codigo: "COMPETENCIA_ENCERRADA",
      });
    });
  });

  /*
    A exclusão é o outro erro: não é a quinzena certa com os arquivos errados —
    é a quinzena que não devia existir. Unidade própria (`446`) pela mesma razão
    do descarte: ela leva a competência inteira embora, e as asserções dos
    outros blocos leem as competências que eles montaram.
  */
  describe("a exclusão da importação", () => {
    const unidadeDaExclusao = { codigo: "446", nome: "CDD DA EXCLUSAO" };

    it("leva a competência junto — a importação deixa de existir", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2026,
        mes: 7,
        quinzena: 2,
        unidade: unidadeDaExclusao,
        transportadora,
      tipoDeOperacao,
      });
      const fontes = [
        ["OPERACAO", "2art.xlsx", fixtureOperacao()],
        ["CTE", "03.08.15.xlsx", fixtureCtes()],
        ["REQUISICOES", "03.08.12.09.csv", fixtureRequisicoes()],
      ] as const;
      for (const [tipo, nome, conteudo] of fontes) {
        await receberDocumento(db, {
          competenciaId: comp.id,
          tipo,
          nomeDoArquivo: nome,
          conteudo: conteudo as Buffer,
        });
      }
      await apurarCompetencia(db, comp.id);

      const saiu = await excluirCompetencia(db, comp.id);

      /* O tamanho do que foi embora volta contado: é o que a tela repete. */
      expect(saiu.documentos).toBe(3);
      expect(saiu.apuracoes).toBe(1);
      expect(saiu.linhas.OPERACAO).toBeGreaterThan(0);
      expect(saiu.linhas.CTE).toBeGreaterThan(0);
      expect(saiu.competencia.chave).toBe("2026-07-Q2");

      /* E a competência não está mais lá — nem para quem pergunta pelo id. */
      expect(await buscarCompetencia(db, comp.id)).toBeNull();
      expect((await listarCompetencias(db)).some((c) => c.id === comp.id)).toBe(false);
      expect((await listarApuracoes(db)).some((a) => a.competencia.id === comp.id)).toBe(false);
    }, 60_000);

    it("depois dela a mesma quinzena pode ser aberta de novo, do zero", async () => {
      /*
        A prova de que nada ficou para trás: `abrirCompetencia` devolve a que já
        existe quando existe, então um id novo só sai se a anterior tiver
        mesmo saído do banco.
      */
      const antes = await abrirCompetencia(db, {
        ano: 2026,
        mes: 10,
        quinzena: 1,
        unidade: unidadeDaExclusao,
        transportadora,
      tipoDeOperacao,
      });
      await excluirCompetencia(db, antes.id);
      const depois = await abrirCompetencia(db, {
        ano: 2026,
        mes: 10,
        quinzena: 1,
        unidade: unidadeDaExclusao,
        transportadora,
      tipoDeOperacao,
      });
      expect(depois.id).not.toBe(antes.id);
      expect(depois.estado).toBe("ABERTA");
    });

    it("recusa a encerrada: apagar a prova de uma cobrança pede reabrir antes", async () => {
      const comp = await abrirCompetencia(db, {
        ano: 2026,
        mes: 11,
        quinzena: 2,
        unidade: unidadeDaExclusao,
        transportadora,
      tipoDeOperacao,
      });
      await pool.query("update fechamento_competencia set estado = 'ENCERRADA' where id = $1", [
        comp.id,
      ]);
      await expect(excluirCompetencia(db, comp.id)).rejects.toMatchObject({
        codigo: "COMPETENCIA_ENCERRADA",
      });
      /* E ela continua inteira: a recusa não apagou nada pela metade. */
      expect(await buscarCompetencia(db, comp.id)).not.toBeNull();

      /* Reaberta, com motivo, a exclusão passa — é o caminho que a recusa diz. */
      await reabrirCompetencia(db, comp.id, { motivo: "quinzena aberta em duplicidade" });
      await excluirCompetencia(db, comp.id);
      expect(await buscarCompetencia(db, comp.id)).toBeNull();
    });

    it("recusa o id que não existe, e não devolve zero como se tivesse apagado nada", async () => {
      await expect(
        excluirCompetencia(db, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toMatchObject({ codigo: "COMPETENCIA_NAO_ENCONTRADA" });
    });
  });

  it("uma competência encerrada não aceita documento", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 9, quinzena: 1, unidade, transportadora, tipoDeOperacao });
    await pool.query("update fechamento_competencia set estado = 'ENCERRADA' where id = $1", [comp.id]);
    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "CTE",
        nomeDoArquivo: "tarde-demais.xlsx",
        conteudo: fixtureCtes(),
      }),
    ).rejects.toMatchObject({ codigo: "COMPETENCIA_ENCERRADA" });
  });
});
