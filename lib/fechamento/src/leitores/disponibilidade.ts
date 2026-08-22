import { centavos, lerCanal, lerNumero, type Canal, type Leitura, type Recusa, type TipoDeFrotaContratada } from "../dominio";
import { diaDeCelula, type Dia } from "../periodo";
import { celula, lerAba, nomesDasAbas, type LinhaDePlanilha, type PlanilhaLida } from "./planilha";

/**
 * O 03.08.18 — frota contratada contra frota que rodou.
 *
 * É a fonte dos **descontos**: para cada dia, quantos veículos a transportadora
 * se comprometeu a pôr na rua, quantos de fato saíram, e de quem é a culpa pela
 * diferença. O gap atribuído à transportadora vira desconto sobre a parcela
 * fixa; o gap atribuído à Ambev (`Gap Cia.`) não desconta nada.
 *
 * **Essa distinção é o dinheiro.** Uma linha reclassificada de `Gap TP` para
 * `Gap Cia.` devolve o desconto daquele dia inteiro — e é exatamente por isso
 * que a planilha que este módulo substitui tem uma aba `Justificativa` com
 * motivos como "atraso de carregamento" e "desconto indevido". O leitor guarda
 * os gaps separados por responsabilidade e por cancelamento para que a
 * contestação tenha onde se apoiar.
 *
 * **Duas abas, um mesmo layout.** `FF` é a frota de caminhões e `Van` a frota
 * dedicada; as colunas são idênticas. Ler as duas e marcar a origem em cada
 * linha é o que evita duas funções que precisam ser mudadas juntas.
 */

export interface DiaDeDisponibilidade {
  linha: number;
  aba: string;
  tipoDeFrota: TipoDeFrotaContratada;
  dia: Dia;
  canal: Canal;
  /** O tamanho da frota cadastrada. */
  frotaTotal: number;
  /** Quantos veículos a transportadora se comprometeu a operar no dia. */
  contratada: number;
  realPrimeiraViagem: number;
  realSegundaViagem: number;
  /** A diferença total entre contratada e realizada. */
  gapTotal: number;
  /** A parte do gap que é da Ambev — **não** desconta. */
  gapDaCia: number;
  /** A parte do gap que é da transportadora, aberta como o relatório a abre. */
  gapDaTransportadora: {
    frotaCancelada: number;
    outrosCancelados: number;
    frotaNaoCancelada: number;
    outrosNaoCancelados: number;
  };
  descontos: {
    custoFixo: number;
    equipe: number;
    indiretos: number;
    fatorAjudante: number;
    /** O total que o relatório declara — conferido contra a soma das parcelas. */
    total: number;
  };
  percentualDeUtilizacao: number | null;
  percentualDeDisponibilidade: number | null;
}

const COLUNAS_EXIGIDAS = ["Data", "Canal", "Contratada", "Desconto Total"];

/** As abas que o relatório traz, e o tipo de frota de cada uma. */
const ABAS: { nome: string; tipo: TipoDeFrotaContratada }[] = [
  { nome: "FF", tipo: "FF" },
  { nome: "Van", tipo: "VAN" },
];

/**
 * As colunas em que uma exportação de texto pode declarar de que frota é a
 * linha — o que, na planilha, o nome da aba dizia.
 *
 * A ordem é a da especificidade: uma coluna que fala de tipo de frota manda
 * sobre a coluna genérica `Frota`, que no relatório real traz o perfil do
 * veículo (`Padrao`) e só às vezes a frota contratada.
 */
const COLUNAS_DE_TIPO_DE_FROTA = ["Tipo Frota", "Tipo de Frota", "Frota FF/Van", "Aba", "Frota"];

/** `FF`/`Van` como o relatório os escreve. `null` no que não for um dos dois. */
function lerTipoDeFrotaContratada(bruto: unknown): TipoDeFrotaContratada | null {
  const texto = String(bruto ?? "").trim().toLowerCase();
  if (texto === "ff") return "FF";
  if (texto === "van") return "VAN";
  return null;
}

