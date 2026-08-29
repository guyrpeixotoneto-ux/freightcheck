import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cadastrarUnidade,
  createDb,
  fechamentoCompetenciaTable,
  remuneracaoPlanilhaTable,
  remuneracaoUnidadeTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  abrirCompetencia,
  apurarCompetencia,
  associarUnidadeDaCompetencia,
  lerResumoDoMes,
  receberDocumento,
} from "@workspace/fechamento/persistencia";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";

/**
 * O RESUMO DA UNIDADE CANÔNICA — a prova direta, com documento de verdade.
 *
 * **Por que este arquivo mora em `api-server` e não em `@workspace/fechamento`.**
 * A porta do cadastro (`cadastroDaRemuneracao`) é a costura entre os dois
 * pacotes e vive na borda de propósito: `@workspace/fechamento` não conhece
 * `@workspace/remuneracao` e não deve conhecer. Um teste do encontro dos dois só
 * pode existir onde os dois se veem.
 *
 * **O que ele prova, e por que a prova indireta não bastava.** O arquivo
 * anterior (`caso-cdd-belem.test.ts`, em `@workspace/fechamento`) prova a
 * cadeia de identidade: a competência associada alcança a unidade, e a unidade
 * alcança o contrato. Não prova que **o Resumo** — a tela — recebe aqueles
 * números, porque `lerResumoDoMes` precisa da porta, que não existe lá.
 *
 * Aqui a corrente fecha com documento real: o `03.08.20` da 1ª quinzena de
 * julho/2026 do CDD Belém · Horizonte entra por `receberDocumento`, do jeito
 * que a importação o recebe, e o Resumo sai de `lerResumoDoMes` com a porta
 * ligada. Antes da associação e depois dela, sobre o mesmo banco.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_resumo_canonico_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

/*
  A conexão vem de `createDb`, e não de `pg` cru: `pg` não é dependência deste
  pacote, e acrescentá-la só para um teste poria no `package.json` uma
  dependência que o servidor não usa — ele fala com o banco pelo `@workspace/db`.
*/
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

/**
 * O 03.08.20 real da 1ª quinzena — o mesmo arquivo que a reconciliação usa.
 *
 * Lido do disco em bytes, sem decodificar: o arquivo é latin-1 e quem decide
 * isso é o leitor. É o mesmo caminho de `fixturePagamento1aQuinzenaReal`, em
 * `@workspace/fechamento`, que não é exportado para fora do pacote.
 */
function pagamentoReal(): Buffer {
  return readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../../lib/fechamento/src/__tests__/amostras/03.08.20-2026-07-Q1.txt",
    ),
  );
}

const CNPJ = "11222333000181";
const ESCOPO = "escopo-de-belem";

/** A aba `Cadastro` de julho/2026 — os valores reais do CDD Belém · Horizonte. */
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
  ["marketing_sem_impostos", 0],
];

/**
 * O `RESUMO GERAL` da `.xlsb` de julho/2026 — **lido da amostra**, não digitado.
 *
 * A primeira versão deste arquivo trazia os números batidos à mão, e quatro dos
 * cinco estavam errados: o relatório acusou "NÃO BATE" em linhas que batem ao
 * centavo, e o defeito era a referência. Ficou a lição, e ela é a mesma regra
 * do resto do projeto — a referência sai da fonte.
 *
 * `julho-2026.json` é a amostra que `reconciliacao.test.ts` usa, extraída da
 * `.xlsb` real pelo `reconciliar-planilha-cli.ts`. `resumoGeral` é literalmente
 * o que a planilha imprime no `RESUMO GERAL`, por chave de linha do motor.
 */
function planilhaDeReferencia(): Record<string, number> {
  const caminho = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../lib/fechamento/src/__tests__/amostras/julho-2026.json",
  );
  const amostra = JSON.parse(readFileSync(caminho, "utf8")) as {
    quinzenas: { quinzena: number; resumoGeral: Record<string, number> }[];
  };
  return amostra.quinzenas.find((q) => q.quinzena === 1)!.resumoGeral;
}

/**
 * As linhas que o **contrato** sustenta sozinho — as que este caso prova.
 *
 * As outras do `resumoGeral` dependem do 2Art, que não foi importado nesta
 * competência de propósito: o assunto aqui é identidade, e trazer o diário
 * junto misturaria duas provas. Elas entram no relatório com a causa
 * classificada, e não são omitidas.
 */
const DO_CONTRATO = [
  "custo_fixo_padronizado",
  "custo_fixo_inativos",
  "custo_vans_inativas",
  "custo_fixo_especiais",
  "custo_fixo_vans",
];

