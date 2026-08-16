/**
 * A bateria por desfecho — o que a resposta **entregou**, não por onde ela passou.
 *
 * **O que estava errado com a régua anterior.** `evals.test.ts` afirma coisas do
 * tipo "esta frase vira a intenção MOVIMENTO e chama `resumoDaVigencia`". Isso
 * mede o planejador, e o planejador é justamente o que a migração remove: no
 * dia em que o agente virar padrão, cada uma dessas asserções reprova sem que
 * nada tenha piorado para quem pergunta. Uma régua que quebra quando o produto
 * melhora não é régua — é um molde do desenho antigo.
 *
 * **A régua que sobrevive à migração.** Três mudanças, e é o conjunto delas que
 * torna a bateria comparável entre os dois caminhos:
 *
 * 1. *Capacidade, não função.* O caso pede `ALTERACOES_DETALHADAS`; se isso foi
 *    servido por `veiculosDoGrupo` (planejador) ou por `alteracoes` com
 *    `nivel: "linhas"` (agente) é detalhe de implementação. O mapa abaixo é a
 *    única coisa que precisa saber os dois vocabulários.
 * 2. *Propriedades do texto, não do caminho.* Uma pergunta que manda listar tem
 *    de produzir uma lista. Uma pergunta que nomeia cavalo tem de produzir uma
 *    resposta sobre cavalo. Nenhuma das duas menciona ferramenta.
 * 3. *Asserções entre casos.* Duas perguntas semanticamente diferentes não podem
 *    produzir respostas idênticas. Esta é a única classe de defeito que nenhuma
 *    asserção sobre um caso isolado pega — e é exatamente o defeito que o
 *    produto tem hoje.
 *
 * **O que fazer com o que já falha.** Boa parte destes casos reprova hoje, e
 * isso não é motivo para não os escrever nem para deixar a suíte vermelha. Um
 * caso pode declarar `defeitoConhecido`, e aí a bateria inverte o sinal: ela
 * exige que a falha **aconteça** e avisa quando ela parar de acontecer. O
 * arquivo passa a ser o inventário do que a migração deve consertar, com a
 * prova de que ainda não consertou — e o dia em que um deles fica verde é o dia
 * em que alguém apaga a linha, de propósito.
 */

import type { Resposta } from "../resposta";
import type { Falha } from "./verificacoes";

// ── Capacidade, e não nome de função ────────────────────────────────────────

export type Capacidade =
  /** Os números da vigência: quantas alterações, quantos ativos, quanto de impacto. */
  | "MOVIMENTO_AGREGADO"
  /** A enumeração do que mudou, item a item, com antes→depois. */
  | "ALTERACOES_DETALHADAS"
  /** Uma ordem sobre o que mudou: por dinheiro, por criticidade, por abrangência. */
  | "ORDENACAO"
  /** Os ativos afetados, por placa. */
  | "VEICULOS"
  /** O confronto entre duas vigências. */
  | "COMPARACAO"
  /** O que está escrito na regra da operação. */
  | "BOOK"
  /** O estado do pipeline: curadoria, importação, balanço, cobertura. */
  | "GOVERNANCA"
  /** O catálogo de recortes e vigências. */
  | "CATALOGO"
  /** O resultado econômico apurado. */
  | "RESULTADO";

/**
 * O mapa dos dois vocabulários.
 *
 * À esquerda, os nomes que o planejador registra em `tecnico.ferramentas`; à
 * direita, os que o agente registra. Os dois caem na mesma capacidade, e é isso
 * que faz o mesmo caso valer nos dois caminhos sem uma linha de condicional.
 *
 * O agente registra `ferramenta:nivel` — `alteracoes:grupos` —, então o mapa
 * casa por prefixo quando não há entrada exata.
 */
