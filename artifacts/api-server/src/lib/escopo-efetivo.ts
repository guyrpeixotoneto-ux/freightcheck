import { eq } from "drizzle-orm";
import { acessoAUnidadeTable, db, remuneracaoUnidadeTable } from "@workspace/db";

/**
 * O ESCOPO EFETIVO — que unidades esta sessão alcança, calculado sem olhar o
 * pedido.
 *
 * ---------------------------------------------------------------------------
 * A inversão, em uma frase
 * ---------------------------------------------------------------------------
 *
 * Até aqui o `scopeHash` que o cliente mandava **era** o escopo: a rota o
 * repassava ao motor, o motor recortava por ele, e nada no caminho perguntava
 * se aquela conta podia vê-lo. Daqui em diante o escopo é propriedade da
 * **sessão**, montado por este módulo, e o que o cliente manda é um pedido de
 * recorte que só consegue **estreitar** o que já foi concedido.
 *
 * A diferença não é de implementação, é de sentido. "O cliente manda o escopo e
 * o servidor confere" ainda deixa o cliente escolher o conjunto de partida; "o
 * servidor monta o conjunto e o cliente escolhe dentro dele" não deixa. As duas
 * parecem equivalentes enquanto tudo funciona, e divergem exatamente no caso
 * que interessa: o parâmetro forjado.
 *
 * ---------------------------------------------------------------------------
 * As invariantes que este arquivo mantém
 * ---------------------------------------------------------------------------
 *
 * 1. **Nenhuma concessão vem do cliente.** `unidadeId` e `scopeHash` que chegam
 *    na requisição nunca ampliam nada; eles entram só em {@link estreitar}, e
 *    lá são interseção.
 * 2. **A fronteira é a unidade**, e não há nível acima dela. Quem precisa de
 *    várias recebe várias linhas em `acesso_a_unidade`.
 * 3. **Sem concessão, sem acesso.** Não há fallback. Uma conta sem linha
 *    alcança o conjunto vazio — e isso é o que torna a tabela uma fronteira em
 *    vez de um enfeite. O que impede isso de virar apagão não é um fallback: é
 *    o corte estar desligado até as concessões existirem.
 * 4. **`app_user.unidade_id` não participa.** É lotação, e `schema/auth.ts` é
 *    explícito sobre ela não ser permissão. Ela pode **sugerir** na tela de
 *    concessão; sugerir não é conceder.
 * 5. **O Assistente usa exatamente isto.** Não há caminho paralelo: as rotas
 *    normais e `/assistant/ask` leem o mesmo objeto. Um segundo cálculo seria
 *    um segundo lugar para divergir, e é dele que o vazamento sairia — a
 *    superfície que agrega é a que menos pode ter regra própria.
 *
 * ---------------------------------------------------------------------------
 * A ponte `scope_hash` → unidade, e a terceira categoria
 * ---------------------------------------------------------------------------
 *
 * `scope_hash` é a soma do escopo que o **arquivo** declarou; ele não conhece
 * unidade canônica e não deve conhecer — carimbar identidade no acervo seria
 * derivá-la de importação, que é o desenho que `schema/unidade.ts` desfez. A
 * ligação existe, curada por gente, em `remuneracao_unidade.unidade_id`.
 *
 * **O hash sem unidade associada não é liberado por conveniência.** Ele sai
 * numa categoria própria — {@link EscopoEfetivo.hashesSemUnidade} —, e ela não
 * quer dizer "pode": quer dizer **não classificável com o vínculo que existe
 * hoje**. Tratá-lo como autorizado abriria um buraco do tamanho da curadoria
 * pendente. No modo de observação ele é contado e relatado, que é a medição que
 * falta para decidir; antes do corte, cada hash dessa categoria precisa ganhar
 * vínculo ou uma exceção escrita, e é isso que o relatório existe para cobrar.
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
  /** As unidades canônicas concedidas a esta conta. Vazio é vazio. */
  unidadesPermitidas: string[];
  /** Os `scope_hash` que essas unidades respondem. */
  scopeHashesPermitidos: string[];
  /**
   * Os `scope_hash` do acervo que nenhuma unidade canônica reivindica.
   *
   * Nem autorizados nem proibidos: **não classificáveis**. Ver o cabeçalho.
   */
  hashesSemUnidade: string[];
}

