/**
 * O ESTÁGIO DO EXTRATO — onde o razão contábil entra no pipeline oficial.
 *
 * ---------------------------------------------------------------------------
 * Por que aqui, e não um caminho paralelo
 * ---------------------------------------------------------------------------
 * A tentação era escrever um importador do começo ao fim: ler o arquivo, criar
 * a vigência, gravar os fatos. Ele funcionaria no primeiro mês e divergiria do
 * resto do produto no segundo — porque tudo o que o pipeline faz **depois** de
 * `staged_fact` é regra viva: a identidade canônica da vigência, a revisão, a
 * herança de fato entre revisões, o escopo obrigatório, a presença, a cobertura,
 * a exclusão de importação, a imutabilidade por gatilho. Um segundo caminho
 * precisaria reimplementar cada uma e concordar com ela para sempre.
 *
 * Então este módulo faz uma coisa só: transforma o razão do ERP em
 * `staged_fact`, que é a fronteira onde o pipeline deixa de falar a língua do
 * arquivo e passa a falar a sua. Daí para a frente é `promote`, sem uma linha
 * de exceção para o acervo Real.
 *
 * O que entra em staging é o **consolidado** — um valor por (competência,
 * placa) —, e é o índice único de `staged_fact` (run, rótulo, tipo, chave,
 * atributo) que passa a garantir esse grão no banco, e não só no código.
 *
 * ---------------------------------------------------------------------------
 * Os quatro fatos por consolidado, e por que o escopo é um deles
 * ---------------------------------------------------------------------------
 * `promote` lê o escopo **dos fatos** (`SCOPE_COLUMNS`, em `pipeline.ts`), e
 * exige UNIDADE para fechar a identidade da vigência. O extrato não traz CNPJ:
 * traz `UNIDADE` por extenso e `CODUNN`. Quem diz o CNPJ é quem envia, pela
 * unidade declarada no envio — e a conferência contra o que o arquivo escreve é
 * o que impede o extrato de Camaçari de entrar como se fosse de Recife.
 *
 * O fato de escopo aponta para a célula `UNIDADE` da linha âncora, e não para a
 * do valor: é a célula que fala de unidade, mesmo escrevendo o nome em vez do
 * documento. A evidência é o que o arquivo diz; o código canônico é o que a
 * declaração afirma. As duas ficam gravadas, e é por isso que dá para discordar
 * depois.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  entityIdentifierTable,
  entityTable,
  finameRealLancamentoTable,
  financiamentoRealDecisaoTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  stagedFactTable,
} from "@workspace/db/schema";
import { createHash } from "node:crypto";
import { foldText } from "../workbook";
import { rotuloMensal } from "../vigencia";
import {
  lerExtrato,
  reconhecerLayoutDoExtrato,
  type LinhaBrutaDoExtrato,
} from "./extrato";
import {
  apurar,
  reconciliar,
  RUBRICA_FINAME_REAL,
  type Apuracao,
  type DecisaoTomada,
  type LancamentoClassificado,
} from "./agregacao";

/** O atributo que o consolidado alimenta, por tipo de ativo. */
export function codigoDoAtributoReal(entityType: string): string {
  return `${entityType.toLowerCase()}.finame_real`;
}

export interface EstagioDoExtrato {
  apuracao: Apuracao;
  /** Quantos `staged_fact` foram escritos — o consolidado, mais o escopo. */
  fatosEstagiados: number;
  /** As competências que viraram rótulo de vigência mensal. */
  rotulos: string[];
  reconciliacao: ReturnType<typeof reconciliar>;
}

/**
 * A recusa do estágio, com o código que a tela mostra.
 *
 * Erro com nome, e não `Error` solto, pela mesma razão das recusas do pipeline:
 * quem opera precisa saber **qual** conferência falhou para saber o que
 * corrigir, e um texto livre obriga a tela a adivinhar por substring.
 */
