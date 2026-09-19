/**
 * A RECONCILIAÇÃO DO FINAME — uma escada só, do saldo da base ao da comparada.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este arquivo conserta
 * ---------------------------------------------------------------------------
 * A tela publicava dois números de dinheiro a um palmo um do outro e não
 * escrevia a conta que os liga:
 *
 * - o cartão **Impacto financeiro**, que soma as rubricas *deste* módulo nos
 *   veículos presentes nas duas vigências (`impactoPorPeriodicidade`);
 * - o painel **Evolução entre as duas vigências**, que soma a **parcela
 *   FINAME inteira** do acervo, frota que entrou e frota que saiu incluídas
 *   (`evolucaoPorTipo`).
 *
 * No par 2ª de junho → 1ª de setembro de 2026 o primeiro dizia −R$ 17.171,54 e
 * o segundo, +R$ 90.844,71 na carreta e +R$ 23.548,67 no cavalo. Os dois
 * estavam certos, e a tela só tinha uma **observação** dizendo que as bases
 * eram diferentes. Observação não é reconciliação: quem confere o mês precisa
 * sair do número do topo e chegar ao de baixo somando linhas que ele consegue
 * abrir.
 *
 * ---------------------------------------------------------------------------
 * As quatro regras que a escada obedece
 * ---------------------------------------------------------------------------
 * **Uma taxonomia só.** Os degraus daqui ({@link ROTULO_DO_DEGRAU}) são os
 * mesmos nomes que o painel da evolução escreve nos chips. Dois vocabulários
 * para o mesmo dinheiro foi o que produziu a pergunta.
 *
 * **Um sinal só.** Positivo é o que **aumenta** o custo da vigência comparada.
 * A saída de frota é negativa — e escrita negativa —, em vez de positiva com um
 * "−" ao lado: quem soma a coluna de cima para baixo chega ao saldo final sem
 * trocar sinal no meio.
 *
 * **Nenhum valor sem destino.** Todo real que separa um degrau do seguinte tem
 * uma linha com nome. Inclusive o que não se explica: {@link
 * ChaveDoDegrau} tem `NAO_EXPLICADO`, que é zero em todo o acervo de hoje e
 * existe para nunca haver um resíduo mudo. A escada **fecha por construção** —
 * ela não é conferida depois, ela é fechada pela última linha.
 *
 * **Periodicidades não se somam.** Cada balde do impacto vira uma escada
 * própria ({@link ReconciliacaoPorPeriodicidade}). Só o balde da parcela tem
 * saldo de frota, porque é a parcela que forma o total das duas pontas; os
 * outros (a aquisição, por exemplo) mostram o que se moveu e para onde foi, e
 * dizem por extenso que não há saldo a reconciliar ali.
 *
 * ---------------------------------------------------------------------------
 * Por que ela não calcula um terceiro impacto
 * ---------------------------------------------------------------------------
 * O degrau `ALTERADO_COMPARADOS` **é** `impactoPorPeriodicidade` — a mesma
 * função, chamada aqui, não uma soma paralela. O degrau da frota **é**
 * `evolucaoPorTipo`, pela mesma razão. Se a escada tivesse régua própria, ela
 * seria a terceira leitura a discordar das outras duas, que é exatamente o
 * problema que ela existe para resolver.
 */

import {
  VARIAVEIS_DE_DETALHE,
  VARIAVEIS_DE_FINAME,
  cobertasPorParcelasEm,
  evolucaoPorTipo,
  impactoPorPeriodicidade,
  parcelaPorVeiculo,
  variavelDoCodigo,
  type LinhaDeFiname,
  type ValorDaPonta,
} from "./finame";

/** O balde de quem o motor não declarou periodicidade. O mesmo nome do impacto. */
const SEM_PERIODICIDADE = "SEM_PERIODICIDADE";

/** A chave da variável que forma o saldo das duas pontas. */
const PARCELA = "parcela";

