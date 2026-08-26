/**
 * O que cada vigência de um contexto **tem** — por tipo, medido no banco.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que faltava
 * ---------------------------------------------------------------------------
 * A tela sabia responder *quando* (vigência) e *onde* (unidade e canal). Não
 * sabia responder *o quê*, e por isso não sabia dizer a diferença entre estas
 * duas frases, que na tela saíam iguais — cartões zerados:
 *
 * - "não houve alteração de cavalo nesta vigência" (o cavalo chegou, e está
 *   parado);
 * - "não há cavalo nenhum nesta vigência" (o arquivo de cavalo não entrou aqui).
 *
 * A segunda não é um zero: é uma **ausência**, e ela tem endereço — a vigência
 * em que aquele tipo apareceu pela última vez. Este módulo apura as duas coisas
 * a partir dos fatos gravados, e nunca de uma declaração: um tipo existe numa
 * vigência porque há entidade dele com fato ali, ponto.
 *
 * ---------------------------------------------------------------------------
 * Por que a leitura não passa por `contextFilter`
 * ---------------------------------------------------------------------------
 * Por duas razões, e as duas são deliberadas:
 *
 * 1. **A janela.** `contextFilter` aplica o recorte `de`/`ate`, que é o que se
 *    quer de uma leitura e o oposto do que se quer de um seletor — que existe
 *    justamente para escolher uma vigência de fora da janela. É a mesma escolha
 *    que `listPeriodLabels` já fazia, pelo mesmo motivo.
 * 2. **A família.** `contextFilter` recorta por `dataset_family`, e aqui a
 *    pergunta é sobre **tipo**, não sobre família. O QLP de uma unidade forma
 *    vigência própria — e é essa a resposta certa para quem selecionou QLP e
 *    não o encontrou na vigência de equipamento: *ele existe, na vigência dele,
 *    e aqui está o caminho*. Filtrar por família aqui diria "não há QLP", o que
 *    seria falso; ler as duas famílias **como leitura** é que seria o defeito,
 *    e isso continua proibido em toda consulta que produz número — nenhuma
 *    delas mora aqui.
 *
 * O que amarra a leitura é o par (`scope_hash`, canal), que é a identidade da
 * unidade na tela, e é o mesmo par que `contextFilter` usa.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { channelSql, type SeriesContext } from "./series";
import { rotuloDaVigencia } from "./labels";
import {
  TIPOS_DE_ANALISE,
  tipoDoEntityType,
  type DefinicaoDeTipoDeAnalise,
  type TipoDeAnalise,
} from "./tipos";

/** O atributo que declara o par cavalo→carreta. Um só, e medido — ver `vinculos.ts`. */
const CODIGO_DO_VINCULO = "cavalo.placa_carreta";

/** Uma vigência onde um tipo existe, escrita como a tela a mostra. */
export interface VigenciaComTipo {
  date: string;
  label: string;
  /** Quantas entidades daquele tipo havia ali. */
  entidades: number;
}

export interface TipoNaVigencia {
  code: TipoDeAnalise;
  rotulo: string;
  nome: string;
  plural: string;
  grao: string;
  /** Em qual família de dataset este tipo mora — ver `tipos.ts`. */
  familia: string;
  /** Quantas entidades deste tipo a vigência aberta tem. Zero é ausência. */
  entidades: number;
  presente: boolean;
  /**
   * A vigência mais recente **anterior ou igual** à aberta em que este tipo
   * existiu, quando ele não existe na aberta.
   *
   * Nulo quer dizer que ele nunca existiu neste contexto — e a tela precisa
   * dizer as duas coisas de formas diferentes: "está na vigência X" é um
   * convite a navegar; "nunca foi importado aqui" é um pedido de arquivo.
   *
   * Só olha para trás de propósito. Mandar a pessoa para a frente resolveria a
   * tela e estragaria a leitura: a vigência seguinte é outro período, e o que
   * ela responde não é o que estava sendo perguntado.
   */
  ultimaVigenciaComDado: VigenciaComTipo | null;
}

