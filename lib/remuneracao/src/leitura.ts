import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  ContextNotFoundError,
  contextFilter,
  listContexts,
  periodLabel,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
  type SeriesContext,
} from "@workspace/comparison";
import {
  CODIGOS_DO_CAVALO,
  CODIGOS_DO_TRECHO,
  COLUNA,
  TIPO_CAVALO,
  TIPO_TRECHO,
} from "./colunas";
import type { CavaloDaVigencia, TrechoDaVigencia } from "./medicao";
import { montarCadastro, type CadastroMontado } from "./montagem";

/**
 * A leitura do acervo da Auditoria — a única parte deste módulo que vai ao
 * banco.
 *
 * Quatro consultas por vigência, e **nenhuma delas por ativo**: a mesma escolha
 * de `lerVigencia` em `@workspace/composition`, pela mesma razão — uma consulta
 * por cavalo daria sessenta idas ao banco para desenhar uma aba de cadastro.
 * São quatro e não três porque a frota precisa de duas: uma para os fatos de
 * `ativo` e outra para **quem existe**, que é maior — ver `lerCavalos`.
 *
 * **Por que este módulo lê os fatos direto, e não pela Composição.** A
 * Composição responde "quanto este equipamento recebe", e para isso passa cada
 * número pelo portão da semântica: só entra no total o que a curadoria já
 * confirmou como monetário, somável e com periodicidade. O cadastro pergunta
 * outra coisa — quantos veículos estão ativos, qual a alíquota do trecho —, e
 * nenhuma dessas respostas é um total de remuneração. Passá-las pelo portão do
 * total as excluiria por não serem dinheiro, que é justamente o certo para lá e
 * o errado para cá.
 *
 * O que **não** muda é a régua: as duas consultas abaixo respeitam
 * `contextFilter` — unidade, canal e janela — como todas as leituras do
 * produto, e nenhuma delas inventa um valor onde o fato é nulo. `is_null`
 * verdadeiro devolve `null`, e é a montagem que decide o que dizer sobre isso.
 */

export interface VigenciaDoCadastro {
  effectiveDate: string;
  periodLabel: string;
}

export interface CadastroDaUnidade extends CadastroMontado {
  contexto: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
    scopes: { scopeType: string; code: string; name: string | null }[];
  };
  effectiveDate: string;
  periodLabel: string;
  /** Todas as vigências desta unidade, para o seletor. */
  vigencias: VigenciaDoCadastro[];
  /** Quantos cavalos e trechos a vigência entregou — o lastro, em números. */
  material: { cavalos: number; trechos: number; trechosEntregues: boolean };
}

/** Erro de recusa: a vigência pedida não existe nesta unidade. Rota traduz em 404. */
export class VigenciaDoCadastroNaoEncontrada extends Error {
  constructor(pedida: string, disponiveis: string[]) {
    super(
      `A vigência pedida (${pedida}) não existe nesta unidade. ` +
        `Disponíveis: ${disponiveis.join(", ") || "nenhuma"}.`,
    );
    this.name = "VigenciaDoCadastroNaoEncontrada";
  }
}

export { ContextNotFoundError };

/** As unidades que já entregaram vigência — o seletor do módulo. */
export function listarUnidades(db: Database): Promise<ContextInfo[]> {
  return listContexts(db);
}

/**
 * O cadastro de uma unidade numa vigência.
 *
 * `null` quando o acervo não tem nenhuma unidade — a rota traduz na frase que
 * aponta para Importações. Unidade pedida e inexistente é
 * `ContextNotFoundError`; vigência pedida e inexistente é
 * {@link VigenciaDoCadastroNaoEncontrada}. Recusa escrita, nunca cadastro
 * vazio: as trinta linhas em branco de um contexto que não existe são
 * indistinguíveis das trinta linhas em branco de uma vigência sem dados, e as
 * duas situações pedem coisas diferentes de quem está olhando.
 */
