import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  cadastrarUnidade,
  createDb,
  remuneracaoPlanilhaTable,
  remuneracaoUnidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { conciliarIdentidadeDasCompetencias } from "@workspace/fechamento";
import {
  abrirCompetencia,
  apurarCompetencia,
  associarUnidadeDaCompetencia,
  lerResumoDoMes,
  receberDocumento,
} from "@workspace/fechamento/persistencia";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";
import { conciliarIdentidadeDoCadastro } from "../lib/identidade-do-cadastro";

/**
 * A IDENTIDADE DOS DOIS LADOS — as regressões do devido que sumia ao associar.
 *
 * **O defeito.** A identidade canônica era escrita só em
 * `fechamento_competencia.unidade_id`. Como `resolverUnidade` deixa de comparar
 * texto assim que a competência tem identidade — e deve mesmo deixar —, um
 * cadastro de Remuneração com `unidade_id` nulo parava de ser encontrado no
 * instante da associação. O `comparado` sumia, a tela caía na releitura do
 * 03.08.20, e o conserto que ela oferecia não existia como ato no produto.
 *
 * Os dois primeiros casos aqui são exatamente os dois gatilhos: o clique humano
 * e o cadastro da unidade canônica em outra tela. Os dois falhavam antes desta
 * correção — não como exceção, mas devolvendo `comparado: null` em silêncio.
 *
 * **O que estes testes protegem além da correção.** Que ela não virou um
 * casamento frouxo: identidade escrita nunca é sobrescrita, conflito entre os
 * dois sinais determinísticos não é resolvido por escolha, e nada é associado
 * por semelhança de nome.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_identidade_cadastro_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function alcancavel(): Promise<boolean> {
  const { pool } = createDb(ADMIN);
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const temBanco = await alcancavel();
const noCi = process.env.CI === "true" || process.env.CI === "1";
if (!temBanco && noCi) throw new Error("O CI declara um Postgres e ele não respondeu.");

/** O CNPJ da unidade do caso real, na grafia mascarada que a planilha traz. */
const CNPJ_MASCARADO = "11.222.333/0001-81";

/** A aba `Cadastro` de julho/2026 — as 20 obrigatórias do CDD Belém · Horizonte. */
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

function pagamentoReal(): Buffer {
  return readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../../lib/fechamento/src/__tests__/amostras/03.08.20-2026-07-Q1.txt",
    ),
  );
}

