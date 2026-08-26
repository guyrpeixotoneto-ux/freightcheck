/**
 * O que o banco realmente respondeu — e não o envelope que o driver mostra.
 *
 * ---------------------------------------------------------------------------
 * O defeito medido que este módulo existe para corrigir
 * ---------------------------------------------------------------------------
 * O drizzle embrulha toda falha de consulta num `DrizzleQueryError` cuja
 * `message` é o SQL e os parâmetros — nunca o motivo. O motivo fica em
 * `err.cause`, e quem guarda só `err.message` publica 110 vezes a mesma frase
 * sem informação nenhuma:
 *
 *     trecho.frete_liquido: Failed query: select "id", "code", ... from "attribute" where ...
 *     params: trecho.frete_liquido
 *
 * Em 26/08/2026 essa saída foi produzida por `curar:direcao-economica-trecho`
 * e não permitiu decidir nada. Medido neste repositório, o **mesmo texto**, byte
 * a byte, sai de causas que pedem ações opostas:
 *
 * | causa real                        | `cause.code` | o que fazer            |
 * |-----------------------------------|--------------|------------------------|
 * | `ALTER TABLE attribute DROP COLUMN change_rule` | `42703` | rodar migration        |
 * | porta fechada                     | `ECONNREFUSED` | corrigir `DATABASE_URL` |
 * | host inexistente                  | `ENOTFOUND`  | corrigir `DATABASE_URL` |
 * | banco inexistente                 | `3D000`      | criar/apontar o banco  |
 * | `statement_timeout` estourado     | `57014`      | investigar a consulta  |
 *
 * Sem abrir a `cause` **não existe** como distinguir schema atrasado de banco
 * fora do ar. É por isso que este módulo é uma peça só, compartilhada: a
 * alternativa é cada CLI ter a sua cópia da tabela acima, e elas divergirem.
 *
 * ---------------------------------------------------------------------------
 * Como o SQLSTATE é separado do código de rede
 * ---------------------------------------------------------------------------
 * Os dois chegam em `cause.code`, como string. Um SQLSTATE tem exatamente
 * cinco caracteres e **começa por dígito** (`42703`, `3D000`, `57014`); um
 * código de socket começa por `E`. O teste de comprimento sozinho não serve:
 * `EPIPE` também tem cinco caracteres — daí a âncora no dígito inicial.
 */

/** O que aconteceu, no nível em que a decisão muda. */
export type ClasseDeFalhaDoBanco =
  /** O banco respondeu que um objeto que o código declara não existe lá. */
  | "SCHEMA_ATRASADO"
  /** O banco nomeado na URL não existe. */
  | "BANCO_INEXISTENTE"
  /** Usuário ou senha recusados. */
  | "AUTENTICACAO"
  /** Conectou e autenticou, mas o papel não tem permissão no objeto. */
  | "PERMISSAO"
  /** Não houve conversa: porta fechada, host errado, rede no meio. */
  | "CONEXAO"
  /** Houve espera até o teto — de conexão ou de consulta. */
  | "TIMEOUT"
  /** O Postgres respondeu um erro que não é nenhum dos acima. */
  | "OUTRO_ERRO_DO_BANCO"
  /**
   * Não veio do banco: é uma regra da própria aplicação (um `throw` nosso).
   * Nunca é estrutural — a próxima linha pode perfeitamente dar certo.
   */
  | "FALHA_DA_APLICACAO";

export interface FalhaDoBanco {
  classe: ClasseDeFalhaDoBanco;
  /**
   * A causa é a mesma para toda linha que vier depois?
   *
   * É o que autoriza quem chamou a parar no primeiro erro em vez de repetir a
   * tentativa 110 vezes. `FALHA_DA_APLICACAO` é o único caso em que continuar
   * faz sentido: ela fala de uma linha, não do banco.
   */
  estrutural: boolean;
  /** SQLSTATE, quando o Postgres chegou a responder. */
  sqlstate: string | null;
  /** Código do socket (`ECONNREFUSED`, `ENOTFOUND`…), quando foi rede. */
  codigoDeRede: string | null;
  /** A mensagem real — a do Postgres ou a do socket, nunca a do envelope. */
  mensagem: string;
  /** O objeto que o banco disse não existir, quando ele disse. */
  objetoAusente: string | null;
  /** O que fazer, em uma linha. */
  saida: string;
}

/** SQLSTATE: cinco caracteres começando por dígito. `EPIPE` não passa. */
function ehSqlstate(code: unknown): code is string {
  return typeof code === "string" && /^[0-9][0-9A-Z]{4}$/.test(code);
}

/**
 * Códigos de socket que significam "não houve conversa".
 *
 * `ETIMEDOUT` fica de fora de propósito: esperar até o teto é outra decisão
 * (aumentar o limite, investigar a rede) e por isso é `TIMEOUT`.
 */
const REDE_SEM_CONVERSA = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
  "EAI_AGAIN",
]);

