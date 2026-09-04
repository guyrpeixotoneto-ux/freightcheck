import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * Normalizar o Nome Gerencial que a promoção antiga escreveu — com o banco à
 * vista, e não no escuro de um deploy.
 *
 * A promoção criava todo atributo com `display_name = source_name`. O campo
 * abria preenchido com a resposta errada, e "tem nome gerencial escrito" —
 * hoje um dos sinais de que alguém curou a coluna, e portanto de que ela não
 * pode ser apagada por uma exclusão de importação — valia para todas e não
 * distinguia nada. O `promote` já não faz isso; o que sobra é o legado.
 *
 * ---------------------------------------------------------------------------
 * Por que uma rotina, e não uma migration
 * ---------------------------------------------------------------------------
 *
 * Limpar o legado exige distinguir a cópia que a máquina escreveu de um nome
 * que uma pessoa salvou à mão — e que pode, por coincidência banal, ser
 * idêntico ao nome de origem. Pelo valor, as duas linhas são iguais.
 *
 * O que as separaria é o rastro: `saveMeaning` é o único caminho de escrita
 * humana em `display_name` e grava um `curation_event` com
 * `field = 'display_name'` na mesma transação do UPDATE. Em toda a história
 * deste repositório isso é verdade. Só que o primeiro commit já traz 81
 * migrations, e o registro de semânticas cita confirmações de 10/08/2026 — três
 * semanas antes: **o produto rodou em produção antes de existir esta
 * história**, e o que se passou lá não é auditável daqui. Naquele período,
 * "não há evento" pode significar "a máquina escreveu" ou "uma pessoa escreveu
 * antes de o log existir".
 *
 * Uma migration não pode arbitrar isso: ela roda sozinha, no deploy, sem
 * ninguém olhando, e o que ela apagaria é curadoria — que não se reimporta.
 * Esta rotina pode, porque inverte a ordem: primeiro mede o banco de verdade
 * ({@link preflightNomeGerencial}), mostra quantas linhas caem em cada caso, e
 * só então alguém decide. Toda alteração fica registrada em
 * `nome_gerencial_normalizado`, o que torna a volta atrás exata — restaura o
 * conjunto tocado, e só ele.
 *
 * ---------------------------------------------------------------------------
 * O que o rastro não pega, e por que não custa nada
 * ---------------------------------------------------------------------------
 *
 * `saveMeaning` só grava evento quando o valor **muda** — a comparação é
 * `displayName !== attribute.displayName`. Então uma pessoa que abriu o
 * formulário já preenchido com a cópia e salvou sem alterar o texto não deixou
 * rastro nenhum, nem dentro da era do log.
 *
 * Isso é uma limitação real da guarda, e é também o único caso em que ela não
 * importa: o que essa pessoa gravou é, byte a byte, o que a máquina já havia
 * gravado. Apagar não perde informação — a tela volta a mostrar o nome de
 * origem, que é exatamente o que ela mostrava antes. O que se perde é o sinal
 * "alguém olhou para esta coluna", e esse sinal nunca chegou a existir no
 * banco: não há evento para consultar, porque não houve mudança para registrar.
 */

/** A janela cega: atributos anteriores ao primeiro evento de curadoria. */
const ANTERIOR_AO_LOG = sql`(
       primeiro.evento IS NOT NULL AND a.created_at < primeiro.evento
     )`;

/** O rastro que prova escrita humana em `display_name`. */
const TEM_EVENTO_DE_NOME = sql`EXISTS (
       SELECT 1 FROM curation_event e
        WHERE e.target_kind = 'ATTRIBUTE'
          AND e.target_id = a.id
          AND e.field = 'display_name'
     )`;

/** Qualquer sinal de que uma pessoa trabalhou nesta coluna. */
const TEM_QUALQUER_CURADORIA = sql`(
       a.definition IS NOT NULL
    OR a.change_rule IS NOT NULL
    OR a.economic_direction IS NOT NULL
    OR a.economic_effect IS NOT NULL
    OR EXISTS (
         SELECT 1 FROM curation_event e
          WHERE e.target_kind = 'ATTRIBUTE' AND e.target_id = a.id
       )
     )`;

/** As candidatas: o valor é a cópia do nome de origem. */
const E_COPIA = sql`(a.display_name IS NOT NULL AND a.display_name = a.source_name)`;

/**
 * O `FROM` comum a todas as contas: os atributos, com a data do primeiro evento
 * de curadoria do banco pendurada em cada linha.
 */
const BASE = sql`
  FROM attribute a
  CROSS JOIN (
    SELECT min(created_at) AS evento FROM curation_event
  ) AS primeiro`;

export interface FatiaDoPreflight {
  chave: string;
  seriamNormalizados: number;
}

