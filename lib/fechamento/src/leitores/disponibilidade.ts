import { centavos, lerCanal, lerNumero, type Canal, type Leitura, type Recusa, type TipoDeFrotaContratada } from "../dominio";
import { diaDeSerial, type Dia } from "../periodo";
import { celula, lerAba, nomesDasAbas, type LinhaDePlanilha } from "./planilha";

/**
 * O 03.08.18 — frota contratada contra frota que rodou.
 *
 * É a fonte dos **descontos**: para cada dia, quantos veículos a transportadora
 * se comprometeu a pôr na rua, quantos de fato saíram, e de quem é a culpa pela
 * diferença. O gap atribuído à transportadora vira desconto sobre a parcela
 * fixa; o gap atribuído à Ambev (`Gap Cia.`) não desconta nada.
 *
 * **Essa distinção é o dinheiro.** Uma linha reclassificada de `Gap TP` para
 * `Gap Cia.` devolve o desconto daquele dia inteiro — e é exatamente por isso
 * que a planilha que este módulo substitui tem uma aba `Justificativa` com
 * motivos como "atraso de carregamento" e "desconto indevido". O leitor guarda
 * os gaps separados por responsabilidade e por cancelamento para que a
 * contestação tenha onde se apoiar.
 *
 * **Duas abas, um mesmo layout.** `FF` é a frota de caminhões e `Van` a frota
 * dedicada; as colunas são idênticas. Ler as duas e marcar a origem em cada
 * linha é o que evita duas funções que precisam ser mudadas juntas.
 */

export interface DiaDeDisponibilidade {
  linha: number;
  aba: string;
  tipoDeFrota: TipoDeFrotaContratada;
  dia: Dia;
  canal: Canal;
  /** O tamanho da frota cadastrada. */
  frotaTotal: number;
  /** Quantos veículos a transportadora se comprometeu a operar no dia. */
  contratada: number;
  realPrimeiraViagem: number;
  realSegundaViagem: number;
  /** A diferença total entre contratada e realizada. */
  gapTotal: number;
  /** A parte do gap que é da Ambev — **não** desconta. */
  gapDaCia: number;
  /** A parte do gap que é da transportadora, aberta como o relatório a abre. */
  gapDaTransportadora: {
    frotaCancelada: number;
    outrosCancelados: number;
    frotaNaoCancelada: number;
    outrosNaoCancelados: number;
  };
  descontos: {
    custoFixo: number;
    equipe: number;
    indiretos: number;
    fatorAjudante: number;
    /** O total que o relatório declara — conferido contra a soma das parcelas. */
    total: number;
  };
  percentualDeUtilizacao: number | null;
  percentualDeDisponibilidade: number | null;
}

const COLUNAS_EXIGIDAS = ["Data", "Canal", "Contratada", "Desconto Total"];

/** As abas que o relatório traz, e o tipo de frota de cada uma. */
const ABAS: { nome: string; tipo: TipoDeFrotaContratada }[] = [
  { nome: "FF", tipo: "FF" },
  { nome: "Van", tipo: "VAN" },
];

/**
 * Lê o 03.08.18, as duas abas.
 *
 * Uma aba ausente não é erro: há CDDs sem van. O que seria erro é ler nenhuma
 * das duas, e aí a exceção de cabeçalho da última tentativa sobe.
 */
export function lerDisponibilidade(arquivo: Buffer | ArrayBuffer): Leitura<DiaDeDisponibilidade> {
  const presentes = new Set(nomesDasAbas(arquivo));
  const linhas: DiaDeDisponibilidade[] = [];
  const recusas: Recusa[] = [];
  let lidas = 0;

  for (const { nome, tipo } of ABAS) {
    if (!presentes.has(nome)) continue;
    const planilha = lerAba(arquivo, { aba: nome, exigidas: COLUNAS_EXIGIDAS });
    lidas += 1;
    for (const bruta of planilha.linhas) {
      const lida = lerLinha(bruta, nome, tipo, recusas);
      if (lida) linhas.push(lida);
    }
  }

  if (lidas === 0) {
    throw new Error(
      `O arquivo não tem nenhuma das abas do relatório de disponibilidade (${ABAS.map((a) => a.nome).join(", ")}). ` +
        `Encontradas: ${[...presentes].join(", ") || "nenhuma"}.`,
    );
  }

  return { linhas, recusas };
}

function lerLinha(
  bruta: LinhaDePlanilha,
  aba: string,
  tipoDeFrota: TipoDeFrotaContratada,
  recusas: Recusa[],
): DiaDeDisponibilidade | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };

  const dia = diaDeSerial(celula(bruta, "Data"));
  if (!dia) return recusar("A data do dia não é um serial de data válido.", celula(bruta, "Data"));

  const canal = lerCanal(celula(bruta, "Canal"));
  if (!canal) return recusar("O canal do dia não é Rota nem AS.", celula(bruta, "Canal"));

  const n = (coluna: string) => lerNumero(celula(bruta, coluna)) ?? 0;

  return {
    linha: bruta.numero,
    aba,
    tipoDeFrota,
    dia,
    canal,
    frotaTotal: n("Frota Total"),
    contratada: n("Contratada"),
    realPrimeiraViagem: n("Real 1º Viagem"),
    realSegundaViagem: n("Real 2º Viagem"),
    gapTotal: n("Gap FF TT"),
    gapDaCia: n("Gap Cia."),
    gapDaTransportadora: {
      frotaCancelada: n("Gap TP Frota Canc."),
      outrosCancelados: n("Gap TP Outros Canc."),
      frotaNaoCancelada: n("Gap TP Frota N.Canc."),
      outrosNaoCancelados: n("Gap TP Outros N.Canc."),
    },
    descontos: {
      custoFixo: centavos(n("Desc.FF Custo Fixo")),
      equipe: centavos(n("Desc.FF Equipe")),
      indiretos: centavos(n("Desc.FF Indiretos")),
      fatorAjudante: centavos(n("Desconto FA")),
      total: centavos(n("Desconto Total")),
    },
    percentualDeUtilizacao: lerNumero(celula(bruta, "% Utilização Total")),
    percentualDeDisponibilidade: lerNumero(celula(bruta, "% Disponib.")),
  };
}
