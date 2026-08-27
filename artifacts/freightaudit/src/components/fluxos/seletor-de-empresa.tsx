import { useCallback, useState } from "react";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEmpresas } from "@/lib/fluxos";

/**
 * O SELETOR DE EMPRESA — e por que ele nunca bloqueia o trabalho.
 *
 * Um fluxo pertence a uma empresa (a unidade canônica, por CNPJ), e o servidor
 * escopa toda leitura e toda escrita por ela. A tela precisa dizer qual é.
 *
 * Numa instalação com **uma** unidade cadastrada, um seletor de uma opção só é
 * ruído puro: ocupa a barra, pede um clique e não oferece escolha. Então ele
 * não aparece, e a empresa é resolvida sozinha dos dois lados: aqui e em
 * `resolverEmpresa`, no servidor.
 *
 * Com duas ou mais ele aparece — mas **escolher não é pré-requisito para
 * mapear um processo**. Antes, "nenhuma escolhida" desligava as consultas e
 * apagava a tela inteira: lista vazia, "Novo fluxo" cinza e, ao abrir um fluxo
 * pelo endereço, uma página em branco onde "Nova etapa" não abria nada. Um
 * módulo que existe para descrever processos não pode exigir uma decisão de
 * cadastro antes da primeira frase.
 *
 * Então há um padrão: a primeira unidade da lista (ordenada por nome, a mesma
 * ordem do servidor). O seletor continua trocando, a troca é lembrada entre as
 * telas e entre visitas, e a empresa do fluxo fica sempre visível na barra —
 * ninguém grava às cegas, e ninguém fica parado.
 */
export function SeletorDeEmpresa({
  empresaId,
  aoTrocar,
}: {
  empresaId: string | null;
  aoTrocar: (id: string) => void;
}) {
  const empresas = useEmpresas();
  const lista = empresas.data ?? [];

  if (lista.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={empresaId ?? ""} onValueChange={aoTrocar}>
        <SelectTrigger className="w-[220px]" aria-label="Empresa">
          <SelectValue placeholder="Escolha a empresa" />
        </SelectTrigger>
        <SelectContent>
          {lista.map((empresa) => (
            <SelectItem key={empresa.id!} value={empresa.id!}>
              {empresa.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Onde a escolha é lembrada.
 *
 * A lista e a tela de um fluxo são duas rotas, e cada uma monta o seu próprio
 * estado. Sem um lugar comum, trocar de empresa na lista e clicar num fluxo
 * abriria o fluxo com a empresa anterior — que é exatamente o pedido que o
 * servidor recusa, aparecendo como "este fluxo não existe".
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