export interface PreflightNomeGerencial {
  totalDeAtributos: number;
  /** Candidatas: `display_name` idêntico ao nome de origem. */
  iguaisAoNomeDeOrigem: number;
  /** Dessas, quantas têm o evento que prova escrita humana do nome. */
  comEventoDeNomeGerencial: number;
  /** Dessas, quantas têm qualquer outro sinal de curadoria humana. */
  comQualquerCuradoria: number;
  /**
   * Dessas, quantas nasceram antes do primeiro evento de curadoria do banco —
   * a janela em que a ausência de evento não prova nada.
   */
  anterioresAoPrimeiroEvento: number;
  /** Quantas o modo conservador alteraria. É o número que decide o merge. */
  seriamNormalizados: number;
  /** Quantas o modo `incluirAnterioresAoLog` alteraria, a mais. */
  seriamNormalizadosIncluindoAnteriores: number;
  /** O primeiro evento de curadoria já registrado — null num banco sem nenhum. */
  primeiroEventoDeCuradoria: Date | null;
  /** O atributo mais antigo, para dimensionar a janela cega. */
  primeiroAtributo: Date | null;
  porTipoDeEquipamento: FatiaDoPreflight[];
  porMesDeCriacao: FatiaDoPreflight[];
  porImportacao: FatiaDoPreflight[];
  /** O que uma execução anterior já normalizou e ainda não foi restaurado. */
  jaNormalizados: number;
}

/**
 * Mede, sem escrever uma linha.
 *
 * É a resposta à única pergunta que decide se a normalização é segura naquele
 * banco: quantas das cópias caem na janela em que o log ainda não existia. Zero
 * ali significa que o rastro cobre tudo e o modo conservador limpa o legado
 * inteiro; um número alto significa que alguém precisa olhar antes.
 */
export async function preflightNomeGerencial(
  db: Database,
): Promise<PreflightNomeGerencial> {
  const { rows } = await db.execute<{
    total: string;
    iguais: string;
    com_evento: string;
    com_curadoria: string;
    anteriores: string;
    conservador: string;
    incluindo: string;
    primeiro_evento: Date | null;
    primeiro_atributo: Date | null;
  }>(sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE ${E_COPIA}) AS iguais,
           count(*) FILTER (WHERE ${E_COPIA} AND ${TEM_EVENTO_DE_NOME}) AS com_evento,
           count(*) FILTER (WHERE ${E_COPIA} AND ${TEM_QUALQUER_CURADORIA}) AS com_curadoria,
           count(*) FILTER (WHERE ${E_COPIA} AND ${ANTERIOR_AO_LOG}) AS anteriores,
           count(*) FILTER (
             WHERE ${E_COPIA}
               AND NOT ${TEM_EVENTO_DE_NOME}
               AND NOT ${ANTERIOR_AO_LOG}
           ) AS conservador,
           count(*) FILTER (
             WHERE ${E_COPIA} AND NOT ${TEM_EVENTO_DE_NOME}
           ) AS incluindo,
           min(primeiro.evento) AS primeiro_evento,
           min(a.created_at) AS primeiro_atributo
      ${BASE}`);

  const r = rows[0];

  const fatia = async (
    seletor: ReturnType<typeof sql>,
  ): Promise<FatiaDoPreflight[]> => {
    const { rows } = await db.execute<{ chave: string | null; n: string }>(sql`
      SELECT ${seletor} AS chave, count(*) AS n
        ${BASE}
       WHERE ${E_COPIA} AND NOT ${TEM_EVENTO_DE_NOME}
       GROUP BY 1
       ORDER BY count(*) DESC, 1`);
    return rows.map((linha) => ({
      chave: linha.chave ?? "(sem)",
      seriamNormalizados: Number(linha.n),
    }));
  };

  const { rows: normalizados } = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM nome_gerencial_normalizado
     WHERE restaurado_em IS NULL`);

  return {
    totalDeAtributos: Number(r.total),
    iguaisAoNomeDeOrigem: Number(r.iguais),
    comEventoDeNomeGerencial: Number(r.com_evento),
    comQualquerCuradoria: Number(r.com_curadoria),
    anterioresAoPrimeiroEvento: Number(r.anteriores),
    seriamNormalizados: Number(r.conservador),
    seriamNormalizadosIncluindoAnteriores: Number(r.incluindo),
    primeiroEventoDeCuradoria: r.primeiro_evento,
    primeiroAtributo: r.primeiro_atributo,
    porTipoDeEquipamento: await fatia(sql`a.entity_type`),
    porMesDeCriacao: await fatia(sql`to_char(a.created_at, 'YYYY-MM')`),
    porImportacao: await fatia(sql`a.first_seen_import_run_id::text`),
    jaNormalizados: Number(normalizados[0]?.n ?? 0),
  };
}

