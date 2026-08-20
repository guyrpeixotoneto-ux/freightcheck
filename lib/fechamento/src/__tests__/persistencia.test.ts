import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  abrirCompetencia,
  apurarCompetencia,
  buscarCompetencia,
  lerResumoDoMes,
  descartarDadosDaCompetencia,
  encerrarCompetencia,
  excluirCompetencia,
  lerApuracaoVigente,
  lerDiaDaCompetencia,
  lerDiarioDaCompetencia,
  listarApuracoes,
  listarCompetencias,
  listarDocumentos,
  listarPartes,
  reabrirCompetencia,
  lerDeParaDaCompetencia,
  receberDocumento,
  registrarParte,
  RecusaDeFechamento,
} from "../persistencia";
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
      ano: 2026, mes: 7, quinzena: 2, unidade: noFormatoDeSempre, transportadora,
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

  it("recusa o arquivo que leu e do qual não tirou nada", async () => {
    /* O caso real, relatado da tela: "eu importei o arquivo sim, mas diz que não
       importei". Os leitores do fechamento são máquinas de estado sobre texto e
       não lançam quando a estrutura não é a esperada — devolvem listas vazias.
       A importação gravava o documento, inseria zero fatos e respondia sucesso,
       e aí a lista de relatórios contava o arquivo como recebido enquanto o
       painel dizia "não foi importado". As duas telas estavam certas.

       Pior do que o silêncio: um segundo envio sem fatos **apaga** as linhas do
       primeiro pela despromoção do documento anterior. A recusa vem antes da
       transação justamente por isso. */
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const recusa = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (formato desconhecido).txt",
      conteudo: Buffer.from("relatorio qualquer\nsem nenhuma linha que o leitor reconheca\n", "utf8"),
    }).catch((e: unknown) => e);

    expect(recusa).toBeInstanceOf(RecusaDeFechamento);
    expect((recusa as RecusaDeFechamento).codigo).toBe("DOCUMENTO_SEM_FATOS");
    /* A mensagem nomeia a rotina, para quem enviou saber contra o que conferir. */
    expect((recusa as RecusaDeFechamento).message).toContain("03.08.20");
  });

  it("um envio sem fatos não apaga o que o envio anterior gravou", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: fixturePagamentoDoPainel(),
    });
    const antes = await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" });
    expect(antes).not.toBeNull();

    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20 (truncado).txt",
      conteudo: Buffer.from("cabecalho e mais nada\n", "utf8"),
    }).catch(() => undefined);

    /* O painel continua de pé: a recusa aconteceu antes de despromover nada. */
    const depois = await lerDeParaDaCompetencia(db, comp.id, { canal: "ROTA" });
    expect(depois).not.toBeNull();
    expect(depois?.totalDoRelatorio).toBe(antes?.totalDoRelatorio);
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
    const agosto = await abrirCompetencia(db, { ano: 2026, mes: 8, quinzena: 1, unidade, transportadora });
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
        ano: 2026,
        mes: 7,
      });

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
      });
      await excluirCompetencia(db, antes.id);
      const depois = await abrirCompetencia(db, {
        ano: 2026,
        mes: 10,
        quinzena: 1,
        unidade: unidadeDaExclusao,
        transportadora,
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
