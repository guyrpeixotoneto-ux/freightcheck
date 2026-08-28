import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  RotateCcw,
  Settings,
  UserPlus,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PainelDeUnidades } from "@/pages/unidades";
import { PermissoesCard } from "@/components/configuracoes/permissoes";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Configurações — a casa inteira numa tela só: unidades e acesso.
 *
 * Eram três entradas na Administração — Unidades, Usuários e uma
 * "Configurações" que não existia (apontava para `/ajustes`, uma tela em
 * preparo). A terceira saiu do menu com o seu verbete do catálogo, e as duas
 * que restaram viraram abas daqui: quem abre a casa quer o cadastro *ou* o
 * acesso, e escolher entre dois itens de menu para isso é um passo que a aba
 * resolve sem tirar ninguém do lugar.
 *
 * `/unidades` continua sendo endereço válido — está em link compartilhado e no
 * "voltar para a casa" de `lib/ambiente-aberto.ts` — e abre esta mesma tela com
 * a aba Unidades já aberta. É a razão de `abaInicial` existir: a rota escolhe a
 * aba, e nenhum link antigo cai no vazio.
 *
 * Esta tela existe porque o login existe: a partir do momento em que entrar é
 * necessário, dar e tirar acesso vira trabalho do produto, e trabalho de
 * produto não se faz por `psql`.
 *
 * Duas ausências deliberadas. Não há botão de excluir: o `actor` das
 * confirmações já feitas aponta para estas pessoas, e apagar uma linha
 * transformaria um histórico auditável num e-mail órfão — desativar tira o
 * acesso e preserva o histórico. Há dois papéis, e só dois: ADMIN gerencia
 * contas; OPERADOR usa o produto. Quem decide é o servidor — aqui a gestão
 * fica escondida de quem não pode usá-la, em vez de renderizada para falhar —
 * sem sugerir uma hierarquia por tela que não
 * existe no servidor.
 */

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  /** ADMIN gerencia contas; OPERADOR usa o produto. */
  role: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  disabledBy: string | null;
  openSessions: number;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

function post(path: string, body?: unknown): Promise<unknown> {
  return fetchJson<unknown>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export default function Configuracoes({
  abaInicial = "usuarios",
}: {
  abaInicial?: "unidades" | "usuarios";
}) {
  const { user: me } = useAuth();
  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => fetchJson<ManagedUser[]>("/users"),
  });

  const active = users.filter((u) => u.disabledAt === null).length;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          Configurações
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          A casa do produto: as unidades que existem, quem pode entrar e o que
          cada pessoa alcança. Todo acesso dado aqui fica no nome de quem o deu,
          e é esse nome que assina cada confirmação de curadoria e cada promoção
          de vigência feita pela pessoa.
        </p>
      </header>

      <Tabs defaultValue={abaInicial} className="p-8 space-y-6">
        <TabsList>
          <TabsTrigger value="unidades">Unidades</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
        </TabsList>

        <TabsContent value="unidades" className="mt-0">
          <PainelDeUnidades />
        </TabsContent>

        <TabsContent value="usuarios" className="mt-0 space-y-6 max-w-5xl">
          {/*
            O aviso de falha é da aba, e não da tela: um erro ao carregar as
            contas não diz nada sobre o cadastro de unidades, e mostrá-lo no
            topo faria um pintar o outro de vermelho.
          */}
          {error && (
            <ApiErrorNotice
              error={error}
              what="A lista de contas não pôde ser carregada."
            />
          )}
          {me?.role === "ADMIN" ? (
            <NewUserCard />
          ) : (
            <p className="text-sm text-muted-foreground">
              Somente administradores criam contas, desativam acesso e redefinem
              senha. A sua conta é de operador — peça a um administrador.
            </p>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pessoas com acesso</CardTitle>
              <p className="text-xs text-muted-foreground">
                {isLoading
                  ? "Carregando…"
                  : `${active} ativa(s) de ${users.length} conta(s).`}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
              {!isLoading && users.length === 0 && (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma conta — o que não deveria ser possível, já que você está
                  logado com uma.
                </p>
              )}
            </CardContent>
          </Card>

          {/*
            Permissões vem depois da lista de contas, e a ordem é a leitura: a
            pergunta "quem tem acesso" precede "a quê" — escolher a pessoa na
            caixa abaixo só faz sentido depois de vê-la na lista acima.
          */}
          <PermissoesCard pessoas={users} />

          <MyPasswordCard />
        </TabsContent>
      </Tabs>
    </Layout>
  );
}

