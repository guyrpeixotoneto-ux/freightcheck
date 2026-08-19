import { centavos, lerCanal, lerFrota, lerNumero, type Canal, type Frota, type Leitura, type Recusa } from "../dominio";
import { diaDeDDMMAAAA, type Dia } from "../periodo";
import { celula, lerAba, type LinhaDePlanilha } from "./planilha";

/**
 * O 2Art — o diário operacional, uma linha por viagem.
 *
 * É a fonte mais rica das cinco (cerca de 120 colunas) e a única que descreve
 * o que de fato aconteceu na rua: qual veículo saiu, com quantas caixas,
 * quantas entregou, a que horas voltou e quanto aquilo vale. Todo o frete
 * variável da quinzena nasce aqui — é este arquivo que as abas `01`…`31` da
 * planilha de fechamento reproduzem, uma aba por dia.
 *
 * **Lemos 15 colunas das 120.** As demais existem e são úteis (indisponibilidade
 * do veículo, previsto do roteirizador, abertura da remuneração da equipe), mas
 * entram quando uma tela precisar delas: uma coluna lida e não usada é uma
 * promessa de exatidão que ninguém está conferindo.
 */

export interface Viagem {
  /** A linha física no arquivo — a ponta da trilha até a célula de origem. */
  linha: number;
  dia: Dia;
  canal: Canal;
  frota: Frota;
  /** A placa do veículo que rodou. Vazia quando a viagem não teve veículo alocado. */
  placa: string;
  /** O mapa (a rota do dia), como o roteirizador o numerou. */
  mapa: string;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  /** O frete da viagem, **sem** imposto. É o que se soma para apurar o variável. */
  valorFrete: number;
  /** A alíquota que o Promax declarou nesta linha, em pontos percentuais. */
  percentualDeImposto: number | null;
  valorDeImposto: number;
  /** O frete **com** imposto — o que se compara ao CT-e. */
  valorFaturado: number;
}

const COLUNAS_EXIGIDAS = ["Data", "Entrega", "Frota", "ValorFrete", "ValorFaturado"];

/**
 * Lê o 2Art.
 *
 * Uma viagem sem data, sem canal ou sem frota reconhecíveis é recusada, e não
 * corrigida: essas três colunas são os eixos de toda agregação seguinte, e uma
 * viagem que entra no dia errado tira dinheiro de uma quinzena e põe em outra.
 * Já `ValorFrete` ausente **não** recusa a linha — vira zero explícito, porque
 * o 2Art traz viagens canceladas e improdutivas que valem zero de verdade e
 * ainda assim contam para a operação do dia.
 */
export function lerOperacao(arquivo: Buffer | ArrayBuffer): Leitura<Viagem> {
  const planilha = lerAba(arquivo, { exigidas: COLUNAS_EXIGIDAS });
  const linhas: Viagem[] = [];
  const recusas: Recusa[] = [];

  for (const bruta of planilha.linhas) {
    const viagem = lerViagem(bruta, recusas);
    if (viagem) linhas.push(viagem);
  }

  return { linhas, recusas };
}

function lerViagem(bruta: LinhaDePlanilha, recusas: Recusa[]): Viagem | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };

  const dia = diaDeDDMMAAAA(celula(bruta, "Data"));
  if (!dia) return recusar("A data da viagem não está no formato ddmmaaaa.", celula(bruta, "Data"));

  const canal = lerCanal(celula(bruta, "Entrega"));
  if (!canal) return recusar("O canal da viagem não é Rota nem AS.", celula(bruta, "Entrega"));

  const frota = lerFrota(celula(bruta, "Frota"));
  if (!frota) return recusar("O tipo de frota não é reconhecido.", celula(bruta, "Frota"));

  const valorFrete = lerNumero(celula(bruta, "ValorFrete")) ?? 0;
  const valorFaturado = lerNumero(celula(bruta, "ValorFaturado")) ?? 0;

  return {
    linha: bruta.numero,
    dia,
    canal,
    frota,
    placa: String(celula(bruta, "Placa") ?? "").trim(),
    mapa: String(celula(bruta, "Mapa") ?? "").trim(),
    entregas: lerNumero(celula(bruta, "Entregas")) ?? 0,
    caixasCarregadas: lerNumero(celula(bruta, "CxCarreg")) ?? 0,
    caixasEntregues: lerNumero(celula(bruta, "CxEntreg")) ?? 0,
    valorFrete: centavos(valorFrete),
    percentualDeImposto: lerNumero(celula(bruta, "PercImposto")),
    valorDeImposto: centavos(lerNumero(celula(bruta, "ValorImposto")) ?? 0),
    valorFaturado: centavos(valorFaturado),
  };
}
