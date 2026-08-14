/**
 * A camada que decide — e a que recusa.
 *
 * Cinco etapas, nesta ordem: ler a pergunta, resolver o que ela nomeia, montar
 * o plano, executar, validar. Nenhuma delas é feita por modelo. É deliberado:
 * a escolha da fonte é a decisão mais consequente do assistente — errar aqui
 * produz uma resposta correta sobre o assunto errado — e uma decisão dessas
 * precisa ser reproduzível, testável sem rede e explicável a quem discordar.
 *
 * **O plano é uma função da intenção, não uma lista de tudo.** O modelo não
 * recebe trinta ferramentas para escolher: recebe o resultado das que a
 * intenção pediu. Perguntar "o que é IPVA?" não dispara consulta de impacto, e
 * é por isso que a resposta deixou de começar com o resumo de uma vigência que
 * ninguém pediu.
 *
 * **Quatro formas de não saber, e elas não se confundem.** "Não encontrei" não
 * é "não existe no FreightCheck", que não é "o Freightech tem o conceito e o
 * export não traz o parâmetro", que não é "há dado e não dá para precificar".
 * `Lacuna` carrega qual das quatro é, e a resposta é obrigada a dizê-la.
 */

import type { Database } from "@workspace/db";
import { buscarTrechos, type TrechoRelevante } from "./corpus";
import {
  buscarNoBook,
  documentoDoBloco,
  type TrechoDoBookRanqueado,
} from "./indice-book";
import {
  compararIntervalo,
  anexoDoBook,
  coberturaDoBook,
  composicaoDaFrota,
  listarVigencias,
  movimentoDoParametro,
  panoramaDoContexto,
  rankingDeImpacto,
  regraDoBook,
  resolverContexto,
  resumoDaVigencia,
  semParaPrecificar,
  serieDoParametro,
  veiculosAfetados,
  veiculosDoGrupo,
  type Anexo,
  type ContextoResolvido,
  type Evidencia,
} from "./ferramentas";
import {
  balancoDasImportacoes,
  buscarNasCelulas,
  estadoDaCuradoria,
  historicoDaSemantica,
  importacoesRecentes,
} from "./governanca";
import {
  INTENCOES_COM_PARAMETRO,
  INTENCOES_COM_RECORTE,
  INTENCOES_QUE_HERDAM_ASSUNTO,
  interpretar,
  temPronomeAnaforico,
  mesParaNumero,
  type Intencao,
  type Leitura,
  type PeriodoPedido,
} from "./interpretacao";
import { normalizar, termos } from "./normalizar";
import { resolverParametro, type Alvo, type Resolucao } from "./parametros";
import { listPeriods } from "@workspace/comparison";
import { rotuloDoPeriodo } from "./formato";
import type { EstadoDaConversa } from "./conversa";

// ── As quatro formas de não saber ───────────────────────────────────────────

export type TipoDeLacuna =
  /** A busca não trouxe nada — pode existir e não termos achado. */
  | "NAO_ENCONTREI"
  /** Nem o catálogo nem o dicionário conhecem este assunto. */
  | "NAO_EXISTE_NO_PRODUTO"
  /** O Freightech publica o conceito; este export não traz a coluna. */
  | "CONCEITO_SEM_DADO"
  /** Há dado, e o impacto não é apurável com a semântica atual. */
  | "DADO_SEM_PRECO";

export interface Lacuna {
  tipo: TipoDeLacuna;
  /** A frase que a resposta deve dizer. Escrita aqui, nunca pelo modelo. */
  explicacao: string;
}

// ── O resultado da orquestração ─────────────────────────────────────────────

export interface Etapa {
  nome: string;
  /** O que a tela mostra enquanto isto roda. */
  rotulo: string;
}

export interface Plano {
  intencao: Intencao;
  /** Por que esta intenção — para o painel técnico. */
  porque: string;
  /** O que foi herdado da conversa anterior. */
  herdado: string[];
  alvo: Alvo | null;
  resolucao: Resolucao | null;
  contexto: ContextoResolvido | null;
  periodo: string | null;
  intervalo: { de: string | null; ate: string | null } | null;
}

export interface Dossie {
  pergunta: string;
  leitura: Leitura;
  plano: Plano;
  trechos: TrechoRelevante[];
  /**
   * O conteúdo do Book que responde esta pergunta.
   *
   * Ficam separados dos `trechos` porque são coisas diferentes: `trechos` é o
   * conhecimento **sobre** o produto — o índice dos blocos, o catálogo do
   * Freightech, os artigos aprovados neste repositório —, e `documentos` é o
   * que está escrito **dentro** do Book, transcrito do arquivo que a operação
   * anexou. Um diz "existe um bloco chamado QLP ADM e ele trata de estrutura
   * administrativa"; o outro diz o que a regra determina. A resposta que
   * confunde os dois descreve o índice quando lhe perguntaram a regra — que era
   * exatamente o que acontecia.
   */
  documentos: TrechoDoBookRanqueado[];
  evidencias: Evidencia[];
  /**
   * Os arquivos que vão junto para o modelo ler.
   *
   * Ficam fora de `evidencias` porque não são resultado de consulta: uma
   * evidência traz números que a validação confere, e um anexo traz um
   * documento que ela não tem como conferir. Confundir os dois faria a trava
   * de lastro parecer cobrir o que não cobre.
   */
  anexos: Anexo[];
  lacunas: Lacuna[];
  etapas: Etapa[];
  /** Quando a pergunta casa duas gavetas e o assistente precisa perguntar. */
  desambiguacao: { termo: string; opcoes: string[] } | null;
}

// ── Resolução de período ────────────────────────────────────────────────────

