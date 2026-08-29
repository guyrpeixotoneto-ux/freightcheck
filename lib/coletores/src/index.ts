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
 *
 * ---------------------------------------------------------------------------
 * Os três coletores ligados, e o que cada um afirma
 * ---------------------------------------------------------------------------
 *
 * | chave                   | fonte                        | afirma                                   |
 * | ----------------------- | ---------------------------- | ---------------------------------------- |
 * | `cte.autorizacao_sefaz` | 03.08.15 + chave de acesso   | há evidência fiscal rastreável na SEFAZ  |
 * | `cte.emissao`           | 03.08.15                     | houve emissão registrada na quinzena     |
 * | `operacao.transporte`   | 2Art (`OPERACAO`)            | a operação da quinzena está no diário    |
 *
 * Os dois últimos fazem **afirmação de presença**, e por isso não têm vermelho:
 * ver `farolDaPresenca`, em `fonte-da-quinzena.ts`, onde a recusa do vermelho
 * está argumentada. Os três compartilham a mesma regra de validade — dezesseis
 * dias, a quinzena da fonte mais um dia —, porque a fonte dos três é um arquivo
 * enviado por quinzena e não um serviço consultável.
 *
 * As chaves que **não** ganharam coletor, e não por falta de trabalho: as etapas
 * financeiras do fluxo do CTe (`faturamento.fatura`, `financeiro.recebimento`,
 * `financeiro.conciliacao`) descrevem o ciclo de recebíveis da **transportadora**
 * — fatura, NFS-e, boleto, extrato bancário, baixa de título —, e nenhum desses
 * documentos existe neste banco. O que existe é o fechamento da Ambev, que é
 * outra coisa: um demonstrativo do que o tomador vai pagar não é comprovante de
 * que o dinheiro entrou, e pintar de verde a etapa "Recebimento" por causa dele
 * seria a mentira mais cara que este produto tem à mão.
 */
export * from "./cte-autorizacao-sefaz";
export * from "./cte-emissao";
export * from "./operacao-transporte";
export * from "./fonte-da-quinzena";