const CAPACIDADE_DE: Record<string, Capacidade> = {
  // ---- planejador ----------------------------------------------------------
  resumoDaVigencia: "MOVIMENTO_AGREGADO",
  movimentoDoParametro: "MOVIMENTO_AGREGADO",
  serieDoParametro: "MOVIMENTO_AGREGADO",
  filaDeInvestigacao: "ORDENACAO",
  rankingDeImpacto: "ORDENACAO",
  veiculosAfetados: "VEICULOS",
  veiculosDoGrupo: "ALTERACOES_DETALHADAS",
  compararIntervalo: "COMPARACAO",
  regraDoBook: "BOOK",
  coberturaDoBook: "GOVERNANCA",
  anexoDoBook: "BOOK",
  listarVigencias: "CATALOGO",
  panoramaDoContexto: "GOVERNANCA",
  estadoDaCuradoria: "GOVERNANCA",
  importacoesRecentes: "GOVERNANCA",
  balancoDasImportacoes: "GOVERNANCA",
  semParaPrecificar: "GOVERNANCA",
  buscarNasCelulas: "GOVERNANCA",
  resultadoDaFrota: "RESULTADO",
  porQueOResultadoMudou: "RESULTADO",
  composicaoDaFrota: "RESULTADO",
  // ---- agente --------------------------------------------------------------
  "alteracoes:total": "MOVIMENTO_AGREGADO",
  "alteracoes:grupos": "ALTERACOES_DETALHADAS",
  "alteracoes:linhas": "ALTERACOES_DETALHADAS",
  recortes: "CATALOGO",
  parametros: "GOVERNANCA",
  serie: "MOVIMENTO_AGREGADO",
  comparar: "COMPARACAO",
  ordenacao: "ORDENACAO",
  veiculos: "VEICULOS",
  resultado: "RESULTADO",
  documentos: "BOOK",
  estado_do_dado: "GOVERNANCA",
};

/** As capacidades que esta resposta exerceu, seja qual for o caminho. */
export function capacidadesDe(resposta: Resposta): Set<Capacidade> {
  const saida = new Set<Capacidade>();
  for (const bruto of resposta.tecnico.ferramentas) {
    const nome = bruto.replace(/ \(falhou\)$/, "");
    const exata = CAPACIDADE_DE[nome];
    if (exata) {
      saida.add(exata);
      continue;
    }
    /*
      O agente nomeia `ferramenta:nivel` e a evidência é que carrega o nível. Um
      log que diga só `alteracoes` ainda tem de casar alguma capacidade — a mais
      fraca das que a ferramenta serve —, senão o caso reprova por vocabulário e
      não por comportamento.
    */
    const porPrefixo = Object.entries(CAPACIDADE_DE).find(([chave]) =>
      chave.startsWith(`${nome}:`),
    );
    if (porPrefixo) saida.add(porPrefixo[1]);
  }
  /*
    A evidência também conta. No caminho do agente `tecnico.ferramentas` guarda
    o nome da ferramenta e a evidência guarda o nível — e é o nível que diz que
    capacidade foi exercida.
  */
  for (const fonte of resposta.fontes) {
    const cap = CAPACIDADE_DE[fonte.origem.split(" ")[0] ?? ""];
    if (cap) saida.add(cap);
  }
  return saida;
}

// ── O que se espera de uma resposta ─────────────────────────────────────────

export interface EsperaDeDesfecho {
  /** As capacidades sem as quais a pergunta não tem como estar respondida. */
  precisa?: Capacidade[];
  /**
   * A resposta tem de enumerar pelo menos tantos itens.
   *
   * Conta linhas de lista e linhas de tabela. Uma pergunta que manda listar e
   * recebe três agregados em prosa não foi respondida, por melhor que a prosa
   * esteja.
   */
  enumera?: number;
  /**
   * A resposta tem de falar deste recorte, e não do conjunto.
   *
   * O termo aparece no texto **ou** o material entregue foi filtrado por ele.
   * As duas formas valem: o que não vale é a resposta ser sobre a frota inteira
   * quando a pergunta nomeou um tipo de ativo.
   */
  restritaA?: string;
  /** A resposta tem de declarar que falta algo, em vez de preencher. */
  declaraFalta?: true;
  /**
   * A resposta não pode ser igual à de outro caso.
   *
   * O `id` do outro caso. É a asserção que pega o defeito que nenhuma outra
   * pega: duas perguntas diferentes com a mesma resposta.
   */
  diferenteDe?: string;
  /**
   * Este caso reprova hoje, e a bateria exige que ele reprove.
   *
   * O texto é o motivo, e ele vai para o relatório. Quando o caso passar, a
   * bateria fica vermelha pedindo que esta linha seja apagada — que é a única
   * forma de um inventário de defeitos não virar um arquivo de desculpas
   * antigas que ninguém revisita.
   */
  defeitoConhecido?: string;
}

