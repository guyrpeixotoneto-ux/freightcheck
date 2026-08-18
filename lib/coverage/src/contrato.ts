import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { coverageExpectationTable, curationEventTable } from "@workspace/db";
import { PLANO_DA_DRE } from "@workspace/dre";
import { datasetFamilyFor } from "@workspace/ingest";
import {
  CATALOGO_DECLARADO,
  entraNaDRE,
  type AtributoDeclarado,
} from "@workspace/curation/catalogo-declarado";
import type { Criticidade } from "./modelo";

/**
 * O contrato — o que o sistema **sabe** que deveria existir.
 *
 * A pergunta que este arquivo responde é a mais perigosa do módulo: de onde sai
 * a lista do que é esperado, sem que ela seja "todas as colunas do último
 * arquivo"? Aquela regra ingênua tem duas falhas fatais e simétricas: um
 * arquivo que veio pela metade encolhe o universo esperado e a cobertura sobe,
 * e um arquivo que trouxe lixo o infla e ela desaba. Nos dois casos o número se
 * move sem que nada tenha mudado no negócio.
 *
 * **A saída não foi inventar um contrato: foi encontrar o que já era um.**
 * `lib/dre/src/plano.ts` declara, componente a componente, quais atributos
 * alimentam cada linha da DRE (`fontes`), se aquela linha é indispensável para
 * o subtotal fechar (`essencial`) e — o que decide a questão — a `evidencia`
 * medida que sustenta cada entrada. Nenhuma linha daquele arquivo foi deduzida
 * de nome de coluna; cada uma cita uma contagem sobre as nove vigências reais.
 * É um contrato com procedência, e já é o contrato que a DRE usa para se
 * recusar a fechar subtotal.
 *
 * Então a criticidade do módulo de cobertura não é uma segunda lista: é aquela
 * mesma. Um atributo é crítico aqui **se e somente se** ele alimenta um
 * componente essencial lá. Isso é o que impede a regra de criticidade de se
 * espalhar pela aplicação — não existe uma segunda cópia para divergir da
 * primeira, e mudar a DRE muda a cobertura crítica no mesmo commit.
 *
 * O que este arquivo faz, além de ler o plano, é semear e reler
 * `coverage_expectation`, que guarda a mesma coisa em forma consultável mais as
 * decisões humanas que a curadoria acrescentar.
 */

/** A família a que o contrato da DRE se aplica. */
export const FAMILIA_DA_DRE = "REMUNERACAO_EQUIPAMENTO";

/**
 * A data a partir da qual o contrato vale.
 *
 * Anterior a toda vigência que este produto já viu. Não é "desde sempre" por
 * preguiça: uma expectativa precisa de janela, e a janela do contrato começa
 * antes do primeiro dado justamente porque ele descreve o que o export sempre
 * deveria ter trazido — inclusive nas vigências que já passaram.
 */
export const CONTRATO_DESDE = "1900-01-01";

export interface EsperadoDeclarado {
  attributeCode: string;
  entityType: string;
  datasetFamily: string;
  canal: string | null;
  scopeKey: string | null;
  criticidade: Criticidade;
  status: "CONFIRMADO" | "DISPENSADO";
  origem: "CONTRATO" | "CATALOGO" | "CURADORIA";
  efetivoDe: string;
  efetivoAte: string | null;
  sucessor: string | null;
  motivo: string;
  evidencia: Record<string, unknown>;
  ator: string;
}

/**
 * O contrato como ele está escrito no plano da DRE, sem tocar no banco.
 *
 * Puro de propósito: o teste que prova "atributo crítico ausente derruba a
 * cobertura crítica" não precisa de export nem de promoção para exercitar esta
 * lista.
 */
