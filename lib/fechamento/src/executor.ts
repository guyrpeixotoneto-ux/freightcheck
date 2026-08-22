import type { Database } from "@workspace/db";

/**
 * QUEM EXECUTA A ESCRITA — o banco, ou uma transação aberta por outra pessoa.
 *
 * **Por que este tipo existe.** A identidade canônica é escrita em dois lugares
 * que moram em pacotes diferentes: `fechamento_competencia.unidade_id`, aqui, e
 * `remuneracao_unidade.unidade_id`, na borda (`api-server`), que é o único lugar
 * onde os dois pacotes se veem. As duas escritas são **uma afirmação só** — "esta
 * unidade é esta" —, e meia afirmação gravada é pior do que nenhuma: foi
 * exatamente a assimetria entre elas que fez associar uma competência derrubar o
 * devido que já saía.
 *
 * Para que as duas caibam na mesma transação, quem as executa precisa poder ser
 * o `db` ou o `tx`. É só isso que este tipo diz.
 *
 * **Por que uma união, e não um `Pick` das operações usadas.** A união é aceita
 * pelo TypeScript nas chamadas de `select`, `update` e `execute` — foi conferido
 * — e não obriga a manter uma lista de métodos que envelheceria a cada consulta
 * nova. O `Pick` diria a mesma coisa e pediria manutenção.
 */
export type Transacao = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** O banco, ou uma transação já aberta. Ver o cabeçalho. */
export type Executor = Database | Transacao;
