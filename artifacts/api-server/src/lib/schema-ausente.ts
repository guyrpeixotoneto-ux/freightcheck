import type { Response } from "express";
import { codigoDoPostgres } from "@workspace/db";
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

/** Os SQLSTATEs que dizem "esta parte do schema não existe aqui". */
const SCHEMA_AUSENTE = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42704", // undefined_object — um tipo
]);

/**
 * O erro é schema ausente, e não defeito do pedido?
 *
 * `42703` é o mais traiçoeiro dos três: quando uma migration cria a tabela e a
 * seguinte lhe acrescenta colunas, um banco parado no meio tem a tabela — então
 * nada indica "falta migration" — e toda consulta morre por causa de uma coluna.
 */
export function faltaSchema(err: unknown): boolean {
  return SCHEMA_AUSENTE.has(codigoDoPostgres(err) ?? "");
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
