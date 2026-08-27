import type { Request } from "express";
import { db } from "@workspace/db";
import {
  exigirOperacao,
  exigirOperacaoEntreAsDaEntidade,
  normalizarOperacao,
  operacoesDaEntidade,
  type Operacao,
} from "@workspace/comparison";

/**
 * A operação de quem pergunta — o recorte que separa as quatro auditorias.
 *
 * `?operacao=ROTA` não é filtro de tela: é o **ambiente** de onde a pergunta
 * saiu. A Auditoria Rota não pode ver uma vigência de empurrada nem somar um
 * centavo dela, e o servidor é onde essa garantia mora — o cliente manda a
 * operação em toda chamada (`lib/api.ts`, no navegador), mas quem recusa é
 * aqui, porque um endereço montado à mão não passa pelo cliente.
 *
 * **Ausente quer dizer "sem recorte", e é deliberado.** Nem toda leitura deste
 * produto é de uma auditoria: o Fechamento lê o cadastro por competência, o
 * assistente responde sobre o acervo, a manutenção conta linhas. Uma ausência
 * que significasse EMPURRADA esconderia dessas leituras três quartos do banco
 * sem ninguém ter pedido. O que garante que **a auditoria** nunca chegue sem
 * operação é o cliente mandá-la sempre, num lugar só, e o teste de isolamento
 * que prova rota a rota que ela é honrada.
 *
 * A normalização é a mesma da coluna `snapshot.canal` (`freightcheck_norm_canal`),
 * e é o que faz `?operacao=rota` e `?operacao=ROTA` serem a mesma pergunta em
 * vez de uma tela vazia por causa de caixa.
 */
export function operacaoDaConsulta(
  query: Record<string, unknown>,
): Operacao | null {
  const bruta = query["operacao"];
  return typeof bruta === "string" ? normalizarOperacao(bruta) : null;
}

/**
 * A recusa por operação para as rotas que perguntam **por id**.
 *
 * Um punhado de leituras não passa por contexto nenhum — elas recebem o id do
 * recurso e vão direto a ele. Aí o recorte não tem onde entrar, e um id de outra
 * operação (um link antigo, um favorito de quando a auditoria era uma só)
 * abriria o acervo alheio com o menu da operação errada em volta. Ver
 * `operacao-do-recurso.ts`, em `@workspace/comparison`, onde a regra mora.
 *
 * A operação do recurso é buscada **sob demanda**: sem `?operacao=` na consulta
 * não há o que conferir, e a ida ao banco nem acontece.
 */
export async function exigirOperacaoDoRecurso(
  req: Request,
  recurso: string,
  id: string,
  operacaoDoRecurso: () => Promise<string | null>,
): Promise<void> {
  const pedida = operacaoDaConsulta(req.query as Record<string, unknown>);
  if (pedida === null) return;
  exigirOperacao(recurso, id, await operacaoDoRecurso(), pedida);
}

/**
 * A recusa por operação para as rotas que pedem **um ativo** pelo id.
 *
 * O par de {@link exigirOperacaoDoRecurso} para o único recurso que atravessa
 * operações por natureza: a placa. Uma vigência, uma comparação e uma alteração
 * pertencem a uma operação; um ativo pode ser remunerado em mais de uma, e a
 * identidade dele é o metal, não o contrato. Por isso a pergunta aqui é de
 * pertinência — ele aparece na operação de quem pergunta? —, e a recusa só vale
 * quando não aparece em nenhuma vigência dela.
 */
export async function exigirAtivoNaOperacao(
  req: Request,
  entityId: string,
): Promise<void> {
  const pedida = operacaoDaConsulta(req.query as Record<string, unknown>);
  if (pedida === null) return;
  exigirOperacaoEntreAsDaEntidade(entityId, await operacoesDaEntidade(db, entityId), pedida);
}
