import { ApiError, fetchJson } from "@/lib/api";
import { LEITURA_DE_APURACAO } from "@/lib/frescor-das-leituras";
import type { FamiliesView } from "@/components/inicio/types";

/**
 * O PAR DO PANORAMA — as duas pontas que a tela lê, e o endereço que as guarda.
 *
 * ---------------------------------------------------------------------------
 * `?period=` continua sendo o Para
 * ---------------------------------------------------------------------------
 * O Panorama sempre teve um par — toda a leitura é sobre uma diferença —, mas
 * só a ponta de chegada era escolhível, e ela morava (e continua morando) em
 * `?period=`. A ponta de partida entra ao lado, em `?base=`, e **o endereço sem
 * ela é exatamente o endereço de antes**: o par natural, cada vigência contra a
 * anterior dela. Nenhum link colado em e-mail mudou de assunto, e a
 * retrocompatibilidade não é um caso especial tratado aqui — é a ausência de um.
 *
 * O nome é `base` e não `de` porque `?de=` **já existe** do outro lado: é o
 * recorte de janela do contexto, que entra em `contextFilter` e recorta a lista
 * de vigências da unidade. Uma chave de tela com o nome de uma chave de API é
 * uma armadilha esperando quem um dia repassar a busca inteira numa consulta —
 * e foi exatamente esse o defeito que a primeira versão desta tela teve, até
 * alguém abri-la no navegador. `base` é o nome que o par das auditorias de
 * rubrica já usa para a ponta de partida.
 *
 * ---------------------------------------------------------------------------
 * Por que um `?base=` igual ao natural não muda a consulta
 * ---------------------------------------------------------------------------
 * Porque seriam duas chaves de cache para a mesma resposta, e as duas telas que
 * dividem a leitura da vigência (`lib/leitura-da-vigencia.ts`) passariam a ler
 * de lugares diferentes. Quando a ponta escolhida é a anterior — o caso normal,
 * inclusive depois de inverter duas vezes —, a tela volta à consulta de sempre,
 * `/changes/families`, na mesma chave em que o Impacto Apurado e o Dashboard já
 * a têm. `/changes/families/par` só sai quando ele diz algo diferente — a volta
 * e o par salteado —, e é exatamente isso que `?base=` no endereço significa:
 * **este par não é o canônico**. A tela decide por qual rota ler só olhando
 * para a presença da chave, sem esperar a lista de vigências chegar.
 */

/** As duas pontas, como a tela as lê. */
export interface ParEmTela {
  /** De onde se parte. `null` só quando a unidade tem uma vigência só. */
  de: string | null;
  /** Onde se chega — a vigência que a leitura publica. */
  para: string | null;
  /** A partida é **posterior** à chegada: a volta. */
  invertido: boolean;
  /**
   * Por que este par não pode ser lido — `null` quando pode.
   *
   * Ele existe porque a alternativa que estava aqui era pior: o par que a tela
   * não sabia ler era **trocado** por um que ela sabia, e quem tinha escolhido
   * as pontas via outras duas na caixa sem nenhuma frase dizendo por quê. A
   * escolha fica onde a pessoa a pôs, e a frase diz o que falta.
   */
  problema: ProblemaDoPar | null;
}

/** O que impede um par de ser lido, e a frase que a tela publica. */
export interface ProblemaDoPar {
  codigo: "MESMA_VIGENCIA" | "FORA_DA_UNIDADE" | "SEM_SEGUNDA_VIGENCIA";
  mensagem: string;
}

/** A vigência imediatamente anterior a esta, na lista do contexto. */
export function anteriorDe(datas: readonly string[], data: string): string | null {
  const ordenadas = [...datas].sort();
  const indice = ordenadas.indexOf(data);
  return indice > 0 ? ordenadas[indice - 1] : null;
}

/** A vigência imediatamente posterior a esta, na lista do contexto. */
export function posteriorA(datas: readonly string[], data: string): string | null {
  const ordenadas = [...datas].sort();
  const indice = ordenadas.indexOf(data);
  return indice >= 0 && indice < ordenadas.length - 1 ? ordenadas[indice + 1] : null;
}