/**
 * Os degraus da escada, na ordem em que ela é lida.
 *
 * `SALDO_BASE` e `SALDO_COMPARADA` são **níveis** — o total da parcela numa
 * ponta. Os demais são **movimentos**: somados ao nível de cima, produzem o de
 * baixo. `FROTA_EXISTENTE` é um subtotal: ele não soma nada novo, ele fecha os
 * três movimentos de cima num número só, que é o que o painel da evolução
 * chama de "Frota existente".
 */
export type ChaveDoDegrau =
  | "SALDO_BASE"
  | "ALTERADO_COMPARADOS"
  | "RECLASSIFICADO"
  | "FORA_DA_PARCELA"
  | "NAO_EXPLICADO"
  | "FROTA_EXISTENTE"
  | "ENTRADAS"
  | "SAIDAS"
  | "SALDO_COMPARADA";

/** O nome de cada degrau — a taxonomia única, lida também pelo painel. */
export const ROTULO_DO_DEGRAU: Readonly<Record<ChaveDoDegrau, string>> = {
  SALDO_BASE: "Saldo na vigência base",
  ALTERADO_COMPARADOS: "Alterações em veículos comparados",
  RECLASSIFICADO: "Reclassificado para outro módulo",
  FORA_DA_PARCELA: "Movimento sem efeito na parcela",
  NAO_EXPLICADO: "Diferença não explicada",
  FROTA_EXISTENTE: "Frota existente",
  ENTRADAS: "Entradas de frota",
  SAIDAS: "Saídas de frota",
  SALDO_COMPARADA: "Saldo na vigência comparada",
};

/** O que cada degrau promete — a frase do ⓘ, escrita uma vez. */
export const EXPLICACAO_DO_DEGRAU: Readonly<Record<ChaveDoDegrau, string>> = {
  SALDO_BASE:
    "A soma da parcela FINAME de todos os veículos da vigência base — inclusive " +
    "os que não mudaram.",
  ALTERADO_COMPARADOS:
    "O que este módulo soma nos veículos presentes nas duas vigências: é " +
    "exatamente o cartão Impacto financeiro, no mesmo balde de periodicidade.",
  RECLASSIFICADO:
    "O que a parcela moveu e virou rubrica de outro módulo — lucro fixo do " +
    "cavalo quitado, aluguel do implemento. Sai daqui e é somado lá.",
  FORA_DA_PARCELA:
    "Rubricas que este módulo somou e que não mexeram no total da parcela — " +
    "partes que se compensam dentro da mesma placa. Entram no cartão e não " +
    "aparecem no saldo.",
  NAO_EXPLICADO:
    "O que sobra entre o cartão e o saldo depois das linhas acima. Tem de ser " +
    "R$ 0,00: qualquer valor aqui é defeito de cálculo, não diferença de base.",
  FROTA_EXISTENTE:
    "O efeito, no total da parcela, dos veículos que estão nas duas vigências. " +
    "É a única das três parcelas da evolução que a coluna Diferença da tabela mostra.",
  ENTRADAS: "A parcela dos veículos que só a vigência comparada tem.",
  SAIDAS:
    "A parcela dos veículos que só a vigência base tem — dinheiro que deixou o total.",
  SALDO_COMPARADA:
    "A soma da parcela FINAME de todos os veículos da vigência comparada.",
};

/** Uma linha da abertura de um degrau: a placa, a rubrica e as duas pontas. */
export interface ItemDoDegrau {
  placa: string | null;
  entityType: string;
  /** A chave da variável — `parcela`, `juros`… Em branco na entrada e na saída. */
  variavel: string;
  rubrica: string;
  /** O valor na vigência base. Nulo quando aquela ponta não tinha o veículo. */
  base: number | null;
  comparada: number | null;
  /** A contribuição **assinada** deste item ao degrau. Sempre soma ao valor dele. */
  valor: number;
  /** Para onde o dinheiro foi, quando ele saiu deste módulo. */
  nota: string | null;
}

