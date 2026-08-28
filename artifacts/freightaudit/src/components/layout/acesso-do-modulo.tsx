import { Eye, Lock } from "lucide-react";
import { Link } from "wouter";
import { useLocalizacaoDoAmbiente } from "@/lib/ambiente-aberto";
import {
  moduloDaLocalizacao,
  nivelDe,
  usePermissoes,
  type Modulo,
  type Nivel,
} from "@/lib/permissoes";

/**
 * O que a casca faz quando a tela aberta é de um módulo restrito.
 *
 * Esconder o item no menu resolve o caminho comum; não resolve o endereço
 * digitado, o link colado no chat e a aba que ficou aberta desde antes da
 * decisão. Estes dois componentes são a resposta desses casos.
 *
 * **Sem acesso não mostra o conteúdo, e diz quem resolve.** A alternativa fácil
 * — mandar para a home — deixa a pessoa achando que o link está quebrado, e
 * quem administra o acesso nunca fica sabendo que ela tentou.
 *
 * **Somente leitura mostra a tela inteira, com a tira em cima.** Não há botão
 * escondido: quem recusa a alteração é o servidor, uma vez, para toda a API do
 * módulo — e uma interface que finge não ter o botão promete um bloqueio que
 * não é dela. A tira diz a verdade antes do clique; o 403 a repete depois, se
 * alguém insistir.
 */

export function useAcessoDoModulo(): {
  modulo: Modulo | null;
  nivel: Nivel;
} {
  const location = useLocalizacaoDoAmbiente();
  const { permissoes } = usePermissoes();
  const modulo = moduloDaLocalizacao(location);
  return {
    modulo,
    nivel: modulo ? nivelDe(permissoes, modulo.chave) : "EDITAR",
  };
}

export function SemAcesso({ modulo }: { modulo: Modulo }) {
  return (
    <div className="p-8">
      <div className="max-w-xl rounded-lg border bg-card p-6">
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <Lock className="w-5 h-5 text-muted-foreground" />
          {modulo.rotulo} está fora do seu acesso
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Um administrador definiu que a sua conta não abre este módulo. Ele
          também não aparece no menu — o endereço continua existindo, e é por
          isso que esta tela existe em vez de um erro.
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Quem muda isso abre{" "}
          <Link
            href="~/configuracoes/usuarios"
            className="text-primary hover:underline"
          >
            Configurações › Usuários › Permissões
          </Link>
          , escolhe a sua conta e devolve o módulo. A mudança fica registrada com
          o nome de quem a fez.
        </p>
      </div>
    </div>
  );
}

export function TiraDeSomenteLeitura({ modulo }: { modulo: Modulo }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50/70 px-8 py-2.5 text-sm text-amber-900">
      <Eye className="w-4 h-4 shrink-0 mt-0.5" />
      <span>
        O seu acesso a <strong>{modulo.rotulo}</strong> é somente leitura. Você vê
        tudo o que esta tela mostra; qualquer alteração é recusada pelo servidor,
        e não só escondida aqui.
      </span>
    </div>
  );
}