describe.skipIf(!temBanco)("a identidade escrita dos dois lados", () => {
  let fechar: () => Promise<void>;
  let db: Database;

  beforeAll(async () => {
    const admin = createDb(ADMIN);
    await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`);
    await admin.pool.query(`CREATE DATABASE "${NOME_DO_BANCO}"`);
    await admin.pool.end();
    const url = apontarPara(ADMIN, NOME_DO_BANCO);
    await runMigrations(url);
    const alvo = createDb(url);
    db = alvo.db;
    fechar = () => alvo.pool.end();
  }, 180_000);

  /*
    O `DROP` espera por conexão que ainda não fechou, e com a suíte inteira
    rodando em paralelo essa espera passa dos 10 s de `hookTimeout` — o arquivo
    passava sozinho e derrubava o pacote junto com os outros quarenta e cinco.
    Encerrar o pool, matar o que restou e derrubar com `FORCE` é o que torna a
    limpeza independente de quem mais está no servidor.
  */
  afterAll(async () => {
    await fechar?.().catch(() => {});
    const admin = createDb(ADMIN);
    await admin.pool
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [NOME_DO_BANCO],
      )
      .catch(() => {});
    await admin.pool
      .query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}" WITH (FORCE)`)
      .catch(() => {});
    await admin.pool.end().catch(() => {});
  }, 60_000);

  /*
    Cada caso começa do zero na mesma instância. Os cenários se distinguem por
    **estado de identidade**, e um deixar rastro no outro faria o teste seguinte
    passar por causa da associação que o anterior escreveu.
  */
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE fechamento_competencia, remuneracao_unidade, remuneracao_planilha, unidade
      RESTART IDENTITY CASCADE
    `);
  });

  /** O mês do caso real, com o 03.08.20 de verdade na 1ª quinzena. */
  async function abrirOMes(codigoDaCompetencia: string): Promise<{ primeira: string }> {
    const c1 = await abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 1,
      tipoDeOperacao: "ROTA",
      unidade: { codigo: codigoDaCompetencia, nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    await receberDocumento(db, {
      competenciaId: c1.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20-2026-07-Q1.txt",
      conteudo: pagamentoReal(),
    });
    await apurarCompetencia(db, c1.id);
    await abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 2,
      tipoDeOperacao: "ROTA",
      unidade: { codigo: codigoDaCompetencia, nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    return { primeira: c1.id };
  }

  /**
   * O CADASTRO LEGADO — o passivo anterior à `0049`, e o centro de tudo isto.
   *
   * `unidadeId: null` não é um detalhe do teste: é o estado de todo cadastro
   * registrado antes de a unidade canônica existir, e o único estado em que o
   * defeito aparece.
   */
  async function cadastroLegado(codigo: string, escopo = "escopo-legado"): Promise<void> {
    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: escopo,
      scopeType: "UNIDADE",
      codigo,
      nome: "CDD BELEM",
      canal: "ROTA",
      unidadeId: null,
      vigenciaInicial: "2026-07-01",
    });
    for (const vigencia of ["2026-07-01", "2026-07-16"]) {
      await db.insert(remuneracaoPlanilhaTable).values(
        ABA.map(([chave, valor]) => ({
          scopeHash: escopo,
          canal: "ROTA",
          effectiveDate: vigencia,
          chave,
          valor: String(valor),
        })),
      );
    }
  }

  const resumoDaRota = async (codigoDaCompetencia: string) => {
    const resumo = await lerResumoDoMes(
      db,
      {
        unidade: codigoDaCompetencia,
        transportadora: "36",
        tipoDeOperacao: "ROTA",
        ano: 2026,
        mes: 7,
      },
      cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" }),
    );
    return resumo.canais.find((c) => c.canal === "ROTA")!;
  };

  const identidadeNoCadastro = async (escopo = "escopo-legado") => {
    const [linha] = await db
      .select({ unidadeId: remuneracaoUnidadeTable.unidadeId })
      .from(remuneracaoUnidadeTable)
      .where(eq(remuneracaoUnidadeTable.scopeHash, escopo));
    return linha?.unidadeId ?? null;
  };

  /* --- 1: o clique humano ------------------------------------------------ */

  /**
   * Associar uma competência que já respondia **não** pode derrubar o devido.
   *
   * É o caso que a tela produzia: quem clicava para ganhar identidade perdia o
   * `comparado` que já tinha, e o texto do erro mandava fazer algo que o
   * produto não sabia fazer.
   */
  it("associar a unidade canônica não faz o comparado desaparecer", async () => {
    const codigo = "CDD Belém";
    await abrirOMes(codigo);
    await cadastroLegado(codigo);

    /* O ponto de partida: responde pelo texto, e o painel comparado existe. */
    const antes = await resumoDaRota(codigo);
    expect(antes.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(antes.comparado).not.toBeNull();

    /* O ato humano, na composição exata da rota `PUT .../unidade`. */
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    const competencia = await associarUnidadeDaCompetencia(db, (await primeiraDoMes(db)), u.id);
    await conciliarIdentidadeDoCadastro(db, {
      unidadeId: u.id,
      codigos: [competencia.unidade.codigo],
    });

    const depois = await resumoDaRota(codigo);
    expect(depois.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(depois.cadastro.segunda?.estado).toBe("RESPONDEU");
    expect(depois.comparado).not.toBeNull();

    /*
      E agora responde pela identidade, não mais pelo texto — que é o ganho da
      associação, e o que faltava para ele existir dos dois lados.
    */
    expect(depois.cadastro.primeira?.unidade.comoCasou).toBe("IDENTIDADE");
    expect(await identidadeNoCadastro()).toBe(u.id);
  }, 60_000);

  /* --- 2: o cadastro feito noutra tela ----------------------------------- */

  /**
   * Cadastrar a unidade canônica também não pode derrubar nada.
   *
   * Aqui ninguém tocou no fechamento: a competência ganha identidade sozinha,
   * pela conciliação que a rota `POST /unidades/canonicas` dispara quando o
   * código dela é o CNPJ da unidade recém-cadastrada. Sem a conciliação do outro
   * lado, um mês fechado virava "sem cadastro" por causa de um clique em
   * Administração.
   */
  it("cadastrar a unidade canônica não derruba um cadastro que já respondia", async () => {
    await abrirOMes(CNPJ_MASCARADO);
    await cadastroLegado(CNPJ_MASCARADO);

    const antes = await resumoDaRota(CNPJ_MASCARADO);
    expect(antes.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(antes.comparado).not.toBeNull();

    /* A composição exata da rota `POST /unidades/canonicas`. */
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    await conciliarIdentidadeDasCompetencias(db);
    const conciliacao = await conciliarIdentidadeDoCadastro(db);

    expect(conciliacao.associadas).toHaveLength(1);
    expect(conciliacao.associadas[0]!.como).toBe("DOCUMENTO");

    const depois = await resumoDaRota(CNPJ_MASCARADO);
    expect(depois.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(depois.comparado).not.toBeNull();
    expect(await identidadeNoCadastro()).toBe(u.id);
  }, 60_000);

  /* --- 3: o passivo que já está travado ---------------------------------- */

  /**
   * O BACKFILL — sem exclusão, sem recadastro, sem redigitação.
   *
   * O estado de quem já passou pelo defeito: a competência com identidade, o
   * cadastro sem. É o que a partida do servidor conserta, e a prova de que
   * conserta **por dentro** é a planilha continuar exatamente onde estava —
   * `excluirUnidadeRegistrada` recusa apagar uma unidade com linhas digitadas, e
   * "recadastrar já associado" custaria redigitar a aba inteira.
   */
  it("o cadastro já travado é conciliado sem apagar nem redigitar nada", async () => {
    await abrirOMes(CNPJ_MASCARADO);
    await cadastroLegado(CNPJ_MASCARADO);

    /* O banco entra no estado travado: só o lado do Fechamento tem identidade. */
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    await conciliarIdentidadeDasCompetencias(db);
    expect(await identidadeNoCadastro()).toBeNull();

    const travado = await resumoDaRota(CNPJ_MASCARADO);
    expect(travado.cadastro.primeira?.estado).toBe("UNIDADE_SEM_CADASTRO");
    expect(travado.comparado).toBeNull();

    const linhasAntes = await db
      .select()
      .from(remuneracaoPlanilhaTable)
      .orderBy(remuneracaoPlanilhaTable.effectiveDate, remuneracaoPlanilhaTable.chave);

    /* A passada da partida, e nada além dela. */
    const relatorio = await conciliarIdentidadeDoCadastro(db);
    expect(relatorio.associadas).toHaveLength(1);
    expect(relatorio.ambiguas).toEqual([]);

    const destravado = await resumoDaRota(CNPJ_MASCARADO);
    expect(destravado.cadastro.primeira?.estado).toBe("RESPONDEU");
    expect(destravado.comparado).not.toBeNull();
    expect(await identidadeNoCadastro()).toBe(u.id);

    /* Nada foi redigitado: as 40 células continuam as mesmas, valor por valor. */
    const linhasDepois = await db
      .select()
      .from(remuneracaoPlanilhaTable)
      .orderBy(remuneracaoPlanilhaTable.effectiveDate, remuneracaoPlanilhaTable.chave);
    expect(linhasDepois).toHaveLength(ABA.length * 2);
    expect(linhasDepois.map((l) => [l.effectiveDate, l.chave, l.valor])).toEqual(
      linhasAntes.map((l) => [l.effectiveDate, l.chave, l.valor]),
    );
  }, 60_000);

  /* --- 4: a idempotência, que é o que permite rodar na partida ----------- */

  it("rodar de novo não escreve nada", async () => {
    await abrirOMes(CNPJ_MASCARADO);
    await cadastroLegado(CNPJ_MASCARADO);
    await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });

    const primeira = await conciliarIdentidadeDoCadastro(db);
    expect(primeira.associadas).toHaveLength(1);

    const segunda = await conciliarIdentidadeDoCadastro(db);
    expect(segunda.associadas).toEqual([]);
    expect(segunda.ambiguas).toEqual([]);
  }, 60_000);

  /* --- 5: o que ela nunca faz -------------------------------------------- */

  /**
   * Identidade escrita não é sobrescrita — nem por afirmação humana.
   *
   * Quem já decidiu de qual unidade é este cadastro decidiu com mais informação
   * do que uma grafia coincidente tem. Passar por cima seria esta conciliação
   * revogando uma decisão que não é dela.
   */
  it("nunca sobrescreve uma identidade já escrita", async () => {
    await abrirOMes("CDD Belém");
    const daVerdade = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    const outra = await cadastrarUnidade(db, { nome: "CDD OUTRO", cnpj: "22.333.444/0001-81" });

    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: "escopo-ja-associado",
      scopeType: "UNIDADE",
      codigo: "CDD Belém",
      nome: "CDD BELEM",
      canal: "ROTA",
      unidadeId: daVerdade.id,
      vigenciaInicial: "2026-07-01",
    });

    /* Uma afirmação que casaria pela grafia, apontando para a outra unidade. */
    const relatorio = await conciliarIdentidadeDoCadastro(db, {
      unidadeId: outra.id,
      codigos: ["CDD Belém"],
    });

    expect(relatorio.associadas).toEqual([]);
    expect(await identidadeNoCadastro("escopo-ja-associado")).toBe(daVerdade.id);
  }, 60_000);

  /**
   * A AMBIGUIDADE NÃO É RESOLVIDA POR ESCOLHA — falha fechada, e nomeada.
   *
   * A grafia afirmada diz que este cadastro é da unidade A; os dígitos do mesmo
   * código são o CNPJ da unidade B. Os dois sinais são determinísticos e
   * discordam. Escolher um deles em silêncio poria o contrato de uma unidade a
   * responder pelo fechamento de outra — que é exatamente o que a recusa de
   * `resolverUnidade` existe para impedir, e não faria sentido reintroduzir
   * aqui pela porta dos fundos.
   */
  it("diante de duas unidades possíveis não escolhe nenhuma, e expõe a pendência", async () => {
    await abrirOMes("CDD Belém");
    const doCnpj = await cadastrarUnidade(db, { nome: "CDD DO CNPJ", cnpj: CNPJ_MASCARADO });
    const daGrafia = await cadastrarUnidade(db, { nome: "CDD DA GRAFIA", cnpj: "22.333.444/0001-81" });

    /* O código do cadastro é o CNPJ de uma unidade… */
    await cadastroLegado(CNPJ_MASCARADO, "escopo-ambiguo");

    /* …e alguém afirma que aquela grafia é de outra. */
    const relatorio = await conciliarIdentidadeDoCadastro(db, {
      unidadeId: daGrafia.id,
      codigos: [CNPJ_MASCARADO],
    });

    expect(relatorio.associadas).toEqual([]);
    expect(relatorio.ambiguas).toHaveLength(1);
    expect(relatorio.ambiguas[0]!.motivo).toBe("SINAIS_DISCORDANTES");
    expect(relatorio.ambiguas[0]!.candidatas.map((c) => c.id).sort()).toEqual(
      [daGrafia.id, doCnpj.id].sort(),
    );

    /* E o banco não foi tocado: sem decisão, não há escrita. */
    expect(await identidadeNoCadastro("escopo-ambiguo")).toBeNull();
  }, 60_000);

  /**
   * O nome nunca resolve — a fronteira que esta cadeia inteira respeita.
   *
   * Um cadastro registrado pelo nome (sem CNPJ) e sem afirmação nenhuma não é
   * associado a coisa alguma, mesmo havendo uma unidade canônica com o mesmo
   * nome. Dois CDDs podem chamar-se igual.
   */
  it("não associa por semelhança de nome", async () => {
    await abrirOMes("CDD Belém");
    await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    await cadastroLegado("CDD BELEM", "escopo-pelo-nome");

    const relatorio = await conciliarIdentidadeDoCadastro(db);

    expect(relatorio.associadas).toEqual([]);
    expect(await identidadeNoCadastro("escopo-pelo-nome")).toBeNull();
  }, 60_000);
  /**
   * DOIS CADASTROS PARA A MESMA UNIDADE — a ambiguidade que só o conjunto revela.
   *
   * Cada um deles, sozinho, casa por documento sem sombra de dúvida. Escrever os
   * dois é que seria o estrago: `resolverUnidade` conta `scope_hash` distintos e
   * recusa com `UNIDADE_AMBIGUA`, de modo que a conciliação teria transformado
   * dois cadastros que respondiam pelo texto em dois que não respondem por nada.
   */
  it("não concilia quando dois cadastros reivindicam a mesma unidade", async () => {
    await abrirOMes(CNPJ_MASCARADO);
    await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });

    /* O mesmo CNPJ, com e sem máscara — dois escopos, uma unidade. */
    await cadastroLegado(CNPJ_MASCARADO, "escopo-um");
    await cadastroLegado("11222333000181", "escopo-dois");

    const relatorio = await conciliarIdentidadeDoCadastro(db);

    expect(relatorio.associadas).toEqual([]);
    expect(relatorio.ambiguas).toHaveLength(2);
    expect(new Set(relatorio.ambiguas.map((a) => a.motivo))).toEqual(
      new Set(["DOIS_CADASTROS_PARA_A_MESMA_UNIDADE"]),
    );
    expect(await identidadeNoCadastro("escopo-um")).toBeNull();
    expect(await identidadeNoCadastro("escopo-dois")).toBeNull();
  }, 60_000);

  /**
   * E o mesmo vale contra quem já está ligado.
   *
   * A contagem que importa é a que `escolher` fará depois, e ela não distingue o
   * que foi escrito hoje do que já estava lá.
   */
  it("não concilia um segundo cadastro para uma unidade que já tem o seu", async () => {
    await abrirOMes(CNPJ_MASCARADO);
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });

    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: "escopo-ja-ligado",
      scopeType: "UNIDADE",
      codigo: CNPJ_MASCARADO,
      nome: "CDD BELEM",
      canal: "ROTA",
      unidadeId: u.id,
      vigenciaInicial: "2026-07-01",
    });
    await cadastroLegado("11222333000181", "escopo-novo");

    const relatorio = await conciliarIdentidadeDoCadastro(db);

    expect(relatorio.associadas).toEqual([]);
    expect(relatorio.ambiguas[0]?.motivo).toBe("DOIS_CADASTROS_PARA_A_MESMA_UNIDADE");
    expect(await identidadeNoCadastro("escopo-novo")).toBeNull();
  }, 60_000);
});

/** O identificador da 1ª quinzena do mês — o alvo da associação. */
async function primeiraDoMes(db: Database): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM fechamento_competencia
     WHERE ano = 2026 AND mes = 7 AND quinzena = 1
     LIMIT 1
  `);
  return rows[0]!.id;
}
