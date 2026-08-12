import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";

/**
 * A sessão, do lado da interface.
 *
 * O servidor é quem decide: o cookie é `httpOnly`, então este código nunca vê o
 * token e não tem como "achar" que está logado. Tudo o que ele faz é perguntar
 * — `GET /auth/session` — e mostrar a tela correspondente à resposta. É por
 * isso que não existe nada de sessão em `localStorage` aqui: um estado guardado
 * no navegador seria uma segunda fonte da verdade, e a errada.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

interface SessionState {
  user: SessionUser | null;
  /** Nenhuma conta existe neste ambiente: a tela oferece o primeiro acesso. */
  needsSetup: boolean;
}

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

async function readServerError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function fetchSession(): Promise<SessionState> {
  const response = await fetch(getApiUrl("/auth/session"));
  if (!response.ok) {
    throw new Error(
      await readServerError(
        response,
        "O servidor não respondeu quem está logado.",
      ),
    );
  }
  return (await response.json()) as SessionState;
}

async function postAuth(
  path: string,
  body: unknown,
): Promise<{ user: SessionUser }> {
  const response = await fetch(getApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      await readServerError(response, "Não foi possível concluir o pedido."),
    );
  }
  return (await response.json()) as { user: SessionUser };
}

interface AuthContextValue {
  user: SessionUser | null;
  needsSetup: boolean;
  /** A primeira resposta ainda não chegou: não se sabe se há sessão. */
  isLoading: boolean;
  /** A pergunta não chegou ao servidor. Diferente de "não está logado". */
  unreachable: Error | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  setup: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  isSubmitting: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    /**
     * Reperguntar não é paranoia: a sessão pode morrer no servidor — expirou,
     * alguém saiu em outra aba, a conta foi desativada — e sem isto a tela
     * continuaria mostrando um sistema que já não responde mais nada.
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
      postAuth("/auth/login", input),
    onSuccess: ({ user }) => replaceSession({ user, needsSetup: false }),
  });

  const setup = useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      postAuth("/auth/setup", input),
    onSuccess: ({ user }) => replaceSession({ user, needsSetup: false }),
  });

  const logout = useMutation({
    mutationFn: async () => {
      await fetch(getApiUrl("/auth/logout"), { method: "POST" });
    },
    // Mesmo se o pedido falhar, a tela volta para o login: o servidor apaga a
    // sessão ou ela expira sozinha, e ficar preso numa tela que não responde
    // seria pior.
    onSettled: () => replaceSession({ user: null, needsSetup: false }),
  });

  const value: AuthContextValue = {
    user: session.data?.user ?? null,
    needsSetup: session.data?.needsSetup ?? false,
    isLoading: session.isPending,
    unreachable: session.isError ? (session.error as Error) : null,
    login: async (input) => {
      await login.mutateAsync(input);
    },
    setup: async (input) => {
      await setup.mutateAsync(input);
    },
    logout: async () => {
      await logout.mutateAsync();
    },
    isSubmitting: login.isPending || setup.isPending || logout.isPending,
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