export function contratoDaDRE(): EsperadoDeclarado[] {
  const porAtributo = new Map<string, { entityType: string; essencial: boolean; linhas: string[] }>();

  for (const componente of PLANO_DA_DRE) {
    for (const fonte of componente.fontes) {
      const chave = fonte.attributeCode;
      const atual = porAtributo.get(chave);
      if (atual) {
        /*
          Um atributo que alimenta duas linhas é crítico se **alguma** delas for
          essencial. O contrário — exigir que todas sejam — deixaria de fora
          `carreta.custo_fixo`, que alimenta a receita do conjunto (essencial) e
          a ponte de aquisição (não), e é a maior parcela de dinheiro do export.
        */
        atual.essencial = atual.essencial || componente.essencial;
        atual.linhas.push(componente.titulo);
        continue;
      }
      porAtributo.set(chave, {
        entityType: fonte.entityType,
        essencial: componente.essencial,
        linhas: [componente.titulo],
      });
    }
  }

  return [...porAtributo.entries()]
    .map(([attributeCode, info]) => ({
      attributeCode,
      entityType: info.entityType,
      datasetFamily: FAMILIA_DA_DRE,
      canal: null,
      scopeKey: null,
      criticidade: (info.essencial ? "CRITICO" : "RELEVANTE") as Criticidade,
      status: "CONFIRMADO" as const,
      origem: "CONTRATO" as const,
      efetivoDe: CONTRATO_DESDE,
      efetivoAte: null,
      sucessor: null,
      motivo: info.essencial
        ? `Esperado por contrato: alimenta ${info.linhas.join(", ")} na DRE, e essa linha é essencial — sem ela o subtotal da seção não fecha.`
        : `Esperado por contrato: alimenta ${info.linhas.join(", ")} na DRE.`,
      evidencia: { componentes: info.linhas, essencial: info.essencial },
      ator: "contrato:dre",
    }))
    .sort((a, b) => a.attributeCode.localeCompare(b.attributeCode));
}

/**
 * O universo declarado inteiro: o catálogo, com o contrato da DRE por cima.
 *
 * ---------------------------------------------------------------------------
 * Por que uma lista só, e não duas semeaduras
 * ---------------------------------------------------------------------------
 * O catálogo e o contrato falam dos mesmos atributos em 10 pontos — todo código
 * que o plano da DRE cita também está declarado nas planilhas. Semear os dois
 * em sequência deixaria o resultado na mão do `ON CONFLICT DO NOTHING`: quem
 * inserisse primeiro definiria a origem, a criticidade e o motivo daquelas 10
 * linhas, e a ordem de duas chamadas viraria uma decisão de produto invisível.
 *
 * Então a fusão acontece aqui, em memória, com a regra escrita: **onde o
 * contrato fala, o contrato vale.** Ele é a declaração mais forte que existe —
 * cita a linha da DRE que o atributo alimenta, diz se aquela linha é essencial
 * e carrega a contagem medida que sustenta a citação. O catálogo cobre o resto,
 * que é a maior parte: os atributos que a fonte deveria mandar e sobre os quais
 * a DRE ainda não tem nada a dizer.
 *
 * ---------------------------------------------------------------------------
 * A criticidade continua tendo um dono só
 * ---------------------------------------------------------------------------
 * Nada aqui inventa um atributo crítico. `CRITICO` sai exclusivamente de
 * `contratoDaDRE()`, pela regra que já existia: alimenta um componente
 * `essencial`. O catálogo escolhe apenas entre os outros dois, e por uma
 * pergunta que a própria planilha responde na coluna de seção:
 *
 * - entra na DRE     → `RELEVANTE`. Falta dinheiro quando ele falta.
 * - cadastral        → `INFORMATIVO`. Placa, CNPJ, vigência, modelo. A ausência
 *   é lacuna de verdade e aparece na lista, mas não derruba a cobertura
 *   crítica, que é o número que decide se a análise financeira pode rodar.
 *
 * Isto é o que impede a mudança de inflar o alarme: o universo esperado cresce
 * de 10 para 250 atributos, e o conjunto crítico não cresce nem um.
 *
 * ---------------------------------------------------------------------------
 * O que fica de fora da fusão
 * ---------------------------------------------------------------------------
 * Um atributo citado pelo plano da DRE que **não** esteja no catálogo entra
 * mesmo assim, no fim. Não deveria existir — há um teste que prova a inclusão
 * nos dois sentidos —, mas descartá-lo em silêncio encolheria o universo
 * esperado, e encolher o universo é como a cobertura sobe sem que nada tenha
 * melhorado. Se um dia aparecer, aparece como expectativa, não como omissão.
 */
