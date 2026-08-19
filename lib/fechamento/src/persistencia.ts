import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  fechamentoApuracaoTable,
  fechamentoApuracaoVerbaTable,
  fechamentoCompetenciaTable,
  fechamentoConciliacaoItemTable,
  fechamentoCteTable,
  fechamentoDisponibilidadeTable,
  fechamentoDivergenciaTable,
  fechamentoDocumentoTable,
  fechamentoRequisicaoTable,
  fechamentoViagemTable,
} from "@workspace/db";
import { type Canal, type Frota, type Recusa, type TipoDeFonte, type TipoDeFrotaContratada } from "./dominio";
import { competencia as montarCompetencia, competenciaDaChave, type Competencia } from "./periodo";
import { apurar, type Apuracao, type Fontes, type Parcela } from "./apuracao";
import { lerOperacao } from "./leitores/operacao";
import { lerCtes } from "./leitores/cte";
import { lerRequisicoes } from "./leitores/requisicoes";
import { lerDisponibilidade } from "./leitores/disponibilidade";
import { lerConciliacao } from "./leitores/conciliacao";
import { verbaDe, verbaDesconhecida, type Verba } from "./verbas";

/**
 * A ponte entre o motor e o banco.
 *
 * O núcleo (`apuracao.ts`) é aritmética pura sobre arquivos, e continua sendo:
 * é o que permite conferir um fechamento inteiro num teste sem subir nada.
 * Este arquivo é o que dá memória a ele — recebe o documento, normaliza as
 * linhas, e roda a apuração **sobre o que o banco guardou**, não sobre o que
 * acabou de ser lido do arquivo.
 *
 * Essa distinção é deliberada e é a garantia central do módulo: um número que
 * a tela mostra é sempre um número que o banco sustenta, e a memória de
 * cálculo de cada parcela pode ser aberta até a linha física do arquivo de
 * origem. Se a apuração rodasse sobre o objeto em memória do upload, haveria um
 * caminho pelo qual a tela mostraria algo que o banco não tem.
 */

/** Um erro que a interface precisa distinguir de uma falha nossa. */
export class RecusaDeFechamento extends Error {
  constructor(
    readonly codigo:
      | "COMPETENCIA_NAO_ENCONTRADA"
      | "COMPETENCIA_ENCERRADA"
      | "DOCUMENTO_JA_RECEBIDO"
      | "ARQUIVO_ILEGIVEL",
    mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem);
    this.name = "RecusaDeFechamento";
  }
}

export interface CompetenciaRegistrada extends Competencia {
  id: string;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  estado: string;
  abertaEm: Date;
  apuradaEm: Date | null;
  encerradaEm: Date | null;
}

/**
 * Abre a competência, ou devolve a que já existe.
 *
 * Idempotente de propósito: o par (unidade, transportadora, quinzena) é um
 * fechamento só, e "abrir de novo" é o gesto natural de quem volta à tela no
 * dia seguinte. Criar uma segunda seria criar duas verdades sobre o mesmo
 * dinheiro — o índice único do banco impede, e aqui a intenção é atendida em
 * vez de virar erro.
 */
export async function abrirCompetencia(
  db: Database,
  entrada: {
    ano: number;
    mes: number;
    quinzena: 1 | 2;
    unidade: { codigo: string; nome?: string | null };
    transportadora: { codigo: string; nome?: string | null };
    por?: string | null;
  },
): Promise<CompetenciaRegistrada> {
  const comp = montarCompetencia(entrada.ano, entrada.mes, entrada.quinzena);

  const existente = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .where(
      and(
        eq(fechamentoCompetenciaTable.unidadeCodigo, entrada.unidade.codigo),
        eq(fechamentoCompetenciaTable.transportadoraCodigo, entrada.transportadora.codigo),
        eq(fechamentoCompetenciaTable.chave, comp.chave),
      ),
    )
    .limit(1);
  if (existente[0]) return comoRegistrada(existente[0]);

  const [criada] = await db
    .insert(fechamentoCompetenciaTable)
    .values({
      chave: comp.chave,
      ano: comp.ano,
      mes: comp.mes,
      quinzena: comp.quinzena,
      inicio: comp.inicio,
      fim: comp.fim,
      unidadeCodigo: entrada.unidade.codigo,
      unidadeNome: entrada.unidade.nome ?? null,
      transportadoraCodigo: entrada.transportadora.codigo,
      transportadoraNome: entrada.transportadora.nome ?? null,
      abertaPor: entrada.por ?? null,
    })
    .returning();
  return comoRegistrada(criada);
}

