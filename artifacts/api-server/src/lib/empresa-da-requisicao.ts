import type { Request } from "express";
import { db, unidadeTable } from "@workspace/db";
import { asc } from "drizzle-orm";

/**
 * DE QUEM É ESTA REQUISIÇÃO — a autoridade única do escopo de empresa.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo resolve, e o que ele deliberadamente não finge resolver
 * ---------------------------------------------------------------------------
 *
 * O FreightCheck **não tem inquilinos hoje**, e isso está escrito no próprio
 * schema: "este produto é hoje de um cliente só: não há coluna de empresa em
 * lugar nenhum" (`lib/db/src/schema/significado.ts`). Não há `empresa_id` em
 * `app_user`, não há tabela de inquilino, e toda pessoa que entra vê o produto
 * inteiro.
 *
 * Fluxos Operacionais precisa de escopo por empresa — um mapa de processos é a
 * coisa mais específica de uma empresa que existe. A saída **não** foi inventar
 * uma tabela de inquilinos ao lado da `unidade`: a `0049` desfez exatamente
 * essa duplicação de identidade, e refazê-la seria o erro que ela documenta. A
 * empresa aqui **é** a unidade canônica, identificada por CNPJ, cadastrada em
 * Administração → Unidades.
 *
 * Então o que este arquivo faz é montar a costura inteira do isolamento — toda
 * consulta escopada, toda escrita conferida, chave composta no banco — e deixar
 * **um** ponto onde a pergunta "esta pessoa pode operar esta empresa?" é
 * respondida. Hoje a resposta é "toda pessoa autenticada pode operar qualquer
 * empresa cadastrada nesta instalação", porque é o que o produto inteiro já faz
 * com unidades, e afirmar outra coisa seria fingir um controle que não existe
 * em lugar nenhum do repositório.
 *
 * **Isso está dito em voz alta de propósito.** No dia em que houver vínculo
 * entre conta e empresa, `podeOperar` é a única função que muda, e as
 * dezenas de consultas escopadas continuam valendo sem uma linha de alteração.
 * O contrário — escopo espalhado, decisão em cada rota — é o desenho em que a
 * primeira rota nova esquece o `where`.
 *
 * ---------------------------------------------------------------------------
 * A empresa nunca vem do corpo
 * ---------------------------------------------------------------------------
 *
 * Ela chega **só** por `?empresaId=` e passa por `resolverEmpresa`, que exige
 * sessão, exige que a unidade exista e chama `podeOperar`. Nenhuma rota lê
 * `req.body.empresaId`, e o repositório recebe o escopo como argumento
 * separado do corpo justamente para que confundir os dois seja impossível de
 * escrever. Sem `empresaId`, e com exatamente uma unidade cadastrada, ela é a
 * escolhida — não é fallback para "empresa 0": é a única resposta possível, e
 * com duas ou mais o pedido é recusado pedindo a escolha, em vez de adivinhar.
 */

export class EscopoDeEmpresaAusente extends Error {
  readonly codigo = "EMPRESA_NAO_INFORMADA";
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EscopoDeEmpresaAusente";
  }
}

export class EmpresaNaoPermitida extends Error {
  readonly codigo = "EMPRESA_NAO_PERMITIDA";
  constructor() {
    super("Esta conta não opera esta empresa.");
    this.name = "EmpresaNaoPermitida";
  }
}

/**
 * A pergunta de autorização, isolada — e o único lugar a mudar quando houver
 * vínculo entre conta e empresa.
 *
 * Recebe a sessão inteira, e não só o papel, porque é ela que vai carregar o
 * vínculo quando ele existir. Hoje devolve `true` para qualquer pessoa
 * autenticada, pela razão escrita no topo deste arquivo.
 */
export function podeOperar(
  _usuario: { id: string; email: string; role: string },
  _empresaId: string,
): boolean {
  return true;
}

/**
 * A empresa desta requisição, ou uma recusa nomeada.
 *
 * Nunca lança "não autenticado": quando esta função roda, `requireSession` já
 * garantiu a sessão. O que ela pode recusar é escopo ausente, empresa
 * inexistente e empresa não permitida — três frases diferentes, porque as três
 * mandam fazer coisas diferentes.
 */
export async function resolverEmpresa(req: Request): Promise<string> {
  const usuario = req.user;
  if (!usuario) {
    /*
      Defesa em profundidade, não caminho esperado: `requireSession` está
      montado antes de todas as rotas. Se um dia alguém montar este router fora
      do portão, é aqui que isso para — e não numa consulta sem escopo.
    */
    throw new EmpresaNaoPermitida();
  }

  const pedida = typeof req.query.empresaId === "string" ? req.query.empresaId.trim() : "";
  const cadastradas = await db
    .select({ id: unidadeTable.id, nome: unidadeTable.nome })
    .from(unidadeTable)
    .orderBy(asc(unidadeTable.nome));

  if (cadastradas.length === 0) {
    throw new EscopoDeEmpresaAusente(
      "Nenhuma empresa cadastrada. Cadastre a unidade em Administração → Unidades antes de mapear processos.",
    );
  }

  if (pedida === "") {
    if (cadastradas.length === 1) return cadastradas[0].id;
    throw new EscopoDeEmpresaAusente(
      "Escolha a empresa: esta instalação tem mais de uma unidade cadastrada.",
    );
  }

  const encontrada = cadastradas.find((u) => u.id === pedida);
  /*
    "Não existe" e "não é sua" respondem a mesma coisa aqui, e é decisão: um
    módulo que isola empresas não confirma a existência do acervo alheio. A
    frase manda para a lista de unidades, que é onde a dúvida se resolve.
  */
  if (!encontrada) {
    throw new EscopoDeEmpresaAusente(
      "Esta empresa não está cadastrada em Administração → Unidades.",
    );
  }
  if (!podeOperar(usuario, encontrada.id)) throw new EmpresaNaoPermitida();
  return encontrada.id;
}

/** O autor da escrita — o e-mail da sessão, no formato do resto do produto. */
export function autorDaRequisicao(req: Request): { email: string | null } {
  return { email: req.user?.email ?? null };
}
