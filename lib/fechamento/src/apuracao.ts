import {
  centavos,
  emReais,
  fonteEsperadaNaQuinzena,
  TIPOS_DE_FONTE,
  type Canal,
  type TipoDeFonte,
} from "./dominio";
import type { Competencia } from "./periodo";
import { dentroDaCompetencia } from "./periodo";
import { medirAliquotas, medirCargaFiscal, type Aliquota, type CargaFiscal } from "./aliquota";
import type { Viagem } from "./leitores/operacao";
import type { LinhaDeCte } from "./leitores/cte";
import type { Requisicao } from "./leitores/requisicoes";
import { STATUS_QUE_PAGA } from "./leitores/requisicoes";
import type { DiaDeDisponibilidade } from "./leitores/disponibilidade";
import { valorDe, type Conciliacao } from "./leitores/conciliacao";
import { ctrcPorVerba, type Pagamento } from "./leitores/pagamento";
import type { Verba } from "./verbas";

/**
 * A apuração — a conta do fechamento, reconstruída fonte por fonte.
 *
 * Este arquivo é o que substitui a planilha. A `.xlsb` que ele aposenta faz uma
 * coisa: junta as cinco fontes e confere se elas fecham entre si. Ela faz isso
 * com PROCVs entre abas, o que tem duas consequências que este módulo não tem —
 * o resultado não sabe explicar de onde veio, e quem confere precisa ser quem
 * montou.
 *
 * **A regra que a apuração descobriu, e que a planilha nunca escreveu.** Todo
 * CT-e emitido em uma verba é a soma de no máximo três coisas:
 *
 * ```
 * CT-e da verba  =  o que o SRTrans calculou      (conciliação, coluna calculado)
 *                +  o complementar de perfil       (conciliação, bloco complementar)
 *                +  requisições aprovadas × fator  (03.08.12.09, com imposto)
 * ```
 *
 * **E a regra que faltava, que o 03.08.20 trouxe.** A igualdade acima cobre o
 * que nasce da operação e do complementar, e **não cobre o fixo** — as verbas
 * de frota, equipe e administrativo, que na quinzena de referência eram
 * R$ 654.310,24 dos R$ 1.473.432,61 emitidos. Elas têm origem única, e é o
 * demonstrativo de pagamento:
 *
 * ```
 * CT-e da verba fixa  =  a coluna CTRC-ICMS do 03.08.20
 * ```
 *
 * Conferida no mesmo fechamento, essa igualdade fecha **ao centavo** nas seis
 * verbas fixas dos dois canais. Nas variáveis o 03.08.20 não entra na conta —
 * lá ele é uma segunda opinião, e quando discorda do CT-e a diferença vira
 * divergência em vez de virar parcela: somá-lo às outras três dobraria o mesmo
 * dinheiro.
 *
 * Conferida contra um fechamento real — CDD Belém, 2ª quinzena de julho/2026 —
 * essa igualdade fecha nas **quinze** verbas que o arquivo trouxe, com resíduo
 * máximo de R$ 0,66 em R$ 39 mil (arredondamento do fator). É essa igualdade
 * que permite dizer, verba a verba, se o que a Ambev vai pagar é o que é devido
 * — e, quando não é, qual das três parcelas está faltando.
 *
 * **O que a apuração nunca faz: preencher.** Uma fonte que não foi importada
 * não vira zero; vira `null` com a fonte nomeada em `fontesAusentes`. A conta
 * roda com o que há, diz o que falta, e o total que ela mostra é sempre o total
 * do que ela conseguiu sustentar.
 *
 * **E o que ela não chama de falta.** `fontesAusentes` só nomeia o que a
 * quinzena da competência **espera** (`FONTES_DA_QUINZENA`): a primeira não
 * recebe a conciliação, e cobrá-la ali seria pedir arquivo que não existe. O
 * 03.08.12.09 da primeira quinzena não é cobrado pelo mesmo motivo — mas ele
 * *pode* existir, e por isso é opcional ali e não ausente
 * (`FONTES_OPCIONAIS_DA_QUINZENA`): quando chega, entra na conta como em
 * qualquer outra quinzena; quando não chega, não vira pendência de ninguém.
 */

