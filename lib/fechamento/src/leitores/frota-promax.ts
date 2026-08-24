import type { Leitura, Recusa } from "../dominio";
import { celula, lerAba, nomesDasAbas, type LinhaDePlanilha } from "./planilha";
import {
  COLUNAS_EXIGIDAS_FROTA_PROMAX,
  COLUNAS_OPCIONAIS_FROTA_PROMAX,
} from "./mapeamento-frota-promax";

/**
 * A frota do Promax — 01.22.02.00 (ativa) e 01.22.08.00 (inativa).
 *
 * **Conferência operacional, não financeira.** Este leitor não produz nenhum
 * número que entra em cálculo de remuneração: é o retrato de quais veículos o
 * Promax marca como ativos, ou inativos, na quinzena. O que se faz com ele é
 * comparar contra o que o cadastro do contrato declara (ver
 * `frota-promax-comparacao.ts`) — nunca somar, descontar, ou formar devido.
 *
 * **Uma linha por veículo, um arquivo por situação.** Ao contrário do
 * 03.08.18, que traz as duas frotas (FF e Van) no mesmo arquivo com abas
 * separadas, o layout assumido aqui tem a ativa e a inativa em **relatórios
 * diferentes** — é por isso que o tipo (`ATIVA` | `INATIVA`) é parâmetro de
 * quem chama, e não algo que o arquivo declara linha a linha. Ver o TODO em
 * `dominio.ts` sobre a possibilidade de o Promax também separar FF de Van em
 * arquivos próprios — não implementada nesta versão.
 *
 * **O cabeçalho tem de bater, ou a leitura recusa o arquivo inteiro.** Não há
 * meio-termo de "algumas colunas reconhecidas, resto ignorado por posição":
 * sem `Unidade`, `Placa` e `Modelo` reconhecidos, `lerAba` já lança
 * `CabecalhoNaoEncontrado` — este leitor deixa o erro subir, com uma frase que
 * nomeia o relatório esperado.
 *
 * TODO(Rebeca): o layout de colunas é assumido, não confirmado — ver
 * `mapeamento-frota-promax.ts`.
 */

export type SituacaoDaFrotaPromax = "ATIVA" | "INATIVA";

export interface VeiculoDaFrotaPromax {
  /** A linha física do arquivo, 1-based — a mesma numeração que o Excel mostra. */
  linha: number;
  situacao: SituacaoDaFrotaPromax;
  /** A unidade/operação — `443`, `CDD Belém`, como o relatório a identifica. */
  unidade: string;
  placa: string;
  /** O modelo/categoria do veículo, como o relatório o escreve — texto livre. */
  modelo: string;
  /** `Categoria`, quando o relatório a traz — reservado para uma futura discriminação FF/Van. */
  categoria: string | null;
}

const ROTINA: Record<SituacaoDaFrotaPromax, string> = {
  ATIVA: "01.22.02.00",
  INATIVA: "01.22.08.00",
};

function textoOuNulo(bruto: unknown): string | null {
  const texto = String(bruto ?? "").trim();
  return texto === "" ? null : texto;
}

function lerLinha(
  bruta: LinhaDePlanilha,
  situacao: SituacaoDaFrotaPromax,
  recusas: Recusa[],
): VeiculoDaFrotaPromax | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };

  const unidade = textoOuNulo(celula(bruta, "Unidade"));
  if (!unidade) return recusar("A linha não diz a unidade/operação do veículo.", celula(bruta, "Unidade"));

  const placa = textoOuNulo(celula(bruta, "Placa"));
  if (!placa) return recusar("A linha não tem placa.", celula(bruta, "Placa"));

  const modelo = textoOuNulo(celula(bruta, "Modelo"));
  if (!modelo) return recusar("A linha não diz o modelo/categoria do veículo.", celula(bruta, "Modelo"));

  return {
    linha: bruta.numero,
    situacao,
    unidade,
    placa: placa.toUpperCase(),
    modelo,
    categoria: textoOuNulo(celula(bruta, "Categoria")),
  };
}

/**
 * Lê a frota do Promax — a ativa ou a inativa, conforme `situacao`.
 *
 * `situacao` é obrigatório e não inferido: são dois relatórios diferentes do
 * Promax (rotinas diferentes), e nada no arquivo em si declara "eu sou o dos
 * ativos" — é a casinha de envio que sabe (ver `persistencia.ts`, que passa a
 * `situacao` de acordo com `TipoDeFonte`).
 */
export function lerFrotaPromax(
  arquivo: Buffer | ArrayBuffer,
  situacao: SituacaoDaFrotaPromax,
): Leitura<VeiculoDaFrotaPromax> {
  /*
    O arquivo pode não ter abas nomeadas (texto/CSV) — `lerAba` sem `aba` usa a
    primeira tabela que encontrar, exatamente como os outros leitores tabulares
    do módulo. `nomesDasAbas` só é chamado aqui para a mensagem de erro poder
    dizer o que foi encontrado, quando nada bate.
  */
  let planilha;
  try {
    planilha = lerAba(arquivo, {
      exigidas: COLUNAS_EXIGIDAS_FROTA_PROMAX,
    });
  } catch (erro) {
    const abas = nomesDasAbas(arquivo);
    throw new Error(
      `O arquivo não parece ser o relatório de frota Promax ${ROTINA[situacao]} — o cabeçalho ` +
        `esperado (${COLUNAS_EXIGIDAS_FROTA_PROMAX.join(", ")}) não foi encontrado` +
        `${abas.length > 0 ? `, e as abas do arquivo são: ${abas.join(", ")}` : ""}. ` +
        `Confira se não trocou a aba de envio, e se o layout do relatório não mudou desde a ` +
        `última confirmação com a Rebeca. Detalhe original: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
    );
  }

  const linhas: VeiculoDaFrotaPromax[] = [];
  const recusas: Recusa[] = [];
  for (const bruta of planilha.linhas) {
    const lida = lerLinha(bruta, situacao, recusas);
    if (lida) linhas.push(lida);
  }

  return { linhas, recusas };
}

/** As colunas opcionais que este leitor reconhece — exposto para os testes de fixture. */
export const COLUNAS_OPCIONAIS = COLUNAS_OPCIONAIS_FROTA_PROMAX;
