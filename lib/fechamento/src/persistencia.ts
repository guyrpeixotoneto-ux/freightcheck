import { createHash } from "node:crypto";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
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
import {
  TIPOS_DE_FONTE,
  type Canal,
  type Frota,
  type Recusa,
  type TipoDeFonte,
  type TipoDeFrotaContratada,
} from "./dominio";
import {
  competencia as montarCompetencia,
  competenciaDaChave,
  dentroDaCompetencia,
  type Competencia,
} from "./periodo";
import { apurar, type Apuracao, type Fontes, type Parcela } from "./apuracao";
import { lerOperacao, type DetalheDaViagem, type Viagem } from "./leitores/operacao";
import { abrirDia, diasDaCompetencia, type DiaAberto, type DiaDaOperacao } from "./diario";
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
      | "COMPETENCIA_NAO_APURADA"
      | "COMPETENCIA_NAO_ESTA_ENCERRADA"
      | "MOTIVO_OBRIGATORIO"
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
  /**
   * Por que a competência foi reaberta, quando foi.
   *
   * Vive no registro e não num log à parte porque é a pergunta que se faz
   * olhando para a competência — "por que este período, que estava fechado,
   * está aberto de novo?" —, e uma resposta que exige abrir outra tela não é
   * respondida.
   */
  motivoDaReabertura: string | null;
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
    motivoDaReabertura: linha.motivoDaReabertura,
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

/**
 * O retrato da viagem, do objeto lido para as colunas do banco.
 *
 * Texto vazio vira `NULL`, e número ausente continua ausente. É a mesma regra
 * do leitor, repetida aqui porque é aqui que ela vira dado gravado: `""` e `0`
 * afirmam ("a placa é vazia", "não pagou nada"); `NULL` diz que a exportação
 * não trouxe a coluna, que é a única coisa que sabemos.
 */
function retratoParaOBanco(detalhe: DetalheDaViagem | undefined) {
  const texto = (valor: string | undefined) => (valor?.trim() ? valor.trim() : null);
  const numero = (valor: number | null | undefined) =>
    valor == null ? null : String(valor);

  return {
    transportadora: texto(detalhe?.transportadora),
    cargaAtual: texto(detalhe?.cargaAtual),
    regiao: texto(detalhe?.regiao),
    veiculo: texto(detalhe?.veiculo),
    entregaOuVolume: texto(detalhe?.entregaOuVolume),
    unidadeDeOrigem: texto(detalhe?.unidadeDeOrigem),
    situacaoMultiCdd: texto(detalhe?.situacaoMultiCdd),
    veiculoCadastradoNoCdd: texto(detalhe?.veiculoCadastradoNoCdd),
    matriculaDoMotorista: texto(detalhe?.matriculaDoMotorista),
    matriculaDoAjudante1: texto(detalhe?.matriculaDoAjudante1),
    matriculaDoAjudante2: texto(detalhe?.matriculaDoAjudante2),

    veiculoIndisponivel: texto(detalhe?.veiculoIndisponivel),
    placaIndisponivel: texto(detalhe?.placaIndisponivel),
    frotaIndisponivel: texto(detalhe?.frotaIndisponivel),
    tipoDeIndisponibilidade: texto(detalhe?.tipoDeIndisponibilidade),

    ocupacao: numero(detalhe?.ocupacao),
    caixasDeRota: numero(detalhe?.caixasDeRota),
    caixasDeAs: numero(detalhe?.caixasDeAs),
    veiculoBm: numero(detalhe?.veiculoBm),
    rShow: numero(detalhe?.rShow),

    horaDeSaida: texto(detalhe?.horaDeSaida),
    horaDeEntrada: texto(detalhe?.horaDeEntrada),
    kmDeSaida: numero(detalhe?.kmDeSaida),
    kmDeEntrada: numero(detalhe?.kmDeEntrada),
    tempoInterno: texto(detalhe?.tempoInterno),
    tempoDoLaco: texto(detalhe?.tempoDoLaco),
    tempoDeDeslocamento: texto(detalhe?.tempoDeDeslocamento),
    kmDoLaco: numero(detalhe?.kmDoLaco),
    kmDeDeslocamento: numero(detalhe?.kmDeDeslocamento),

    tempoPrevisto: texto(detalhe?.tempoPrevisto),
    kmPrevisto: numero(detalhe?.kmPrevisto),

    custoSpot: numero(detalhe?.custoSpot),
    custoVariavel: numero(detalhe?.custoVariavel),
    lucro: numero(detalhe?.lucro),
    lucroUnitario: numero(detalhe?.lucroUnitario),
    tipoDeImposto: texto(detalhe?.tipoDeImposto),
    valorUnitarioPorCaixaEntregue: numero(detalhe?.valorUnitarioPorCaixaEntregue),
    valorPagoPorCaixaSemImposto: numero(detalhe?.valorPagoPorCaixaSemImposto),
    valorPagoPorCaixaComImposto: numero(detalhe?.valorPagoPorCaixaComImposto),
    valorDropdown: numero(detalhe?.valorDropdown),

    valorUnitarioDoPontoDoMotorista: numero(detalhe?.valorUnitarioDoPontoDoMotorista),
    valorUnitarioDoPontoDoAjudante: numero(detalhe?.valorUnitarioDoPontoDoAjudante),
    valorDaEquipeDeEntregaMotorista: numero(detalhe?.valorDaEquipeDeEntregaMotorista),
    valorDaEquipeDeEntregaAjudante: numero(detalhe?.valorDaEquipeDeEntregaAjudante),

    custoVariavelCedbz: numero(detalhe?.custoVariavelCedbz),
    lucroUnitarioCedbz: numero(detalhe?.lucroUnitarioCedbz),
    lucroVariavelPorCaixaEntregueFfcedbz: numero(detalhe?.lucroVariavelPorCaixaEntregueFfcedbz),
  };
}

