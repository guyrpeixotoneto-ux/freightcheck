import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

/**
 * A porta.
 *
 * Ela tem dois estados, e quem decide qual é o servidor: quando o ambiente
 * ainda não tem nenhuma conta, esta tela é o cadastro da primeira; a partir daí
 * é o login e só. Não há link para "criar conta" no modo de login — quem entra
 * neste produto passa a assinar confirmações de curadoria e promoções de
 * vigência, e isso não é auto-atendimento.
 *
 * O que ela mostra quando falha importa tanto quanto o resto: credencial errada
 * e servidor fora são coisas diferentes e recebem frases diferentes. Uma tela
 * que responde "verifique suas credenciais" quando o banco caiu manda a pessoa
 * procurar no lugar errado.
 */
export default function Login() {
  const { needsSetup, login, setup, isSubmitting, unreachable } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (needsSetup) {
        await setup({ name, email, password });
      } else {
        await login({ email, password });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    }
  }

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.1fr_1fr] bg-background">
      <aside className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-12">
        <div className="font-bold text-xl tracking-tight flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <span className="font-sans font-bold">F</span>
          </div>
          FREIGHTCHECK
        </div>

        <div className="max-w-md space-y-6">
          <h1 className="text-3xl font-bold tracking-tight leading-snug">
            O que mudou na remuneração, entre quais vigências, e quanto isso
            custa.
          </h1>
          <p className="text-sidebar-foreground/70 leading-relaxed">
            Auditoria dos modelos que a Ambev entrega pelo Freightec — sem nunca
            exibir um número que não se consiga sustentar até a célula da
            planilha de origem.
          </p>
          <div className="flex items-start gap-3 text-sm text-sidebar-foreground/60 border-t border-sidebar-border pt-6">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              Cada confirmação de semântica e cada promoção de vigência fica
              registrada no nome de quem entrou. É por isso que existe login.
            </p>
          </div>
        </div>

        <p className="text-xs text-sidebar-foreground/40">
          Uso interno. Os dados aqui dentro são contratuais.
        </p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden font-bold text-xl tracking-tight flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center">
              <span className="font-sans font-bold">F</span>
            </div>
            FREIGHTCHECK
          </div>

          <h2 className="text-2xl font-bold tracking-tight">
            {needsSetup ? "Primeiro acesso" : "Entrar"}
          </h2>
          <p className="text-muted-foreground text-sm mt-1.5 mb-8">
            {needsSetup
              ? "Ainda não existe conta neste ambiente. A que você criar agora será a primeira, e depois disso esta tela vira o login."
              : "Use a conta que já existe neste ambiente."}
          </p>

          {unreachable ? (
            <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 mb-6 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="font-medium">O servidor não respondeu.</p>
                <p className="text-muted-foreground mt-0.5">
                  Não é a sua senha: a API não está atendendo. Se isto persistir,
                  confira <code className="font-mono text-xs">/api/healthz</code>.
                </p>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsSetup ? (
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Como você assina uma confirmação"
                  required
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus={!needsSetup}
                placeholder="voce@empresa.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    needsSetup ? "new-password" : "current-password"
                  }
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {needsSetup ? (
                <p className="text-xs text-muted-foreground">
                  Pelo menos 10 caracteres. Não há recuperação de senha nesta
                  versão — guarde-a.
                </p>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              {needsSetup ? "Criar conta e entrar" : "Entrar"}
            </Button>
          </form>

          {!needsSetup ? (
            <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
              Sem conta? Contas são criadas por quem administra este ambiente —
              este produto não tem auto-cadastro depois da primeira.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