export class ExtratoRecusado extends Error {
  constructor(
    readonly codigo:
      | "COMPETENCIA_DIVERGE_DA_DECLARACAO"
      | "UNIDADE_AMBIGUA_NO_ARQUIVO"
      | "UNIDADE_NAO_DECLARADA"
      | "RECONCILIACAO_NAO_FECHA",
    message: string,
    readonly detalhe: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ExtratoRecusado";
  }
}

export interface OpcoesDoEstagio {
  /** O canal da vigência. O acervo remunerado é EMPURRADA, e o real o segue. */
  canal?: string;
  /**
   * O CNPJ da unidade — normalmente **não** se passa aqui.
   *
   * A fonte é `import_run.declared_unidade`, escrita no envio: é lá que a
   * declaração vive, é de lá que o reprocessamento a herda, e é ela que a
   * exclusão de importação leva junto. Este campo existe para quem quer estagiar
   * um run sem passar pelo envio — um teste, uma reconstrução —, e sobrepõe a do
   * run quando vem preenchido.
   */
  unidadeCnpj?: string;
  /** O nome da unidade, para o escopo nascer legível. */
  unidadeNome?: string | null;
  /** A competência corrente, para a marca de mês em curso. */
  competenciaCorrente?: string | null;
}

/**
 * Lê o extrato já capturado em RAW e o estagia como consolidado.
 *
 * Trabalha a partir de `raw_row`/`raw_cell`, e não do arquivo: a captura já
 * aconteceu, é ela que dá o rastreio célula a célula, e reler o `.xlsx` aqui
 * abriria a porta para o banco e o arquivo discordarem sobre o que foi lido.
 */
