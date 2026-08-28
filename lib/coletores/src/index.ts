/**
 * OS COLETORES — onde o domínio encontra o contrato de monitoramento.
 *
 * Este pacote existe para que `lib/fluxos` continue não sabendo o que é um CT-e.
 * O motor define `Coletor` e nunca implementa nenhum; o fechamento é dono do
 * extrato fiscal e não sabe que fluxos existem; e a costura entre os dois mora
 * aqui, que é o único lugar que pode falar as duas línguas.
 *
 * Quem monta o registro é o arranque da aplicação, com a conexão na mão:
 *
 *     const registro = registroDeColetores(coletorDeAutorizacaoSefaz(db));
 *     const farol = await monitorarFluxo(registro, empresaId, completo);
 *
 * Repare no que não aparece nessa chamada: `db`. Ele entra no coletor, que é
 * quem tem fonte; `monitorarFluxo` continua recebendo o fluxo que a rota já leu.
 */
export * from "./cte-autorizacao-sefaz";
