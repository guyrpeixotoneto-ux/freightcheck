import {
  ROTULO_DA_BASE_DO_TRAJETO,
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DA_VELOCIDADE,
  celulasDoCsvDeVelocidade,
  COLUNAS_DO_CSV_DE_VELOCIDADE,
  type EstadoDaLinhaDeVelocidade,
  type LinhaDeVelocidade,
  type MedidaDaVariavel,
  type PapelDoTempo,
  type ParticaoDaVigencia,
  type TempoPagoDaVigencia,
  type VelocidadeDaVigencia,
} from "@workspace/comparison/velocidade-media";
import { numeroParaCsv } from "@/lib/csv";
import { formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Velocidade Média — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/velocidade-media`, que o
 * servidor também importa: estado, diferença, variação, partição do ciclo,
 * conferência da velocidade e folga do tempo pago saem de lá, e a tela nunca
 * refaz nenhuma delas.
 *
 * O que este arquivo acrescenta é o que é de apresentação — e aqui isso inclui
 * **escrever minuto como gente lê minuto**: 696 minutos é um número que ninguém
 * compara de cabeça, e "11h 36min" é o mesmo número legível. A conversão é só de
 * escrita: nenhuma conta desta tela passa por ela.
 */

/** O que a API de `/velocidade-media/comparacao` devolve. */
export interface ComparacaoDeVelocidade {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: {
    trechosComparados: number;
    semAlteracao: number;
    trechosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    trechosComDadoIncompleto: number;
    trechosComConflito: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
      foraDaSoma: number;
      paradasAlteradas: number;
      velocidadesAlteradas: number;
      versaoLucroAlterada: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    papel: PapelDoTempo;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeVelocidade;
    rotulo: string;
    trechos: number;
    fracao: number;
  }[];
  linhas: LinhaDeVelocidade[];
}

/** O que a API de `/velocidade-media/totais` devolve: as três séries. */
export interface TotaisDeVelocidade {
  particao: ParticaoDaVigencia[];
  velocidade: VelocidadeDaVigencia[];
  tempoPago: TempoPagoDaVigencia[];
}

/**
 * Minutos escritos como horas e minutos.
 *
 * É a única conversão de unidade desta tela, e ela é **só de escrita**: a fonte
 * declara minutos, o núcleo conta em minutos e o CSV exporta minutos. O que muda
 * é a leitura — 696 e 726 são dois números que ninguém compara de cabeça, e
 * "11h 36min" contra "12h 06min" se compara sozinho.
 *
 * Abaixo de uma hora fica só em minutos: "0h 48min" é mais difícil de ler do que
 * "48 min", e esta tela tem muitas linhas de TMA e refeição nessa faixa.
 */
export function escreverMinutos(valor: number | null): string {
  if (valor === null) return "—";
  const sinal = valor < 0 ? "−" : "";
  const absoluto = Math.abs(valor);
  if (absoluto < 60) return `${sinal}${formatNumber(absoluto, 0)} min`;
  const horas = Math.floor(absoluto / 60);
  const minutos = Math.round(absoluto - horas * 60);
  /* 59,7 min arredonda para 60 e viraria "11h 60min". */
  if (minutos === 60) return `${sinal}${horas + 1}h 00min`;
  return `${sinal}${horas}h ${String(minutos).padStart(2, "0")}min`;
}

/** Uma velocidade escrita, com uma casa. */
export function escreverVelocidade(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 1)} km/h`;
}

