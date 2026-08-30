/**
 * O rastreio de um equipamento: **toda célula que o arquivo trouxe para esta
 * placa nesta vigência chegou à ficha?**
 *
 * A ficha já sabia responder a pergunta inversa — de onde veio cada número que
 * ela exibe, até a célula da planilha. Esta é a outra metade, e ela não estava
 * em lugar nenhum: um valor que a importação trouxe e a ficha não mostra não
 * deixa rastro na tela, porque o que falta não aparece. Uma coluna renomeada na
 * origem, uma coluna que passou a colidir com outra, um fato que não foi
 * promovido — nenhum desses casos produz erro. Produzem uma ficha menor, com
 * todos os números exibidos conferindo entre si.
 *
 * É o mesmo raciocínio do Rastreio de Dados (`lib/balance`), no grão de um
 * ativo: lá a conta de conservação é do arquivo inteiro, aqui é da linha desta
 * placa. E é deliberadamente uma leitura do que ficou **gravado** — células,
 * mapeamentos de coluna e fatos —, nunca uma segunda execução das regras de
 * leitura: uma cópia da lógica do pipeline concordaria com ele inclusive
 * quando os dois estivessem errados.
 *
 * O caminho é curto e tem um único ponto de partida: os fatos que esta ficha
 * mostra apontam para as células que os originaram; as células apontam para as
 * linhas do arquivo; e a conta se fecha exigindo que **toda** célula daquelas
 * linhas tenha um destino declarado — virou fato, ou é o endereço do fato
 * (placa e vigência), ou é uma perda com nome e endereço.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { contextFilter, type SeriesContext } from "@workspace/comparison";

/** O que aconteceu com uma célula da linha desta placa. */
export type DestinoDaCelula =
  /** Virou fato, e o fato está nesta ficha. */
  | "VIROU_FATO"
  /** Placa e vigência: não viram fato porque são o endereço do fato. */
  | "ENDERECO"
  /** A coluna tem valor e não tem nome — não há atributo a que ligá-la. */
  | "COLUNA_SEM_CABECALHO"
  /** Duas colunas da aba normalizam para o mesmo atributo; nenhuma entra. */
  | "COLUNA_AMBIGUA"
  /** Nenhum dos anteriores. Qualquer número aqui é defeito, não configuração. */
  | "SEM_DESTINO";

export const ROTULO_DO_DESTINO: Record<DestinoDaCelula, string> = {
  VIROU_FATO: "Virou fato e está nesta ficha",
  ENDERECO: "Endereço do fato (placa e vigência)",
  COLUNA_SEM_CABECALHO: "Coluna sem cabeçalho",
  COLUNA_AMBIGUA: "Coluna ambígua",
  SEM_DESTINO: "Sem destino declarado",
};

/** Uma célula que o arquivo trouxe para esta placa e a ficha não mostra. */
export interface CelulaForaDaFicha {
  destino: DestinoDaCelula;
  columnLetter: string | null;
  columnHeader: string | null;
  valor: string | null;
}

export interface RastreioDoEquipamento {
  /** Linhas do arquivo que originaram os fatos desta ficha. */
  linhasDoArquivo: number;
  /** Células dessas linhas — a massa que o arquivo trouxe para esta placa. */
  celulas: number;
  viraramFato: number;
  endereco: number;
  colunaSemCabecalho: number;
  colunaAmbigua: number;
  semDestino: number;
  /** Fatos desta entidade nesta vigência — o que a ficha tem para mostrar. */
  fatos: number;
  /**
   * Fatos sem célula de origem no arquivo.
   *
   * Não é perda: um fato herdado de uma revisão anterior é legítimo e continua
   * na ficha. É o que impede a conta de fechar por acidente — sem este número,
   * "células que viraram fato" e "fatos da ficha" divergiriam sem explicação.
   */
  fatosSemCelula: number;
  /**
   * Verdadeiro quando toda célula da linha desta placa tem destino declarado e
   * todo fato com lastro no arquivo veio de uma delas. É a única resposta
   * autorizada a "não falta nada desta placa nesta ficha?".
   */
  fecha: boolean;
  /** O endereço do que não chegou. Sem endereço não há conserto. */
  amostras: CelulaForaDaFicha[];
}

/** Quantas células perdidas a ficha nomeia. Acima disso, a conta já não fecha. */
const LIMITE_DE_AMOSTRAS = 20;

interface LinhaDeContagem extends Record<string, unknown> {
  destino: string;
  celulas: number;
  linhas: number;
}

interface LinhaDeAmostra extends Record<string, unknown> {
  destino: string;
  column_letter: string | null;
  column_header: string | null;
  raw_value: string | null;
}

/**
 * As células desta placa nesta vigência, classificadas pelo destino.
 *
 * A classificação vive num fragmento só, usado pelas duas consultas (a
 * contagem e as amostras), pelo mesmo motivo que o `CASE` do balanço: duas
 * telas discordando sobre para onde foi a mesma célula é pior que não ter a
 * tela.
 *
 * A ordem do `CASE` é a mais específica primeiro. `ENDERECO` vem depois de
 * `VIROU_FATO` porque uma coluna de grão pode também ser fato quando a fonte
 * a repete (ver `COLUNAS_IDENTIFICADORAS.tambemEhFato`), e nesse caso o que
 * importa é que ela chegou à ficha.
 */