/**
 * A senha é escolhida por quem cria e dita à pessoa por fora.
 *
 * Não há e-mail neste produto, então "enviar um convite" seria uma promessa que
 * o servidor não cumpre. O que existe é a troca da própria senha, ao lado —
 * quem recebe uma conta deveria usá-la assim que entrar.
 */
function NewUserCard() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("OPERADOR");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => post("/users", { name, email, password, role }),
    onSuccess: () => {
      setCreated(email.trim().toLowerCase());
      setError(null);
      setName("");
      setEmail("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => {
      setCreated(null);
      setError(err.message);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary" />
          Dar acesso a alguém
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A senha inicial é escolhida por você e dita à pessoa por fora — nada
          aqui envia e-mail. Peça que ela troque em Configurações depois de
          entrar.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Nome" htmlFor="new-name">
              <Input
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como a pessoa assina"
                required
              />
            </Field>
            <Field label="E-mail" htmlFor="new-email">
              <Input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@empresa.com"
                required
              />
            </Field>
            <Field label="Senha inicial" htmlFor="new-password">
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="mínimo 10 caracteres"
                required
              />
            </Field>
          </div>

          <Field label="Papel" htmlFor="new-role">
            {/* select nativo de propósito: dois valores, e o navegador acessível
                de graça vale mais que um componente para isto. */}
            <select
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="OPERADOR">Operador — usa o produto</option>
              <option value="ADMIN">Administrador — também gerencia contas</option>
            </select>
          </Field>

          {error && <Refusal>{error}</Refusal>}
          {created && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Conta criada para <strong>{created}</strong>. Passe a senha para a
              pessoa por um canal seguro.
            </p>
          )}

          <Button type="submit" className="gap-2" disabled={create.isPending}>
            <UserPlus className="w-4 h-4" />
            {create.isPending ? "Criando…" : "Criar conta"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function UserRow({ user }: { user: ManagedUser }) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const disabled = user.disabledAt !== null;
  const isMe = me?.id === user.id;

  const act = useMutation({
    mutationFn: (action: "disable" | "enable") =>
      post(`/users/${user.id}/${action}`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const reset = useMutation({
    mutationFn: () => post(`/users/${user.id}/password`, { password: newPassword }),
    onSuccess: () => {
      setError(null);
      setResetting(false);
      setNewPassword("");
      setDone(
        "Senha redefinida. As sessões abertas dessa pessoa foram encerradas.",
      );
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="px-6 py-4 border-b last:border-b-0">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{user.name}</span>
            {isMe && (
              <Badge variant="outline" className="text-muted-foreground">
                você
              </Badge>
            )}
            <Badge
              variant="outline"
              className={
                user.role === "ADMIN"
                  ? "border-blue-300 text-blue-800"
                  : "text-muted-foreground"
              }
              title={
                user.role === "ADMIN"
                  ? "Gerencia contas: cria, desativa, redefine senha e muda papel."
                  : "Usa o produto; não gerencia contas."
              }
            >
              {user.role === "ADMIN" ? "administrador" : "operador"}
            </Badge>
            {disabled ? (
              <Badge className="bg-muted text-muted-foreground border-border hover:bg-muted">
                <Ban className="w-3 h-3 mr-1" />
                Desativada
              </Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Ativa
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground font-mono truncate">
            {user.email}
          </div>
          {isMe && <AccountId id={user.id} />}
          <div className="text-xs text-muted-foreground mt-1">
            {user.lastLoginAt
              ? `Último acesso em ${dateTime(user.lastLoginAt)}`
              : "Nunca entrou"}
            {" · "}
            {user.openSessions === 0
              ? "sem sessão aberta"
              : `${user.openSessions} sessão(ões) aberta(s)`}
            {" · "}
            criada em {date(user.createdAt)}
            {user.createdBy ? ` por ${user.createdBy}` : " pelo terminal"}
            {disabled && user.disabledBy ? ` · desativada por ${user.disabledBy}` : ""}
          </div>
        </div>

        {/* As ações são do administrador; para o operador nem renderizam —
            um botão que só existe para responder 403 ensina a desconfiar da
            tela. O servidor recusa de todo jeito. */}
        {me?.role === "ADMIN" && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              setDone(null);
              setResetting((v) => !v);
            }}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Redefinir senha
          </Button>
          {disabled ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={act.isPending}
              onClick={() => act.mutate("enable")}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reativar
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={act.isPending}
              onClick={() => act.mutate("disable")}
              title={
                isMe
                  ? "Não dá para desativar a própria conta."
                  : "Tira o acesso e encerra as sessões abertas. O histórico continua no nome dela."
              }
            >
              <Ban className="w-3.5 h-3.5" />
              Desativar
            </Button>
          )}
        </div>
        )}
      </div>

      {resetting && (
        <form
          className="flex items-end gap-3 mt-4 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <Field label="Senha nova" htmlFor={`reset-${user.id}`}>
            <Input
              id={`reset-${user.id}`}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="mínimo 10 caracteres"
              className="w-64"
              required
            />
          </Field>
          <Button type="submit" size="sm" disabled={reset.isPending}>
            {reset.isPending ? "Redefinindo…" : "Confirmar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setResetting(false);
              setNewPassword("");
              setError(null);
            }}
          >
            Cancelar
          </Button>
        </form>
      )}

      {error && <div className="mt-3">
        <Refusal>{error}</Refusal>
      </div>}
      {done && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 mt-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {done}
        </p>
      )}
    </div>
  );
}

/**
 * O identificador da conta no banco.
 *
 * O e-mail é quem a pessoa é para o produto — é ele que assina cada confirmação
 * de curadoria, e é por ele que se procura um histórico. O `id` é quem ela é
 * para as rotas: `/users/:id/disable`, `/users/:id/password`, e o `user_id` das
 * sessões. São dois nomes para a mesma pessoa, e até aqui só um deles era
 * visível — quem precisava do outro tinha que abrir o banco.
 *
 * Aparece **apenas na própria linha**. O id de outra pessoa não é segredo — esta
 * tela já exige sessão, e ele não abre nada por si — mas também não é assunto de
 * quem olha a lista: as ações sobre as outras contas já são botões aqui, e
 * nenhuma delas pede que se leia um uuid. Quem procura um id procura o seu.
 *
 * Fica em segundo plano de propósito: menor, atrás de um rótulo. Não é o que se
 * lê primeiro numa linha desta lista.
 */
function AccountId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        ID
      </span>
      <code className="text-xs text-muted-foreground/80 font-mono truncate">
        {id}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "ID copiado" : "Copiar ID da conta"}
        className={cn(
          "p-1 rounded-sm shrink-0 text-muted-foreground/70 transition-colors",
          "hover:text-foreground hover:bg-muted",
        )}
      >
        {copied ? (
          <Check className="w-3 h-3 text-emerald-600" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

/**
 * A troca da própria senha.
 *
 * Exige a atual mesmo com a sessão aberta, e derruba as outras sessões da
 * pessoa — que é o que se quer quando se troca uma senha por desconfiança.
 */
function MyPasswordCard() {
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

/** A recusa vem do servidor escrita para ser lida; a tela só a emoldura. */
function Refusal({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40",
        "bg-destructive/10 p-3 text-sm text-destructive",
      )}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
