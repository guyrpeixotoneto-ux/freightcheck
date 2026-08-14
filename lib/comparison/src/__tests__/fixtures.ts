/**
 * As fixtures sintéticas moveram-se para `../testing.ts`.
 *
 * O motivo foi um consumidor de fora: `@workspace/composition` precisa montar a
 * mesma camada canônica controlada para testar o seu motor, e alcançar o
 * `__tests__` de outro pacote por caminho relativo é dependência sem contrato —
 * o dia em que este arquivo mudasse de lugar, o outro pacote quebrava sem que
 * nada aqui dissesse que alguém dependia dele.
 *
 * Agora a fixture é superfície declarada (`@workspace/comparison/testing`) e
 * este arquivo é o atalho que os doze testes deste pacote já usavam.
 */
export * from "../testing";
