import { normalizarEquipamento } from "@workspace/curation/equipamento";

/**
 * O que o Painel de Justificativas **não** cobra — e por que isso é do painel,
 * e não da frota.
 *
 * O trecho continua sendo ativo da empurrada em todo o resto do produto: ele
 * tem `Trecho 360°`, tem Radar de Trechos, tem aba em Alterações e tem fila em
 * Justificativas, e nada disso mudou. O que ele deixou de ter é lugar **neste
 * painel**, que é a leitura de quanto do que mudou já está explicado.
 *
 * A razão é de escala, e ela é visível na tela: o trecho é o lado variável da
 * remuneração — origem, destino, quilometragem, pedágio —, e uma vigência dele
 * muda dezenas de milhares de linhas contra as centenas de cavalo e carreta.
 * Somados no mesmo total, os números do painel viravam a contagem do trecho com
 * um resto: 9.548 pendências sob a palavra "falta justificar", das quais 9.194
 * eram de trecho, e a barra de cavalo — o trabalho que alguém de fato vai
 * cobrar — encostada no zero ao lado dela. A cobertura em porcentagem dizia
 * 0,01%, e o que ela media era a proporção entre duas coisas de tamanhos
 * diferentes, não o andamento de um trabalho.
 *
 * Tirar o trecho **de dentro da conta**, e não só da fileira de abas, é o que
 * mantém a tela honesta: um painel que escondesse a aba e continuasse somando o
 * trecho nos cartões afirmaria um total que a própria tela não sabe abrir.
 *
 * ---------------------------------------------------------------------------
 * Por que num arquivo só, sem importar o banco
 * ---------------------------------------------------------------------------
 * A regra tem duas pontas que precisam concordar: o servidor, que recorta a
 * população nas três consultas do painel (`painel-de-justificativas.ts`), e a
 * tela, que decide que abas, barras e opções de filtro oferecer. Duas listas
 * dos mesmos tipos concordam no dia em que são escritas e discordam no
 * seguinte — e a discordância aqui apareceria como uma aba que abre vazia, ou
 * um total que a lista não consegue reproduzir.
 *
 * Ele não importa `@workspace/db`, e é essa ausência que o mantém publicável
 * pelo subcaminho e importável pelo navegador — a mesma escolha, e pelo mesmo
 * motivo, de `@workspace/curation/equipamento`.
 */
export const TIPOS_FORA_DO_PAINEL_DE_JUSTIFICATIVAS: readonly string[] = ["TRECHO"];

/**
 * Se este `entity_type` está fora do painel.
 *
 * Normaliza pela mesma régua das abas (`normalizarEquipamento`): o tipo chega
 * cru do banco, e um `trecho` minúsculo é o mesmo tipo que um `TRECHO`.
 * Alteração sem tipo declarado **não** está fora — ela não é trecho, é uma
 * linha que o painel continua cobrando como sempre cobrou.
 */
export function foraDoPainelDeJustificativas(
  entityType: string | null | undefined,
): boolean {
  const tipo = normalizarEquipamento(entityType);
  return tipo !== null && TIPOS_FORA_DO_PAINEL_DE_JUSTIFICATIVAS.includes(tipo);
}
