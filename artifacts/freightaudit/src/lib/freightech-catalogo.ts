/**
 * O catálogo de cartões do Freightech — as gavetas, na ordem e com os nomes de lá.
 *
 * Este arquivo existe porque a tela de parâmetros passou a ter uma obrigação
 * nova: **mostrar todos os cartões que o Freightech mostra, mesmo os que este
 * export ainda não alimenta.** Antes eles viravam nota de rodapé; a nota era
 * honesta, mas respondia à pergunta errada. Quem abre esta tela está procurando
 * uma gaveta que conhece pelo nome, e não achar o nome é indistinguível de o
 * produto não cobrir o assunto.
 *
 * Então o cartão existe sempre, e o que muda é o que ele diz por dentro:
 *
 * - **com dado** → o impacto, as alterações e os veículos;
 * - **sem dado** → "sem dado neste export", escrito, no lugar de um número.
 *
 * A regra antiga não foi afrouxada, foi transferida: o cartão vazio não pode
 * *fingir* cobertura. Ele aparece cinza, diz que não tem dado e não abre para
 * uma tela de detalhe que não teria o que mostrar.
 *
 * **Por que aqui e não em `lib/comparison`.** Este é o mapa das telas do
 * sistema de origem, não uma projeção dos nossos fatos: ele precisa existir
 * mesmo quando não há vigência nenhuma importada — que é exatamente o momento
 * em que a resposta da API é 404 e não haveria nada para projetar. Um catálogo
 * que some quando o banco está vazio não é catálogo.
 *
 * **Fonte.** Transcrito das telas de Escolha de Segmento do Freightech
 * (unidades CAMAÇARI e equivalentes, canal EMPURRADA). Onde duas capturas
 * divergiam, os cartões das duas entraram: o conjunto varia por unidade, e
 * faltar um cartão é pior do que sobrar.
 */

export interface CartaoCatalogo {
  /** O rótulo exatamente como o Freightech escreve. */
  nome: string;
  /**
   * Os nossos parâmetros que alimentam este cartão, pelo nome que
   * `lib/comparison/src/families.ts` lhes dá.
   *
   * Fica vazio quando não há correspondência de que se tenha certeza. Chutar
   * uma ligação aqui seria pendurar dinheiro na gaveta errada — o erro mais
   * caro que esta tela pode cometer, e invisível para quem lê.
   */
  parametros?: string[];
}

export interface SecaoCatalogo {
  /** O título da seção, em caixa alta como lá. */
  titulo: string;
  cartoes: CartaoCatalogo[];
}

export const CATALOGO_FREIGHTECH: SecaoCatalogo[] = [
  {
    titulo: "Frota",
    cartoes: [
      { nome: "Carreta", parametros: ["Carreta"] },
      { nome: "Cavalo", parametros: ["Caminhão"] },
      { nome: "Combustível", parametros: ["Combustível"] },
      { nome: "Consumo", parametros: ["Consumo benchmark"] },
      { nome: "Contrato manutenção", parametros: ["Contrato de manutenção"] },
      { nome: "Custo fixo total", parametros: ["Custo fixo (total)"] },
      { nome: "Lucro FINAME" },
      { nome: "Manutenção BID", parametros: ["Manutenção BID"] },
      { nome: "Manutenção implemento", parametros: ["Manutenção carroceria"] },
      { nome: "Modelo" },
      { nome: "Parâmetros consumo" },
      { nome: "Parâmetros manutenção", parametros: ["Manutenção cavalo"] },
      { nome: "Prazo FINAME" },
      { nome: "Prazo FINAME manutenção" },
      { nome: "Tipo carroceria" },
      { nome: "Trecho" },
    ],
  },
  {
    titulo: "Equipe",
    cartoes: [
      { nome: "Benefício dias úteis" },
      { nome: "Benefícios auxiliares" },
      { nome: "Benefícios remunerados" },
      { nome: "Cargo equipe" },
      { nome: "Cargo QLP" },
      { nome: "Classificação QLP" },
      { nome: "Equipe" },
      { nome: "Parâmetros equipe" },
      { nome: "QLP ADM" },
      { nome: "QLP ADM total" },
      { nome: "Turno" },
    ],
  },
  {
    titulo: "Despesas",
    cartoes: [
      { nome: "Despesas operacionais" },
      { nome: "Encargos e provisões com férias" },
      { nome: "Encargos e provisões sem férias" },
    ],
  },
  {
    titulo: "Parâmetros gerais",
    cartoes: [
      { nome: "Capacidade" },
      { nome: "Eixo" },
      { nome: "Empresa locadora", parametros: ["Empresa locadora"] },
      { nome: "Fator consumo" },
      { nome: "Fator desgaste piso", parametros: ["Fator Desgaste Piso"] },
      { nome: "Lucro" },
      { nome: "Parâmetros fiscal" },
      { nome: "Parâmetros operação", parametros: ["Parâmetros de operação"] },
      { nome: "Percentual descartável" },
      { nome: "Região", parametros: ["Região"] },
      { nome: "Tipo combustivel" },
      { nome: "Tipo palletização" },
      { nome: "Unidade" },
    ],
  },
  {
    titulo: "Pneus",
    cartoes: [
      { nome: "Parâmetros pneu", parametros: ["Pneu"] },
      { nome: "Pneu capacidade" },
      { nome: "Pneu empurrada" },
      { nome: "Pneu medida" },
      { nome: "Pneu tipo eixo" },
    ],
  },
  {
    titulo: "Remuneracao",
    cartoes: [
      { nome: "Custo equipe" },
      { nome: "Custo fixo empurrada" },
      { nome: "Faturamento" },
      { nome: "Recarga", parametros: ["Recarga"] },
      { nome: "Resumo fixo CPRB" },
      { nome: "Resumo fixo empurrada" },
      { nome: "Resumo - SRTRANS" },
      { nome: "Resumo rota", parametros: ["Resumo Rota"] },
    ],
  },
  {
    titulo: "Uniformes e EPIs",
    cartoes: [
      { nome: "Cadastros EPI" },
      { nome: "Uniformes e EPI benchmark" },
      { nome: "Uniformes e EPI homologados" },
      { nome: "Uniformes e EPIs" },
      { nome: "Uniformes e EPIs geral" },
      { nome: "Uniformes EPIs (remuneração)" },
      { nome: "Valor uniformes e EPIs sem ICMS" },
    ],
  },
  {
    titulo: "Dimensões",
    cartoes: [
      { nome: "Diesel destino" },
      { nome: "Implemento", parametros: ["Implemento"] },
      { nome: "Iniciativa" },
      { nome: "Logo padrão" },
      { nome: "Material" },
      { nome: "Modelo" },
      { nome: "Motor" },
      { nome: "Perfil" },
      { nome: "Remuneração modelo" },
      { nome: "Status financiamento" },
      { nome: "Tipo" },
    ],
  },
];

/**
 * Uma chave estável por cartão — sobrevive a mudança de rótulo e serve de
 * endereço na URL e de identidade do favorito.
 *
 * Leva a seção junto porque há nome repetido entre seções ("Modelo" está em
 * Frota e em Dimensões, e são gavetas diferentes).
 */
export function chaveDoCartao(secao: string, nome: string): string {
  return `${slug(secao)}.${slug(nome)}`;
}

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Todos os nomes de parâmetro nossos que já têm cartão no catálogo. */
export const PARAMETROS_NO_CATALOGO = new Set(
  CATALOGO_FREIGHTECH.flatMap((secao) =>
    secao.cartoes.flatMap((cartao) => cartao.parametros ?? []),
  ),
);