/** As fontes que a apuração consome. Todas opcionais: a conta roda com o que há. */
export interface Fontes {
  operacao?: Viagem[];
  ctes?: LinhaDeCte[];
  pagamento?: Pagamento;
  requisicoes?: Requisicao[];
  disponibilidade?: DiaDeDisponibilidade[];
  conciliacao?: Conciliacao;
}

/** De onde saiu uma parcela do valor esperado. */
export interface Parcela {
  origem: TipoDeFonte;
  /** O que esta parcela é, em uma frase que quem opera reconhece. */
  descricao: string;
  /** O valor sem imposto, quando a origem trabalha sem imposto. */
  semImposto: number | null;
  /** O valor com imposto — o que se soma para chegar ao CT-e. */
  comImposto: number;
  /** O fator aplicado, quando houve conversão. */
  fator?: number;
  /** Quantos registros da origem entraram nesta parcela. */
  registros: number;
}

export interface VerbaApurada {
  verba: Verba;
  /** O que a Ambev emitiu em CT-e nesta verba — com imposto. */
  emitido: number;
  /** A base dos CT-es: o frete sem imposto, como o próprio documento o abre. */
  baseEmitida: number;
  /** Quantos CT-es. */
  documentos: number;
  /**
   * O que a apuração reconstruiu que deveria ter sido emitido.
   *
   * `null` quando nenhuma fonte sustenta a verba — é o caso do fixo e do
   * administrativo, cuja origem não está entre as cinco fontes. Não é erro; é
   * o módulo dizendo que aquele valor entrou pelo que foi emitido e ninguém o
   * conferiu.
   */
  esperado: number | null;
  /** Como o esperado foi montado — a memória de cálculo, parcela a parcela. */
  memoria: Parcela[];
  /** emitido − esperado. Positivo: emitiram mais. Negativo: falta receber. */
  diferenca: number | null;
}

/** O que impede a competência de fechar, ou o que merece uma pergunta à Ambev. */
export interface Divergencia {
  tipo:
    /** A verba foi emitida e nenhuma fonte a sustenta. */
    | "VERBA_SEM_ORIGEM"
    /** A verba foi reconstruída e o valor não bate. */
    | "VERBA_NAO_FECHA"
    /** Requisição aprovada sem CT-e correspondente na verba. */
    | "REQUISICAO_NAO_FATURADA"
    /** O SRTrans descontou frete mínimo — o maior valor unilateral da conta. */
    | "DESCONTO_FRETE_MINIMO"
    /** O demonstrativo de pagamento e o CT-e emitido não dizem o mesmo. */
    | "PAGAMENTO_DIVERGE_DO_CTE"
    /** Saldo que atravessa para a quinzena seguinte, incluindo NF-e sem CT-e. */
    | "SALDO_ATRAVESSANDO"
    /** Desconto por indisponibilidade atribuído à transportadora. */
    | "DESCONTO_DE_DISPONIBILIDADE"
    /** O que a operação rodou não bate com o que o SRTrans calculou. */
    | "OPERACAO_NAO_FECHA"
    /** O relatório trouxe um aviso sem valor. */
    | "AVISO_DA_CONCILIACAO";
  canal: Canal | "GERAL";
  /** O que é, em uma frase. */
  titulo: string;
  /** O valor em jogo. */
  valor: number;
  /** Onde olhar para resolver — a fonte e a linha. */
  onde: string;
  /** Se o valor é a favor da transportadora (`A_RECEBER`) ou contra (`A_PAGAR`). */
  sentido: "A_RECEBER" | "A_PAGAR" | "INFORMATIVO";
}

export interface Apuracao {
  competencia: Competencia;
  fontesPresentes: TipoDeFonte[];
  fontesAusentes: TipoDeFonte[];
  aliquotas: Aliquota[];
  cargaFiscal: Map<Canal, CargaFiscal>;
  verbas: VerbaApurada[];
  divergencias: Divergencia[];
  totais: {
    /** Tudo que foi emitido em CT-e na competência. */
    emitido: number;
    /** Tudo que a apuração conseguiu reconstruir. */
    esperado: number;
    /** A parte do emitido que nenhuma fonte sustenta. */
    naoConferido: number;
    diferenca: number;
  };
  /** O que a operação produziu no período, do 2Art. */
  operacao: {
    viagens: number;
    porCanal: { canal: Canal; viagens: number; freteSemImposto: number; freteComImposto: number }[];
  } | null;
}

