import type { RequestHandler } from "express";

/**
 * O que **esta** superfície sabe dizer quando falta schema — declarado uma vez,
 * fora de qualquer `try/catch`.
 *
 * Sem isto, centralizar a resposta de schema ausente custaria informação. As
 * rotas do Book, de Chamados e da Curadoria diziam qual migration cria o que
 * lhes falta — "a tabela que a `0008_book_entries` cria não existe aqui" — e
 * essa frase é a diferença entre saber o que rodar e ter de descobrir. Só que
 * para dizê-la a rota precisava de um `catch`, e é o `catch` que estava
 * transformando todo o resto em `"Internal server error"`.
 *
 * Então a frase sai do `catch` e vira declaração: o router diz, no ponto em que
 * se monta, o que ele lê. `middlewares/contrato-json.ts` a usa se e quando um
 * pedido daquele caminho morrer por schema, e compõe com o SQLSTATE. Quem não
 * declara nada continua atendido — pelo texto genérico, que nomeia o pedido que
 * parou. Nada some por esquecimento; o que se perde é o detalhe, e só dele.
 *
 * **Recomendação nenhuma entra aqui.** O que houve com o banco, se há risco e o
 * que resolve vêm de `diagnosticar`, a autoridade única que também responde ao
 * `/healthz`. Este texto é contexto — ver `lib/schema-ausente.ts`, onde a
 * separação entre as duas coisas está escrita por extenso.
 *
 * @example
 *   router.use("/book", contextoDeSchema("O Book não tem onde guardar …"));
 */
export function contextoDeSchema(contexto: string): RequestHandler {
  return (req, _res, next) => {
    req.contextoDeSchema = contexto;
    next();
  };
}

declare global {
  namespace Express {
    interface Request {
      /** Ver `contextoDeSchema`. Ausente quando o router não declarou nada. */
      contextoDeSchema?: string;
    }
  }
}