/** Uma fração escrita como percentual inteiro — `0.62` vira "62%". */
export function escreverFracao(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor * 100, 1)}%`;
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * É a razão de `medida` viajar em cada linha: numa mesma coluna convivem `58`
 * (km/h), `696` (minutos), `412` (km) e `1,4` (motoristas por conjunto).
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  if (medida === "TEXTO") return valor;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "MINUTOS":
      return escreverMinutos(numero);
    case "VELOCIDADE":
      return escreverVelocidade(numero);
    case "DISTANCIA":
      return `${formatNumber(numero, 1)} km`;
    case "FATOR":
      return formatNumber(numero, 2);
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "DATA":
      return valor;
    default:
      return valor;
  }
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O sinal vem escrito mesmo quando é positivo: numa coluna em que metade das
 * linhas sobe e metade desce, "30 min" e "−30 min" a três linhas de distância se
 * confundem, e "+30 min" não se confunde com nada.
 */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null) return "—";
  const sinal = diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";
  const absoluto = Math.abs(diferenca);
  switch (medida) {
    case "MINUTOS":
      return `${sinal}${escreverMinutos(absoluto)}`;
    case "VELOCIDADE":
      return `${sinal}${formatNumber(absoluto, 1)} km/h`;
    case "DISTANCIA":
      return `${sinal}${formatNumber(absoluto, 1)} km`;
    case "FATOR":
      return `${sinal}${formatNumber(absoluto, 2)}`;
    case "PERCENTUAL":
      return `${sinal}${formatNumber(absoluto, 2)} p.p.`;
    default:
      return `${sinal}${formatNumber(absoluto, 0)}`;
  }
}

/** A variação em pontos percentuais. Nula quando a base é zero. */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
  return `${sinal}${formatNumber(Math.abs(variacao), 2)}%`;
}

/**
 * A cor de um número que subiu ou desceu — e por que quase nada aqui recebe uma.
 *
 * **Tempo parado que cresce é ruim**, e é o único caso em que esta tela se
 * arrisca a um juízo: TMA e refeição maiores são conjunto esperando, e o
 * dicionário liga isso ao dimensionamento de motoristas.
 *
 * O resto fica na tinta normal, e é deliberado. Velocidade que sobe não é boa
 * por si — pode ser um parâmetro afrouxado, não um percurso mais rápido. Ciclo
 * que encurta pode ser eficiência ou um tempo interno que alguém tirou da conta.
 * Distância não tem lado. Pintá-los afirmaria um juízo que esta tela não tem como
 * sustentar, e o sinal já diz tudo o que há para dizer.
 */
export function corDaDiferenca(diferenca: number | null, papel: PapelDoTempo): string {
  if (diferenca === null || diferenca === 0 || papel !== "TEMPO_PARADO") return "";
  return diferenca > 0 ? "text-destructive" : "text-success";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeVelocidade, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/** Como a tela escreve a unidade de cada papel, curto. */
export const UNIDADE_DO_PAPEL: Record<PapelDoTempo, string> = {
  VELOCIDADE: "km/h",
  TEMPO_TOTAL: "min",
  TEMPO_RODANDO: "min",
  TEMPO_PARADO: "min",
  DISTANCIA: "km",
  FATOR: "motoristas",
  CONTEXTO: "—",
};

export {
  ROTULO_DA_BASE_DO_TRAJETO,
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DA_VELOCIDADE,
};

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeVelocidade;
  rotulo: string;
}[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDeVelocidade {
  busca: string;
  papel: "TODOS" | PapelDoTempo;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeVelocidade;
  /** Só o tempo que remunera — a versão lucro, separada do que a operação pratica. */
  soVersaoLucro: boolean;
}

export const FILTROS_VAZIOS: FiltrosDeVelocidade = {
  busca: "",
  papel: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soVersaoLucro: false,
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 */
export function filtrar(
  linhas: readonly LinhaDeVelocidade[],
  filtros: FiltrosDeVelocidade,
): LinhaDeVelocidade[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.papel !== "TODOS" && l.papel !== filtros.papel) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soVersaoLucro && !l.versaoLucro) return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeVelocidade[],
  filtros: FiltrosDeVelocidade,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrar(linhas, { ...filtros, estado: aba.chave }).length;
  }
  contagem.TODAS = filtrar(linhas, { ...filtros, estado: "TODAS" }).length;
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeVelocidade`), e aqui só se converte
 * número em texto do Excel brasileiro. **O arquivo sai em minutos**, e não em
 * horas e minutos: "11h 36min" é uma string para a planilha, e 696 é um número
 * que ela soma, ordena e usa em fórmula.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeVelocidade[],
  /*
     O que o gestor escreveu sobre cada alteração, por `change.id` — a mesma
     leitura que a coluna da tabela usa. Opcional porque ela pode não ter
     voltado: um CSV com a coluna em branco continua sendo o arquivo da
     comparação, e recusá-lo por causa do comentário seria trocar o dado pela
     nota sobre o dado.
  */
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_VELOCIDADE],
    ...linhas.map((l) =>
      celulasDoCsvDeVelocidade(
        l,
        l.id === null ? null : (justificadaPor?.get(l.id)?.texto ?? null),
      ).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}