/** Alguma coluna desta linha declara a frota contratada? */
function tipoDeFrotaDeclarado(bruta: LinhaDePlanilha): TipoDeFrotaContratada | null {
  for (const coluna of COLUNAS_DE_TIPO_DE_FROTA) {
    const tipo = lerTipoDeFrotaContratada(celula(bruta, coluna));
    if (tipo) return tipo;
  }
  return null;
}

/** Como o relatório escreve a frota, para a frase que quem opera lê. */
const NOME_DA_FROTA: Record<TipoDeFrotaContratada, string> = { FF: "FF", VAN: "Vans" };

/**
 * Lê o 03.08.18 — de uma frota, ou das duas.
 *
 * **`so` é a frota que a casinha de envio declara**, e é ela que decide o que
 * entra: com `so: "FF"` a aba `Van` é lida e descartada, e vice-versa. A porta
 * de entrada tem duas casinhas porque o relatório sai do Promax em dois
 * arquivos (ver `FROTA_DA_FONTE`, no domínio), e nenhuma das duas pode gravar
 * a frota da outra — foi isso que fez o segundo arquivo a chegar apagar o
 * primeiro enquanto os dois disputavam a mesma vigência.
 *
 * Sem `so`, lê as duas: é como a apuração relê o que já está gravado e como os
 * testes de leitura pura exercitam o arquivo inteiro.
 *
 * **O arquivo que não tem a frota pedida é recusado, e a recusa diz onde ele
 * cabe.** Mandar o arquivo das vans na casinha da FF é o erro de trocar a aba
 * de envio, e ele tem de doer na porta: promovê-lo vazio deixaria a FF
 * "presente" sem um desconto dentro.
 *
 * Uma aba ausente continua não sendo erro quando não foi ela a pedida: há CDDs
 * sem van, e o arquivo de FF deles é um `.xlsx` de uma aba só.
 *
 * **Um arquivo de texto não tem abas, e esta é a única fonte para quem isso
 * importa.** Nas outras cinco a aba é embalagem; aqui ela *é* dado — é o nome
 * dela que diz se a linha fala do caminhão ou da van, e as duas descontam
 * coisas diferentes. Por isso um `.csv` só é aceito quando alguma coluna
 * declara a frota (ver `COLUNAS_DE_TIPO_DE_FROTA`); quando nenhuma declara, a
 * recusa é do arquivo inteiro e diz para enviar a planilha. Escolher `FF` por
 * omissão seria dar à van os descontos do caminhão, em silêncio.
 */
export function lerDisponibilidade(
  arquivo: Buffer | ArrayBuffer,
  so?: TipoDeFrotaContratada,
): Leitura<DiaDeDisponibilidade> {
  const presentes = new Set(nomesDasAbas(arquivo));
  const leitura = presentes.size === 0 ? lerTabelaUnica(arquivo) : lerAbas(arquivo, presentes);
  if (!so) {
    return { linhas: leitura.linhas, recusas: leitura.recusas.map(({ frota: _, ...r }) => r) };
  }

  /*
    O corte é depois da leitura, e não antes: ler as duas abas é o que permite
    dizer, na recusa, que o arquivo é da *outra* frota — que é a informação de
    que quem enviou precisa. Cortar antes devolveria "não tem a aba FF" sobre um
    arquivo que tem a Van inteira dentro.
  */
  const linhas = leitura.linhas.filter((l) => l.tipoDeFrota === so);
  /*
    **O arquivo da outra frota é recusado na porta; o arquivo vazio, não.**

    São duas faltas diferentes. Um `.xlsx` com a `Van` inteira dentro, enviado na
    casinha da FF, é a aba de envio trocada: o arquivo está certo, e o que ele
    precisa é ir para a outra casinha — guardá-lo aqui em quarentena poria um
    aviso âmbar sobre um relatório que não tem defeito nenhum, e ainda deixaria a
    FF parecendo tratada. Já o arquivo do qual não saiu linha nenhuma é o caso de
    sempre (`motivoParaQuarentena`, em `persistencia.ts`): ele fica guardado
    inteiro para exame, porque é justamente o que ninguém consegue explicar sem
    reabrir.
  */
  const outra = leitura.linhas.find((l) => l.tipoDeFrota !== so)?.tipoDeFrota;
  if (linhas.length === 0 && outra) {
    throw new Error(
      `Este é o 03.08.18 ${NOME_DA_FROTA[so]}, e o arquivo não tem nenhuma linha dessa frota: ` +
        `o que ele traz é a frota ${NOME_DA_FROTA[outra]}. Envie-o na casinha do ` +
        `03.08.18 ${NOME_DA_FROTA[outra]}.`,
    );
  }

  /*
    A recusa acompanha a frota da linha recusada: repetir na FF o que a Van
    recusou faria cada envio responder por linhas que ele não gravou. A linha
    que não declara frota nenhuma é a exceção, e vai para as duas — ela pode ser
    de qualquer uma, e omiti-la das duas seria sumir com ela.
  */
  return {
    linhas,
    recusas: leitura.recusas
      .filter((r) => r.frota === so || r.frota === null)
      .map(({ frota: _, ...r }) => r),
  };
}