/** Todas as competências, da mais recente para a mais antiga. */
export async function listarCompetencias(db: Database): Promise<CompetenciaRegistrada[]> {
  const linhas = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .orderBy(
      desc(fechamentoCompetenciaTable.ano),
      desc(fechamentoCompetenciaTable.mes),
      desc(fechamentoCompetenciaTable.quinzena),
    );
  return linhas.map(comoRegistrada);
}

export async function buscarCompetencia(
  db: Database,
  id: string,
): Promise<CompetenciaRegistrada | null> {
  const [linha] = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .where(eq(fechamentoCompetenciaTable.id, id))
    .limit(1);
  return linha ? comoRegistrada(linha) : null;
}

function comoRegistrada(linha: typeof fechamentoCompetenciaTable.$inferSelect): CompetenciaRegistrada {
  const base = competenciaDaChave(linha.chave) ?? montarCompetencia(linha.ano, linha.mes, linha.quinzena as 1 | 2);
  return {
    ...base,
    id: linha.id,
    unidade: { codigo: linha.unidadeCodigo, nome: linha.unidadeNome },
    transportadora: { codigo: linha.transportadoraCodigo, nome: linha.transportadoraNome },
    estado: linha.estado,
    abertaEm: linha.abertaEm,
    apuradaEm: linha.apuradaEm,
    encerradaEm: linha.encerradaEm,
  };
}

export interface DocumentoRecebido {
  id: string;
  tipo: TipoDeFonte;
  nomeDoArquivo: string;
  linhasLidas: number;
  recusas: Recusa[];
  /** O documento que substituiu, quando houve substituição. */
  substituiu: string | null;
}

/**
 * Recebe um arquivo de fonte, normaliza suas linhas e as grava.
 *
 * Tudo em uma transação: um documento cujas linhas falharam no meio deixaria a
 * competência com meia fonte, e meia fonte é pior que fonte nenhuma — a
 * apuração rodaria, fecharia menos, e apontaria divergência onde só houve
 * gravação interrompida.
 *
 * **Reenviar substitui.** Uma exportação corrigida do mesmo tipo despromove a
 * anterior (`vigente = false`) e apaga as linhas dela; as duas ficam no
 * histórico de documentos. O mesmo arquivo, byte a byte, é recusado — é
 * reenvio acidental, e deixá-lo entrar dobraria a conta.
 */
