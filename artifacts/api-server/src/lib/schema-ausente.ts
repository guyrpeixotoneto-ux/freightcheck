import type { Response } from "express";
import { erroDoPostgres } from "@workspace/db";
import {
  diagnosticar,
  textoDoDiagnostico,
  type Diagnostico,
} from "@workspace/db/diagnostico";
import { observarBanco } from "./migrations";

/**
 * A resposta de uma rota que esbarrou num schema que este banco não tem.
 *
 * Cada rota trazia a sua própria — e a de Chamados prescrevia "suba o servidor
 * de novo ou rode `migrate`" num banco onde reiniciar era exatamente o que não
 * funcionava, enquanto o `/api/healthz` dizia o contrário na mesma tela. As
 * rotas escreviam remédio sem ter como saber o estado do banco.
 *
 * Aqui a rota contribui só o que ela sabe e mais ninguém: **qual** schema falta
 * e o que isso significa para o arquivo de quem está do outro lado. O que
 * aconteceu com o banco, se há risco e o que resolve vêm de `diagnosticar`, que
 * é a mesma autoridade que responde ao `/healthz`. Nenhuma rota pode contradizê-
 * lo porque nenhuma rota escreve recomendação.
 */

/**
 * Os SQLSTATEs que, sozinhos, já dizem "esta parte do schema não existe aqui".
 *
 * Os quatro descrevem o mesmo desfecho por ângulos diferentes: uma migration
 * criaria o objeto e não rodou neste banco. Nenhum deles é defeito do pedido, e
 * é por isso que estão juntos — a lista é a autoridade, e as rotas só perguntam.
 */
const SCHEMA_AUSENTE = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42704", // undefined_object — um tipo
  "42883", // undefined_function
]);

/**
 * A função do Postgres que procura o índice de um `ON CONFLICT`.
 *
 * `42P10` sozinho não decide nada — ver `faltaSchema`. Este nome é o que decide,
 * e ele vem do campo `routine` do protocolo: o nome da função em C que levantou
 * o erro. Não é mensagem, não é traduzido e não muda com `lc_messages`.
 */
const ROTINA_DO_ON_CONFLICT = "infer_arbiter_indexes";

/**
 * O erro é schema ausente, e não defeito do pedido?
 *
 * `42703` é o mais traiçoeiro do grupo: quando uma migration cria a tabela e a
 * seguinte lhe acrescenta colunas, um banco parado no meio tem a tabela — então
 * nada indica "falta migration" — e toda consulta morre por causa de uma coluna.
 *
 * **`42883` é o mesmo caso, uma camada abaixo.** Várias migrations deste projeto
 * criam funções antes de usá-las — `freightcheck_snapshot_key` sustenta a coluna
 * gerada `canonical_snapshot_key`, e os gatilhos de imutabilidade são funções.
 * Num banco atrasado a tabela existe e a função não, e o que morre é a chamada.
 *
 * **`42P10` é o único que não entra pelo código.** Ele é `invalid_column_
 * reference`, e o Postgres 16 o levanta por quatro caminhos — medidos, não
 * supostos:
 *
 * | o que aconteceu                                   | `routine`                  |
 * | ------------------------------------------------- | -------------------------- |
 * | `ON CONFLICT` sem índice único que case            | `infer_arbiter_indexes`    |
 * | `ORDER BY 5` fora da lista de seleção              | `findTargetlistEntrySQL92` |
 * | `GROUP BY 5` fora da lista de seleção              | `findTargetlistEntrySQL92` |
 * | `DISTINCT ON` divergindo do `ORDER BY`             | `transformDistinctOnClause`|
 *
 * Só o primeiro é schema: todo `ON CONFLICT` com alvo neste repositório aponta
 * para um índice que uma migration cria — `source_file.content_sha256` na 0000,
 * `coverage_expectation_uq` e `snapshot_entity_type_uq` na 0021. Os outros três
 * são defeito nosso, e classificá-los como banco atrasado mandaria alguém rodar
 * migrations por causa de uma consulta mal escrita. Por isso a pergunta é pelo
 * `routine`, e não pelo SQLSTATE sozinho.
 *
 * O que acontece se um dia esse nome mudar no Postgres: um índice de verdade
 * ausente deixa de ganhar o 503 com diagnóstico e cai no 500 genérico. Perde-se
 * a explicação, não a correção — e nunca o contrário, que seria um defeito
 * nosso disfarçado de migration faltando.
 */
export function faltaSchema(err: unknown): boolean {
  const doPostgres = erroDoPostgres(err);
  if (!doPostgres) return false;
  if (SCHEMA_AUSENTE.has(doPostgres.code)) return true;
  return (
    doPostgres.code === "42P10" && doPostgres.routine === ROTINA_DO_ON_CONFLICT
  );
}

export interface CorpoDeSchemaAusente {
  /** O texto corrido, para quem lê por `curl` ou no log. */
  error: string;
  code: "SCHEMA_AUSENTE";
  /** O que esta rota sabe: qual schema falta, e o que houve com o envio. */
  contexto: string;
  /** O estado do banco, classificado pela autoridade única. */
  diagnostico: Diagnostico;
}

/**
 * Responde 503 com o contexto da rota e o diagnóstico do banco.
 *
 * 503 e não 500: é indisponibilidade temporária deste ambiente, não erro do
 * pedido. "Internal server error" foi o que estas rotas responderam a arquivos
 * perfeitos, e a frase mandava procurar defeito no arquivo.
 *
 * `error` traz o texto inteiro porque quem chama a API sem interface precisa de
 * uma resposta que se baste. A interface ignora esse campo e usa `contexto` e
 * `diagnostico`, para não imprimir a mesma recomendação duas vezes.
 */
export async function responderSchemaAusente(
  res: Response,
  contexto: string,
): Promise<void> {
  /*
    Observar e classificar ficam como dois passos, e não como um `diagnosticar
    Banco()` só. Não é cerimônia: é a costura que deixa o teste trocar o que se
    observou e conferir que a **classificação de verdade** roda por cima. Um
    helper que fizesse as duas coisas por dentro só seria testável mockando a
    classificação — isto é, deixando de testar exatamente o que importa aqui.
  */
  /*
    `objetoAusenteAgora` é o que esta função sabe e a contagem de migrations
    não: uma consulta acabou de morrer por schema. Sem migrations pendentes,
    é a única evidência de que o registro e o banco divergiram — e sem ela a
    resposta trazia "não tem onde guardar" e "nenhuma ação é necessária" no
    mesmo corpo.
  */
  const diagnostico = diagnosticar({
    ...(await observarBanco()),
    objetoAusenteAgora: true,
  });
  const corpo: CorpoDeSchemaAusente = {
    error: `${contexto} ${textoDoDiagnostico(diagnostico)}`,
    code: "SCHEMA_AUSENTE",
    contexto,
    diagnostico,
  };
  res.status(503).json(corpo);
}
