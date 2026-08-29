import { Eye, Loader2, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

/**
 * A faixa laranja: você está vendo o produto como outra pessoa.
 *
 * Ela é a única coisa na interface que diz que o nome no canto superior direito
 * não é o de quem está logado — e por isso é a peça que torna o "visualizar
 * como" aceitável. Sem ela, um administrador que se distraísse concluiria que o
 * menu dele encolheu, que uma tela sumiu, que o produto quebrou; e um número
 * lido nessa tela seria atribuído à conta errada por quem o anotasse.
 *
 * Por isso ela é **larga, colorida e fixa no topo**, e não um selo discreto: o
 * estado que ela anuncia muda o significado de tudo o que está embaixo. O botão
 * de saída fica dentro dela, na mesma faixa, porque desfazer tem de estar onde
 * está o aviso — quem se assusta olha para cá, não para o menu.
 *
 * A volta leva a Configurações › Usuários, que é de onde a visualização
 * começou: quem entrou ali para conferir o acesso de uma conta quase sempre vai
 * conferir a próxima, e devolver a pessoa à home a faria refazer o caminho.
 */
export function FaixaDeVisualizacao() {
  const { visualizacao, pararDeVisualizar, isSubmitting } = useAuth();
  const [, navegar] = useLocation();

  if (!visualizacao) return null;

  return (
    <div
      /*
        `sticky` logo abaixo da faixa do topo (`h-16`), e com `z` menor que o
        dela: a faixa acompanha a rolagem porque o aviso não pode sair de vista
        no meio de uma tela longa — é justamente lá embaixo, depois de rolar,
        que se esquece de quem é a sessão.
      */
      className="sticky top-16 z-30 flex items-center gap-3 bg-amber-500 px-4 py-2.5 text-sm text-white shadow-sm"
      role="status"
    >
      <Eye className="w-4 h-4 shrink-0" />
      <span className="min-w-0 truncate">
        <strong>{visualizacao.por.name}</strong> visualizando como:{" "}
        <strong>{visualizacao.alvo.name}</strong>
        <span className="hidden md:inline">
          {" "}
          — esta sessão só lê; nada aqui altera nada.
        </span>
      </span>

      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => {
          void pararDeVisualizar().then(() => {
            navegar("~/configuracoes/usuarios");
          });
        }}
        className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25 transition-colors disabled:opacity-60"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <X className="w-4 h-4" />
        )}
        Voltar ao meu perfil
      </button>
    </div>
  );
}