export async function estagiarExtratoReal(
  db: Database,
  importRunId: string,
  opcoes: OpcoesDoEstagio,
): Promise<EstagioDoExtrato> {
  const canal = (opcoes.canal ?? "EMPURRADA").toUpperCase();

  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  if (!run) throw new Error(`Importação ${importRunId} não encontrada.`);

  /*
    A unidade sai do run, e não do chamador. Uma declaração que vivesse só no
    argumento se perderia no reprocessamento — e foi exatamente o que aconteceu
    na primeira releitura do extrato real: o run relido falhou por "não tem
    unidade declarada" sobre um arquivo cuja unidade estava declarada desde o
    primeiro envio.
  */
  const unidadeCnpj = opcoes.unidadeCnpj ?? run.declaredUnidade ?? null;
  if (unidadeCnpj === null) {
    throw new ExtratoRecusado(
      "UNIDADE_NAO_DECLARADA",
      "Esta importação do acervo Real não tem unidade declarada, e o extrato do financiamento " +
        "não traz CNPJ para deduzi-la. Envie o arquivo de novo escolhendo a unidade.",
    );
  }

  const { linhas, celulas } = await lerLinhasDoRaw(db, importRunId);
  const leitura = lerExtrato(linhas);

  /*
    A unidade declarada, conferida contra o que o arquivo escreve.

    Não dá para traduzir "TRANSFERÊNCIA URBANA - EMPURRADA" em CNPJ — e é por
    isso que quem envia declara. O que **dá** para conferir é se o arquivo fala
    de uma unidade só: um extrato com duas unidades dentro, enviado sob uma
    declaração única, carimbaria metade dos lançamentos com o CNPJ errado, e o
    erro só apareceria como um custo aparecendo na unidade que não o teve.
  */
  const unidadesNoArquivo = new Set(
    leitura.linhas
      .map((l) => `${l.codunn ?? ""}|${l.unidadeRaw ?? ""}`)
      .filter((u) => u !== "|"),
  );
  if (unidadesNoArquivo.size > 1) {
    throw new ExtratoRecusado(
      "UNIDADE_AMBIGUA_NO_ARQUIVO",
      `O extrato fala de ${unidadesNoArquivo.size} unidades diferentes, e o envio declarou uma só. ` +
        `Carimbar todas com o mesmo CNPJ colocaria custo na unidade que não o teve. ` +
        `Envie um arquivo por unidade. Encontradas: ${[...unidadesNoArquivo].join("; ")}.`,
      { unidades: [...unidadesNoArquivo] },
    );
  }

  /*
    A competência declarada, conferida contra `MES`/`ANO` das linhas.

    É a conferência que a `0101` fez para a quinzena, no acervo Real: sem ela,
    mandar o extrato de agosto achando que se manda o de setembro entra calado,
    e quem enviou descobre semanas depois, na comparação, que um mês tem duas
    leituras e outro nunca chegou. Ausente a declaração, o arquivo entra pelas
    competências que trouxer — é o caso da carga histórica.
  */
  const competenciasNoArquivo = [
    ...new Set(leitura.linhas.map((l) => l.competencia)),
  ].sort();
  const declarada = run.declaredCompetence;
  if (declarada !== null && declarada !== undefined) {
    const forasteiras = competenciasNoArquivo.filter((c) => c !== declarada);
    if (forasteiras.length > 0) {
      throw new ExtratoRecusado(
        "COMPETENCIA_DIVERGE_DA_DECLARACAO",
        `O envio declarou a competência ${declarada}, e o arquivo traz ` +
          `${competenciasNoArquivo.length === 1 ? "outra" : `${competenciasNoArquivo.length} competências`}: ` +
          `${competenciasNoArquivo.join(", ")}. Nada foi importado — confira se o mês escolhido no ` +
          `envio é mesmo o do arquivo.`,
        { declarada, encontradas: competenciasNoArquivo },
      );
    }
  }

  const resolverTipo = await montarResolvedorDeTipo(
    db,
    [...new Set(leitura.linhas.map((l) => l.placa))],
  );
  /*
    As decisões chegam endereçadas pelo **hash** da impressão digital — é o que
    a tela tem na mão, e guardar a impressão inteira (as 43 células de uma
    linha) numa coluna de chave seria guardar o arquivo dentro da decisão.

    A tradução acontece aqui, e não dentro de `apurar`, porque a regra de
    agregação é pura e não conhece hash nenhum: ela compara impressões digitais.
    Quem sabe fazer a ponte entre as duas formas é quem leu as linhas.
  */
  const porHash = new Map(
    leitura.linhas.map((l) => [hash(l.impressaoDigital), l.impressaoDigital]),
  );
  const decisoes = (await lerDecisoes(db)).map((d) => ({
    ...d,
    chave: porHash.get(d.chave) ?? d.chave,
  }));

  const apuracao = apurar(leitura.linhas, {
    resolverTipo,
    decisoes,
    linhasRejeitadasNaLeitura: leitura.recusadas.length,
    competenciaCorrente: opcoes.competenciaCorrente ?? null,
  });

  /*
    A reconciliação roda **antes** de qualquer escrita, e é bloqueante.

    Uma agregação que não fecha com o razão não é um relatório ruim: é dinheiro
    que sumiu entre a planilha e o banco. Escrever primeiro e conferir depois
    deixaria a vigência de pé com o erro dentro.
  */
  const reconciliacao = reconciliar(apuracao);
  if (!reconciliacao.fecha) {
    throw new ExtratoRecusado(
      "RECONCILIACAO_NAO_FECHA",
      `A apuração do financiamento real não fecha com o extrato de origem: ` +
        `razão R$ ${reconciliacao.totalDoExtrato}, apurado R$ ${reconciliacao.totalConsolidado} ` +
        `+ retido R$ ${reconciliacao.totalEmDuplicatas} + rejeitado R$ ${reconciliacao.totalRejeitado} ` +
        `+ pendente R$ ${reconciliacao.totalPendente} (diferença de R$ ${reconciliacao.diferenca}). ` +
        `Nenhum fato foi gravado.`,
      { ...reconciliacao },
    );
  }

  const rotuloDe = (competencia: string): string => {
    const [ano, mes] = competencia.split("-");
    return rotuloMensal(canal, Number(mes), Number(ano));
  };

  await db.transaction(async (tx) => {
    /*
      Reestagiar é refazer, e não acrescentar.

      A apuração é função pura das linhas, então uma segunda passada sobre o
      mesmo run produz exatamente o mesmo resultado — apagar antes de escrever é
      o que torna isso verdade no banco também, em vez de duplicar o consolidado
      a cada tentativa.
    */
    await tx
      .delete(finameRealLancamentoTable)
      .where(eq(finameRealLancamentoTable.importRunId, importRunId));
    await tx
      .delete(stagedFactTable)
      .where(eq(stagedFactTable.importRunId, importRunId));

    const lancamentosParaGravar = apuracao.lancamentos.map(
      (l: LancamentoClassificado) => ({
        importRunId,
        rawRowId: celulas.get(l.rowIndex)!.rawRowId,
        competencia: l.competencia,
        placa: l.placa,
        placaRaw: l.placaRaw,
        entityType: l.entityType,
        numdoc: l.numdoc,
        codfil: l.codfil,
        serie: l.serie,
        tipdoc: l.tipdoc,
        contaAnalitica: l.contaAnalitica,
        contaAnaliticaCodigo: l.contaAnaliticaCodigo,
        contaSintetica: l.contaSintetica,
        contaSinteticaCodigo: l.contaSinteticaCodigo,
        codvei: l.codvei,
        datatu: l.datatu === null ? null : new Date(l.datatu.replace(" ", "T")),
        situac: l.situac,
        valorAbsoluto: l.valorAbsoluto.toFixed(6),
        valorOriginal: l.valorOriginal.toFixed(6),
        rubrica: RUBRICA_FINAME_REAL,
        chaveContabilHash: hash(l.chaveContabil),
        grupoHash: hash(l.grupo),
        impressaoHash: hash(l.impressaoDigital),
        status: l.status,
        motivo: l.motivo,
      }),
    );
    for (let i = 0; i < lancamentosParaGravar.length; i += 500) {
      await tx.insert(finameRealLancamentoTable).values(
        lancamentosParaGravar.slice(i, i + 500),
      );
    }

    const fatos: (typeof stagedFactTable.$inferInsert)[] = [];
    for (const consolidado of apuracao.consolidados) {
      const ancora = celulas.get(consolidado.rowIndexAncora)!;
      const snapshotLabel = rotuloDe(consolidado.competencia);
      const base = {
        importRunId,
        snapshotLabel,
        entityKey: consolidado.placa,
        entityKeyRaw:
          apuracao.lancamentos.find((l) => l.rowIndex === consolidado.rowIndexAncora)
            ?.placaRaw ?? consolidado.placa,
        entityType: consolidado.entityType,
      };

      fatos.push({
        ...base,
        rawCellId: ancora.valor,
        attributeCode: codigoDoAtributoReal(consolidado.entityType),
        valueNumeric: consolidado.valor.toFixed(6),
        valueHash: hash(`n:${consolidado.valor.toFixed(6)}`),
        isNull: false,
      });

      /*
        O escopo. Sem ele `promote` recusa a vigência inteira por
        `ESCOPO_OBRIGATORIO_AUSENTE` — e recusaria com razão: sem unidade, duas
        unidades diferentes teriam a mesma identidade de vigência.
      */
      fatos.push({
        ...base,
        rawCellId: ancora.unidade ?? ancora.valor,
        attributeCode: `${consolidado.entityType.toLowerCase()}.unidade_cnpj`,
        valueText: unidadeCnpj,
        valueHash: hash(`t:${unidadeCnpj}`),
        isNull: false,
      });
      if (opcoes.unidadeNome) {
        fatos.push({
          ...base,
          rawCellId: ancora.unidade ?? ancora.valor,
          attributeCode: `${consolidado.entityType.toLowerCase()}.unidade_nome`,
          valueText: opcoes.unidadeNome,
          valueHash: hash(`t:${opcoes.unidadeNome}`),
          isNull: false,
        });
      }
    }

    for (let i = 0; i < fatos.length; i += 500) {
      await tx.insert(stagedFactTable).values(fatos.slice(i, i + 500));
    }

    await tx
      .update(importRunTable)
      .set({ stagedFactCount: fatos.length, status: "STAGED" })
      .where(eq(importRunTable.id, importRunId));

    return fatos.length;
  });

  const fatosEstagiados = apuracao.consolidados.length * (opcoes.unidadeNome ? 3 : 2);
  return {
    apuracao,
    fatosEstagiados,
    rotulos: [
      ...new Set(apuracao.consolidados.map((c) => rotuloDe(c.competencia))),
    ].sort(),
    reconciliacao,
  };
}

