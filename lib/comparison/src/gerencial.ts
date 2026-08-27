import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  channelSql,
  datasetFamilyFilter,
  listContexts,
  operacaoFilter,
  type ContextInfo,
  type Operacao,
} from "./series";

/**
 * A leitura da Visão Gerencial da Auditoria — **uma linha por vigência viva,
 * com a comparação que ela produziu**.
 *
 * A tela que lê daqui responde a pergunta de quem responde pela auditoria, e
 * não a de quem a executa: *quanto do que chegou já foi comparado, em quais
 * unidades, e onde está o que ninguém olhou.* É a irmã da Visão Gerencial do
 * Fechamento, e nasceu pela mesma razão — o produto tinha o retrato de **uma**
 * unidade numa vigência (o Resumo executivo) e nenhum retrato do conjunto.
 *
 * Três decisões moram nesta função, e as três são sobre não mentir:
 *
 * 1. **Nada é calculado aqui, e nada é calculado por causa daqui.** A resposta
 *    é o que `change_set` gravou quando a comparação rodou. Abrir uma tela não
 *    pode disparar o motor — é a mesma recusa de `/changes/grouped`, e aqui ela
 *    pesa mais: a tela lê **todas** as unidades de uma vez, e garantir as
 *    comparações de todas elas faria a home cobrar de quem a abre o trabalho do
 *    banco inteiro. A consequência é justamente o que a tela existe para
 *    mostrar: a vigência que chegou e nunca foi comparada aparece como buraco,
 *    em vez de ser tapada em silêncio. Ver `garantia.ts` para o outro lado
 *    dessa moeda — lá, quem *pergunta sobre um recorte* paga para que a
 *    resposta exista.
 * 2. **Só a transição canônica conta.** A comparação de uma vigência é a que a
 *    põe contra a **imediatamente anterior da mesma série** — mesma origem,
 *    mesmo escopo, mesma cobertura, mesmo canal, que é a definição de
 *    `findPreviousSnapshot`. A tela Comparar grava comparações de pares
 *    arbitrários (abril contra agosto), e elas existem na mesma tabela com o
 *    mesmo `snapshot_b`: apanhá-las por `snapshot_b_id` somaria oito meses de
 *    movimento ao total de um mês. O `LEFT JOIN` exige as duas pontas.
 * 3. **Vigência sem anterior não é vigência sem comparar.** A primeira de cada
 *    série não tem com que ser comparada, e contá-la como pendência faria toda
 *    unidade estrear reprovada. Ela vem marcada (`anterior === null`) para que
 *    a tela a conte à parte.
 *
 * **Por que uma leitura só, em vez de a tela perguntar por unidade.** A
 * alternativa seria a tela chamar `/changes/grouped` uma vez por contexto e
 * montar o quadro no navegador: N+1 idas ao banco numa tela que existe
 * justamente para olhar todas de uma vez. Aqui são três consultas de tamanho
 * fixo, e o custo não cresce com o número de unidades. É a mesma escolha de
 * `listarApuracoes` no Fechamento, e pela mesma razão.
 */

export interface ComparacaoDaVigencia {
  id: string;
  /** `DONE` é o que se pode ler. `PENDING`/`STALE` a tela mostra como pendente. */
  status: string;
  /** Quantos valores mudaram entre as duas vigências. */
  alteracoes: number;
  entrantes: number;
  saintes: number;
  /**
   * As alterações que não puderam ser comparadas com confiança.
   *
   * É o ponto cego da auditoria, e por isso vem separado da contagem: uma
   * comparação com 200 alterações e 40 inconclusivas não é uma comparação com
   * 240 alterações.
   */
  inconclusivas: number;
  /** Alterações reais cujo impacto o motor não consegue apurar. Nunca zero. */
  semPreco: number;
  /** Quantas alterações ficaram fora da soma por dupla contagem. Contagem, não dinheiro. */
  foraDoTotal: number;
  /**
   * O impacto **oficial** por periodicidade — o dinheiro contado uma vez só.
   *
   * Nunca um escalar: R$/mês e R$/ano não se somam. Ver
   * `impacto_oficial_by_periodicity` em `schema/comparison.ts`.
   */
  impacto: Record<string, number>;
}

