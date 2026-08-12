import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * A sessão, do lado da interface.
 *
 * O servidor é quem decide: o cookie é `httpOnly`, então este código nunca vê o
 * token e não tem como "achar" que está logado. Tudo o que ele faz é perguntar
 * — `GET /auth/session` — e mostrar a tela correspondente à resposta. É por
 * isso que não existe nada de sessão em `localStorage` aqui: um estado guardado
 * no navegador seria uma segunda fonte da verdade, e a errada.
 *
 * Entrar é a única coisa que se faz sem sessão. Criar conta não está aqui e não
 * está em tela nenhuma que se alcance deslogado — nasce em Configurações, por
 * quem já entrou.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

interface SessionState {
  user: SessionUser | null;
}

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

interface AuthContextValue {
  user: SessionUser | null;
  /** A primeira resposta ainda não chegou: não se sabe se há sessão. */
  isLoading: boolean;
  /** A pergunta não chegou ao servidor. Diferente de "não está logado". */
  unreachable: Error | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  isSubmitting: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => fetchJson<SessionState>("/auth/session"),
    /**
     * Reperguntar não é paranoia: a sessão pode morrer no servidor — expirou,
     * alguém saiu em outra aba, a conta foi desativada, a senha foi trocada — e
     * sem isto a tela continuaria mostrando um sistema que já não responde
     * mais nada.
     */
    refetchOnWindowFocus: true,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 30_000,
    retry: 1,
  });

  /**
   * Trocar de sessão joga fora o cache inteiro.
   *
   * O que está em memória foi lido *como* outra pessoa. Manter aquilo na tela
   * depois de entrar ou sair mostraria dados de uma sessão dentro de outra —
   * num produto de auditoria, o pior tipo de confusão.
   */
  function replaceSession(next: SessionState) {
    queryClient.clear();
    queryClient.setQueryData(SESSION_QUERY_KEY, next);
  }

  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      fetchJson<SessionState>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ user }) => replaceSession({ user }),
  });

  const logout = useMutation({
    mutationFn: () =>
      fetchJson<SessionState>("/auth/logout", { method: "POST" }),
    // Mesmo se o pedido falhar, a tela volta para o login: o servidor apaga a
    // sessão ou ela expira sozinha, e ficar preso numa tela que não responde
    // seria pior.
    onSettled: () => replaceSession({ user: null }),
  });

  const value: AuthContextValue = {
    user: session.data?.user ?? null,
    isLoading: session.isPending,
    unreachable: session.isError ? (session.error as Error) : null,
    login: async (input) => {
      await login.mutateAsync(input);
    },
    logout: async () => {
      await logout.mutateAsync();
    },
    isSubmitting: login.isPending || logout.isPending,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  }
  return context;
}
