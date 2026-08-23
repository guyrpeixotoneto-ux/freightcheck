import { normalizarRotulo } from "./significado";

/**
 * O que sintético e analítico precisam saber um do outro — e nada além disso.
 *
 * ---------------------------------------------------------------------------
 * Por que um módulo, e não duas funções soltas
 * ---------------------------------------------------------------------------
 * A regra que mora aqui vale nos dois lados: a tela precisa saber **se pode
 * oferecer** a repetição do sintético no analítico, e o cadastro precisa saber
 * **se pode aceitá-la**. Escrita duas vezes, ela divergiria no primeiro ajuste
 * — e a divergência apareceria como um botão que a tela oferece e o servidor
 * recusa, que é a pior forma de recusa que existe.
 *
 * Sem `@workspace/db` de propósito: isto é lido pelo navegador. `catalogo.ts`,
 * que fala com o banco, importa daqui.
 */

/**
 * Os dois nomes são o mesmo nome, a menos de acento, caixa e parêntese.
 *
 * `normalizarRotulo` é a mesma comparação que {@link procurarProximos} usa para
 * decidir duplicata, e usá-la aqui é o que faz "Cadastral (não remuneratório)"
 * copiado da lista e "cadastral nao remuneratorio" digitado à mão quererem
 * dizer a mesma coisa.
 */
export function mesmoNome(a: string, b: string): boolean {
  const primeiro = normalizarRotulo(a);
  return primeiro !== "" && primeiro === normalizarRotulo(b);
}

/**
 * A linha da DRE é cadastral — a que descreve sem remunerar.
 *
 * Lida do nome, e não de uma coluna, porque não existe coluna: a árvore guarda
 * natureza, e "não remunera" é a única propriedade que a linha cadastral tem e
 * as outras não. O produto a escreve de três formas — "Cadastral (não
 * remuneratório)" na tela, "Cadastral (não entra na DRE)" na planilha do time,
 * "Cadastro e identificação" na árvore semeada — e as três dizem a mesma coisa.
 * `planilha-de-atributos.ts` já casa as três pelo mesmo caminho, cortando os
 * parênteses dos dois lados; aqui a leitura é a mesma, feita sobre o radical.
 *
 * O que esta função autoriza é **uma** exceção, descrita em
 * {@link podeRepetirOSintetico}. Ela não classifica nada, não decide lado da
 * conta e não muda o que a DRE soma.
 */
export function ehLinhaCadastral(nome: string): boolean {
  const lido = normalizarRotulo(nome);
  return lido.startsWith("cadastr") || lido.includes("nao remunerator");
}

/**
 * O analítico pode se chamar como o sintético que o totaliza?
 *
 * ---------------------------------------------------------------------------
 * Por que a resposta é "não", em geral
 * ---------------------------------------------------------------------------
 * Dois nós homônimos em alturas diferentes não se distinguem em relatório
 * nenhum, e a leitura da planilha de atributos — que casa sintético e analítico
 * **pelo nome** — passaria a ter duas respostas. É o que
 * {@link criarSintetico} e {@link criarCategoria} recusam desde sempre, nos
 * dois sentidos.
 *
 * ---------------------------------------------------------------------------
 * Por que é "sim" no cadastral
 * ---------------------------------------------------------------------------
 * Porque a linha cadastral não se desdobra. As outras linhas existem para
 * totalizar detalhes — combustível, pneus, manutenção somam em custo variável —
 * e escolher só a linha seria não classificar. O cadastral não soma coisa
 * alguma: placa, CNPJ e vigência não entram em total nenhum, e o detalhe dentro
 * dele não muda número em tela alguma. Exigir um analítico ali é exigir que
 * quem cura invente um nível que a DRE não tem, e o que se inventa quando se é
 * obrigado é a aproximação silenciosa que este produto recusa em todo lugar.
 *
 * A ambiguidade que a regra geral protege também não aparece: o par é
 * *"Cadastral › Cadastral"*, e casar o analítico dentro do galho do sintético
 * dá um resultado só. O nó continua sendo um nó de verdade, com código próprio
 * ({@link codigoDaRepeticao}), autor e evento de curadoria — o que se repete é
 * o nome, que é o que quem lê a DRE vê.
 */
export function podeRepetirOSintetico(
  nomeDoAnalitico: string,
  nomeDoSintetico: string,
): boolean {
  return (
    ehLinhaCadastral(nomeDoSintetico) && mesmoNome(nomeDoAnalitico, nomeDoSintetico)
  );
}

/**
 * O código do analítico que repete o sintético.
 *
 * Derivado do código da linha, e não do nome: derivá-lo do nome daria o código
 * da própria linha, e `taxonomy_node_code_uq` recusaria a inserção — a colisão
 * apareceria como "já existe", que é o oposto do que a pessoa pediu. O sufixo
 * também é o que deixa o par legível no banco: `cadastral` totaliza
 * `cadastral_proprio`.
 */
export function codigoDaRepeticao(codigoDoSintetico: string): string {
  return `${codigoDoSintetico}_proprio`;
}
