import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { DetalhesTecnicos } from "@/components/detalhes-tecnicos";
import { useAuth } from "@/lib/auth";
import { apresentar } from "@/lib/apresentar-erro";
import { consultarProntidao, PRONTIDAO_QUERY_KEY } from "@/lib/prontidao";

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
 * ---------------------------------------------------------------------------
 * O que ela mostra quando falha, e por que é **um** aviso
 * ---------------------------------------------------------------------------
 * Credencial errada, banco fora e servidor fora são três coisas diferentes e
 * recebem frases diferentes. Uma tela que responde "verifique suas
 * credenciais" quando o banco caiu manda a pessoa procurar no lugar errado.
 *
 * Esta tela já foi o único lugar do produto que mostrava **dois** avisos ao
 * mesmo tempo, e eles se contradiziam. Em cima, em âmbar, "O servidor não
 * respondeu — não é a sua senha: a API não está atendendo. Se isto persistir,
 * confira `/api/healthz`"; embaixo, em vermelho, doze linhas em que o servidor
 * respondia com muita precisão, nomeando três migrations e um comando `pnpm`.
 * Os dois estavam na tela de quem tinha digitado a senha certa. O de cima era
 * falso — o servidor tinha respondido —, o de baixo não era para aquela pessoa,
 * e nenhum dos dois dizia o que ela precisava saber.
 *
 * As duas caixas nasciam da mesma causa: esta tela escrevia diagnóstico por
 * conta própria, em vez de usar a função que decide isso para o produto
 * inteiro. Agora ela usa — `apresentar`, a mesma de todas as outras telas —, e
 * a invariante que aquela função sustenta ("uma orientação, nunca duas") passa
 * a valer aqui por construção, e não por alguém lembrar.
 */
export default function Login() {
  const { login, isSubmitting, erroDaSessao } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [erro, setErro] = useState<unknown>(null);

  /*
    **A falha que se apresenta é a mais recente, e é uma só.**

    Duas podem existir ao mesmo tempo: a de perguntar quem está logado (que
    acontece sozinha, ao abrir a tela) e a da tentativa de entrar. Elas quase
    sempre têm a mesma causa — o ambiente —, e mostrar as duas é o defeito que
    esta tela tinha. A da tentativa vence porque é a que responde ao gesto que a
    pessoa acabou de fazer.
  */
  const falha = erro ?? erroDaSessao;

  /*
    A pergunta que a tela faz sozinha quando alguma coisa falhou — no lugar de
    mandar alguém abrir `/api/healthz`. Só é feita quando há falha: um login
    que funciona não consulta prontidão nenhuma.
  */
  const { data: prontidao } = useQuery({
    queryKey: PRONTIDAO_QUERY_KEY,
    queryFn: ({ signal }) => consultarProntidao(signal),
    enabled: falha != null,
    retry: false,
    staleTime: 15_000,
  });

  const vista = falha == null ? null : apresentar(falha, prontidao);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    try {
      await login({ email, password });
    } catch (err) {
      setErro(err);
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
            Auditoria dos modelos que a Ambev entrega pelo Freightech — sem
            nunca exibir um número que não se consiga sustentar até a célula da
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

            {vista ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-2 min-w-0">
                  {/*
                    Uma frase, em português, sobre o que houve. Credencial
                    errada continua dizendo que a credencial está errada — é o
                    401 da rota, que não traz diagnóstico e chega aqui como
                    mensagem crua. O que mudou é o resto: banco fora, fila
                    atrasada e servidor fora deixaram de ser apresentados como
                    se fossem problema da senha de quem está entrando.
                  */}
                  <p>{vista.principal ?? vista.mensagemCrua}</p>
                  <DetalhesTecnicos detalhes={vista.detalhes} />
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full gap-2"
              disabled={isSubmitting}
            >
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