/**
 * A tolerância de uma conferência, em reais.
 *
 * Não é uma folga de conveniência: o fator de conversão é **medido** a partir
 * de somas já arredondadas a centavos, então um resíduo de alguns centavos por
 * verba é matemática, não erro. `R$ 1,00 + 0,002% do valor` cobre o resíduo
 * observado (máximo de R$ 0,66 em R$ 39 mil) com folga, e ainda acusa uma
 * diferença de R$ 10 numa verba de R$ 200 mil — que é o que precisa aparecer.
 */
export function tolerancia(valor: number): number {
  return 1 + Math.abs(valor) * 0.00002;
}

/**
 * Dinheiro na frase de uma divergência.
 *
 * O título vai para o banco e de lá para a tela, então ele precisa nascer
 * legível: `328169.46` no meio de uma frase em português é o tipo de detalhe
 * que faz quem lê desconfiar do resto. A formatação é fixada em pt-BR porque a
 * frase também é.
 */
/* A formatação mora em `dominio.ts` — ver {@link emReais}. */

/** Roda a apuração da competência com as fontes que houver. */
export function apurar(competencia: Competencia, fontes: Fontes): Apuracao {
  const recebida: Record<TipoDeFonte, boolean> = {
    OPERACAO: !!fontes.operacao,
    CTE: !!fontes.ctes,
    PAGAMENTO: !!fontes.pagamento,
    /*
      O 03.08.18 são duas casinhas e uma tabela só: o que diz se cada uma
      chegou é haver linha da frota dela. Marcar as duas por `!!disponibilidade`
      faria o envio da FF dar a van por recebida — e uma van "presente" sem
      desconto dentro é exatamente o silêncio que a separação existe para
      acabar.
    */
    DISPONIBILIDADE_FF: !!fontes.disponibilidade?.some((d) => d.tipoDeFrota === "FF"),
    DISPONIBILIDADE_VAN: !!fontes.disponibilidade?.some((d) => d.tipoDeFrota === "VAN"),
    REQUISICOES: !!fontes.requisicoes,
    CONCILIACAO: !!fontes.conciliacao,
    /*
      A frota Promax não é financeira e não entra em `Fontes`: este motor não
      soma, desconta nem sequer lê os veículos dela — ver
      `frota-promax-comparacao.ts`, que roda fora daqui. `recebida` existe só
      para os cálculos financeiros que se seguem, e por isso as duas entram
      sempre como não recebidas aqui, independentemente do que a competência
      realmente tenha. A presença de verdade é contada em `persistencia.ts`, a
      partir dos documentos gravados — não a partir deste motor puro.
    */
    FROTA_PROMAX_ATIVA: false,
    FROTA_PROMAX_INATIVA: false,
  };
  /*
    Ausente é o que **esta quinzena** espera e não chegou — não tudo que não
    chegou. A primeira quinzena não espera a conciliação, e o 03.08.12.09 é
    opcional nela (ver `FONTES_DA_QUINZENA` e `FONTES_OPCIONAIS_DA_QUINZENA`):
    nomeá-los ali faria toda primeira quinzena do ano nascer com duas pendências
    que ninguém pode resolver.

    O que chegou fora — ou por cima — da quinzena dele continua presente:
    presente é presente, e a conta usa o que houver. É o que faz o 03.08.12.09
    da primeira quinzena virar complementar como o da segunda, sem que a sua
    falta vire cobrança.
  */
  const presentes: TipoDeFonte[] = [];
  const ausentes: TipoDeFonte[] = [];
  for (const tipo of TIPOS_DE_FONTE) {
    if (recebida[tipo]) presentes.push(tipo);
    else if (fonteEsperadaNaQuinzena(competencia.quinzena, tipo)) ausentes.push(tipo);
  }

  const ctes = fontes.ctes ?? [];
  const requisicoes = (fontes.requisicoes ?? []).filter(
    (r) => r.status.trim().toLowerCase() === STATUS_QUE_PAGA,
  );

  const aliquotas = medirAliquotas(ctes, requisicoes);
  const fatorDoCanal = new Map(aliquotas.map((a) => [a.canal, a.fator]));

  const verbas = apurarVerbas(
    ctes,
    requisicoes,
    fontes.conciliacao,
    fontes.pagamento,
    fatorDoCanal,
  );
  const operacao = fontes.operacao ? resumirOperacao(fontes.operacao, competencia) : null;
  const divergencias = levantarDivergencias(
    verbas,
    requisicoes,
    fontes.conciliacao,
    fontes.pagamento,
    fontes.disponibilidade,
    operacao,
    competencia,
  );

  const emitido = centavos(verbas.reduce((s, v) => s + v.emitido, 0));
  const esperado = centavos(verbas.reduce((s, v) => s + (v.esperado ?? 0), 0));
  const naoConferido = centavos(
    verbas.filter((v) => v.esperado === null).reduce((s, v) => s + v.emitido, 0),
  );

  return {
    competencia,
    fontesPresentes: presentes,
    fontesAusentes: ausentes,
    aliquotas,
    cargaFiscal: medirCargaFiscal(ctes),
    verbas,
    divergencias,
    totais: {
      emitido,
      esperado,
      naoConferido,
      diferenca: centavos(emitido - esperado - naoConferido),
    },
    operacao,
  };
}

