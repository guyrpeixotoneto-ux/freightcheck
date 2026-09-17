/**
 * DE QUEM É A TELA — o recorte de unidade, fora do JSX e fora de uma tela só.
 *
 * Toda tela que honra escopo (ver `TELAS_QUE_HONRAM_ESCOPO`, em
 * `lib/navegacao-do-escopo.ts`) responde à mesma pergunta antes de desenhar
 * qualquer número: de que unidade é o que estou mostrando? A regra nasceu na
 * Cobertura de dados, onde a falta dela aparecia como contradição — cinco
 * unidades na matriz debaixo do nome de uma —, e mora aqui desde que a segunda
 * tela precisou dela: o histórico de Importações, que listava os envios de
 * todas as unidades enquanto a caixa "Unidade atual" nomeava uma.
 *
 * Duas cópias desta função seriam a mesma doença que ela veio curar, um nível
 * acima: nada obrigaria as duas a concordarem, e o dia em que discordassem
 * seria o dia em que duas telas do mesmo menu recortariam por unidades
 * diferentes sem que nada tivesse mudado no endereço.
 *
 * O recorte vem do endereço, e a ausência dele **não** significa "todas":
 * significa a unidade que a lateral já está anunciando — a mesma
 * `contextoAberto` que ela usa para se escrever. "Todas as unidades" continua
 * existindo e passou a ser dita: é `visaoGeral=1`, escrito por quem escolheu.
 *
 * Nada aqui lê a rede nem o React: contextos e endereço entrando, recorte
 * saindo. É o que deixa a regra testável sem montar tela.
 */

import { contextoAberto, type Contexto } from "@/lib/contextos";
import { visaoGeralAtiva } from "@/lib/navegacao-do-escopo";
import { lerRecorte } from "@/lib/recorte";

/** Uma das duas alturas: uma unidade, ou a soma de todas. */
export interface EscopoDaTela {
  /** A soma de todas as unidades, pedida por escrito. */
  visaoGeral: boolean;
  /** A unidade aberta — `undefined` na visão geral e enquanto não se sabe. */
  contexto: Contexto | undefined;
  /**
   * Ainda não dá para dizer de quem é a tela.
   *
   * Acontece num caso só: endereço sem `scopeHash` e `/contexts` em voo. Medir
   * agora devolveria o acervo inteiro e, um instante depois, a unidade — e o
   * primeiro número, o errado, é o que fica na memória de quem estava olhando.
   * A consulta espera; a tela diz que está medindo, que é a verdade.
   */
  indefinido: boolean;
}

/** O recorte que o endereço e a lista de contextos, juntos, determinam. */
export function escopoDaTela({
  contextos,
  carregando,
  pathname,
  search,
}: {
  contextos: Contexto[];
  carregando: boolean;
  pathname: string;
  search: string;
}): EscopoDaTela {
  if (visaoGeralAtiva(pathname, search)) {
    return { visaoGeral: true, contexto: undefined, indefinido: false };
  }

  const { scopeHash } = lerRecorte(search);
  const contexto = contextoAberto(contextos, scopeHash);
  /*
    Sem contexto e sem carregar é acervo vazio ou `/contexts` fora do ar. Nos
    dois a tela mede sem recorte — e, como não tem unidade para nomear, também
    não anuncia nenhuma: é a mesma recusa da lateral, que cala em vez de mentir.
  */
  return {
    visaoGeral: false,
    contexto,
    indefinido: contexto === undefined && scopeHash === null && carregando,
  };
}