/** Uma recusa que ainda lembra de que frota era a linha — ver `lerDisponibilidade`. */
type RecusaDeFrota = Recusa & { frota: TipoDeFrotaContratada | null };

/** O 03.08.18 em planilha: as duas abas, cada linha marcada com a frota da sua. */
function lerAbas(
  arquivo: Buffer | ArrayBuffer,
  presentes: Set<string>,
): { linhas: DiaDeDisponibilidade[]; recusas: RecusaDeFrota[] } {
  const linhas: DiaDeDisponibilidade[] = [];
  const recusas: RecusaDeFrota[] = [];
  let lidas = 0;

  for (const { nome, tipo } of ABAS) {
    if (!presentes.has(nome)) continue;
    const planilha = lerAba(arquivo, { aba: nome, exigidas: COLUNAS_EXIGIDAS });
    lidas += 1;
    const daAba: Recusa[] = [];
    for (const bruta of planilha.linhas) {
      const lida = lerLinha(bruta, nome, tipo, daAba);
      if (lida) linhas.push(lida);
    }
    recusas.push(...daAba.map((r) => ({ ...r, frota: tipo })));
  }

  if (lidas === 0) {
    throw new Error(
      `O arquivo não tem nenhuma das abas do relatório de disponibilidade (${ABAS.map((a) => a.nome).join(", ")}). ` +
        `Encontradas: ${[...presentes].join(", ") || "nenhuma"}.`,
    );
  }

  return { linhas, recusas };
}

/** O 03.08.18 exportado em texto: uma tabela só, com a frota dentro dela. */
function lerTabelaUnica(arquivo: Buffer | ArrayBuffer): {
  linhas: DiaDeDisponibilidade[];
  recusas: RecusaDeFrota[];
} {
  const planilha: PlanilhaLida = lerAba(arquivo, { exigidas: COLUNAS_EXIGIDAS });
  const linhas: DiaDeDisponibilidade[] = [];
  const recusas: RecusaDeFrota[] = [];

  if (!planilha.linhas.some((bruta) => tipoDeFrotaDeclarado(bruta) !== null)) {
    throw new Error(
      "O relatório de disponibilidade veio em texto, e nenhuma coluna dele diz se a linha é " +
        `da frota FF ou da Van (procuradas: ${COLUNAS_DE_TIPO_DE_FROTA.join(", ")}). ` +
        "As duas descontam coisas diferentes, e escolher uma delas seria inventar o desconto — " +
        "envie o .xlsx, que traz as duas abas nomeadas.",
    );
  }

  for (const bruta of planilha.linhas) {
    const tipo = tipoDeFrotaDeclarado(bruta);
    if (!tipo) {
      recusas.push({
        linha: bruta.numero,
        motivo: "A linha não diz se é da frota FF ou da Van.",
        original: String(celula(bruta, COLUNAS_DE_TIPO_DE_FROTA[0]) ?? ""),
        frota: null,
      });
      continue;
    }
    const daLinha: Recusa[] = [];
    const lida = lerLinha(bruta, planilha.aba, tipo, daLinha);
    if (lida) linhas.push(lida);
    recusas.push(...daLinha.map((r) => ({ ...r, frota: tipo })));
  }

  return { linhas, recusas };
}

