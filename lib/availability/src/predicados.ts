import { sql, type SQL } from "drizzle-orm";
import type { ChaveDeContexto, ChaveDeSerie } from "./modelo";

/**
 * Os predicados da disponibilidade — a fronteira de domínio, em SQL.
 *
 * Nenhuma consulta do produto deve escrever estes predicados por conta própria.
 * Hoje `status <> 'SUPERSEDED'` está copiado à mão em cerca de sessenta lugares,
 * e `getOverview` esqueceu-o em cinco contadores: o Painel conta os fatos de
 * revisões substituídas. Sessenta cópias de uma regra são sessenta chances de
 * esquecer uma.
 *
 * Eles são exportados como fragmento, e não escondidos atrás de uma função que
 * monta a consulta inteira, porque a migração dos consumidores precisa ser
 * possível **um de cada vez**: quem já tem uma consulta grande troca a linha do
 * `WHERE` e fica correto, sem reescrever a leitura.
 */

// ---------------------------------------------------------------------------
// Vigência disponível
// ---------------------------------------------------------------------------

/**
 * O que é uma vigência disponível: `status = 'CLOSED'`, e nada mais.
 *
 * **É afirmação, não exclusão.** As sessenta consultas do produto dizem
 * `<> 'SUPERSEDED'`, que descreve o que a vigência não é. Os dois predicados
 * dão hoje o mesmo conjunto, e por uma razão medida: `DRAFT` não é observável.
 * Ele existe apenas dentro da transação da promoção — ou vira `CLOSED` no mesmo
 * commit, ou a transação volta atrás inteira. Uma promoção recusada por escopo
 * ausente deixa **zero** linhas em `snapshot` (medido).
 *
 * Ficar com a forma afirmativa é o que faz o predicado dizer a regra em vez de
 * listar as exceções — e é o que continuaria correto se um dia existisse um
 * quarto estado.
 */
export function filtroDeVigenciaDisponivel(alias = "s"): SQL {
  return sql`${sql.raw(`${alias}.status`)} = 'CLOSED'`;
}

// ---------------------------------------------------------------------------
// As chaves
// ---------------------------------------------------------------------------

/**
 * A serialização de um contexto: canal e escopo canônico.
 *
 * `freightcheck_serialize_scope` é a função que a própria identidade canônica
 * usa (`0015_canonical_identity.sql`): ela ordena por byte e junta com os
 * mesmos separadores de controle. Reusá-la é o que garante que a chave de
 * contexto e a chave da vigência falem a mesma língua — e é o que impede a
 * volta do `scope_hash`, que é hash dos códigos **como vieram** e por isso
 * parte a mesma unidade em duas quando o CNPJ chega mascarado.
 */
function serializacaoDoContexto(alias: string): SQL {
  const a = (col: string) => sql.raw(`${alias}.${col}`);
  return sql`${a("canal")} || chr(31) || freightcheck_serialize_scope(${a("canonical_scope")})`;
}

/**
 * A chave do **escopo**: hash estável do escopo canônico, sem o canal.
 *
 * Existe separada porque a leitura ainda modela o contexto como um par
 * (escopo, canal) em vez de uma chave só, e trocar isso é maior do que trocar
 * o que identifica o escopo. Enquanto o par existir, é esta a metade que
 * substitui `snapshot.scope_hash` — que é hash dos códigos **como vieram** e
 * por isso parte a mesma unidade em duas quando o CNPJ chega mascarado.
 */
export function chaveDeEscopoSql(alias = "s"): SQL {
  return sql`encode(sha256(convert_to(
    freightcheck_serialize_scope(${sql.raw(`${alias}.canonical_scope`)}), 'UTF8')), 'hex')`;
}

/** A chave de contexto: hash estável da serialização acima. */
export function chaveDeContextoSql(alias = "s"): SQL {
  return sql`encode(sha256(convert_to(${serializacaoDoContexto(alias)}, 'UTF8')), 'hex')`;
}

/**
 * A chave de série: sistema, família e o contexto.
 *
 * É a identidade canônica da vigência **sem a data** — a data é a ordem dentro
 * da série, não a identidade dela. Ficam de fora, e cada uma por um motivo que
 * a auditoria mediu: `entity_type_set` porque cresce com entrega parcial,
 * `scope_hash` porque o próprio schema o aposentou, `source_label` porque
 * derivar identidade da forma como o dado chegou foi o defeito original.
 */
export function chaveDeSerieSql(alias = "s"): SQL {
  const a = (col: string) => sql.raw(`${alias}.${col}`);
  return sql`encode(sha256(convert_to(
    ${a("source_system")} || chr(31) || ${a("dataset_family")} || chr(31)
      || ${serializacaoDoContexto(alias)}, 'UTF8')), 'hex')`;
}

// ---------------------------------------------------------------------------
// Recorte
// ---------------------------------------------------------------------------

/** Só as vigências deste contexto. */
export function filtroDeContexto(chave: ChaveDeContexto, alias = "s"): SQL {
  return sql`${chaveDeContextoSql(alias)} = ${chave}`;
}

/** Só as vigências desta série. */
export function filtroDeSerie(chave: ChaveDeSerie, alias = "s"): SQL {
  return sql`${chaveDeSerieSql(alias)} = ${chave}`;
}