function classificacao(entityId: string, effectiveDate: string, context: SeriesContext): {
  fatoDaFicha: ReturnType<typeof sql>;
  celulaClassificada: ReturnType<typeof sql>;
} {
  const fatoDaFicha = sql`
    fato_da_ficha AS (
      SELECT f.id, f.raw_cell_id
        FROM fato_visivel f
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE f.entity_id = ${entityId}::uuid
         AND s.effective_date = ${effectiveDate}::date
         AND s.status <> 'SUPERSEDED'
         AND NOT EXISTS (
           SELECT 1 FROM import_run
            WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL
         )
         AND ${contextFilter("s", context)}
    )
  `;

  const celulaClassificada = sql`
    linha_do_arquivo AS (
      SELECT DISTINCT r.id, r.raw_sheet_id
        FROM fato_da_ficha ff
        JOIN raw_cell c ON c.id = ff.raw_cell_id
        JOIN raw_row r  ON r.id = c.raw_row_id
    ),
    celula AS (
      SELECT c.id,
             c.column_letter,
             c.column_header,
             c.raw_value,
             CASE
               WHEN EXISTS (SELECT 1 FROM fato_da_ficha ff WHERE ff.raw_cell_id = c.id)
                                            THEN 'VIROU_FATO'
               WHEN cm.id IS NULL           THEN 'COLUNA_SEM_CABECALHO'
               WHEN cm.status = 'AMBIGUOUS' THEN 'COLUNA_AMBIGUA'
               WHEN cm.status = 'IGNORED'   THEN 'ENDERECO'
               ELSE 'SEM_DESTINO'
             END AS destino,
             l.id AS linha_id
        FROM linha_do_arquivo l
        JOIN raw_cell c ON c.raw_row_id = l.id
        LEFT JOIN column_mapping cm ON cm.raw_sheet_id = l.raw_sheet_id
                                   AND cm.column_index = c.column_index
    )
  `;

  return { fatoDaFicha, celulaClassificada };
}

/**
 * A conta de conservação desta placa nesta vigência.
 *
 * Duas consultas e não uma: a contagem responde "fecha?" e as amostras
 * respondem "onde", e trazer as duas juntas obrigaria a agregação a carregar o
 * texto de todas as células para descartar quase todas.
 */
export async function rastrearEquipamento(
  db: Database,
  entityId: string,
  effectiveDate: string,
  context: SeriesContext,
): Promise<RastreioDoEquipamento> {
  const { fatoDaFicha, celulaClassificada } = classificacao(entityId, effectiveDate, context);

  const [contagem, amostras, fatos] = await Promise.all([
    db.execute<LinhaDeContagem>(sql`
      WITH ${fatoDaFicha}, ${celulaClassificada}
      SELECT destino,
             count(*)::int                    AS celulas,
             count(DISTINCT linha_id)::int    AS linhas
        FROM celula
       GROUP BY destino
    `),
    db.execute<LinhaDeAmostra>(sql`
      WITH ${fatoDaFicha}, ${celulaClassificada}
      SELECT destino, column_letter, column_header, raw_value
        FROM celula
       WHERE destino NOT IN ('VIROU_FATO', 'ENDERECO')
       ORDER BY column_letter
       LIMIT ${LIMITE_DE_AMOSTRAS}
    `),
    db.execute<{ fatos: number; sem_celula: number }>(sql`
      WITH ${fatoDaFicha}
      SELECT count(*)::int                                        AS fatos,
             count(*) FILTER (WHERE raw_cell_id IS NULL)::int      AS sem_celula
        FROM fato_da_ficha
    `),
  ]);

  const porDestino = new Map<string, number>();
  let linhasDoArquivo = 0;
  let celulas = 0;
  for (const linha of contagem.rows) {
    porDestino.set(linha.destino, linha.celulas);
    celulas += linha.celulas;
    linhasDoArquivo = Math.max(linhasDoArquivo, linha.linhas);
  }
  const conta = (destino: DestinoDaCelula): number => porDestino.get(destino) ?? 0;

  const viraramFato = conta("VIROU_FATO");
  const colunaSemCabecalho = conta("COLUNA_SEM_CABECALHO");
  const colunaAmbigua = conta("COLUNA_AMBIGUA");
  const semDestino = conta("SEM_DESTINO");
  const totalDeFatos = fatos.rows[0]?.fatos ?? 0;
  const fatosSemCelula = fatos.rows[0]?.sem_celula ?? 0;

  return {
    linhasDoArquivo,
    celulas,
    viraramFato,
    endereco: conta("ENDERECO"),
    colunaSemCabecalho,
    colunaAmbigua,
    semDestino,
    fatos: totalDeFatos,
    fatosSemCelula,
    /*
      Duas condições, e as duas são necessárias. A primeira diz que nada da
      linha ficou sem destino; a segunda, que nenhum fato com lastro no arquivo
      veio de uma linha que este rastreio não olhou — o caso em que a mesma
      placa aparece em duas linhas da mesma vigência e só uma delas foi
      seguida.
    */
    fecha:
      colunaSemCabecalho + colunaAmbigua + semDestino === 0 &&
      viraramFato === totalDeFatos - fatosSemCelula,
    amostras: amostras.rows.map((r) => ({
      destino: r.destino as DestinoDaCelula,
      columnLetter: r.column_letter,
      columnHeader: r.column_header,
      valor: r.raw_value,
    })),
  };
}
