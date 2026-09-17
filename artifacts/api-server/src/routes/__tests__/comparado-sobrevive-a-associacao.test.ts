import { readFileSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  cadastrarUnidade,
  db as dbDoProcesso,
  encerrarPoolDoProcesso,
  remuneracaoPlanilhaTable,
  remuneracaoUnidadeTable,
} from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * O CASO REAL, PELA API — associar a unidade e o painel comparado continuar de pé.
 *
 * **Por que por HTTP, e não pela composição.** O defeito não estava no cálculo:
 * `compararPaineis` sempre soube comparar. Estava na cadeia — quem escreve a
 * identidade, quem a lê, e o que a rota faz entre uma coisa e outra. Uma prova
 * que chamasse as funções na ordem certa provaria a ordem que o teste escolheu,
 * não a que a rota executa. Aqui as duas rotas são as de verdade: a associação
 * entra por `PUT /fechamento/competencias/:id/unidade` e o painel sai de
 * `GET /fechamento/resumo`, que é literalmente o que a tela busca.
 *
 * **O critério de aceite, escrito como asserção.** Depois da associação: o
 * `comparado` continua; as cinco linhas do custo fixo trazem no **Devido** os
 * números que a planilha da operação publica, ao centavo; e o **Demonstrado**
 * delas segue `em conjunto`, porque o 03.08.20 não parte a frota fixa por tipo
 * e nada nesta correção fingiu que ele parte.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CNPJ = "11.222.333/0001-81";
const ESCOPO = "escopo-do-caso-real";
const UNIDADE = { codigo: CNPJ, nome: "CDD BELÉM" };
const TRANSPORTADORA = { codigo: "36", nome: "HORIZONTE" };
const MES = {
  unidade: UNIDADE.codigo,
  transportadora: "36",
  tipoDeOperacao: "ROTA",
  ano: 2026,
  mes: 7,
};

/**
 * As cinco linhas do custo fixo e o que a planilha publica em cada uma.
 *
 * Não são digitados aqui por escolha: saem de `julho-2026.json`, a amostra
 * extraída da `.xlsb` real, e são conferidos contra ela abaixo. A lista literal
 * existe para que o critério de aceite esteja legível no arquivo do teste.
 */
const DO_CONTRATO: [string, number][] = [
  ["custo_fixo_padronizado", 731502.84],
  ["custo_fixo_inativos", 9017.3],
  ["custo_vans_inativas", 13088.62],
  ["custo_fixo_especiais", 5938.28],
  ["custo_fixo_vans", 42745.64],
];

const ABA: [string, number][] = [
  ["aliquota_pis", 0.65],
  ["aliquota_cofins", 8.6],
  ["aliquota_icms", 17.84],
  ["aliquota_iss", 5.9],
  ["rota_percentual_iss", 3.16],
  ["frota_fixa_ativos", 56],
  ["frota_fixa_inativos", 8],
  ["ativo_remuneracao_fixa_frota", 1424.91],
  ["ativo_remuneracao_fixa_equipe", 8919.38],
  ["ativo_custo_variavel", 5176.53],
  ["ativo_remuneracao_fixa_qlp", 4427.53],
  ["ativo_outras_despesas", 4361.07],
  ["inativo_remuneracao_fixa", 1650.97],
  ["van_quantidade_ativas", 7],
  ["van_custo_fixo", 4693.85],
  ["van_custo_equipe", 4250.45],
  ["van_quantidade_inativas", 6],
  ["van_remuneracao_inativas", 3195.18],
  ["noturna_quantidade_rotas", 1],
  ["noturna_custo_sem_impostos", 8697.88],
];

function amostra(nome: string): string {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../../lib/fechamento/src/__tests__/amostras/",
    nome,
  );
}

function planilhaDeReferencia(): Record<string, number> {
  const conteudo = JSON.parse(readFileSync(amostra("julho-2026.json"), "utf8")) as {
    quinzenas: { quinzena: number; resumoGeral: Record<string, number> }[];
  };
  return conteudo.quinzenas.find((q) => q.quinzena === 1)!.resumoGeral;
}

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