/**
 * A viagem inteira, como o banco a guardou.
 *
 * É a mesma função para a apuração e para a tela do dia — de propósito. Duas
 * conversões da mesma linha são duas oportunidades de a tela mostrar um frete
 * e a conta somar outro; aqui a linha vira viagem uma vez só, e o que a
 * apuração soma é literalmente o que a tela exibe.
 */
function viagemGravada(linha: typeof fechamentoViagemTable.$inferSelect): Viagem {
  const numero = (v: string | null) => (v == null ? 0 : Number(v));
  return {
    linha: linha.linhaNoArquivo,
    dia: linha.dia,
    canal: linha.canal as Canal,
    frota: linha.frota as Frota,
    placa: linha.placa ?? "",
    mapa: linha.mapa ?? "",
    entregas: linha.entregas,
    caixasCarregadas: numero(linha.caixasCarregadas),
    caixasEntregues: numero(linha.caixasEntregues),
    valorFrete: numero(linha.valorFrete),
    percentualDeImposto: linha.percentualDeImposto == null ? null : Number(linha.percentualDeImposto),
    valorDeImposto: numero(linha.valorDeImposto),
    valorFaturado: numero(linha.valorFaturado),
    detalhe: retratoDoBanco(linha),
  };
}

/** O caminho de volta: a linha gravada vira o retrato que a tela do dia mostra. */
function retratoDoBanco(linha: typeof fechamentoViagemTable.$inferSelect): DetalheDaViagem {
  const texto = (valor: string | null) => valor ?? "";
  const numero = (valor: string | null) => (valor == null ? null : Number(valor));

  return {
    transportadora: texto(linha.transportadora),
    cargaAtual: texto(linha.cargaAtual),
    regiao: texto(linha.regiao),
    veiculo: texto(linha.veiculo),
    entregaOuVolume: texto(linha.entregaOuVolume),
    unidadeDeOrigem: texto(linha.unidadeDeOrigem),
    situacaoMultiCdd: texto(linha.situacaoMultiCdd),
    veiculoCadastradoNoCdd: texto(linha.veiculoCadastradoNoCdd),
    matriculaDoMotorista: texto(linha.matriculaDoMotorista),
    matriculaDoAjudante1: texto(linha.matriculaDoAjudante1),
    matriculaDoAjudante2: texto(linha.matriculaDoAjudante2),

    veiculoIndisponivel: texto(linha.veiculoIndisponivel),
    placaIndisponivel: texto(linha.placaIndisponivel),
    frotaIndisponivel: texto(linha.frotaIndisponivel),
    tipoDeIndisponibilidade: texto(linha.tipoDeIndisponibilidade),

    ocupacao: numero(linha.ocupacao),
    caixasDeRota: numero(linha.caixasDeRota),
    caixasDeAs: numero(linha.caixasDeAs),
    veiculoBm: numero(linha.veiculoBm),
    rShow: numero(linha.rShow),

    horaDeSaida: texto(linha.horaDeSaida),
    horaDeEntrada: texto(linha.horaDeEntrada),
    kmDeSaida: numero(linha.kmDeSaida),
    kmDeEntrada: numero(linha.kmDeEntrada),
    tempoInterno: texto(linha.tempoInterno),
    tempoDoLaco: texto(linha.tempoDoLaco),
    tempoDeDeslocamento: texto(linha.tempoDeDeslocamento),
    kmDoLaco: numero(linha.kmDoLaco),
    kmDeDeslocamento: numero(linha.kmDeDeslocamento),

    tempoPrevisto: texto(linha.tempoPrevisto),
    kmPrevisto: numero(linha.kmPrevisto),

    custoSpot: numero(linha.custoSpot),
    custoVariavel: numero(linha.custoVariavel),
    lucro: numero(linha.lucro),
    lucroUnitario: numero(linha.lucroUnitario),
    tipoDeImposto: texto(linha.tipoDeImposto),
    valorUnitarioPorCaixaEntregue: numero(linha.valorUnitarioPorCaixaEntregue),
    valorPagoPorCaixaSemImposto: numero(linha.valorPagoPorCaixaSemImposto),
    valorPagoPorCaixaComImposto: numero(linha.valorPagoPorCaixaComImposto),
    valorDropdown: numero(linha.valorDropdown),

    valorUnitarioDoPontoDoMotorista: numero(linha.valorUnitarioDoPontoDoMotorista),
    valorUnitarioDoPontoDoAjudante: numero(linha.valorUnitarioDoPontoDoAjudante),
    valorDaEquipeDeEntregaMotorista: numero(linha.valorDaEquipeDeEntregaMotorista),
    valorDaEquipeDeEntregaAjudante: numero(linha.valorDaEquipeDeEntregaAjudante),

    custoVariavelCedbz: numero(linha.custoVariavelCedbz),
    lucroUnitarioCedbz: numero(linha.lucroUnitarioCedbz),
    lucroVariavelPorCaixaEntregueFfcedbz: numero(linha.lucroVariavelPorCaixaEntregueFfcedbz),
  };
}

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
            ...retratoParaOBanco(v.detalhe),
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
    fontes.operacao = linhas.map(viagemGravada);
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

