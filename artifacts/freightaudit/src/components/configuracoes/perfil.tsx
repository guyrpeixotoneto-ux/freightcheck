import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Copy, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Meu Perfil — quem a pessoa é, como o produto a conhece.
 *
 * Ela nasce de uma separação que a tela única não fazia: gerir contas é
 * trabalho de administrador; olhar a própria conta é de qualquer pessoa que
 * entrou. Enquanto as duas coisas dividiam a mesma aba, quem só queria a
 * segunda passava por uma lista inteira de pessoas para chegar nela — e um
 * operador via a lista de contas sem ter uma única ação sobre ela.
 *
 * **A troca da senha saiu daqui e virou Segurança**
 * (`components/configuracoes/seguranca.tsx`). Esta tela ficou sendo o que ela
 * sempre foi de fato — quatro linhas de leitura sobre a conta —, e a única
 * operação que a pessoa faz sozinha deixou de morar no pé de uma folha de
 * consulta, que é onde menos se procura por ela. O link para o novo lugar fica
 * no fim desta, para quem chegar aqui por hábito.
 *
 * **Não há formulário de nome nem de e-mail, e a ausência é o assunto.** Os dois
 * campos são o que assina cada confirmação de curadoria e cada promoção de
 * vigência já feitas; deixá-los editáveis aqui trocaria, retroativamente, o
 * nome de quem assinou um histórico. Quem precisa corrigir um nome pede a um
 * administrador — e a mudança fica no nome de quem a fez.
 */

export function PainelDoPerfil() {
  const { user: me } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            A sua conta
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            É este nome que assina cada confirmação de curadoria e cada promoção
            de vigência feita por você. Corrigi-lo é trabalho de um
            administrador, em Usuários.
          </p>
        </CardHeader>
        <CardContent>
          {me === null ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Linha rotulo="Nome">{me.name}</Linha>
              <Linha rotulo="E-mail">
                <span className="font-mono text-sm">{me.email}</span>
              </Linha>
              <Linha rotulo="Papel">
                {me.role === "ADMIN"
                  ? "Administrador — usa o produto e gerencia contas"
                  : "Operador — usa o produto"}
              </Linha>
              <Linha rotulo="ID da conta">
                <IdDaConta id={me.id} />
              </Linha>
            </dl>
          )}
        </CardContent>
      </Card>

      {/*
        A senha saiu daqui e virou seção — `Segurança`. Esta linha é o que
        impede a mudança de esconder a operação de quem já sabia onde ela
        ficava: quem vem trocar a senha chega em Meu Perfil por hábito, e sai
        daqui em um clique, em vez de voltar ao índice para descobrir o novo
        lugar.
      */}
      <Link
        href="~/configuracoes/seguranca"
        className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        Trocar a minha senha, em Segurança
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </dt>
      <dd className="mt-0.5 font-medium truncate">{children}</dd>
    </div>
  );
}

/**
 * O identificador da conta no banco.
 *
 * O e-mail é quem a pessoa é para o produto; o `id` é quem ela é para as rotas
 * — `/users/:id/password`, o `user_id` das sessões. São dois nomes para a mesma
 * pessoa, e até existir esta linha quem precisava do segundo tinha que abrir o
 * banco. Quem procura um id procura o seu, e é o seu que está aqui.
 */
function IdDaConta({ id }: { id: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    await navigator.clipboard.writeText(id);
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <code className="text-xs text-muted-foreground/80 font-mono truncate">
        {id}
      </code>
      <button
        type="button"
        onClick={copiar}
        aria-label={copiado ? "ID copiado" : "Copiar ID da conta"}
        className={cn(
          "p-1 rounded-sm shrink-0 text-muted-foreground/70 transition-colors",
          "hover:text-foreground hover:bg-muted",
        )}
      >
        {copiado ? (
          <Check className="w-3 h-3 text-emerald-600" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </span>
  );
}
