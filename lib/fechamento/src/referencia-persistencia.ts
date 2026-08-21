import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  fechamentoReferenciaConteudoTable,
  fechamentoReferenciaLinhaTable,
  fechamentoReferenciaTable,
} from "@workspace/db";

import { lerReferenciaDaPlanilha } from "./referencia";

/**
 * A GUARDA DA RÉGUA — anexar, versionar e ler a planilha de conferência.
 *
 * **Arquivo separado de `persistencia.ts`, e isso não é organização — é a
 * trava.** Aquele módulo é onde o cálculo lê o que vai virar dinheiro:
 * competência, documentos, viagens, descontos, requisições. Este só sabe de um
 * arquivo anexado e dos números que ele publica. Nenhuma função daqui é
 * chamada de lá, e a única que atravessa a fronteira é
 * {@link referenciaAtivaDoMes} — que devolve números para a **tela**, depois de
 * o devido estar calculado, e não recebe nem devolve nada que o motor consuma.
 *
 * A separação física é o que torna a pergunta "isto pode contaminar a conta?"
 * respondível por leitura de imports, e não por confiança.
 *
 * ---------------------------------------------------------------------------
 * A regra de versão, e por que ela é explícita
 * ---------------------------------------------------------------------------
 *
 * Anexar de novo **não sobrescreve**. Cria a versão seguinte, desativa a
 * anterior e mantém as duas. Duas razões:
 *
 * - a diferença que alguém leu ontem foi medida contra um arquivo específico, e
 *   essa leitura tem de continuar reconstruível;
 * - com duas linhas ativas a tela escolheria em silêncio — e escolher em
 *   silêncio entre duas réguas é pior do que não ter régua. O índice parcial
 *   `fechamento_referencia_ativa_unica` faz o banco recusar essa situação, de
 *   modo que ela não depende de esta função estar certa.
 */

/** O mês que uma referência endereça — a mesma quíntupla de `lerResumoDoMes`. */
export interface MesDaReferencia {
  unidade: string;
  transportadora: string;
  tipoDeOperacao: string;
  ano: number;
  mes: number;
}

/** Uma versão anexada, como a tela a lista. */
export interface VersaoDaReferencia {
  id: string;
  versao: number;
  ativa: boolean;
  nomeDoArquivo: string;
  sha256: string;
  tamanhoEmBytes: number;
  anexadaPor: string | null;
  anexadaEm: string;
}

/** A referência ativa e o que ela publica. */
export interface ReferenciaAtiva {
  procedencia: VersaoDaReferencia;
  /** `chave` → `{ primeira, segunda }`, já em centavos arredondados. */
  numeros: Record<string, { primeira: number | null; segunda: number | null }>;
  /** `chave` → `{ primeira, segunda }` com o endereço da célula de cada uma. */
  celulas: Record<string, { primeira: string | null; segunda: string | null }>;
}

/** O mesmo arquivo já está anexado a este mês — não é versão nova. */
export class ReferenciaJaAnexada extends Error {
  constructor(
    readonly sha256: string,
    readonly versao: number,
  ) {
    super(
      `Este arquivo já está anexado a este mês como versão ${versao}. ` +
        `Anexar o mesmo conteúdo de novo contaria uma troca que não houve.`,
    );
    this.name = "ReferenciaJaAnexada";
  }
}

function condicaoDoMes(mes: MesDaReferencia) {
  return and(
    eq(fechamentoReferenciaTable.unidadeCodigo, mes.unidade),
    eq(fechamentoReferenciaTable.transportadoraCodigo, mes.transportadora),
    eq(fechamentoReferenciaTable.tipoDeOperacao, mes.tipoDeOperacao),
    eq(fechamentoReferenciaTable.ano, mes.ano),
    eq(fechamentoReferenciaTable.mes, mes.mes),
  );
}

function comoVersao(linha: typeof fechamentoReferenciaTable.$inferSelect): VersaoDaReferencia {
  return {
    id: linha.id,
    versao: linha.versao,
    ativa: linha.ativa,
    nomeDoArquivo: linha.nomeDoArquivo,
    sha256: linha.sha256,
    tamanhoEmBytes: linha.tamanhoEmBytes,
    anexadaPor: linha.anexadaPor,
    anexadaEm: linha.anexadaEm.toISOString(),
  };
}