/**
 * Liga cada lançamento ao fato que ele compõe — depois da promoção.
 *
 * ---------------------------------------------------------------------------
 * Por que é um passo separado, e não parte do estágio
 * ---------------------------------------------------------------------------
 * Porque no estágio os fatos ainda não existem. O consolidado vira `staged_fact`,
 * e é a promoção que o transforma em `fact`, com id, snapshot e entidade — só
 * então há a que apontar. Deixar `fact_id` nulo para sempre seria guardar o
 * rastreio pela metade: a tela mostraria "R$ 15.478,60" sem conseguir dizer que
 * são dois documentos, e o número voltaria a ser uma soma sem origem.
 *
 * O vínculo é feito pelo par (entidade, competência), que é o grão do
 * consolidado dos dois lados — do lançamento pela placa e pela competência, e
 * do fato pela entidade e pela data da vigência mensal. Refazê-lo é idempotente:
 * a mesma consulta rodada duas vezes escreve o mesmo id.
 *
 * Os lançamentos que **não** entraram em soma nenhuma — duplicata provável,
 * placa sem classificação — continuam com `fact_id` nulo, e é assim que se
 * distingue "ficou de fora" de "não foi ligado ainda".
 */
export async function vincularLancamentosAosFatos(
  db: Database,
  importRunId: string,
): Promise<number> {
  const { rowCount } = await db.execute(sql`
    UPDATE finame_real_lancamento l
       SET fact_id = f.id,
           snapshot_id = f.snapshot_id,
           entity_id = f.entity_id
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity_identifier ident
        ON ident.entity_id = f.entity_id
       AND ident.identifier_type = 'PLACA'
       AND ident.is_current
     WHERE l.import_run_id = ${importRunId}::uuid
       AND l.status = 'ACEITO'
       AND ident.identifier_value = l.placa
       AND s.effective_date = l.competencia
       AND s.dataset_family = 'FINANCIAMENTO_REAL'
       AND s.status <> 'SUPERSEDED'
  `);
  return rowCount ?? 0;
}