/** "agosto" + as vigências do contexto → "2026-08-01". */
async function resolverPeriodo(
  db: Database,
  ctx: ContextoResolvido,
  pedido: PeriodoPedido | null,
): Promise<string | null> {
  if (!pedido) return null;
  const periodos = await listPeriods(db, ctx.contexto); // mais recente primeiro
  if (periodos.length === 0) return null;

  if (pedido.relativo === "ULTIMA") return periodos[0].effective_date;
  if (pedido.relativo === "ANTERIOR") return periodos[1]?.effective_date ?? null;
  if (pedido.relativo === "PRIMEIRA") return periodos[periodos.length - 1].effective_date;

  if (!pedido.mes) return null;
  const numero = mesParaNumero(pedido.mes);
  if (!numero) return null;

  /*
    Sem ano declarado, o mais recente daquele mês.

    "E julho?" numa base que tem julho/2025 e julho/2026 quer dizer o julho mais
    próximo do que se estava olhando, e o mais recente é o palpite que erra
    menos. O período resolvido volta no recorte da evidência, então quem lê vê
    qual julho respondeu — a escolha aparece, não fica implícita.
  */
  const candidatos = periodos.filter((p) => {
    const [ano, mes] = p.effective_date.split("-");
    return Number(mes) === numero && (!pedido.ano || Number(ano) === pedido.ano);
  });
  return candidatos[0]?.effective_date ?? null;
}

// ── Detecção de lacuna conceitual ───────────────────────────────────────────

/**
 * A pergunta pede um recorte do assunto que o export não traz?
 *
 * "Preço de combustível" resolve a gaveta Combustível — mas "preço" não aparece
 * em nenhuma das colunas dela, que são consumo, capacidade e vida útil. Essa
 * distância entre o que se perguntou e o que existe é exatamente a resposta
 * certa, e sem detectá-la o assistente responderia sobre consumo a quem
 * perguntou de preço, sem avisar da troca.
 */
/**
 * As palavras que pedem dinheiro, e não uma coluna com aquele nome.
 *
 * Nenhuma coluna do export se chama "preço" ou "custo" — nem a de IPVA, que é
 * dinheiro puro. Compará-las com o vocabulário da gaveta como se fossem
 * qualificadores comuns dizia a quem perguntou "quanto custa o IPVA?" que
 * nenhuma coluna trata de "custa", o que é literalmente verdadeiro e
 * completamente enganoso. Para estas palavras a pergunta certa é outra: **esta
 * gaveta tem alguma coluna monetária?** É essa distinção que separa o IPVA, que
 * tem, do Combustível, que não tem — e é o Combustível que precisa da lacuna.
 */
const PALAVRAS_DE_VALOR = new Set([
  "preco", "precos", "custo", "custos", "custa", "custam", "tarifa", "tarifas",
]);

function lacunaDoQualificador(termoPerguntado: string, alvo: Alvo): Lacuna | null {
  const palavrasDoAlvo = new Set(termos(alvo.parametro));
  const qualificadores = termos(termoPerguntado).filter(
    (p) => !palavrasDoAlvo.has(p) && p.length > 3,
  );
  if (qualificadores.length === 0) return null;

  const vocabulario = new Set(
    alvo.atributos.flatMap((a) => a.termos.flatMap((t) => t.split(" "))),
  );
  const naoCasadas = qualificadores.filter((q) => {
    for (const v of vocabulario) if (v === q || v.startsWith(q) || q.startsWith(v)) return false;
    return true;
  });

  const temMonetario = alvo.atributos.some((a) => a.monetario === true);
  const ausentes = naoCasadas.filter((q) => !(PALAVRAS_DE_VALOR.has(q) && temMonetario));
  if (ausentes.length === 0) return null;

  const colunas = alvo.atributos.map((a) => a.rotulo).join(", ");
  return {
    tipo: "CONCEITO_SEM_DADO",
    explicacao:
      `O FreightCheck tem a gaveta "${alvo.parametro}", mas nenhuma coluna dela trata de ` +
      `${ausentes.map((a) => `"${a}"`).join(", ")}. O que este export traz nesta gaveta é: ` +
      `${colunas}. Para responder sobre ${ausentes.join(", ")} faltaria o arquivo que o ` +
      `Freightech publica nessa tela, e que a planilha de equipamento não carrega.`,
  };
}

// ── Orquestração ────────────────────────────────────────────────────────────

export interface OpcoesDeOrquestracao {
  /** O recorte que a tela mandou junto. */
  recorte?: { scopeHash?: string; channel?: string | null; period?: string };
  /** O estado da conversa, para herdar em perguntas de continuação. */
  estado?: EstadoDaConversa | null;
  /**
   * Chamado a cada etapa, no instante em que ela começa.
   *
   * Existe para a tela poder dizer o que está acontecendo **enquanto**
   * acontece. Sem isto, a única honestidade possível era um "consultando…"
   * genérico: as etapas só chegavam junto com a resposta, quando já não
   * serviam para nada. A alternativa que a tela usava antes — animar uma lista
   * fixa por tempo — anunciava "calculando impacto" numa pergunta conceitual
   * que nunca calcula impacto, e num produto que existe para não exibir o que
   * não pode sustentar, inventar o próprio progresso é a última coisa que se
   * deveria fazer.
   */
  aoAvancar?: (etapa: Etapa) => void;
}

/**
 * Da pergunta ao dossiê — sem escrever uma frase.
 *
 * O que sai daqui é material fechado: os trechos que sustentam o conceito, as
 * evidências que sustentam os números, e as lacunas que a resposta é obrigada a
 * declarar. Quem redige — modelo ou código — trabalha só sobre isto.
 */
