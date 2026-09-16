/**
 * O VOCABULÁRIO COMUM DOS RECORTES DE RUBRICA.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * Porque agora há **dois** recortes nomeados do mesmo motor — FINAME
 * (`finame.ts`) e IPVA (`ipva.ts`) — e eles têm de dizer a mesma coisa com a
 * mesma palavra. "Conflito" na Auditoria de FINAME e "Conflito" na Auditoria de
 * IPVA precisam significar exatamente o mesmo estado do `change_set`; duas
 * cópias da mesma tradução divergiriam no primeiro dia em que alguém
 * acrescentasse um `changeType` a uma e esquecesse na outra, e as duas telas
 * passariam a classificar a mesma linha de dois jeitos.
 *
 * O que mora aqui é só o que é **comum a qualquer rubrica**: o que uma variável
 * mede, os seis estados, a forma da alteração como o motor a grava e a tradução
 * de uma para a outra. O que é de FINAME — quais são as catorze colunas do
 * financiamento, que a parcela da carreta embute a do cavalo — continua em
 * `finame.ts`; o que é de IPVA — que a coluna "mensal" da carreta não é 1/12 da
 * anual — continua em `ipva.ts`.
 *
 * `finame.ts` reexporta tudo daqui com os nomes que já publicava, de modo que
 * nenhum importador dele mudou de linha.
 *
 * Sem SQL e sem React, pelo mesmo motivo dos dois: é sobre estas funções que os
 * testes rodam sem um Postgres de pé, e é este mesmo módulo que o servidor e o
 * navegador importam.
 */

import { rotuloDeListaDaVigencia } from "./labels";

// ---------------------------------------------------------------------------
// O que uma variável mede
// ---------------------------------------------------------------------------

/**
 * O que a variável mede — e, por consequência, como a tela a escreve.
 *
 * `CICLO` entrou com a Auditoria de Lucro Fixo, e podia ter sido evitado: o
 * ciclo é 1 ou 2, e `ANO` já escreveria "1" e "2" na tela. Seria o número certo
 * sob o rótulo errado — a mesma armadilha que este produto documenta em toda
 * parte. Ciclo não é ano, e a tela escreve "Ciclo 2", não "2".
 *
 * As quatro últimas entraram com a Auditoria de Km Rodado, a primeira de grão
 * **trecho**, e nenhuma delas é conveniência de formatação:
 *
 * - `DISTANCIA` é quilômetro. Escrito como `DINHEIRO` viraria "R$ 412,00" onde
 *   a fonte disse 412 km.
 * - `REAIS_POR_KM` é uma **razão**, e a distinção entre ela e `DINHEIRO` é a
 *   decisão central daquele recorte: R$/km só vira dinheiro multiplicado por
 *   uma quilometragem, e somar os dois numa coluna de reais é o erro que o
 *   dicionário da tabela de frete avisa em letra grande.
 * - `VIAGENS` é contagem de ciclos, não dinheiro e não distância.
 * - `TEXTO` é o que não é número nenhum — origem, destino, o nome de uma
 *   unidade —, e existe para que a tela escreva o valor como veio em vez de
 *   tentar convertê-lo.
 *
 * As três últimas entraram com a Auditoria de Velocidade Média, e seguem a
 * mesma regra das de cima — o nome da unidade é parte do número:
 *
 * - `MINUTOS` é tempo de ciclo, TMA e refeição. `MESES` já existia e não serve:
 *   escrever "412 meses" onde a fonte disse 412 minutos é o número certo sob o
 *   rótulo errado.
 * - `VELOCIDADE` é km/h, e não é uma razão qualquer: `REAIS_POR_KM` escreveria
 *   "58,0000 R$/km" onde a fonte disse 58 km/h.
 * - `FATOR` é quantos motoristas um conjunto exige — uma contagem fracionária,
 *   sem unidade no mundo, que `ANO` arredondaria para um inteiro e apagaria
 *   justamente a fração que distingue 1,4 de 1,9 motorista por conjunto.
 *
 * `QUANTIDADE` entrou com a Auditoria do QLP, e é a contagem do que se remunera:
 * posições de um cargo, linhas de telefone, uniformes. Ela existe separada de
 * `DINHEIRO` porque no QLP as duas convivem na mesma linha — quantidade, valor
 * unitário e despesa —, e escrever "R$ 3,00" onde a fonte disse três uniformes
 * é o erro que a tabela inteira convida a cometer.
 *
 * `RENDIMENTO` entrou com a Auditoria de Consumo, quando a Manutenção deixou de
 * responder por três assuntos ao mesmo tempo. É km/l — razão, como
 * `REAIS_POR_KM` e `VELOCIDADE`, e nenhuma das duas serve: `REAIS_POR_KM`
 * escreveria "2,4000 R$/km" onde a fonte disse 2,4 km por litro, e `VELOCIDADE`
 * escreveria "2,4 km/h". E o sentido dela é o **inverso** do de um custo — um
 * rendimento que sobe é dinheiro que desce —, o que só se pode pintar na tela se
 * a medida disser qual dos dois é.
 *
 * O preço do litro, que aquela tela também mostra, **não** entrou nesta lista, e
 * é preciso dizer por quê: ele não é a medida de coluna nenhuma. Não existe
 * atributo de preço de combustível no acervo — o número é `R$/km × km/l`, obtido
 * por conta, e quem o escreve é uma função própria (`escreverPrecoDoLitro`). Uma
 * medida aqui seria um rótulo que nenhuma variável pode carregar, e um convite a
 * declarar como coluna o que é derivado.
 */
