import { and, eq, inArray, sql } from "drizzle-orm";
import {
  acessoAUnidadeTable,
  appUserTable,
  db,
  remuneracaoUnidadeTable,
  unidadeTable,
} from "@workspace/db";

/**
 * O ESCOPO EFETIVO — o que esta sessão pode ler, calculado sem olhar o pedido.
 *
 * ---------------------------------------------------------------------------
 * A inversão, em uma frase
 * ---------------------------------------------------------------------------
 *
 * Até aqui o `scopeHash` que o cliente mandava **era** o escopo: a rota o
 * repassava ao motor, o motor recortava por ele, e nada no caminho perguntava
 * se aquela conta podia vê-lo. Daqui em diante o escopo é uma propriedade da
 * **sessão**, montada por este módulo, e o que o cliente manda é um pedido de
 * recorte que só consegue **estreitar** o que já foi concedido.
 *
 * A diferença não é de implementação, é de sentido. "O cliente manda o escopo e
 * o servidor confere" ainda deixa o cliente escolher o conjunto de partida;
 * "o servidor monta o conjunto e o cliente escolhe dentro dele" não deixa. As
 * duas parecem equivalentes enquanto tudo funciona, e divergem exatamente no
 * caso que interessa: o parâmetro forjado.
 *
 * ---------------------------------------------------------------------------
 * As invariantes que este arquivo é responsável por manter
 * ---------------------------------------------------------------------------
 *
 * 1. **Nenhuma concessão vem do cliente.** `empresaId`, `unidadeId` e
 *    `scopeHash` que chegam na requisição nunca *ampliam* nada. Eles entram só
 *    em {@link estreitar}, e lá são interseção.
 * 2. **Toda leitura começa pela empresa da sessão.** O conjunto de unidades
 *    nasce de um `WHERE empresa_id = <o da conta>`, e não de um filtro aplicado
 *    depois sobre o universo — a diferença aparece no dia em que alguém
 *    esquecer o filtro.
 * 3. **A ausência de `acesso_a_unidade` concede dentro da empresa, jamais
 *    fora.** O fallback é "todas as unidades da minha empresa". Nunca "todas as
 *    unidades".
 * 4. **`app_user.unidade_id` não participa.** Ele é lotação, e `schema/auth.ts`
 *    é explícito sobre isso não ser permissão. Autorização mora em
 *    `acesso_a_unidade`, que tem autor e data.
 * 5. **O Assistente usa exatamente isto.** Não há caminho paralelo: as rotas
 *    normais e `/assistant/ask` leem o mesmo escopo, pelo mesmo módulo. Um
 *    segundo cálculo para o Assistente seria um segundo lugar para divergir, e
 *    é dele que o vazamento sairia.
 *
 * ---------------------------------------------------------------------------
 * A ponte `scope_hash` → unidade, e por que ela não é derivada do acervo
 * ---------------------------------------------------------------------------
 *
 * `scope_hash` é a soma do escopo que o **arquivo** declarou; ele não conhece
 * empresa e não deve conhecer — carimbar tenant no acervo seria derivar
 * identidade de importação, que é o desenho que `schema/unidade.ts` desfez. A
 * ligação já existe, curada por gente: `remuneracao_unidade` guarda
 * `(scope_hash, unidade_id)`, e é dela que sai o conjunto de hashes
 * autorizados.
 *
 * **O hash sem unidade associada é o caso que decide o desenho.** Hoje ele
 * existe: acervo importado antes de alguém associar a unidade canônica. Tratá-lo
 * como autorizado seria abrir um buraco do tamanho da curadoria pendente;
 * tratá-lo como proibido, hoje, apagaria telas inteiras de uma instalação que
 * nunca teve esse vínculo obrigatório. Por isso ele sai **classificado**, em
 * {@link EscopoEfetivo.hashesSemUnidade}, e quem decide o que fazer com ele é a
 * política de corte — não este módulo. No modo de observação ele é contado e
 * relatado, que é exatamente a medição que falta para decidir.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo não faz
 * ---------------------------------------------------------------------------
 *
 * Não recusa nada. Ele calcula e classifica; quem recusa é o middleware, e só
 * quando o corte estiver ligado. A separação é o que permite medir antes de
 * bloquear — ver `middlewares/escopo-em-observacao.ts`.
 */

/** O que uma sessão alcança, montado a partir dela e de mais nada. */
export interface EscopoEfetivo {
  /** A empresa da conta autenticada. Raiz de confiança. */
  empresaId: string;
  /** As unidades canônicas que esta conta pode ler. */
  unidadesPermitidas: string[];
  /**
   * Verdadeiro quando o conjunto acima veio do fallback — a conta não tem
   * nenhuma linha em `acesso_a_unidade`, então alcança a empresa inteira.
   *
   * Sai na resposta porque a medição precisa distinguir "alcança tudo porque
   * alguém concedeu" de "alcança tudo porque ninguém configurou": as duas
   * produzem o mesmo conjunto hoje e pedem decisões opostas amanhã.
   */
  porFallback: boolean;
  /** Os `scope_hash` que essas unidades respondem. */
  scopeHashesPermitidos: string[];
  /**
   * Os `scope_hash` do acervo que nenhuma unidade canônica reivindica.
   *
   * Nem autorizados nem proibidos: **não classificáveis** com o vínculo que
   * existe hoje. Ver o cabeçalho.
   */
  hashesSemUnidade: string[];
}