export async function orquestrar(
  db: Database,
  pergunta: string,
  opcoes: OpcoesDeOrquestracao = {},
): Promise<Dossie> {
  const etapas: Etapa[] = [];
  const marcar = (nome: string, rotulo: string) => {
    const etapa = { nome, rotulo };
    etapas.push(etapa);
    opcoes.aoAvancar?.(etapa);
  };

  // ---- 1. entendimento -----------------------------------------------------
  marcar("interpretar", "Analisando sua pergunta");
  const leitura = interpretar(pergunta);
  const estado = opcoes.estado ?? null;

  // ---- 2. herança da conversa ---------------------------------------------
  const herdado: string[] = [];
  let intencao = leitura.intencao;
  let termoDoParametro = leitura.entidades.termoDoParametro;
  let periodoPedido = leitura.entidades.periodo;
  let intervaloPedido = leitura.entidades.intervalo;

  /*
    O assunto do fio vale para toda pergunta que não traga o seu.

    Isto roda **fora** do bloco de continuação de propósito, e é a correção do
    defeito que a sequência de aceite expôs. "Quanto mudou em agosto?" logo
    depois de uma resposta sobre combustível tem verbo, tem período e não
    parece continuação nenhuma — mas não diz *o quê*, e num fio aberto o quê é
    o combustível. Antes disso ela caía no agregado da vigência: uma resposta
    verdadeira sobre outro assunto, que é o pior defeito que este assistente
    pode ter.

    O pronome anafórico é o caso explícito da mesma regra: "isso está previsto
    no Book?" declara, com todas as letras, que o assunto está na conversa.
  */
  const pronome = temPronomeAnaforico(pergunta);
  if (estado && !termoDoParametro && estado.termoDoParametro) {
    const pedeAssunto = INTENCOES_QUE_HERDAM_ASSUNTO.has(intencao) || pronome;
    if (pedeAssunto) {
      termoDoParametro = estado.termoDoParametro;
      herdado.push("assunto");
    }
  }

  /*
    E a vigência do fio vale pelo mesmo motivo.

    Sem isto, "qual foi o impacto?" no meio de uma conversa sobre julho
    respondia sobre a vigência mais recente — trocava o período em silêncio,
    que é exatamente o que este produto não faz em nenhuma outra tela.
  */
  /*
    Comparação fica de fora: ela tem lógica própria de pontas, logo abaixo.

    Herdar a vigência aqui dava as duas pontas iguais — "Compare." respondia
    "julho/2026 → julho/2026, 0 comparações", que é a forma mais silenciosa de
    não responder: um resultado válido, com zero em tudo, sem nada dizendo que
    a pergunta não foi entendida.
  */
  if (
    estado &&
    !periodoPedido &&
    !intervaloPedido &&
    intencao !== "COMPARACAO" &&
    INTENCOES_COM_RECORTE.has(intencao) &&
    (estado.periodo || estado.intervalo)
  ) {
    if (estado.periodo) periodoPedido = estado.periodo;
    else intervaloPedido = estado.intervalo;
    herdado.push("vigência da conversa");
  }

  if (leitura.continuacao && estado) {
    if (intencao === "DESCONHECIDA" && estado.intencao) {
      intencao = estado.intencao;
      herdado.push("intenção");
    }
    if (!termoDoParametro && estado.termoDoParametro) {
      termoDoParametro = estado.termoDoParametro;
      herdado.push("parâmetro");
    }
    /*
      Comparação em continuação: o período que a frase traz é uma das pontas, e
      a outra vem da pergunta anterior. "Compare os dois" sem período nenhum
      compara o período atual com o anterior do estado.
    */
    if (intencao === "COMPARACAO" && !intervaloPedido) {
      const outraPonta = estado.periodo ?? null;
      if (periodoPedido && outraPonta) {
        intervaloPedido = { de: { mes: outraPonta.mes, ano: outraPonta.ano }, ate: periodoPedido };
        periodoPedido = null;
        herdado.push("período anterior como ponta");
      } else if (estado.intervalo) {
        intervaloPedido = estado.intervalo;
        herdado.push("intervalo");
      }
    }
    /*
      "E julho?" depois de "quanto mudou o IPVA desde dezembro?" não pede a
      série de novo — pede o IPVA **em julho**.

      Sem esta troca, a continuação herdava a intenção EVOLUCAO, que trabalha
      sobre intervalo, e o mês que a pessoa acabou de escrever era lido e
      ignorado: a resposta repetia a série inteira, idêntica à anterior, e nada
      na tela denunciava que julho não tinha entrado em nada.
    */
    if (periodoPedido && !intervaloPedido && (intencao === "EVOLUCAO" || intencao === "COMPARACAO")) {
      intencao = termoDoParametro ? "VALOR" : "MOVIMENTO";
      herdado.push("assunto, com o período trocado");
    }

    if (!periodoPedido && !intervaloPedido && estado.periodo) {
      periodoPedido = estado.periodo;
      herdado.push("período");
    }
    if (!periodoPedido && !intervaloPedido && estado.intervalo) {
      intervaloPedido = estado.intervalo;
      herdado.push("intervalo");
    }
  }

  // ---- 3. resolução do parâmetro ------------------------------------------
  let resolucao: Resolucao | null = null;
  let alvo: Alvo | null = null;
  let desambiguacao: Dossie["desambiguacao"] = null;

  if (termoDoParametro && INTENCOES_COM_PARAMETRO.has(intencao)) {
    marcar("resolverParametro", "Identificando o parâmetro");
    resolucao = await resolverParametro(db, termoDoParametro, {
      ...(leitura.entidades.equipamento ? { equipamento: leitura.entidades.equipamento } : {}),
    });
    alvo = resolucao.escolhido;
    if (resolucao.ambiguo && resolucao.alvos.length > 1) {
      desambiguacao = {
        termo: termoDoParametro,
        opcoes: resolucao.alvos.slice(0, 4).map((a) => a.parametro),
      };
    }
  }

  // ---- 4. contexto ---------------------------------------------------------
  const precisaRecorte = INTENCOES_COM_RECORTE.has(intencao);
  let contexto: ContextoResolvido | null = null;

  if (precisaRecorte || intencao === "PANORAMA" || intencao === "CATALOGO_DE_CONTEXTO") {
    marcar("resolverContexto", "Resolvendo unidade e canal");
    contexto = await resolverContexto(db, {
      ...(opcoes.recorte?.scopeHash ? { scopeHash: opcoes.recorte.scopeHash } : {}),
      ...(opcoes.recorte?.channel !== undefined ? { channel: opcoes.recorte.channel } : {}),
      ...(estado?.scopeHash && !opcoes.recorte?.scopeHash ? { scopeHash: estado.scopeHash } : {}),
    });
  }

  const periodo = contexto ? await resolverPeriodo(db, contexto, periodoPedido) : null;
  const intervalo = contexto && intervaloPedido
    ? {
        de: await resolverPeriodo(db, contexto, intervaloPedido.de),
        ate: intervaloPedido.ate ? await resolverPeriodo(db, contexto, intervaloPedido.ate) : null,
      }
    : null;

  const plano: Plano = {
    intencao,
    porque: leitura.porque,
    herdado,
    alvo,
    resolucao,
    contexto,
    periodo: periodo ?? opcoes.recorte?.period ?? null,
    intervalo,
  };

  // ---- 5. execução ---------------------------------------------------------
  const evidencias: Evidencia[] = [];
  const documentos: TrechoDoBookRanqueado[] = [];
  const anexos: Anexo[] = [];
  const lacunas: Lacuna[] = [];
  const juntar = async (
    rotulo: string,
    promessa: Promise<Evidencia | null>,
  ): Promise<void> => {
    marcar("consultar", rotulo);
    const evidencia = await promessa.catch(() => null);
    if (evidencia) evidencias.push(evidencia);
  };

  const periodoEfetivo = plano.periodo ?? undefined;

  /*
    A pergunta nomeou uma coisa, e essa coisa não existe aqui.

    Este é o gate que impede a pior classe de resposta que este assistente
    produzia: perguntaram "quanto mudou o pedágio?", nenhum parâmetro chamado
    pedágio existe neste export, e a resposta vinha com o movimento **de tudo**
    — R$ 28 mil de alterações que não têm nada a ver com pedágio, apresentados
    como se fossem a resposta. Um número certo sobre o assunto errado é pior que
    nenhum número, porque parece uma resposta.

    Sem alvo, os caminhos que consultam o agregado do recorte ficam desligados,
    e o que sai é a lacuna que diz o que aconteceu.
  */
  const nomeouParametro = Boolean(termoDoParametro) && INTENCOES_COM_PARAMETRO.has(intencao);
  const alvoPerdido = nomeouParametro && !alvo && !desambiguacao;

  switch (intencao) {
    case "CONCEITUAL":
    case "DISPONIBILIDADE":
      // Conceito não consulta impacto. É a correção do defeito que fazia
      // "como funciona X" responder com o resumo da vigência mais recente.
      break;

    case "BOOK":
      /*
        O conteúdo do Book vem da busca, que roda para toda pergunta logo
        abaixo. O que sobra para cá é o caso em que a pergunta é sobre o Book
        como um todo — "quantos blocos já têm regra?" —, que é dado e não
        conteúdo.
      */
      if (!termoDoParametro) {
        marcar("consultar", "Consultando o Book do Operador");
        evidencias.push(await coberturaDoBook(db));
      }
      break;

    case "PANORAMA":
      if (contexto) {
        marcar("consultar", "Consultando o que foi importado");
        evidencias.push(await panoramaDoContexto(db, contexto));
      }
      break;

    case "CATALOGO_DE_CONTEXTO":
      if (contexto) {
        marcar("consultar", "Listando vigências");
        evidencias.push(await listarVigencias(db, contexto));
      }
      break;

    case "MOVIMENTO":
      if (contexto && !alvoPerdido) {
        await juntar("Consultando alterações", resumoDaVigencia(db, contexto, periodoEfetivo));
        if (alvo) {
          await juntar(
            "Consultando o parâmetro",
            movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
          );
        }
      }
      break;

    case "VALOR":
      if (contexto && alvo) {
        await juntar(
          "Consultando o parâmetro",
          movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
        );
        for (const atributo of alvo.atributos.slice(0, 2)) {
          await juntar("Consultando a série", serieDoParametro(db, contexto, atributo.codigo));
        }
      } else if (contexto && !alvoPerdido) {
        await juntar("Consultando alterações", resumoDaVigencia(db, contexto, periodoEfetivo));
      }
      break;

    case "EVOLUCAO":
      if (contexto && alvo) {
        /*
          "Quanto mudou X?" pergunta duas coisas ao mesmo tempo, e as duas
          precisam sair: **quantas** alterações houve na vigência corrente e
          **por onde** o valor andou ao longo delas. A série sozinha responde a
          segunda e deixa a primeira sem número — quem perguntou "quanto mudou
          a manutenção?" ouvia nove médias e nunca as 72 alterações que a tela
          de Parâmetros mostra para a mesma gaveta.
        */
        await juntar(
          "Consultando o parâmetro",
          movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
        );
        for (const atributo of alvo.atributos.slice(0, 3)) {
          await juntar("Consultando a série", serieDoParametro(db, contexto, atributo.codigo));
        }
        await juntar(
          "Calculando o intervalo",
          compararIntervalo(db, contexto, intervalo?.de ?? undefined, intervalo?.ate ?? undefined, [
            `${alvo.atributos[0]?.familia ?? ""}|${alvo.parametro}`,
          ]),
        );
      } else if (contexto && !alvoPerdido) {
        await juntar(
          "Calculando o intervalo",
          compararIntervalo(db, contexto, intervalo?.de ?? undefined, intervalo?.ate ?? undefined),
        );
      }
      break;

    case "COMPARACAO":
      if (contexto && !alvoPerdido) {
        await juntar(
          "Comparando as vigências",
          compararIntervalo(db, contexto, intervalo?.de ?? undefined, intervalo?.ate ?? undefined),
        );
      }
      break;

    case "RANKING_PERDA":
    case "RANKING_GANHO":
      if (contexto) {
        await juntar(
          "Calculando impacto",
          rankingDeImpacto(db, contexto, intencao === "RANKING_PERDA" ? "PERDA" : "GANHO", periodoEfetivo),
        );
      }
      break;

    case "VEICULOS":
      if (contexto) {
        await juntar("Consultando veículos afetados", veiculosAfetados(db, contexto, periodoEfetivo));
      }
      break;

    case "SEM_PRECO":
      if (contexto) {
        await juntar("Verificando o que não tem preço", semParaPrecificar(db, contexto, periodoEfetivo));
      }
      break;

    case "PROCEDENCIA":
      /*
        Procedência refaz a consulta, em vez de reexibir o que já estava em
        memória.

        A primeira versão guardava as evidências da resposta anterior no estado
        e as devolvia. Duas coisas quebravam: o estado é persistido entre
        requisições e as evidências não são (de propósito — descrevem uma
        consulta de um instante), então numa conversa recarregada "por quê?"
        respondia que não sabia; e reexibir número guardado é servir dado velho
        com cara de consulta nova.

        Refazer é mais lento e é o que se pode sustentar: a origem sai do banco
        agora, no mesmo recorte, e desce até a linha que mudou.
      */
      if (contexto && alvo) {
        await juntar(
          "Recuperando a origem",
          movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
        );
        const primeiraColuna = alvo.atributos[0];
        if (primeiraColuna && plano.periodo) {
          await juntar(
            "Descendo até as linhas",
            veiculosDoGrupo(db, contexto, plano.periodo, primeiraColuna.codigo, primeiraColuna.equipamento),
          );
        }
      } else if (contexto && !alvoPerdido) {
        await juntar("Recuperando a origem", resumoDaVigencia(db, contexto, periodoEfetivo));
      }
      break;

    /*
      ---- governança do dado -------------------------------------------------

      Nenhuma das três precisa de recorte, e isso é uma afirmação sobre o
      domínio, não uma economia: curadoria, importação e balanço descrevem o
      **pipeline**, que é um só para todas as unidades. Filtrá-los por
      (unidade, canal) responderia uma pergunta que ninguém faz e esconderia
      metade do que se quis saber.
    */
    case "CURADORIA":
      await juntar("Consultando a curadoria", estadoDaCuradoria(db));
      if (alvo?.atributos[0]) {
        await juntar(
          "Recuperando o histórico da semântica",
          historicoDaSemantica(db, alvo.atributos[0].codigo),
        );
      }
      break;

    case "IMPORTACOES":
      await juntar("Consultando as importações", importacoesRecentes(db));
      break;

    case "BALANCO":
      await juntar("Consultando o balanço de massa", balancoDasImportacoes(db));
      break;

    case "CELULAS":
      /*
        A busca usa o termo que sobrou da frase, e não a frase inteira.

        "Onde aparece a placa ABC1D23 na planilha?" tem seis palavras de
        operação e uma de conteúdo; procurar a frase toda em `raw_cell` não
        acharia nada, e procurar cada palavra acharia tudo. `termoDoParametro`
        já é exatamente o resíduo depois da poda.
      */
      if (termoDoParametro) {
        await juntar("Procurando nas células importadas", buscarNasCelulas(db, termoDoParametro));
      }
      break;

    case "COMPOSICAO":
      if (contexto) {
        await juntar(
          "Compondo a remuneração da frota",
          composicaoDaFrota(db, contexto, leitura.entidades.equipamento ?? "CAVALO", periodoEfetivo),
        );
      }
      break;

    case "SAUDACAO":
    case "DESCONHECIDA":
      break;
  }

  /*
    ---- 5b. o Book, para qualquer pergunta -----------------------------------

    Esta é a etapa que faltava, e ela não é um caso especial de intenção: é uma
    fonte a mais, consultada em paralelo com o dado. A classificação decide o
    que **calcular**; ela não decide o que a operação escreveu sobre o assunto,
    e as duas coisas quase sempre valem juntas. "O que mudou no IPVA?" ganha a
    regra do Book ao lado do número; "o que é QLP ADM?" é respondida só pelo
    Book; "explique QLP ADM e veja o que mudou" precisa das duas, e antes não
    havia caminho nenhum que trouxesse as duas.

    Quem não tem assunto não procura: uma saudação e um "compare julho com
    agosto" sem parâmetro nomeado não têm o que buscar no Book, e uma busca sem
    termo devolveria os trechos mais genéricos do corpus inteiro.
  */
  const perguntaDeConteudo =
    intencao === "BOOK" || intencao === "CONCEITUAL" || intencao === "DISPONIBILIDADE";

  if (intencao !== "SAUDACAO" && (termoDoParametro || perguntaDeConteudo)) {
    marcar("book", "Procurando no Book do Operador");

    const achados = await buscarNoBook(db, pergunta, {
      limite: perguntaDeConteudo ? 6 : 3,
      blocoPreferido: estado?.blocoDoBook ?? null,
      termosExtras: [
        ...(termoDoParametro ? [termoDoParametro] : []),
        ...(alvo ? [alvo.parametro] : []),
      ],
    }).catch(() => []);

    documentos.push(...achados);

    /*
      A par do conteúdo, o registro: qual bloco, que revisão, que tipo de
      entrada. Isso não entra na prosa — os fatos são marcados como internos —,
      mas é o que sustenta a fonte na tela e o que responde "isto está mesmo
      registrado no Book?".
    */
    if (termoDoParametro) {
      await juntar(
        "Consultando o registro do Book",
        regraDoBook(db, termoDoParametro, { documentoLido: achados.length > 0 }),
      );
    }

    /*
      Quando a pergunta é sobre o bloco, o documento inteiro responde melhor
      que três trechos dele.

      "Me explique o QLP ADM" pede o que o documento diz, na ordem em que ele
      diz — objetivo, frequência, critérios. Trechos ranqueados são a ferramenta
      certa para achar; para explicar, eles entregam três pedaços e deixam quem
      lê montando o resto. O teto de tamanho decide: manual de duzentas páginas
      continua vindo por trecho.
    */
    const principal = achados[0]?.trecho;
    const nomeouOBloco =
      principal &&
      perguntaDeConteudo &&
      termos(pergunta).some((p) => normalizar(principal.bloco).includes(p));

    if (principal && nomeouOBloco) {
      const inteiro = await documentoDoBloco(db, principal.blockKey).catch(() => null);
      if (inteiro) {
        const outros = documentos.filter((d) => d.trecho.blockKey !== principal.blockKey);
        documentos.length = 0;
        documentos.push(
          ...inteiro.map((trecho) => ({
            trecho,
            pontos: achados[0].pontos,
            porque: ["documento inteiro — a pergunta é sobre este bloco"],
          })),
          ...outros,
        );
      }
    }

    /*
      O arquivo em si só acompanha a pergunta quando o texto dele não pôde ser
      lido — PDF e imagem, que só o modelo abre.

      Para Word, Excel e PowerPoint o índice já traz o conteúdo estruturado, e
      mandar o arquivo junto seria a mesma informação duas vezes: uma
      conferível contra o texto do dossiê e outra não.
    */
    if (termoDoParametro && documentos.length === 0) {
      const anexo = await anexoDoBook(db, termoDoParametro).catch(() => null);
      if (anexo?.conteudo.forma === "NATIVO") {
        marcar("anexar", "Abrindo o documento do Book");
        anexos.push(anexo);
      }
    }
  }

  // ---- 6. corpus conceitual -----------------------------------------------
  /*
    Uma saudação não consulta o conhecimento — e não anuncia que consultou.

    A etapa é o que a tela mostra enquanto a orquestração roda, e ela é
    verdadeira por construção: cada linha corresponde a algo que aconteceu.
    Anunciar "Consultando o conhecimento do produto" para um "bom dia"
    reintroduziria o progresso inventado que este módulo existe para não ter.
  */
  if (intencao !== "SAUDACAO") marcar("buscarConceito", "Consultando o conhecimento do produto");
  /*
    Quem pergunta do Book quer o Book.

    Sem restringir o corpus, "isso está previsto no Book?" era respondida pelo
    cartão "Cavalo" do catálogo do Freightech — que menciona o parâmetro
    herdado e por isso subia pelo empurrão de ligação. O catálogo descreve o
    que o Freightech publica; o Book registra o que foi contratado. São
    perguntas diferentes, e a segunda não se responde com a primeira.
  */
  const trechos =
    intencao === "SAUDACAO"
      ? []
      : buscarTrechos(pergunta, {
          limite: intencao === "CONCEITUAL" || intencao === "DISPONIBILIDADE" ? 4 : 2,
          ...(intencao === "BOOK" ? { corpora: ["BOOK_INDICE", "ARTIGO"] as const } : {}),
          atributos: alvo?.atributos.map((a) => a.codigo) ?? [],
          parametros: alvo ? [alvo.parametro] : [],
        });

  // ---- 7. lacunas ----------------------------------------------------------
  /*
    O qualificador só é lacuna quando a pergunta espera uma coluna.

    Quem pergunta "qual a regra do bloco PNEU?" não está pedindo uma coluna
    chamada regra — está pedindo o Book, que responde em texto. Rodar a detecção
    aqui produzia a nota "nenhuma coluna da gaveta Pneu trata de regra, bloco",
    verdadeira e sem nenhuma relação com o que foi perguntado.
  */
  if (termoDoParametro && alvo && intencao !== "BOOK") {
    const lacuna = lacunaDoQualificador(termoDoParametro, alvo);
    if (lacuna) lacunas.push(lacuna);
  }

  /*
    Quando a resolução falha, isso é lacuna — ou não é, conforme o que a
    pergunta precisava.

    Numa pergunta de número, sem parâmetro resolvido não há resposta possível, e
    dizê-lo é obrigatório. Numa pergunta conceitual, o corpus pode ter respondido
    inteiramente sem que nenhuma coluna se chame como a pergunta: "o que
    significa semântica UNKNOWN?" é respondida pelo artigo de Curadoria, e
    terminar com "nenhum parâmetro corresponde a unknown" seria negar a resposta
    que acabou de ser dada.
  */
  const precisavaDeNumero = INTENCOES_COM_RECORTE.has(intencao);
  if (alvoPerdido && (precisavaDeNumero ? evidencias.length === 0 : trechos.length === 0)) {
    /*
      Distinguir "o produto não conhece isto" de "o produto conhece e o export
      não traz" é o que separa duas conversas muito diferentes: a primeira
      encerra o assunto, a segunda diz qual arquivo pedir. O catálogo e o Book
      são as duas fontes que provam a segunda.
    */
    const noCatalogo = trechos.some((t) => t.trecho.corpus === "CATALOGO");
    const noBook = trechos.some((t) => t.trecho.corpus === "BOOK_INDICE");
    lacunas.push({
      tipo: noCatalogo || noBook ? "CONCEITO_SEM_DADO" : "NAO_EXISTE_NO_PRODUTO",
      explicacao:
        noCatalogo || noBook
          ? `${noCatalogo ? "O Freightech publica este assunto" : "O Book do Operador trata deste assunto"}, ` +
            `mas nenhuma coluna deste export alimenta "${termoDoParametro}" — então não há número a somar aqui.`
          : `Nenhuma coluna deste export corresponde a "${termoDoParametro}"` +
            (documentos.length > 0
              ? ", e o que sai abaixo vem do que o Book do Operador registra sobre o assunto — regra, não número apurado."
              : ". Pode ser que o Freightech o publique noutra tela cujo arquivo ainda não importamos."),
    });
  }

  const semPreco = evidencias.some((e) =>
    e.fatos.some((f) => /não apurável|sem preço/i.test(`${f.valor} ${f.detalhe ?? ""}`)),
  );
  if (semPreco) {
    lacunas.push({
      tipo: "DADO_SEM_PRECO",
      explicacao:
        "Há dado, e o impacto em dinheiro não é apurável: a semântica do atributo ainda não " +
        "foi confirmada na Curadoria, então somar a variação seria adivinhação.",
    });
  }

  /*
    Não achar nada só é lacuna quando havia o que achar.

    "Não encontrei nada sobre isto" é uma afirmação sobre uma busca que falhou.
    Um "bom dia" não fez busca nenhuma: dizer a alguém que cumprimentou que
    nada foi encontrado sobre o cumprimento dele é responder a uma pergunta que
    não foi feita — e era a primeira coisa que este produto dizia a quem abria
    a tela. A saudação sai daqui sem lacuna, e quem redige a trata como o que
    ela é: conversa.
  */
  if (
    intencao !== "SAUDACAO" &&
    evidencias.length === 0 &&
    documentos.length === 0 &&
    trechos.length === 0 &&
    !desambiguacao
  ) {
    /*
      "Não encontrei" tem de dizer **onde** se procurou.

      A frase genérica encerrava a conversa sem dar a quem perguntou nenhuma
      pista do que fazer em seguida — e as três fontes têm formas diferentes de
      estar vazias: o Book pode não ter o bloco registrado, o export pode não
      trazer a coluna, o recorte pode não ter vigência importada. Dizer os três
      lugares transforma a recusa numa informação.
    */
    lacunas.push({
      tipo: "NAO_ENCONTREI",
      explicacao:
        "Procurei nos três lugares que este produto tem — o Book do Operador, o catálogo " +
        "de parâmetros do Freightech e os dados importados deste recorte — e não encontrei " +
        "nada que sustente uma resposta. Se o assunto tiver documento no Freightech que " +
        "ainda não foi anexado ao Book, é por aí que ele entra.",
    });
  }

  return {
    pergunta,
    leitura: { ...leitura, intencao },
    plano,
    trechos,
    documentos,
    evidencias,
    anexos,
    lacunas,
    etapas,
    desambiguacao,
  };
}

