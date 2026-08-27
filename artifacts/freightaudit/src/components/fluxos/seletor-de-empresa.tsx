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
 * O SELETOR DE EMPRESA — e por que ele some quando só há uma.
 *
 * Um fluxo pertence a uma empresa (a unidade canônica, por CNPJ), e o servidor
 * escopa toda leitura e toda escrita por ela. A tela precisa dizer qual é.
 *
 * Numa instalação com **uma** unidade cadastrada — que é o caso hoje — um
 * seletor de uma opção só é ruído puro: ocupa a barra, pede um clique e não
 * oferece escolha. Então ele não aparece, e a empresa é resolvida sozinha, dos
 * dois lados: aqui e em `resolverEmpresa`, no servidor.
 *
 * Com duas ou mais, ele aparece e **nada é adivinhado**: nem aqui, nem lá. O
 * servidor recusa a chamada sem escopo pedindo a escolha, em vez de responder
 * pela primeira que encontrar.
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
 * A empresa escolhida — a única sozinha, ou a que a pessoa selecionou.
 *
 * Devolve `null` enquanto a lista não chegou, e as consultas ficam desligadas
 * até lá (`enabled: empresaId !== null`). É o que impede a tela de disparar uma
 * chamada sem escopo que o servidor recusaria — e de mostrar aquela recusa como
 * se fosse um problema.
 */
export function useEmpresaEscolhida(escolhida: string | null): {
  empresaId: string | null;
  semEmpresaCadastrada: boolean;
  carregando: boolean;
} {
  const empresas = useEmpresas();
  const lista = empresas.data ?? [];
  const valida = escolhida !== null && lista.some((e) => e.id === escolhida);

  return {
    empresaId: valida ? escolhida : (lista.length === 1 ? lista[0].id! : null),
    semEmpresaCadastrada: empresas.isSuccess && lista.length === 0,
    carregando: empresas.isLoading,
  };
}