/**
 * Anexa uma planilha a um mês. Lê **antes** de gravar. Ver `referencia.ts`.
 *
 * **A ordem importa e é deliberada.** A leitura fail-closed acontece primeiro,
 * fora da transação de escrita: se o arquivo for recusado, nada foi gravado e
 * quem escolheu o arquivo recebe o endereço da célula que falhou enquanto ainda
 * está na tela de anexo. Recusar depois de gravar deixaria uma referência
 * pendurada sem números — uma terceira situação para a tela ter de saber
 * distinguir, e nenhuma necessidade de ela existir.
 *
 * **A associação é declarada, não inferida.** `mes` vem de quem anexou. Este
 * módulo não confere que o arquivo é daquele mês, e não tem como: o `.xlsb` não
 * declara unidade, CNPJ nem competência. O que ele grava no lugar é
 * procedência — `sha256`, nome, quem, quando —, que é o que a tela mostra ao
 * lado de toda diferença.
 */
export async function anexarReferencia(
  db: Database,
  entrada: {
    mes: MesDaReferencia;
    nomeDoArquivo: string;
    conteudo: Buffer;
    /** A unidade canônica do mês, se houver. Auditoria — nada a lê para casar. */
    unidadeId?: string | null;
    anexadaPor?: string | null;
  },
): Promise<VersaoDaReferencia> {
  /* Fail-closed primeiro: um arquivo recusado não deixa rastro no banco. */
  const lida = lerReferenciaDaPlanilha(entrada.conteudo);
  const sha256 = createHash("sha256").update(entrada.conteudo).digest("hex");

  return db.transaction(async (tx) => {
    const existentes = await tx
      .select()
      .from(fechamentoReferenciaTable)
      .where(condicaoDoMes(entrada.mes))
      .orderBy(desc(fechamentoReferenciaTable.versao));

    const repetida = existentes.find((r) => r.sha256 === sha256);
    if (repetida) throw new ReferenciaJaAnexada(sha256, repetida.versao);

    const versao = (existentes[0]?.versao ?? 0) + 1;

    /*
      Desativa **todas** as anteriores, e não só a que estava ativa: se o banco
      chegasse a ter duas ativas — o que o índice parcial impede —, um `UPDATE`
      mirado deixaria a outra de pé e a nova entraria em conflito. Desativar
      todas é a operação que dá o mesmo resultado em qualquer estado de partida.
    */
    if (existentes.length > 0) {
      await tx
        .update(fechamentoReferenciaTable)
        .set({ ativa: false })
        .where(condicaoDoMes(entrada.mes));
    }

    const [gravada] = await tx
      .insert(fechamentoReferenciaTable)
      .values({
        unidadeCodigo: entrada.mes.unidade,
        transportadoraCodigo: entrada.mes.transportadora,
        tipoDeOperacao: entrada.mes.tipoDeOperacao,
        ano: entrada.mes.ano,
        mes: entrada.mes.mes,
        unidadeId: entrada.unidadeId ?? null,
        nomeDoArquivo: entrada.nomeDoArquivo,
        sha256,
        tamanhoEmBytes: entrada.conteudo.byteLength,
        versao,
        ativa: true,
        anexadaPor: entrada.anexadaPor ?? null,
      })
      .returning();

    await tx.insert(fechamentoReferenciaConteudoTable).values({
      referenciaId: gravada!.id,
      conteudo: gzipSync(entrada.conteudo),
      bytesOriginais: entrada.conteudo.byteLength,
    });

    await tx.insert(fechamentoReferenciaLinhaTable).values(
      lida.numeros.map((n) => ({
        referenciaId: gravada!.id,
        quinzena: n.quinzena,
        chave: n.chave,
        celula: n.celula,
        valor: n.valor.toFixed(2),
      })),
    );

    return comoVersao(gravada!);
  });
}

/** Todas as versões anexadas a um mês, da mais nova para a mais velha. */
export async function listarReferenciasDoMes(
  db: Database,
  mes: MesDaReferencia,
): Promise<VersaoDaReferencia[]> {
  const linhas = await db
    .select()
    .from(fechamentoReferenciaTable)
    .where(condicaoDoMes(mes))
    .orderBy(desc(fechamentoReferenciaTable.versao));
  return linhas.map(comoVersao);
}

/**
 * Troca qual versão é a ativa, sem apagar nenhuma.
 *
 * Existe porque anexar por engano é comum e desfazer não pode custar o
 * histórico: voltar para a versão anterior é uma escolha, e a versão errada
 * continua listada com a data em que alguém a anexou.
 */