export interface DegrauDaReconciliacao {
  chave: ChaveDoDegrau;
  rotulo: string;
  explicacao: string;
  /** `NIVEL` é um saldo; `MOVIMENTO` soma ao de cima; `SUBTOTAL` fecha os de cima. */
  tipo: "NIVEL" | "MOVIMENTO" | "SUBTOTAL";
  /** Positivo aumenta o custo da vigência comparada. */
  valor: number;
  /** Quantos veículos sustentam o degrau. */
  veiculos: number;
  itens: ItemDoDegrau[];
}

export interface ReconciliacaoPorPeriodicidade {
  /** `MENSAL`, `PONTUAL`, `SEM_PERIODICIDADE` — nunca dois somados. */
  periodicidade: string;
  /**
   * Se este balde tem saldo de frota a reconciliar.
   *
   * Só o balde da parcela tem: é ela que forma o total das duas pontas. Num
   * balde sem saldo a escada mostra o que se moveu e para onde foi, e diz que
   * não há total de frota nesta periodicidade — em vez de inventar um.
   */
  temSaldo: boolean;
  degraus: DegrauDaReconciliacao[];
  /**
   * O que sobra depois de todos os degraus. Zero por construção — o degrau
   * `NAO_EXPLICADO` o absorve —, e publicado assim mesmo para a tela poder
   * afirmar que fecha em vez de pedir confiança.
   */
  residuo: number;
  fecha: boolean;
  /**
   * Alterações deste balde que não são dinheiro (data, prazo, taxa) e as que o
   * motor não soube precificar. Contadas, nunca somadas.
   */
  semEfeitoFinanceiro: number;
  naoPrecificadas: number;
}

export interface ReconciliacaoDeFiname {
  periodicidades: ReconciliacaoPorPeriodicidade[];
}

const r2 = (n: number) => Number(n.toFixed(2));
const chaveDo = (l: { entityLabel: string | null; entityType: string }) =>
  `${l.entityLabel}\u001f${l.entityType}`;

const CATALOGO = [...VARIAVEIS_DE_FINAME, ...VARIAVEIS_DE_DETALHE];

/** O rótulo de uma variável, lido do catálogo. Nunca redigitado. */
function rotuloDaVariavel(chave: string): string {
  return CATALOGO.find((v) => v.chave === chave)?.rotulo ?? chave;
}

/**
 * Para onde o dinheiro de uma rubrica recusada vai — em três palavras.
 *
 * A célula da tabela recebe isto, e não `foraDaSoma`: aquele é um parágrafo, e
 * um parágrafo dentro de uma coluna de tabela empurra as outras quatro para
 * fora da tela. Quem quer o porquê inteiro tem o ⓘ da variável.
 */
function destinoDaRubrica(chave: string): string {
  const somadaPor = CATALOGO.find((v) => v.chave === chave)?.somadaPor;
  return somadaPor
    ? `Somado pela ${somadaPor}`
    : "Fora do custo deste módulo — nenhum outro o soma";
}

/** As partes declaradas da parcela — juros, amortização, aluguel, lucro fixo. */
const PARTES_DA_PARCELA: readonly string[] =
  VARIAVEIS_DE_FINAME.find((v) => v.chave === PARCELA)?.parcelas ?? [];

/**
 * A escada de um par, balde a balde.
 *
 * Recebe as duas coisas que a tela já tinha separadas: as linhas do motor (de
 * onde sai o impacto) e a leitura das duas vigências (de onde sai o saldo). É
 * a primeira função do módulo que vê as duas ao mesmo tempo — e é só por isso
 * que ela consegue escrever a conta que liga os dois blocos.
 */
