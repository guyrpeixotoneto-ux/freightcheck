/**
 * O mapeamento de colunas do relatório de frota do Promax — isolado, e
 * substituível.
 *
 * TODO(Rebeca): **este mapeamento não foi confirmado contra uma amostra real**
 * do 01.22.02.00 (frota ativa) nem do 01.22.08.00 (frota inativa). Os nomes de
 * coluna abaixo são um layout plausível, no mesmo estilo dos outros relatórios
 * do Promax que este módulo já lê (`Unidade`, `Placa`, `Modelo`) — não uma
 * cópia de um relatório visto. Quando a amostra real chegar, é este arquivo
 * que muda; `leitores/frota-promax.ts` (o resto da leitura — detecção de
 * formato, modelo `{ linhas, recusas }`, gravação) não deveria precisar mudar
 * junto, porque ele não conhece nomes de coluna — só os nomes lógicos que este
 * mapeamento produz.
 *
 * **Por que um arquivo à parte, e não colunas soltas dentro do leitor.** A
 * separação existe para que a pergunta "isto mudou porque o Promax mudou o
 * relatório, ou porque a lógica de leitura mudou" tenha uma resposta olhando
 * só o nome do arquivo no diff. Confundir as duas é o que transforma uma
 * atualização de layout em uma revisão de regra de negócio, e vice-versa.
 */

/**
 * As colunas exigidas para reconhecer o relatório com confiança.
 *
 * **Sem as três, a leitura falha — nunca adivinha por posição.** Um arquivo
 * cujo cabeçalho não bate com o que está aqui não é "frota Promax lida por
 * aproximação": é uma recusa explícita, porque interpretar por chute é o erro
 * que este módulo inteiro existe para não cometer (ver `dominio.ts`).
 */
export const COLUNAS_EXIGIDAS_FROTA_PROMAX = ["Unidade", "Placa", "Modelo"];

/**
 * As colunas opcionais — lidas quando presentes, sem exigir a presença delas
 * para reconhecer o relatório.
 *
 * `Categoria` é o campo que, no futuro, poderia discriminar frota fixa de
 * vans dentro do mesmo arquivo (ver o TODO em `dominio.ts`, junto de
 * `TipoDeFonte`). Por ora ela é só um dado a mais na linha — nada na leitura
 * ou na comparação decide algo a partir dela além do agrupamento que
 * `frota-promax-comparacao.ts` já faz por "modelo/categoria" como texto livre.
 */
export const COLUNAS_OPCIONAIS_FROTA_PROMAX = ["Categoria", "Chassi", "Situacao"];

/** Os nomes de coluna, todos juntos — o que `lerAba` precisa ver para abrir o arquivo. */
export const TODAS_AS_COLUNAS_FROTA_PROMAX = [
  ...COLUNAS_EXIGIDAS_FROTA_PROMAX,
  ...COLUNAS_OPCIONAIS_FROTA_PROMAX,
];
