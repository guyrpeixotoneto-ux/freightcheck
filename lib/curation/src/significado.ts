/**
 * A autoridade semântica — o único lugar que traduz significado econômico em
 * campo técnico.
 *
 * ---------------------------------------------------------------------------
 * O que esta camada existe para desfazer
 * ---------------------------------------------------------------------------
 * A tela de curadoria pedia quatro respostas técnicas por coluna: unidade,
 * periodicidade, agregação e "entra em somas". São quatro perguntas que só quem
 * conhece o modelo de dados sabe responder, e três delas não são perguntas de
 * verdade — são consequências da primeira. Quem sabe que a coluna vale
 * `R$ 0,42 por quilômetro rodado` já disse, com isso, que a unidade é uma razão
 * monetária, que ela não tem periodicidade, que somá-la entre veículos não
 * produz grandeza nenhuma e que ela não é montante. Perguntar as três de novo
 * é pedir que a pessoa derive à mão o que o sistema deriva melhor — e abrir
 * quatro portas para a contradição entrar (`KM_L + SUM + is_monetary`, que a
 * auditoria de 16/08/2026 encontrou gravável).
 *
 * Aqui a direção se inverte: **a pessoa afirma o significado econômico, e o
 * sistema deriva o resto.**
 *
 * ---------------------------------------------------------------------------
 * Por que uma autoridade, e não um `if` na tela
 * ---------------------------------------------------------------------------
 * `unit`, `periodicity`, `aggregation` e `is_monetary` são lidos por seis
 * módulos — composição, comparação, impacto, cockpit, DRE e o assistente. Se a
 * tradução de "R$ por litro" para esses quatro campos morasse na tela, a API,
 * a comparação e o cálculo teriam cada um a sua versão dela, que é exatamente o
 * estado que `agregacao.ts` foi escrito para acabar (seis lugares, cinco
 * respostas). Este arquivo é a definição; ninguém mais decide.
 *
 * E ele é **puro**: nada aqui toca banco. O catálogo persistido mora em
 * `catalogo.ts`, e é ele que consulta esta função — nunca o contrário. Isso é o
 * que permite testar a derivação inteira sem Postgres, e é o que permite que a
 * migration grave o catálogo inicial sem duplicar a regra: um teste confere,
 * linha a linha, que os campos técnicos gravados são os que esta função deriva.
 *
 * ---------------------------------------------------------------------------
 * O que **não** é derivado, e por quê
 * ---------------------------------------------------------------------------
 * - **A categoria** (nó da taxonomia) continua explícita. Ela não é
 *   consequência da forma do valor: `R$ por litro` pode ser combustível ou
 *   ARLA, e nenhuma leitura do número diz qual. É a segunda pergunta da tela.
 * - **A periodicidade de um montante sem período declarado.** `R$ por veículo`
 *   é dinheiro, é somável na frota e **não diz** se é do mês ou do ano — e a
 *   gaveta em que ele cai muda o total da remuneração. Ver
 *   {@link periodoEmAberto}: é o único caso em que a tela ainda precisa de uma
 *   terceira resposta, e ela é feita em português, não em enum.
 * - **A justificativa humana.** Continua obrigatória, continua assinada, e
 *   nenhuma derivação a substitui: derivar campo técnico é aritmética, afirmar
 *   o que a coluna significa é um ato de alguém.
 */

/**
 * A forma econômica de um valor — as seis que este produto sabe representar.
 *
 * Não é uma taxonomia de conveniência: cada uma responde de um jeito diferente
 * à única pergunta que o motor financeiro faz de verdade, que é "isto se
 * acumula na frota?".
 */
export type Forma =
  /** Dinheiro que se acumula. R$ por mês, por ano, valor de aquisição. */
  | "MONTANTE"
  /** Razão monetária: R$ por litro, por km, por viagem. Preço, não montante. */
  | "TAXA"
  /** Percentual, alíquota, proporção. */
  | "PROPORCAO"
  /** Razão física entre duas grandezas: km por litro. */
  | "CONSUMO"
  /** Grandeza física ou contagem por ativo: litros, meses, km, quantidade. */
  | "GRANDEZA"
  /** Não é número de conta: ano de calendário, texto, identificação. */
  | "DESCRITOR";