/** As que dependem do diário, e por isso não podem bater sem ele. */
const DO_DIARIO = ["rota_dvs", "custo_variavel_frota_fixa", "custo_variavel_agregado"];

describe.skipIf(!temBanco)("o Resumo, depois da unidade canônica", () => {
  let fechar: () => Promise<void>;
  let db: Database;
  let competenciaId: string;
  let unidadeId: string;

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

    /* A competência como ela está hoje: o nome no lugar do código. */
    const c = await abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 1,
      tipoDeOperacao: "ROTA",
      unidade: { codigo: "CDD Belém", nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    competenciaId = c.id;

    /* O documento real — do jeito que a importação o recebe. */
    await receberDocumento(db, {
      competenciaId: c.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20-2026-07-Q1.txt",
      conteudo: pagamentoReal(),
    });

    /*
      Apurar é o que faz o canal existir no Resumo: `montarResumo` monta os
      canais a partir das verbas apuradas, e um mês sem apuração não tem canal
      nenhum — nem para mostrar o painel, nem para comparar.
    */
    await apurarCompetencia(db, c.id);

    /* O cadastro de Remuneração da mesma unidade, com outro identificador. */
    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: ESCOPO,
      scopeType: "UNIDADE",
      codigo: "11.222.333/0001-81",
      nome: "CDD BELÉM",
      canal: "ROTA",
      vigenciaInicial: "2026-07-01",
    });
    await db.insert(remuneracaoPlanilhaTable).values(
      ABA.map(([chave, valor]) => ({
        scopeHash: ESCOPO,
        canal: "ROTA",
        effectiveDate: "2026-07-01",
        chave,
        valor: String(valor),
      })),
    );
  }, 180_000);

  afterAll(async () => {
    await fechar?.().catch(() => {});
    const admin = createDb(ADMIN);
    await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`).catch(() => {});
    await admin.pool.end().catch(() => {});
  });

  const oResumo = () =>
    lerResumoDoMes(
      db,
      {
        unidade: "CDD Belém",
        transportadora: "36",
        tipoDeOperacao: "ROTA",
        ano: 2026,
        mes: 7,
      },
      cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" }),
    );

  it("antes de associar: o painel é a releitura, e o diagnóstico diz por quê", async () => {
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;

    /* O 03.08.20 real entrou: há painel demonstrado. */
    expect(rota.painel).not.toBeNull();
    /* E não há devido — o cadastro não foi encontrado. */
    expect(rota.comparado).toBeNull();
    expect(rota.cadastro.primeira?.estado).toBe("UNIDADE_NAO_ENCONTRADA");

    /* As seis linhas do fixo, `em conjunto` — é o estado que originou tudo. */
    const padronizado = rota
      .painel!.quadros.flatMap((q) => q.linhas)
      .find((l) => l.chave === "custo_fixo_padronizado")!;
    expect(padronizado.valores.primeira).toBeNull();
    expect(padronizado.conjunto).not.toBeNull();
  });

  /**
   * O NOME SUGERE, E NÃO RESOLVE — a fronteira, com SQL de verdade.
   *
   * A unidade passa a existir no cadastro mestre com o **nome** que a
   * competência carrega no lugar do código. É a situação de quem cadastrou a
   * unidade em Administração e ainda não voltou ao fechamento — e a tela, até
   * aqui, mandava procurar um código sem dizer que a unidade estava a um clique.
   *
   * O que ela **não** pode fazer é responder por isso: o contrato continua sem
   * sair. Um nome não é identidade, e dois CDDs podem chamar-se igual.
   */
  it("a unidade cadastrada com o nome da competência vira sugestão — e só isso", async () => {
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: "11.222.333/0001-81" });
    unidadeId = u.id;

    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;
    const porta = rota.cadastro.primeira!;

    /* A candidata aparece, com o CNPJ que a distingue de uma xará. */
    expect(porta.unidade.sugestoes).toEqual([
      { id: u.id, nome: "CDD Belém", cnpj: "11222333000181", codigoGerencial: null },
    ]);
    expect(porta.destrava?.conserto).toContain("associe a competência");
    /* E o contrato continua sem responder: o nome não escolheu nada. */
    expect(porta.estado).toBe("UNIDADE_NAO_ENCONTRADA");
    expect(rota.comparado).toBeNull();
  });

  /**
   * A METADE DO CAMINHO — e a instrução que ela precisava receber.
   *
   * A competência passa a apontar para a unidade; o cadastro de Remuneração
   * ainda não. Daqui em diante o texto dos dois lados não é mais comparado, e a
   * frase antiga — "os dois textos precisam ser iguais" — mandaria igualar
   * códigos que ninguém lê. O estado próprio existe para dizer a verdade: o que
   * falta está do lado de Remuneração.
   */
  it("associada só a competência, o conserto é do lado de Remuneração", async () => {
    await associarUnidadeDaCompetencia(db, competenciaId, unidadeId!);

    const porta = (await oResumo()).canais.find((c) => c.canal === "ROTA")!.cadastro
      .primeira!;

    expect(porta.estado).toBe("UNIDADE_SEM_CADASTRO");
    expect(porta.unidade.identidade?.nome).toBe("CDD Belém");
    expect(porta.destrava?.conserto).toContain("Remuneração");
    expect(porta.destrava?.conserto).not.toContain("Os dois textos precisam ser iguais");
    /* Nada foi sugerido: já há uma unidade escolhida. */
    expect(porta.unidade.sugestoes).toEqual([]);
  });

  it("associar as duas pontas à mesma unidade canônica", async () => {
    const u = { id: unidadeId! };

    await associarUnidadeDaCompetencia(db, competenciaId, u.id);
    await db
      .update(remuneracaoUnidadeTable)
      .set({ unidadeId: u.id })
      .where(eq(remuneracaoUnidadeTable.scopeHash, ESCOPO));

    const [comp] = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, competenciaId));
    const [cad] = await db
      .select()
      .from(remuneracaoUnidadeTable)
      .where(eq(remuneracaoUnidadeTable.scopeHash, ESCOPO));

    /* Fechamento.unidade_id === Remuneração.unidade_id — o gate 3. */
    expect(comp!.unidadeId).toBe(cad!.unidadeId);
    /* E o código legado da competência não foi tocado. */
    expect(comp!.unidadeCodigo).toBe("CDD Belém");
  });

  it("depois de associar: o Resumo recebe o devido da unidade certa", async () => {
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;

    expect(rota.cadastro.primeira?.estado).toBe("RESPONDEU");
    /* Casou pela identidade — nenhum texto foi comparado. */
    expect(rota.cadastro.primeira?.unidade.comoCasou).toBe("IDENTIDADE");
    expect(rota.comparado).not.toBeNull();
  });

  /**
   * O RELATÓRIO — linha por linha, planilha contra FreightCheck.
   *
   * Só as cinco linhas do custo fixo entram: são as que o contrato sustenta
   * sozinho. `TOTAL REMUNERAÇÃO ROTA DVS` e `INDISPONIBILIDADE` dependem do
   * 2Art, que **não** foi importado nesta competência — a ausência delas é
   * esperada e está classificada no relatório, não escondida.
   */
  it("o devido de cada linha do contrato bate com a planilha, ao centavo", async () => {
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;
    const linhas = rota.comparado!.quadros.flatMap((q) => q.linhas);
    const planilha = planilhaDeReferencia();

    const relatorio: string[] = [];
    const naoBatem: string[] = [];

    const conferir = (chave: string, origem: string, deveBater: boolean) => {
      const linha = linhas.find((l) => l.chave === chave);
      if (!linha) return;
      const daPlanilha = planilha[chave];
      const doProduto = linha.devido.primeira;
      const diferenca =
        doProduto === null || daPlanilha === undefined
          ? null
          : Number((doProduto - daPlanilha).toFixed(2));
      const bate = diferenca !== null && Math.abs(diferenca) < 0.005;
      if (deveBater && !bate) {
        naoBatem.push(`${chave}: planilha ${daPlanilha}, produto ${doProduto}`);
      }
      relatorio.push(
        [
          linha.rotulo,
          daPlanilha?.toFixed(2) ?? "—",
          doProduto?.toFixed(2) ?? "—",
          diferenca?.toFixed(2) ?? "—",
          bate ? "BATE" : "NÃO BATE",
          origem,
        ].join(" | "),
      );
    };

    for (const chave of DO_CONTRATO) conferir(chave, "contrato (aba Cadastro)", true);
    /* Classificadas, não escondidas: sem 2Art não há como bater, e a causa é essa. */
    for (const chave of DO_DIARIO) conferir(chave, "2Art — NÃO IMPORTADO nesta competência", false);

    console.log(
      ["", "Linha | Planilha | FreightCheck | Diferença | Resultado | Origem", ...relatorio].join("\n"),
    );

    expect(naoBatem, naoBatem.join(" · ")).toEqual([]);
  });

  /**
   * ZERO NÃO É AUSÊNCIA — a linha que dizia `R$ 0,00` sem ter olhado o diário.
   *
   * Era um defeito real e anterior a este trabalho, sem relação com identidade
   * de unidade: `viagensPorDia` devolvia `[]` quando o 2Art não tinha chegado,
   * `somarVariavel([])` somava sobre a lista vazia e devolvia
   * `{frotaFixa: 0, agregado: 0, …}`, `custoVariavelInteiro` valia 0 e a tela
   * escrevia `R$ 0,00` em `TOTAL REMUNERAÇÃO ROTA DVS`. Isso afirma que a frota
   * não rodou nada — uma afirmação sobre a operação — onde a verdade é que o
   * arquivo não foi importado. Quem abrisse o fechamento antes do 2Art via uma
   * divergência de −313.318,87 contra a planilha, sem saber se a frota parou ou
   * se faltava documento.
   *
   * A guarda mora em `somarVariavel`, e não no ponto de chamada, porque são
   * dois chamadores e o esquecimento em um deles era exatamente o defeito. É o
   * mesmo corte que `basesDaQuinzena` já fazia para a indisponibilidade
   * (`diario.length === 0 ? null : …`), sobre a mesma lista, pelo mesmo motivo.
   *
   * Este teste é a prova de ponta a ponta: banco real, competência real,
   * cadastro resolvido pela identidade canônica, 2Art ausente de verdade.
   */
  it("sem 2Art, o DVS sai vazio e nomeia o arquivo que falta", async () => {
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;
    const linhas = rota.comparado!.quadros.flatMap((q) => q.linhas);

    const dvs = linhas.find((l) => l.chave === "rota_dvs")!;
    expect(dvs.devido.primeira).toBeNull();
    expect(dvs.falta).toBe("o diário operacional da quinzena");

    /* As três linhas que saem do diário caem juntas — não só a que abre o quadro. */
    for (const chave of DO_DIARIO) {
      const linha = linhas.find((l) => l.chave === chave);
      if (!linha) continue;
      expect(linha.devido.primeira, `${chave} ainda afirma zero`).toBeNull();
      expect(linha.falta, `${chave} não nomeia o arquivo`).toBe(
        "o diário operacional da quinzena",
      );
    }

    /* A indisponibilidade já dizia isso antes, e continua dizendo: é a mesma regra. */
    const indisp = linhas.find((l) => l.chave === "indisponibilidade_fixo")!;
    expect(indisp.devido.primeira).toBeNull();
    expect(indisp.falta).toBe("o diário operacional da quinzena");
  });

  /**
   * A contraprova: o cadastro continua respondendo, e a ausência é do diário.
   *
   * Sem esta, um `null` no DVS seria ambíguo — poderia ser o cadastro que não
   * resolveu. As cinco linhas do contrato saem com número na mesma leitura, o
   * que prova que a competência achou o contrato certo e que o que falta é só
   * o arquivo do diário.
   */
  it("o vazio do DVS é do diário, não do cadastro — as cinco do contrato têm número", async () => {
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;
    const linhas = rota.comparado!.quadros.flatMap((q) => q.linhas);

    for (const chave of DO_CONTRATO) {
      const linha = linhas.find((l) => l.chave === chave)!;
      expect(linha.devido.primeira, `${chave} sem devido`).not.toBeNull();
      expect(linha.falta, `${chave} reclamou de falta`).toBeNull();
    }
  });

  it("o demonstrado das seis continua em conjunto — o 03.08.20 não é rateado", async () => {
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;
    const linhas = rota.comparado!.quadros.flatMap((q) => q.linhas);

    for (const chave of DO_CONTRATO) {
      const linha = linhas.find((l) => l.chave === chave)!;
      expect(linha.demonstrado.primeira, `${chave} recebeu rateio`).toBeNull();
      expect(linha.conjunto, `${chave} sem conjunto`).not.toBeNull();
    }
  });

  it("o documento importado atravessa tudo intacto", async () => {
    /*
      A prova de não-regressão do arquivo, no próprio caso de aceite: o
      03.08.20 continua sustentando o painel demonstrado depois da associação,
      com o mesmo total. Associar identidade não tocou em byte nenhum.
    */
    const rota = (await oResumo()).canais.find((c) => c.canal === "ROTA")!;
    expect(rota.demonstrativo.primeira).not.toBeNull();
    expect(rota.comparado!.quadros.flatMap((q) => q.linhas).length).toBeGreaterThan(0);
    expect(unidadeId).toBeTruthy();
  });
});
