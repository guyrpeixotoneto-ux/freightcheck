import { hashKey, type QueryKey } from "@tanstack/react-query";

import { enderecoAberto } from "@/lib/api";
import { ambienteDe } from "@/lib/ambiente";

/**
 * **O cache é por ambiente — a outra metade do isolamento.**
 *
 * `getApiUrl` carimba `?operacao=` e `?ambiente=` em toda chamada deste produto
 * (`lib/api.ts`), e é isso que faz a Auditoria Rota perguntar pelo acervo da
 * rota e a Empurrada pelo da empurrada. O carimbo estava certo e o defeito
 * continuava existindo, porque faltava dizer a mesma coisa ao React Query: a
 * **chave** da consulta não sabia de qual ambiente era a resposta que ela
 * guardava. `["contexts"]` na Empurrada e `["contexts"]` no Rota são, para a
 * biblioteca, a mesma consulta — um objeto `Query` só, com **uma** resposta.
 *
 * O que se via na tela, e é o defeito que este módulo fecha:
 *
 *   1. na Auditoria Empurrada, a lateral lista as unidades de `/contexts`;
 *   2. troca-se para a Auditoria Rota, que ainda não tem vigência nenhuma; a
 *      resposta vazia — legítima, do acervo de rota — é gravada em
 *      `["contexts"]`, **por cima** da lista da empurrada;
 *   3. volta-se para a Empurrada e a caixa "Unidade atual" continua dizendo
 *      "Nenhuma vigência importada": a chave já tem dado, e dado que a casca
 *      considera fresco por 60s (`useContextosDaCasca`).
 *
 * E ficava assim por muito tempo, não por um instante: o `Layout` nunca
 * desmonta (ver `App.tsx`), então `refetchOnMount` não alcança a lateral nem os
 * contadores do menu — a lista só voltava quando o `staleTime` vencia e algum
 * foco de janela disparava a releitura. Foi exatamente o relato: "voltei para a
 * Empurrada e não voltou ao normal; depois voltou, mas demorou muito".
 *
 * **A correção é uma chave por ambiente, e não uma chave escrita à mão em cada
 * consulta.** São mais de duzentas `queryKey` na aplicação; a que alguém
 * esquecesse seria uma tela de Rota servida do cache da Empurrada — sem erro
 * nenhum na tela, que é a forma mais cara de essa regressão aparecer. É o mesmo
 * raciocínio, e o mesmo lugar, do carimbo da chamada: o recorte entra no único
 * ponto por onde todas passam. Aqui esse ponto é o `queryKeyHashFn` do
 * `QueryClient` (`PADRAO_DAS_CONSULTAS`, em `lib/chamada-resiliente.ts`).
 *
 * O recorte é o **ambiente**, e não a operação, porque é o que a chamada
 * carrega: `?ambiente=` viaja nos oito, `?operacao=` nos quatro de auditoria.
 * Recortar por operação deixaria a Auditoria Rota e o Fechamento Rota
 * dividindo cache — dois espaços de trabalho, com telas e acessos separados,
 * respondendo um pelo outro.
 *
 * **Nada é jogado fora na troca.** O cache do ambiente anterior continua lá,
 * sob a chave dele: quem volta para a Empurrada reencontra a lista na hora, e o
 * `staleTime` padrão de 0 já manda buscar de novo por baixo. Limpar o cache na
 * troca resolveria a mistura e cobraria uma tela em branco de quem vai e volta.
 *
 * **O que sobrevive à troca é a sessão**, e é a única exceção — ver
 * {@link CHAVES_DE_TODO_O_PRODUTO}.
 */

/**
 * As chaves que **não** são de ambiente nenhum.
 *
 * A sessão (`lib/auth.tsx`) responde quem está logado e o que essa pessoa
 * alcança, e vale igual nos oito ambientes. Recortá-la faria a troca de
 * ambiente cair numa chave sem dado — sem usuário e sem permissões por um
 * instante —, e o que aparece nesse instante é a tela de login por cima de uma
 * sessão perfeitamente válida. Um refetch a mais é barato; esse piscar não é.
 *
 * A lista é curta de propósito. O padrão é isolar; quem entra aqui é quem
 * **perde** alguma coisa ao ser isolado, e não quem apenas não ganharia nada.
 * Um cadastro que vale para o produto inteiro (unidades, contas) isolado por
 * ambiente custa uma releitura na troca, e releitura não é defeito.
 */
export const CHAVES_DE_TODO_O_PRODUTO: readonly string[] = ["auth"];

/**
 * A chave, com o ambiente dentro — função pura sobre a chave e o endereço.
 *
 * Pura, e com o endereço como argumento, pela mesma razão de `comOperacao`: a
 * regra vale para os oito ambientes sem montar navegador nenhum, e é assim que
 * o teste a exercita.
 */
export function hashDaChaveNoAmbiente(chave: QueryKey, endereco: string): string {
  const raiz = chave[0];
  if (typeof raiz === "string" && CHAVES_DE_TODO_O_PRODUTO.includes(raiz)) {
    return hashKey(chave);
  }
  /*
    O ambiente entra como um elemento a mais no fim, e não concatenado ao texto
    do hash: assim ele passa pelo mesmo `JSON.stringify` estável que o React
    Query usa, e uma chave que já termine com a palavra "auditoria-rota" não
    produz o mesmo hash de outra recortada nela.
  */
  return hashKey([...chave, { ambiente: ambienteDe(endereco) }]);
}

/** O mesmo cálculo, sobre o endereço aberto — o que o `QueryClient` recebe. */
export function hashDaChave(chave: QueryKey): string {
  return hashDaChaveNoAmbiente(chave, enderecoAberto());
}
