/**
 * AS RECUSAS DA GESTÃO — as do portão estão em `decisao.ts`, e são outras.
 *
 * A separação não é arrumação: são dois interlocutores. `decisao.ts` fala com
 * **a máquina** que apresentou uma chave, e responde 401/403 com uma frase que
 * quem configurou vai ler num log; estas falam com **a pessoa** que está na
 * tela de Integrações criando ou revogando alguma coisa, e sobem pelo contrato
 * de erro do servidor como qualquer outra recusa de domínio deste produto
 * (`artifacts/api-server/src/lib/recusa-de-dominio.ts`).
 *
 * Por que classes, e não `res.status(400)` na rota: o status de cada recusa
 * mora numa tabela só, e a frase mora no domínio. É o que permite a esta regra
 * ganhar uma segunda superfície — uma CLI que emite chave, por exemplo — sem
 * que ninguém precise reescrever nem o texto nem o código HTTP.
 */

/** Qualquer recusa da gestão de integrações. 400 por padrão. */
export class RecusaDeIntegracao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RecusaDeIntegracao";
  }
}

/** O id não é de nenhuma integração deste banco. 404. */
export class IntegracaoNaoEncontrada extends RecusaDeIntegracao {
  constructor(mensagem = "Esta integração não existe.") {
    super(mensagem);
    this.name = "IntegracaoNaoEncontrada";
  }
}

/** Já existe uma integração com esse nome. 409 — o estado é que responde. */
export class NomeDeIntegracaoJaUsado extends RecusaDeIntegracao {
  constructor(nome: string) {
    super(
      `Já existe uma integração chamada "${nome}". Dois nomes iguais na lista ` +
        "seriam duas linhas indistinguíveis no log de chamadas — escolha outro " +
        "nome, ou emita uma chave nova na integração que já existe.",
    );
    this.name = "NomeDeIntegracaoJaUsado";
  }
}

/**
 * O que uma integração precisa trazer para ser criada, conferido longe do HTTP.
 *
 * A validação devolve o valor limpo em vez de só dizer "ok": aparar o nome é
 * parte da regra, e deixar isso para a rota faria o espaço no fim do nome
 * chegar ao banco no dia em que alguém escrevesse a segunda rota.
 */
export interface DadosDaIntegracao {
  nome: string;
  sistema: string;
  descricao: string | null;
}

export function conferirDadosDaIntegracao(corpo: unknown): DadosDaIntegracao {
  if (typeof corpo !== "object" || corpo === null) {
    throw new RecusaDeIntegracao("Envie um JSON com nome e sistema.");
  }
  const { nome, sistema, descricao } = corpo as Record<string, unknown>;

  const nomeLimpo = typeof nome === "string" ? nome.trim() : "";
  if (nomeLimpo === "") {
    throw new RecusaDeIntegracao(
      "A integração precisa de um nome — é ele que aparece no log de chamadas.",
    );
  }
  if (nomeLimpo.length > 120) {
    throw new RecusaDeIntegracao("O nome da integração é longo demais.");
  }

  const sistemaLimpo = typeof sistema === "string" ? sistema.trim() : "";
  if (sistemaLimpo === "") {
    throw new RecusaDeIntegracao(
      "Diga que sistema está do outro lado — Freightec, o ERP, um script da " +
        "operação. É o que permite entender o log meses depois.",
    );
  }
  if (sistemaLimpo.length > 120) {
    throw new RecusaDeIntegracao("O nome do sistema é longo demais.");
  }

  const descricaoLimpa =
    typeof descricao === "string" && descricao.trim() !== "" ? descricao.trim() : null;
  if (descricaoLimpa !== null && descricaoLimpa.length > 2000) {
    throw new RecusaDeIntegracao("A descrição é longa demais.");
  }

  return { nome: nomeLimpo, sistema: sistemaLimpo, descricao: descricaoLimpa };
}
