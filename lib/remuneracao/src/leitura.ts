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
import { compararCadastros, type CadastroComparado } from "./comparacao";

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

export interface ContextoDoCadastro {
  scopeHash: string;
  channel: string | null;
  label: string;
  unidade: string | null;
  scopes: { scopeType: string; code: string; name: string | null }[];
}

/** Quantos cavalos e trechos a vigência entregou — o lastro, em números. */
export interface MaterialLido {
  cavalos: number;
  trechos: number;
  trechosEntregues: boolean;
}

export interface CadastroDaUnidade extends CadastroMontado {
  contexto: ContextoDoCadastro;
  effectiveDate: string;
  periodLabel: string;
  /** Todas as vigências desta unidade, para o seletor. */
  vigencias: VigenciaDoCadastro[];
  material: MaterialLido;
}

/** Uma ponta da comparação: a quinzena e o que ela entregou. */
export interface PontaDaComparacao {
  effectiveDate: string;
  periodLabel: string;
  material: MaterialLido;
}

export interface ComparacaoDeCadastros extends CadastroComparado {
  contexto: ContextoDoCadastro;
  /** A quinzena mais antiga do par — a coluna da esquerda. */
  esquerda: PontaDaComparacao;
  /** A mais recente — a coluna da direita, e a que a variação descreve. */
  direita: PontaDaComparacao;
  vigencias: VigenciaDoCadastro[];
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

/**
 * Erro de recusa: esta unidade só entregou uma vigência. Rota traduz em 422.
 *
 * Não é 404 — a unidade existe e o cadastro dela também. O que não existe é o
 * par, e responder 404 mandaria quem está olhando procurar uma unidade que está
 * bem ali. Também não é 400: o pedido está correto, o acervo é que ainda não
 * tem duas quinzenas.
 */
export class ComparacaoSemDuasVigencias extends Error {
  constructor(unidade: string, disponiveis: string[]) {
    super(
      `Comparar duas quinzenas exige duas vigências, e ${unidade} entregou ` +
        `${disponiveis.length === 0 ? "nenhuma" : "uma só"}` +
        `${disponiveis.length === 1 ? ` (${disponiveis[0]})` : ""}. ` +
        "Importe a quinzena seguinte para ver as duas lado a lado.",
    );
    this.name = "ComparacaoSemDuasVigencias";
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
  const effectiveDate = conferirVigencia(contexto, pedido?.period ?? contexto.latestPeriod);
  const { montado, material } = await montarDaVigencia(db, effectiveDate, contexto);

  return {
    ...montado,
    contexto: retratoDo(contexto),
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    vigencias: vigenciasDe(contexto),
    material,
  };
}

/**
 * Duas quinzenas da mesma unidade, lado a lado.
 *
 * É a forma da planilha: a aba de cadastro traz os dois blocos um ao lado do
 * outro, e quem confere lê as duas colunas juntas. Sem pedido explícito, o par
 * são as **duas vigências mais recentes** da unidade — que é o que a pessoa
 * quer ver ao abrir, e é o par que a planilha do mês corrente mostra.
 *
 * A ordem é sempre cronológica, e não a ordem em que o pedido chegou: a coluna
 * da esquerda é a mais antiga, a da direita a mais nova, e a variação descreve
 * o caminho de uma para a outra. Aceitar o par invertido faria a mesma tela
 * dizer "subiu 8%" e "desceu 7,4%" sobre o mesmo movimento, conforme a ordem em
 * que alguém clicou nos seletores.
 *
 * `null` quando o acervo não tem unidade nenhuma; recusa escrita quando a
 * unidade só tem uma vigência ({@link ComparacaoSemDuasVigencias}) ou quando
 * uma das pontas pedidas não existe ({@link VigenciaDoCadastroNaoEncontrada}).
 */
export async function lerComparacaoDeCadastros(
  db: Database,
  pedido?: RequestedContext & { de?: string; ate?: string },
): Promise<ComparacaoDeCadastros | null> {
  const contextos = await listContexts(db);
  if (contextos.length === 0) return null;

  const contexto = (await resolveContext(db, pedido, contextos))!;
  const disponiveis = contexto.periodosDisponiveis;
  if (disponiveis.length < 2) {
    throw new ComparacaoSemDuasVigencias(contexto.label, disponiveis);
  }

  /*
    O padrão são as duas últimas, nesta ordem. `periodosDisponiveis` já vem da
    mais antiga para a mais nova, então as duas últimas posições são o par
    cronológico sem nenhum `sort` a mais.
  */
  const padraoEsquerda = disponiveis[disponiveis.length - 2];
  const padraoDireita = disponiveis[disponiveis.length - 1];

  const pedidas = [
    conferirVigencia(contexto, pedido?.de ?? padraoEsquerda),
    conferirVigencia(contexto, pedido?.ate ?? padraoDireita),
  ].sort();
  const [dataEsquerda, dataDireita] = pedidas;

  const [esquerda, direita] = await Promise.all([
    montarDaVigencia(db, dataEsquerda, contexto),
    montarDaVigencia(db, dataDireita, contexto),
  ]);

  return {
    ...compararCadastros(esquerda.montado, direita.montado),
    contexto: retratoDo(contexto),
    esquerda: {
      effectiveDate: dataEsquerda,
      periodLabel: periodLabel(dataEsquerda),
      material: esquerda.material,
    },
    direita: {
      effectiveDate: dataDireita,
      periodLabel: periodLabel(dataDireita),
      material: direita.material,
    },
    vigencias: vigenciasDe(contexto),
  };
}

/**
 * A vigência pedida, ou a recusa escrita.
 *
 * Aparar em silêncio para a mais próxima daria o número certo sob o título
 * errado — a mesma recusa que `resolverContextoDoQuadro` faz no QLP, pelo mesmo
 * motivo.
 */
function conferirVigencia(contexto: ContextInfo, pedida: string): string {
  if (!contexto.periodosDisponiveis.includes(pedida)) {
    throw new VigenciaDoCadastroNaoEncontrada(pedida, contexto.periodosDisponiveis);
  }
  return pedida;
}

/** Lê o material de uma vigência e monta o cadastro dela. */
async function montarDaVigencia(
  db: Database,
  effectiveDate: string,
  contexto: SeriesContext,
): Promise<{ montado: CadastroMontado; material: MaterialLido }> {
  const [cavalos, trechos, trechosEntregues] = await Promise.all([
    lerCavalos(db, effectiveDate, contexto),
    lerTrechos(db, effectiveDate, contexto),
    serieEntregue(db, TIPO_TRECHO, effectiveDate, contexto),
  ]);

  return {
    montado: montarCadastro({ cavalos, trechos, trechosEntregues }),
    material: { cavalos: cavalos.length, trechos: trechos.length, trechosEntregues },
  };
}

function retratoDo(contexto: ContextInfo): ContextoDoCadastro {
  return {
    scopeHash: contexto.scopeHash,
    channel: contexto.channel,
    label: contexto.label,
    unidade: unidadeDe(contexto),
    scopes: contexto.scopes,
  };
}

function vigenciasDe(contexto: ContextInfo): VigenciaDoCadastro[] {
  return contexto.periodosDisponiveis.map((data) => ({
    effectiveDate: data,
    periodLabel: periodLabel(data),
  }));
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
 * O vocabulário que a coluna `ativo` de fato usa.
 *
 * **`ATIVO` e `PARADO` são os dois valores do export real** — medidos no
 * acervo de CAMAÇARI · EMPURRADA em 19/08/2026: 442 linhas `ATIVO` e 116
 * `PARADO`, nas nove vigências, e nenhum terceiro valor. É a palavra da
 * planilha, e é ela que a contagem tem de entender; `PARADO` é exatamente o
 * que a aba chama de "Total Frota Fixa Inativos".
 *
 * As outras entradas estão aqui porque a mesma coluna chega como booleano
 * tipado em outros exports, e porque `SIM`/`NAO` é a forma que a planilha usa
 * em colunas irmãs. Reconhecê-las não custa nada e evita que o cadastro
 * dependa de qual variante o cliente mandou naquele mês.
 *
 * O que **não** está aqui é um padrão. Qualquer outro texto — inclusive o
 * vazio — é nulo, e nulo não é inativo: é "este veículo não respondeu", que a
 * contagem trata como categoria própria. Um `else return false` faria uma frota
 * inteira aparecer parada no dia em que a Ambev escrevesse a palavra de outro
 * jeito, e ninguém veria.
 */
const DIZ_QUE_SIM = new Set(["ATIVO", "SIM", "S", "TRUE", "VERDADEIRO", "1"]);
const DIZ_QUE_NAO = new Set([
  "PARADO",
  "INATIVO",
  "NAO",
  "NÃO",
  "N",
  "FALSE",
  "FALSO",
  "0",
]);

/** O booleano de um fato, ou nulo — pelo vocabulário acima. */
function booleanoDe(fato: LinhaDeFato | undefined): boolean | null {
  if (!fato || fato.is_null) return null;
  if (fato.value_boolean !== null) return fato.value_boolean;

  const texto = (fato.value_text ?? "").trim().toUpperCase();
  if (DIZ_QUE_SIM.has(texto)) return true;
  if (DIZ_QUE_NAO.has(texto)) return false;

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
