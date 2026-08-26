/**
 * Quanto da leitura já passou — medido enquanto ela acontece.
 *
 * ---------------------------------------------------------------------------
 * Por que isto existe
 * ---------------------------------------------------------------------------
 * Tudo que `import_run` guardava sobre uma leitura descrevia trabalho
 * **terminado**: `raw_cell_count` é escrito quando a cópia acaba,
 * `staged_fact_count` quando o preparo acaba. Enquanto o arquivo corria, a
 * única coisa que existia era o estado — READING —, e um estado não tem
 * tamanho. A tela dizia "lendo…" no primeiro segundo e no último, e num
 * arquivo de dezenas de milhares de células isso são minutos em que ninguém
 * consegue distinguir um leitor trabalhando de um processo que morreu.
 *
 * O relator é quem escreve o que falta: em que trecho o pipeline está, de que
 * tamanho é o trecho e quanto dele já passou. As três colunas moram em
 * `import_run` (ver `0062_progresso_da_leitura`), e são as únicas neste
 * esquema que falam de trabalho em curso.
 *
 * ---------------------------------------------------------------------------
 * Por que a publicação é ralentada, e por que a regra é uma função pura
 * ---------------------------------------------------------------------------
 * O laço que este relator acompanha roda uma vez por linha de planilha, e um
 * UPDATE por linha somaria dezenas de milhares de escritas ao caminho mais
 * quente do produto — para alimentar uma tela que pergunta a cada 1,2 s.
 * Publicar por passo do trecho responde à mesma pergunta com algumas dezenas
 * de escritas, e é o que {@link devePublicar} decide. Quantas, e por que esse
 * número e não outro, está em {@link PASSOS_POR_TRECHO}.
 *
 * A regra é pura, e mora aqui em vez de dentro do laço, porque ela tem dois
 * casos que só se enxergam separados: o leitor rápido, que precisa ser
 * contido, e o leitor lento — uma planilha de trezentas linhas em que 1% é uma
 * linha só, ou um banco sob carga —, que precisa do contrário: publicar
 * mesmo sem ter completado o passo, senão a barra fica parada justamente onde
 * a demora é maior. Um laço com `if` no meio esconderia os dois; uma função
 * com nome os deixa testáveis sem banco nenhum.
 */
import { eq } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { importRunTable } from "@workspace/db/schema";

/**
 * O trecho da leitura que está sendo medido.
 *
 * É o trecho, e **não** o estado do run: `CAPTURA` e `PREPARO` acontecem os
 * dois dentro de READING, e uma porcentagem que subisse e voltasse a zero na
 * virada de um para o outro seria pior que porcentagem nenhuma. Quem lê estes
 * nomes é a tela, que dá a cada um a sua faixa da barra.
 */
export type EtapaDoProgresso = "CAPTURA" | "PREPARO";

/** Quanto tempo se aceita a barra parada antes de publicar mesmo sem passo. */
export const INTERVALO_DE_PUBLICACAO_MS = 2_000;

/**
 * Quantas publicações um trecho pode fazer, do começo ao fim.
 *
 * Eram cem — 1% por escrita —, e a conta que as justificava é a mesma que as
 * derruba: **a tela pergunta a cada 1,2 s**. Uma leitura de dez segundos com
 * cem publicações escreve uma a cada 100 ms, e noventa delas nunca são lidas
 * por ninguém. O preço não é a escrita em si: é a ida ao banco. Medido numa
 * importação de 14 mil linhas, as duas etapas somavam 175 UPDATEs de
 * progresso de 281 idas ao banco no total — a maior parte do tráfego da
 * leitura era a barra. Local isso custa 0,32 s; num banco a 25 ms de RTT,
 * custa 4,4 s de relógio, mais do que a gravação das células.
 *
 * Vinte passos publicam a cada 5% e continuam à frente da tela: numa leitura
 * de dez segundos é uma escrita a cada meio segundo, e quem pergunta a cada
 * 1,2 s vê a barra andar em toda pergunta. O leitor lento continua coberto
 * pela porta de tempo, que é de quem ela sempre foi.
 *
 * O nome de ambiente existe para o `perfil-de-importacao` reproduzir o
 * cenário anterior (cem passos) e comparar os dois; ninguém precisa defini-lo
 * para o produto funcionar.
 */
