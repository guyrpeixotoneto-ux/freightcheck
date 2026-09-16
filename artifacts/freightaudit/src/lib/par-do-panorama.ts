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
 * a têm. `/changes/families/par` só sai quando ele diz algo diferente: a volta.
 */

/** As duas pontas, como a tela as lê. */
export interface ParEmTela {
  /** De onde se parte. `null` enquanto a lista não chegou. */
  de: string | null;
  /** Onde se chega — a vigência que a leitura publica. */
  para: string | null;
  /** A partida é **posterior** à chegada: a volta. */
  invertido: boolean;
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
 * O par que a tela tem em mãos — o do endereço, ou o natural.
 *
 * `de` só é honrado quando é **vizinho** do `para`: o Panorama lê um passo de
 * cada vez (ver `par-do-panorama.ts`, no servidor), e um endereço com um par
 * salteado cai no par natural em vez de pedir ao servidor uma recusa que a tela
 * já sabe escrever. Com uma vigência só no histórico não há par nenhum, e as
 * duas pontas ficam vazias — que é a verdade, e é o que o seletor diz.
 */
export function parEmTela(
  datas: readonly string[],
  pedido: { para: string | null; de: string | null },
): ParEmTela {
  const para = pedido.para;
  if (para === null) return { de: null, para: null, invertido: false };

  const vizinhas = [anteriorDe(datas, para), posteriorA(datas, para)];
  const de = pedido.de !== null && vizinhas.includes(pedido.de) ? pedido.de : vizinhas[0];
  return { de, para, invertido: de !== null && de > para };
}

/**
 * O que escolher uma vigência numa das caixas produz no endereço.
 *
 * As duas caixas oferecem o histórico inteiro, e a outra ponta segue atrás —
 * é o mesmo desenho do seletor das auditorias de rubrica, e pela mesma razão:
 * um campo que só oferecesse as duas vizinhas da ponta aberta tornaria o resto
 * do histórico inalcançável sem passar por todas as datas do caminho.
 *
 * A ponta que segue é sempre a **vizinha que existe**, e a direção sai daí: com
 * as duas disponíveis, a ida (a leitura de sempre); na borda do histórico, a
 * única possível. É o que garante que nenhum clique monte um par que o servidor
 * recuse — e que a vigência mais antiga, que não tem anterior, ainda possa ser
 * lida, pela volta.
 */
export function aoEscolherDe(
  datas: readonly string[],
  data: string,
): { period: string; de: string } | null {
  const para = posteriorA(datas, data) ?? anteriorDe(datas, data);
  return para === null ? null : { period: para, de: data };
}

export function aoEscolherPara(
  datas: readonly string[],
  data: string,
): { period: string; de: string } | null {
  const de = anteriorDe(datas, data) ?? posteriorA(datas, data);
  return de === null ? null : { period: data, de };
}

/** Inverter é trocar as duas pontas de lado — e nada mais. */
export function aoInverter(par: ParEmTela): { period: string; de: string } | null {
  if (par.de === null || par.para === null) return null;
  return { period: par.de, de: par.para };
}

/**
 * O `?base=` que vale a pena escrever no endereço.
 *
 * O par natural não escreve nada: ver o cabeçalho deste arquivo. Escrevê-lo
 * sempre faria a tela trocar de consulta — e de chave de cache — sem trocar de
 * resposta.
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
