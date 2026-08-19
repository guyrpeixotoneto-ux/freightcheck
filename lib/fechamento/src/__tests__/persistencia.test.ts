import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  abrirCompetencia,
  apurarCompetencia,
  encerrarCompetencia,
  lerApuracaoVigente,
  lerDiaDaCompetencia,
  lerDiarioDaCompetencia,
  listarApuracoes,
  listarDocumentos,
  listarPartes,
  reabrirCompetencia,
  receberDocumento,
  RecusaDeFechamento,
} from "../persistencia";
import {
  fixtureConciliacao,
  fixtureCtes,
  fixtureDisponibilidade,
  fixtureOperacao,
  fixtureRequisicoes,
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

  it("abrir a mesma competência duas vezes devolve a mesma", async () => {
    const a = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const b = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    expect(b.id).toBe(a.id);
    expect(a.chave).toBe("2026-07-Q2");
  });

  it("recebe as cinco fontes e reproduz, do banco, a conta que a aritmética dá", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
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

    expect(apuracao.fontesAusentes).toEqual([]);
    /* Os mesmos números do teste sem banco — é essa igualdade que importa. */
    expect(apuracao.totais.emitido).toBe(4450);
    expect(apuracao.totais.naoConferido).toBe(2000);
    expect(apuracao.verbas.find((v) => v.vbz === 7)?.esperado).toBe(750);
    expect(apuracao.verbas.find((v) => v.vbz === 1)?.esperado).toBeNull();
    expect(apuracao.divergencias.some((d) => d.tipo === "DESCONTO_FRETE_MINIMO" && d.valor === 200)).toBe(true);
  }, 60_000);

  it("guarda a memória de cálculo de cada parcela, com o fator medido", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const apuracao = (await lerApuracaoVigente(db, comp.id))!;
    const freteiro = apuracao.verbas.find((v) => v.vbz === 7)!;
    expect(freteiro.memoria).toHaveLength(2);
    const daRequisicao = freteiro.memoria.find((m) => m.origem === "REQUISICOES")!;
    expect(daRequisicao.semImposto).toBe(200);
    expect(daRequisicao.comImposto).toBe(250);
    expect(daRequisicao.fator).toBeCloseTo(1.25, 6);
  });

  it("recusa o mesmo arquivo duas vezes — recebê-lo de novo dobraria a conta", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "CTE",
        nomeDoArquivo: "03.08.15 (cópia).xlsx",
        conteudo: fixtureCtes(),
      }),
    ).rejects.toBeInstanceOf(RecusaDeFechamento);
  });

  it("reenviar uma exportação corrigida substitui a anterior e mantém as duas no histórico", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 8, quinzena: 1, unidade, transportadora });
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
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
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
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
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
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    expect(await lerDiaDaCompetencia(db, comp.id, "2026-07-01")).toBeNull();
  });

  it("salvar a quinzena exige ter apurado — congelar o que não se sabe quanto vale é pior", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 10, quinzena: 1, unidade, transportadora });
    await expect(encerrarCompetencia(db, comp.id)).rejects.toMatchObject({
      codigo: "COMPETENCIA_NAO_APURADA",
    });
  });

  it("salva a quinzena, e salvar de novo é um clique repetido e não um erro", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const fechada = await encerrarCompetencia(db, comp.id);
    expect(fechada.estado).toBe("ENCERRADA");
    expect(fechada.encerradaEm).not.toBeNull();
    expect((await encerrarCompetencia(db, comp.id)).estado).toBe("ENCERRADA");
  });

  it("a quinzena salva não aceita mais nem documento nem reapuração", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
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
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
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
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    await expect(reabrirCompetencia(db, comp.id, { motivo: "qualquer" })).rejects.toMatchObject({
      codigo: "COMPETENCIA_NAO_ESTA_ENCERRADA",
    });
  });

  it("as partes são derivadas das competências, com o nome mais recente de cada código", async () => {
    const partes = await listarPartes(db);
    const cdd = partes.unidades.find((u) => u.codigo === "443");
    expect(cdd?.nome).toBe("CDD FICTICIO");
    expect(cdd?.competencias).toBeGreaterThan(1);
    expect(partes.transportadoras.map((t) => t.codigo)).toContain("36");
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

    const q2 = resumos.find((r) => r.competencia.chave === "2026-07-Q2")!;
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

  it("uma competência encerrada não aceita documento", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 9, quinzena: 1, unidade, transportadora });
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