/**
 * As linhas do extrato, reconstruídas de RAW.
 *
 * Devolve também, por linha física, o `raw_cell_id` da célula do valor e o da
 * célula da unidade: são eles que ancoram o rastreio dos fatos que vão nascer.
 */
async function lerLinhasDoRaw(
  db: Database,
  importRunId: string,
): Promise<{
  linhas: LinhaBrutaDoExtrato[];
  celulas: Map<number, { rawRowId: number; valor: number; unidade: number | null }>;
}> {
  const abas = await db
    .select()
    .from(rawSheetTable)
    .where(eq(rawSheetTable.importRunId, importRunId));

  const linhas: LinhaBrutaDoExtrato[] = [];
  const celulas = new Map<
    number,
    { rawRowId: number; valor: number; unidade: number | null }
  >();

  for (const aba of abas) {
    const linhasDaAba = await db
      .select()
      .from(rawRowTable)
      .where(eq(rawRowTable.rawSheetId, aba.id));
    if (linhasDaAba.length === 0) continue;

    /*
      O cabeçalho primeiro, e só ele — a aba é descartada antes de custar.

      O cabeçalho vem das próprias células, e não de uma lista à parte: é ele
      que `raw_cell.column_header` guarda, verbatim, em toda célula. Decidir o
      layout por aqui é decidir pelo que foi gravado, e não pelo que o leitor
      achou na hora.

      Ler **uma linha** para decidir, em vez do arquivo inteiro, é o que impede
      a aba errada de custar caro: o de-para que veio junto do extrato real tem
      24.164 linhas, e carregar as 48 mil células dele para concluir "isto não é
      o extrato" seria pagar o preço do arquivo todo por uma resposta que a
      primeira linha dá.
    */
    const linhaDeCabecalho =
      linhasDaAba.find((l) => l.isHeader) ??
      [...linhasDaAba].sort((a, b) => a.rowIndex - b.rowIndex)[0];
    const celulasDoCabecalho = await db
      .select()
      .from(rawCellTable)
      .where(eq(rawCellTable.rawRowId, linhaDeCabecalho.id));

    const cabecalhos = [...celulasDoCabecalho]
      .sort((a, b) => a.columnIndex - b.columnIndex)
      .map((c) => c.columnHeader);

    if (!reconhecerLayoutDoExtrato(cabecalhos).reconhecido) continue;

    const ids = linhasDaAba.map((l) => l.id);
    const todasAsCelulas: (typeof rawCellTable.$inferSelect)[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const lote = await db
        .select()
        .from(rawCellTable)
        .where(inArray(rawCellTable.rawRowId, ids.slice(i, i + 500)));
      todasAsCelulas.push(...lote);
    }

    const porLinha = new Map<number, (typeof rawCellTable.$inferSelect)[]>();
    for (const celula of todasAsCelulas) {
      const lista = porLinha.get(celula.rawRowId) ?? [];
      lista.push(celula);
      porLinha.set(celula.rawRowId, lista);
    }

    for (const linha of linhasDaAba) {
      if (linha.isHeader) continue;
      const doLinha = porLinha.get(linha.id) ?? [];
      if (doLinha.length === 0) continue;

      const valores: Record<string, string | null> = {};
      let celulaDoValor: number | null = null;
      let celulaDaUnidade: number | null = null;
      for (const celula of doLinha) {
        const chave = foldText(celula.columnHeader ?? "");
        valores[chave] = celula.rawValue;
        if (chave === "vlrrea") celulaDoValor = celula.id;
        if (chave === "unidade") celulaDaUnidade = celula.id;
      }
      if (celulaDoValor === null) continue;

      linhas.push({ rowIndex: linha.rowIndex, celulas: valores });
      celulas.set(linha.rowIndex, {
        rawRowId: linha.id,
        valor: celulaDoValor,
        unidade: celulaDaUnidade,
      });
    }
  }

  return { linhas, celulas };
}