export async function ativarReferencia(db: Database, referenciaId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [alvo] = await tx
      .select()
      .from(fechamentoReferenciaTable)
      .where(eq(fechamentoReferenciaTable.id, referenciaId))
      .limit(1);
    if (!alvo) throw new Error(`Não existe referência ${referenciaId}.`);

    await tx
      .update(fechamentoReferenciaTable)
      .set({ ativa: false })
      .where(
        condicaoDoMes({
          unidade: alvo.unidadeCodigo,
          transportadora: alvo.transportadoraCodigo,
          tipoDeOperacao: alvo.tipoDeOperacao,
          ano: alvo.ano,
          mes: alvo.mes,
        }),
      );
    await tx
      .update(fechamentoReferenciaTable)
      .set({ ativa: true })
      .where(eq(fechamentoReferenciaTable.id, referenciaId));
  });
}

/**
 * A referência ativa do mês e o que ela publica — ou `null` se ninguém anexou.
 *
 * **Uma referência, duas quinzenas.** Os números vêm indexados por chave com as
 * duas colunas lado a lado, que é a forma que a tela consome. É aqui que a
 * decisão de a referência ser mensal se paga: um arquivo, uma leitura, as duas
 * colunas — sem o risco de a 1ª quinzena sair de um arquivo e a 2ª de outro.
 *
 * **Não lê os bytes.** O `.xlsb` guardado é evidência para quem quiser reabrir;
 * os números saem de `fechamento_referencia_linha`, onde entraram já conferidos
 * pela porta fail-closed. Reler o arquivo aqui traria a possibilidade de recusa
 * para dentro da abertura do Resumo, que é o lugar errado para ela acontecer.
 */
export async function referenciaAtivaDoMes(
  db: Database,
  mes: MesDaReferencia,
): Promise<ReferenciaAtiva | null> {
  const [ativa] = await db
    .select()
    .from(fechamentoReferenciaTable)
    .where(and(condicaoDoMes(mes), eq(fechamentoReferenciaTable.ativa, true)))
    .limit(1);
  if (!ativa) return null;

  const linhas = await db
    .select()
    .from(fechamentoReferenciaLinhaTable)
    .where(eq(fechamentoReferenciaLinhaTable.referenciaId, ativa.id));

  const numeros: ReferenciaAtiva["numeros"] = {};
  const celulas: ReferenciaAtiva["celulas"] = {};
  for (const linha of linhas) {
    const onde = linha.quinzena === 1 ? "primeira" : "segunda";
    numeros[linha.chave] ??= { primeira: null, segunda: null };
    celulas[linha.chave] ??= { primeira: null, segunda: null };
    numeros[linha.chave]![onde] = Number(linha.valor);
    celulas[linha.chave]![onde] = linha.celula;
  }

  return { procedencia: comoVersao(ativa), numeros, celulas };
}

/**
 * O `.xlsb` como ele chegou — a evidência, para quem for reabrir o arquivo.
 *
 * Confere tamanho e `sha256` na volta pela mesma razão de
 * `lerConteudoDoDocumento`: quem baixa a evidência precisa saber que recuperou
 * exatamente o que entrou, e não uma aproximação.
 */
export async function lerConteudoDaReferencia(
  db: Database,
  referenciaId: string,
): Promise<{ conteudo: Buffer; nomeDoArquivo: string } | null> {
  const linhas = await db
    .select({
      conteudo: fechamentoReferenciaConteudoTable.conteudo,
      bytesOriginais: fechamentoReferenciaConteudoTable.bytesOriginais,
      nomeDoArquivo: fechamentoReferenciaTable.nomeDoArquivo,
      sha256: fechamentoReferenciaTable.sha256,
    })
    .from(fechamentoReferenciaConteudoTable)
    .innerJoin(
      fechamentoReferenciaTable,
      eq(fechamentoReferenciaTable.id, fechamentoReferenciaConteudoTable.referenciaId),
    )
    .where(eq(fechamentoReferenciaConteudoTable.referenciaId, referenciaId))
    .limit(1);

  const linha = linhas[0];
  if (!linha) return null;

  const conteudo = gunzipSync(linha.conteudo);
  if (conteudo.byteLength !== linha.bytesOriginais) {
    throw new Error(
      `A referência "${linha.nomeDoArquivo}" voltou com ${conteudo.byteLength} bytes ` +
        `e foi guardada com ${linha.bytesOriginais}.`,
    );
  }
  const sha = createHash("sha256").update(conteudo).digest("hex");
  if (sha !== linha.sha256) {
    throw new Error(`A referência "${linha.nomeDoArquivo}" não confere com o sha256 do envio.`);
  }
  return { conteudo, nomeDoArquivo: linha.nomeDoArquivo };
}

/* `sql` fica importado para o dia em que a listagem precisar de agregação. */
void sql;
