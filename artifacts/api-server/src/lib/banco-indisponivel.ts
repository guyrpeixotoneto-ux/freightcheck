import type { Response } from "express";
import { erroDoPostgres } from "@workspace/db";
import {
  diagnosticar,
  textoDoDiagnostico,
  type Diagnostico,
} from "@workspace/db/diagnostico";

/**
 * A resposta de uma rota cuja consulta não chegou ao banco.
 *
 * ---------------------------------------------------------------------------
 * O buraco que isto fecha
 * ---------------------------------------------------------------------------
 * O contrato de erro deste servidor sabia responder duas classes de falha de
 * ambiente com diagnóstico — o schema que falta (`faltaSchema`) e a regra
 * fechada de antes deste build (`regraDeMigrationPendente`). A terceira, e a
 * mais banal delas, caía no 500 genérico: **o banco não respondeu**.
 *
 * O efeito estava na tela de login. Com o banco fora, `POST /auth/login`
 * respondia "Não foi possível concluir o login" — que é indistinguível de
 * senha errada para quem lê, e manda a pessoa tentar de novo a credencial
 * certa — ou "O servidor falhou ao processar este pedido", que manda procurar
 * defeito onde não há. As duas frases descrevem o que a rota viu; nenhuma
 * descreve o que houve.
 *
 * ---------------------------------------------------------------------------
 * Quem classifica é `diagnosticar`, a partir da falha que acabou de acontecer
 * ---------------------------------------------------------------------------
 * E **não** de uma segunda observação do banco. A diferença importa num caso
 * real: uma queda de instantes: perguntar de novo pode encontrar o banco de
 * volta e produzir "nenhuma ação é necessária" ao lado de uma chamada que
 * acabou de morrer sem conseguir falar com ele — o par contraditório que este
 * repositório inteiro existe para tornar irrepresentável. A consulta que
 * falhou **é** a observação, e é ela que atravessa.
 */

/**
 * Os sinais de que a consulta não chegou ao banco — ou não voltou dele.
 *
 * Duas famílias, e as duas vêm do mesmo campo `code`, que `erroDoPostgres`
 * encontra atravessando a corrente de `cause`:
 *
 * - **errno do Node**, quando nem houve conversa: a conexão foi recusada, o
 *   nome não resolveu, o tempo estourou, o soquete morreu.
 * - **SQLSTATE da classe 08 e vizinhos**, quando houve conversa e ela terminou
 *   mal: conexão recusada pelo servidor, desligamento administrativo,
 *   credencial da `DATABASE_URL` recusada, banco inexistente no endereço.
 *
 * O que **não** entra: nenhum código de erro de consulta. Um `42P01` é schema
 * ausente e tem dono (`schema-ausente.ts`); um `23505` é dado e é recusa de
 * domínio. Tratar um deles como banco fora mandaria alguém olhar a
 * infraestrutura por causa de uma linha de SQL — o espelho exato do defeito
 * que este arquivo corrige.
 */
const NAO_CHEGOU: ReadonlySet<string> = new Set([
  // Node — a conexão não se estabeleceu, ou caiu no meio.
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  // Postgres, classe 08 — connection_exception e suas variantes.
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  // O servidor encerrou por decisão dele: failover, restart, idle timeout.
  "57P01",
  "57P02",
  "57P03",
  // Não há conexão sobrando, e portanto não há como consultar.
  "53300",
  // A `DATABASE_URL` chegou e o banco a recusou — endereço ou credencial.
  "28P01",
  "28000",
  "3D000",
]);

/** O código que diz "não chegou ao banco", quando o erro traz um. */
export function codigoDeIndisponibilidade(err: unknown): string | undefined {
  const codigo = erroDoPostgres(err)?.code;
  return codigo !== undefined && NAO_CHEGOU.has(codigo) ? codigo : undefined;
}

/** Esta falha é o banco não tendo respondido? */
export function bancoIndisponivel(err: unknown): boolean {
  return codigoDeIndisponibilidade(err) !== undefined;
}

/**
 * O diagnóstico desta indisponibilidade, classificado pela autoridade única.
 *
 * O estado observado é montado a partir da falha: a variável chegou (houve
 * tentativa de conexão), o banco não respondeu, e o código é o que a tentativa
 * devolveu. `diagnosticar` faz o resto — inclusive escolher entre "o banco não
 * respondeu no endereço", "recusou as credenciais" e "o banco não existe", que
 * são três coisas diferentes e mandam fazer três coisas diferentes.
 */
export function diagnosticoDaIndisponibilidade(err: unknown): Diagnostico {
  const codigo = codigoDeIndisponibilidade(err);
  return diagnosticar({
    configurada: true,
    alcancavel: false,
    ...(codigo ? { codigoDeConexao: codigo } : {}),
    pendentes: [],
    aplicadas: 0,
  });
}

/** O `code` que a interface lê quando a chamada não chegou ao banco. */
export const CODIGO_BANCO_INDISPONIVEL = "BANCO_INDISPONIVEL";

export interface CorpoDeBancoIndisponivel {
  /** O texto corrido, para quem lê por `curl` ou no log. */
  error: string;
  code: typeof CODIGO_BANCO_INDISPONIVEL;
  /** O que esta chamada sabe: qual pedido parou, e que nada foi gravado. */
  contexto: string;
  /** O estado do ambiente, classificado pela autoridade única. */
  diagnostico: Diagnostico;
  /**
   * O endereço da linha de log desta chamada.
   *
   * Sai como texto porque é assim que ele atravessa: o `req.id` do `pino-http`
   * é número ou string conforme o gerador, e a interface o mostra para ser
   * copiado — dois formatos possíveis num campo que se lê em voz alta é um
   * campo que se transcreve errado.
   */
  requestId?: string;
}

/**
 * Responde 503 com o contexto da chamada e o diagnóstico do ambiente.
 *
 * 503 e não 500, pela mesma razão de `responderSchemaAusente`: é
 * indisponibilidade temporária deste ambiente, e não defeito do pedido. A
 * diferença é o que quem está na tela faz a seguir — esperar e repetir, em vez
 * de procurar o que há de errado com o que enviou.
 *
 * `Retry-After` porque a resposta certa é mesmo voltar: o cliente que respeita
 * o cabeçalho volta sozinho, e a tela repete sem ninguém mandar.
 */
export function responderBancoIndisponivel(
  res: Response,
  contexto: string,
  err: unknown,
  /*
    `req.id` do `pino-http` é declarado como `string | number | object` — o
    gerador é configurável. Entra como `unknown` e sai como texto ou não sai:
    um `[object Object]` num campo feito para ser lido em voz alta é pior do
    que campo ausente.
  */
  requestId?: unknown,
): void {
  const diagnostico = diagnosticoDaIndisponibilidade(err);
  const identificador =
    typeof requestId === "string" || typeof requestId === "number"
      ? String(requestId)
      : undefined;
  const corpo: CorpoDeBancoIndisponivel = {
    error: `${contexto} ${textoDoDiagnostico(diagnostico)}`,
    code: CODIGO_BANCO_INDISPONIVEL,
    contexto,
    diagnostico,
    ...(identificador !== undefined ? { requestId: identificador } : {}),
  };
  res.setHeader("Retry-After", "5");
  res.status(503).json(corpo);
}