export async function receberDocumento(
  db: Database,
  entrada: {
    competenciaId: string;
    tipo: TipoDeFonte;
    nomeDoArquivo: string;
    conteudo: Buffer;
    caminho?: string | null;
    por?: string | null;
  },
): Promise<DocumentoRecebido> {
  const competencia = await buscarCompetencia(db, entrada.competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência informada não existe.",
    );
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada. Reabra-a, com motivo, antes de enviar documentos.`,
    );
  }

  const sha256 = createHash("sha256").update(entrada.conteudo).digest("hex");
  const jaRecebido = await db
    .select({ id: fechamentoDocumentoTable.id, nome: fechamentoDocumentoTable.nomeDoArquivo })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, entrada.competenciaId),
        eq(fechamentoDocumentoTable.sha256, sha256),
      ),
    )
    .limit(1);
  if (jaRecebido[0]) {
    throw new RecusaDeFechamento(
      "DOCUMENTO_JA_RECEBIDO",
      `Este arquivo já foi recebido nesta competência como "${jaRecebido[0].nome}". ` +
        `Recebê-lo de novo dobraria a conta.`,
      { documentoId: jaRecebido[0].id },
    );
  }

  const lido = interpretar(entrada.tipo, entrada.conteudo);

  return db.transaction(async (tx) => {
    const anterior = await tx
      .select({ id: fechamentoDocumentoTable.id })
      .from(fechamentoDocumentoTable)
      .where(
        and(
          eq(fechamentoDocumentoTable.competenciaId, entrada.competenciaId),
          eq(fechamentoDocumentoTable.tipo, entrada.tipo),
          eq(fechamentoDocumentoTable.vigente, true),
        ),
      )
      .limit(1);

    if (anterior[0]) {
      /* As linhas saem por cascade; o documento fica, despromovido. */
      await tx.delete(fechamentoViagemTable).where(eq(fechamentoViagemTable.documentoId, anterior[0].id));
      await tx.delete(fechamentoCteTable).where(eq(fechamentoCteTable.documentoId, anterior[0].id));
      await tx.delete(fechamentoRequisicaoTable).where(eq(fechamentoRequisicaoTable.documentoId, anterior[0].id));
      await tx
        .delete(fechamentoDisponibilidadeTable)
        .where(eq(fechamentoDisponibilidadeTable.documentoId, anterior[0].id));
      await tx
        .delete(fechamentoConciliacaoItemTable)
        .where(eq(fechamentoConciliacaoItemTable.documentoId, anterior[0].id));
      await tx
        .update(fechamentoDocumentoTable)
        .set({ vigente: false })
        .where(eq(fechamentoDocumentoTable.id, anterior[0].id));
    }

    const [documento] = await tx
      .insert(fechamentoDocumentoTable)
      .values({
        competenciaId: entrada.competenciaId,
        tipo: entrada.tipo,
        nomeDoArquivo: entrada.nomeDoArquivo,
        sha256,
        tamanhoEmBytes: entrada.conteudo.byteLength,
        caminho: entrada.caminho ?? null,
        linhasLidas: lido.linhasLidas,
        recusas: lido.recusas,
        enviadoPor: entrada.por ?? null,
      })
      .returning({ id: fechamentoDocumentoTable.id });

    await gravarLinhas(tx, entrada.competenciaId, documento.id, entrada.tipo, entrada.conteudo);

    return {
      id: documento.id,
      tipo: entrada.tipo,
      nomeDoArquivo: entrada.nomeDoArquivo,
      linhasLidas: lido.linhasLidas,
      recusas: lido.recusas,
      substituiu: anterior[0]?.id ?? null,
    };
  });
}

/** Quantas linhas o leitor produziu, e o que recusou — sem gravar nada ainda. */
function interpretar(tipo: TipoDeFonte, conteudo: Buffer): { linhasLidas: number; recusas: Recusa[] } {
  try {
    switch (tipo) {
      case "OPERACAO": {
        const l = lerOperacao(conteudo);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "CTE": {
        const l = lerCtes(conteudo);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "REQUISICOES": {
        const l = lerRequisicoes(conteudo);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "DISPONIBILIDADE": {
        const l = lerDisponibilidade(conteudo);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "CONCILIACAO": {
        const l = lerConciliacao(conteudo);
        return { linhasLidas: l.itens.length, recusas: [] };
      }
    }
  } catch (erro) {
    throw new RecusaDeFechamento(
      "ARQUIVO_ILEGIVEL",
      erro instanceof Error ? erro.message : "O arquivo não pôde ser lido.",
    );
  }
}

/** Quantas linhas por INSERT. Acima disso o Postgres recusa por número de parâmetros. */
const LOTE = 500;

async function emLotes<T>(itens: T[], gravar: (lote: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < itens.length; i += LOTE) {
    await gravar(itens.slice(i, i + LOTE));
  }
}

type Transacao = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function gravarLinhas(
  tx: Transacao,
  competenciaId: string,
  documentoId: string,
  tipo: TipoDeFonte,
  conteudo: Buffer,
): Promise<void> {
  const comum = { competenciaId, documentoId };

  switch (tipo) {
    case "OPERACAO": {
      const { linhas } = lerOperacao(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoViagemTable).values(
          lote.map((v) => ({
            ...comum,
            linhaNoArquivo: v.linha,
            dia: v.dia,
            canal: v.canal,
            frota: v.frota,
            placa: v.placa || null,
            mapa: v.mapa || null,
            entregas: Math.round(v.entregas),
            caixasCarregadas: String(v.caixasCarregadas),
            caixasEntregues: String(v.caixasEntregues),
            valorFrete: String(v.valorFrete),
            percentualDeImposto: v.percentualDeImposto == null ? null : String(v.percentualDeImposto),
            valorDeImposto: String(v.valorDeImposto),
            valorFaturado: String(v.valorFaturado),
          })),
        ),
      );
      return;
    }
    case "CTE": {
      const { linhas } = lerCtes(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoCteTable).values(
          lote.map((c) => ({
            ...comum,
            linhaNoArquivo: c.linha,
            dia: c.dia,
            vbz: c.verba.vbz,
            verbaNome: c.verba.nome,
            verbaNatureza: c.verba.natureza,
            canal: c.canal,
            numero: c.numero || null,
            documento: c.documento || null,
            valorCte: String(c.valorCte),
            valorFrete: String(c.valorFrete),
            icms: String(c.icms),
            pis: String(c.pis),
            cofins: String(c.cofins),
            imposto: String(c.imposto),
            controle: c.controle || null,
          })),
        ),
      );
      return;
    }
    case "REQUISICOES": {
      const { linhas } = lerRequisicoes(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoRequisicaoTable).values(
          lote.map((r) => ({
            ...comum,
            linhaNoArquivo: r.linha,
            numero: r.numero,
            quinzenaDePagamento: r.quinzenaDePagamento,
            canal: r.canal,
            vbz: r.verba.vbz,
            verbaNome: r.verba.nome,
            tipoDeDespesaCodigo: r.tipoDeDespesa.codigo || null,
            tipoDeDespesaNome: r.tipoDeDespesa.nome || null,
            descricao: r.descricao || null,
            status: r.status,
            valor: String(r.valor),
            solicitante: r.solicitante || null,
            aprovadorRegional: r.aprovadorRegional || null,
            aprovadorAc: r.aprovadorAC || null,
            enviadaEm: r.enviadaEm,
            decididaEm: r.decididaEm,
          })),
        ),
      );
      return;
    }
    case "DISPONIBILIDADE": {
      const { linhas } = lerDisponibilidade(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoDisponibilidadeTable).values(
          lote.map((d) => ({
            ...comum,
            linhaNoArquivo: d.linha,
            tipoDeFrota: d.tipoDeFrota,
            dia: d.dia,
            canal: d.canal,
            frotaTotal: Math.round(d.frotaTotal),
            contratada: String(d.contratada),
            realPrimeiraViagem: String(d.realPrimeiraViagem),
            realSegundaViagem: String(d.realSegundaViagem),
            gapTotal: String(d.gapTotal),
            gapDaCia: String(d.gapDaCia),
            gapDaTransportadora: d.gapDaTransportadora,
            descontoCustoFixo: String(d.descontos.custoFixo),
            descontoEquipe: String(d.descontos.equipe),
            descontoIndiretos: String(d.descontos.indiretos),
            descontoFatorAjudante: String(d.descontos.fatorAjudante),
            descontoTotal: String(d.descontos.total),
            percentualDeUtilizacao: d.percentualDeUtilizacao == null ? null : String(d.percentualDeUtilizacao),
            percentualDeDisponibilidade:
              d.percentualDeDisponibilidade == null ? null : String(d.percentualDeDisponibilidade),
          })),
        ),
      );
      return;
    }
    case "CONCILIACAO": {
      const conciliacao = lerConciliacao(conteudo);
      await emLotes(conciliacao.itens, (lote) =>
        tx.insert(fechamentoConciliacaoItemTable).values(
          lote.map((i) => ({
            ...comum,
            linhaNoArquivo: i.linha,
            secao: i.secao,
            bloco: i.bloco || null,
            rubrica: i.rubrica,
            conciliado: i.conciliado,
            emitido: i.emitido == null ? null : String(i.emitido),
            calculado: i.calculado == null ? null : String(i.calculado),
          })),
        ),
      );
      /*
        Os avisos do rodapé viram itens sem valor, e não texto solto: assim a
        pendência "NF-e sem vínculo com CT-e" tem o mesmo endereço que qualquer
        outra linha do relatório e pode ser apontada pela apuração.
      */
      if (conciliacao.avisos.length > 0) {
        await tx.insert(fechamentoConciliacaoItemTable).values(
          conciliacao.avisos.map((aviso) => ({
            ...comum,
            linhaNoArquivo: 0,
            secao: "GERAL",
            bloco: "AVISO",
            rubrica: aviso,
            conciliado: null,
            emitido: null,
            calculado: null,
          })),
        );
      }
      return;
    }
  }
}

/**
 * Roda a apuração da competência **sobre o que o banco guardou**.
 *
 * Não sobre o arquivo recém-enviado: é essa escolha que garante que todo número
 * da tela tem lastro em linha gravada, com a linha física do arquivo de origem
 * ao lado.
 */
export async function apurarCompetencia(
  db: Database,
  competenciaId: string,
  por?: string | null,
): Promise<{ competencia: CompetenciaRegistrada; apuracao: Apuracao; apuracaoId: string }> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento("COMPETENCIA_NAO_ENCONTRADA", "A competência informada não existe.");
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada e não pode ser reapurada sem reabertura.`,
    );
  }

  const fontes = await lerFontesDoBanco(db, competenciaId);
  const apuracao = apurar(competencia, fontes);

  const apuracaoId = await db.transaction(async (tx) => {
    await tx
      .update(fechamentoApuracaoTable)
      .set({ vigente: false })
      .where(
        and(
          eq(fechamentoApuracaoTable.competenciaId, competenciaId),
          eq(fechamentoApuracaoTable.vigente, true),
        ),
      );

    const [gravada] = await tx
      .insert(fechamentoApuracaoTable)
      .values({
        competenciaId,
        rodadaPor: por ?? null,
        fontesPresentes: apuracao.fontesPresentes,
        fontesAusentes: apuracao.fontesAusentes,
        aliquotas: apuracao.aliquotas,
        cargaFiscal: [...apuracao.cargaFiscal].map(([canal, carga]) => ({ canal, ...carga })),
        totalEmitido: String(apuracao.totais.emitido),
        totalEsperado: String(apuracao.totais.esperado),
        totalNaoConferido: String(apuracao.totais.naoConferido),
        totalDiferenca: String(apuracao.totais.diferenca),
      })
      .returning({ id: fechamentoApuracaoTable.id });

    if (apuracao.verbas.length > 0) {
      await tx.insert(fechamentoApuracaoVerbaTable).values(
        apuracao.verbas.map((v) => ({
          apuracaoId: gravada.id,
          vbz: v.verba.vbz,
          canal: v.verba.canal,
          verbaNome: v.verba.nome,
          verbaNatureza: v.verba.natureza,
          emitido: String(v.emitido),
          baseEmitida: String(v.baseEmitida),
          documentos: v.documentos,
          esperado: v.esperado == null ? null : String(v.esperado),
          diferenca: v.diferenca == null ? null : String(v.diferenca),
          memoria: v.memoria,
        })),
      );
    }

    if (apuracao.divergencias.length > 0) {
      await tx.insert(fechamentoDivergenciaTable).values(
        apuracao.divergencias.map((d) => ({
          apuracaoId: gravada.id,
          tipo: d.tipo,
          canal: d.canal,
          titulo: d.titulo,
          valor: String(d.valor),
          onde: d.onde,
          sentido: d.sentido,
        })),
      );
    }

    await tx
      .update(fechamentoCompetenciaTable)
      .set({ apuradaEm: new Date(), estado: "APURADA" })
      .where(eq(fechamentoCompetenciaTable.id, competenciaId));

    return gravada.id;
  });

  return { competencia, apuracao, apuracaoId };
}