export interface VigenciaDaAuditoria {
  /** O contexto a que ela pertence — unidade e canal, como o resto do produto os nomeia. */
  contexto: {
    scopeHash: string;
    channel: string | null;
    /** "CAMAÇARI · EMPURRADA" — o rótulo que `listContexts` monta, e não outro. */
    label: string;
    scopes: ContextInfo["scopes"];
  };
  snapshotId: string;
  /** `EMPURRADA_1_8_2026` — o identificador da fonte, como veio. */
  sourceLabel: string;
  /** `AAAA-MM-DD`. */
  effectiveDate: string;
  entityTypeSet: string;
  /** Quantos ativos a vigência trouxe. */
  ativos: number;
  /** A vigência anterior da mesma série. Nula na primeira — ver a decisão 3 acima. */
  anterior: { snapshotId: string; sourceLabel: string; effectiveDate: string } | null;
  /** Nula quando o par canônico nunca foi comparado. Nula não é zero. */
  comparacao: ComparacaoDaVigencia | null;
}

interface LinhaDaConsulta extends Record<string, unknown> {
  snapshot_id: string;
  scope_hash: string;
  channel: string | null;
  source_label: string;
  effective_date: string;
  entity_type_set: string;
  entity_count: number;
  anterior_id: string | null;
  anterior_label: string | null;
  anterior_em: string | null;
  comparacao_id: string | null;
  status: string | null;
  value_changes: number | null;
  entities_added: number | null;
  entities_removed: number | null;
  inconclusive: number | null;
  impact_not_calculable: number | null;
  mudancas_fora_do_total: number | null;
  impacto_oficial: Record<string, number> | null;
}

/** O dinheiro como número, venha ele do jsonb como número ou como texto. */
function impactoEmNumeros(bruto: Record<string, unknown> | null): Record<string, number> {
  if (!bruto) return {};
  const saida: Record<string, number> = {};
  for (const [periodicidade, valor] of Object.entries(bruto)) {
    const numero = Number(valor);
    if (Number.isFinite(numero)) saida[periodicidade] = numero;
  }
  return saida;
}

/**
 * Toda vigência viva, da mais recente para a mais antiga, com a comparação que
 * a explica.
 *
 * A ordem é determinística até o último critério de desempate — data, unidade,
 * canal, cobertura. Deixá-la por conta do Postgres é como o Painel antigo passou
 * a exibir a série de menor impacto e a omitir a maior, sem dizer que omitia.
 *
 * **De uma família por vez.** Esta é a leitura que percorre todos os contextos
 * de uma vez, e por isso é a que não passa pelo `contextFilter` — que é onde a
 * família do dataset entrou. Sem a cláusula aqui, as quinzenas do quadro de
 * pessoal entravam no cartão da unidade de equipamento: a mesma unidade, o
 * mesmo canal, portanto a mesma chave de contexto, e o cartão passava a contar
 * uma série de cargos entre as vigências de placas. A conta que a tela publica
 * ("8 de 15 vigências comparadas") somava dois assuntos, e as sete do quadro
 * apareciam como trabalho de auditoria atrasado que ninguém tinha para fazer.
 */