export const PASSOS_POR_TRECHO = (() => {
  const bruto = Number(process.env.IMPORT_PASSOS_DE_PROGRESSO);
  return Number.isFinite(bruto) && bruto >= 1 ? Math.trunc(bruto) : 20;
})();

/**
 * De quantas linhas é o passo de publicação deste trecho.
 *
 * O piso de 1 existe porque `total` pode ser menor que o número de passos — e
 * aí cada linha já é mais que um passo.
 */
export function passoDe(total: number): number {
  return Math.max(1, Math.ceil(total / PASSOS_POR_TRECHO));
}

/**
 * Se o que se andou desde a última publicação já merece uma escrita.
 *
 * Duas portas, e as duas precisam existir. `passo` contém o leitor rápido:
 * sem ele seriam dezenas de milhares de UPDATEs por importação. O tempo
 * cobre o leitor lento: com `total` grande, o passo pode levar minutos para
 * ser completado, e uma barra parada por minutos é exatamente o que este
 * módulo existe para acabar. Andar zero nunca publica: repetir o mesmo número
 * não informa ninguém.
 */
export function devePublicar(estado: {
  feito: number;
  publicado: number;
  total: number;
  desdeAUltimaMs: number;
}): boolean {
  const avancou = estado.feito - estado.publicado;
  if (avancou <= 0) return false;
  if (avancou >= passoDe(estado.total)) return true;
  return estado.desdeAUltimaMs >= INTERVALO_DE_PUBLICACAO_MS;
}

export interface RelatorDeProgresso {
  /** Somar linhas percorridas. Publica sozinho quando vale a pena. */
  avancar(linhas?: number): Promise<void>;
  /**
   * Dizer em que ponto do trecho se está, em vez de somar.
   *
   * É o que um laço por abas usa ao começar cada aba: uma aba pode ser
   * abandonada no meio (sem cabeçalho, sem coluna de vigência), e as linhas
   * dela não seriam percorridas nem somadas. Sem isto, cada aba descartada
   * deixaria a barra devendo um pedaço até o fim da importação.
   */
  posicionar(feito: number): Promise<void>;
  /** O trecho acabou: a barra chega ao fim dele e para lá. */
  encerrar(): Promise<void>;
}

/**
 * Abre um trecho medido e devolve quem o acompanha.
 *
 * A abertura já publica — `feito: 0` sobre o total —, porque é ela que troca
 * a faixa da barra na tela. Esperar o primeiro passo deixaria o começo de um
 * trecho parecendo o fim do anterior.
 */
export async function abrirProgresso(
  db: Database,
  importRunId: string,
  etapa: EtapaDoProgresso,
  total: number,
): Promise<RelatorDeProgresso> {
  let feito = 0;
  let publicado = 0;
  let ultimaEm = Date.now();

  const escrever = async (valor: number): Promise<void> => {
    await db
      .update(importRunTable)
      .set({ progressStep: etapa, progressDone: valor, progressTotal: total })
      .where(eq(importRunTable.id, importRunId));
    publicado = valor;
    ultimaEm = Date.now();
  };

  await escrever(0);

  /*
    O que se publica nunca passa do total.

    `total` é a conta que o pipeline tem ao começar o trecho — linhas
    declaradas no cabeçalho de cada aba —, e a contagem real pode passar dela
    por uma linha ou outra. Uma barra em 103% não é um detalhe cosmético: ela
    contradiz, na tela, a única coisa que a barra afirma.
  */
  const publicarSePreciso = async (): Promise<void> => {
    if (
      !devePublicar({
        feito,
        publicado,
        total,
        desdeAUltimaMs: Date.now() - ultimaEm,
      })
    ) {
      return;
    }
    await escrever(Math.min(feito, total));
  };

  return {
    async avancar(linhas = 1) {
      feito += linhas;
      await publicarSePreciso();
    },
    async posicionar(valor) {
      if (valor <= feito) return;
      feito = valor;
      await publicarSePreciso();
    },
    async encerrar() {
      feito = total;
      if (publicado === total) return;
      await escrever(total);
    },
  };
}

/**
 * Apaga a medição — nenhum trecho está em curso.
 *
 * Chamado nos dois fins do caminho de leitura: quando ela termina e quando
 * ela falha. Um progresso que sobrevivesse ao fim do trabalho seria uma
 * afirmação sobre trabalho em curso que não existe mais, e a tela a leria
 * como tal.
 */
export function progressoLimpo() {
  return { progressStep: null, progressDone: 0, progressTotal: 0 } as const;
}
