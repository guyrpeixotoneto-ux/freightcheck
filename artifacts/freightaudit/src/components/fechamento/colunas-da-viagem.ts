import { formatNumber } from "@/lib/format";
import { NOME_DA_FROTA, type TotaisDaOperacao, type Viagem } from "@/lib/fechamento";

/**
 * As colunas da tabela do dia, na ordem e com os nomes do 2Art.
 *
 * O catálogo é literal de propósito: `CX CARREG`, `VEICBM`, `SITMULTICDD` são
 * os rótulos que estão no relatório que quem confere tem aberto do lado, e
 * traduzi-los para um português mais bonito ("Caixas carregadas") obrigaria
 * essa pessoa a fazer a tradução de volta a cada linha. O nome feio é o nome
 * certo aqui.
 *
 * **Nada é formatado como dinheiro.** O 2Art escreve `207,06`, e é `207,06` que
 * a tela mostra: um `R$` por célula em sessenta colunas não acrescenta
 * informação nenhuma e tira a largura de quem precisa comparar números.
 *
 * **O que não veio aparece como traço.** Coluna ausente na exportação vira
 * `null` no leitor e `—` aqui — nunca `0`, que afirmaria que a viagem não pagou
 * aquilo.
 */

export interface ColunaDaViagem {
  /** O rótulo, como o 2Art o escreve. */
  rotulo: string;
  valor: (viagem: Viagem) => string;
  /** Números vão à direita; texto e código, à esquerda. */
  numerica?: boolean;
  /** O que esta coluna soma na linha de total da frota, quando soma. */
  total?: (totais: TotaisDaOperacao) => string;
}

/** `—` para o que a exportação não trouxe; o número em pt-BR para o resto. */
const num = (valor: number | null | undefined, casas = 2): string =>
  valor == null ? "—" : formatNumber(valor, casas);

const txt = (valor: string | undefined): string => (valor?.trim() ? valor : "—");

const emDiaBR = (iso: string) => iso.split("-").reverse().join("/");