export type MedidaDaVariavel =
  | "DINHEIRO"
  | "PERCENTUAL"
  | "MESES"
  | "ANO"
  | "DATA"
  | "CICLO"
  | "DISTANCIA"
  | "REAIS_POR_KM"
  | "VIAGENS"
  | "TEXTO"
  | "MINUTOS"
  | "VELOCIDADE"
  | "FATOR"
  | "QUANTIDADE"
  | "RENDIMENTO";

// ---------------------------------------------------------------------------
// Os seis estados
// ---------------------------------------------------------------------------

/**
 * O que aconteceu com esta variável, neste veículo, entre as duas vigências.
 *
 * Os seis são exaustivos e nenhum deles é "não sei": `DADO_INCOMPLETO` e
 * `CONFLITO` são as duas formas honestas de dizer que **houve** algo e que ele
 * não vira número, cada uma com o motivo que o motor gravou.
 */
export type EstadoDaLinha =
  | "SEM_ALTERACAO"
  | "ALTERADO"
  | "NOVO_NA_VIGENCIA"
  | "AUSENTE_NA_COMPARADA"
  | "DADO_INCOMPLETO"
  | "CONFLITO";

export const ROTULO_DO_ESTADO: Record<EstadoDaLinha, string> = {
  SEM_ALTERACAO: "Sem alteração",
  ALTERADO: "Alterado",
  NOVO_NA_VIGENCIA: "Novo na vigência",
  AUSENTE_NA_COMPARADA: "Ausente na vigência comparada",
  DADO_INCOMPLETO: "Dado incompleto",
  CONFLITO: "Conflito",
};

/**
 * A ordem de gravidade — qual estado ganha quando um veículo tem vários.
 *
 * Um veículo aparece numa fatia só da rosca, e é esta lista que decide qual:
 * quem tem conflito conta como conflito ainda que também tenha uma variável
 * alterada. Sem a regra, a soma das fatias passaria do total de veículos, e uma
 * rosca cujas partes somam 113% é um gráfico em que ninguém acredita.
 */
export const GRAVIDADE: readonly EstadoDaLinha[] = [
  "CONFLITO",
  "AUSENTE_NA_COMPARADA",
  "NOVO_NA_VIGENCIA",
  "DADO_INCOMPLETO",
  "ALTERADO",
  "SEM_ALTERACAO",
];

/**
 * A alteração como o motor a grava, reduzida ao que estes módulos leem.
 *
 * Estruturalmente compatível com `ChangeRow` (`query.ts`) — é ele que chega
 * aqui em produção. Escrito como interface própria para que o teste construa
 * uma linha à mão sem montar as trinta colunas da tabela.
 */
export interface AlteracaoDoMotor {
  id?: number;
  changeType: string;
  nature?: string | null;
  attributeCode: string | null;
  attributeName?: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  isNullBefore?: boolean | null;
  isNullAfter?: boolean | null;
  nullReasonBefore?: string | null;
  nullReasonAfter?: string | null;
  /** `numeric` do Postgres chega como string. A conversão mora aqui. */
  deltaAbsolute: string | number | null;
  deltaPercent: string | number | null;
  comparability: string;
  inconclusiveReason?: string | null;
  impactConfidence?: string | null;
  impactAmount?: string | number | null;
  impactPeriodicity?: string | null;
}

/**
 * O estado de uma alteração — a tradução do motor para a tela.
 *
 * A ordem dos testes é deliberada: o eixo da frota decide antes do valor, e a
 * incomparabilidade decide antes de qualquer número. Uma linha `INCONCLUSIVE`
 * com `delta` nulo classificada como "Alterado" mostraria um travessão sob o
 * rótulo de uma alteração medida.
 */