/** A rubrica da conciliação, pelo nome que o relatório usa. */
const NOME_DA_RUBRICA: Record<string, string> = {
  FROTA_FIXA: "Frota Fixa",
  FRETEIRO: "Freteiro",
  SERVICOS_DIVERSOS: "S.Diversos/Comodatos/Eventos",
};

/** O mesmo, no bloco do complementar, onde o relatório escreve com espaço. */
const NOME_NO_COMPLEMENTAR: Record<string, string> = {
  FROTA_FIXA: "Frota Fixa",
  FRETEIRO: "Freteiro",
  SERVICOS_DIVERSOS: "S. Diversos/Comodatos/Eventos",
};

/**
 * As naturezas cuja única origem possível é o demonstrativo de pagamento.
 *
 * O fixo não nasce de viagem nem de requisição: é a parcela contratada da
 * frota, da equipe e do indireto. Nenhuma das outras cinco fontes a abre por
 * verba — a conciliação do Promax cobre só o variável, e o 03.08.15 é o próprio
 * documento que se quer conferir.
 */
const SUSTENTADAS_PELO_PAGAMENTO = new Set(["FIXO", "ADMINISTRATIVO"]);

function apurarVerbas(
  ctes: LinhaDeCte[],
  requisicoes: Requisicao[],
  conciliacao: Conciliacao | undefined,
  pagamento: Pagamento | undefined,
  fatorDoCanal: Map<Canal, number>,
): VerbaApurada[] {
  const porVbz = new Map<number, VerbaApurada>();

  for (const cte of ctes) {
    const atual =
      porVbz.get(cte.verba.vbz) ??
      ({
        verba: cte.verba,
        emitido: 0,
        baseEmitida: 0,
        documentos: 0,
        esperado: null,
        memoria: [],
        diferenca: null,
      } as VerbaApurada);
    atual.emitido += cte.valorCte;
    atual.baseEmitida += cte.valorFrete;
    atual.documentos += 1;
    porVbz.set(cte.verba.vbz, atual);
  }

  /* Uma verba que o demonstrativo abre e o CT-e não emitiu ainda é conta. */
  for (const item of pagamento?.itens ?? []) {
    if (porVbz.has(item.verba.vbz)) continue;
    porVbz.set(item.verba.vbz, {
      verba: item.verba,
      emitido: 0,
      baseEmitida: 0,
      documentos: 0,
      esperado: null,
      memoria: [],
      diferenca: null,
    });
  }

  /* Uma requisição de VBZ que não teve CT-e ainda precisa aparecer na conta. */
  for (const req of requisicoes) {
    if (porVbz.has(req.verba.vbz)) continue;
    porVbz.set(req.verba.vbz, {
      verba: req.verba,
      emitido: 0,
      baseEmitida: 0,
      documentos: 0,
      esperado: null,
      memoria: [],
      diferenca: null,
    });
  }

  for (const apurada of porVbz.values()) {
    const memoria: Parcela[] = [];

    /* 1. O que o SRTrans calculou, e o complementar de perfil. */
    const rubrica = apurada.verba.rubricaDaConciliacao;
    if (conciliacao && rubrica) {
      const calculado = valorDe(conciliacao, {
        secao: apurada.verba.canal,
        rubrica: NOME_DA_RUBRICA[rubrica],
        bloco: "RESUMO DA QUINZENA ATUAL",
        coluna: "EMITIDO",
      });
      if (calculado != null) {
        memoria.push({
          origem: "CONCILIACAO",
          descricao: `${NOME_DA_RUBRICA[rubrica]} — quinzena atual, coluna CT-e emitido`,
          semImposto: null,
          comImposto: calculado,
          registros: 1,
        });
      }
      const complementar = valorDe(conciliacao, {
        secao: apurada.verba.canal,
        rubrica: NOME_NO_COMPLEMENTAR[rubrica],
        bloco: "(Quinzena Atual)",
        coluna: "EMITIDO",
      });
      if (complementar != null && complementar !== 0) {
        memoria.push({
          origem: "CONCILIACAO",
          descricao: `${NOME_NO_COMPLEMENTAR[rubrica]} — complementar variável por alteração de perfil`,
          semImposto: null,
          comImposto: complementar,
          registros: 1,
        });
      }
    }

    /* 2. As requisições aprovadas da verba, convertidas pelo fator medido. */
    const daVerba = requisicoes.filter((r) => r.verba.vbz === apurada.verba.vbz);
    if (daVerba.length > 0) {
      const semImposto = centavos(daVerba.reduce((s, r) => s + r.valor, 0));
      const fator = fatorDoCanal.get(apurada.verba.canal);
      if (fator) {
        memoria.push({
          origem: "REQUISICOES",
          descricao: `${daVerba.length} requisição(ões) aprovada(s)`,
          semImposto,
          comImposto: centavos(semImposto * fator),
          fator,
          registros: daVerba.length,
        });
      } else {
        memoria.push({
          origem: "REQUISICOES",
          descricao:
            `${daVerba.length} requisição(ões) aprovada(s) — sem fator medido para o canal ` +
            `${apurada.verba.canal}, o valor entra sem imposto`,
          semImposto,
          comImposto: semImposto,
          registros: daVerba.length,
        });
      }
    }

    /*
      3. O demonstrativo de pagamento, onde ele é a origem — e só ali.

      Nas verbas variáveis e complementares o 03.08.20 também traz um valor, e
      ele não entra aqui de propósito: aquelas já são reconstruídas pela
      igualdade das outras fontes, e uma quarta parcela sobre o mesmo dinheiro
      faria o apurado passar do emitido em toda verba que fecha hoje. O que o
      demonstrativo diz sobre elas vira divergência, não parcela.
    */
    if (pagamento && SUSTENTADAS_PELO_PAGAMENTO.has(apurada.verba.natureza)) {
      const doPagamento = pagamento.itens.filter((i) => i.verba.vbz === apurada.verba.vbz);
      if (doPagamento.length > 0) {
        memoria.push({
          origem: "PAGAMENTO",
          descricao: "Demonstrativo de pagamento — coluna CTRC-ICMS, a que vira CT-e",
          semImposto: centavos(doPagamento.reduce((s, i) => s + i.semImposto, 0)),
          comImposto: centavos(doPagamento.reduce((s, i) => s + i.ctrcIcms, 0)),
          registros: doPagamento.length,
        });
      }
    }

    apurada.memoria = memoria;
    apurada.emitido = centavos(apurada.emitido);
    apurada.baseEmitida = centavos(apurada.baseEmitida);
    if (memoria.length > 0) {
      apurada.esperado = centavos(memoria.reduce((s, p) => s + p.comImposto, 0));
      apurada.diferenca = centavos(apurada.emitido - apurada.esperado);
    }
  }

  return [...porVbz.values()].sort((a, b) => a.verba.vbz - b.verba.vbz);
}