const rotaDoResumo = async () => {
  const { status, body } = await pedir(`/fechamento/resumo?${busca(MES)}`);
  expect(status).toBe(200);
  return body.canais.find((c: any) => c.canal === "ROTA");
};

beforeAll(async () => {
  ctx = await createTestDatabase("api_comparado_associacao");
  process.env.DATABASE_URL = ctx.url;

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

  /* --- o mês do caso real: as duas quinzenas abertas --------------------- */
  for (const quinzena of [1, 2] as const) {
    const { status } = await pedir("/fechamento/competencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ano: MES.ano,
        mes: MES.mes,
        quinzena,
        unidade: UNIDADE,
        transportadora: TRANSPORTADORA,
        tipoDeOperacao: MES.tipoDeOperacao,
      }),
    });
    expect(status).toBeLessThan(300);
  }

  /* O 03.08.20 real da 1ª quinzena, importado e apurado pela própria rota. */
  const competencias = await pedir(`/fechamento/competencias?${busca(MES)}`);
  const primeira = competencias.body.find((c: any) => c.quinzena === 1);
  const enviado = await pedir(`/fechamento/competencias/${primeira.id}/documentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tipo: "PAGAMENTO",
      filename: "03.08.20-2026-07-Q1.txt",
      contentBase64: readFileSync(amostra("03.08.20-2026-07-Q1.txt")).toString("base64"),
    }),
  });
  expect(enviado.status, JSON.stringify(enviado.body)).toBe(201);

  const apurado = await pedir(`/fechamento/competencias/${primeira.id}/apuracao`, {
    method: "POST",
  });
  expect(apurado.status, JSON.stringify(apurado.body)).toBeLessThan(300);

  /*
    O CADASTRO LEGADO — o passivo real: registrado antes de a unidade canônica
    existir, e por isso com `unidade_id` nulo. É a única condição que produz o
    defeito, e ela não é reproduzível pela rota de cadastro de hoje, que já
    grava a identidade. Por isso entra pelo banco.
  */
  await dbDoProcesso.insert(remuneracaoUnidadeTable).values({
    scopeHash: ESCOPO,
    scopeType: "UNIDADE",
    codigo: CNPJ,
    nome: "CDD BELEM",
    canal: "ROTA",
    unidadeId: null,
    vigenciaInicial: "2026-07-01",
  });
  for (const vigencia of ["2026-07-01", "2026-07-16"]) {
    await dbDoProcesso.insert(remuneracaoPlanilhaTable).values(
      ABA.map(([chave, valor]) => ({
        scopeHash: ESCOPO,
        canal: "ROTA",
        effectiveDate: vigencia,
        chave,
        valor: String(valor),
      })),
    );
  }
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  /*
    O pool do processo primeiro: as rotas o abriram contra o banco descartável,
    e derrubar o banco com ele aberto faz o `pg` emitir `57P01` em cada cliente
    — nove testes passam e a suíte falha no desligamento. Ver
    `encerrarPoolDoProcesso`.
  */
  await encerrarPoolDoProcesso().catch(() => {});
  await ctx?.drop().catch(() => {});
});

describe("o caso real, da associação ao painel", () => {
  it("antes de associar, o mês já responde pelo cadastro", async () => {
    const rota = await rotaDoResumo();

    expect(rota.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(rota.comparado).not.toBeNull();
  });

  /**
   * O CLIQUE — e o que ele não pode custar.
   *
   * É o gesto que a tela oferece na caixa de pendências, pela rota de verdade.
   * Antes desta correção, era exatamente aqui que o `comparado` virava `null`.
   */
  it("associar a unidade canônica pela rota mantém o painel comparado", async () => {
    const u = await cadastrarUnidade(dbDoProcesso, { nome: "CDD BELEM", cnpj: CNPJ });

    const competencias = await pedir(`/fechamento/competencias?${busca(MES)}`);
    const primeira = competencias.body.find((c: any) => c.quinzena === 1);

    const { status } = await pedir(
      `/fechamento/competencias/${primeira.id}/unidade`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidadeId: u.id }),
      },
    );
    expect(status).toBe(200);

    const rota = await rotaDoResumo();

    /* O critério de aceite, na ordem em que a tela o vive. */
    expect(rota.comparado).not.toBeNull();
    expect(rota.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(rota.cadastro.segunda?.estado).toBe("RESPONDEU");
    /* E agora pela identidade — nenhum texto é comparado em ponto nenhum. */
    expect(rota.cadastro.primeira?.unidade.comoCasou).toBe("IDENTIDADE");
  }, 60_000);

  /**
   * AS CINCO LINHAS, ABERTAS NO DEVIDO — e ainda `em conjunto` no Demonstrado.
   *
   * As duas metades do critério vivem no mesmo teste de propósito: a correção
   * seria falsa se abrisse o Devido às custas de inventar um Demonstrado por
   * linha. O relatório sai por `console.log` na mesma forma do
   * `resumo-da-unidade-canonica`, para ser lido sem abrir o objeto.
   */
  it("as cinco linhas do fixo batem no Devido, e o Demonstrado segue em conjunto", async () => {
    const rota = await rotaDoResumo();
    const linhas = rota.comparado.quadros.flatMap((q: any) => q.linhas);
    const planilha = planilhaDeReferencia();

    const relatorio: string[] = [];
    const naoBatem: string[] = [];

    for (const [chave, esperado] of DO_CONTRATO) {
      const linha = linhas.find((l: any) => l.chave === chave);
      expect(linha, `a linha ${chave} sumiu do painel`).toBeTruthy();

      const devido = linha.devido.primeira as number | null;
      const daAmostra = planilha[chave]!;

      /* A lista literal do topo e a amostra da `.xlsb` têm de dizer o mesmo. */
      expect(Number(daAmostra.toFixed(2))).toBe(esperado);

      const diferenca = devido === null ? null : Number((devido - daAmostra).toFixed(2));
      const bate = diferenca !== null && Math.abs(diferenca) < 0.005;
      if (!bate) naoBatem.push(`${chave}: planilha ${daAmostra}, produto ${devido}`);

      /*
        O Demonstrado desta linha é `null` **e** ela pertence a um conjunto: é o
        `em conjunto` da tela. Não é falta de arquivo — o 03.08.20 está
        importado e o conjunto tem número; é o relatório não partir a frota fixa
        por tipo, e continuar não partindo.
      */
      expect(linha.demonstrado.primeira).toBeNull();
      expect(linha.conjunto).not.toBeNull();

      relatorio.push(
        [
          linha.rotulo,
          daAmostra.toFixed(2),
          devido?.toFixed(2) ?? "—",
          diferenca?.toFixed(2) ?? "—",
          bate ? "BATE" : "NÃO BATE",
          "em conjunto",
        ].join(" | "),
      );
    }

    console.log(
      [
        "",
        "Linha | Planilha | FreightCheck (Devido) | Diferença | Resultado | Demonstrado",
        ...relatorio,
      ].join("\n"),
    );

    expect(naoBatem, naoBatem.join(" · ")).toEqual([]);

    /* O conjunto, esse sim, tem número — e é contra ele que a soma é auditada. */
    const conjuntos = rota.comparado.quadros.flatMap((q: any) => q.conjuntos);
    const fixo = conjuntos.find((c: any) => c.chave === "fixo_bruto");
    expect(fixo).toBeTruthy();
    expect(fixo.demonstrado.primeira).not.toBeNull();
    expect(Number(fixo.devido.primeira.toFixed(2))).toBe(
      Number(DO_CONTRATO.reduce((s, [, v]) => s + v, 0).toFixed(2)),
    );
  }, 60_000);
});