export async function listarVigenciasDaAuditoria(
  db: Database,
  /** Qual família ler (`snapshot.dataset_family`). Padrão: equipamento. */
  opts?: { datasetFamily?: string; operacao?: Operacao | null },
): Promise<VigenciaDaAuditoria[]> {
  const contextos = await listContexts(db, opts);
  if (contextos.length === 0) return [];

  const { rows } = await db.execute<LinhaDaConsulta>(sql`
    WITH vivas AS (
      SELECT s.id,
             s.source_system,
             s.scope_hash,
             ${channelSql("s.source_label")} AS channel,
             s.source_label,
             s.effective_date,
             s.entity_type_set,
             s.entity_count
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
         AND ${datasetFamilyFilter("s", opts?.datasetFamily)}
         -- A operação da auditoria aberta. A Visão Gerencial é a tela que soma
         -- **todas** as unidades de uma vez, e sem este recorte ela é o lugar
         -- mais fácil de a empurrada entrar num cartão de rota: o cartão da
         -- unidade contaria as duas séries como uma, e o total do ano seria a
         -- soma de dois contratos diferentes.
         AND ${operacaoFilter("s", opts?.operacao)}
         -- Trecho só aparece no Trecho 360. A Visão Gerencial soma vigências e
         -- alterações por unidade a partir daqui — sem este filtro, a série de
         -- trecho de uma unidade virava mais uma "vigência" no cartão dela,
         -- inflando a contagem e os totais de alterações/impacto que o cartão
         -- publica.
         AND s.entity_type_set IS DISTINCT FROM 'TRECHO'
    ),
    /*
      A anterior da série, pela mesma definição de findPreviousSnapshot: mesma
      origem, mesmo escopo, mesma cobertura, mesmo canal. PARTITION BY trata
      NULL como um grupo, que é o que o IS NOT DISTINCT FROM de lá faz com o
      canal ilegível — as vigências sem canal no rótulo formam uma série entre
      si, e não uma série cada.

      (Sem crase nos comentários daqui para baixo: isto é um template literal, e
      uma crase no meio dele fecharia a consulta na cara do compilador.)
    */
    com_anterior AS (
      SELECT v.*,
             lag(v.id)             OVER serie AS anterior_id,
             lag(v.source_label)   OVER serie AS anterior_label,
             lag(v.effective_date) OVER serie AS anterior_em
        FROM vivas v
      WINDOW serie AS (
        PARTITION BY v.source_system, v.scope_hash, v.entity_type_set, v.channel
            ORDER BY v.effective_date, v.id
      )
    )
    SELECT ca.id::text                     AS snapshot_id,
           ca.scope_hash,
           ca.channel,
           ca.source_label,
           ca.effective_date::text         AS effective_date,
           ca.entity_type_set,
           ca.entity_count::int            AS entity_count,
           ca.anterior_id::text            AS anterior_id,
           ca.anterior_label,
           ca.anterior_em::text            AS anterior_em,
           cs.id::text                     AS comparacao_id,
           cs.status,
           cs.value_changes,
           cs.entities_added,
           cs.entities_removed,
           cs.inconclusive,
           cs.impact_not_calculable,
           cs.mudancas_fora_do_total,
           cs.impacto_oficial_by_periodicity AS impacto_oficial
      FROM com_anterior ca
      /*
        As duas pontas no ON, e não só snapshot_b_id: é o que deixa de fora a
        comparação avulsa que a tela Comparar gravou entre duas vigências que
        não se sucedem. Ver a decisão 2 no cabeçalho.
      */
      LEFT JOIN change_set cs
             ON cs.snapshot_b_id = ca.id
            AND cs.snapshot_a_id = ca.anterior_id
     ORDER BY ca.effective_date DESC,
              ca.scope_hash,
              ca.channel NULLS LAST,
              ca.entity_type_set
  `);

  const chave = (scopeHash: string, channel: string | null) => `${scopeHash}|${channel ?? ""}`;
  const contextoDe = new Map(contextos.map((c) => [chave(c.scopeHash, c.channel), c]));

  return rows.map((linha) => {
    const contexto = contextoDe.get(chave(linha.scope_hash, linha.channel));
    return {
      contexto: {
        scopeHash: linha.scope_hash,
        channel: linha.channel,
        /*
          O rótulo vem de `listContexts`, e não de uma segunda regra escrita
          aqui: a Visão Gerencial precisa nomear a unidade exatamente como o
          seletor de contexto a nomeia, e duas grafias do mesmo lugar fariam
          parecer que o recorte mudou no caminho.
        */
        label: contexto?.label ?? linha.scope_hash,
        scopes: contexto?.scopes ?? [],
      },
      snapshotId: linha.snapshot_id,
      sourceLabel: linha.source_label,
      effectiveDate: linha.effective_date,
      entityTypeSet: linha.entity_type_set,
      ativos: Number(linha.entity_count ?? 0),
      anterior:
        linha.anterior_id === null
          ? null
          : {
              snapshotId: linha.anterior_id,
              sourceLabel: linha.anterior_label ?? "",
              effectiveDate: linha.anterior_em ?? "",
            },
      comparacao:
        linha.comparacao_id === null
          ? null
          : {
              id: linha.comparacao_id,
              status: linha.status ?? "PENDING",
              alteracoes: Number(linha.value_changes ?? 0),
              entrantes: Number(linha.entities_added ?? 0),
              saintes: Number(linha.entities_removed ?? 0),
              inconclusivas: Number(linha.inconclusive ?? 0),
              semPreco: Number(linha.impact_not_calculable ?? 0),
              foraDoTotal: Number(linha.mudancas_fora_do_total ?? 0),
              impacto: impactoEmNumeros(linha.impacto_oficial),
            },
    };
  });
}