const POR_SQLSTATE: Record<string, { classe: ClasseDeFalhaDoBanco; saida: string }> = {
  // Classe 42 — objeto que o código declara e o banco não tem.
  "42703": {
    classe: "SCHEMA_ATRASADO",
    saida:
      "Falta uma coluna que este build declara. Confira o schema inteiro antes de mexer: " +
      "pnpm --filter @workspace/db run conferir-schema",
  },
  "42P01": {
    classe: "SCHEMA_ATRASADO",
    saida:
      "Falta uma tabela que este build declara. Confira o schema inteiro antes de mexer: " +
      "pnpm --filter @workspace/db run conferir-schema",
  },
  "42883": {
    classe: "SCHEMA_ATRASADO",
    saida:
      "Falta uma função que este build declara: pnpm --filter @workspace/db run conferir-schema",
  },
  "3F000": {
    classe: "SCHEMA_ATRASADO",
    saida: "O schema nomeado não existe neste banco — confira se a URL aponta para o banco certo.",
  },
  "3D000": {
    classe: "BANCO_INEXISTENTE",
    saida: "O banco nomeado em DATABASE_URL não existe. Confira o nome, ou crie-o.",
  },
  "28P01": { classe: "AUTENTICACAO", saida: "Senha recusada — confira as credenciais em DATABASE_URL." },
  "28000": { classe: "AUTENTICACAO", saida: "Autenticação recusada — confira usuário e host em DATABASE_URL." },
  "42501": { classe: "PERMISSAO", saida: "O papel conectado não tem permissão neste objeto." },
  "57014": {
    classe: "TIMEOUT",
    saida:
      "A consulta passou do statement_timeout (padrão 120s, DB_STATEMENT_TIMEOUT_MS). " +
      "O banco respondeu — ele só não terminou a tempo.",
  },
  "53300": { classe: "CONEXAO", saida: "O banco está sem conexões livres (too_many_connections)." },
  "57P03": { classe: "CONEXAO", saida: "O banco está subindo e ainda não aceita conexão." },
};

/** `column "change_rule" does not exist` → `change_rule`. */
function objetoDaMensagem(mensagem: string): string | null {
  const achado = /(?:column|relation|function|table)\s+"?([a-zA-Z0-9_.]+)"?\s+does not exist/i.exec(
    mensagem,
  );
  return achado?.[1] ?? null;
}

/**
 * A falha, lida onde ela realmente está.
 *
 * Olha `err.cause` primeiro e cai para o próprio `err` — o driver nem sempre
 * embrulha, e um erro do `pg` pode chegar cru. Um erro sem `code` e sem cause
 * é da aplicação: `definirDirecaoEconomica` lança `Atributo "x" não
 * encontrado`, que fala de uma linha e não do banco.
 */
export function descreverFalhaDoBanco(err: unknown): FalhaDoBanco {
  const envelope = err as { message?: unknown; cause?: unknown } | null | undefined;
  const causa = (envelope?.cause ?? err) as
    | { message?: unknown; code?: unknown; severity?: unknown }
    | null
    | undefined;

  const mensagem =
    typeof causa?.message === "string" && causa.message.trim() !== ""
      ? causa.message
      : typeof envelope?.message === "string"
        ? envelope.message
        : String(err);

  const code = causa?.code;

  if (ehSqlstate(code)) {
    const conhecido = POR_SQLSTATE[code];
    return {
      classe: conhecido?.classe ?? "OUTRO_ERRO_DO_BANCO",
      estrutural: true,
      sqlstate: code,
      codigoDeRede: null,
      mensagem,
      objetoAusente: objetoDaMensagem(mensagem),
      saida:
        conhecido?.saida ??
        `O Postgres recusou com SQLSTATE ${code}. A mensagem acima é a dele, não a do driver.`,
    };
  }

  if (typeof code === "string" && code !== "") {
    const timeout = code === "ETIMEDOUT";
    return {
      classe: timeout ? "TIMEOUT" : REDE_SEM_CONVERSA.has(code) ? "CONEXAO" : "OUTRO_ERRO_DO_BANCO",
      estrutural: true,
      sqlstate: null,
      codigoDeRede: code,
      mensagem,
      objetoAusente: null,
      saida: timeout
        ? "A conexão passou do teto de espera (DB_CONNECT_TIMEOUT_MS, padrão 10s). " +
          "O banco não respondeu a tempo — não é schema."
        : "Não houve conversa com o banco: confira host, porta e rede em DATABASE_URL. " +
          "Nada foi lido, então isto não diz nada sobre o schema.",
    };
  }

  /*
    O timeout de conexão do `pg` chega sem `code` nenhum — só a frase. Sem este
    ramo ele cairia em FALHA_DA_APLICACAO e quem chamou insistiria 110 vezes
    contra um banco que não respondeu uma única vez.
  */
  if (/connection timeout|timeout exceeded when trying to connect/i.test(mensagem)) {
    return {
      classe: "TIMEOUT",
      estrutural: true,
      sqlstate: null,
      codigoDeRede: null,
      mensagem,
      objetoAusente: null,
      saida:
        "A conexão passou do teto de espera (DB_CONNECT_TIMEOUT_MS, padrão 10s). " +
        "O banco não respondeu a tempo — não é schema.",
    };
  }

  return {
    classe: "FALHA_DA_APLICACAO",
    estrutural: false,
    sqlstate: null,
    codigoDeRede: null,
    mensagem,
    objetoAusente: null,
    saida: "Falha desta linha, não do banco — as demais continuam valendo a tentativa.",
  };
}

/**
 * A falha em linhas legíveis, com a causa sempre presente.
 *
 * O formato é fixo porque ele é o que um teste consegue exigir: se um dia
 * alguém voltar a publicar só o envelope, a asserção de que o SQLSTATE aparece
 * na saída quebra.
 */
export function textoDaFalhaDoBanco(falha: FalhaDoBanco): string[] {
  const identificador = falha.sqlstate
    ? `SQLSTATE ${falha.sqlstate}`
    : falha.codigoDeRede
      ? `código ${falha.codigoDeRede}`
      : "sem código";
  return [
    `  Classe:   ${falha.classe} (${identificador})`,
    `  Postgres: ${falha.mensagem}`,
    ...(falha.objetoAusente ? [`  Objeto:   ${falha.objetoAusente}`] : []),
    `  Saída:    ${falha.saida}`,
  ];
}