export function reconciliarFiname(
  linhas: readonly LinhaDeFiname[],
  valores: readonly ValorDaPonta[],
): ReconciliacaoDeFiname {
  const impacto = impactoPorPeriodicidade(linhas);
  const evolucao = evolucaoPorTipo(valores);
  const cobertas = cobertasPorParcelasEm(linhas);
  const comParcelaCoberta = new Set(
    [...cobertas].map((c) => c.split("\u001f").slice(0, 2).join("\u001f")),
  );

  /*
    O balde da parcela — o único que tem saldo.

    Sai das linhas de parcela que se moveram, e não de uma constante "MENSAL":
    a periodicidade é decisão da curadoria, e fixá-la aqui faria esta escada
    publicar "por mensal" no dia em que a fonte entregasse a parcela com outra.
    Sem nenhuma parcela alterada, o balde é `MENSAL` — a periodicidade que o
    acervo declara para a coluna — e nada além do saldo entra nele.
  */
  const baldeDaParcela =
    linhas.find((l) => l.variavel === PARCELA && l.estado === "ALTERADO")
      ?.impactoPeriodicidade ?? "MENSAL";

  const baldes = new Set<string>([
    baldeDaParcela,
    ...Object.keys(impacto.porPeriodicidade),
    ...linhas
      .filter((l) => l.estado === "ALTERADO" && (l.foraDaSoma || l.medida === "DINHEIRO"))
      .map((l) => l.impactoPeriodicidade ?? SEM_PERIODICIDADE),
  ]);

  const periodicidades = [...baldes]
    .sort((a, b) => (a === baldeDaParcela ? -1 : b === baldeDaParcela ? 1 : a.localeCompare(b)))
    .map((balde) =>
      balde === baldeDaParcela
        ? escadaComSaldo(balde, linhas, valores, evolucao, impacto, comParcelaCoberta)
        : escadaSemSaldo(balde, linhas, impacto),
    );

  return { periodicidades };
}

/** As linhas que este módulo somou, no balde — o que o cartão publica. */
function somadasNoBalde(
  linhas: readonly LinhaDeFiname[],
  balde: string,
  cobertas: ReadonlySet<string>,
): LinhaDeFiname[] {
  return linhas.filter(
    (l) =>
      l.estado === "ALTERADO" &&
      !l.foraDaSoma &&
      l.impactoCalculado &&
      l.impactoAmount !== null &&
      (l.impactoPeriodicidade ?? SEM_PERIODICIDADE) === balde &&
      !cobertas.has(`${l.entityLabel}\u001f${l.entityType}\u001f${l.variavel}`),
  );
}