function lerLinha(
  bruta: LinhaDePlanilha,
  aba: string,
  tipoDeFrota: TipoDeFrotaContratada,
  recusas: Recusa[],
): DiaDeDisponibilidade | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };

  const dia = diaDeCelula(celula(bruta, "Data"));
  if (!dia) return recusar("A data do dia não é uma data válida.", celula(bruta, "Data"));

  const canal = lerCanal(celula(bruta, "Canal"));
  if (!canal) return recusar("O canal do dia não é Rota nem AS.", celula(bruta, "Canal"));

  const n = (coluna: string) => lerNumero(celula(bruta, coluna)) ?? 0;

  return {
    linha: bruta.numero,
    aba,
    tipoDeFrota,
    dia,
    canal,
    frotaTotal: n("Frota Total"),
    contratada: n("Contratada"),
    realPrimeiraViagem: n("Real 1º Viagem"),
    realSegundaViagem: n("Real 2º Viagem"),
    gapTotal: n("Gap FF TT"),
    gapDaCia: n("Gap Cia."),
    gapDaTransportadora: {
      frotaCancelada: n("Gap TP Frota Canc."),
      outrosCancelados: n("Gap TP Outros Canc."),
      frotaNaoCancelada: n("Gap TP Frota N.Canc."),
      outrosNaoCancelados: n("Gap TP Outros N.Canc."),
    },
    descontos: {
      custoFixo: centavos(n("Desc.FF Custo Fixo")),
      equipe: centavos(n("Desc.FF Equipe")),
      indiretos: centavos(n("Desc.FF Indiretos")),
      fatorAjudante: centavos(n("Desconto FA")),
      total: centavos(n("Desconto Total")),
    },
    percentualDeUtilizacao: lerNumero(celula(bruta, "% Utilização Total")),
    percentualDeDisponibilidade: lerNumero(celula(bruta, "% Disponib.")),
  };
}

/* ---------------------------------------------------------------------------
   A REGRA DO DESCONTO DE DISPONIBILIDADE — mensal, aplicada no fecho do mês
   ------------------------------------------------------------------------ */

/**
 * O desconto de disponibilidade da **competência mensal**, somado do 03.08.18.
 *
 * **A regra, e a prova dela.** O desconto que o 03.08.18 mede dia a dia não é
 * cobrado quinzena a quinzena: ele é **acumulado no mês inteiro e aplicado uma
 * vez, no demonstrativo da 2ª quinzena**. Em julho/2026 — CDD Belém · Horizonte
 * — o encaixe é ao centavo em três linhas independentes:
 *
 * | 03.08.18, dias 1 a 31, `FF` + `Van` | | 03.08.20 da 2ª quinzena |
 * | --- | --- | --- |
 * | `custoFixo + equipe + indiretos` = 91.321,65 | = | `Desconto FF - Equipe Entrega` 91.321,65 |
 * | `fatorAjudante` = 320,85 | = | `Desconto FF - Fator Ajudante` 320,85 |
 * | `total` = **91.642,50** | = | total do bloco **91.642,50** |
 *
 * Diferença R$ 0,00 nas três.
 *
 * **Por que isto ficou dois documentos em aberto.** Todo mundo — este pacote
 * inclusive — comparou *quinzena contra quinzena*: o 03.08.18 da 2ª soma
 * R$ 29.075,62 contra os R$ 91.642,50 do bloco, e a razão entre os dois é
 * 3,152. Era exatamente esse "315,2%" que `docs/MAPA-ROTA.md` registrava como
 * inexplicado. Ele não é discrepância: é a razão entre o mês e um pedaço dele.
 *
 * **E é isto que explica a 1ª quinzena.** O 03.08.20 da 1ª quinzena não traz
 * bloco `DESCONTO DISPONIBILIDADE` nenhum — não porque falte arquivo, mas
 * porque naquele momento **o desconto ainda não foi aplicado**. A 1ª quinzena
 * vale R$ 0,00 de disponibilidade *por regra*, e o acumulado parcial do
 * 03.08.18 até o dia 15 é informação, não abatimento.
 *
 * **O que o 03.08.20 agrupa e o 03.08.18 abre.** O demonstrativo tem quatro
 * linhas no bloco e usa só duas: ele soma custo fixo, equipe e indiretos na
 * linha da equipe — porque os três são subtraídos da mesma VBZ 02 — e mantém o
 * fator ajudante à parte. O 03.08.18 abre os quatro por dia, por aba e por
 * responsabilidade, e é por isso que ele é a base e o demonstrativo é a
 * conferência: contestar um desconto exige saber de que dia e de que veículo
 * ele veio, e só o 03.08.18 diz.
 *
 * **O alcance da prova, dito.** Uma competência. O encaixe ao centavo em três
 * linhas independentes é forte demais para ser acaso, mas "mês inteiro,
 * aplicado na 2ª" só vira regra geral com uma segunda competência — e é por
 * isso que {@link DescontoDeDisponibilidadeDoMes} carrega os dias que entraram
 * na soma: a competência seguinte confere ou derruba sem ninguém reabrir nada.
 */
