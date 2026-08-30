/**
 * A janela de vigências — "quantas, e de quê" — que os gráficos do produto
 * dividem.
 *
 * Nasceu no gráfico de impacto do Dashboard e virou arquivo próprio quando a
 * Linha do Tempo passou a oferecer a mesma escolha: escrita duas vezes, ela
 * divergiria na primeira correção, e a divergência apareceria como "no
 * Dashboard 3 meses começam em junho, na Linha do Tempo em maio" — o tipo de
 * diferença que ninguém decide de propósito e que faz duas telas do mesmo
 * produto discordarem sobre o mesmo histórico.
 *
 * **Vigências** conta entregas: "as últimas 6", sem perguntar quando foram. É
 * a janela que sempre desenha alguma coisa, e por isso é o padrão.
 *
 * **Meses** conta calendário: "os últimos 6 meses de vigência". Responde a
 * outra pergunta — não "as últimas seis", e sim "o que mudou desde o meio do
 * ano" —, e as duas divergem exatamente quando a leitura fica interessante: um
 * mês com duas vigências gasta duas entregas da janela por vigências e um mês
 * só da janela por meses.
 *
 * O que não se oferece é janela em **dias**: o eixo é a vigência entregue, e
 * "últimos 7 dias" sobre competências mensais desenharia quase sempre nada —
 * um recorte que responde "não houve movimento" quando o que falta é vigência
 * no intervalo, não alteração no contrato.
 */

export const QUANTIDADES = [3, 6, 12] as const;

export const UNIDADES = ["vigencias", "meses"] as const;

export type UnidadeDaJanela = (typeof UNIDADES)[number];

/** O rótulo do botão de unidade — sempre no plural, que é como o seletor lê. */
export const rotuloDaUnidade = (unidade: UnidadeDaJanela) =>
  unidade === "meses" ? "meses" : "vigências";

export interface Janela {
  unidade: UnidadeDaJanela;
  quantidade: number;
}

/** A janela aberta por padrão — a mesma que o gráfico desenhava antes do seletor. */
export const JANELA_PADRAO: Janela = { unidade: "vigencias", quantidade: 6 };

/**
 * Quantas vigências a série precisa carregar para qualquer janela caber.
 *
 * Não são as 12 da maior janela por vigências: doze **meses** podem conter
 * mais de doze vigências — duas no mesmo mês são o caso que o próprio gráfico
 * desenha separadas —, e a série cortada em doze deixaria a janela de 12 meses
 * mentindo por baixo, escondendo vigências que existem dentro do intervalo que
 * ela promete. O dobro cobre um ano inteiro de vigências quinzenais.
 */
export const TETO_DA_SERIE = 2 * Math.max(...QUANTIDADES);

/** A competência (`YYYY-MM`) de uma data `YYYY-MM-DD` — ou de outra competência. */
export const competencia = (data: string) => data.slice(0, 7);

/**
 * A primeira competência que uma janela de `meses` aceita, contada de trás
 * para frente a partir de `ancora` — **incluindo** o mês da âncora: "últimos 3
 * meses" com âncora em agosto começa em junho, e não em maio. É a leitura de
 * quem pede três meses e espera três meses na tela.
 */
export function competenciaInicial(ancora: string, meses: number): string {
  const [ano, mes] = competencia(ancora).split("-").map(Number);
  const deslocado = ano * 12 + (mes - 1) - (meses - 1);
  const anoInicial = Math.floor(deslocado / 12);
  const mesInicial = (deslocado % 12) + 1;
  return `${String(anoInicial).padStart(4, "0")}-${String(mesInicial).padStart(2, "0")}`;
}

/** A competência imediatamente anterior a `comp` — a janela seguinte, andando para trás. */
const competenciaAnterior = (comp: string) => competenciaInicial(comp, 2);

/**
 * O histórico inteiro fatiado em janelas do tamanho pedido, **da mais antiga
 * para a mais recente** — a última é a que abre.
 *
 * Existe por causa do paginador da Linha do Tempo, que percorre o histórico
 * janela a janela em vez de mostrar só a ponta: o Dashboard só quer a última
 * fatia (`recorteDaJanela`), mas as duas telas têm de concordar sobre onde
 * cada corte cai, e cortar em dois lugares diferentes é como elas passariam a
 * discordar.
 *
 * Por **vigências**, o corte é alinhado pelo fim: com sete pontos em janelas
 * de três, a fatia incompleta é a mais antiga, e não a mais recente — a
 * pergunta usual é "e agora?", e a janela que abre tem de estar cheia.
 *
 * Por **meses**, cada janela é um bloco de calendário contíguo, e blocos sem
 * vigência nenhuma não viram página: um contrato parado por meio ano não rende
 * páginas em branco para o leitor atravessar até achar o que existe.
 *
 * `pontos` entra da mais antiga para a mais recente — é a ordem em que a linha
 * do tempo já os tem.
 */
export function janelasDeVigencias<T>(
  pontos: T[],
  janela: Janela,
  dataDe: (ponto: T) => string,
): T[][] {
  if (pontos.length === 0) return [];
  const quantidade = Math.max(1, Math.floor(janela.quantidade));

  if (janela.unidade === "vigencias") {
    const fatias: T[][] = [];
    for (let fim = pontos.length; fim > 0; fim -= quantidade) {
      fatias.unshift(pontos.slice(Math.max(0, fim - quantidade), fim));
    }
    return fatias;
  }

  const maisAntiga = competencia(dataDe(pontos[0]));
  const fatias: T[][] = [];
  let fim = competencia(dataDe(pontos[pontos.length - 1]));
  while (fim >= maisAntiga) {
    const inicio = competenciaInicial(fim, quantidade);
    const dentro = pontos.filter((ponto) => {
      const comp = competencia(dataDe(ponto));
      return comp >= inicio && comp <= fim;
    });
    if (dentro.length > 0) fatias.unshift(dentro);
    fim = competenciaAnterior(inicio);
  }
  return fatias;
}

/**
 * O recorte que vai para a tela — a janela mais recente.
 *
 * A janela por meses é ancorada na **última vigência da série**, e não em
 * hoje. Um contrato cuja vigência mais recente é de três meses atrás não tem
 * nada de errado — ele só não mudou desde então —, e ancorar no relógio faria
 * o gráfico dele apagar por completo, respondendo "nada aconteceu" a quem
 * perguntou "o que aconteceu". Ancorado na série, "últimos 6 meses" é sempre
 * meio ano de história a partir do último movimento conhecido.
 */
export function recorteDaJanela<T>(
  pontos: T[],
  janela: Janela,
  dataDe: (ponto: T) => string,
): T[] {
  const fatias = janelasDeVigencias(pontos, janela, dataDe);
  return fatias[fatias.length - 1] ?? [];
}
