import { useCallback, useState } from "react";
import { useEmpresas } from "@/lib/fluxos";

/**
 * A EMPRESA DOS FLUXOS — resolvida, não perguntada.
 *
 * Um fluxo pertence a uma empresa (a unidade canônica, por CNPJ), e o servidor
 * escopa toda leitura e toda escrita por ela. A tela precisa dizer qual é — mas
 * **não é por unidade que se procura um processo**. Quem abre Fluxos
 * Operacionais procura "o financeiro", "o faturamento": a categoria. A unidade
 * é cadastro, e um seletor dela na barra pedia um clique para uma decisão que
 * ninguém estava tomando ali.
 *
 * Por isso não há seletor: a empresa é resolvida sozinha, aqui e em
 * `resolverEmpresa`, no servidor. Vale a lembrada entre visitas; na falta dela,
 * a primeira da lista (ordenada por nome, a mesma ordem do servidor). Escolher
 * nunca foi pré-requisito para mapear um processo — antes, "nenhuma escolhida"
 * desligava as consultas e apagava a tela inteira: lista vazia, "Novo fluxo"
 * cinza e, ao abrir um fluxo pelo endereço, uma página em branco.
 */

/**
 * Onde a escolha é lembrada.
 *
 * A lista e a tela de um fluxo são duas rotas, e cada uma monta o seu próprio
 * estado. Sem um lugar comum, uma empresa escolhida na lista e um fluxo aberto
 * em seguida sairiam de empresas diferentes — que é exatamente o pedido que o
 * servidor recusa, aparecendo como "este fluxo não existe".
 *
 * Hoje nenhuma tela chama `escolher` (a barra filtra por categoria, não por
 * unidade), então a memória fica sem escritor e vale sempre o padrão da lista.
 * O seam continua aqui de propósito: é por onde a troca de unidade volta, se
 * voltar, sem que as duas rotas discordem de novo.
 *
 * `localStorage` pode lançar (navegação privada, cookies bloqueados), e a falha
 * não pode derrubar a tela: sem memória, vale o padrão da lista.
 */
const CHAVE_DA_EMPRESA = "fluxos.empresa";

function empresaLembrada(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_DA_EMPRESA);
  } catch {
    return null;
  }
}

/**
 * A empresa destas telas — a lembrada, ou a primeira cadastrada.
 *
 * Devolve `null` só enquanto a lista não chegou, e quando não há nenhuma
 * unidade cadastrada. As consultas ficam desligadas nesses dois casos
 * (`enabled: empresaId !== null`), que é o que impede a tela de disparar uma
 * chamada sem escopo e de mostrar a recusa como se fosse um defeito.
 */
export function useEmpresaDosFluxos(): {
  empresaId: string | null;
  escolher: (id: string) => void;
  semEmpresaCadastrada: boolean;
  carregando: boolean;
} {
  const empresas = useEmpresas();
  const lista = empresas.data ?? [];
  const [escolhida, setEscolhida] = useState<string | null>(() => empresaLembrada());

  const escolher = useCallback((id: string) => {
    setEscolhida(id);
    try {
      window.localStorage.setItem(CHAVE_DA_EMPRESA, id);
    } catch {
      /* Sem memória entre visitas; a escolha desta sessão continua valendo. */
    }
  }, []);

  const valida = escolhida !== null && lista.some((e) => e.id === escolhida);

  return {
    empresaId: valida ? escolhida : (lista.length > 0 ? lista[0].id! : null),
    escolher,
    semEmpresaCadastrada: empresas.isSuccess && lista.length === 0,
    carregando: empresas.isLoading,
  };
}