/**
 * Uma linha `(aba, dia)` que chegou mais de uma vez com **valores diferentes**.
 *
 * Não é o caso normal de repetição. Duas remessas do mesmo relatório trazem a
 * mesma linha com os mesmos números, e aí repetir é inofensivo: conta uma vez e
 * pronto. Isto aqui é o outro caso — duas linhas com a mesma identidade e
 * dinheiro diferente, que é ou duas emissões discordantes do 03.08.18, ou duas
 * filiais que o relatório abre e esta leitura não distingue.
 *
 * Nos dois casos escolher uma é sortear, e é isso que esta lista existe para
 * impedir: quem recebe um conflito não recebe um total.
 */
export interface LinhaDeDisponibilidadeEmConflito {
  /** `FF` ou `Van` — a aba do relatório. */
  aba: string;
  dia: Dia;
  /** Os `Desconto Total` discordantes, na ordem em que chegaram. */
  valores: number[];
}

export interface DescontoDeDisponibilidadeDoMes {
  /**
   * O `Desconto Total` somado de todos os dias do mês, `FF` + `Van`.
   *
   * `null` quando há conflito — ver {@link LinhaDeDisponibilidadeEmConflito}.
   * Zero é um total **medido**: o canal veio e não tem desconto. Nulo é a
   * recusa de somar o que não se sabe.
   */
  total: number | null;
  /** As quatro parcelas, como o 03.08.18 as abre. `null` com conflito. */
  parcelas: {
    custoFixo: number;
    equipe: number;
    indiretos: number;
    fatorAjudante: number;
  } | null;
  /**
   * `custoFixo + equipe + indiretos` — o que o 03.08.20 publica numa linha só.
   *
   * Existe como campo, e não como soma feita por quem confere, porque é a
   * forma em que o demonstrativo escreve o número: sem ela a conferência
   * contra o 03.08.20 seria uma soma refeita à mão a cada leitura.
   */
  agrupadoComoNoDemonstrativo: number | null;
  /**
   * Quantos dias distintos entraram — o denominador que torna o total
   * conferível. Continua contando com conflito: quais dias chegaram é fato,
   * ainda que quanto eles valem esteja em disputa.
   */
  dias: number;
  /** O primeiro e o último dia somados, para a tela dizer o alcance. */
  periodo: { de: Dia; ate: Dia } | null;
  /** Vazio no caso normal. Ver {@link LinhaDeDisponibilidadeEmConflito}. */
  conflitos: LinhaDeDisponibilidadeEmConflito[];
}

/**
 * Soma o desconto de disponibilidade do mês. Ver {@link DescontoDeDisponibilidadeDoMes}.
 *
 * Recebe os dias já lidos — de uma ou de várias remessas do 03.08.18 — e soma
 * só os do canal pedido. O corte por canal é o mesmo do resto do módulo: o
 * relatório traz Rota e AS na mesma lista, e o painel é de um canal só.
 *
 * **Dia repetido entra uma vez, e dia repetido *divergente* não entra.** A
 * chave é `(aba, dia)`, que é o grão em que o relatório escreve uma linha:
 * `FF` e `Van` do mesmo dia são dois descontos legítimos, e não uma repetição.
 * Quando a mesma chave chega duas vezes com os **mesmos** números, a segunda é
 * descartada em silêncio — é a mesma linha do mesmo relatório, e somá-la
 * dobraria o desconto. Quando chega com números **diferentes**, esta função
 * para de somar e devolve a chave em `conflitos`.
 *
 * **Por que a divergência não é resolvida aqui.** Ela costumava ser: quem
 * chegasse primeiro ganhava. Isso fazia o total do mês depender da ordem em que
 * o banco devolveu as linhas — e a ordem de um `SELECT` sem `ORDER BY` não é
 * uma regra de negócio. Escolher a maior, a menor ou a mais recente seria
 * inventar um critério que ninguém combinou. A resposta honesta é dizer qual
 * linha está em disputa e não entregar total nenhum, que é o que a tela precisa
 * para pedir a coisa certa a quem opera.
 *
 * **Esta é a rede, e não a defesa principal.** Depois que `disponibilidadeDoMes`
 * passou a ler cada competência no seu próprio período, a sobreposição entre as
 * duas remessas do mês deixou de existir na origem. O que sobra para esta
 * função pegar é o que atravessa aquele corte: duas emissões dentro da mesma
 * competência, ou um relatório com mais de uma filial.
 */