/* ===========================================================================
 * O diário: a operação da competência, dia a dia
 * ======================================================================== */

/** O 2Art vigente da competência — de onde o diário saiu. */
export interface FonteDoDiario {
  nomeDoArquivo: string;
  linhasLidas: number;
  enviadoEm: Date;
}

export interface DiarioDaCompetencia {
  competencia: CompetenciaRegistrada;
  /** `null` quando o 2Art ainda não foi enviado — e aí a grade nasce vazia. */
  fonte: FonteDoDiario | null;
  dias: DiaDaOperacao[];
  /**
   * Viagens do 2Art que caíram fora do período, contadas e nunca somadas.
   *
   * O 2Art é exportado por mês e a competência é meio mês: metade do arquivo
   * pertence à outra quinzena. Este número existe para que "o arquivo tem 949
   * linhas e a grade mostra 480 viagens" tenha resposta na própria tela, em vez
   * de virar desconfiança sobre a importação.
   */
  viagensForaDoPeriodo: number;
}

export interface DiaDaCompetencia {
  competencia: CompetenciaRegistrada;
  fonte: FonteDoDiario | null;
  dia: DiaAberto;
}

/** O 2Art vigente, quando há um. */
async function fonteDaOperacao(db: Database, competenciaId: string): Promise<FonteDoDiario | null> {
  const [documento] = await db
    .select({
      nomeDoArquivo: fechamentoDocumentoTable.nomeDoArquivo,
      linhasLidas: fechamentoDocumentoTable.linhasLidas,
      enviadoEm: fechamentoDocumentoTable.enviadoEm,
    })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, competenciaId),
        eq(fechamentoDocumentoTable.tipo, "OPERACAO"),
        eq(fechamentoDocumentoTable.vigente, true),
      ),
    )
    .limit(1);
  return documento ?? null;
}