function escadaComSaldo(
  balde: string,
  linhas: readonly LinhaDeFiname[],
  valores: readonly ValorDaPonta[],
  evolucao: ReturnType<typeof evolucaoPorTipo>,
  impacto: ReturnType<typeof impactoPorPeriodicidade>,
  comParcelaCoberta: ReadonlySet<string>,
): ReconciliacaoPorPeriodicidade {
  const cobertas = cobertasPorParcelasEm(linhas);
  const somadas = somadasNoBalde(linhas, balde, cobertas);

  const saldoBase = r2(evolucao.reduce((s, e) => s + e.base, 0));
  const saldoComparada = r2(evolucao.reduce((s, e) => s + e.comparada, 0));
  const frotaExistente = r2(evolucao.reduce((s, e) => s + e.alterados, 0));
  const entradas = r2(evolucao.reduce((s, e) => s + e.entradas, 0));
  /* Negativa, porque é o que o dinheiro faz: sai do total. O painel escrevia
     positivo com um "−" ao lado, e era esse o sinal que mudava entre os dois
     blocos. */
  const saidas = r2(-evolucao.reduce((s, e) => s + e.saidas, 0));

  const doCartao = r2(impacto.porPeriodicidade[balde] ?? 0);
  const reclassificado = r2(impacto.porOutroModulo[balde] ?? 0);

  /*
    O que o cartão somou e que **não** mexe no total da parcela.

    Duas famílias caem aqui, e as duas são invisíveis no saldo: uma rubrica que
    não é a parcela nem parte dela (nenhuma no catálogo de hoje), e uma parte
    que se moveu numa placa em que a parcela **não** se moveu — amortização
    para cima e juros para baixo, no mesmo valor, é a parcela intacta com duas
    linhas alteradas embaixo. Sem este degrau esse dinheiro entraria no cartão
    e sumiria da escada, que é o resíduo mudo que este arquivo existe para
    impedir.
  */
  const foraDaParcela = somadas.filter(
    (l) =>
      l.variavel !== PARCELA &&
      !(PARTES_DA_PARCELA.includes(l.variavel) && comParcelaCoberta.has(chaveDo(l))),
  );
  const valorForaDaParcela = r2(-foraDaParcela.reduce((s, l) => s + (l.impactoAmount ?? 0), 0));

  const naoExplicado = r2(
    frotaExistente - (doCartao + reclassificado + valorForaDaParcela),
  );

  const itensDoCartao = somadas
    .filter((l) => !foraDaParcela.includes(l))
    .map((l) => itemDaLinha(l, l.impactoAmount ?? 0, null));

  const degraus: DegrauDaReconciliacao[] = [
    degrau("SALDO_BASE", "NIVEL", saldoBase, contarVeiculos(valores, "BASE"), itensDaPonta(valores, "BASE")),
    degrau("ALTERADO_COMPARADOS", "MOVIMENTO", doCartao, veiculosDe(itensDoCartao), itensDoCartao),
    degrau(
      "RECLASSIFICADO",
      "MOVIMENTO",
      reclassificado,
      new Set(
        linhas.filter((l) => l.foraDaSoma && l.estado === "ALTERADO").map(chaveDo),
      ).size,
      itensDoReclassificado(linhas, balde, comParcelaCoberta, reclassificado),
    ),
    degrau(
      "FORA_DA_PARCELA",
      "MOVIMENTO",
      valorForaDaParcela,
      veiculosDe(foraDaParcela.map((l) => itemDaLinha(l, 0, null))),
      foraDaParcela.map((l) =>
        itemDaLinha(
          l,
          -(l.impactoAmount ?? 0),
          "Somado no cartão; sem efeito no total da parcela.",
        ),
      ),
    ),
    degrau("NAO_EXPLICADO", "MOVIMENTO", naoExplicado, 0, []),
    degrau(
      "FROTA_EXISTENTE",
      "SUBTOTAL",
      frotaExistente,
      evolucao.reduce((s, e) => s + e.veiculosAlterados, 0),
      itensDaParcelaAlterada(valores),
    ),
    degrau(
      "ENTRADAS",
      "MOVIMENTO",
      entradas,
      evolucao.reduce((s, e) => s + e.veiculosEntradas, 0),
      itensDeFrota(valores, "ENTRADA"),
    ),
    degrau(
      "SAIDAS",
      "MOVIMENTO",
      saidas,
      evolucao.reduce((s, e) => s + e.veiculosSaidas, 0),
      itensDeFrota(valores, "SAIDA"),
    ),
    degrau(
      "SALDO_COMPARADA",
      "NIVEL",
      saldoComparada,
      contarVeiculos(valores, "COMPARADA"),
      itensDaPonta(valores, "COMPARADA"),
    ),
  ];

  const residuo = r2(saldoBase + frotaExistente + entradas + saidas - saldoComparada);

  return {
    periodicidade: balde,
    temSaldo: true,
    degraus,
    residuo,
    fecha: Math.abs(residuo) < 0.01 && Math.abs(naoExplicado) < 0.01,
    ...contagensSemDinheiro(linhas, balde),
  };
}

/**
 * Um balde sem saldo de frota — a aquisição, tipicamente.
 *
 * Não há total de parcela nesta periodicidade, e por isso não há saldo inicial
 * nem final: o que a escada mostra é o que se moveu e para onde foi. Inventar
 * um saldo aqui seria anualizar por conta própria o que o módulo se recusa a
 * anualizar no cartão.
 */