// ── A numeração das citações ────────────────────────────────────────────────

/**
 * Tudo o que a resposta pode citar, numerado — **uma vez, num lugar só.**
 *
 * A numeração era contrato e estava reimplementada em três arquivos: quem
 * montava a lista de fontes, quem escrevia o dossiê para o modelo e quem
 * conferia as citações contavam cada um por si, com um comentário em cada
 * ponto avisando que mexer num sem mexer nos outros faria a resposta citar um
 * documento e a trava conferir uma evidência — "o que não daria erro em lugar
 * nenhum". Um contrato que depende de três cópias concordarem não é contrato;
 * é uma coincidência mantida à mão. Agora é esta função, e os três a chamam.
 *
 * A ordem é a da leitura: o conceito situa, o Book manda no conteúdo, o dado
 * mede, o arquivo é o que só o modelo abre.
 */
export type ItemCitavel =
  | { id: number; tipo: "CONCEITO"; trecho: TrechoRelevante }
  | { id: number; tipo: "BOOK"; documento: TrechoDoBookRanqueado }
  | { id: number; tipo: "DADO"; evidencia: Evidencia }
  | { id: number; tipo: "ARQUIVO"; anexo: Anexo };

export function itensCitaveis(dossie: Dossie): ItemCitavel[] {
  const itens: ItemCitavel[] = [];
  let n = 1;
  for (const trecho of dossie.trechos) itens.push({ id: n++, tipo: "CONCEITO", trecho });
  for (const documento of dossie.documentos) itens.push({ id: n++, tipo: "BOOK", documento });
  for (const evidencia of dossie.evidencias) itens.push({ id: n++, tipo: "DADO", evidencia });
  for (const anexo of dossie.anexos) itens.push({ id: n++, tipo: "ARQUIVO", anexo });
  return itens;
}