/** As cinco fontes, reconstruídas das tabelas de linha. */
async function lerFontesDoBanco(db: Database, competenciaId: string): Promise<Fontes> {
  const presentes = await db
    .select({ tipo: fechamentoDocumentoTable.tipo })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, competenciaId),
        eq(fechamentoDocumentoTable.vigente, true),
      ),
    );
  const tem = new Set(presentes.map((p) => p.tipo));
  const fontes: Fontes = {};
  const numero = (v: string | null) => (v == null ? 0 : Number(v));

  if (tem.has("OPERACAO")) {
    const linhas = await db
      .select()
      .from(fechamentoViagemTable)
      .where(eq(fechamentoViagemTable.competenciaId, competenciaId));
    fontes.operacao = linhas.map((v) => ({
      linha: v.linhaNoArquivo,
      dia: v.dia,
      canal: v.canal as Canal,
      frota: v.frota as Frota,
      placa: v.placa ?? "",
      mapa: v.mapa ?? "",
      entregas: v.entregas,
      caixasCarregadas: numero(v.caixasCarregadas),
      caixasEntregues: numero(v.caixasEntregues),
      valorFrete: numero(v.valorFrete),
      percentualDeImposto: v.percentualDeImposto == null ? null : Number(v.percentualDeImposto),
      valorDeImposto: numero(v.valorDeImposto),
      valorFaturado: numero(v.valorFaturado),
    }));
  }

  if (tem.has("CTE")) {
    const linhas = await db
      .select()
      .from(fechamentoCteTable)
      .where(eq(fechamentoCteTable.competenciaId, competenciaId));
    fontes.ctes = linhas.map((c) => ({
      linha: c.linhaNoArquivo,
      dia: c.dia,
      verba: verbaGravada(c.vbz, c.canal as Canal, c.verbaNome),
      canal: c.canal as Canal,
      numero: c.numero ?? "",
      documento: c.documento ?? "",
      valorCte: numero(c.valorCte),
      valorFrete: numero(c.valorFrete),
      icms: numero(c.icms),
      pis: numero(c.pis),
      cofins: numero(c.cofins),
      imposto: numero(c.imposto),
      controle: c.controle ?? "",
    }));
  }

  if (tem.has("REQUISICOES")) {
    const linhas = await db
      .select()
      .from(fechamentoRequisicaoTable)
      .where(eq(fechamentoRequisicaoTable.competenciaId, competenciaId));
    fontes.requisicoes = linhas.map((r) => ({
      linha: r.linhaNoArquivo,
      numero: r.numero,
      quinzenaDePagamento: r.quinzenaDePagamento,
      canal: r.canal as Canal,
      verba: verbaGravada(r.vbz, r.canal as Canal, r.verbaNome),
      tipoDeDespesa: { codigo: r.tipoDeDespesaCodigo ?? "", nome: r.tipoDeDespesaNome ?? "" },
      descricao: r.descricao ?? "",
      status: r.status,
      valor: numero(r.valor),
      solicitante: r.solicitante ?? "",
      aprovadorRegional: r.aprovadorRegional ?? "",
      aprovadorAC: r.aprovadorAc ?? "",
      enviadaEm: r.enviadaEm,
      decididaEm: r.decididaEm,
    }));
  }

  if (tem.has("DISPONIBILIDADE")) {
    const linhas = await db
      .select()
      .from(fechamentoDisponibilidadeTable)
      .where(eq(fechamentoDisponibilidadeTable.competenciaId, competenciaId));
    fontes.disponibilidade = linhas.map((d) => ({
      linha: d.linhaNoArquivo,
      aba: d.tipoDeFrota,
      tipoDeFrota: d.tipoDeFrota as TipoDeFrotaContratada,
      dia: d.dia,
      canal: d.canal as Canal,
      frotaTotal: d.frotaTotal,
      contratada: numero(d.contratada),
      realPrimeiraViagem: numero(d.realPrimeiraViagem),
      realSegundaViagem: numero(d.realSegundaViagem),
      gapTotal: numero(d.gapTotal),
      gapDaCia: numero(d.gapDaCia),
      gapDaTransportadora: (d.gapDaTransportadora ?? {}) as {
        frotaCancelada: number;
        outrosCancelados: number;
        frotaNaoCancelada: number;
        outrosNaoCancelados: number;
      },
      descontos: {
        custoFixo: numero(d.descontoCustoFixo),
        equipe: numero(d.descontoEquipe),
        indiretos: numero(d.descontoIndiretos),
        fatorAjudante: numero(d.descontoFatorAjudante),
        total: numero(d.descontoTotal),
      },
      percentualDeUtilizacao: d.percentualDeUtilizacao == null ? null : Number(d.percentualDeUtilizacao),
      percentualDeDisponibilidade:
        d.percentualDeDisponibilidade == null ? null : Number(d.percentualDeDisponibilidade),
    }));
  }

  if (tem.has("CONCILIACAO")) {
    const linhas = await db
      .select()
      .from(fechamentoConciliacaoItemTable)
      .where(eq(fechamentoConciliacaoItemTable.competenciaId, competenciaId));
    fontes.conciliacao = {
      transportadora: null,
      unidade: null,
      periodo: { inicio: null, fim: null },
      opcao: null,
      itens: linhas
        .filter((i) => i.bloco !== "AVISO")
        .map((i) => ({
          linha: i.linhaNoArquivo,
          secao: i.secao as Canal | "GERAL",
          bloco: i.bloco ?? "",
          rubrica: i.rubrica,
          conciliado: (i.conciliado as "S" | "N" | null) ?? null,
          emitido: i.emitido == null ? null : Number(i.emitido),
          calculado: i.calculado == null ? null : Number(i.calculado),
        })),
      avisos: linhas.filter((i) => i.bloco === "AVISO").map((i) => i.rubrica),
    };
  }

  return fontes;
}

