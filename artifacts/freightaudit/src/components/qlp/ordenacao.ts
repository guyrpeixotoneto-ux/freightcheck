import { ehTipoNumerico } from "@workspace/curation/agregacao";
import type { AtributoDoQuadro, CargoDoQuadro, UnidadeDoQuadro, ValorDeFato } from "./tipos";

/**
 * A ordem da tabela do quadro — o que o clique no cabeçalho decide.
 *
 * O quadro chega inteiro: `/qlp/administrativo` não pagina, e `getVisaoDoQuadro`
 * devolve os cargos de cada unidade já ordenados por nome. Por isso ordenar aqui
 * é ordenar o quadro inteiro, e não a página que chegou — a armadilha que a
 * lista de chamados evita mandando o `sort` junto da query, porque lá a lista
 * vem cortada. Se um dia esta rota paginar, a ordenação muda de lugar junto.
 *
 * **A ordem é uma só para todas as unidades.** A tabela é uma seção por
 * unidade, e as seções repetem o mesmo cabeçalho — são as mesmas cinco colunas
 * destacadas em todas. Guardar um sentido por unidade faria dois cabeçalhos
 * idênticos mostrarem setas diferentes, e ninguém leria isso como duas ordens:
 * leria como defeito. Um clique ordena as unidades todas, cada uma dentro de
 * si — que é a leitura que a tabela oferece, já que unidade não se mistura com
 * unidade.
 *
 * **Ausência não é zero.** A tabela já respeita isso célula a célula: cargo sem
 * valor na coluna mostra "—", e não `0`. Ordenar com `null` valendo zero
 * desfaria a regra na ordem — os cargos que o export não preencheu desceriam
 * para o fundo como se fossem os mais baratos do quadro, que é exatamente a
 * leitura que a célula existe para negar. Aqui a ausência vai para o fim **nos
 * dois sentidos**: ela não é o menor valor nem o maior, é a falta de um.
 *
 * **O empate mantém a ordem de chegada.** `Array.prototype.sort` é estável
 * desde o ES2019 e os cargos chegam por nome, então dois cargos com o mesmo
 * salário saem em ordem alfabética — inverta-se ou não o sentido.
 */

export type Sentido = "asc" | "desc";

/**
 * Qual coluna manda: o nome do cargo, ou um dos atributos destacados.
 *
 * União, e não uma string só com `"cargo"` reservado: os `code` dos atributos
 * vêm do banco (`qlp_administrativo.salario_ordenados` e afins), e um dia um
 * deles pode ser só `cargo`. O tipo custa um `mesmaChave` e não deixa a dúvida
 * existir.
 */
export type ChaveDeOrdem = { coluna: "cargo" } | { coluna: "atributo"; code: string };

/** `null` é a ordem da casa: a que o servidor entregou, por nome do cargo. */
export type OrdemDoQuadro = { chave: ChaveDeOrdem; sentido: Sentido } | null;

export const CHAVE_DO_CARGO: ChaveDeOrdem = { coluna: "cargo" };

export function chaveDoAtributo(code: string): ChaveDeOrdem {
  return { coluna: "atributo", code };
}

export function mesmaChave(a: ChaveDeOrdem | undefined, b: ChaveDeOrdem): boolean {
  if (!a || a.coluna !== b.coluna) return false;
  return a.coluna === "cargo" || a.code === (b as { code: string }).code;
}

/**
 * O sentido de estreia de cada coluna.
 *
 * Quantidade, salário e despesa estreiam do maior para o menor: quem clica em
 * "salário ordenados" quer ver o que pesa na folha, não o que não pesa. Nome de
 * cargo estreia de A a Z, que é como se procura um cargo — e é a ordem que o
 * servidor já entrega.
 *
 * Quem responde "isto é número?" é a lista única de `@workspace/curation`, a
 * mesma que decide se a coluna pode ser somada. Uma segunda lista aqui seria a
 * sexta cópia da pergunta, que é o que aquele módulo existe para acabar.
 * Coluna sem tipo declarado estreia como número, que é o que as cinco
 * destacadas são.
 */