export function estadoDaAlteracao(a: AlteracaoDoMotor): EstadoDaLinha {
  if (a.changeType === "ENTITY_ADDED" || a.changeType === "ATTRIBUTE_ADDED") {
    return "NOVO_NA_VIGENCIA";
  }
  if (a.changeType === "ENTITY_REMOVED" || a.changeType === "ATTRIBUTE_REMOVED") {
    return "AUSENTE_NA_COMPARADA";
  }
  if (a.comparability === "INCONCLUSIVE") {
    /*
      Duas famílias de incomparável, e elas não se dizem com a mesma palavra.

      Um valor que apareceu, sumiu ou trocou de motivo de ausência é **dado
      incompleto**: o acervo tem um buraco, e o buraco é o achado. Um tipo que
      mudou, uma coluna que a fonte entrega com dois tipos no mesmo import e uma
      semântica que se moveu são **conflito**: os dois lados existem e não podem
      ser postos lado a lado com segurança. Chamar os dois de "incompleto"
      mandaria alguém procurar um dado que está lá.
    */
    const ausencia =
      a.nature === "APPEARED" || a.nature === "DISAPPEARED" || a.nature === "NULL_REASON";
    return ausencia ? "DADO_INCOMPLETO" : "CONFLITO";
  }
  return "ALTERADO";
}

/** `numeric` do Postgres chega como string; nulo continua nulo. */
export function numero(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** A chave de um veículo dentro de um recorte: rótulo mais tipo. */
export function chaveDoVeiculo(l: {
  entityLabel: string | null;
  entityType: string;
}): string {
  return `${l.entityLabel}${l.entityType}`;
}
// ---------------------------------------------------------------------------
// O par de vigências — qual unidade, e quais duas pontas
// ---------------------------------------------------------------------------
//
// Este bloco chegou de `artifacts/freightaudit/src/lib/finame.ts`, onde nasceu
// junto com a primeira tela de rubrica. Nada nele é de financiamento: são
// vigências, unidades e datas, e a segunda tela precisava das três funções
// exatamente como a primeira as usa.
//
// O `scopeHash` é a razão de elas serem compartilhadas e não copiadas.
// `/snapshots` responde pela operação inteira, e uma importação do arquivo da
// Ambev produz uma vigência **por unidade** com o mesmo `sourceLabel` e a mesma
// data — no acervo medido, seis vigências × cinco unidades. Um par escolhido sem
// olhar o escopo casa CAMAÇARI com PERNAMBUCO, que é o único par que o motor
// recusa por construção (`engine.ts`: "Escopos diferentes"), e a tela abre num
// erro que ninguém provocou.

/**
 * O mínimo que se precisa saber de uma vigência para emparelhá-la.
 *
 * Estrutural de propósito: quem chama é a tela, com o que `/snapshots`
 * devolveu (`VigenciaEscolhivel`), e este módulo não precisa do resto.
 */
export interface VigenciaEmparelhavel {
  id: string;
  effectiveDate: string;
  entityTypeSet: string;
  scopeHash: string;
}

/**
 * As vigências da unidade aberta — e todas quando não há unidade aberta.
 *
 * `/snapshots` responde pela operação inteira: dentro dela, PERNAMBUCO e
 * CAMAÇARI importadas do mesmo arquivo têm o **mesmo rótulo e a mesma data**, e
 * viram duas linhas idênticas no seletor. Sem este recorte, a tela oferecia as
 * duas sem dizer qual é qual, e a lateral, ao lado, nomeava uma delas.
 *
 * Sem `scopeHash` a lista sai inteira — o caso em que nem a URL nem `/contexts`
 * sabem dizer qual unidade está aberta. Quem chama resolve a unidade antes
 * (`contextoAberto`, em `lib/contextos.ts`), de modo que na prática isto é o
 * degrau final: só o acervo inteiro é melhor do que nada em tela.
 */
export function vigenciasDaUnidade<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
  scopeHash: string | null,
): T[] {
  if (!scopeHash) return [...vigencias];
  return vigencias.filter((v) => v.scopeHash === scopeHash);
}

/**
 * As vigências que cobrem um tipo de equipamento — o recorte que o grão exige.
 *
 * Nasceu com a Auditoria de Km Rodado, a primeira de grão **trecho**, e é a
 * diferença entre uma tela que abre com dado e uma que abre vazia sem dizer por
 * quê. As três auditorias anteriores são de cavalo e carreta, que é o que a
 * maioria das vigências entrega; a de trecho não — no acervo, a mesma unidade
 * entrega o arquivo de equipamento e o de trecho em vigências **separadas**, com
 * `entity_type_set` diferente. Sem este filtro, o par de partida cai na vigência
 * de cavalo mais recente e a tela de trecho abre com zero linhas, correta e
 * inexplicável.
 *
 * `entityTypeSet` é a lista de coberturas separadas por `+` — `CARRETA+CAVALO`,
 * `TRECHO`. Comparar por igualdade com o tipo procurado erraria na vigência que
 * entrega mais de uma cobertura; o teste é de pertinência.
 *
 * **Aceita mais de um tipo**, e isto é o que faltava do outro lado: as
 * auditorias de grão equipamento leem cavalo *e* carreta, e uma unidade pode
 * entregar os dois na mesma vigência (`CARRETA+CAVALO`) ou cada um na sua. O
 * recorte delas é `TIPOS_DE_EQUIPAMENTO` — quem cobre qualquer um dos tipos
 * pedidos entra. Uma lista vazia não recorta nada, porque um recorte sem
 * critério é a lista inteira, não a lista vazia.
 */