function escadaSemSaldo(
  balde: string,
  linhas: readonly LinhaDeFiname[],
  impacto: ReturnType<typeof impactoPorPeriodicidade>,
): ReconciliacaoPorPeriodicidade {
  const cobertas = cobertasPorParcelasEm(linhas);
  const somadas = somadasNoBalde(linhas, balde, cobertas);
  const doCartao = r2(impacto.porPeriodicidade[balde] ?? 0);
  const excluidas = linhas.filter(
    (l) =>
      l.estado === "ALTERADO" &&
      l.foraDaSoma &&
      (l.impactoPeriodicidade ?? SEM_PERIODICIDADE) === balde,
  );

  const itensDoCartao = somadas.map((l) => itemDaLinha(l, l.impactoAmount ?? 0, null));
  const degraus: DegrauDaReconciliacao[] = [
    degrau("ALTERADO_COMPARADOS", "MOVIMENTO", doCartao, veiculosDe(itensDoCartao), itensDoCartao),
    degrau(
      "RECLASSIFICADO",
      "MOVIMENTO",
      r2(excluidas.reduce((s, l) => s + (l.diferenca ?? 0), 0)),
      new Set(excluidas.map(chaveDo)).size,
        excluidas.map((l) => itemDaLinha(l, l.diferenca ?? 0, destinoDaRubrica(l.variavel))),
    ),
  ];

  return {
    periodicidade: balde,
    temSaldo: false,
    degraus,
    residuo: 0,
    fecha: true,
    ...contagensSemDinheiro(linhas, balde),
  };
}

/** As alterações do balde que não viram dinheiro — contadas, nunca somadas. */
function contagensSemDinheiro(
  linhas: readonly LinhaDeFiname[],
  balde: string,
): { semEfeitoFinanceiro: number; naoPrecificadas: number } {
  let semEfeitoFinanceiro = 0;
  let naoPrecificadas = 0;
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.foraDaSoma) continue;
    if (l.impactoCalculado && l.impactoAmount !== null) continue;
    /* Quem não tem periodicidade cai no balde do impacto do par: uma data não
       declara periodicidade, e contá-la fora de todo balde a faria sumir. */
    const baldeDaLinha = l.impactoPeriodicidade ?? balde;
    if (baldeDaLinha !== balde) continue;
    if (l.medida === "DINHEIRO") naoPrecificadas++;
    else semEfeitoFinanceiro++;
  }
  return { semEfeitoFinanceiro, naoPrecificadas };
}

function degrau(
  chave: ChaveDoDegrau,
  tipo: DegrauDaReconciliacao["tipo"],
  valor: number,
  veiculos: number,
  itens: ItemDoDegrau[],
): DegrauDaReconciliacao {
  return {
    chave,
    rotulo: ROTULO_DO_DEGRAU[chave],
    explicacao: EXPLICACAO_DO_DEGRAU[chave],
    tipo,
    valor: r2(valor),
    veiculos,
    itens,
  };
}