/**
 * Um significado econômico, como o usuário o enuncia.
 *
 * `code` é a chave canônica, e ela é derivada de `forma` + `base` — nunca do
 * rótulo. É isso que faz "R$/litro", "R$ por litro" e "reais por litro" serem
 * o mesmo significado em vez de três cadastros que ninguém consegue reconciliar
 * depois. Ver {@link codigoDe}.
 */
export interface Significado {
  code: string;
  /** Como aparece na tela, na língua de quem opera. */
  label: string;
  forma: Forma;
  /**
   * O denominador econômico do valor, quando existe.
   *
   * Para MONTANTE é o período (`MES`, `ANO`, `AQUISICAO`) ou o ativo
   * (`VEICULO`, que deixa o período em aberto). Para TAXA é aquilo por unidade
   * do qual o preço é cotado (`LITRO`, `KM`, `VIAGEM`, `HORA`, `PALLET`…) — e
   * essa lista é deliberadamente aberta, porque é a operação da transportadora
   * que a define, não nós.
   */
  base: string | null;
}

/** A tradução para os campos que o banco e o motor financeiro conhecem. */
export interface SemanticaDerivada {
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  /** BRL quando há dinheiro envolvido — inclusive nas taxas. */
  currency: string | null;
  /** AMOUNT | RATE | RATIO | QUANTITY | DESCRIPTOR — o vocabulário do motor. */
  valueKind: string;
  /** O denominador, normalizado. `null` quando o valor não é uma razão. */
  denominator: string | null;
}

/**
 * O que a tela diz sobre um significado, em português.
 *
 * Mora junto da derivação de propósito: a frase e os campos precisam ser a
 * mesma decisão. Uma tela que escrevesse "não é somado entre veículos" ao lado
 * de um `aggregation` que diz outra coisa seria pior do que tela nenhuma.
 */