export function vigenciasQueCobrem<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
  entityType: string | readonly string[],
): T[] {
  const alvos = (typeof entityType === "string" ? [entityType] : entityType).map((t) =>
    t.trim().toUpperCase(),
  );
  if (alvos.length === 0) return [...vigencias];
  return vigencias.filter((v) => {
    const cobertura = (v.entityTypeSet ?? "")
      .split("+")
      .map((t) => t.trim().toUpperCase());
    return alvos.some((alvo) => cobertura.includes(alvo));
  });
}

/**
 * Os tipos de entidade das auditorias de grão equipamento — o irmão de
 * {@link TIPO_DO_KM_RODADO}.
 *
 * FINAME, IPVA, Impostos e Lucro Fixo leem placa: cavalo e carreta, e nada
 * mais. Elas listavam **todas** as vigências da unidade, e o acervo entrega o
 * arquivo de trecho como vigência separada, com `entity_type_set = TRECHO` — de
 * modo que a lista oferecia uma ponta que aquelas telas não sabem ler. Escolher
 * essa ponta é a recusa do motor em tela ("Coberturas diferentes", `engine.ts`)
 * quando a outra ponta é de equipamento, ou zero linhas sem explicação quando
 * as duas são de trecho. Nos dois casos o erro não é de quem clicou: era a
 * lista que não devia ter oferecido.
 */
export const TIPOS_DE_EQUIPAMENTO: readonly string[] = ["CAVALO", "CARRETA"];

/**
 * O par de partida: as duas vigências mais recentes que **formam par de
 * verdade** — mesma unidade e mesma cobertura.
 *
 * As duas condições são a recusa do motor antecipada: `engine.ts` não compara
 * escopos diferentes nem coberturas diferentes, e a tela que oferece um par
 * assim abre num erro que não é de quem abriu. A cobertura já estava aqui — era
 * o que impedia cavalo de casar com carreta; o escopo faltava, e era o que
 * fazia a tela abrir recusada assim que duas unidades dividiam a mesma data.
 *
 * **Procura, em vez de olhar só a primeira linha.** Sem unidade aberta, a
 * vigência mais recente do acervo pode ser de uma unidade que só tem aquela —
 * e parar ali diria "não há par" com nove pares disponíveis logo abaixo. A
 * ponta comparada é a mais recente que tem com quem se comparar.
 *
 * Devolve `null` quando não há par nenhum: uma unidade com uma vigência só não
 * tem comparação, e isso é uma tela vazia com a frase que explica — nunca um
 * pedido ao servidor que já se sabe que vai ser recusado.
 */
export function parDePartida<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
): { base: T; comparada: T } | null {
  const ordenadas = [...vigencias].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate),
  );
  for (const comparada of ordenadas) {
    const base = ordenadas.find(
      (v) =>
        v.id !== comparada.id &&
        v.entityTypeSet === comparada.entityTypeSet &&
        v.scopeHash === comparada.scopeHash,
    );
    if (base) return { base, comparada };
  }
  return null;
}

/**
 * O par escolhido, mantido dentro da lista que o seletor oferece — **sem
 * desfazer escolha de ninguém**.
 *
 * O defeito que esta função corrige, relatado em 15/09/2026 na Auditoria de Km
 * Rodado: o seletor oferecia `agosto/2026` e `setembro/2026`, e clicar em
 * qualquer uma das duas não escrevia nada na caixa. O par era reconciliado num
 * efeito que exigia as **duas** pontas válidas para não mexer em nada; com uma
 * ponta só escolhida, ele caía em {@link parDePartida}, que naquela unidade não
 * achava par — e devolvia as duas pontas vazias. Cada clique era desfeito no
 * quadro seguinte, e a tela ficava com as duas listas cheias e nada selecionado.
 *
 * A regra aqui é a que faltava: **o que está na lista fica**. Uma ponta só é
 * limpa quando some da lista — é o que acontece ao trocar de unidade, e é o que
 * impede a tela de responder por Pernambuco sob a palavra CAMAÇARI. O par de
 * partida só entra quando **nenhuma** das duas sobreviveu: aí não há escolha a
 * respeitar, e abrir com par é melhor do que abrir vazio.
 *
 * Meia escolha fica meia escolha de propósito. Completar a outra ponta sozinho
 * dispararia uma comparação que ninguém pediu, e ainda por cima logo depois de
 * a pessoa ter mexido justamente naquela caixa.
 */
