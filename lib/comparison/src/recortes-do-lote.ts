import type { AlteracaoDoMotor, EstadoDaLinha } from "./recorte-de-rubrica";
import type { FiltrosDoLote } from "./justificativa-em-lote";

import {
  CODIGOS_DO_DETALHE_DE_ALUGUEL,
  FILTROS_DE_ALUGUEL_VAZIOS,
  filtrarLinhasDeAluguel,
  lerFiltrosDeAluguel,
  linhasDeAluguel,
} from "./aluguel";
import {
  CODIGOS_DO_DETALHE_DE_AQUISICAO,
  FILTROS_DE_AQUISICAO_VAZIOS,
  filtrarLinhasDeAquisicao,
  lerFiltrosDeAquisicao,
  linhasDeAquisicao,
} from "./aquisicao";
import {
  CODIGOS_DO_DETALHE,
  FILTROS_DE_FINAME_VAZIOS,
  filtrarLinhasDeFiname,
  lerFiltrosDeFiname,
  linhasDeFiname,
} from "./finame";
import {
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  FILTROS_DE_IMPOSTOS_VAZIOS,
  filtrarLinhasDeImpostos,
  lerFiltrosDeImpostos,
  linhasDeImpostos,
} from "./impostos";
import {
  CODIGOS_DO_DETALHE_DE_IPVA,
  FILTROS_DE_IPVA_VAZIOS,
  filtrarLinhasDeIpva,
  lerFiltrosDeIpva,
  linhasDeIpva,
} from "./ipva";
import {
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  FILTROS_DE_LUCRO_FIXO_VAZIOS,
  filtrarLinhasDeLucroFixo,
  lerFiltrosDeLucroFixo,
  linhasDeLucroFixo,
} from "./lucro-fixo";
import {
  CODIGOS_DO_DETALHE_DE_MANUTENCAO,
  FILTROS_DE_MANUTENCAO_VAZIOS,
  filtrarLinhasDeManutencao,
  lerFiltrosDeManutencao,
  linhasDeManutencao,
} from "./manutencao";
import {
  CODIGOS_DO_DETALHE_DE_SEGURO,
  FILTROS_DE_SEGURO_VAZIOS,
  filtrarLinhasDeSeguro,
  lerFiltrosDeSeguro,
  linhasDeSeguro,
} from "./seguro";

/**
 * OS RECORTES DAS RUBRICAS — o único lugar em que as oito se encontram.
 *
 * ---------------------------------------------------------------------------
 * Para que ele existe
 * ---------------------------------------------------------------------------
 * Para responder **uma** pergunta, que só o servidor faz: *dado o filtro que a
 * tela tinha, quais alterações estão no recorte?* Ela nasce de "Selecionar
 * todos os 206 resultados": ali o cliente não manda ids — manda o filtro —, e
 * quem tem de reabrir o universo é quem vai gravar.
 *
 * Reabri-lo com uma segunda escrita da regra seria a pior versão desta
 * funcionalidade: as duas concordariam no dia em que fossem escritas e
 * discordariam no seguinte, e a discordância apareceria como justificativa
 * gravada em linhas que ninguém viu. Por isso cada entrada aqui aponta para
 * **as mesmas funções que a tela usa** — `linhasDeX`, `filtrarLinhasDeX` —, e
 * não para cópias delas. Uma rubrica que mude de filtro muda num arquivo só, e
 * o lote acompanha sem edição nenhuma.
 *
 * ---------------------------------------------------------------------------
 * Por que ele é um módulo separado
 * ---------------------------------------------------------------------------
 * Porque importar as oito rubricas custa caro, e quem paga seria o navegador.
 * `justificativa-em-lote.ts` — as regras do lote, que a tela precisa — não
 * conhece rubrica nenhuma justamente para poder ser carregado sozinho; este
 * arquivo, que carrega o catálogo das oito, é importado só pela rota. É a mesma
 * decisão que mantém `@workspace/ingest` fora do bundle das telas.
 *
 * ---------------------------------------------------------------------------
 * O que ele deliberadamente não tem
 * ---------------------------------------------------------------------------
 * **As linhas "sem alteração".** O alternador "Mostrar veículos sem alteração"
 * faz a tela ler o acervo das duas pontas e costurar as linhas iguais; elas não
 * têm `change.id`, e portanto não há sobre o que gravar. O lote as ignora por
 * construção — não porque alguém se lembrou de filtrá-las, mas porque só entra
 * aqui o que o motor produziu.
 *
 * **Velocidade Média, Km Rodado, Consumo, Pneu e TMA.** Elas têm a coluna de
 * justificar, mas não a tabela por veículo com seleção: a entrada do modo em
 * lote é a caixa da linha, e onde ela não existe uma entrada aqui prometeria
 * uma rota que nenhuma tela chama.
 */

/** O mínimo que o lote precisa de uma linha de rubrica, qualquer que seja ela. */
export interface LinhaRecortavel {
  /** O `change.id`. Nulo na linha "sem alteração", que não tem o que justificar. */
  id: number | null;
  estado: EstadoDaLinha;
}