/**
 * O tipo de ativo de cada placa, pelo acervo canônico.
 *
 * Uma consulta para todas as placas, e `null` para quem não estiver lá — que é
 * a fila de classificação. A conta contábil **não** entra nesta decisão: ver o
 * comentário de `ResolvedorDeTipo`.
 */
async function montarResolvedorDeTipo(
  db: Database,
  placas: readonly string[],
): Promise<(placa: string) => string | null> {
  if (placas.length === 0) return () => null;

  const conhecidas = new Map<string, string>();
  for (let i = 0; i < placas.length; i += 500) {
    const lote = await db
      .select({
        valor: entityIdentifierTable.identifierValue,
        tipo: entityTable.entityType,
      })
      .from(entityIdentifierTable)
      .innerJoin(entityTable, eq(entityTable.id, entityIdentifierTable.entityId))
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "PLACA"),
          eq(entityIdentifierTable.isCurrent, true),
          inArray(entityIdentifierTable.identifierValue, placas.slice(i, i + 500)),
        ),
      );
    for (const linha of lote) conhecidas.set(linha.valor, linha.tipo);
  }

  return (placa: string) => conhecidas.get(placa) ?? null;
}

/** As decisões já tomadas, em ordem cronológica: a última de cada chave vale. */
async function lerDecisoes(db: Database): Promise<DecisaoTomada[]> {
  const linhas = await db
    .select()
    .from(financiamentoRealDecisaoTable)
    .orderBy(financiamentoRealDecisaoTable.decididoEm);
  return linhas.map((l) => ({
    tipo: l.tipo as DecisaoTomada["tipo"],
    chave: l.chave,
    valor: l.valor,
  }));
}

function hash(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}