export function parReconciliado<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
  escolhido: { base: string; comparada: string },
): { base: string; comparada: string } {
  const naLista = (id: string) => Boolean(id) && vigencias.some((v) => v.id === id);
  const base = naLista(escolhido.base) ? escolhido.base : "";
  const comparada = naLista(escolhido.comparada) ? escolhido.comparada : "";
  if (base || comparada) return { base, comparada };
  const par = parDePartida(vigencias);
  return { base: par?.base.id ?? "", comparada: par?.comparada.id ?? "" };
}

/**
 * Por que esta lista não forma par sozinha — a frase da tela vazia, escolhida
 * pelo dado e não pelo palpite.
 *
 * `null` quando há par. Os quatro motivos são exaustivos e cada um pede uma
 * frase diferente de quem lê:
 *
 * - `LISTA_VAZIA` — a unidade não tem nenhuma vigência da cobertura que a tela
 *   lê. Falta importar o arquivo.
 * - `UMA_SO` — tem uma, e uma não se compara consigo mesma. Falta a seguinte.
 * - `UNIDADES_DIFERENTES` — há duas ou mais, mas de unidades diferentes; é o
 *   caso de quem abriu sem unidade escolhida na lateral.
 * - `COBERTURAS_DIFERENTES` — mesma unidade, e as vigências chegaram cobrindo
 *   conjuntos diferentes de tipos. O motor recusa o par (`engine.ts`:
 *   "Coberturas diferentes"), e dizer "não tem duas vigências" com duas na
 *   lista manda a pessoa procurar o que está bem na frente dela. As coberturas
 *   voltam junto para que a frase possa nomeá-las.
 */
export type MotivoSemPar =
  | { motivo: "LISTA_VAZIA" }
  | { motivo: "UMA_SO" }
  | { motivo: "UNIDADES_DIFERENTES" }
  | { motivo: "COBERTURAS_DIFERENTES"; coberturas: string[] };

export function motivoSemPar<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
): MotivoSemPar | null {
  if (vigencias.length === 0) return { motivo: "LISTA_VAZIA" };
  if (vigencias.length === 1) return { motivo: "UMA_SO" };
  if (parDePartida(vigencias) !== null) return null;
  const unidades = new Set(vigencias.map((v) => v.scopeHash));
  if (unidades.size > 1) return { motivo: "UNIDADES_DIFERENTES" };
  return {
    motivo: "COBERTURAS_DIFERENTES",
    coberturas: [...new Set(vigencias.map((v) => v.entityTypeSet))].sort(),
  };
}

// ---------------------------------------------------------------------------
// Os rótulos do seletor — o que distingue uma linha da outra
// ---------------------------------------------------------------------------

/** O que se precisa de uma vigência para escrever o rótulo dela. */
export interface VigenciaRotulavel extends VigenciaEmparelhavel {
  sourceLabel: string;
  revision?: number | null;
}

/**
 * A vigência escrita como quem fala dela — `julho/2026 · 2ª quinzena`.
 *
 * O rótulo era `EMPURRADA_2_7_2026 · 16/07/2026`: o nome do arquivo que a Ambev
 * mandou, mais a data em que ele passou a valer. As duas coisas são verdadeiras
 * e nenhuma é o jeito como alguém pergunta — ninguém abre a tela querendo saber
 * o que mudou no `EMPURRADA_2_7_2026`.
 *
 * Quem monta é `rotuloDeListaDaVigencia`, e é de propósito: o seletor do
 * cabeçalho (`components/vigencia/seletor-de-vigencia.tsx`) já escreve assim, e
 * duas funções montando o mesmo nome dariam "2ª quinzena" numa tela e "dia 16"
 * na outra. Ela também resolve o caso que uma regra ingênua erraria — duas
 * entregas no mesmo mês que **não** são quinzenas limpas viram `dia 02`, em vez
 * de inventar uma quinzena que não existe.
 *
 * `doContexto` são as datas da própria lista: a marca só aparece quando há mais
 * de uma entrega naquele mês, e é a lista quem sabe disso.
 */
function rotuloDaVigencia(
  effectiveDate: string,
  doContexto: readonly string[],
): string {
  const { mes, marca } = rotuloDeListaDaVigencia(effectiveDate, doContexto);
  return marca ? `${mes} · ${marca}` : mes;
}