/**
 * O par que a tela tem em mãos — o do endereço, ou o de abertura.
 *
 * ---------------------------------------------------------------------------
 * O `?base=` do endereço é honrado, seja ele qual for
 * ---------------------------------------------------------------------------
 * Ele era descartado quando não fosse **vizinho** do `?period=`: o Panorama lia
 * um passo de cada vez, e a tela preferia cair no par natural a pedir ao
 * servidor uma recusa que ela já sabia escrever. O passo deixou de ser a régua
 * (ver `lib/comparison/src/par-do-panorama.ts`), e com ele foi embora o
 * descarte: um link que diz junho→setembro abre em junho→setembro. Era a mesma
 * classe de defeito do arrasto no seletor — a tela decidindo por quem escolheu,
 * sem dizer.
 *
 * O que **não** é honrado é o impossível, e cada caso sai nomeado em
 * `problema`, com as duas pontas preservadas: a mesma vigência dos dois lados
 * (o motor recusa, e a tela não inventa um vizinho no lugar) e a ponta que não
 * é desta unidade (um link de outra unidade, ou de uma importação escondida).
 *
 * ---------------------------------------------------------------------------
 * Sem `?base=`, o par de abertura
 * ---------------------------------------------------------------------------
 * É a anterior imediata — a leitura de sempre, e a única que não custa uma
 * consulta nova. Na vigência **mais antiga** do histórico não há anterior, e aí
 * é a posterior: o par abre invertido, declarado em `invertido`, e a tela o diz
 * em uma frase. Antes ele abria com o **De vazio** e sem explicação nenhuma —
 * o que acontecia a quem clicasse na primeira barra do gráfico ou abrisse um
 * favorito daquela vigência. É a convenção de `compativelMaisProxima`, que as
 * dezesseis auditorias de rubrica usam há mais tempo: na falta da anterior, a
 * mais próxima que existe.
 */
export function parEmTela(
  datas: readonly string[],
  pedido: { para: string | null; de: string | null },
): ParEmTela {
  const para = pedido.para;
  if (para === null) return { de: null, para: null, invertido: false, problema: null };

  const problemaDe = (de: string): ProblemaDoPar | null => {
    if (de === para)
      return {
        codigo: "MESMA_VIGENCIA",
        mensagem:
          "As duas pontas são a mesma vigência, e uma vigência não se compara consigo mesma. " +
          "Escolha outra vigência em De — ou em Para.",
      };
    if (!datas.includes(de))
      return {
        codigo: "FORA_DA_UNIDADE",
        mensagem:
          "A vigência de origem deste endereço não está no histórico desta unidade. " +
          "Ela pode ser de outra unidade, ou de uma importação que saiu do ar — escolha a ponta De na lista.",
      };
    return null;
  };

  if (pedido.de !== null) {
    const problema = problemaDe(pedido.de);
    return {
      de: pedido.de,
      para,
      invertido: problema === null && pedido.de > para,
      problema,
    };
  }

  const de = anteriorDe(datas, para) ?? posteriorA(datas, para);
  return {
    de,
    para,
    invertido: de !== null && de > para,
    problema:
      de === null
        ? {
            codigo: "SEM_SEGUNDA_VIGENCIA",
            mensagem:
              "Esta unidade tem uma vigência só no histórico — não há par a comparar. " +
              "Importe outra vigência para ler o que mudou entre as duas.",
          }
        : null,
  };
}

/**
 * O que cada gesto no seletor escreve no endereço — uma ponta por gesto.
 *
 * ---------------------------------------------------------------------------
 * A ponta que não foi tocada não se mexe
 * ---------------------------------------------------------------------------
 * Este é o contrato inteiro, e ele é o mesmo das dezesseis auditorias de
 * rubrica (`components/comparacao/seletor-do-par`, cujas páginas passam
 * `onBase={setBase}` e nada mais): **Para** é a vigência de referência que se
 * está analisando, **De** é a origem contra a qual se quer compará-la, e mexer
 * numa não recalcula a outra.
 *
 * Até 17/09/2026 mexia: escolher no De reancorava o par inteiro e o Para ia
 * atrás — com setembro em Para, escolher agosto/1ª quinzena em De punha
 * agosto/2ª quinzena em Para, e a referência fixada saía debaixo de quem a
 * tinha fixado. A razão era a trava de vigências vizinhas do servidor: o
 * arrasto era o que garantia que nenhum clique montasse um par recusado. Sem a
 * trava, o arrasto perdeu o motivo — e o que ele custava (a tela desfazendo a
 * escolha de quem clicou, em silêncio) não tinha mais nada a comprar.
 *
 * O sentido continua explícito e continua sendo **Para − De**: o que a tela
 * publica é o que a chegada tem a mais, ou a menos, que a partida.
 */
export interface MudancaDoPar {
  period: string;
  base: string | null;
}

/** Escolher no De muda **só** o De. */
export function aoEscolherDe(
  datas: readonly string[],
  par: ParEmTela,
  data: string,
): MudancaDoPar | null {
  if (par.para === null) return null;
  return { period: par.para, base: baseNoEndereco(datas, { para: par.para, de: data }) };
}

/** Escolher no Para muda **só** o Para. */
export function aoEscolherPara(
  datas: readonly string[],
  par: ParEmTela,
  data: string,
): MudancaDoPar | null {
  if (par.de === null) return { period: data, base: null };
  return { period: data, base: baseNoEndereco(datas, { para: data, de: par.de }) };
}

