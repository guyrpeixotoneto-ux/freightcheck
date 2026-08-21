import { centavos } from "./dominio";
import { DIVERGENCIAS_CONHECIDAS } from "./reconciliacao";
import type {
  LinhaComparada,
  PainelComparado,
  ProcedenciaDaReferencia,
  QuadroComparado,
  ResumoDoMes,
  TresColunas,
} from "./resumo";

/**
 * O ENXERTO — a coluna da planilha entra depois de a conta estar pronta.
 *
 * Este módulo tem uma função pública e ela é uma transformação pura de
 * `PainelComparado` em `PainelComparado`. Recebe um painel já montado e devolve
 * outro com quatro campos preenchidos por linha e dois por quadro. **Não
 * recalcula nada.** `devido`, `demonstrado`, `diferenca`, `conjunto`, `memoria`
 * e `falta` atravessam por cópia, byte por byte.
 *
 * ---------------------------------------------------------------------------
 * Por que a coluna mora aqui e não dentro de `montarPainelComparado`
 * ---------------------------------------------------------------------------
 *
 * Porque a pergunta "a planilha pode contaminar a conta?" tem de ser
 * respondível **lendo imports**, e não confiando em quem escreveu.
 *
 * O grafo é de mão única e verificável:
 *
 * - `mapa-rota.ts` (onde o devido nasce) não importa este módulo, nem
 *   `referencia.ts`, nem `referencia-persistencia.ts`;
 * - `persistencia.ts` (onde o devido é montado do banco) idem;
 * - este módulo importa `resumo.ts` só para os **tipos**, e `reconciliacao.ts`
 *   só para o dicionário de causas — nenhum dos dois recebe nada daqui.
 *
 * Se um dia alguém precisar do número da planilha dentro do cálculo, terá de
 * escrever um import novo numa direção que hoje não existe — e esse import
 * aparece no diff. Um parâmetro opcional em `montarPainelComparado` não
 * apareceria.
 *
 * ---------------------------------------------------------------------------
 * O que a diferença significa, e o que ela deliberadamente não faz
 * ---------------------------------------------------------------------------
 *
 * `diferencaDaPlanilha` é `devido − planilha`, na mesma direção de
 * `diferenca` (`devido − demonstrado`), para que as duas colunas se leiam com o
 * mesmo sinal: positivo é o sistema pedindo mais.
 *
 * Ela **não é absorvida, nem arredondada para zero, nem tolerada** por estar em
 * `DIVERGENCIAS_CONHECIDAS`. A causa conhecida entra como texto ao lado; o
 * número continua inteiro. Um painel que zerasse a diferença cuja causa já se
 * conhece concordaria consigo mesmo por construção — e é exatamente o que a
 * regra "a prova não conserta nada" de `reconciliacao.ts` existe para impedir,
 * uma camada acima.
 */

/** Os números que a referência ativa publica, na forma que o enxerto consome. */
export interface NumerosDaReferencia {
  procedencia: ProcedenciaDaReferencia;
  /** `chave` → o que a planilha publica em cada quinzena. */
  numeros: Record<string, { primeira: number | null; segunda: number | null }>;
  /** `chave` → de que célula saiu cada quinzena. */
  celulas: Record<string, { primeira: string | null; segunda: string | null }>;
}

/**
 * A chave do total de cada quadro no `RESUMO GERAL`.
 *
 * O total do quadro é lido da planilha e **não** somado das linhas dela. Somar
 * esconderia justamente o defeito que a reconciliação encontrou na `AJ133`: um
 * total cuja fórmula discorda das próprias parcelas. Lendo os dois, a
 * discordância aparece.
 */
const TOTAL_DO_QUADRO: Record<string, string> = {
  REMUNERACAO: "total_remuneracao_rota",
  VARIAVEL: "total_remuneracao_rota_variavel",
  OUTROS_CUSTOS: "total_outros_custos",
};

