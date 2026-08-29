import { Eye, Lock } from "lucide-react";
import { Link } from "wouter";
import { descricaoDoAmbiente } from "@/lib/ambiente";
import { useLocalizacaoDoAmbiente } from "@/lib/ambiente-aberto";
import {
  acessoDaLocalizacao,
  usePermissoes,
  type AcessoDaTela,
} from "@/lib/permissoes";

/**
 * O que a casca faz quando a tela aberta é de um módulo — ou de um ambiente —
 * restrito.
 *
 * Esconder o item no menu resolve o caminho comum; não resolve o endereço
 * digitado, o link colado no chat e a aba que ficou aberta desde antes da
 * decisão. Estes componentes são a resposta desses casos.
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
 *
 * **E o aviso diz qual dos dois eixos fechou a porta.** Um ambiente inteiro
 * fora do alcance e uma tela fora do alcance são recusas diferentes, com
 * saídas diferentes: da primeira se sai trocando de ambiente no topo, da
 * segunda não se sai. Dizer "este módulo não é seu" a quem está inteiro fora do
 * Fechamento AS manda procurar no lugar errado.
 */

export function useAcessoDoModulo(): AcessoDaTela {
  const location = useLocalizacaoDoAmbiente();
  const { permissoes } = usePermissoes();
  return acessoDaLocalizacao(permissoes, location);
}

/**
 * O nome do que está fechado, e é sempre o eixo mais largo que fechou.
 *
 * Quando o ambiente inteiro está fora, é ele que a frase nomeia — mesmo que o
 * módulo também esteja restrito. Quem está fora do Fechamento AS não ganha nada
 * sabendo que, além disso, Competências foi tirada dele.
 */
function oQueEstaFechado(acesso: AcessoDaTela): string {
  if (acesso.ambiente && acesso.doAmbiente !== "EDITAR") {
    return descricaoDoAmbiente(acesso.ambiente).nomeCompleto;
  }
  return acesso.modulo?.rotulo ?? "Esta tela";
}

export function SemAcesso({ acesso }: { acesso: AcessoDaTela }) {
  const ambienteFechado =
    acesso.ambiente !== null && acesso.doAmbiente === "SEM_ACESSO";

  return (
    <div className="p-8">
      <div className="max-w-xl rounded-lg border bg-card p-6">
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <Lock className="w-5 h-5 text-muted-foreground" />
          {oQueEstaFechado(acesso)} está fora do seu acesso
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {ambienteFechado
            ? `Um administrador definiu que a sua conta não trabalha neste ambiente. Ele também não aparece no seletor do topo — o endereço continua existindo, e é por isso que esta tela existe em vez de um erro.`
            : `Um administrador definiu que a sua conta não abre este módulo. Ele também não aparece no menu — o endereço continua existindo, e é por isso que esta tela existe em vez de um erro.`}
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Quem muda isso abre{" "}
          <Link
            href="~/configuracoes/permissoes"
            className="text-primary hover:underline"
          >
            Configurações › Permissões
          </Link>
          , escolhe a sua conta e devolve o acesso. A mudança fica registrada com
          o nome de quem a fez.
        </p>
      </div>
    </div>
  );
}

export function TiraDeSomenteLeitura({ acesso }: { acesso: AcessoDaTela }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50/70 px-8 py-2.5 text-sm text-amber-900">
      <Eye className="w-4 h-4 shrink-0 mt-0.5" />
      <span>
        O seu acesso a <strong>{oQueEstaFechado(acesso)}</strong> é somente
        leitura. Você vê tudo o que esta tela mostra; qualquer alteração é
        recusada pelo servidor, e não só escondida aqui.
      </span>
    </div>
  );
}
