import { type Canal } from "./dominio";
import type { LinhaDeCte } from "./leitores/cte";
import type { Requisicao } from "./leitores/requisicoes";
import { STATUS_QUE_PAGA } from "./leitores/requisicoes";

/**
 * O fator que converte um valor do SRTrans em valor de CT-e — **medido**, nunca
 * presumido.
 *
 * O SRTrans move valores **sem** imposto: a requisição de despesa aprovada em
 * R$ 6.000,00 é R$ 6.000,00 líquidos. O CT-e é emitido **com** imposto. Entre
 * os dois há um fator, e comparar as duas fontes sem aplicá-lo é o erro mais
 * caro do fechamento — acusa divergência de 34% onde não há nenhuma.
 *
 * **Por que medir em vez de escrever a alíquota no código.** Porque há três
 * percentuais em jogo no mesmo fechamento, e eles não são iguais:
 *
 * | percentual | onde aparece | quinzena conferida |
 * | --- | --- | --- |
 * | o do pagamento, canal Rota | requisição → CT-e | 25,625% |
 * | o do pagamento, canal AS | requisição → CT-e | 27,391% |
 * | o fiscal, dentro do CT-e | `Vlr. Imposto` ÷ `Valor CT-e` | 26,477% |
 *
 * Os dois primeiros são regra de remuneração e mudam por canal; o terceiro é a
 * composição tributária do documento (ICMS + PIS + COFINS). Escrever qualquer
 * um deles em código seria congelar uma decisão da Ambev dentro do nosso
 * produto, e no dia em que ela mudasse o fechamento erraria calado.
 *
 * **A diferença entre o de pagamento e o fiscal é dinheiro, não arredondamento.**
 * Na quinzena conferida, o canal Rota converte a 25,625% enquanto o CT-e
 * compõe a 26,477%: o complementar chega ao CT-e com 1,17% a menos do que a
 * carga fiscal do próprio documento. É uma pergunta legítima para a Ambev, e é
 * o tipo de coisa que a planilha não tinha como mostrar.
 */

export interface Aliquota {
  canal: Canal;
  /** O multiplicador: valor sem imposto × fator = valor com imposto. */
  fator: number;
  /** A alíquota implícita, em pontos percentuais (`25.6252`). */
  percentual: number;
  /** Como foi medida — o que a torna sustentável até a célula de origem. */
  medida: {
    /** As VBZs em que a medição foi possível. */
    vbzs: number[];
    somaSemImposto: number;
    somaComImposto: number;
  };
}

/**
 * A composição tributária declarada dentro dos próprios CT-es.
 *
 * Não é a mesma coisa que o fator de pagamento e por isso tem tipo próprio:
 * confundir os dois é o que este arquivo existe para impedir.
 */
export interface CargaFiscal {
  fator: number;
  percentual: number;
  valorCte: number;
  valorFrete: number;
  icms: number;
  pis: number;
  cofins: number;
}

/**
 * Mede o fator de pagamento de cada canal.
 *
 * O método é o único que os arquivos permitem sem suposição: existem verbas
 * cujo CT-e **só** pode ter vindo de requisições — as de natureza complementar
 * que a conciliação do Promax não lista (Outras Despesas, Rem. Variável Equipe
 * Entrega, Estadias). Nelas, a razão entre o CT-e emitido e a requisição
 * aprovada *é* o fator, sem nada mais no meio.
 *
 * Somar todas as verbas assim de um canal antes de dividir — em vez de tirar a
 * média das razões — é o que faz a verba grande pesar mais que a pequena, que é
 * o comportamento certo quando o que se busca é a taxa que a Ambev aplicou.
 *
 * Devolve apenas os canais que puderam ser medidos: um canal sem nenhuma verba
 * exclusivamente de requisição fica de fora, e a apuração dirá que não pôde
 * converter em vez de converter por um fator emprestado do outro canal.
 */
export function medirAliquotas(
  ctes: LinhaDeCte[],
  requisicoes: Requisicao[],
): Aliquota[] {
  /*
    A verba serve de régua quando o CT-e dela não tem nenhuma outra origem
    possível: natureza complementar (não nasce da operação) e sem rubrica na
    conciliação (o Promax não soma nada nela).
  */
  const serveDeRegua = new Set(
    ctes
      .filter((c) => c.verba.natureza === "COMPLEMENTAR" && c.verba.rubricaDaConciliacao === null)
      .map((c) => c.verba.vbz),
  );

  const porCanal = new Map<Canal, { vbzs: Set<number>; comImposto: number; semImposto: number }>();

  for (const cte of ctes) {
    if (!serveDeRegua.has(cte.verba.vbz)) continue;
    const atual = porCanal.get(cte.canal) ?? { vbzs: new Set(), comImposto: 0, semImposto: 0 };
    atual.vbzs.add(cte.verba.vbz);
    atual.comImposto += cte.valorCte;
    porCanal.set(cte.canal, atual);
  }

  for (const req of requisicoes) {
    if (req.status.trim().toLowerCase() !== STATUS_QUE_PAGA) continue;
    if (!serveDeRegua.has(req.verba.vbz)) continue;
    const atual = porCanal.get(req.canal);
    if (!atual || !atual.vbzs.has(req.verba.vbz)) continue;
    atual.semImposto += req.valor;
  }

  const aliquotas: Aliquota[] = [];
  for (const [canal, m] of porCanal) {
    if (m.semImposto <= 0 || m.comImposto <= 0) continue;
    const fator = m.comImposto / m.semImposto;
    aliquotas.push({
      canal,
      fator,
      percentual: (1 - 1 / fator) * 100,
      medida: {
        vbzs: [...m.vbzs].sort((a, b) => a - b),
        somaSemImposto: m.semImposto,
        somaComImposto: m.comImposto,
      },
    });
  }

  return aliquotas.sort((a, b) => a.canal.localeCompare(b.canal));
}

/** A carga fiscal que os próprios CT-es declaram, por canal. */
export function medirCargaFiscal(ctes: LinhaDeCte[]): Map<Canal, CargaFiscal> {
  const porCanal = new Map<Canal, CargaFiscal>();
  for (const cte of ctes) {
    const atual =
      porCanal.get(cte.canal) ??
      ({ fator: 0, percentual: 0, valorCte: 0, valorFrete: 0, icms: 0, pis: 0, cofins: 0 } as CargaFiscal);
    atual.valorCte += cte.valorCte;
    atual.valorFrete += cte.valorFrete;
    atual.icms += cte.icms;
    atual.pis += cte.pis;
    atual.cofins += cte.cofins;
    porCanal.set(cte.canal, atual);
  }
  for (const carga of porCanal.values()) {
    carga.fator = carga.valorFrete > 0 ? carga.valorCte / carga.valorFrete : 0;
    carga.percentual = carga.valorCte > 0 ? (1 - carga.valorFrete / carga.valorCte) * 100 : 0;
  }
  return porCanal;
}
