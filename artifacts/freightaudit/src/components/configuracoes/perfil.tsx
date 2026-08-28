import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, Refusal, post } from "@/components/configuracoes/campos";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Meu Perfil — a única seção da casa que um operador mexe sozinho.
 *
 * Ela nasce de uma separação que a tela única não fazia: gerir contas é
 * trabalho de administrador; trocar a própria senha é de qualquer pessoa que
 * entrou. Enquanto as duas coisas dividiam a mesma aba, quem só queria a
 * segunda passava por uma lista inteira de pessoas para chegar nela — e um
 * operador via a lista de contas sem ter uma única ação sobre ela.
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

      <MinhaSenha />
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

/**
 * A troca da própria senha.
 *
 * Exige a atual mesmo com a sessão aberta, e derruba as outras sessões da
 * pessoa — que é o que se quer quando se troca uma senha por desconfiança.
 */
function MinhaSenha() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => post("/auth/password", { currentPassword, newPassword }),
    onSuccess: () => {
      setError(null);
      setDone(true);
      setCurrent("");
      setNew("");
    },
    onError: (err: Error) => {
      setDone(false);
      setError(err.message);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          Minha senha
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Trocar aqui encerra as suas outras sessões — esta aba continua aberta.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="flex items-end gap-4 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Senha atual" htmlFor="current-password">
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className="w-56"
              required
            />
          </Field>
          <Field label="Senha nova" htmlFor="next-password">
            <Input
              id="next-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              autoComplete="new-password"
              placeholder="mínimo 10 caracteres"
              className="w-56"
              required
            />
          </Field>
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? "Trocando…" : "Trocar senha"}
          </Button>
        </form>

        {error && <div className="mt-4"><Refusal>{error}</Refusal></div>}
        {done && (
          <p className="flex items-center gap-2 text-sm text-emerald-700 mt-4">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Senha trocada.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