/**
 * A grade de dias da competência — o que a tela abre antes de escolher um dia.
 *
 * Lê as viagens gravadas, e não o arquivo: é a mesma garantia da apuração — o
 * número que a tela mostra é um número que o banco sustenta, com a linha física
 * do 2Art do lado. Sem competência, `null`; sem 2Art, a grade vem inteira com
 * zero viagens em cada dia, que é a resposta honesta a "o que rodou no dia 3"
 * quando ninguém importou a operação ainda.
 */
export async function lerDiarioDaCompetencia(
  db: Database,
  competenciaId: string,
): Promise<DiarioDaCompetencia | null> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) return null;

  const [fonte, linhas] = await Promise.all([
    fonteDaOperacao(db, competenciaId),
    db.select().from(fechamentoViagemTable).where(eq(fechamentoViagemTable.competenciaId, competenciaId)),
  ]);

  const viagens = linhas.map(viagemGravada);
  const dias = diasDaCompetencia(competencia, viagens);
  const noPeriodo = dias.reduce((s, d) => s + d.totais.viagens, 0);

  return {
    competencia,
    fonte,
    dias,
    viagensForaDoPeriodo: viagens.length - noPeriodo,
  };
}

/**
 * Um dia aberto: as viagens daquele dia, inteiras.
 *
 * O filtro por dia é do banco (índice `fechamento_viagem_por_competencia`, que
 * já abre por competência e dia) e não da memória: a tela do dia é a que se
 * abre e fecha dezenas de vezes numa conferência, e trazer a quinzena inteira
 * para escolher um dia seria pagar quinze vezes o que se vai ler uma.
 *
 * `null` quando a competência não existe **ou** quando o dia está fora dela —
 * as duas coisas são a mesma para quem pergunta: não há esse dia aqui.
 */
export async function lerDiaDaCompetencia(
  db: Database,
  competenciaId: string,
  dia: string,
): Promise<DiaDaCompetencia | null> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) return null;
  if (!dentroDaCompetencia(competencia, dia)) return null;

  const [fonte, linhas] = await Promise.all([
    fonteDaOperacao(db, competenciaId),
    db
      .select()
      .from(fechamentoViagemTable)
      .where(
        and(
          eq(fechamentoViagemTable.competenciaId, competenciaId),
          eq(fechamentoViagemTable.dia, dia),
        ),
      ),
  ]);

  return { competencia, fonte, dia: abrirDia(dia, linhas.map(viagemGravada)) };
}