/**
 * Como uma rubrica reabre o próprio recorte.
 *
 * `codigos` é o que a leitura pede ao banco — os mesmos códigos de atributo da
 * rota da rubrica, e não um subconjunto: um recorte lido com menos colunas do
 * que a tela mostra devolveria um universo menor do que o que se viu.
 */
export interface RecorteDoLote {
  /** Os códigos de atributo que a rubrica lê. */
  codigos: readonly string[];
  /** As alterações do motor viradas linhas da rubrica. */
  linhas: (alteracoes: readonly AlteracaoDoMotor[]) => LinhaRecortavel[];
  /** O filtro como o corpo o traz, validado. */
  lerFiltros: (bruto: unknown) => FiltrosDoLote;
  /** O recorte, com a mesma função que desenhou a tabela. */
  filtrar: (linhas: readonly LinhaRecortavel[], filtros: FiltrosDoLote) => LinhaRecortavel[];
  /** Os filtros vazios — o que `descreverEscopoDoLote` usa para se calar sobre o que não foi filtrado. */
  padroes: FiltrosDoLote;
}

/*
  A conversão de tipo em cada entrada é o preço de o registro ser um mapa de
  oito rubricas com oito tipos de linha e oito tipos de filtro.

  Ela é segura porque as três funções de cada entrada vêm **da mesma rubrica**:
  `filtrarLinhasDeIpva` só recebe o que `linhasDeIpva` produziu, e o filtro só
  vem de `lerFiltrosDeIpva`. O que o registro apaga é a ligação entre elas no
  tipo, e não no caminho — nenhum chamador escolhe as três separadamente.

  A alternativa seria um genérico com dois parâmetros por entrada, que o
  TypeScript não sabe estreitar ao indexar um mapa heterogêneo: a conversão
  reapareceria no consumidor, mais longe de onde a garantia é dada.
*/
const recorte = <L extends LinhaRecortavel, F>(entrada: {
  codigos: readonly string[];
  linhas: (a: readonly AlteracaoDoMotor[]) => L[];
  lerFiltros: (bruto: unknown) => F;
  filtrar: (linhas: readonly L[], filtros: F) => L[];
  padroes: F;
}): RecorteDoLote => entrada as unknown as RecorteDoLote;

export const RECORTES_DO_LOTE: Record<string, RecorteDoLote> = {
  aluguel: recorte({
    codigos: CODIGOS_DO_DETALHE_DE_ALUGUEL,
    linhas: linhasDeAluguel,
    lerFiltros: lerFiltrosDeAluguel,
    filtrar: filtrarLinhasDeAluguel,
    padroes: FILTROS_DE_ALUGUEL_VAZIOS,
  }),
  aquisicao: recorte({
    codigos: CODIGOS_DO_DETALHE_DE_AQUISICAO,
    linhas: linhasDeAquisicao,
    lerFiltros: lerFiltrosDeAquisicao,
    filtrar: filtrarLinhasDeAquisicao,
    padroes: FILTROS_DE_AQUISICAO_VAZIOS,
  }),
  finame: recorte({
    codigos: CODIGOS_DO_DETALHE,
    linhas: linhasDeFiname,
    lerFiltros: lerFiltrosDeFiname,
    filtrar: filtrarLinhasDeFiname,
    padroes: FILTROS_DE_FINAME_VAZIOS,
  }),
  impostos: recorte({
    codigos: CODIGOS_DO_DETALHE_DE_IMPOSTOS,
    linhas: linhasDeImpostos,
    lerFiltros: lerFiltrosDeImpostos,
    filtrar: filtrarLinhasDeImpostos,
    padroes: FILTROS_DE_IMPOSTOS_VAZIOS,
  }),
  ipva: recorte({
    codigos: CODIGOS_DO_DETALHE_DE_IPVA,
    linhas: linhasDeIpva,
    lerFiltros: lerFiltrosDeIpva,
    filtrar: filtrarLinhasDeIpva,
    padroes: FILTROS_DE_IPVA_VAZIOS,
  }),
  "lucro-fixo": recorte({
    codigos: CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
    linhas: linhasDeLucroFixo,
    /* Sem o terceiro parâmetro: as viradas saem das próprias linhas, que é
       exatamente o que a tela passa. Ver `filtrarLinhasDeLucroFixo`. */
    lerFiltros: lerFiltrosDeLucroFixo,
    filtrar: filtrarLinhasDeLucroFixo,
    padroes: FILTROS_DE_LUCRO_FIXO_VAZIOS,
  }),
  manutencao: recorte({
    codigos: CODIGOS_DO_DETALHE_DE_MANUTENCAO,
    linhas: linhasDeManutencao,
    lerFiltros: lerFiltrosDeManutencao,
    filtrar: filtrarLinhasDeManutencao,
    padroes: FILTROS_DE_MANUTENCAO_VAZIOS,
  }),
  seguro: recorte({
    codigos: CODIGOS_DO_DETALHE_DE_SEGURO,
    linhas: linhasDeSeguro,
    lerFiltros: lerFiltrosDeSeguro,
    filtrar: filtrarLinhasDeSeguro,
    padroes: FILTROS_DE_SEGURO_VAZIOS,
  }),
};

/** As rubricas que o lote por filtro atende, para quem precisa listá-las. */
export const RUBRICAS_DO_LOTE = Object.keys(RECORTES_DO_LOTE).sort();