// ── Validação ───────────────────────────────────────────────────────────────

/** Todo token numérico do texto. */
function numerosDoTexto(texto: string): string[] {
  return texto.match(/\d[\d.,]*/g) ?? [];
}

/**
 * Nenhum número sem lastro.
 *
 * Junta tudo o que as evidências autorizam citar — os valores crus e cada
 * número que já aparece escrito nos fatos — e confere o texto contra isso. Um
 * número no texto que não esteja aqui não veio de consulta nenhuma, e é
 * exatamente o que uma aplicação de auditoria não pode exibir.
 *
 * A conferência é por token e não por igualdade numérica de propósito: o modelo
 * cita "28.511,24" como está escrito no fato, e comparar `28511.24 === 28511.24`
 * exigiria reimplementar a formatação pt-BR só para desfazê-la.
 */
/**
 * As citações cujo conteúdo a validação não tem como conferir por número.
 *
 * Um trecho e uma evidência chegam com tudo o que autorizam citar — o texto e a
 * lista de números. Um anexo chega como um PDF: o que ele contém só é conhecido
 * por quem o leu, e não existe lista para comparar. Fingir que existe seria pior
 * que admitir que não existe.
 *
 * A numeração é a de `montarFontes`: trechos, evidências e anexos por último.
 */