/**
 * O rótulo de cada vigência, **distinto por construção**.
 *
 * O seletor escrevia `sourceLabel · data` e nada mais, e o resultado medido foi
 * uma lista de cinco `EMPURRADA_1_6_2026 · 01/06/2026` seguidas, uma por
 * unidade. Escolher ali é adivinhar: as cinco linhas são a mesma frase, e a
 * recusa do motor — "cobrem unidades/operadores distintos" — só aparece depois
 * do clique, explicando algo que a lista tinha escondido.
 *
 * A régua é **acrescentar só o que desempata**, na ordem em que a pessoa
 * pensa:
 *
 * 1. `julho/2026 · 2ª quinzena` — como se fala da vigência, e o que basta na
 *    maioria dos casos;
 * 2. **a unidade**, quando duas linhas iguais são de unidades diferentes. É o
 *    caso desta tela, e é a informação que faltava;
 * 3. **a cobertura**, quando a mesma unidade entregou cavalo e carreta na mesma
 *    data — duas séries que compartilham as datas, e que o motor também não
 *    compara entre si;
 * 4. **o arquivo** (`sourceLabel`), para o que ainda seguir igual;
 * 5. **a revisão**, o último desempate possível, para o que sobrar.
 *
 * Nada é acrescentado a quem já é único: um rótulo que carrega sempre as quatro
 * coisas é uma linha ilegível, e ilegível também esconde.
 */
export function rotulosDasVigencias<T extends VigenciaRotulavel>(
  vigencias: readonly T[],
  /** O nome da unidade de um escopo, quando se conhece — `/contexts` o sabe. */
  nomeDoEscopo: (scopeHash: string) => string | null = () => null,
): Map<string, string> {
  const sufixos: ((v: T) => string | null)[] = [
    (v) => nomeDoEscopo(v.scopeHash),
    (v) => v.entityTypeSet || null,
    /* O nome do arquivo desceu para cá quando o rótulo virou `julho/2026 · 2ª
       quinzena`: ele deixou de ser como a vigência se chama e passou a ser o
       que ela veio, útil só quando duas linhas seguem indistinguíveis. */
    (v) => v.sourceLabel || null,
    (v) => (v.revision == null ? null : `rev. ${v.revision}`),
  ];

  const rotulos = new Map<string, string>();

  /** Desempata um grupo que hoje divide o mesmo texto, um sufixo por vez. */
  const resolver = (grupo: readonly T[], texto: string, nivel: number): void => {
    if (grupo.length === 1 || nivel >= sufixos.length) {
      for (const v of grupo) rotulos.set(v.id, texto);
      return;
    }
    const porSufixo = new Map<string, T[]>();
    for (const v of grupo) {
      const sufixo = sufixos[nivel](v);
      const chave = sufixo === null ? texto : `${texto} · ${sufixo}`;
      porSufixo.set(chave, [...(porSufixo.get(chave) ?? []), v]);
    }
    /* O sufixo não separou ninguém: não vale escrevê-lo, só o nível seguinte. */
    if (porSufixo.size === 1) {
      resolver(grupo, texto, nivel + 1);
      return;
    }
    for (const [chave, subgrupo] of porSufixo) resolver(subgrupo, chave, nivel + 1);
  };

  const datas = vigencias.map((v) => v.effectiveDate);
  const porBase = new Map<string, T[]>();
  for (const v of vigencias) {
    const base = rotuloDaVigencia(v.effectiveDate, datas);
    porBase.set(base, [...(porBase.get(base) ?? []), v]);
  }
  for (const [base, grupo] of porBase) resolver(grupo, base, 0);

  return rotulos;
}

// ---------------------------------------------------------------------------
// A compatibilidade de duas pontas — a recusa do motor, dita antes do clique
// ---------------------------------------------------------------------------
//
// Este bloco é a terceira cópia de uma regra que já existia duas vezes, e é por
// isso que ele existe: `engine.ts` recusa o par (escopo, cobertura, e um
// snapshot contra si mesmo), `candidatas-do-par.ts` antecipa a recusa para não
// gastar orçamento com par que não vai rodar, e o seletor das telas **não
// antecipava nada** — oferecia as doze linhas da unidade como se fossem
// intercambiáveis.
//
// O sintoma medido, relatado em 15/09/2026 na Auditoria de FINAME, depois de
// uma importação de carreta que mudou a cobertura de parte do acervo: o menu
// "De" mostrava número em duas linhas e **nada** nas outras oito. Quem lê a
// tela conclui que as oito não têm alteração; o que elas são, na verdade, é
// incomparáveis com o "Para" aberto — o servidor sequer as considerou
// (`candidatas-do-par.ts`), porque a cobertura não bate. Uma linha muda ao lado
// de uma vigência é a pior resposta possível numa tela de auditoria: ela não
// mente com número, mas deixa quem lê inventar o número que falta.
//
// Com a regra aqui, o seletor recorta a lista pela mesma condição que o
// servidor usa para montar as candidatas. O que sobra na lista é o que produz
// comparação; o que não produz não é oferecido, e a ausência é explicada por
// escrito em vez de ficar em branco.

