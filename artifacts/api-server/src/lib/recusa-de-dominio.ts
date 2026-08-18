import {
  ContextNotFoundError,
  JanelaInvalidaError,
} from "@workspace/comparison";
import {
  BaixaRecusada,
  CelulaNaoEncontrada,
  DecisaoRecusada,
} from "@workspace/coverage";
import { EmailAlreadyUsedError } from "./session";

/**
 * As recusas que têm nome, e o número HTTP de cada uma — numa tabela só.
 *
 * Estas classes não são defeito nosso: são o domínio dizendo "o que você pediu
 * não existe" ou "esta regra não deixa". A tradução delas para HTTP já estava
 * escrita — no comentário de cada classe, em `@workspace/comparison` e em
 * `@workspace/coverage`, lê-se "a rota traduz em 404" — e era executada por uma
 * cópia do `try/catch` por handler. Trinta e nove cópias, e o problema não era
 * a repetição: era o que vinha **junto** com ela.
 *
 * ```ts
 * } catch (err) {
 *   if (sendContextError(res, err)) return;          // a recusa, traduzida
 *   req.log.error({ err }, "Error building …");
 *   res.status(500).json({ error: "Internal server error" });   // e o resto
 * }
 * ```
 *
 * A segunda metade é que era o defeito. Para converter *uma* recusa nomeada, o
 * handler precisava capturar **tudo** — e o que não fosse aquela recusa perdia
 * ali o `code`, o `requestId` e a chance de ser classificado como banco
 * divergente, virando uma constante que nenhuma tela consegue explicar.
 *
 * Com a tradução aqui, o handler não precisa mais capturar nada: a exceção sobe
 * até `middlewares/contrato-json.ts`, que pergunta **nesta ordem** — é recusa
 * nomeada? falta schema? — e só então responde 500. Nenhum caminho perde
 * informação por causa de outro.
 *
 * **O que não entra nesta tabela.** Recusa cujo número depende do *conteúdo* do
 * erro, e não da classe dele: a promoção que responde 409 ou 422 conforme a
 * decisão que o pipeline tomou, a exclusão que responde 404 ou 409 conforme o
 * que ela não encontrou. Aquilo continua no `catch` da rota, que é onde o dado
 * para decidir existe — e é o que "preservar o tratamento intencional de 4xx"
 * quer dizer.
 */
const RECUSAS: { classe: new (...args: never[]) => Error; status: number }[] = [
  /* O contexto pedido não existe: não há o que importar, ou aquela unidade
     nunca entregou nada. 404 — a ausência é do recurso. */
  { classe: ContextNotFoundError, status: 404 },
  /* O contexto existe e o **recorte** é que não. 400, e nunca 404: trocar os
     dois faria a tela oferecer "importe alguma coisa" a quem só precisa
     escolher outra ponta da janela. */
  { classe: JanelaInvalidaError, status: 400 },
  { classe: CelulaNaoEncontrada, status: 404 },
  /* Regra de negócio escrita para quem opera — a frase é dela, e sai inteira. */
  { classe: DecisaoRecusada, status: 422 },
  { classe: BaixaRecusada, status: 422 },
  /* Conflito de estado, não defeito do pedido: o e-mail já é de outra conta. */
  { classe: EmailAlreadyUsedError, status: 409 },
];

/**
 * O status desta recusa, ou `null` se o erro não for uma.
 *
 * A pergunta é pela **classe**, nunca pelo texto. Um `instanceof` não confunde
 * a frase de um domínio com a de um driver; uma heurística sobre a mensagem
 * confundiria, e é assim que consulta SQL chega à tela.
 */
export function statusDaRecusa(err: unknown): number | null {
  for (const { classe, status } of RECUSAS) {
    if (err instanceof classe) return status;
  }
  return null;
}