function itemDaLinha(l: LinhaDeFiname, valor: number, nota: string | null): ItemDoDegrau {
  const comoNumero = (t: string | null) => {
    if (t === null) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  return {
    placa: l.entityLabel,
    entityType: l.entityType,
    variavel: l.variavel,
    rubrica: l.rotuloDaVariavel,
    base: comoNumero(l.base),
    comparada: comoNumero(l.comparada),
    valor: r2(valor),
    nota,
  };
}

/**
 * A abertura do reclassificado: as linhas que outro módulo soma, e o que falta.
 *
 * O valor do degrau é **resíduo medido** (`porOutroModulo`), não a soma das
 * linhas de outro módulo — ver `residuoDoVeiculo`. Quando as duas coincidem, e
 * no acervo de hoje elas coincidem, a abertura é a lista das linhas. Quando não
 * coincidem, entra um item nomeando a diferença: é o que impede a abertura de
 * somar diferente do degrau que ela abre.
 */
function itensDoReclassificado(
  linhas: readonly LinhaDeFiname[],
  balde: string,
  comParcelaCoberta: ReadonlySet<string>,
  valorDoDegrau: number,
): ItemDoDegrau[] {
  const doOutroModulo = linhas.filter(
    (l) =>
      l.estado === "ALTERADO" &&
      l.foraDaSoma &&
      PARTES_DA_PARCELA.includes(l.variavel) &&
      comParcelaCoberta.has(chaveDo(l)) &&
      (l.impactoPeriodicidade ?? SEM_PERIODICIDADE) === balde,
  );
  const itens = doOutroModulo.map((l) =>
    itemDaLinha(l, l.diferenca ?? 0, destinoDaRubrica(l.variavel)),
  );
  const somaDosItens = r2(itens.reduce((s, i) => s + i.valor, 0));
  const diferenca = r2(valorDoDegrau - somaDosItens);
  if (Math.abs(diferenca) >= 0.01) {
    itens.push({
      placa: null,
      entityType: "",
      variavel: "",
      rubrica: "Diferença de composição",
      base: null,
      comparada: null,
      valor: diferenca,
      nota:
        "A parcela moveu mais do que as partes declaradas explicam. Medido, " +
        "não deduzido — ver a composição da placa.",
    });
  }
  return itens;
}

const veiculosDe = (itens: readonly ItemDoDegrau[]) =>
  new Set(itens.map((i) => `${i.placa}\u001f${i.entityType}`)).size;

function contarVeiculos(valores: readonly ValorDaPonta[], ponta: "BASE" | "COMPARADA"): number {
  return parcelaPorVeiculo(valores).filter((v) =>
    ponta === "BASE" ? v.base !== undefined : v.comparada !== undefined,
  ).length;
}

/** A abertura de um saldo: a parcela de cada veículo daquela ponta. */
function itensDaPonta(
  valores: readonly ValorDaPonta[],
  ponta: "BASE" | "COMPARADA",
): ItemDoDegrau[] {
  return parcelaPorVeiculo(valores)
    .filter((v) => (ponta === "BASE" ? v.base !== undefined : v.comparada !== undefined))
    .map((v) => ({
      placa: v.label,
      entityType: v.entityType,
      variavel: PARCELA,
      rubrica: rotuloDaVariavel(PARCELA),
      base: v.base ?? null,
      comparada: v.comparada ?? null,
      valor: r2((ponta === "BASE" ? v.base : v.comparada) ?? 0),
      nota: null,
    }));
}

/** A abertura do subtotal da frota existente: uma linha por placa que se moveu. */
function itensDaParcelaAlterada(valores: readonly ValorDaPonta[]): ItemDoDegrau[] {
  return parcelaPorVeiculo(valores)
    .filter((v) => v.base !== undefined && v.comparada !== undefined && v.base !== v.comparada)
    .map((v) => ({
      placa: v.label,
      entityType: v.entityType,
      variavel: PARCELA,
      rubrica: rotuloDaVariavel(PARCELA),
      base: v.base ?? null,
      comparada: v.comparada ?? null,
      valor: r2((v.comparada ?? 0) - (v.base ?? 0)),
      nota: null,
    }));
}

/** A abertura de entradas e saídas: a placa que só uma das pontas tem. */
function itensDeFrota(
  valores: readonly ValorDaPonta[],
  qual: "ENTRADA" | "SAIDA",
): ItemDoDegrau[] {
  return parcelaPorVeiculo(valores)
    .filter((v) =>
      qual === "ENTRADA"
        ? v.base === undefined && v.comparada !== undefined
        : v.comparada === undefined && v.base !== undefined,
    )
    .map((v) => ({
      placa: v.label,
      entityType: v.entityType,
      variavel: PARCELA,
      rubrica: rotuloDaVariavel(PARCELA),
      base: v.base ?? null,
      comparada: v.comparada ?? null,
      /* A saída entra negativa, como no degrau: é dinheiro que deixou o total. */
      valor: r2(qual === "ENTRADA" ? (v.comparada ?? 0) : -(v.base ?? 0)),
      nota: null,
    }));
}

/** O atributo de uma linha de valor, para quem precisa do rótulo da rubrica. */
export function rubricaDoCodigo(code: string): string | null {
  return variavelDoCodigo(code)?.rotulo ?? null;
}