function tres(primeira: number | null, segunda: number | null): TresColunas {
  const total = primeira === null && segunda === null ? null : centavos((primeira ?? 0) + (segunda ?? 0));
  return { primeira, segunda, total };
}

function menos(a: TresColunas, b: TresColunas): TresColunas {
  const sub = (x: number | null, y: number | null) =>
    x === null || y === null ? null : centavos(x - y);
  return {
    primeira: sub(a.primeira, b.primeira),
    segunda: sub(a.segunda, b.segunda),
    total: sub(a.total, b.total),
  };
}

/**
 * Enxerta a coluna da planilha num painel já montado.
 *
 * Com `referencia` nula devolve o painel **inalterado** — e devolve o mesmo
 * objeto, não uma cópia: um mês sem planilha anexada tem de se comportar
 * exatamente como se este módulo não existisse.
 */
export function comReferencia(
  painel: PainelComparado,
  referencia: NumerosDaReferencia | null,
): PainelComparado {
  if (!referencia) return painel;

  const daPlanilha = (chave: string): TresColunas | null => {
    const n = referencia.numeros[chave];
    if (!n) return null;
    /*
      Uma quinzena ausente na planilha é `null`, e não zero — a mesma disciplina
      do resto desta tela. A porta de leitura já recusa célula vazia, então na
      prática as duas vêm; o `null` aqui é o que sobra para uma referência
      antiga a que faltasse uma linha nova do catálogo.
    */
    if (n.primeira === null && n.segunda === null) return null;
    return tres(n.primeira, n.segunda);
  };

  const linhaComPlanilha = (linha: LinhaComparada): LinhaComparada => {
    const planilha = daPlanilha(linha.chave);
    return {
      /* Tudo o que veio do cálculo atravessa intacto — este spread é o contrato. */
      ...linha,
      planilha,
      diferencaDaPlanilha: planilha === null ? null : menos(linha.devido, planilha),
      celulaDaPlanilha: referencia.celulas[linha.chave] ?? null,
      causaConhecida: DIVERGENCIAS_CONHECIDAS[linha.chave] ?? null,
    };
  };

  const quadros: QuadroComparado[] = painel.quadros.map((quadro) => {
    const chaveDoTotal = TOTAL_DO_QUADRO[quadro.quadro];
    const planilha = chaveDoTotal ? daPlanilha(chaveDoTotal) : null;
    return {
      ...quadro,
      linhas: quadro.linhas.map(linhaComPlanilha),
      planilha,
      diferencaDaPlanilha: planilha === null ? null : menos(quadro.devido, planilha),
    };
  });

  return { ...painel, quadros, referencia: referencia.procedencia };
}

/**
 * Aplica o enxerto ao mês inteiro — um arquivo, os dois canais, as duas quinzenas.
 *
 * **Chamada pela rota, e não por `lerResumoDoMes`.** É a escolha que mantém
 * `persistencia.ts` sem um único import da referência: aquele módulo lê
 * competência, documentos, viagens e descontos, e continua sem saber que
 * planilha anexada existe. A rota busca as duas coisas — o resumo e a
 * referência ativa — e as junta aqui, depois.
 *
 * Um parâmetro opcional em `lerResumoDoMes` teria funcionado igual e provado
 * menos: o import estaria lá, e a próxima pessoa a mexer no cálculo teria a
 * planilha ao alcance da mão. Aqui ela não está.
 *
 * Com `referencia` nula devolve o mesmo objeto, sem cópia — ver {@link comReferencia}.
 */
export function resumoComReferencia(
  resumo: ResumoDoMes,
  referencia: NumerosDaReferencia | null,
): ResumoDoMes {
  if (!referencia) return resumo;
  return {
    ...resumo,
    canais: resumo.canais.map((canal) => ({
      ...canal,
      comparado: canal.comparado ? comReferencia(canal.comparado, referencia) : canal.comparado,
    })),
  };
}