export async function lerCadastroDaUnidade(
  db: Database,
  pedido?: RequestedContext & { period?: string },
): Promise<CadastroDaUnidade | null> {
  const contextos = await listContexts(db);
  if (contextos.length === 0) return null;

  const contexto = (await resolveContext(db, pedido, contextos))!;

  const effectiveDate = pedido?.period ?? contexto.latestPeriod;
  if (!contexto.periodosDisponiveis.includes(effectiveDate)) {
    throw new VigenciaDoCadastroNaoEncontrada(effectiveDate, contexto.periodosDisponiveis);
  }

  const [cavalos, trechos, trechosEntregues] = await Promise.all([
    lerCavalos(db, effectiveDate, contexto),
    lerTrechos(db, effectiveDate, contexto),
    serieEntregue(db, TIPO_TRECHO, effectiveDate, contexto),
  ]);

  const montado = montarCadastro({ cavalos, trechos, trechosEntregues });

  return {
    ...montado,
    contexto: {
      scopeHash: contexto.scopeHash,
      channel: contexto.channel,
      label: contexto.label,
      unidade: unidadeDe(contexto),
      scopes: contexto.scopes,
    },
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    vigencias: contexto.periodosDisponiveis.map((data) => ({
      effectiveDate: data,
      periodLabel: periodLabel(data),
    })),
    material: { cavalos: cavalos.length, trechos: trechos.length, trechosEntregues },
  };
}

/** O nome da unidade dentro do escopo do contexto, quando ele o declara. */
function unidadeDe(contexto: ContextInfo): string | null {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? null;
}

/**
 * Se a vigência **declarou** entregar aquela série.
 *
 * Lê `snapshot.entity_type_set` e não a existência de fatos, pela mesma razão
 * de `serieFoiEntregue` na Frota: uma aba entregue vazia é dado; uma aba não
 * entregue é a forma do arquivo. As duas produzem zero trechos e pedem frases
 * diferentes.
 */
async function serieEntregue(
  db: Database,
  entityType: string,
  effectiveDate: string,
  contexto: SeriesContext,
): Promise<boolean> {
  const { rows } = await db.execute<{ entity_type_set: string }>(sql`
    SELECT s.entity_type_set
      FROM snapshot s
     WHERE s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", contexto)}
  `);
  return rows.some((r) => (r.entity_type_set ?? "").split("+").includes(entityType));
}

interface LinhaDeFato extends Record<string, unknown> {
  entity_id: string;
  code: string;
  value_numeric: string | null;
  value_text: string | null;
  value_boolean: boolean | null;
  is_null: boolean;
}

/** Os fatos de um tipo de entidade numa vigência, restritos aos códigos pedidos. */
async function lerFatosDoTipo(
  db: Database,
  entityType: string,
  codigos: string[],
  effectiveDate: string,
  contexto: SeriesContext,
): Promise<Map<string, Map<string, LinhaDeFato>>> {
  const { rows } = await db.execute<LinhaDeFato>(sql`
    SELECT f.entity_id::text     AS entity_id,
           a.code,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           f.value_boolean,
           f.is_null
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id
     WHERE e.entity_type = ${entityType}
       AND a.code IN (${sql.join(
         codigos.map((code) => sql`${code}`),
         sql`, `,
       )})
       AND s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", contexto)}
  `);

  const porAtivo = new Map<string, Map<string, LinhaDeFato>>();
  for (const row of rows) {
    const atual = porAtivo.get(row.entity_id) ?? new Map<string, LinhaDeFato>();
    atual.set(row.code, row);
    porAtivo.set(row.entity_id, atual);
  }
  return porAtivo;
}

/**
 * O número de um fato, ou nulo.
 *
 * `is_null` verdadeiro devolve nulo mesmo quando há um `value_numeric`: a
 * ausência é declarada pelo canônico e tem motivo próprio (`null_reason`), e
 * ler o número por baixo dela desfaria a distinção entre zero econômico e
 * célula vazia — que é a distinção que o modelo inteiro existe para manter.
 */
