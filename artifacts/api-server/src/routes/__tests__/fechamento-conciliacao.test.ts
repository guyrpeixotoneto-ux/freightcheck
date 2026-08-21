import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import * as XLSX from "xlsx";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { ABA_DO_RESUMO, COLUNA_DA_QUINZENA, LINHA_NO_RESUMO } from "@workspace/fechamento";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `GET /fechamento/conciliacao` — a leitura que tem a régua, ao lado da que não tem.
 *
 * O Resumo e a Conciliação leem o **mesmo mês** e respondem coisas diferentes:
 * lá, o fechamento contra as duas fontes que sempre existem — o contrato e o
 * 03.08.20 —; aqui, o mesmo mês com a planilha da operação enxertada. Separá-los
 * em dois endereços é o que faz o Resumo continuar respondendo sem uma consulta
 * a mais para descobrir que não há arquivo anexado, e é o que deixa o log dizer
 * qual das duas perguntas foi feita.
 *
 * **O que esta suíte prova, e o que ela deliberadamente não prova.** Que os dois
 * endereços existem, que endereçam o mês pela mesma régua — a mesma recusa para
 * a mesma URL, palavra por palavra — e que o enxerto não tem onde pousar quando
 * não há painel comparado, que é o estado que a tela da Conciliação anuncia em
 * vez de abrir colunas de traços.
 *
 * O que a coluna da planilha vale, linha a linha, está provado sem HTTP e sem
 * banco em `painel-referencia.test.ts`; que ela não toca na conta, em
 * `contaminacao.test.ts`. Repetir aqui mediria o mesmo com um servidor no meio.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const UNIDADE = { codigo: "081-0443", nome: "CRBS SA - CDD Belem" };
const TRANSPORTADORA = { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" };
const MES = { unidade: UNIDADE.codigo, transportadora: "36", tipoDeOperacao: "ROTA", ano: 2026, mes: 7 };

async function pedir(
  caminho: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function busca(alvo: Record<string, unknown>): string {
  return new URLSearchParams(
    Object.entries(alvo).map(([k, v]) => [k, String(v)]),
  ).toString();
}

/**
 * Uma planilha válida — a mesma forma que a porta de leitura exige.
 *
 * Os números não importam para o que esta suíte mede; o que importa é o arquivo
 * ser aceito, porque é depois de ele existir que a pergunta "e agora, muda
 * alguma coisa no Resumo?" passa a ter sentido.
 */
function planilha(base: number): Buffer {
  const aba: XLSX.WorkSheet = { "!ref": "A1:BZ200" };
  for (const quinzena of [1, 2] as const) {
    Object.entries(LINHA_NO_RESUMO).forEach(([, linha], i) => {
      aba[`${COLUNA_DA_QUINZENA[quinzena]}${linha}`] = {
        t: "n",
        v: base + i + (quinzena === 2 ? 1000 : 0),
      };
    });
  }
  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(pasta, aba, ABA_DO_RESUMO);
  return XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_fechamento_conciliacao");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    (req as unknown as { user: unknown }).user = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Guy",
      email: "teste@freightcheck",
      role: "OPERADOR",
    };
    next();
  });
  app.use(fechamentoRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  /* Um mês aberto, para que as duas leituras tenham do que falar. */
  await pedir("/fechamento/competencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ano: MES.ano,
      mes: MES.mes,
      quinzena: 1,
      unidade: UNIDADE,
      transportadora: TRANSPORTADORA,
      tipoDeOperacao: MES.tipoDeOperacao,
    }),
  });
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.pool.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
});

describe("as duas leituras do mesmo mês", () => {
  it("a Conciliação responde no endereço dela, e o mês é o mesmo", async () => {
    const { status, body } = await pedir(`/fechamento/conciliacao?${busca(MES)}`);

    expect(status).toBe(200);
    expect(body.ano).toBe(MES.ano);
    expect(body.mes).toBe(MES.mes);
    expect(body.unidade.codigo).toBe(UNIDADE.codigo);
    expect(body.transportadora.codigo).toBe(MES.transportadora);
  });

  /*
    A mesma URL, a mesma recusa. As duas rotas dividem `mesDoFechamento`, e o que
    este teste impede é a volta de duas cópias da regra: no dia em que uma
    aceitasse o que a outra recusa, um endereço colado numa mensagem abriria uma
    tela e quebraria a outra.
  */
  const incompletos: [string, Record<string, unknown>][] = [
    ["sem unidade", { ...MES, unidade: "" }],
    ["sem transportadora", { ...MES, transportadora: "" }],
    ["sem tipo de operação", { ...MES, tipoDeOperacao: "" }],
    ["com ano fora da régua", { ...MES, ano: 1999 }],
    ["com mês que não existe", { ...MES, mes: 13 }],
  ];

  it.each(incompletos)("400 igual nas duas, %s", async (_nome, alvo) => {
    const resumo = await pedir(`/fechamento/resumo?${busca(alvo)}`);
    const conciliacao = await pedir(`/fechamento/conciliacao?${busca(alvo)}`);

    expect(resumo.status).toBe(400);
    expect(conciliacao.status).toBe(400);
    expect(conciliacao.body.error).toBe(resumo.body.error);
  });

  /**
   * Anexar não muda o Resumo — e é essa a razão de os endereços serem dois.
   *
   * Sem painel comparado o enxerto não tem onde pousar, e nenhuma das duas
   * leituras publica `referencia`: é o estado que a tela da Conciliação anuncia
   * por escrito ("sem cadastro não há coluna contra a qual medir") em vez de
   * abrir colunas de traços. O que o teste prende é que o Resumo continua
   * respondendo o mesmo antes e depois do anexo — a régua entrou no acervo e
   * não entrou naquela leitura.
   */
  it("a planilha anexada não muda uma vírgula do Resumo", async () => {
    const antes = await pedir(`/fechamento/resumo?${busca(MES)}`);
    expect(antes.status).toBe(200);

    const anexo = await pedir(`/fechamento/referencias?${busca(MES)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "Fechamento_Remuneracao.xlsb",
        contentBase64: planilha(100).toString("base64"),
      }),
    });
    expect(anexo.status).toBe(201);
    expect(anexo.body.versao).toBe(1);

    const depois = await pedir(`/fechamento/resumo?${busca(MES)}`);
    expect(depois.body).toEqual(antes.body);

    /* E a régua está no acervo: a lista de versões a nomeia. */
    const versoes = await pedir(`/fechamento/referencias?${busca(MES)}`);
    expect(versoes.body.versoes).toHaveLength(1);
    expect(versoes.body.versoes[0].ativa).toBe(true);
  });
});