export function descontoDeDisponibilidadeDoMes(
  dias: DiaDeDisponibilidade[],
  canal: Canal,
): DescontoDeDisponibilidadeDoMes {
  /* As cinco parcelas que a soma lê — a identidade de dinheiro de uma linha. */
  const dinheiro = (d: DiaDeDisponibilidade) =>
    [
      d.descontos.custoFixo,
      d.descontos.equipe,
      d.descontos.indiretos,
      d.descontos.fatorAjudante,
      d.descontos.total,
    ].join("|");

  const vistos = new Map<string, DiaDeDisponibilidade>();
  const emConflito = new Map<string, LinhaDeDisponibilidadeEmConflito>();
  for (const d of dias) {
    if (d.canal !== canal) continue;
    /* Ver o bloco acima: `(aba, dia)` é o grão de uma linha do relatório. */
    const chave = `${d.aba} ${d.dia}`;
    const antes = vistos.get(chave);
    if (!antes) {
      vistos.set(chave, d);
      continue;
    }
    /* Repetição idêntica é a mesma linha duas vezes: passa em silêncio. */
    if (dinheiro(antes) === dinheiro(d)) continue;
    const registro = emConflito.get(chave) ?? {
      aba: d.aba,
      dia: d.dia,
      valores: [antes.descontos.total],
    };
    registro.valores.push(d.descontos.total);
    emConflito.set(chave, registro);
  }

  const escolhidos = [...vistos.values()];
  const ordenados = [...new Set(escolhidos.map((d) => d.dia))].sort();
  const periodo =
    ordenados.length === 0
      ? null
      : { de: ordenados[0]!, ate: ordenados[ordenados.length - 1]! };

  /*
    Com conflito não há soma. Os dias e o período ficam porque continuam
    verdadeiros — quais dias chegaram é fato, quanto eles valem é o que está em
    disputa —, e é com eles que a tela consegue dizer *onde* está a disputa.
  */
  if (emConflito.size > 0) {
    return {
      total: null,
      parcelas: null,
      agrupadoComoNoDemonstrativo: null,
      dias: ordenados.length,
      periodo,
      conflitos: [...emConflito.values()].sort((a, b) =>
        a.dia === b.dia ? a.aba.localeCompare(b.aba) : a.dia.localeCompare(b.dia),
      ),
    };
  }

  const parcelas = { custoFixo: 0, equipe: 0, indiretos: 0, fatorAjudante: 0 };
  let total = 0;
  for (const d of escolhidos) {
    parcelas.custoFixo += d.descontos.custoFixo;
    parcelas.equipe += d.descontos.equipe;
    parcelas.indiretos += d.descontos.indiretos;
    parcelas.fatorAjudante += d.descontos.fatorAjudante;
    total += d.descontos.total;
  }

  return {
    total: centavos(total),
    parcelas: {
      custoFixo: centavos(parcelas.custoFixo),
      equipe: centavos(parcelas.equipe),
      indiretos: centavos(parcelas.indiretos),
      fatorAjudante: centavos(parcelas.fatorAjudante),
    },
    agrupadoComoNoDemonstrativo: centavos(
      parcelas.custoFixo + parcelas.equipe + parcelas.indiretos,
    ),
    dias: ordenados.length,
    periodo,
    conflitos: [],
  };
}