function citacoesDeAnexo(dossie: Dossie): Set<number> {
  return new Set(
    itensCitaveis(dossie)
      .filter((i) => i.tipo === "ARQUIVO")
      .map((i) => i.id),
  );
}

/** Quebra o texto em frases, nas mesmas fronteiras que o portão usa. */
function frases(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+|\n+/).filter((f) => f.trim().length > 0);
}

/**
 * Nenhum número sem lastro — **e o que fazer quando o lastro é um documento.**
 *
 * Sem anexo, nada muda: todo número do texto é conferido contra o conjunto que
 * as evidências autorizam. Com anexo, a frase que **cita o anexo** fica de fora
 * da conferência numérica, e só ela.
 *
 * Isto não é um furo aberto na trava; é o único desenho que mantém a promessa
 * quando a fonte é um arquivo. A promessa nunca foi "todo número foi conferido
 * por nós" — foi "todo número é conferível por quem lê". Um número que sai de
 * uma consulta é conferível contra a evidência ao lado; um número que sai do
 * contrato é conferível abrindo o contrato, que está numerado nas fontes e a um
 * clique na tela do Book. O que continua proibido é o número **sem** citação, que
 * é o caso em que quem lê não tem para onde ir — e esse segue sendo descartado.
 */
export function numerosSemLastro(texto: string, dossie: Dossie): string[] {
  /*
    O marcador de citação não é uma afirmação numérica.

    `[10]` é "a décima fonte", não a quantia dez. Sem tirá-lo daqui, a própria
    instrução de citar produziria respostas descartadas por número sem lastro a
    partir da décima fonte — um defeito que só apareceria em respostas ricas,
    que são exatamente as que mais interessam.
  */
  /*
    Com anexo no dossiê, a conferência passa a ser por frase — porque a licença
    é por frase. Sem anexo, o caminho é o de sempre, sobre o texto inteiro: um
    dossiê sem arquivo não tem frase isenta, e dividir em frases só criaria uma
    diferença de comportamento onde não há diferença de regra.
  */
  const deAnexo = citacoesDeAnexo(dossie);
  if (deAnexo.size > 0) {
    const semLastro: string[] = [];
    for (const frase of frases(texto)) {
      const citadas = (frase.match(/\[\d{1,2}\]/g) ?? []).map((c) => Number(c.slice(1, -1)));
      if (citadas.some((n) => deAnexo.has(n))) continue;
      semLastro.push(...numerosSemLastro(frase, { ...dossie, anexos: [] }));
    }
    return semLastro;
  }

  const semCitacoes = texto.replace(/\[\d{1,2}\]/g, " ");
  const permitidos = new Set<string>();

  const registrar = (valor: string | number | undefined | null) => {
    if (valor === undefined || valor === null) return;
    for (const token of numerosDoTexto(String(valor))) {
      permitidos.add(token);
      // A mesma grandeza sem separador de milhar, para o caso de o modelo
      // reescrever "28.511,24" como "28511,24".
      permitidos.add(token.replace(/\./g, ""));
    }
  };

  for (const e of dossie.evidencias) {
    registrar(e.titulo);
    registrar(e.nota);
    registrar(e.origem);
    for (const n of e.numeros) {
      registrar(n);
      registrar(n.toLocaleString("pt-BR"));
      registrar(n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
      registrar(Math.abs(n));
      registrar(Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    }
    for (const f of e.fatos) {
      registrar(f.rotulo);
      registrar(f.valor);
      registrar(f.detalhe);
    }
    if (e.recorte) {
      registrar(e.recorte.vigencia);
      registrar(e.recorte.intervalo);
      registrar(e.recorte.contexto);
    }
  }
  for (const t of dossie.trechos) {
    registrar(t.trecho.texto);
    registrar(t.trecho.titulo);
  }
  /*
    Os números do Book têm lastro: eles estão escritos no documento.

    Este é o efeito mais importante de o conteúdo do Book entrar no dossiê como
    texto. Antes, um documento chegava como anexo — um arquivo que a trava não
    tinha como conferir —, e a licença precisava ser dada por frase, a quem
    citasse o anexo. Uma resposta que transcrevesse a tabela de critérios em
    lista, com a citação só na última linha, era descartada inteira. Agora o
    texto que o modelo leu está no dossiê, e conferir "bimestral" ou "R$ 1.234"
    contra ele é a mesma operação de sempre: procurar o token na evidência.
  */
  for (const d of dossie.documentos) {
    registrar(d.trecho.texto);
    registrar(d.trecho.bloco);
    registrar(d.trecho.secao ?? "");
  }
  for (const l of dossie.lacunas) registrar(l.explicacao);

  return numerosDoTexto(semCitacoes).filter((token) => {
    if (permitidos.has(token) || permitidos.has(token.replace(/\./g, ""))) return false;
    // Um algarismo isolado é numeração de lista ou ordinal, não afirmação.
    if (token.length === 1) return false;
    return true;
  });
}

/**
 * Citações que apontam para fonte que não existe.
 *
 * A numeração vem de `montarFontes`: trechos primeiro, evidências depois. Uma
 * resposta que escreve `[4]` com três fontes no dossiê está oferecendo à pessoa
 * um lugar para conferir que não existe — e conferir é a única coisa que a
 * citação promete. Vale a mesma regra dos números: a resposta é descartada
 * inteira, porque o texto foi construído em cima daquela suposta fonte.
 */
export function citacoesSemFonte(texto: string, dossie: Dossie): string[] {
  const quantas = itensCitaveis(dossie).length;
  const citadas: string[] = texto.match(/\[\d{1,2}\]/g) ?? [];
  return [
    ...new Set(
      citadas.filter((c) => {
        const n = Number(c.slice(1, -1));
        return n < 1 || n > quantas;
      }),
    ),
  ];
}

/** O contexto que esta resposta descreve — para a tela dizê-lo. */
export function recorteDoDossie(dossie: Dossie): string | null {
  const comRecorte = dossie.evidencias.find((e) => e.recorte);
  if (comRecorte?.recorte) {
    const r = comRecorte.recorte;
    return r.vigencia ? `${r.contexto} · ${r.vigencia}` : r.contexto;
  }
  return dossie.plano.contexto?.info.label ?? null;
}

/** O nome legível da vigência resolvida, quando houve uma. */
export function vigenciaDoDossie(dossie: Dossie): string | null {
  return dossie.plano.periodo ? rotuloDoPeriodo(dossie.plano.periodo) : null;
}

/** Só para os testes de isolamento: os contextos citados em qualquer evidência. */
export function contextosCitados(dossie: Dossie): string[] {
  return [
    ...new Set(
      dossie.evidencias
        .map((e) => e.recorte?.contexto)
        .filter((c): c is string => Boolean(c))
        .map(normalizar),
    ),
  ];
}