export function universoDeclarado(): EsperadoDeclarado[] {
  const doContrato = new Map(contratoDaDRE().map((e) => [e.attributeCode, e]));
  const linhas: EsperadoDeclarado[] = [];
  const vistos = new Set<string>();

  for (const atributo of CATALOGO_DECLARADO) {
    vistos.add(atributo.code);
    const contrato = doContrato.get(atributo.code);
    if (contrato) {
      linhas.push(contrato);
      continue;
    }
    linhas.push(declaradoDoCatalogo(atributo));
  }

  for (const [code, contrato] of doContrato) {
    if (!vistos.has(code)) linhas.push(contrato);
  }

  return linhas.sort((a, b) => a.attributeCode.localeCompare(b.attributeCode));
}

/** Uma linha do catálogo virando expectativa. */
function declaradoDoCatalogo(atributo: AtributoDeclarado): EsperadoDeclarado {
  const naDRE = entraNaDRE(atributo);
  return {
    attributeCode: atributo.code,
    entityType: atributo.entityType,
    datasetFamily: datasetFamilyFor(atributo.entityType),
    canal: null,
    scopeKey: null,
    criticidade: naDRE ? "RELEVANTE" : "INFORMATIVO",
    status: "CONFIRMADO",
    origem: "CATALOGO",
    efetivoDe: CONTRATO_DESDE,
    efetivoAte: null,
    sucessor: null,
    motivo: naDRE
      ? `Esperado por catálogo: a planilha de atributos declara "${atributo.sourceName}" ` +
        `para ${atributo.entityType.toLowerCase()}, em ${atributo.secaoDaDRE} › ${atributo.categoriaDaDRE}.`
      : `Esperado por catálogo: a planilha de atributos declara "${atributo.sourceName}" ` +
        `para ${atributo.entityType.toLowerCase()}. É dado cadastral — não alimenta a DRE, ` +
        `e por isso a ausência não derruba a cobertura crítica.`,
    evidencia: {
      sourceName: atributo.sourceName,
      nomeGerencial: atributo.nomeGerencial,
      secaoDaDRE: atributo.secaoDaDRE,
      categoriaDaDRE: atributo.categoriaDaDRE,
      entraNaDRE: naDRE,
    },
    ator: "catalogo:curadoria",
  };
}

/**
 * Grava o universo declarado em `coverage_expectation`, sem sobrescrever curadoria.
 *
 * Idempotente e não destrutivo: `ON CONFLICT DO NOTHING`. Uma decisão humana
 * sobre o mesmo atributo tem outra `origin` e não colide; se colidisse, o
 * contrato não a apagaria — reescrever por cima do que uma pessoa decidiu é o
 * remapeamento silencioso que este produto existe para não fazer.
 *
 * **O nome ficou.** Ela semeava só o plano da DRE e passou a semear o universo
 * inteiro (`universoDeclarado`), mas continua sendo a mesma coisa do ponto de
 * vista de quem a chama: *o esperado que não depende de ninguém ter clicado*.
 * Renomeá-la obrigaria a mexer na rota, na CLI e no fim da importação sem que
 * nenhum dos três passasse a fazer algo diferente.
 *
 * Chamado na partida do servidor, ao lado de `seedTaxonomy`.
 */