/** Inverter é trocar as duas pontas de lado — e nada mais. */
export function aoInverter(
  datas: readonly string[],
  par: ParEmTela,
): MudancaDoPar | null {
  if (par.de === null || par.para === null) return null;
  return { period: par.de, base: baseNoEndereco(datas, { para: par.de, de: par.para }) };
}

/**
 * O ENDEREÇO SEGUINTE — e por que trocar outra coisa **apaga o par**.
 *
 * `?base=` só faz sentido ao lado do `?period=` com que foi escrito: levá-lo
 * numa troca de unidade apontaria para uma data que a outra unidade pode não
 * ter, e numa troca de competência pelo gráfico montaria um par que ninguém
 * pediu. Quem escolhe o par escreve as duas chaves na **mesma** troca — e é só
 * nesse caso que `base` sobrevive, porque veio na própria mudança.
 *
 * Mora aqui, e não dentro da página, porque é regra do par e não desenho de
 * tela: era a última parte do contrato que continuava escrita num `const` de
 * componente, onde nenhum caso conseguia alcançá-la.
 */
export function enderecoDoPanorama(
  atual: string,
  mudancas: Record<string, string | null>,
): string {
  const proxima = new URLSearchParams(atual);
  if (!("base" in mudancas)) proxima.delete("base");
  for (const [chave, valor] of Object.entries(mudancas)) {
    if (valor === null) proxima.delete(chave);
    else proxima.set(chave, valor);
  }
  return proxima.toString();
}

/**
 * COMO A TELA CHAMA O QUE ESTÁ LENDO — "esta vigência", ou o par.
 *
 * Os andares do Panorama foram escritos sobre uma frase: *o que **esta
 * vigência** custou*. Ela é verdadeira sobre o par canônico — a vigência contra
 * a anterior imediata dela — e deixa de ser sobre qualquer outro: no par
 * salteado o número é o que **dois** passos somaram, e na volta é o
 * desfazimento de um. "Nenhuma alteração foi detectada nesta vigência", debaixo
 * de um par junho→setembro, afirma sobre setembro o que foi medido entre as
 * duas pontas.
 *
 * A troca é de palavra, e só: nenhuma conta muda aqui. O que muda é a tela
 * parar de dizer *vigência* onde o que está sendo lido é um par — que é o
 * mesmo defeito do seletor, na camada do texto.
 *
 * Mora neste módulo porque quem sabe se o par é o canônico é o módulo do par, e
 * três telas escrevendo a regra em três lugares divergiriam na primeira
 * correção.
 */
export interface NomeDaLeitura {
  /** "esta vigência" · "este par de vigências" */
  esta: string;
  /** "desta vigência" · "deste par de vigências" */
  desta: string;
  /** "nesta vigência" · "neste par de vigências" */
  nesta: string;
}

export function nomeDaLeitura(emPar: boolean): NomeDaLeitura {
  return emPar
    ? {
        esta: "este par de vigências",
        desta: "deste par de vigências",
        nesta: "neste par de vigências",
      }
    : { esta: "esta vigência", desta: "desta vigência", nesta: "nesta vigência" };
}

/**
 * O `?base=` que vale a pena escrever no endereço.
 *
 * O par canônico — Para contra a anterior imediata dela — não escreve nada: ver
 * o cabeçalho deste arquivo. Escrevê-lo sempre faria a tela trocar de consulta
 * — e de chave de cache — sem trocar de resposta.
 *
 * Todo o resto escreve, e aí a chave vira o sinal de que a leitura sai pela
 * rota do par: a volta, e o par salteado que junho→setembro produz. É o
 * invariante em que `emPar` se apoia (`pages/panorama.tsx`).
 */
export function baseNoEndereco(
  datas: readonly string[],
  par: { para: string; de: string },
): string | null {
  return par.de === anteriorDe(datas, par.para) ? null : par.de;
}

/** O recorte que a consulta do par leva — unidade e canal, mais as duas pontas. */
export function consultaDoPar(
  recorte: URLSearchParams,
  par: { de: string; para: string },
): URLSearchParams {
  const consulta = new URLSearchParams();
  for (const chave of ["scopeHash", "canal"]) {
    const valor = recorte.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  consulta.set("base", par.de);
  consulta.set("comparada", par.para);
  return consulta;
}

/**
 * As opções do React Query para o par invertido.
 *
 * O 404 vira `null` pelo mesmo motivo de `opcoesDaVigencia`: "nenhuma vigência
 * importada ainda" é resposta sobre o acervo, não falha da tela. O 422 — a
 * recusa do motor, ou o par salteado — **sobe**: ele é uma frase escrita para
 * quem clicou, e engoli-la deixaria a tela vazia sem dizer por quê.
 */
export function opcoesDoPar(consulta: URLSearchParams) {
  return {
    queryKey: ["families", "par", consulta.toString()],
    ...LEITURA_DE_APURACAO,
    queryFn: async (): Promise<FamiliesView | null> => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families/par?${consulta}`);
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
  };
}