/**
 * A verba de uma linha gravada.
 *
 * O catálogo é a autoridade; o nome gravado só entra quando o catálogo não
 * conhece a VBZ — que é o caso de uma verba nova que a Ambev criou depois deste
 * deploy. Preferir o catálogo é o que faz uma correção nele valer para as
 * competências já importadas sem reimportar nada.
 */
function verbaGravada(vbz: number, canal: Canal, nomeGravado: string): Verba {
  return verbaDe(vbz) ?? verbaDesconhecida(vbz, canal, nomeGravado);
}

/** Os documentos de uma competência, com o que cada leitor recusou. */
export async function listarDocumentos(
  db: Database,
  competenciaId: string,
): Promise<
  {
    id: string;
    tipo: TipoDeFonte;
    nomeDoArquivo: string;
    linhasLidas: number;
    recusas: Recusa[];
    vigente: boolean;
    enviadoEm: Date;
  }[]
> {
  const linhas = await db
    .select()
    .from(fechamentoDocumentoTable)
    .where(eq(fechamentoDocumentoTable.competenciaId, competenciaId))
    .orderBy(desc(fechamentoDocumentoTable.enviadoEm));
  return linhas.map((d) => ({
    id: d.id,
    tipo: d.tipo as TipoDeFonte,
    nomeDoArquivo: d.nomeDoArquivo,
    linhasLidas: d.linhasLidas,
    recusas: (d.recusas ?? []) as Recusa[],
    vigente: d.vigente,
    enviadoEm: d.enviadoEm,
  }));
}