export async function semearContrato(db: Database): Promise<{ inseridos: number }> {
  const linhas = universoDeclarado();
  if (linhas.length === 0) return { inseridos: 0 };

  const resultado = await db
    .insert(coverageExpectationTable)
    .values(
      linhas.map((l) => ({
        datasetFamily: l.datasetFamily,
        canal: l.canal,
        scopeKey: l.scopeKey,
        entityType: l.entityType,
        attributeCode: l.attributeCode,
        origin: l.origem,
        status: l.status,
        criticality: l.criticidade,
        effectiveFrom: l.efetivoDe,
        effectiveUntil: l.efetivoAte,
        rationale: l.motivo,
        evidence: l.evidencia,
        actor: l.ator,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: coverageExpectationTable.id });

  return { inseridos: resultado.length };
}

/**
 * As expectativas declaradas que valem numa vigência.
 *
 * `canal` e `scopeKey` nulos querem dizer "qualquer", então o predicado é
 * `IS NULL OR = valor` — e não uma igualdade, que descartaria justamente as
 * expectativas de família inteira, que são a maioria.
 */
export async function esperadoDeclarado(
  db: Database,
  recorte: {
    datasetFamily: string;
    canal?: string | null;
    scopeKey?: string | null;
    effectiveDate: string;
  },
): Promise<EsperadoDeclarado[]> {
  const linhas = await db
    .select()
    .from(coverageExpectationTable)
    .where(
      and(
        eq(coverageExpectationTable.datasetFamily, recorte.datasetFamily),
        or(
          isNull(coverageExpectationTable.canal),
          eq(coverageExpectationTable.canal, recorte.canal ?? ""),
        ),
        or(
          isNull(coverageExpectationTable.scopeKey),
          eq(coverageExpectationTable.scopeKey, recorte.scopeKey ?? ""),
        ),
        sql`${coverageExpectationTable.effectiveFrom} <= ${recorte.effectiveDate}::date`,
        or(
          isNull(coverageExpectationTable.effectiveUntil),
          sql`${coverageExpectationTable.effectiveUntil} > ${recorte.effectiveDate}::date`,
        ),
      ),
    );

  return linhas.map((l) => ({
    attributeCode: l.attributeCode,
    entityType: l.entityType,
    datasetFamily: l.datasetFamily,
    canal: l.canal,
    scopeKey: l.scopeKey,
    criticidade: l.criticality as Criticidade,
    status: l.status as "CONFIRMADO" | "DISPENSADO",
    origem: l.origin as "CONTRATO" | "CATALOGO" | "CURADORIA",
    efetivoDe: l.effectiveFrom,
    efetivoAte: l.effectiveUntil,
    sucessor: l.succeededByAttributeCode,
    motivo: l.rationale,
    evidencia: (l.evidence ?? {}) as Record<string, unknown>,
    ator: l.actor,
  }));
}

/** Erro de recusa de uma decisão de curadoria. A rota traduz em 422. */
export class DecisaoRecusada extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisaoRecusada";
  }
}

export interface DecisaoDeCobertura {
  datasetFamily: string;
  canal?: string | null;
  scopeKey?: string | null;
  entityType: string;
  attributeCode: string;
  /**
   * CONFIRMADO — promove uma expectativa inferida a esperada de verdade.
   * DISPENSADO — declara que a ausência é legítima aqui.
   */
  status: "CONFIRMADO" | "DISPENSADO";
  criticidade?: Criticidade;
  efetivoDe: string;
  efetivoAte?: string | null;
  /** O atributo que sucede este, quando a decisão é aceitar uma renomeação. */
  sucessor?: string | null;
  motivo: string;
  evidencia?: Record<string, unknown>;
  ator: string;
}