export interface ComposicaoDaVigencia {
  /** Os seis tipos, sempre — presentes e ausentes, na ordem do catálogo. */
  tipos: TipoNaVigencia[];
  /** Só os que a vigência aberta tem, na mesma ordem. O que "Todos" resume. */
  presentes: TipoNaVigencia[];
  /**
   * Se a vigência aberta não tem tipo nenhum.
   *
   * Não deveria acontecer — uma vigência existe porque algum arquivo entrou —,
   * e existe como campo porque a tela não pode ficar sem frase se acontecer.
   */
  vazia: boolean;
}

/** `data → tipo → entidades`. O que a tela inteira consome. */
export type ContagensPorVigencia = Map<string, Map<TipoDeAnalise, number>>;

/** O conjunto não é `entity_type`; a definição dele é procurada uma vez só. */
const CONJUNTO = TIPOS_DE_ANALISE.find((t) => t.code === "CONJUNTO")!;

/**
 * Uma linha da contagem. `type` e não `interface` porque `db.execute<T>` exige
 * um `Record<string, unknown>`, e só o alias ganha índice implícito.
 */
type LinhaDeContagem = {
  d: string;
  tipo: string;
  entidades: number;
};

/**
 * Quantas entidades de cada tipo cada vigência do contexto tem.
 *
 * Uma consulta só para o histórico inteiro, e não uma por vigência: o seletor
 * precisa de todas para saber o que oferecer, e a resposta de "onde está o
 * cavalo que não está aqui" também. Nove vigências é o tamanho do export real.
 */
async function contagens(
  db: Database,
  context: SeriesContext,
): Promise<LinhaDeContagem[]> {
  const doContexto = sql`s.status <> 'SUPERSEDED'
      AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
      AND s.scope_hash = ${context.scopeHash}
      AND ${channelSql("s.source_label")} IS NOT DISTINCT FROM ${context.channel}::text`;

  const { rows } = await db.execute<LinhaDeContagem>(sql`
    WITH snaps AS (
      SELECT s.id, s.effective_date::text AS d
        FROM snapshot s
       WHERE ${doContexto}
    ),
    -- Os tipos que são entidade: a presença sai do fato gravado, e a contagem
    -- é de entidades distintas — não de fatos, que multiplicariam por coluna.
    por_entidade AS (
      SELECT sn.d, e.entity_type AS tipo, count(DISTINCT f.entity_id)::int AS entidades
        FROM snaps sn
        JOIN fato_visivel f   ON f.snapshot_id = sn.id
        JOIN entity e ON e.id = f.entity_id
       GROUP BY 1, 2
    ),
    -- O conjunto não é entidade: é o par, contado pelo vínculo **da própria
    -- vigência**. Ler o vínculo de hoje para contar março atribuiria o par
    -- errado — a mesma razão que vinculos.ts já escreve.
    por_conjunto AS (
      SELECT sn.d, 'CONJUNTO' AS tipo,
             count(DISTINCT (f.entity_id, carreta.entity_id))::int AS entidades
        FROM snaps sn
        JOIN fato_visivel f      ON f.snapshot_id = sn.id
        JOIN attribute a ON a.id = f.attribute_id AND a.code = ${CODIGO_DO_VINCULO}
        JOIN entity_identifier carreta
          ON carreta.identifier_type = 'PLACA'
         AND carreta.is_current
         AND carreta.identifier_value = f.value_text
        JOIN entity ec ON ec.id = carreta.entity_id AND ec.entity_type = 'CARRETA'
       WHERE NOT f.is_null AND f.value_text IS NOT NULL
       GROUP BY 1
    )
    SELECT d, tipo, entidades FROM por_entidade
    UNION ALL
    SELECT d, tipo, entidades FROM por_conjunto
  `);
  return rows;
}

function comoTipo(
  definicao: DefinicaoDeTipoDeAnalise,
  entidades: number,
  ultima: VigenciaComTipo | null,
): TipoNaVigencia {
  return {
    code: definicao.code,
    rotulo: definicao.rotulo,
    nome: definicao.nome,
    plural: definicao.plural,
    grao: definicao.grao,
    familia: definicao.familia,
    entidades,
    presente: entidades > 0,
    ultimaVigenciaComDado: entidades > 0 ? null : ultima,
  };
}

