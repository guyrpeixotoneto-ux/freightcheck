import { centavos, lerNumero, type Canal, type Leitura, type Recusa } from "../dominio";
import { diaDeSerial, type Dia } from "../periodo";
import { canalDoNomeDaVerba, verbaDe, verbaDesconhecida, type Verba } from "../verbas";
import { celula, lerAba, type LinhaDePlanilha } from "./planilha";

/**
 * O 03.08.15 — os CT-es emitidos, verba a verba.
 *
 * É o extrato fiscal da quinzena: uma linha por documento emitido, com a
 * abertura completa dos impostos. É contra ele que tudo se confere, porque é
 * ele que diz o que a Ambev efetivamente faturou — a conciliação do Promax é
 * um resumo dele, e o resumo não permite achar *onde* a diferença está.
 *
 * **O arquivo é grande e o grão varia por verba.** Na quinzena conferida foram
 * 23.250 linhas: as verbas de frete variável trazem um CT-e por nota fiscal
 * (19.392 linhas só na VBZ 5), enquanto as verbas de valor fechado trazem uma
 * linha só. Ler linha a linha e agregar depois é o que permite conferir as
 * duas com o mesmo código.
 *
 * **A alíquota não é presumida — é medida.** Cada linha traz `Valor CT-e` e
 * `Vlr. Frete`, e a razão entre os dois é a carga tributária que a Ambev
 * aplicou naquele documento. O módulo nunca usa uma alíquota escrita em código
 * para converter valores: usa a que o arquivo declara, e quando a compara com
 * outra fonte, diz que está comparando.
 */

export interface LinhaDeCte {
  linha: number;
  dia: Dia | null;
  verba: Verba;
  canal: Canal;
  /** O número do CT-e. */
  numero: string;
  /** A nota fiscal que o CT-e acoberta. */
  documento: string;
  /** O valor total do documento — **com** imposto. */
  valorCte: number;
  /** A base: o frete **sem** imposto. */
  valorFrete: number;
  icms: number;
  pis: number;
  cofins: number;
  /** ICMS + PIS + COFINS, como o arquivo o traz. */
  imposto: number;
  /** A chave de acesso do documento. */
  controle: string;
}

const COLUNAS_EXIGIDAS = ["VBZ", "Desc VBZ", "Nr CT-e", "Valor CT-e", "Vlr. Frete"];

/** Lê o 03.08.15. */
export function lerCtes(arquivo: Buffer | ArrayBuffer): Leitura<LinhaDeCte> {
  const planilha = lerAba(arquivo, { exigidas: COLUNAS_EXIGIDAS });
  const linhas: LinhaDeCte[] = [];
  const recusas: Recusa[] = [];

  for (const bruta of planilha.linhas) {
    const lida = lerLinha(bruta, recusas);
    if (lida) linhas.push(lida);
  }

  return { linhas, recusas };
}

function lerLinha(bruta: LinhaDePlanilha, recusas: Recusa[]): LinhaDeCte | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };

  const vbz = lerNumero(celula(bruta, "VBZ"));
  if (vbz == null) return recusar("A linha não declara a VBZ.", celula(bruta, "VBZ"));

  const descricao = String(celula(bruta, "Desc VBZ") ?? "");
  /*
    O canal vem do prefixo da descrição porque o arquivo não tem coluna de
    canal. Quando o catálogo conhece a VBZ, ele é a autoridade — o prefixo
    serve de conferência; quando não conhece, o prefixo é tudo o que há.
  */
  const doCatalogo = verbaDe(vbz);
  const doNome = canalDoNomeDaVerba(descricao);
  const canal = doCatalogo?.canal ?? doNome;
  if (!canal) {
    return recusar(
      `A VBZ ${vbz} não está no catálogo e a descrição não diz o canal (deveria começar com "Rota -" ou "AS -").`,
      descricao,
    );
  }
  if (doCatalogo && doNome && doCatalogo.canal !== doNome) {
    return recusar(
      `A VBZ ${vbz} é de ${doCatalogo.canal} no catálogo, mas o arquivo a descreve como ${doNome}.`,
      descricao,
    );
  }

  const valorCte = lerNumero(celula(bruta, "Valor CT-e"));
  if (valorCte == null) return recusar("O valor do CT-e não é um número.", celula(bruta, "Valor CT-e"));

  return {
    linha: bruta.numero,
    dia: diaDeSerial(celula(bruta, "Data")),
    verba: doCatalogo ?? verbaDesconhecida(vbz, canal, descricao),
    canal,
    numero: String(celula(bruta, "Nr CT-e") ?? "").trim(),
    documento: String(celula(bruta, "Nr Documento") ?? "").trim(),
    valorCte: centavos(valorCte),
    valorFrete: centavos(lerNumero(celula(bruta, "Vlr. Frete")) ?? 0),
    icms: centavos(lerNumero(celula(bruta, "Vlr. ICMS")) ?? 0),
    pis: centavos(lerNumero(celula(bruta, "Vlr. PIS")) ?? 0),
    cofins: centavos(lerNumero(celula(bruta, "Vlr. COFINS")) ?? 0),
    imposto: centavos(lerNumero(celula(bruta, "Vlr. Imposto")) ?? 0),
    controle: String(celula(bruta, "Nr Controle") ?? "").trim().replace(/^'/, ""),
  };
}