function numeroDe(fato: LinhaDeFato | undefined): number | null {
  if (!fato || fato.is_null || fato.value_numeric === null) return null;
  const valor = Number(fato.value_numeric);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * O booleano de um fato, ou nulo.
 *
 * Aceita também o texto: a coluna `ativo` chega ora como booleano tipado, ora
 * como `SIM`/`NAO` conforme a planilha de origem, e quem lê o cadastro não tem
 * como saber qual das duas veio. Qualquer outro texto é nulo — inclusive o
 * vazio —, porque adivinhar o que "—" quer dizer é como uma frota inteira
 * viraria inativa em silêncio.
 */
function booleanoDe(fato: LinhaDeFato | undefined): boolean | null {
  if (!fato || fato.is_null) return null;
  if (fato.value_boolean !== null) return fato.value_boolean;

  const texto = (fato.value_text ?? "").trim().toUpperCase();
  if (["SIM", "S", "TRUE", "VERDADEIRO", "ATIVO", "1"].includes(texto)) return true;
  if (["NAO", "NÃO", "N", "FALSE", "FALSO", "INATIVO", "0"].includes(texto)) return false;

  const numero = numeroDe(fato);
  if (numero === 1) return true;
  if (numero === 0) return false;
  return null;
}

async function lerCavalos(
  db: Database,
  effectiveDate: string,
  contexto: SeriesContext,
): Promise<CavaloDaVigencia[]> {
  const porAtivo = await lerFatosDoTipo(
    db,
    TIPO_CAVALO,
    CODIGOS_DO_CAVALO,
    effectiveDate,
    contexto,
  );

  /*
    A consulta acima só devolve cavalos que tenham **alguma** das colunas
    pedidas. Um cavalo sem a coluna `ativo` não apareceria, e a frota da
    vigência encolheria em silêncio — exatamente o oposto do que a contagem
    precisa dizer. Por isso a lista de quem existe vem de `entity`, e os fatos
    só a preenchem.
  */
  const { rows } = await db.execute<{ entity_id: string }>(sql`
    SELECT DISTINCT f.entity_id::text AS entity_id
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
     WHERE e.entity_type = ${TIPO_CAVALO}
       AND s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", contexto)}
  `);

  return rows.map((row) => ({
    entityId: row.entity_id,
    ativo: booleanoDe(porAtivo.get(row.entity_id)?.get(COLUNA.ativo.code)),
  }));
}

async function lerTrechos(
  db: Database,
  effectiveDate: string,
  contexto: SeriesContext,
): Promise<TrechoDaVigencia[]> {
  const porAtivo = await lerFatosDoTipo(
    db,
    TIPO_TRECHO,
    CODIGOS_DO_TRECHO,
    effectiveDate,
    contexto,
  );

  const trechos: TrechoDaVigencia[] = [];
  for (const fatos of porAtivo.values()) {
    trechos.push({
      tributo: tributoDe(fatos.get(COLUNA.tributo.code)),
      percentualDeclarado: numeroDe(fatos.get(COLUNA.percentualDeclarado.code)),
      freteCtrc: numeroDe(fatos.get(COLUNA.freteCtrc.code)),
      imposto: numeroDe(fatos.get(COLUNA.imposto.code)),
      pisCofins: numeroDe(fatos.get(COLUNA.pisCofins.code)),
      previsaoViagens: numeroDe(fatos.get(COLUNA.previsaoViagens.code)),
    });
  }
  return trechos;
}

/**
 * O tributo aplicável ao trecho, como a coluna `icmsIss` o escreve.
 *
 * Só reconhece as duas palavras que a coluna existe para dizer. Um terceiro
 * valor não vira "ICMS por padrão" — vira nulo, o trecho sai das duas
 * proporções, e a montagem conta quantos ficaram de fora. É a mesma recusa de
 * `@workspace/fechamento/dominio`: um canal que não reconhecemos não é
 * adivinhado.
 */
function tributoDe(fato: LinhaDeFato | undefined): "ICMS" | "ISS" | null {
  if (!fato || fato.is_null) return null;
  const texto = (fato.value_text ?? "").trim().toUpperCase();
  if (texto === "ICMS") return "ICMS";
  if (texto === "ISS") return "ISS";
  return null;
}