export interface LeituraDoSignificado {
  /** "É um preço por litro, em reais." */
  natureza: string;
  /** Como a frota lê este valor — a regra de agregação, dita por extenso. */
  agregacao: string;
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/**
 * O rótulo reduzido ao que ele significa para efeito de comparação.
 *
 * Sem acento, sem caixa, sem pontuação e sem espaço repetido. É o que faz
 * `combustivel` encontrar `Combustível` em vez de criar um segundo cadastro —
 * o requisito que, na prática, é o que separa um catálogo de uma lista de
 * digitações.
 *
 * `R$` sobrevive à normalização como `r$`: retirar o cifrão junto com a
 * pontuação faria "R$ por litro" e "por litro" colidirem, e as duas não são a
 * mesma coisa.
 */
export function normalizarRotulo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$%\/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Sinônimos e plurais das bases que a operação usa.
 *
 * Existe para que "R$ por litros" e "R$ por litro" sejam o mesmo significado.
 * A lista é de conveniência e não de fechamento: uma base que não esteja aqui
 * é aceita como foi escrita (com o plural simples desfeito), porque o
 * vocabulário da operação é dela.
 */
const BASES: Record<string, string> = {
  mes: "MES", meses: "MES", mensal: "MES", mensais: "MES",
  ano: "ANO", anos: "ANO", anual: "ANO", anuais: "ANO",
  litro: "LITRO", litros: "LITRO", l: "LITRO",
  km: "KM", quilometro: "KM", quilometros: "KM", quilometragem: "KM",
  viagem: "VIAGEM", viagens: "VIAGEM",
  hora: "HORA", horas: "HORA", h: "HORA",
  dia: "DIA", dias: "DIA",
  veiculo: "VEICULO", veiculos: "VEICULO", cavalo: "VEICULO", carreta: "VEICULO",
  equipamento: "VEICULO", ativo: "VEICULO", bem: "VEICULO", placa: "VEICULO",
  tonelada: "TONELADA", toneladas: "TONELADA", t: "TONELADA",
  pneu: "PNEU", pneus: "PNEU",
  eixo: "EIXO", eixos: "EIXO",
  pallet: "PALLET", pallets: "PALLET", palete: "PALLET", paletes: "PALLET",
  entrega: "ENTREGA", entregas: "ENTREGA",
  unidade: "UNIDADE", unidades: "UNIDADE",
};

/** A base como o catálogo a guarda. Desconhecida entra como foi escrita. */
function normalizarBase(texto: string): string {
  const n = normalizarRotulo(texto).replace(/\s+/g, "_");
  const conhecida = BASES[n];
  if (conhecida) return conhecida;
  // Plural simples desfeito só quando sobra palavra: `pallets` → `pallet`,
  // e nunca `s` → ``.
  const singular = n.length > 3 && n.endsWith("s") ? n.slice(0, -1) : n;
  return (BASES[singular] ?? singular).toUpperCase();
}

/**
 * A chave canônica de um significado.
 *
 * Deriva de forma e base, **não** do rótulo, e é isso que impede o catálogo de
 * ganhar `R$/litro` ao lado de `R$ por litro`. Duas digitações diferentes da
 * mesma economia produzem o mesmo código, e o cadastro recusa a segunda
 * dizendo qual é a primeira.
 */
export function codigoDe(forma: Forma, base: string | null): string {
  const prefixo = forma.toLowerCase();
  return base ? `${prefixo}_${base.toLowerCase()}` : prefixo;
}

// ---------------------------------------------------------------------------
// Derivação — o coração desta autoridade
// ---------------------------------------------------------------------------

/** As unidades de razão monetária nascem daqui, e só daqui. */
export function unidadeDeTaxa(base: string): string {
  // `BRL_KM` é o nome que este produto já usa para R$/km, e nove meses de
  // dados confirmados o carregam. Uma unidade nova para a mesma coisa faria a
  // comparação de vigências enxergar mudança de semântica onde não houve.
  return base === "KM" ? "BRL_KM" : `BRL_${base}`;
}

/**
 * A unidade de uma grandeza física, quando o modelo já tem uma para ela.
 *
 * Fora destas, `QTD` — que é o que "uma contagem de alguma coisa" sempre foi
 * neste schema.
 */
const UNIDADE_DE_GRANDEZA: Record<string, string> = {
  KM: "KM",
  LITRO: "LITROS",
  MES: "MESES",
};

/**
 * O significado econômico traduzido nos campos técnicos.
 *
 * Determinística, total e sem banco: a mesma entrada devolve sempre a mesma
 * saída, o que é o que permite a migration gravar o catálogo e um teste provar
 * que o que ela gravou é o que esta função diz.
 *
 * **A agregação sai daqui, e não de uma pergunta.** É o item 10 do pedido e é a
 * regra que este produto existe para não errar: `R$ 0,42/km` somado entre 100
 * cavalos daria `R$ 42/km`, um número sem referente. A taxa não é o montante —
 * ela vira montante quando multiplicada pela base (km remunerados), e é o
 * montante resultante, por veículo, que se acumula na frota. Por isso TAXA
 * deriva `NONE` e MONTANTE deriva `SUM`, e nenhuma tela tem voto nisso.
 */
export function derivarSemantica(significado: Significado): SemanticaDerivada {
  const { forma, base } = significado;

  switch (forma) {
    case "MONTANTE": {
      /*
        O período é o denominador do montante, e ele vem do próprio significado.
        `VEICULO` (e a ausência de base) é o caso honesto de "é dinheiro e não
        se sabe de que período" — ver `periodoEmAberto`.
      */
      const periodicity =
        base === "MES" ? "MENSAL" : base === "ANO" ? "ANUAL" : base === "AQUISICAO" ? "PONTUAL" : null;
      return {
        unit: "BRL",
        periodicity,
        aggregation: "SUM",
        isMonetary: true,
        currency: "BRL",
        valueKind: "AMOUNT",
        denominator: null,
      };
    }

    case "TAXA":
      return {
        unit: unidadeDeTaxa(base ?? "UNIDADE"),
        // Uma taxa não tem periodicidade: ela não se acumula com o tempo, ela
        // se aplica a uma quantidade. Declarar "mensal" aqui seria afirmar um
        // fluxo que o número não descreve.
        periodicity: null,
        aggregation: "NONE",
        // Falso, e não nulo: sabemos que não é montante. `is_monetary = true`
        // com unidade diferente de BRL é justamente uma das contradições que a
        // constraint 0023 recusa.
        isMonetary: false,
        currency: "BRL",
        valueKind: "RATE",
        denominator: base ?? "UNIDADE",
      };

    case "PROPORCAO":
      return {
        unit: "PERCENT",
        periodicity: null,
        aggregation: "NONE",
        isMonetary: false,
        currency: null,
        valueKind: "RATIO",
        denominator: base ?? null,
      };

    case "CONSUMO":
      return {
        unit: "KM_L",
        periodicity: null,
        aggregation: "NONE",
        isMonetary: false,
        currency: null,
        valueKind: "RATIO",
        denominator: "LITRO",
      };

    case "GRANDEZA":
      return {
        unit: (base && UNIDADE_DE_GRANDEZA[base]) ?? "QTD",
        periodicity: null,
        // A média descreve a frota; a soma de "meses de vida útil" de 62
        // cavalos não descreve nada.
        aggregation: "AVG",
        isMonetary: false,
        currency: null,
        valueKind: "QUANTITY",
        denominator: null,
      };

    case "DESCRITOR":
      return {
        unit: base === "ANO_CALENDARIO" ? "ANO" : null,
        periodicity: null,
        aggregation: "NONE",
        isMonetary: false,
        currency: null,
        valueKind: "DESCRIPTOR",
        denominator: null,
      };
  }
}

/**
 * O significado é dinheiro que se acumula mas não diz de que período?
 *
 * É o único buraco que o desenho novo **não** fecha sozinho, e ele é real:
 * `R$ por veículo` é montante, é somável na frota, e cai numa gaveta diferente
 * conforme seja do mês, do ano ou da aquisição — três totais diferentes na tela
 * de composição. Derivar um deles por conta própria seria inventar; recusar o
 * significado seria empurrar a pessoa a mentir num rótulo mais específico.
 *
 * Então a tela pergunta, uma vez, em português, e só neste caso. É a exceção
 * documentada ao "duas decisões", e ela é menor do que a regra anterior — em
 * que periodicidade era perguntada para **todas** as colunas.
 */
export function periodoEmAberto(significado: Significado): boolean {
  const derivada = derivarSemantica(significado);
  return derivada.isMonetary === true && derivada.periodicity === null;
}

/**
 * Os períodos que a tela oferece quando o significado deixa o período em
 * aberto — em linguagem de negócio, nunca no enum do banco.
 */
export const PERIODOS_EM_ABERTO: { periodicity: string; rotulo: string; ajuda: string }[] = [
  {
    periodicity: "MENSAL",
    rotulo: "Todo mês",
    ajuda: "O veículo recebe este valor a cada mês da vigência.",
  },
  {
    periodicity: "ANUAL",
    rotulo: "Uma vez por ano",
    ajuda: "É um valor anual. Não é dividido por doze — converter exigiria uma regra de rateio que ninguém confirmou.",
  },
  {
    periodicity: "PONTUAL",
    rotulo: "Uma única vez, na aquisição",
    ajuda: "Descreve quanto o ativo custou, e não quanto ele recebe. Fica fora do total mensal.",
  },
];

/**
 * O significado dito em português, para o bloco "Confirmado pela IA" e para a
 * confirmação de leitura antes de gravar.
 */
export function lerSignificado(significado: Significado): LeituraDoSignificado {
  const { forma, base } = significado;
  const porBase = base ? base.toLowerCase().replace(/_/g, " ") : "unidade";

  switch (forma) {
    case "MONTANTE": {
      const periodo =
        base === "MES"
          ? "a cada mês"
          : base === "ANO"
            ? "a cada ano"
            : base === "AQUISICAO"
              ? "uma única vez, na aquisição"
              : "em um período que ainda precisa ser dito";
      return {
        natureza: `Valor financeiro em reais, ${periodo}, por equipamento.`,
        agregacao:
          "Montantes por equipamento se somam para dar o total da frota — é esta a leitura que o FreightCheck usa.",
      };
    }
    case "TAXA":
      return {
        natureza: `Preço em reais por ${porBase}. É uma taxa, não um montante.`,
        agregacao:
          `Taxas não se somam entre equipamentos: somar R$/${porBase} de 100 veículos daria um número sem ` +
          `referente. Ela vira dinheiro quando multiplicada pela quantidade de ${porBase} do período — e é o ` +
          `montante resultante, por veículo, que se acumula na frota.`,
      };
    case "PROPORCAO":
      return {
        natureza: "Percentual — a alíquota de alguma coisa, e não a coisa.",
        agregacao:
          "Percentuais não se somam nem se tiram média entre equipamentos. O montante correspondente é outra coluna.",
      };
    case "CONSUMO":
      return {
        natureza: "Quilômetros por litro — o rendimento do equipamento.",
        agregacao:
          "O consumo da frota é Σkm ÷ Σlitros, e não a média dos consumos. Sem essas duas somas, não há leitura de frota.",
      };
    case "GRANDEZA":
      return {
        natureza: `Grandeza física por equipamento${base ? ` (em ${porBase})` : ""}.`,
        agregacao: "A média descreve a frota; a soma não descreveria nada.",
      };
    case "DESCRITOR":
      return {
        natureza: "Descreve o equipamento. Não é um número de conta.",
        agregacao: "Não entra em soma nem em média.",
      };
  }
}

// ---------------------------------------------------------------------------
// Interpretação do que a pessoa digitou
// ---------------------------------------------------------------------------

/** Prefixos que dizem "isto é dinheiro por alguma coisa". */
const DINHEIRO_POR =
  /^(?:r\$|reais|real|valor em reais|valor em r\$|preco em reais)\s*(?:\/|\s+por\s+|\s+p\/\s*)\s*(.+)$/;
/** A forma curta: `R$/litro`, `r$ /km`. */
const DINHEIRO_BARRA = /^(?:r\$|reais)\s*\/\s*(.+)$/;

/**
 * Ler um rótulo digitado e dizer que significado econômico ele enuncia.
 *
 * `null` quando não dá para dizer — e isso é uma resposta, não uma falha. Um
 * rótulo que a autoridade não sabe traduzir não pode ser cadastrado como
 * significado, porque cadastrá-lo criaria uma opção que não deriva campo
 * técnico nenhum: a pessoa escolheria, a tela habilitaria o botão, e o atributo
 * seria confirmado sem unidade, sem agregação e fora de qualquer soma. Um
 * cadastro que não sustenta o cálculo é pior do que a recusa, e a recusa vem
 * com a frase que ensina o formato ({@link COMO_ESCREVER}).
 *
 * A ordem das regras é a ordem em que elas não se atropelam: dinheiro-por-algo
 * é lido antes de tudo, senão "R$ por hora" cairia em "taxa" (percentual) pela
 * palavra `taxa` que nem está lá, e "R$ por mês" cairia em "meses" (grandeza).
 */
export function interpretarRotulo(rotulo: string): Significado | null {
  const texto = normalizarRotulo(rotulo);
  if (!texto) return null;

  const monta = (forma: Forma, base: string | null): Significado => ({
    code: codigoDe(forma, base),
    label: rotulo.trim().replace(/\s+/g, " "),
    forma,
    base,
  });

  const porAlgo = texto.match(DINHEIRO_POR) ?? texto.match(DINHEIRO_BARRA);
  if (porAlgo) {
    const base = normalizarBase(porAlgo[1]);
    if (base === "MES" || base === "ANO") return monta("MONTANTE", base);
    if (base === "VEICULO") return monta("MONTANTE", "VEICULO");
    return monta("TAXA", base);
  }

  if (/^(?:valor total|montante total|total em reais|total em r\$|valor de aquisicao|valor da nota|valor total em r\$|valor total em reais)\b/.test(texto)) {
    return monta("MONTANTE", "AQUISICAO");
  }
  if (/(?:^|\s)(?:percentual|porcentagem|aliquota|proporcao|percentagem)(?:\s|$)|%/.test(texto)) {
    return monta("PROPORCAO", null);
  }
  if (/(?:km|quilometros?)\s*(?:\/|\s+por\s+)\s*litros?|km\/l|^consumo\b|\bconsumo de combustivel\b/.test(texto)) {
    return monta("CONSUMO", null);
  }
  if (/^(?:quantidade|contagem|numero de|quantidade de)\b/.test(texto)) {
    return monta("GRANDEZA", "QTD");
  }
  if (/^(?:ano de calendario|ano do modelo|ano de fabricacao|ano modelo)\b/.test(texto)) {
    return monta("DESCRITOR", "ANO_CALENDARIO");
  }
  if (/^(?:texto|descricao|identificacao|codigo|placa|chassi)\b/.test(texto)) {
    return monta("DESCRITOR", null);
  }
  /*
    Grandeza física escrita sozinha — `litros`, `meses`, `quilometragem`. Fica
    por último porque qualquer uma destas palavras aparece dentro dos casos
    acima ("R$ por litro", "km por litro"), e lê-las antes tiraria daqueles a
    leitura certa.
  */
  const grandeza = normalizarBase(texto);
  if (UNIDADE_DE_GRANDEZA[grandeza] || grandeza === "QTD") {
    return monta("GRANDEZA", grandeza);
  }
  /*
    Palavras que anunciam grandeza sem dizer em quê. `QTD` é o que este schema
    sempre chamou de "uma contagem de alguma coisa", e é honesto: a unidade
    exata continua no nome da coluna e na definição, que é onde ela é lida.
  */
  if (/^(?:quilometragem|distancia|prazo|vida util|capacidade|peso|volume|contagem)\b/.test(texto)) {
    return monta("GRANDEZA", "QTD");
  }

  return null;
}

/**
 * A frase que a tela mostra quando não soube ler o rótulo.
 *
 * Ensina o formato em vez de reclamar dele. É a diferença entre um beco e uma
 * porta: quem digitou "por litro" tem de descobrir que falta o "R$".
 */
export const COMO_ESCREVER =
  'Não consegui entender o que esse valor representa. Escreva no formato do que ele mede — ' +
  '"R$ por litro", "R$ por km", "R$ por mês", "Valor total em R$", "Percentual" ou "Quantidade" — ' +
  "ou escolha uma das opções da lista.";

// ---------------------------------------------------------------------------
// O caminho de volta: dos campos técnicos para o significado
// ---------------------------------------------------------------------------

/**
 * O significado que corresponde a uma semântica já gravada.
 *
 * Existe por dois motivos, e os dois são sobre **não quebrar o que já está no
 * banco**:
 *
 * 1. Os 138 atributos deste export foram curados no vocabulário antigo. A tela
 *    nova precisa mostrá-los como significado, e não como quatro campos vazios,
 *    ou a mudança de UI apareceria para quem opera como perda de curadoria.
 * 2. `applyConfirmations` replica um registro histórico que fala em unidade e
 *    periodicidade. Ele continua funcionando, e agora também grava o
 *    significado correspondente — sem que uma linha daquele arquivo mude.
 *
 * `null` quando os campos não descrevem um significado que este catálogo
 * enuncie. É honesto: uma combinação que a autoridade não produz não deve ser
 * apresentada como se ela a tivesse produzido.
 */
export function significadoPara(tecnico: {
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
}): Significado | null {
  const { unit, periodicity, isMonetary } = tecnico;

  if (unit === "BRL" || (isMonetary === true && unit === null)) {
    const base =
      periodicity === "MENSAL"
        ? "MES"
        : periodicity === "ANUAL"
          ? "ANO"
          : periodicity === "PONTUAL"
            ? "AQUISICAO"
            : "VEICULO";
    return achar(codigoDe("MONTANTE", base));
  }
  if (unit === "KM_L") return achar(codigoDe("CONSUMO", null));
  if (unit === "PERCENT") return achar(codigoDe("PROPORCAO", null));
  if (unit && unit.startsWith("BRL_")) {
    const base = unit === "BRL_KM" ? "KM" : unit.slice("BRL_".length);
    return achar(codigoDe("TAXA", base)) ?? sintetizarTaxa(base);
  }
  if (unit === "ANO") return achar(codigoDe("DESCRITOR", "ANO_CALENDARIO"));
  if (unit === "KM") return achar(codigoDe("GRANDEZA", "KM"));
  if (unit === "LITROS") return achar(codigoDe("GRANDEZA", "LITRO"));
  if (unit === "MESES") return achar(codigoDe("GRANDEZA", "MES"));
  if (unit === "QTD") return achar(codigoDe("GRANDEZA", "QTD"));
  return null;
}

/**
 * Uma taxa cuja base não está no catálogo padrão, montada na hora.
 *
 * Um banco pode ter `BRL_PALLET` porque alguém o cadastrou; a leitura de volta
 * não pode falhar por isso. O rótulo sai no mesmo formato do catálogo.
 */
function sintetizarTaxa(base: string): Significado {
  return {
    code: codigoDe("TAXA", base),
    label: `R$ por ${base.toLowerCase().replace(/_/g, " ")}`,
    forma: "TAXA",
    base,
  };
}

function achar(code: string): Significado | null {
  return SIGNIFICADOS_PADRAO.find((s) => s.code === code) ?? null;
}

// ---------------------------------------------------------------------------
// O catálogo inicial
// ---------------------------------------------------------------------------

/**
 * Os significados com que o produto nasce.
 *
 * Curto de propósito, pela mesma razão que `DEFAULT_TAXONOMY` é rasa: ele
 * cobre o vocabulário que o export real sustenta e para aí. O resto é a
 * operação que cadastra, na própria tela, no momento em que precisa — e é por
 * isso que a criação inline não é um enfeite desta entrega, é o que mantém o
 * catálogo honesto sem que ele precise adivinhar o futuro.
 *
 * `R$ por veículo` entra mesmo deixando o período em aberto. Ele existe no
 * mundo — é como a maior parte das planilhas de remuneração fala — e escondê-lo
 * faria a pessoa escolher `R$ por mês` sem ter essa informação, que é
 * exatamente o erro caro. Ver {@link periodoEmAberto}.
 */
export const SIGNIFICADOS_PADRAO: Significado[] = [
  { code: codigoDe("MONTANTE", "MES"), label: "R$ por mês", forma: "MONTANTE", base: "MES" },
  { code: codigoDe("MONTANTE", "ANO"), label: "R$ por ano", forma: "MONTANTE", base: "ANO" },
  {
    code: codigoDe("MONTANTE", "AQUISICAO"),
    label: "Valor total em R$",
    forma: "MONTANTE",
    base: "AQUISICAO",
  },
  {
    code: codigoDe("MONTANTE", "VEICULO"),
    label: "R$ por veículo",
    forma: "MONTANTE",
    base: "VEICULO",
  },
  { code: codigoDe("TAXA", "KM"), label: "R$ por km", forma: "TAXA", base: "KM" },
  { code: codigoDe("TAXA", "LITRO"), label: "R$ por litro", forma: "TAXA", base: "LITRO" },
  { code: codigoDe("TAXA", "VIAGEM"), label: "R$ por viagem", forma: "TAXA", base: "VIAGEM" },
  { code: codigoDe("PROPORCAO", null), label: "Percentual", forma: "PROPORCAO", base: null },
  {
    code: codigoDe("CONSUMO", null),
    label: "Quilômetros por litro",
    forma: "CONSUMO",
    base: null,
  },
  { code: codigoDe("GRANDEZA", "QTD"), label: "Quantidade", forma: "GRANDEZA", base: "QTD" },
  { code: codigoDe("GRANDEZA", "KM"), label: "Quilômetros", forma: "GRANDEZA", base: "KM" },
  { code: codigoDe("GRANDEZA", "LITRO"), label: "Litros", forma: "GRANDEZA", base: "LITRO" },
  { code: codigoDe("GRANDEZA", "MES"), label: "Meses", forma: "GRANDEZA", base: "MES" },
  {
    code: codigoDe("DESCRITOR", "ANO_CALENDARIO"),
    label: "Ano de calendário",
    forma: "DESCRITOR",
    base: "ANO_CALENDARIO",
  },
  {
    code: codigoDe("DESCRITOR", null),
    label: "Texto descritivo",
    forma: "DESCRITOR",
    base: null,
  },
];

// ---------------------------------------------------------------------------
// Procurar antes de criar
// ---------------------------------------------------------------------------

/** Por que um item já existente é candidato ao que a pessoa digitou. */
export type TipoDeProximidade =
  /** O mesmo texto, a menos de acento, caixa e espaço. */
  | "IGUAL"
  /** Texto diferente, mesma economia: `R$/litro` e `R$ por litro`. */
  | "EQUIVALENTE"
  /** Parecido o bastante para valer a pergunta antes de criar. */
  | "PARECIDO";

export interface Proximo<T> {
  item: T;
  tipo: TipoDeProximidade;
  /** 0 a 1. Só para ordenar; `IGUAL` e `EQUIVALENTE` vêm sempre na frente. */
  semelhanca: number;
}

/**
 * Distância de edição normalizada, em 0..1.
 *
 * Barata e suficiente: os rótulos aqui têm poucas dezenas de caracteres, e o
 * que se quer pegar é erro de digitação e plural — não sinônimo, que é o que a
 * normalização e o código canônico já resolvem.
 */
export function semelhanca(a: string, b: string): number {
  const x = normalizarRotulo(a);
  const y = normalizarRotulo(b);
  if (x === y) return 1;
  if (!x || !y) return 0;

  const anterior = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = anterior[0];
    anterior[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const guardado = anterior[j];
      anterior[j] = Math.min(
        anterior[j] + 1,
        anterior[j - 1] + 1,
        diagonal + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      diagonal = guardado;
    }
  }
  return 1 - anterior[y.length] / Math.max(x.length, y.length);
}

/** Abaixo disto, "parecido" vira ruído e a tela oferece criar sem hesitar. */
export const LIMIAR_DE_PARECIDO = 0.72;

/**
 * O que já existe e pode ser o que a pessoa quis dizer.
 *
 * Roda **antes** da criação, e é o item 5 do pedido: `combustivel` tem de
 * encontrar `Combustível` em vez de abrir um segundo cadastro. Devolve lista
 * ordenada, e nunca decide sozinha — quem escolhe é quem digitou.
 *
 * `chaveDe` é opcional porque só os significados têm código canônico. Uma
 * categoria não tem economia a comparar; para ela sobram o texto normalizado e
 * a semelhança, que é exatamente o que o caso `combustivel`/`Combustível` pede.
 */
export function procurarProximos<T>(
  termo: string,
  itens: T[],
  rotuloDe: (item: T) => string,
  chaveDe?: (item: T) => string | null,
): Proximo<T>[] {
  const alvo = normalizarRotulo(termo);
  if (!alvo) return [];
  const chaveAlvo = chaveDe ? (interpretarRotulo(termo)?.code ?? null) : null;

  const achados: Proximo<T>[] = [];
  for (const item of itens) {
    const rotulo = rotuloDe(item);
    if (normalizarRotulo(rotulo) === alvo) {
      achados.push({ item, tipo: "IGUAL", semelhanca: 1 });
      continue;
    }
    if (chaveAlvo !== null && chaveDe && chaveDe(item) === chaveAlvo) {
      achados.push({ item, tipo: "EQUIVALENTE", semelhanca: 1 });
      continue;
    }
    const s = semelhanca(alvo, rotulo);
    if (s >= LIMIAR_DE_PARECIDO) achados.push({ item, tipo: "PARECIDO", semelhanca: s });
  }

  const peso: Record<TipoDeProximidade, number> = { IGUAL: 2, EQUIVALENTE: 1, PARECIDO: 0 };
  return achados.sort(
    (a, b) => peso[b.tipo] - peso[a.tipo] || b.semelhanca - a.semelhanca,
  );
}