/**
 * Registra uma decisão humana sobre cobertura.
 *
 * Duas escritas, sempre as duas: a linha em `coverage_expectation`, que muda o
 * que a cobertura passa a considerar, e o evento em `curation_event`, que é
 * onde o produto guarda "quem mudou o quê e por quê" para todas as outras
 * decisões de curadoria. Uma decisão que só aparecesse na primeira seria
 * invisível no histórico de decisões; uma que só aparecesse na segunda não
 * mudaria número nenhum.
 *
 * A recusa por motivo vazio é explícita e vem antes de qualquer escrita: o
 * CHECK do banco também a pega, mas uma mensagem escrita para quem opera é
 * melhor do que um erro de constraint.
 */
export async function registrarDecisao(
  db: Database,
  decisao: DecisaoDeCobertura,
): Promise<void> {
  if (!decisao.motivo?.trim()) {
    throw new DecisaoRecusada(
      "Decidir sobre uma lacuna exige uma justificativa escrita: ela é o que a próxima pessoa vai ler para entender por que o número mudou.",
    );
  }
  if (!decisao.ator?.trim()) {
    throw new DecisaoRecusada("Uma decisão sem responsável não é auditável.");
  }
  if (decisao.sucessor && !decisao.efetivoAte) {
    throw new DecisaoRecusada(
      "Aceitar uma renomeação exige dizer a partir de quando o nome antigo deixou de ser esperado. Sem essa data, a lacuna do nome antigo continuaria contando junto com o novo.",
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(coverageExpectationTable)
      .values({
        datasetFamily: decisao.datasetFamily,
        canal: decisao.canal ?? null,
        scopeKey: decisao.scopeKey ?? null,
        entityType: decisao.entityType,
        attributeCode: decisao.attributeCode,
        origin: "CURADORIA",
        status: decisao.status,
        criticality: decisao.criticidade ?? "RELEVANTE",
        effectiveFrom: decisao.efetivoDe,
        effectiveUntil: decisao.efetivoAte ?? null,
        succeededByAttributeCode: decisao.sucessor ?? null,
        rationale: decisao.motivo,
        evidence: decisao.evidencia ?? {},
        actor: decisao.ator,
      })
      .onConflictDoUpdate({
        target: [
          coverageExpectationTable.sourceSystem,
          coverageExpectationTable.datasetFamily,
          coverageExpectationTable.canal,
          coverageExpectationTable.scopeKey,
          coverageExpectationTable.entityType,
          coverageExpectationTable.attributeCode,
          coverageExpectationTable.effectiveFrom,
        ],
        set: {
          status: decisao.status,
          criticality: decisao.criticidade ?? "RELEVANTE",
          effectiveUntil: decisao.efetivoAte ?? null,
          succeededByAttributeCode: decisao.sucessor ?? null,
          rationale: decisao.motivo,
          evidence: decisao.evidencia ?? {},
          actor: decisao.ator,
          origin: "CURADORIA",
        },
      });

    await tx.insert(curationEventTable).values({
      changeCategory: "CURATION_CHANGE",
      targetKind: "COVERAGE_EXPECTATION",
      /*
        `target_id` é uuid e a identidade desta decisão é composta. Usa-se um
        uuid derivado do recorte, estável, para que duas decisões sobre o mesmo
        atributo apareçam agrupadas na busca por alvo — é o que a coluna serve
        para fazer aqui.
      */
      targetId: sql`md5(${`${decisao.datasetFamily}|${decisao.entityType}|${decisao.attributeCode}`})::uuid`,
      targetLabel: decisao.attributeCode,
      field: "coverage_status",
      valueBefore: null,
      valueAfter: decisao.status,
      actor: decisao.ator,
      reason: decisao.motivo,
      detail: {
        datasetFamily: decisao.datasetFamily,
        canal: decisao.canal ?? null,
        scopeKey: decisao.scopeKey ?? null,
        entityType: decisao.entityType,
        efetivoDe: decisao.efetivoDe,
        efetivoAte: decisao.efetivoAte ?? null,
        sucessor: decisao.sucessor ?? null,
        criticidade: decisao.criticidade ?? "RELEVANTE",
      },
    });
  });
}
