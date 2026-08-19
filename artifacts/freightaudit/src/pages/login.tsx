import { useState, type FormEvent } from "react";
import { Logotipo } from "@/components/layout/logotipo";
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
 * A porta, e ela só sabe abrir para quem já tem conta.
 *
 * Não há cadastro aqui, nem link para um. Quem entra neste produto passa a
 * assinar confirmações de curadoria e promoções de vigência: dar acesso é um
 * ato de quem já tem acesso, feito em Configurações, e nunca auto-atendimento.
 * Houve por um tempo um "primeiro acesso" nesta tela — ele saiu, e o preço
 * declarado é que um ambiente novo depende do `create-user` no terminal para a
 * primeira conta.
 *
 * O que ela mostra quando falha importa tanto quanto o resto: credencial errada
 * e servidor fora são coisas diferentes e recebem frases diferentes. Uma tela
 * que responde "verifique suas credenciais" quando o banco caiu manda a pessoa
 * procurar no lugar errado.
 */
export default function Login() {
  const { login, isSubmitting, unreachable } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login({ email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    }
  }

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.1fr_1fr] bg-background">
      <aside className="hidden lg:flex flex-col justify-between bg-topbar text-topbar-foreground p-12">
        <Logotipo />

        <div className="max-w-md space-y-6">
          <h1 className="text-3xl font-bold tracking-tight leading-snug">
            O que mudou na remuneração, entre quais vigências, e quanto isso
            custa.
          </h1>
          <p className="text-white/80 leading-relaxed">
            Auditoria dos modelos que a Ambev entrega pelo Freightech — sem nunca
            exibir um número que não se consiga sustentar até a célula da
            planilha de origem.
          </p>
          <div className="flex items-start gap-3 text-sm text-white/70 border-t border-white/25 pt-6">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              Cada confirmação de semântica e cada promoção de vigência fica
              registrada no nome de quem entrou. É por isso que existe login.
            </p>
          </div>
        </div>

        <p className="text-xs text-white/50">
          Os dados aqui dentro são contratuais e ficam registrados no nome de
          quem os toca.
        </p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <Logotipo tom="escuro" className="lg:hidden mb-10" />

          <h2 className="text-2xl font-bold tracking-tight">Entrar</h2>
          <p className="text-muted-foreground text-sm mt-1.5 mb-8">
            Use a conta que já existe neste ambiente.
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
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
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
                  autoComplete="current-password"
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
              Entrar
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
            Sem conta, ou esqueceu a senha? Quem já tem acesso resolve as duas
            coisas em Configurações — este produto não tem auto-cadastro nem
            recuperação por e-mail.
          </p>
        </div>
      </main>
    </div>
  );
}