/**
 * O resumo de uma competência: o que a tela de Apurações mostra numa linha.
 *
 * É a competência somada, não a competência inteira. Nada aqui abre a memória
 * de cálculo — para isso existe a tela de dentro —, e nada aqui é recalculado:
 * `emitido` e `naoConferido` são os totais que a apuração gravou quando rodou,
 * e não uma soma refeita agora. Um número que muda entre a lista e o detalhe
 * seria pior do que não ter lista.
 */
export interface ResumoDeApuracao {
  competencia: CompetenciaRegistrada;
  /** As fontes com documento vigente. O `4/5` da tela sai daqui. */
  relatorios: TipoDeFonte[];
  /** Nulo enquanto a competência não apurou. Nulo não é zero. */
  apuracao: {
    rodadaEm: Date;
    emitido: number;
    naoConferido: number;
    diferenca: number;
    /**
     * O que há em discussão: a soma, **em módulo**, das divergências
     * acionáveis que ainda não tiveram desfecho.
     *
     * Em módulo porque as duas direções são pergunta — o que falta receber e o
     * que se recebeu a mais. Somá-las com sinal deixaria uma abater a outra e
     * devolveria um número menor do que o que está de fato em aberto, que é o
     * oposto do que a coluna promete.
     *
     * Ficam de fora as informativas, que não pedem resposta, e as que já foram
     * aceitas ou resolvidas, que deixaram de ser pergunta. Uma em contestação
     * continua contando: contestar é justamente estar questionando.
     */
    aQuestionar: number;
    /** Quantas divergências sustentam esse valor. */
    aQuestionarQuantidade: number;
  } | null;
}

/**
 * O resumo de todas as competências, da mais recente para a mais antiga.
 *
 * **Por que existe, em vez de a tela somar.** A alternativa seria a lista
 * chamar `GET /competencias/:id` uma vez por competência e montar o resumo no
 * navegador: N+1 idas ao banco numa tela que existe justamente para olhar
 * todas de uma vez, com o total da quinzena aparecendo só depois da última
 * resposta. Aqui são quatro consultas de tamanho fixo, e o custo não cresce
 * com o número de competências.
 *
 * **Por que quatro consultas e não um `join` só.** Documentos e divergências
 * são muitos-para-um em relação à competência; um `join` das duas multiplicaria
 * as linhas uma pela outra e as somas sairiam infladas. Agregar cada lado no
 * banco e cruzar por `id` na memória é a forma que não tem esse erro.
 */