/** O veredito sobre um `scopeHash` pedido pelo cliente. */
export type Veredito = "DENTRO" | "FORA" | "SEM_VINCULO";

/**
 * O escopo desta conta. Duas consultas indexadas por requisição.
 *
 * Não lança quando a conta não tem concessão: devolve o conjunto vazio, que é a
 * descrição correta de "esta pessoa ainda não recebeu acesso a unidade
 * nenhuma". Quem transforma isso em recusa é o corte, quando ligado.
 */
export async function escopoEfetivo(userId: string): Promise<EscopoEfetivo> {
  const concedidas = await db
    .select({ unidadeId: acessoAUnidadeTable.unidadeId })
    .from(acessoAUnidadeTable)
    .where(eq(acessoAUnidadeTable.userId, userId));

  const permitidas = new Set(concedidas.map((c) => c.unidadeId));

  const vinculos = await db
    .select({
      scopeHash: remuneracaoUnidadeTable.scopeHash,
      unidadeId: remuneracaoUnidadeTable.unidadeId,
    })
    .from(remuneracaoUnidadeTable);

  const scopeHashesPermitidos = new Set<string>();
  const semUnidade = new Set<string>();

  for (const v of vinculos) {
    if (v.unidadeId === null) {
      semUnidade.add(v.scopeHash);
      continue;
    }
    if (permitidas.has(v.unidadeId)) scopeHashesPermitidos.add(v.scopeHash);
  }

  /*
    Um hash com dois vínculos — um para unidade concedida e outro para uma que
    não é — conta como permitido, e é deliberado: o hash responde por um escopo
    do arquivo, e se qualquer unidade que a conta alcança está dentro dele, o
    dado é dela. Recortar mais fino que isso exigiria recortar *dentro* do hash,
    e quem faz isso é o motor, por unidade, não este módulo.

    O mesmo vale para a terceira categoria: um hash que tem vínculo com alguma
    unidade não é "sem vínculo", mesmo que aquela unidade não seja desta conta —
    ele é `FORA`, que é uma afirmação, e não uma dúvida.
  */
  const comVinculo = new Set(
    vinculos.filter((v) => v.unidadeId !== null).map((v) => v.scopeHash),
  );
  for (const h of comVinculo) semUnidade.delete(h);

  return {
    unidadesPermitidas: [...permitidas],
    scopeHashesPermitidos: [...scopeHashesPermitidos],
    hashesSemUnidade: [...semUnidade],
  };
}

/**
 * O veredito sobre o `scopeHash` que o cliente pediu.
 *
 * Três respostas, e não duas, porque "não classificável" é informação diferente
 * de "proibido" — e é a que a medição precisa separar para o corte poder ser
 * decidido com número. Nenhuma das três libera nada por si: quem decide o que
 * fazer com elas é o middleware.
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
 * ele pode fazer aqui é **remover**. Um `scopeHash` que não está no conjunto sai
 * como conjunto vazio, e não como ele mesmo — é a diferença entre estreitar e
 * ampliar, escrita numa linha.
 *
 * **Sem pedido devolve o conjunto autorizado, que pode ser vazio.** Nunca "tudo
 * o que existe": omitir o parâmetro não pode selecionar em silêncio uma unidade
 * fora do escopo, e é por isso que o caminho do pedido ausente passa pelo mesmo
 * conjunto que o do pedido presente.
 *
 * Aceita um pedido só ou uma lista — porque uma lista é a forma óbvia de tentar
 * ampliar, e ela precisa cair na mesma interseção.
 */
export function estreitar(
  escopo: EscopoEfetivo,
  pedido: { scopeHash?: string | string[] | null | undefined },
): string[] {
  const bruto = pedido.scopeHash;
  if (bruto === undefined || bruto === null || bruto === "") {
    return escopo.scopeHashesPermitidos;
  }
  const pedidos = new Set(Array.isArray(bruto) ? bruto : [bruto]);
  return escopo.scopeHashesPermitidos.filter((h) => pedidos.has(h));
}