/**
 * Quantas entidades de cada tipo cada vigência do contexto tem — o mapa inteiro.
 *
 * Uma consulta para o histórico todo, e é ela que as duas perguntas da tela
 * consomem: o seletor precisa de todas as vigências para dizer o que cada uma
 * contém, e a frase da ausência precisa delas para achar onde o tipo faltante
 * está. Duas chamadas por vigência dariam a mesma resposta e N vezes o custo.
 *
 * Os `entity_type` que não são um dos seis ficam de fora aqui: um tipo que o
 * produto não analisa não vira opção de filtro por ter aparecido no banco.
 */
export async function contagensPorVigencia(
  db: Database,
  context: SeriesContext,
): Promise<ContagensPorVigencia> {
  const linhas = await contagens(db, context);
  const porData: ContagensPorVigencia = new Map();
  for (const linha of linhas) {
    const definicao =
      linha.tipo === "CONJUNTO" ? CONJUNTO : tipoDoEntityType(linha.tipo);
    if (!definicao || linha.entidades <= 0) continue;
    const doDia = porData.get(linha.d) ?? new Map<TipoDeAnalise, number>();
    doDia.set(definicao.code, (doDia.get(definicao.code) ?? 0) + linha.entidades);
    porData.set(linha.d, doDia);
  }
  return porData;
}

/**
 * A composição de uma vigência: o que ela tem, o que não tem, e onde está o que
 * não tem.
 *
 * Pura de propósito — recebe o mapa já lido. `periodosDoContexto` são as datas
 * que a unidade entregou, e é o que faz o rótulo de "última vigência com
 * cavalo" sair pela mesma régua do seletor. Sem ela, a frase da ausência
 * escreveria "agosto/2026" para uma data cujo seletor mostra "02/08/2026", e as
 * duas discordariam sobre a mesma vigência.
 */
export function composicaoDe(
  porData: ContagensPorVigencia,
  period: string,
  periodosDoContexto: readonly string[],
): ComposicaoDaVigencia {
  const anteriores = [...porData.keys()].filter((d) => d <= period).sort().reverse();
  const daVigencia = porData.get(period) ?? new Map<TipoDeAnalise, number>();

  const tipos = TIPOS_DE_ANALISE.map((definicao) => {
    const entidades = daVigencia.get(definicao.code) ?? 0;
    if (entidades > 0) return comoTipo(definicao, entidades, null);

    const data = anteriores.find((d) => (porData.get(d)?.get(definicao.code) ?? 0) > 0);
    const ultima =
      data === undefined
        ? null
        : {
            date: data,
            label: rotuloDaVigencia(data, periodosDoContexto),
            entidades: porData.get(data)!.get(definicao.code)!,
          };
    return comoTipo(definicao, 0, ultima);
  });

  const presentes = tipos.filter((t) => t.presente);
  return { tipos, presentes, vazia: presentes.length === 0 };
}

/** Os tipos que uma vigência contém, na ordem do catálogo — o que o seletor mostra. */
export function tiposPresentesEm(
  porData: ContagensPorVigencia,
  date: string,
): { code: string; rotulo: string; entidades: number }[] {
  const doDia = porData.get(date);
  if (!doDia) return [];
  return TIPOS_DE_ANALISE.filter((t) => (doDia.get(t.code) ?? 0) > 0).map((t) => ({
    code: t.code,
    rotulo: t.rotulo,
    entidades: doDia.get(t.code)!,
  }));
}

/**
 * A composição de uma vigência, lendo o banco — o atalho de quem só quer uma.
 *
 * `getGroupedView` não usa este caminho: ela precisa do mapa inteiro para o
 * seletor, e leria o banco duas vezes.
 */
export async function composicaoDaVigencia(
  db: Database,
  context: SeriesContext,
  period: string,
  periodosDoContexto: readonly string[],
): Promise<ComposicaoDaVigencia> {
  return composicaoDe(await contagensPorVigencia(db, context), period, periodosDoContexto);
}