export const COLUNAS_DA_VIAGEM: ColunaDaViagem[] = [
  { rotulo: "DATA", valor: (v) => emDiaBR(v.dia) },
  { rotulo: "TRANSP", valor: (v) => txt(v.detalhe?.transportadora) },
  { rotulo: "ENTREGA", valor: (v) => (v.canal === "AS" ? "AS" : "Rota") },
  { rotulo: "CARGA ATUAL", valor: (v) => txt(v.detalhe?.cargaAtual) },
  { rotulo: "FROTA", valor: (v) => NOME_DA_FROTA[v.frota] ?? v.frota },
  { rotulo: "CUSTO SPOT", valor: (v) => num(v.detalhe?.custoSpot), numerica: true },
  { rotulo: "REGIÃO", valor: (v) => txt(v.detalhe?.regiao) },
  { rotulo: "VEÍCULO", valor: (v) => txt(v.detalhe?.veiculo) },
  { rotulo: "PLACA", valor: (v) => txt(v.placa) },
  { rotulo: "VEÍCULO INDISP", valor: (v) => txt(v.detalhe?.veiculoIndisponivel) },
  { rotulo: "PLACA INDISP", valor: (v) => txt(v.detalhe?.placaIndisponivel) },
  { rotulo: "FROTA INDISP", valor: (v) => txt(v.detalhe?.frotaIndisponivel) },
  { rotulo: "TIPO INDISP", valor: (v) => txt(v.detalhe?.tipoDeIndisponibilidade) },
  { rotulo: "MAPA", valor: (v) => txt(v.mapa) },
  {
    rotulo: "ENTREGAS",
    valor: (v) => formatNumber(v.entregas, 0),
    numerica: true,
    total: (t) => formatNumber(t.entregas, 0),
  },
  {
    rotulo: "CX CARREG",
    valor: (v) => formatNumber(v.caixasCarregadas),
    numerica: true,
    total: (t) => formatNumber(t.caixasCarregadas),
  },
  {
    rotulo: "CX ENTREG",
    valor: (v) => formatNumber(v.caixasEntregues),
    numerica: true,
    total: (t) => formatNumber(t.caixasEntregues),
  },
  { rotulo: "OCUPAÇÃO", valor: (v) => num(v.detalhe?.ocupacao), numerica: true },
  { rotulo: "CX ROTA", valor: (v) => num(v.detalhe?.caixasDeRota, 0), numerica: true },
  { rotulo: "CXAS", valor: (v) => num(v.detalhe?.caixasDeAs, 0), numerica: true },
  { rotulo: "VEICBM", valor: (v) => num(v.detalhe?.veiculoBm), numerica: true },
  { rotulo: "RSHOW", valor: (v) => num(v.detalhe?.rShow, 0), numerica: true },
  { rotulo: "ENTRVOL", valor: (v) => txt(v.detalhe?.entregaOuVolume) },
  { rotulo: "HR SAÍDA", valor: (v) => txt(v.detalhe?.horaDeSaida) },
  { rotulo: "HR ENTRADA", valor: (v) => txt(v.detalhe?.horaDeEntrada) },
  { rotulo: "KM SAÍDA", valor: (v) => num(v.detalhe?.kmDeSaida, 0), numerica: true },
  { rotulo: "KM ENTRADA", valor: (v) => num(v.detalhe?.kmDeEntrada, 0), numerica: true },
  { rotulo: "CUSTO VARIÁVEL", valor: (v) => num(v.detalhe?.custoVariavel), numerica: true },
  { rotulo: "LUCRO", valor: (v) => num(v.detalhe?.lucro), numerica: true },
  { rotulo: "LUCRO UNIT", valor: (v) => num(v.detalhe?.lucroUnitario), numerica: true },
  {
    rotulo: "VALOR FRETE",
    valor: (v) => formatNumber(v.valorFrete),
    numerica: true,
    total: (t) => formatNumber(t.freteSemImposto),
  },
  { rotulo: "TIPO IMPOSTO", valor: (v) => txt(v.detalhe?.tipoDeImposto) },
  { rotulo: "PERC IMPOSTO", valor: (v) => num(v.percentualDeImposto), numerica: true },
  {
    rotulo: "VALOR IMPOSTO",
    valor: (v) => formatNumber(v.valorDeImposto),
    numerica: true,
    total: (t) => formatNumber(t.imposto),
  },
  {
    rotulo: "VALOR FATURADO",
    valor: (v) => formatNumber(v.valorFaturado),
    numerica: true,
    total: (t) => formatNumber(t.freteComImposto),
  },
  {
    rotulo: "VALOR UNIT CX ENTREGUE",
    valor: (v) => num(v.detalhe?.valorUnitarioPorCaixaEntregue, 4),
    numerica: true,
  },
  {
    rotulo: "VALOR PG CX ENTREG SEM IMP",
    valor: (v) => num(v.detalhe?.valorPagoPorCaixaSemImposto, 4),
    numerica: true,
  },
  {
    rotulo: "VALOR PG CX ENTREG COM IMP",
    valor: (v) => num(v.detalhe?.valorPagoPorCaixaComImposto, 4),
    numerica: true,
  },
  { rotulo: "TEMPO PREVISTO RODADO", valor: (v) => txt(v.detalhe?.tempoPrevisto), numerica: true },
  { rotulo: "KM PREVISTO RODADO", valor: (v) => num(v.detalhe?.kmPrevisto), numerica: true },
  {
    rotulo: "VALOR UNIT PONTO MOT",
    valor: (v) => num(v.detalhe?.valorUnitarioDoPontoDoMotorista, 4),
    numerica: true,
  },
  {
    rotulo: "VALOR UNIT PONTO AJD",
    valor: (v) => num(v.detalhe?.valorUnitarioDoPontoDoAjudante, 4),
    numerica: true,
  },
  {
    rotulo: "VALOR EQUIPE ENTR MOT",
    valor: (v) => num(v.detalhe?.valorDaEquipeDeEntregaMotorista),
    numerica: true,
  },
  {
    rotulo: "VALOR EQUIPE ENTR AJD",
    valor: (v) => num(v.detalhe?.valorDaEquipeDeEntregaAjudante),
    numerica: true,
  },
  { rotulo: "CUSTO VARIÁVEL CEDBZ", valor: (v) => num(v.detalhe?.custoVariavelCedbz), numerica: true },
  { rotulo: "LUCRO UNIT CEDBZ", valor: (v) => num(v.detalhe?.lucroUnitarioCedbz), numerica: true },
  {
    rotulo: "LUCRO VARIÁVEL CX ENTREGUE FFCEDBZ",
    valor: (v) => num(v.detalhe?.lucroVariavelPorCaixaEntregueFfcedbz, 4),
    numerica: true,
  },
  { rotulo: "TEMPO INTERNO", valor: (v) => txt(v.detalhe?.tempoInterno), numerica: true },
  { rotulo: "VALOR DROPDOWN", valor: (v) => num(v.detalhe?.valorDropdown), numerica: true },
  { rotulo: "VEICCADDD", valor: (v) => txt(v.detalhe?.veiculoCadastradoNoCdd) },
  { rotulo: "KMLACO", valor: (v) => num(v.detalhe?.kmDoLaco), numerica: true },
  { rotulo: "KM DESLOCAMENTO", valor: (v) => num(v.detalhe?.kmDeDeslocamento), numerica: true },
  { rotulo: "TEMPO LACO", valor: (v) => txt(v.detalhe?.tempoDoLaco), numerica: true },
  { rotulo: "TEMPO DESLOCAMENTO", valor: (v) => txt(v.detalhe?.tempoDeDeslocamento), numerica: true },
  { rotulo: "SITMULTICDD", valor: (v) => txt(v.detalhe?.situacaoMultiCdd) },
  { rotulo: "UNB ORIGEM", valor: (v) => txt(v.detalhe?.unidadeDeOrigem) },
  { rotulo: "MATRIC MOTORISTA", valor: (v) => txt(v.detalhe?.matriculaDoMotorista) },
  { rotulo: "MATRIC AJUDANTE 1", valor: (v) => txt(v.detalhe?.matriculaDoAjudante1) },
  { rotulo: "MATRIC AJUDANTE 2", valor: (v) => txt(v.detalhe?.matriculaDoAjudante2) },
  /*
    A última coluna não está no 2Art: é a linha física dele. É a ponta da
    trilha — o que permite abrir o arquivo original e conferir a célula de onde
    o número saiu, que é a diferença entre discordar de um valor e ter de
    refazê-lo.
  */
  { rotulo: "LINHA NO 2ART", valor: (v) => String(v.linha), numerica: true },
];
