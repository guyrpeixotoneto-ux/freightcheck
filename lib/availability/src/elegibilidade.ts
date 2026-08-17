import type { Database } from "@workspace/db";
import { equipamentosDisponiveis } from "./disponibilidade";
import type { Recorte } from "./modelo";
import type { Vazio } from "./vazio";

/**
 * O que um módulo sabe apurar, cruzado com o que o canônico tem.
 *
 * ---------------------------------------------------------------------------
 * O defeito mais silencioso que esta auditoria encontrou
 * ---------------------------------------------------------------------------
 *
 * Composição e DRE sabem apurar cavalo e carreta, e dizem isso de duas formas:
 * `TIPOS_COM_REGRA` e `ESCOPOS_APURAVEIS`. As duas listas são **declaradas** —
 * escritas no código, não lidas do banco —, e é assim que devem ser: a regra de
 * remuneração de um equipamento é conhecimento de negócio, não algo que se
 * descubra numa consulta.
 *
 * O problema não é a lista. É que **ninguém a cruza com o canônico**. As telas
 * têm as abas escritas à mão, e o endpoint que devolvia a lista declarada não
 * era chamado por tela nenhuma. Um terceiro equipamento importado hoje ficaria
 * invisível nos dois módulos: sem aba, sem aviso, sem erro — porque ninguém
 * chega a perguntar por ele. Não há tela vazia para ninguém estranhar; há uma
 * ausência que ninguém tem como notar.
 *
 * É a Parte F.4 do baseline em forma pura: *"Terceiro equipamento, em
 * Composição/DRE — a tela simplesmente não o mostra"*. E é o caso em que o
 * corolário da regra de ouro morde de verdade, porque não existe nem a frase
 * errada para corrigir: existe o silêncio.
 *
 * ---------------------------------------------------------------------------
 * O que esta função faz
 * ---------------------------------------------------------------------------
 *
 * Cruza. O censo vem da autoridade (`equipamentosDisponiveis`), a lista de
 * regras vem do módulo, e o resultado é um veredito por equipamento **que
 * existe no banco** — apurável, ou `NAO_SE_APLICA` com o motivo escrito.
 *
 * O que ela não faz: inventar equipamento. Um tipo declarado no módulo e
 * ausente do canônico não vira linha — a tela não deve oferecer aba para
 * cavalo num banco que só tem carreta, e o silêncio ali é o certo.
 */
export interface EquipamentoElegivel {
  entityType: string;
  /** Quantas vigências o entregaram. É a prova de que ele existe. */
  vigencias: number;
  /** Entidades na vigência mais cheia. */
  entidades: number;
  /** O módulo sabe apurar este equipamento? */
  apuravel: boolean;
  /**
   * Quando não sabe: o vazio nomeado, para a tela mostrar em vez de omitir.
   *
   * Sempre `NAO_SE_APLICA` — o dado existe, e o módulo é que não fala dele.
   * Nunca `NAO_EXISTE`: esta lista só contém equipamento que o canônico tem.
   */
  vazio: Vazio | null;
}

/**
 * Os equipamentos do canônico, com o veredito de um módulo sobre cada um.
 *
 * `comoOModuloChama` existe porque a frase é do módulo: "não há regra de
 * composição declarada" e "a DRE não sabe apurar" descrevem a mesma situação e
 * mandam fazer coisas diferentes.
 */
export async function equipamentosElegiveis(
  db: Database,
  opcoes: {
    /** Os tipos que o módulo sabe apurar. Declarados, nunca descobertos. */
    apuraveis: readonly string[];
    /** A frase do módulo para o que ele não apura. Recebe o tipo. */
    comoOModuloChama: (entityType: string) => string;
    recorte?: Recorte;
  },
): Promise<EquipamentoElegivel[]> {
  const doCanonico = await equipamentosDisponiveis(db, opcoes.recorte ?? {});

  return doCanonico.map((e) => {
    const apuravel = opcoes.apuraveis.includes(e.entityType);
    return {
      entityType: e.entityType,
      vigencias: e.vigencias,
      entidades: e.entidades,
      apuravel,
      vazio: apuravel
        ? null
        : {
            estado: "NAO_SE_APLICA",
            frase: opcoes.comoOModuloChama(e.entityType),
          },
    };
  });
}