export async function listarApuracoes(db: Database): Promise<ResumoDeApuracao[]> {
  const competencias = await listarCompetencias(db);
  if (competencias.length === 0) return [];

  const [documentos, apuracoes, questoes] = await Promise.all([
    db
      .select({
        competenciaId: fechamentoDocumentoTable.competenciaId,
        tipo: fechamentoDocumentoTable.tipo,
      })
      .from(fechamentoDocumentoTable)
      .where(eq(fechamentoDocumentoTable.vigente, true)),
    db
      .select({
        id: fechamentoApuracaoTable.id,
        competenciaId: fechamentoApuracaoTable.competenciaId,
        rodadaEm: fechamentoApuracaoTable.rodadaEm,
        totalEmitido: fechamentoApuracaoTable.totalEmitido,
        totalNaoConferido: fechamentoApuracaoTable.totalNaoConferido,
        totalDiferenca: fechamentoApuracaoTable.totalDiferenca,
      })
      .from(fechamentoApuracaoTable)
      .where(eq(fechamentoApuracaoTable.vigente, true)),
    db
      .select({
        apuracaoId: fechamentoDivergenciaTable.apuracaoId,
        soma: sql<string>`coalesce(sum(abs(${fechamentoDivergenciaTable.valor})), 0)`,
        quantidade: sql<number>`count(*)::int`,
      })
      .from(fechamentoDivergenciaTable)
      .where(
        and(
          notInArray(fechamentoDivergenciaTable.sentido, ["INFORMATIVO"]),
          notInArray(fechamentoDivergenciaTable.desfecho, ["ACEITA", "RESOLVIDA"]),
        ),
      )
      .groupBy(fechamentoDivergenciaTable.apuracaoId),
  ]);

  const recebidos = new Map<string, Set<string>>();
  for (const d of documentos) {
    const tipos = recebidos.get(d.competenciaId) ?? new Set<string>();
    tipos.add(d.tipo);
    recebidos.set(d.competenciaId, tipos);
  }
  const apuracaoDa = new Map(apuracoes.map((a) => [a.competenciaId, a]));
  const questaoDa = new Map(questoes.map((q) => [q.apuracaoId, q]));

  return competencias.map((competencia) => {
    const tipos = recebidos.get(competencia.id);
    const apuracao = apuracaoDa.get(competencia.id);
    const questao = apuracao ? questaoDa.get(apuracao.id) : undefined;
    return {
      competencia,
      // Na ordem do catálogo, e não na de chegada: as cinco casinhas da linha
      // ficam sempre no mesmo lugar, e a que falta é reconhecida pela posição.
      relatorios: TIPOS_DE_FONTE.filter((tipo) => tipos?.has(tipo) ?? false),
      apuracao: apuracao
        ? {
            rodadaEm: apuracao.rodadaEm,
            emitido: Number(apuracao.totalEmitido),
            naoConferido: Number(apuracao.totalNaoConferido),
            diferenca: Number(apuracao.totalDiferenca),
            aQuestionar: Number(questao?.soma ?? 0),
            aQuestionarQuantidade: questao?.quantidade ?? 0,
          }
        : null,
    };
  });
}

/**
 * Encerra a competência — o ato de dizer "esta quinzena está fechada".
 *
 * **O que ele muda, já que tudo estava salvo.** Cada documento enviado e cada
 * apuração rodada já estão no banco desde que aconteceram: nada aqui é o
 * primeiro `INSERT` de coisa alguma. O que o encerramento acrescenta é o
 * *congelamento* — a partir dele o gatilho `fechamento_*_congelada` recusa
 * qualquer escrita nas tabelas da competência, e o número que se cobrou passa a
 * ser o número que se vai ler daqui a um ano. Salvar contínuo e fechar são
 * coisas diferentes, e só a segunda vale como prova.
 *
 * **Por que exige uma apuração vigente.** Encerrar sem ter apurado congelaria
 * uma competência que não sabe quanto vale: os documentos estariam lá e a conta
 * não. Não é um detalhe de validação — é a diferença entre um período fechado e
 * um período abandonado.
 */
export async function encerrarCompetencia(
  db: Database,
  competenciaId: string,
  por?: string | null,
): Promise<CompetenciaRegistrada> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento("COMPETENCIA_NAO_ENCONTRADA", "A competência informada não existe.");
  }
  if (competencia.estado === "ENCERRADA") {
    /*
      Encerrar de novo é um clique repetido, não um erro: devolve o estado que
      já vale, em vez de assustar quem só quis conferir se tinha salvo.
    */
    return competencia;
  }

  const apuracao = await lerApuracaoVigente(db, competenciaId);
  if (!apuracao) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_APURADA",
      `A competência ${competencia.chave} ainda não foi apurada. ` +
        `Encerrar sem apurar congelaria um período que não sabe quanto vale.`,
    );
  }

  const [linha] = await db
    .update(fechamentoCompetenciaTable)
    .set({
      estado: "ENCERRADA",
      encerradaEm: new Date(),
      encerradaPor: por ?? null,
      /*
        O motivo da reabertura anterior sai quando a competência fecha de novo:
        ele explica um período aberto, e um período fechado não tem o que
        explicar. Mantê-lo faria a tela mostrar, numa competência encerrada, a
        justificativa de uma reabertura que já foi resolvida.
      */
      motivoDaReabertura: null,
    })
    .where(eq(fechamentoCompetenciaTable.id, competenciaId))
    .returning();
  return comoRegistrada(linha);
}