function levantarDivergencias(
  verbas: VerbaApurada[],
  requisicoes: Requisicao[],
  conciliacao: Conciliacao | undefined,
  pagamento: Pagamento | undefined,
  disponibilidade: DiaDeDisponibilidade[] | undefined,
  operacao: Apuracao["operacao"],
  competencia: Competencia,
): Divergencia[] {
  const divergencias: Divergencia[] = [];

  for (const v of verbas) {
    if (v.esperado === null) {
      if (v.emitido !== 0) {
        divergencias.push({
          tipo: "VERBA_SEM_ORIGEM",
          canal: v.verba.canal,
          titulo: `${v.verba.nome} foi emitida e nenhuma fonte a sustenta`,
          valor: v.emitido,
          onde: `VBZ ${v.verba.vbz} — ${v.documentos} CT-e(s) no 03.08.15`,
          sentido: "INFORMATIVO",
        });
      }
      continue;
    }
    if (Math.abs(v.diferenca ?? 0) > tolerancia(v.esperado)) {
      divergencias.push({
        tipo: "VERBA_NAO_FECHA",
        canal: v.verba.canal,
        titulo: `${v.verba.nome}: emitido e apurado não fecham`,
        valor: v.diferenca ?? 0,
        onde: `VBZ ${v.verba.vbz} — emitido ${emReais(v.emitido)}, apurado ${emReais(v.esperado)}`,
        sentido: (v.diferenca ?? 0) < 0 ? "A_RECEBER" : "A_PAGAR",
      });
    }
  }

  /*
    O que o demonstrativo diz sobre as verbas que ele não sustenta.

    Nas variáveis e complementares o 03.08.20 é uma segunda opinião sobre o
    mesmo CT-e, e as duas discordarem é o achado mais direto que este
    fechamento produz: o documento que a Ambev e a transportadora assinam diz
    um valor, e o que foi faturado diz outro. Não vira parcela — viraria dupla
    contagem, ver `apurarVerbas` —, vira pergunta, com os dois números na
    frase, porque a primeira coisa que se faz com ela é conferir os dois.
  */
  if (pagamento) {
    const ctrc = ctrcPorVerba(pagamento);
    for (const v of verbas) {
      if (SUSTENTADAS_PELO_PAGAMENTO.has(v.verba.natureza)) continue;
      const doPagamento = ctrc.get(v.verba.vbz);
      if (doPagamento == null) continue;
      const diferenca = centavos(v.emitido - doPagamento);
      if (Math.abs(diferenca) <= tolerancia(doPagamento)) continue;
      divergencias.push({
        tipo: "PAGAMENTO_DIVERGE_DO_CTE",
        canal: v.verba.canal,
        titulo: `${v.verba.nome}: o demonstrativo e o CT-e emitido não dizem o mesmo`,
        valor: diferenca,
        onde: `VBZ ${v.verba.vbz} — 03.08.20 ${emReais(doPagamento)}, 03.08.15 ${emReais(v.emitido)}`,
        sentido: diferenca < 0 ? "A_RECEBER" : "A_PAGAR",
      });
    }
  }

  /* Requisição aprovada na competência cuja verba não teve nenhum CT-e. */
  const comCte = new Set(verbas.filter((v) => v.documentos > 0).map((v) => v.verba.vbz));
  for (const req of requisicoes) {
    if (comCte.has(req.verba.vbz)) continue;
    divergencias.push({
      tipo: "REQUISICAO_NAO_FATURADA",
      canal: req.canal,
      titulo: `Requisição ${req.numero} (${req.descricao}) aprovada e sem CT-e`,
      valor: req.valor,
      onde: `03.08.12.09, linha ${req.linha} — VBZ ${req.verba.vbz}`,
      sentido: "A_RECEBER",
    });
  }

  if (conciliacao) {
    for (const secao of ["ROTA", "AS"] as const) {
      const desconto = valorDe(conciliacao, {
        secao,
        rubrica: "Desconto Frete Minimo",
        coluna: "CALCULADO",
      });
      if (desconto) {
        divergencias.push({
          tipo: "DESCONTO_FRETE_MINIMO",
          canal: secao,
          titulo: `Desconto de frete mínimo aplicado pelo SRTrans no canal ${secao}`,
          valor: desconto,
          onde: "03.02.59.02 — só na coluna do calculado, sem contrapartida no emitido",
          sentido: "A_RECEBER",
        });
      }
      const saldo = valorDe(conciliacao, {
        secao,
        rubrica: "Saldo Proxima Quinzena",
        coluna: "CALCULADO",
      });
      if (saldo) {
        divergencias.push({
          tipo: "SALDO_ATRAVESSANDO",
          canal: secao,
          titulo: `Saldo do canal ${secao} atravessa para a quinzena seguinte`,
          valor: saldo,
          onde: "03.02.59.02 — Saldo Proxima Quinzena",
          sentido: "A_RECEBER",
        });
      }
    }
    for (const aviso of conciliacao.avisos) {
      divergencias.push({
        tipo: "AVISO_DA_CONCILIACAO",
        canal: "GERAL",
        titulo: aviso,
        valor: 0,
        onde: "03.02.59.02 — rodapé",
        sentido: "INFORMATIVO",
      });
    }
  }

  /*
    A conferência que fecha o laço pelo lado da rua.

    O `Total Variavel Calculado SRTRANS` da conciliação é o que a Ambev diz ter
    apurado de frete variável no canal; o 2Art é o que a operação de fato rodou,
    e a coluna `ValorFaturado` já vem com imposto — as duas grandezas são
    diretamente comparáveis. Na quinzena conferida o canal AS bate ao centavo
    (R$ 49.352,25 dos dois lados), o que é a prova de que a comparação é
    legítima; o canal Rota abre R$ 5.575,68, e essa diferença é precisamente o
    tipo de pergunta que a planilha não tinha como formular.
  */
  if (conciliacao && operacao) {
    for (const resumo of operacao.porCanal) {
      const calculado = valorDe(conciliacao, {
        secao: resumo.canal,
        rubrica: "Total Variavel Calculado SRTRANS",
        coluna: "CALCULADO",
      });
      if (calculado == null) continue;
      const diferenca = centavos(resumo.freteComImposto - calculado);
      if (Math.abs(diferenca) <= tolerancia(calculado)) continue;
      divergencias.push({
        tipo: "OPERACAO_NAO_FECHA",
        canal: resumo.canal,
        titulo:
          `O 2Art do canal ${resumo.canal} soma ${emReais(resumo.freteComImposto)} e o SRTrans ` +
          `calculou ${emReais(calculado)}`,
        valor: diferenca,
        onde: `2Art — ${resumo.viagens} viagens no período, coluna ValorFaturado`,
        sentido: diferenca > 0 ? "A_RECEBER" : "A_PAGAR",
      });
    }
  }

  if (disponibilidade) {
    const noPeriodo = disponibilidade.filter((d) => dentroDaCompetencia(competencia, d.dia));
    const total = centavos(noPeriodo.reduce((s, d) => s + d.descontos.total, 0));
    if (total > 0) {
      const dias = noPeriodo.filter((d) => d.descontos.total > 0).length;
      divergencias.push({
        tipo: "DESCONTO_DE_DISPONIBILIDADE",
        canal: "GERAL",
        titulo: `Desconto por indisponibilidade de frota em ${dias} dia(s) da competência`,
        valor: total,
        onde: "03.08.18 — Desconto Total, abas FF e Van",
        sentido: "A_RECEBER",
      });
    }
  }

  return divergencias.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}

function resumirOperacao(viagens: Viagem[], competencia: Competencia): Apuracao["operacao"] {
  const noPeriodo = viagens.filter((v) => dentroDaCompetencia(competencia, v.dia));
  const porCanal = new Map<Canal, { viagens: number; freteSemImposto: number; freteComImposto: number }>();
  for (const v of noPeriodo) {
    const atual = porCanal.get(v.canal) ?? { viagens: 0, freteSemImposto: 0, freteComImposto: 0 };
    atual.viagens += 1;
    atual.freteSemImposto += v.valorFrete;
    atual.freteComImposto += v.valorFaturado;
    porCanal.set(v.canal, atual);
  }
  return {
    viagens: noPeriodo.length,
    porCanal: [...porCanal].map(([canal, r]) => ({
      canal,
      viagens: r.viagens,
      freteSemImposto: centavos(r.freteSemImposto),
      freteComImposto: centavos(r.freteComImposto),
    })),
  };
}