/**
 * As duas pontas formam par que o motor aceita?
 *
 * `DeVigencias` no nome não é enfeite: `composition.ts` já publica um
 * `formamPar`, e ele fala de **equipamento** — se um cavalo e uma carreta
 * formam conjunto. Os dois saem pelo mesmo `export *` do índice do pacote, e
 * dois nomes iguais ali não brigam em voz alta: o export vira ambíguo, o import
 * chega `undefined`, e o que se vê é a rota respondendo 500 longe daqui. Foi
 * exatamente o que aconteceu na primeira versão desta função.
 *
 * As três condições são as de `engine.ts`, na ordem em que ele as testa —
 * um snapshot não se compara consigo mesmo, escopos diferentes não se comparam,
 * coberturas diferentes não se comparam. O canal, que é a quarta recusa do
 * motor, não entra aqui: ele não está em `VigenciaEmparelhavel` e já é recortado
 * antes, por operação, em `listComparableSnapshots`.
 *
 * A igualdade da cobertura é **exata**, e não "tem algum tipo em comum": é o
 * que `engine.ts` faz (`a.entityTypeSet !== b.entityTypeSet`), e é o que a
 * comparação exige — uma vigência de `CARRETA+CAVALO` contra uma de `CAVALO`
 * faria toda carreta aparecer como removida.
 */
export function formamParDeVigencias(a: VigenciaEmparelhavel, b: VigenciaEmparelhavel): boolean {
  if (a.id === b.id) return false;
  if (a.scopeHash !== b.scopeHash) return false;
  return a.entityTypeSet === b.entityTypeSet;
}

/**
 * As vigências que podem ficar do outro lado de uma ponta escolhida.
 *
 * É o recorte que o seletor oferece: com `julho/2026` de um lado, só entram na
 * outra caixa as vigências da mesma unidade e da mesma cobertura. Sem
 * referência, não há o que recortar — a lista inteira é a resposta, porque
 * recortar por um critério que não existe é esconder sem motivo.
 */
export function vigenciasCompativeisCom<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
  referencia: VigenciaEmparelhavel | null | undefined,
): T[] {
  if (!referencia) return [...vigencias];
  return vigencias.filter((v) => formamParDeVigencias(v, referencia));
}

/**
 * A compatível mais próxima no tempo — quem entra na outra caixa sozinha.
 *
 * Trocar o "De" para uma vigência de outra cobertura invalida o "Para" que
 * estava lá. Deixar o campo como estava seria manter em tela um par que o motor
 * recusa; esvaziá-lo seria pedir mais um clique para chegar ao lugar óbvio. A
 * escolha é a vizinha: a vigência compatível cuja data está mais perto da
 * referência, que é o par que quem audita quase sempre quer — o mês anterior,
 * ou a quinzena anterior.
 *
 * Empate entre uma anterior e uma posterior à mesma distância: fica a
 * **anterior**. "De" é a origem e "Para" o destino, e a leitura natural do
 * produto anda para frente no tempo; na dúvida, a origem é a mais velha.
 */
export function compativelMaisProxima<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
  referencia: VigenciaEmparelhavel | null | undefined,
): T | null {
  if (!referencia) return null;
  const candidatas = vigenciasCompativeisCom(vigencias, referencia);
  if (candidatas.length === 0) return null;
  const distancia = (v: T) => Math.abs(Date.parse(v.effectiveDate) - Date.parse(referencia.effectiveDate));
  return [...candidatas].sort(
    (a, b) =>
      distancia(a) - distancia(b) || a.effectiveDate.localeCompare(b.effectiveDate),
  )[0]!;
}

/**
 * A cobertura escrita como quem fala dela — `Cavalo + Carreta`.
 *
 * O acervo grava o conjunto em ordem alfabética (`CARRETA+CAVALO`), que é o que
 * a identidade precisa e não é como ninguém diz: o cavalo puxa a carreta, e a
 * frase é nessa ordem. Existe para a mensagem que explica a lista vazia — uma
 * frase que dissesse `CARRETA+CAVALO` devolveria a quem lê o vocabulário do
 * banco em vez do da operação.
 */
export function rotuloDaCobertura(entityTypeSet: string): string {
  const ordem = ["CAVALO", "CARRETA", "TRECHO"];
  const tipos = (entityTypeSet ?? "")
    .split("+")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t !== "");
  if (tipos.length === 0) return "";
  return tipos
    .sort((a, b) => {
      const ia = ordem.indexOf(a);
      const ib = ordem.indexOf(b);
      return (ia === -1 ? ordem.length : ia) - (ib === -1 ? ordem.length : ib) || a.localeCompare(b);
    })
    .map((t) => t.charAt(0) + t.slice(1).toLowerCase())
    .join(" + ");
}