export interface NormalizarOptions {
  /** Quem mandou. Sem responsável não há auditoria — e não há execução. */
  actor: string;
  /**
   * Incluir também as colunas anteriores ao primeiro evento de curadoria.
   *
   * Falso por padrão, e por um motivo: naquela janela a ausência de evento não
   * prova que a máquina escreveu. Ligar isto é uma decisão de quem viu o
   * preflight e sabe que aquele período não teve curadoria de nome — e continua
   * reversível linha a linha, porque tudo fica registrado.
   */
  incluirAnterioresAoLog?: boolean;
}

export interface NormalizacaoResult {
  normalizados: number;
  /** As colunas tocadas, para quem quiser conferir uma a uma. */
  codigos: string[];
}

/**
 * Apaga a cópia, registrando cada linha antes de apagá-la.
 *
 * Numa transação só: ou o registro e a alteração entram juntos, ou nenhum dos
 * dois entra. Um registro sem alteração mentiria sobre o que foi feito; uma
 * alteração sem registro seria irreversível, que é exatamente o que esta
 * rotina existe para não ser.
 */
export async function normalizarNomeGerencial(
  db: Database,
  options: NormalizarOptions,
): Promise<NormalizacaoResult> {
  if (!options.actor?.trim()) {
    throw new Error("Normalizar o nome gerencial exige um responsável identificado.");
  }

  const guarda = options.incluirAnterioresAoLog
    ? sql`NOT ${TEM_EVENTO_DE_NOME}`
    : sql`NOT ${TEM_EVENTO_DE_NOME} AND NOT ${ANTERIOR_AO_LOG}`;

  return await db.transaction(async (tx) => {
    const { rows: alvos } = await tx.execute<{
      id: string;
      code: string;
      source_name: string;
      display_name: string;
    }>(sql`
      SELECT a.id, a.code, a.source_name, a.display_name
        ${BASE}
       WHERE ${E_COPIA} AND ${guarda}
       ORDER BY a.code`);

    if (alvos.length === 0) return { normalizados: 0, codigos: [] };

    const ids = sql.join(
      alvos.map((alvo) => sql`${alvo.id}::uuid`),
      sql`, `,
    );

    // O registro primeiro: depois do UPDATE já não há de onde ler o valor.
    await tx.execute(sql`
      INSERT INTO nome_gerencial_normalizado
        (attribute_id, attribute_code, source_name, display_name_antes, normalizado_por)
      SELECT a.id, a.code, a.source_name, a.display_name, ${options.actor}
        FROM attribute a
       WHERE a.id IN (${ids})`);

    await tx.execute(sql`
      UPDATE attribute SET display_name = NULL WHERE id IN (${ids})`);

    return { normalizados: alvos.length, codigos: alvos.map((a) => a.code) };
  });
}

export interface DesfazerResult {
  restaurados: number;
  /** Linhas cujo atributo já não existe — nada a restaurar, e nada a esconder. */
  semAtributo: number;
}

/**
 * Põe de volta exatamente o que foi tirado.
 *
 * Lê do registro, e por isso alcança o conjunto tocado e só ele: o que já era
 * nulo por direito e o que nasceu nulo sob a regra nova não são alterados. As
 * linhas do registro ficam, marcadas como restauradas — um banco que foi
 * normalizado e revertido não é o mesmo que um que nunca foi tocado, e a
 * auditoria precisa poder dizer isso.
 *
 * Só restaura o que ainda está nulo: se alguém batizou a coluna depois da
 * normalização, esse nome é curadoria mais recente do que este registro, e
 * sobrescrevê-lo seria a volta atrás destruindo o que veio depois dela.
 */
export async function desfazerNormalizacaoDoNomeGerencial(
  db: Database,
): Promise<DesfazerResult> {
  return await db.transaction(async (tx) => {
    const { rows: restaurados } = await tx.execute<{ id: string }>(sql`
      UPDATE attribute a
         SET display_name = n.display_name_antes
        FROM nome_gerencial_normalizado n
       WHERE n.attribute_id = a.id
         AND n.restaurado_em IS NULL
         AND a.display_name IS NULL
      RETURNING n.id`);

    if (restaurados.length > 0) {
      await tx.execute(sql`
        UPDATE nome_gerencial_normalizado
           SET restaurado_em = now()
         WHERE id IN (${sql.join(
           restaurados.map((r) => sql`${r.id}::uuid`),
           sql`, `,
         )})`);
    }

    const { rows: orfas } = await tx.execute<{ n: string }>(sql`
      SELECT count(*) AS n
        FROM nome_gerencial_normalizado n
       WHERE n.restaurado_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM attribute a WHERE a.id = n.attribute_id)`);

    return {
      restaurados: restaurados.length,
      semAtributo: Number(orfas[0]?.n ?? 0),
    };
  });
}