/** O veredito sobre um `scopeHash` pedido pelo cliente. */
export type Veredito = "DENTRO" | "FORA" | "SEM_VINCULO";

/**
 * O escopo desta conta. Uma consulta por requisição, três `SELECT` indexados.
 *
 * Lança quando a conta não existe — o que só acontece com sessão de uma conta
 * apagada, e aí a resposta certa não é um escopo vazio (que pareceria "esta
 * pessoa não tem acesso a nada") e sim um erro.
 */
export async function escopoEfetivo(userId: string): Promise<EscopoEfetivo> {
  const [conta] = await db
    .select({ empresaId: appUserTable.empresaId })
    .from(appUserTable)
    .where(eq(appUserTable.id, userId))
    .limit(1);

  if (!conta) throw new Error(`conta ${userId} não existe`);
  const empresaId = conta.empresaId;

  /*
    O universo começa na empresa. Não é um filtro a mais sobre todas as
    unidades — é a cláusula de onde a consulta parte, e nenhuma linha de outra
    empresa chega a existir no resultado para depois ser removida.
  */
  const daEmpresa = await db
    .select({ id: unidadeTable.id })
    .from(unidadeTable)
    .where(eq(unidadeTable.empresaId, empresaId));
  const idsDaEmpresa = daEmpresa.map((u) => u.id);

  const concedidas = await db
    .select({ unidadeId: acessoAUnidadeTable.unidadeId })
    .from(acessoAUnidadeTable)
    .where(eq(acessoAUnidadeTable.userId, userId));

  /*
    O fallback, e o seu limite. Sem nenhuma linha concedida, a conta alcança a
    empresa dela inteira — a mesma regra que as outras três camadas de permissão
    deste produto seguem, e que impede a migration de virar apagão. Com linhas,
    vale a interseção: uma concessão a uma unidade de outra empresa (que só
    existiria por engano de cadastro) não atravessa, porque `idsDaEmpresa` é o
    teto de qualquer caminho daqui.
  */
  const porFallback = concedidas.length === 0;
  const permitidas = porFallback
    ? idsDaEmpresa
    : concedidas.map((c) => c.unidadeId).filter((id) => idsDaEmpresa.includes(id));

  const vinculos = await db
    .select({
      scopeHash: remuneracaoUnidadeTable.scopeHash,
      unidadeId: remuneracaoUnidadeTable.unidadeId,
    })
    .from(remuneracaoUnidadeTable);

  const permitidasSet = new Set(permitidas);
  const scopeHashesPermitidos = new Set<string>();
  const hashesSemUnidade = new Set<string>();

  for (const v of vinculos) {
    if (v.unidadeId === null) {
      hashesSemUnidade.add(v.scopeHash);
      continue;
    }
    if (permitidasSet.has(v.unidadeId)) scopeHashesPermitidos.add(v.scopeHash);
  }

  /*
    Um hash com dois vínculos — um para unidade permitida e outro para uma
    negada — é permitido, e isso é deliberado: o hash responde por um escopo do
    arquivo, e se qualquer unidade que a conta alcança está dentro dele, o dado
    é dela. A separação mais fina que isso exigiria recortar dentro do hash, e
    aí quem recorta é o motor, por unidade, e não este módulo.
  */
  for (const h of scopeHashesPermitidos) hashesSemUnidade.delete(h);

  return {
    empresaId,
    unidadesPermitidas: permitidas,
    porFallback,
    scopeHashesPermitidos: [...scopeHashesPermitidos],
    hashesSemUnidade: [...hashesSemUnidade],
  };
}

/**
 * O veredito sobre o `scopeHash` que o cliente pediu.
 *
 * Três respostas, e não duas, porque "não classificável" é uma informação
 * diferente de "proibido" — e é a que a medição do modo de observação precisa
 * separar para o corte poder ser decidido com número.
 */
export function vereditoDoHash(escopo: EscopoEfetivo, scopeHash: string): Veredito {
  if (escopo.scopeHashesPermitidos.includes(scopeHash)) return "DENTRO";
  if (escopo.hashesSemUnidade.includes(scopeHash)) return "SEM_VINCULO";
  return "FORA";
}

/**
 * O pedido do cliente aplicado sobre o escopo: interseção, nunca união.
 *
 * É o único lugar em que um parâmetro da requisição toca o conjunto, e o que
 * ele pode fazer aqui é **remover**. Um `scopeHash` que não está no conjunto
 * sai como conjunto vazio, e não como ele mesmo — é a diferença entre estreitar
 * e ampliar, escrita numa linha.
 *
 * Sem pedido, devolve o conjunto inteiro: quem não escolheu recebe tudo o que
 * pode, que é o comportamento que as telas já esperam.
 */
export function estreitar(
  escopo: EscopoEfetivo,
  pedido: { scopeHash?: string | null | undefined },
): string[] {
  const pedido_ = pedido.scopeHash;
  if (!pedido_) return escopo.scopeHashesPermitidos;
  return escopo.scopeHashesPermitidos.filter((h) => h === pedido_);
}