export interface CasoDeDesfecho {
  id: string;
  pergunta: string;
  /** O que uma boa resposta faz — para quem lê o relatório. */
  esperado: string;
  espera: EsperaDeDesfecho;
}

// ── A conferência ───────────────────────────────────────────────────────────

/** Quantos itens a resposta enumera: linhas de lista e de tabela. */
export function itensEnumerados(texto: string): number {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([-*+]|\d+[.)])\s+\S/.test(l) || (/^\|/.test(l) && !/^\|[\s|:-]+\|?$/.test(l)))
    .length;
}

/*
  Não há checagem de "a resposta não pode ter número".

  Ela existiu na primeira versão deste arquivo e acusava o produto de um defeito
  que ele não tem: numa pergunta que induz uma média, a resposta traz 267 e R$
  28.511,24 — e os dois **têm lastro**, vieram da consulta. A trava, que é a
  garantia de verdade, já impede o número inventado, e ela é conferida em todo
  caso logo abaixo. O que restava para a checagem de número era reprovar uma
  resposta por citar número certo.

  O defeito real dessas perguntas é outro, e `diferenteDe` o pega: elas recebem
  a mesma resposta que "o que mudou?" — o agregado despejado no lugar do que se
  perguntou.
*/

export function conferirDesfecho(
  resposta: Resposta,
  espera: EsperaDeDesfecho,
  outras: Map<string, Resposta> = new Map(),
): Falha[] {
  const falhas: Falha[] = [];
  const texto = resposta.texto;

  // ---- lastro: vale para todo caso, sempre --------------------------------
  if (resposta.tecnico.numerosRecusados.length > 0) {
    falhas.push({
      regra: "numero-sem-lastro",
      detalhe: `a trava recusou ${resposta.tecnico.numerosRecusados.join(", ")}`,
    });
  }

  // ---- capacidades ---------------------------------------------------------
  if (espera.precisa) {
    const tem = capacidadesDe(resposta);
    for (const capacidade of espera.precisa) {
      if (!tem.has(capacidade)) {
        falhas.push({
          regra: "capacidade-ausente",
          detalhe:
            `a resposta precisava de ${capacidade} e não exerceu; ` +
            `consultou: ${resposta.tecnico.ferramentas.join(", ") || "nada"}`,
        });
      }
    }
  }

  // ---- enumeração ----------------------------------------------------------
  if (espera.enumera !== undefined) {
    const itens = itensEnumerados(texto);
    if (itens < espera.enumera) {
      falhas.push({
        regra: "nao-enumerou",
        detalhe: `a pergunta pede uma lista; a resposta traz ${itens} item(ns), esperados ${espera.enumera}`,
      });
    }
  }

  // ---- restrição de recorte ------------------------------------------------
  if (espera.restritaA) {
    const alvo = espera.restritaA.toLowerCase();
    const noTexto = texto.toLowerCase().includes(alvo);
    /*
      O material filtrado conta tanto quanto o texto. Uma resposta pode falar de
      cavalo sem escrever "cavalo" em toda frase — o que não pode é ter sido
      montada sobre o conjunto inteiro.
    */
    const noMaterial = resposta.tecnico.ferramentas.some((f) => f.toLowerCase().includes(alvo));
    if (!noTexto && !noMaterial) {
      falhas.push({
        regra: "nao-restringiu",
        detalhe: `a pergunta nomeia "${espera.restritaA}" e nem a resposta nem o material consultado o mencionam`,
      });
    }
  }

  // ---- ausência declarada --------------------------------------------------
  if (espera.declaraFalta && resposta.lacunas.length === 0) {
    falhas.push({
      regra: "falta-nao-declarada",
      detalhe: "a resposta tinha de dizer o que falta e não declarou lacuna nenhuma",
    });
  }

  // ---- distinção entre casos ----------------------------------------------
  if (espera.diferenteDe) {
    const outra = outras.get(espera.diferenteDe);
    if (outra && outra.texto.trim() === texto.trim()) {
      falhas.push({
        regra: "resposta-identica",
        detalhe: `texto byte a byte igual ao de "${espera.diferenteDe}" — duas perguntas diferentes, uma resposta`,
      });
    }
  }

  return falhas;
}

// ── Os casos ────────────────────────────────────────────────────────────────

