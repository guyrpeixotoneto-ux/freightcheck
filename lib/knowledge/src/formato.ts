/**
 * Como um número deste produto se escreve — construído uma vez, não a cada
 * chamada.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 *
 * `valor.toLocaleString("pt-BR", { … })` **constrói um `Intl.NumberFormat`
 * novo a cada chamada**. Não é uma diferença de estilo: medido em 200.000
 * chamadas neste runtime,
 *
 *     toLocaleString(opções)   25,01 µs por chamada
 *     Intl.NumberFormat        0,56 µs por chamada   ·   44,5× mais rápido
 *
 * com saída idêntica. Enquanto o formatador é usado uma vez por mensagem, os
 * 25µs não aparecem em lugar nenhum. Onde ele é usado **por atributo, por
 * ativo, por vigência**, aparecem: no perfil de CPU de `/api/dre/history`,
 * `formatarNumero` era a função mais cara do processo inteiro — 15,9% do tempo
 * —, à frente do driver do Postgres e do coletor de lixo. Ver
 * `docs/AUDITORIA-PERFORMANCE.md`.
 *
 * ---------------------------------------------------------------------------
 * Por que aqui, e não em cada pacote
 * ---------------------------------------------------------------------------
 *
 * Porque a forma de escrever um número **é conhecimento declarado**, e não
 * preferência de quem escreve a tela: duas casas decimais numa memória de
 * cálculo não são estética, são a promessa de que o número confere com a
 * planilha de origem até o centavo. `@workspace/knowledge` é onde as decisões
 * desse tipo moram, e é o único pacote que `comparison`, `composition` e `dre`
 * podem compartilhar sem inventar uma dependência entre eles.
 *
 * O caminho de importação é `@workspace/knowledge/formato`, e não o índice do
 * pacote, para que o navegador não arraste o resto junto — ver a recusa a
 * builtins do Node em `vite.config.ts`.
 *
 * ---------------------------------------------------------------------------
 * O que **não** entra aqui
 * ---------------------------------------------------------------------------
 *
 * Formatador usado uma vez por resposta — o texto de um erro, o rótulo de um
 * relatório de linha de comando — não tem por que migrar. Trocar uma chamada
 * que acontece uma vez custa a mesma leitura e não devolve nada; o que este
 * arquivo resolve é repetição, não a existência de `toLocaleString`.
 */

/** `1234.5` → `"1.234,50"`. A escrita de um valor em memória de cálculo. */
export const DUAS_CASAS = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `1234.5` → `"1.234,5"`. Percentuais e razões, onde a segunda casa é ruído. */
export const UMA_CASA = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

/** `1234.5` → `"1.235"`. Contagens: ativos, linhas, células. */
export const INTEIRO = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

/** `1234.5` → `"R$ 1.234,50"`. */
export const REAIS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