/**
 * Reabre uma competência encerrada — com autor e motivo, sempre.
 *
 * O motivo é obrigatório e não tem valor-padrão. Uma competência encerrada é a
 * prova de uma cobrança; descongelá-la é uma decisão que alguém toma, e o
 * registro de quem tomou e por quê é a única coisa que separa uma correção
 * legítima de uma alteração silenciosa depois do fato.
 *
 * A competência volta para `APURADA` e não para `ABERTA`: a apuração que estava
 * lá continua valendo, e é justamente contra ela que se vai comparar o que
 * mudar daqui em diante.
 */
export async function reabrirCompetencia(
  db: Database,
  competenciaId: string,
  entrada: { motivo: string; por?: string | null },
): Promise<CompetenciaRegistrada> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento("COMPETENCIA_NAO_ENCONTRADA", "A competência informada não existe.");
  }
  if (competencia.estado !== "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ESTA_ENCERRADA",
      `A competência ${competencia.chave} não está encerrada — não há o que reabrir.`,
    );
  }
  const motivo = entrada.motivo.trim();
  if (motivo === "") {
    throw new RecusaDeFechamento(
      "MOTIVO_OBRIGATORIO",
      "Reabrir uma competência encerrada exige um motivo escrito: ele é o que " +
        "distingue uma correção de uma alteração silenciosa depois do fato.",
    );
  }

  const [linha] = await db
    .update(fechamentoCompetenciaTable)
    .set({
      estado: "APURADA",
      encerradaEm: null,
      encerradaPor: null,
      motivoDaReabertura: motivo,
    })
    .where(eq(fechamentoCompetenciaTable.id, competenciaId))
    .returning();
  return comoRegistrada(linha);
}


/** Uma unidade ou transportadora, como as competências a conhecem. */
export interface Parte {
  codigo: string;
  nome: string | null;
  /** Em quantas competências ela já apareceu — a lista sai ordenada por isto. */
  competencias: number;
}

/**
 * As unidades e transportadoras que já foram usadas.
 *
 * **Não há tabela de cadastro, e é decisão.** Uma unidade existe, para o
 * Fechamento, quando alguém abre uma competência com ela — antes disso é um
 * código que ninguém usou. Uma tabela própria criaria um segundo lugar onde o
 * nome de um CDD pode estar escrito, e o dia em que os dois divergissem
 * ninguém saberia qual vale. Aqui a lista é derivada: é literalmente o que as
 * competências dizem.
 *
 * O nome devolvido é o **mais recente** que aquele código recebeu. Corrigir a
 * grafia de um CDD passa a ser abrir a próxima competência escrevendo certo —
 * sem migração, sem tela de cadastro, e sem apagar como as anteriores foram
 * gravadas.
 */
export async function listarPartes(
  db: Database,
): Promise<{ unidades: Parte[]; transportadoras: Parte[] }> {
  const consultar = async (codigo: string, nome: string): Promise<Parte[]> => {
    const { rows } = await db.execute<{
      codigo: string;
      nome: string | null;
      competencias: string;
    }>(sql`
      select
        c.${sql.raw(codigo)} as codigo,
        (array_agg(c.${sql.raw(nome)} order by c.aberta_em desc)
           filter (where c.${sql.raw(nome)} is not null))[1] as nome,
        count(*)::text as competencias
      from fechamento_competencia c
      group by c.${sql.raw(codigo)}
      order by count(*) desc, c.${sql.raw(codigo)}
    `);
    return rows.map((r) => ({
      codigo: r.codigo,
      nome: r.nome,
      competencias: Number(r.competencias),
    }));
  };

  const [unidades, transportadoras] = await Promise.all([
    consultar("unidade_codigo", "unidade_nome"),
    consultar("transportadora_codigo", "transportadora_nome"),
  ]);
  return { unidades, transportadoras };
}