/** A apuração vigente de uma competência, como o banco a guardou. */
export async function lerApuracaoVigente(
  db: Database,
  competenciaId: string,
): Promise<{
  id: string;
  rodadaEm: Date;
  fontesPresentes: TipoDeFonte[];
  fontesAusentes: TipoDeFonte[];
  aliquotas: unknown;
  cargaFiscal: unknown;
  totais: { emitido: number; esperado: number; naoConferido: number; diferenca: number };
  verbas: {
    vbz: number;
    canal: string;
    nome: string;
    natureza: string;
    emitido: number;
    baseEmitida: number;
    documentos: number;
    esperado: number | null;
    diferenca: number | null;
    memoria: Parcela[];
  }[];
  divergencias: {
    id: string;
    tipo: string;
    canal: string;
    titulo: string;
    valor: number;
    onde: string;
    sentido: string;
    desfecho: string;
  }[];
} | null> {
  const [apuracao] = await db
    .select()
    .from(fechamentoApuracaoTable)
    .where(
      and(
        eq(fechamentoApuracaoTable.competenciaId, competenciaId),
        eq(fechamentoApuracaoTable.vigente, true),
      ),
    )
    .limit(1);
  if (!apuracao) return null;

  const verbas = await db
    .select()
    .from(fechamentoApuracaoVerbaTable)
    .where(eq(fechamentoApuracaoVerbaTable.apuracaoId, apuracao.id))
    .orderBy(fechamentoApuracaoVerbaTable.vbz);

  const divergencias = await db
    .select()
    .from(fechamentoDivergenciaTable)
    .where(eq(fechamentoDivergenciaTable.apuracaoId, apuracao.id))
    .orderBy(desc(sql`abs(${fechamentoDivergenciaTable.valor})`));

  return {
    id: apuracao.id,
    rodadaEm: apuracao.rodadaEm,
    fontesPresentes: apuracao.fontesPresentes as TipoDeFonte[],
    fontesAusentes: apuracao.fontesAusentes as TipoDeFonte[],
    aliquotas: apuracao.aliquotas,
    cargaFiscal: apuracao.cargaFiscal,
    totais: {
      emitido: Number(apuracao.totalEmitido),
      esperado: Number(apuracao.totalEsperado),
      naoConferido: Number(apuracao.totalNaoConferido),
      diferenca: Number(apuracao.totalDiferenca),
    },
    verbas: verbas.map((v) => ({
      vbz: v.vbz,
      canal: v.canal,
      nome: v.verbaNome,
      natureza: v.verbaNatureza,
      emitido: Number(v.emitido),
      baseEmitida: Number(v.baseEmitida),
      documentos: v.documentos,
      esperado: v.esperado == null ? null : Number(v.esperado),
      diferenca: v.diferenca == null ? null : Number(v.diferenca),
      memoria: (v.memoria ?? []) as Parcela[],
    })),
    divergencias: divergencias.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      canal: d.canal,
      titulo: d.titulo,
      valor: Number(d.valor),
      onde: d.onde,
      sentido: d.sentido,
      desfecho: d.desfecho,
    })),
  };
}