export function primeiroSentido(
  chave: ChaveDeOrdem,
  atributo?: Pick<AtributoDoQuadro, "dataType">,
): Sentido {
  if (chave.coluna === "cargo") return "asc";
  return ehTipoNumerico(atributo?.dataType) ? "desc" : "asc";
}

/**
 * O próximo estado do cabeçalho: sentido de estreia, inverso, e de volta.
 *
 * O terceiro clique não é enfeite. Sem ele não há como desfazer uma ordenação a
 * não ser recarregando a tela, e a ordem por nome é a única em que o leitor
 * reencontra um cargo onde ele já sabia que estava. É o mesmo ciclo do
 * cabeçalho da frota (`components/composicao/ordenacao.ts`) e do da lista de
 * chamados (`components/changes/ticket-table.tsx`).
 */
export function proximaOrdem(
  atual: OrdemDoQuadro,
  chave: ChaveDeOrdem,
  atributo?: Pick<AtributoDoQuadro, "dataType">,
): OrdemDoQuadro {
  const estreia = primeiroSentido(chave, atributo);
  if (atual === null || !mesmaChave(atual.chave, chave)) return { chave, sentido: estreia };
  if (atual.sentido === estreia) return { chave, sentido: estreia === "asc" ? "desc" : "asc" };
  return null;
}

/** O valor que a coluna escolhida lê num cargo — o mesmo que a célula exibe. */
function valorDaColuna(cargo: CargoDoQuadro, chave: ChaveDeOrdem): ValorDeFato {
  if (chave.coluna === "cargo") return cargo.cargo;
  return cargo.valores[chave.code] ?? null;
}

/**
 * A comparação entre dois valores de fato, no tipo que eles têm.
 *
 * Ausência depois, em qualquer sentido — ver o cabeçalho deste arquivo. Número
 * com número compara como número; texto com texto usa a régua do servidor
 * (`pt-BR`, com número lido como número, para `CARGO 10` vir depois de
 * `CARGO 9`); booleano ordena "Não" antes de "Sim", que é como a célula os
 * escreve.
 *
 * Tipos misturados na mesma coluna não deveriam existir — uma coluna tem um
 * `dataType` —, mas `MIXED` existe no catálogo, e um comparador que devolvesse
 * zero ali deixaria a ordem ao acaso do motor. A saída é comparar o que a
 * célula mostraria, que é sempre texto.
 */
function comparar(a: ValorDeFato, b: ValorDeFato, sentido: Sentido): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return sentido === "asc" ? a - b : b - a;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    const ordem = Number(a) - Number(b);
    return sentido === "asc" ? ordem : -ordem;
  }
  const ordem = String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  return sentido === "asc" ? ordem : -ordem;
}

/** Sem ordem pedida, a lista sai como chegou. */
export function ordenarCargos(cargos: CargoDoQuadro[], ordem: OrdemDoQuadro): CargoDoQuadro[] {
  if (ordem === null) return cargos;
  return [...cargos].sort((a, b) =>
    comparar(valorDaColuna(a, ordem.chave), valorDaColuna(b, ordem.chave), ordem.sentido),
  );
}

/**
 * A mesma ordem em cada unidade, sem reordenar as unidades entre si.
 *
 * A sequência das seções é do servidor, por nome da unidade, e não é o que o
 * cabeçalho da tabela pede: clicar em "salário ordenados" ordena os cargos de
 * CAMAÇARI dentro de CAMAÇARI. Sem ordem pedida devolve o mesmo array — a
 * identidade que deixa o `useMemo` da tela barato.
 */
export function ordenarUnidades(
  unidades: UnidadeDoQuadro[],
  ordem: OrdemDoQuadro,
): UnidadeDoQuadro[] {
  if (ordem === null) return unidades;
  return unidades.map((u) => ({ ...u, cargos: ordenarCargos(u.cargos, ordem) }));
}