/**
 * Como o equipamento veio na vigência — `Somente cavalo`, `Cavalo com carreta`.
 *
 * ---------------------------------------------------------------------------
 * Por que ela substituiu "Outra cobertura"
 * ---------------------------------------------------------------------------
 * Porque aquele nome passou a contradizer a tela. Ele era o **título** do grupo
 * — que hoje diz outra coisa (`TITULO_DA_OUTRA_SERIE`) —, e a frase daqui é o
 * que ficou no lugar dele: escrita linha a linha, ao lado de cada vigência, que
 * é onde ela distingue uma da outra. O seletor do par separa as
 * vigências que formam par com a ponta aberta das que não formam, e enquanto
 * ele era o único eixo da tela "cobertura" era a palavra certa — era ela que
 * distinguia as linhas. Depois que a aba de equipamento subiu para cima do par,
 * a mesma palavra virou uma contradição em voz alta: dentro da aba **Cavalo**,
 * um grupo chamado "Outra cobertura" cujas linhas dizem "Cavalo".
 *
 * O que separa aquelas linhas não é o equipamento — as duas têm cavalo. É a
 * **composição do arquivo de origem**: numa o cavalo veio sozinho, na outra
 * veio junto com a carreta, e o motor não compara uma com a outra porque a
 * comparação é da vigência inteira (`engine.ts`). Dizer isso por extenso
 * explica a divisão; dizer "cobertura" só a nomeia com o vocabulário do banco.
 *
 * `foco` é o equipamento da aba aberta, e é ele que decide a frase: na aba
 * Cavalo, `CARRETA+CAVALO` é "Cavalo com carreta"; na de Carreta, a mesma
 * vigência é "Carreta com cavalo". A mesma cobertura, lida da pergunta que está
 * sendo feita — que é o oposto de um rótulo fixo que obriga quem lê a traduzir.
 *
 * Sem `foco` — a aba que mostra os dois —, a ordem é a de quem fala: o cavalo
 * puxa a carreta.
 *
 * `DoArquivo`, e não `DaVigencia`: `tipos-da-vigencia.ts` já publica um
 * `composicaoDaVigencia`, e ele responde outra pergunta — quais tipos existem
 * naquela vigência e onde estão os que faltam. Os dois saem pelo mesmo
 * `export *` do índice, e dois nomes iguais ali se anulam em silêncio. O nome
 * daqui também é mais honesto: o que se descreve é como o **arquivo de origem**
 * veio composto.
 */
export function composicaoDoArquivo(
  entityTypeSet: string,
  foco?: string | null,
): string {
  const tipos = (entityTypeSet ?? "")
    .split("+")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t !== "");
  if (tipos.length === 0) return "";

  const minusculo = (t: string) => t.toLowerCase();
  const alvo = foco?.trim().toUpperCase();
  const principal = alvo && tipos.includes(alvo) ? alvo : null;

  if (principal) {
    const outros = tipos.filter((t) => t !== principal).map(minusculo);
    return outros.length === 0
      ? `Somente ${minusculo(principal)}`
      : `${rotuloDaCobertura(principal)} com ${outros.join(" e ")}`;
  }

  if (tipos.length === 1) return `Somente ${minusculo(tipos[0]!)}`;
  /* `rotuloDaCobertura` já ordena por como se fala — cavalo antes de carreta. */
  const [primeiro, ...resto] = rotuloDaCobertura(entityTypeSet).split(" + ");
  return `${primeiro} com ${resto.map((t) => t.toLowerCase()).join(" e ")}`;
}

/**
 * O título do grupo que reúne as vigências de outra composição.
 *
 * ---------------------------------------------------------------------------
 * Por que ele deixou de descrever a composição
 * ---------------------------------------------------------------------------
 * Porque descrever era o que confundia. "Como o equipamento veio na vigência"
 * é uma frase verdadeira e nenhuma ajuda: ela nomeia o **critério** que separou
 * as linhas de baixo das de cima, e quem abre o menu não está perguntando por
 * um critério — está procurando uma vigência. Pior, a frase repete o que cada
 * linha do grupo já diz à direita ("Cavalo com carreta"), e um cabeçalho que
 * repete a linha é lido como uma segunda lista, não como a continuação da
 * primeira.
 *
 * O que falta dizer ali não é o que aquelas vigências **são** — é o que
 * acontece ao clicar numa delas: o par sai da série em tela e vai para a outra,
 * arrastando a ponta oposta para a compatível mais próxima
 * (`compativelMaisProxima`). "Trocar para outra série" é essa frase, e é a
 * única coisa que o grupo existe para oferecer.
 *
 * Constante e não função: a frase não depende mais do equipamento da aba. A
 * composição de cada vigência continua escrita linha a linha, por
 * `composicaoDoArquivo`, que é onde ela responde a uma pergunta de verdade —
 * qual das séries é esta.
 */
export const TITULO_DA_OUTRA_SERIE = "Trocar para outra série";
