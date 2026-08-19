import { centavos, lerCanal, lerNumero, type Canal, type Leitura, type Recusa } from "../dominio";
import { diaDeCelula, type Dia } from "../periodo";
import { verbaDe, verbaDesconhecida, type Verba } from "../verbas";
import { celula, lerAba, type LinhaDePlanilha } from "./planilha";

/**
 * O 03.08.12.09 — as requisições de despesa aprovadas.
 *
 * É o complementar: tudo que a operação gastou fora do cálculo automático e
 * conseguiu aprovar — incentivo, hora extra, remuneração variável da equipe,
 * taxa de descarga, pernoite, pedágio. O valor circula **sem imposto**, e cada
 * requisição aponta a VBZ em que virará CT-e.
 *
 * **O que este leitor guarda que a planilha jogava fora: a trilha de
 * aprovação.** Cada linha traz quem pediu, quem aprovou no regional, quem
 * aprovou no AC, e quando. A `.xlsb` somava a coluna de valor e seguia; aqui a
 * trilha fica, porque "esta despesa não foi paga" e "esta despesa não foi
 * aprovada a tempo" são pendências diferentes, com donos diferentes.
 *
 * **O arquivo sai do SRTrans em CSV com ponto e vírgula, em latin-1** — e essa
 * continua sendo a forma de sempre. O que mudou é que ela deixou de ser a
 * única: o mesmo relatório chega em `.xlsx` quando alguém o abre e salva, e
 * chega em UTF-8 quando o Excel o regrava como "CSV UTF-8". As três formas
 * entram pela mesma porta (`lerAba`, em `planilha.ts`), que decide pelo
 * conteúdo e não pela extensão; a codificação continua sendo latin-1 por
 * declaração da origem, e só muda quando o próprio arquivo declara outra com
 * uma BOM — ler `Pesquisa de Risco` com o acento quebrado transformaria o tipo
 * de despesa em duas categorias distintas na tela.
 */

export interface Requisicao {
  linha: number;
  /** O número da requisição no SRTrans — a identidade dela. */
  numero: string;
  /** A quinzena de pagamento, como o arquivo a rotula: o primeiro dia do período. */
  quinzenaDePagamento: Dia | null;
  canal: Canal;
  verba: Verba;
  /** O tipo de despesa, pelo código e nome do SRTrans. */
  tipoDeDespesa: { codigo: string; nome: string };
  /** O que quem pediu escreveu — `Incentivo Geo - Dias de Jogos`, `Fretado Feriado`. */
  descricao: string;
  /** `Aprovada`, `Reprovada`, `Pendente` — como veio. */
  status: string;
  /** O valor **sem** imposto. */
  valor: number;
  solicitante: string;
  aprovadorRegional: string;
  aprovadorAC: string;
  enviadaEm: Dia | null;
  decididaEm: Dia | null;
}

/** O status que faz a requisição entrar na conta. */
export const STATUS_QUE_PAGA = "aprovada";

/**
 * As quatro colunas sem as quais a requisição não vira dinheiro em verba
 * nenhuma — e, por isso, as que identificam o relatório.
 */
const COLUNAS_EXIGIDAS = ["Requisição", "Canal", "Cod. VBZ", "Valor"];

/**
 * Lê o 03.08.12.09.
 *
 * A leitura passou a ser por **nome de coluna** e não por posição no cabeçalho.
 * Enquanto a única forma era o CSV de ponto e vírgula, cortar a linha e contar
 * campos dava no mesmo; com a planilha no caminho não dá — lá não há linha para
 * cortar. `lerAba` normaliza os três formatos na mesma grade, e daqui para
 * baixo o leitor só conhece colunas.
 */
export function lerRequisicoes(arquivo: Buffer | ArrayBuffer): Leitura<Requisicao> {
  const planilha = lerAba(arquivo, { exigidas: COLUNAS_EXIGIDAS });
  const linhas: Requisicao[] = [];
  const recusas: Recusa[] = [];

  for (const bruta of planilha.linhas) {
    const lida = lerLinha(bruta, recusas);
    if (lida) linhas.push(lida);
  }

  return { linhas, recusas };
}

function lerLinha(bruta: LinhaDePlanilha, recusas: Recusa[]): Requisicao | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };
  const texto = (coluna: string) => String(celula(bruta, coluna) ?? "").trim();

  const canal = lerCanal(celula(bruta, "Canal"));
  if (!canal) return recusar("O canal da requisição não é Rota nem AS.", celula(bruta, "Canal"));

  const vbz = lerNumero(celula(bruta, "Cod. VBZ"));
  if (vbz == null) return recusar("A requisição não aponta uma VBZ.", celula(bruta, "Cod. VBZ"));

  const valor = lerNumero(celula(bruta, "Valor"));
  if (valor == null) return recusar("O valor da requisição não é um número.", celula(bruta, "Valor"));

  return {
    linha: bruta.numero,
    numero: texto("Requisição"),
    quinzenaDePagamento: diaDeCelula(celula(bruta, "Quinzena Pagamento")),
    canal,
    verba: verbaDe(vbz) ?? verbaDesconhecida(vbz, canal, texto("VBZ")),
    tipoDeDespesa: {
      codigo: texto("Cod Tipo Despesa"),
      nome: texto("Tipo Despesa"),
    },
    descricao: texto("Descrição Despesa"),
    status: texto("Status"),
    valor: centavos(valor),
    solicitante: texto("ID Solicitante"),
    aprovadorRegional: texto("ID Aprovador RG"),
    aprovadorAC: texto("ID Aprovador AC"),
    enviadaEm: diaDeCelula(celula(bruta, "Data Envio Requisição")),
    decididaEm: diaDeCelula(celula(bruta, "Data Decisão Regional")),
  };
}
