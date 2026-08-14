/**
 * O conhecimento conceitual do Freightech — o mapa do sistema de origem.
 *
 * **Por que este pacote existe.** Estes dois arquivos viviam na interface, e o
 * argumento para isso era bom: são transcrição da tela do Freightech, precisam
 * existir com o banco vazio, e não são projeção dos nossos fatos. Nada disso
 * mudou. O que mudou é quem precisa lê-los: o Assistente roda no servidor, e
 * o catálogo é a fonte que explica **o que cada parâmetro é** — inclusive o que
 * o Freightech publica e este export não traz.
 *
 * Enquanto o catálogo morou na interface, o assistente respondia "não
 * encontrei" a perguntas cuja resposta estava escrita, conferida e aprovada a
 * um `import` de distância. A pergunta "como funciona o preço de combustível?"
 * é o caso exemplar: o cartão Combustível explica que as seis colunas de preço
 * não chegam no export, e que **temos o consumo sem o preço**.
 *
 * A regra de origem continua valendo, e este pacote a preserva: nada aqui é
 * projeção do banco, nada aqui depende de conexão, e tudo aqui é transcrição
 * revisável do sistema de origem.
 */

export * from "./catalogo";
export * from "./book";