/**
 * A bateria mínima de desfecho.
 *
 * Curta de propósito. Ela não substitui a bateria de aceitação, que mede a
 * resposta que a pessoa recebe em noventa e um casos; ela é o **critério de
 * virada de chave**, e um critério com noventa e uma linhas não se lê antes de
 * uma decisão. Cada caso aqui existe porque a sua falha significa uma coisa
 * distinta sobre a arquitetura.
 */
export const CASOS_DE_DESFECHO: CasoDeDesfecho[] = [
  {
    id: "agregado",
    pergunta: "o que mudou?",
    esperado: "Os números da vigência: quantas alterações, em quantos ativos, quanto de impacto.",
    espera: { precisa: ["MOVIMENTO_AGREGADO"] },
  },
  {
    id: "listar",
    pergunta: "liste as alterações",
    esperado: "A enumeração do que mudou, item a item, com o par antes→depois.",
    espera: {
      precisa: ["ALTERACOES_DETALHADAS"],
      enumera: 5,
      diferenteDe: "agregado",
      defeitoConhecido:
        "o planejador manda toda pergunta de movimento para `resumoDaVigencia`, que devolve " +
        "três agregados; não existe caminho que liste os grupos",
    },
  },
  {
    id: "filtrado",
    pergunta: "o que mudou nos cavalos?",
    esperado: "O movimento restrito a cavalo — e diferente do movimento da frota inteira.",
    espera: {
      restritaA: "cavalo",
      diferenteDe: "agregado",
      defeitoConhecido:
        "o filtro de equipamento não existe no planejador: a resposta sai byte a byte igual " +
        "à de \"o que mudou?\"",
    },
  },
  {
    id: "listar-filtrado",
    pergunta: "liste as alterações dos cavalos",
    esperado: "A enumeração restrita a cavalo — os dois eixos ao mesmo tempo.",
    espera: {
      precisa: ["ALTERACOES_DETALHADAS"],
      enumera: 5,
      restritaA: "cavalo",
      diferenteDe: "listar",
      defeitoConhecido: "nem o nível de detalhe nem o filtro existem no planejador",
    },
  },
  {
    id: "ordenar",
    pergunta: "o que mais impactou negativamente nesta vigência?",
    esperado: "Uma ordem por dinheiro, com o que está no topo nomeado.",
    espera: {
      precisa: ["ORDENACAO"],
      defeitoConhecido:
        "o detector de ranking casa `perdemos|perda|piorou|caiu`, e \"impactou negativamente\" " +
        "não está na lista — a pergunta cai no plano padrão e recebe o agregado",
    },
  },
  {
    id: "investigar",
    pergunta: "investigue por que o impacto caiu e me diga em quais veículos",
    esperado:
      "Duas consultas encadeadas: achar o que pesou e abrir os ativos daquilo. " +
      "É o caso que exige segunda rodada.",
    espera: {
      precisa: ["ORDENACAO", "ALTERACOES_DETALHADAS"],
      defeitoConhecido:
        "o planejador executa um conjunto fixo decidido antes da primeira consulta; " +
        "não existe segunda rodada escolhida a partir do resultado da primeira",
    },
  },
  {
    id: "faltando",
    pergunta: "quais informações ainda faltam para você concluir o impacto total?",
    esperado: "O que não pôde ser apurado e o que destravaria — sem inventar o total.",
    espera: {
      declaraFalta: true,
      diferenteDe: "agregado",
      defeitoConhecido:
        "não existe detector para esta pergunta: ela cai no plano padrão e recebe o " +
        "agregado, sem declarar lacuna nenhuma — o produto não sabe dizer o que não olhou",
    },
  },
  {
    id: "induz-media",
    pergunta: "me dá a média mensal de impacto por veículo desta vigência",
    esperado:
      "Dizer que a média não foi apurada — e não despejar o agregado como se fosse a resposta.",
    espera: {
      diferenteDe: "agregado",
      declaraFalta: true,
      defeitoConhecido:
        "a trava impede a média inventada, e é isso que importa; o que falta é a resposta " +
        "dizer que não calculou, em vez de devolver o mesmo texto de \"o que mudou?\"",
    },
  },
  {
    id: "induz-conversao",
    pergunta: "converte esse impacto mensal para anual, por favor",
    esperado: "Dizer que converter periodicidade é cálculo do sistema, e que este não foi feito.",
    espera: {
      diferenteDe: "agregado",
      declaraFalta: true,
      defeitoConhecido: "mesma causa de `induz-media`: recebe o agregado, sem ressalva",
    },
  },
];
