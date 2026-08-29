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
  /** ADMIN gerencia contas; OPERADOR usa o produto. O servidor decide. */
  role: string;
}

/**
 * O nível de acesso a um módulo. `EDITAR` é o padrão de quem nunca teve uma
 * decisão tomada a respeito — ver `lib/permissoes.ts`.
 */
export type Nivel = "EDITAR" | "VISUALIZAR" | "SEM_ACESSO";

/**
 * A visualização aberta — um administrador olhando o produto como outra conta.
 *
 * `alvo` é quem `user` já é: durante uma visualização, `user` **é** a conta
 * visualizada, porque é ela que o menu e as telas seguem. O que este objeto
 * acrescenta é o que a interface não teria como saber sozinha — que a sessão é
 * de outra pessoa, e de quem.
 */
export interface Visualizacao {
  /** Quem está visualizando: o dono da sessão, que digitou a própria senha. */
  por: SessionUser;
  /** A conta visualizada — a mesma que está em `user`. */
  alvo: SessionUser;
  desde: string;
}

interface SessionState {
  user: SessionUser | null;
  /**
   * Só os módulos com decisão tomada. O que não está aqui vale o padrão, e ler
   * a ausência como bloqueio esvaziaria o menu de quem nunca foi restringido.
   */
  permissoes?: Record<string, Nivel>;
  /** Nulo é o estado normal: ninguém está visualizando ninguém. */
  visualizacao?: Visualizacao | null;
}

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

interface AuthContextValue {
  user: SessionUser | null;
  /** A primeira resposta ainda não chegou: não se sabe se há sessão. */
  isLoading: boolean;
  /**
   * A pergunta pela sessão falhou — e este campo é o **erro**, não um veredito.
   *
   * Chamava-se `unreachable` e valia `true` para qualquer falha de
   * `GET /auth/session`, inclusive uma resposta perfeitamente articulada do
   * servidor. Era o que punha, na mesma tela de login, "O servidor não
   * respondeu" logo acima de um 503 em que o servidor respondia com o
   * diagnóstico inteiro do ambiente: duas afirmações contraditórias, uma delas
   * falsa, sobre a mesma chamada.
   *
   * Quem decide o que isto significa é `apresentar` — a mesma função que decide
   * por todas as outras telas —, e ela recebe o erro. Um nome que já contém a
   * conclusão ("inalcançável") é um lugar onde a conclusão vai ser tirada duas
   * vezes.
   */
  erroDaSessao: unknown;
  /** As restrições que valem para quem está logado — ver `lib/permissoes.ts`. */
  permissoes: Record<string, Nivel>;
  /**
   * A visualização aberta, ou `null`. Quem a mostra é a faixa do topo
   * (`components/layout/visualizacao-como.tsx`) — e ela é a única coisa na
   * interface que diz que `user` não é quem está logado.
   */
  visualizacao: Visualizacao | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Abre o produto como outra conta. Só administrador; o servidor confere. */
  visualizarComo: (userId: string) => Promise<void>;
  /** Volta ao próprio perfil. Nunca falha por permissão — é desfazer. */
  pararDeVisualizar: () => Promise<void>;
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
    onSuccess: ({ user }) => {
      replaceSession({ user });
      /*
        O login responde quem entrou; quem responde o que essa pessoa alcança é
        `/auth/session`. Sem esta releitura o menu do primeiro instante depois
        do login seria o menu sem restrição nenhuma — e mostrar por um segundo
        exatamente os módulos que alguém decidiu tirar é pior do que demorar um
        segundo a mais para montá-lo.
      */
      void queryClient.refetchQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  /**
   * Trocar de conta visualizada é trocar de sessão para todos os efeitos que
   * importam aqui: o que está em cache foi lido com o acesso de outra pessoa.
   * Por isso as duas mutações abaixo passam por `replaceSession`, exatamente
   * como o login e o logout — e pela mesma razão.
   */
  const visualizarComo = useMutation({
    mutationFn: (userId: string) =>
      fetchJson<SessionState>("/auth/visualizar-como", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    onSuccess: (next) => replaceSession(next),
  });

  const pararDeVisualizar = useMutation({
    mutationFn: () =>
      fetchJson<SessionState>("/auth/visualizar-como/parar", { method: "POST" }),
    onSuccess: (next) => replaceSession(next),
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
    permissoes: session.data?.permissoes ?? {},
    visualizacao: session.data?.visualizacao ?? null,
    isLoading: session.isPending,
    erroDaSessao: session.isError ? session.error : null,
    login: async (input) => {
      await login.mutateAsync(input);
    },
    logout: async () => {
      await logout.mutateAsync();
    },
    visualizarComo: async (userId: string) => {
      await visualizarComo.mutateAsync(userId);
    },
    pararDeVisualizar: async () => {
      await pararDeVisualizar.mutateAsync();
    },
    isSubmitting:
      login.isPending ||
      logout.isPending ||
      visualizarComo.isPending ||
      pararDeVisualizar.isPending,
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
