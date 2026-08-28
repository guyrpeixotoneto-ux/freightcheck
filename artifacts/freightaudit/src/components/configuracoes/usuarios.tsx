import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  HelpCircle,
  KeyRound,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, Refusal, post } from "@/components/configuracoes/campos";
import { CHAVE_DAS_CONTAS, useContas, type ManagedUser } from "@/components/configuracoes/contas";
import { definirLotacao, useCargos } from "@/lib/cadastro";
import { listarUnidadesCanonicas } from "@/lib/fechamento";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Usuários — quem entra, com que papel, o que faz e onde.
 *
 * Esta seção existe porque o login existe: a partir do momento em que entrar é
 * necessário, dar e tirar acesso vira trabalho do produto, e trabalho de
 * produto não se faz por `psql`.
 *
 * **A lista é agrupada por cargo, e o cargo vem do cadastro.** Quarenta contas
 * numa lista plana são quarenta linhas para ler; agrupadas por cargo, são seis
 * grupos para percorrer, e a pergunta que se faz na frente desta tela — *quem
 * são os analistas administrativos?* — vira uma olhada em vez de uma leitura.
 * O agrupamento só funciona porque cargo é cadastro (`lib/cadastro.ts`): por
 * texto livre, `Analista Administrativo` e `ANALISTA ADM` seriam dois grupos
 * com uma pessoa cada, e o agrupamento pioraria a lista em vez de a organizar.
 *
 * **Quem ainda não tem cargo aparece, num grupo próprio.** A conta existe antes
 * de alguém dizer o que a pessoa faz, e escondê-la até que alguém diga faria a
 * tela de "quem tem acesso" deixar de mostrar gente com acesso — o oposto do
 * que ela existe para fazer.
 *
 * **A lixeira desativa; ela não apaga.** O `actor` de cada confirmação de
 * curadoria e de cada promoção de vigência aponta para estas linhas, e apagar
 * uma transformaria um histórico auditável num e-mail órfão. O ícone é o que
 * quem desenhou a tela esperava encontrar; o que ele faz é o que o produto pode
 * honestamente fazer — e a confirmação diz isso com todas as letras antes de
 * acontecer.
 *
 * A troca da **própria** senha não está aqui: ela é de Meu Perfil, porque é a
 * única coisa desta lista que um operador faz sobre si mesmo. O que cada pessoa
 * alcança também não: Permissões é seção da casa, com endereço próprio — esta
 * responde "quem entra", e a de lá, "a quê".
 */

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** As iniciais que o círculo mostra. Uma letra basta; duas quando há sobrenome. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => p !== "");
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0]!.slice(0, 1).toUpperCase();
  return (partes[0]![0]! + partes[partes.length - 1]![0]!).toUpperCase();
}

/**
 * O texto de uma conta para efeito de busca.
 *
 * Sem acento e em caixa baixa dos dois lados — buscar `belem` tem que achar
 * `Belém`, porque quem digita rápido não põe acento e a lista não deve punir
 * isso. É a mesma normalização que `canonizarNome` faz do lado do cadastro,
 * pela mesma razão.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** O rótulo do grupo de quem ainda não tem cargo. */
const SEM_CARGO = "Sem cargo";

export function PainelDeUsuarios() {
  const { user: me } = useAuth();
  const { data: users = [], isLoading, error } = useContas();

  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  const ativos = users.filter((u) => u.disabledAt === null).length;

  /*
    Filtrar e agrupar numa passada só, memorizada: a lista inteira é refeita a
    cada tecla da busca, e refazê-la é barato — o que não é barato é fazê-la
    também em cada re-render que a busca não causou.
  */
  const grupos = useMemo(() => {
    const alvo = normalizar(busca.trim());
    const filtrados =
      alvo === ""
        ? users
        : users.filter((u) =>
            normalizar(
              `${u.name} ${u.email} ${u.cargoNome ?? ""} ${u.unidadeNome ?? ""}`,
            ).includes(alvo),
          );

    const porCargo = new Map<string, ManagedUser[]>();
    for (const conta of filtrados) {
      const chave = conta.cargoNome ?? SEM_CARGO;
      const grupo = porCargo.get(chave);
      if (grupo) grupo.push(conta);
      else porCargo.set(chave, [conta]);
    }

    return [...porCargo.entries()]
      .sort(([a], [b]) => {
        /* "Sem cargo" vai para o fim: é um estado a resolver, não um cargo. */
        if (a === SEM_CARGO) return 1;
        if (b === SEM_CARGO) return -1;
        return a.localeCompare(b, "pt-BR");
      })
      .map(([cargo, contas]) => ({
        cargo,
        contas: contas.sort((x, y) => x.name.localeCompare(y.name, "pt-BR")),
      }));
  }, [users, busca]);

  const encontrados = grupos.reduce((soma, g) => soma + g.contas.length, 0);

  return (
    <div className="space-y-6 max-w-5xl">
      {error && (
        <ApiErrorNotice error={error} what="A lista de contas não pôde ser carregada." />
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Carregando…"
            : `${users.length} perfil${users.length === 1 ? "" : "s"} configurado${
                users.length === 1 ? "" : "s"
              } · ${ativos} com acesso ativo`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setAjuda((v) => !v)}
          >
            <HelpCircle className="w-4 h-4" />
            Como preencher
          </Button>
          {/*
            O botão de criar só para o administrador. Renderizá-lo para o
            operador e deixar o servidor responder 403 dá um botão que sempre
            falha — e um botão que sempre falha ensina a desconfiar da tela.
          */}
          {me?.role === "ADMIN" && (
            <Button size="sm" className="gap-2" onClick={() => setCriando((v) => !v)}>
              <UserPlus className="w-4 h-4" />
              Criar novo usuário
            </Button>
          )}
        </div>
      </div>

      {ajuda && <ComoPreencher />}

      {me?.role === "ADMIN"
        ? criando && <NewUserCard aoFechar={() => setCriando(false)} />
        : !isLoading && (
            <p className="text-sm text-muted-foreground">
              Somente administradores criam contas, desativam acesso e redefinem
              senha. A sua conta é de operador — peça a um administrador.
            </p>
          )}

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, e-mail, cargo ou unidade"
          className="pl-9"
          aria-label="Buscar contas"
        />
      </div>

      {!isLoading && users.length > 0 && encontrados === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma conta casa com “{busca}”. A busca olha nome, e-mail, cargo e
          unidade — e ignora acento e maiúscula.
        </p>
      )}

      {grupos.map((grupo) => (
        <section key={grupo.cargo} className="space-y-2">
          <div className="flex items-baseline gap-3 border-b pb-1.5">
            <h2
              className={cn(
                "text-xs font-semibold uppercase tracking-wider",
                grupo.cargo === SEM_CARGO ? "text-muted-foreground/70" : "text-muted-foreground",
              )}
            >
              {grupo.cargo}
            </h2>
            <span className="text-xs text-muted-foreground/70">
              {grupo.contas.length} usuário{grupo.contas.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-2">
            {grupo.contas.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </div>
        </section>
      ))}

      {!isLoading && users.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma conta — o que não deveria ser possível, já que você está logado
          com uma.
        </p>
      )}
    </div>
  );
}

/** O cartão de ajuda do botão "Como preencher" — o que cada campo é. */
function ComoPreencher() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Como preencher uma conta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">Papel</strong> é acesso: o
          administrador cria contas, desativa, redefine senha e muda papel; o
          operador usa o produto. É a única distinção que o servidor conhece.
        </p>
        <p>
          <strong className="text-foreground">Cargo</strong> e{" "}
          <strong className="text-foreground">unidade</strong> são cadastro, não
          acesso: dizem o que a pessoa faz e onde, e não mudam nada do que ela
          alcança. Ninguém deixa de ver uma unidade por estar lotado em outra —
          o que cada conta alcança é decidido em Permissões, módulo a módulo.
        </p>
        <p>
          Os dois saem de listas — Configurações → Cargos e → Unidades — e não
          são digitados. É o que impede a mesma função de virar dois cargos por
          diferença de grafia.
        </p>
        <p>
          <strong className="text-foreground">A senha inicial</strong> é
          escolhida por quem cria e dita à pessoa por fora: este produto não
          manda e-mail, e um convite por e-mail seria uma promessa que o servidor
          não cumpre.
        </p>
        <p>
          <strong className="text-foreground">Ninguém é apagado.</strong> A
          lixeira desativa: tira o acesso, encerra as sessões abertas e preserva
          o histórico no nome da pessoa.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Os selects de cargo e unidade — os mesmos no formulário de criar e no de
 * editar.
 *
 * `select` nativo, como o de papel logo ao lado e pela mesma razão que está
 * escrita lá: o navegador dá acessibilidade e busca por digitação de graça, e
 * uma caixa de escolha com trinta cargos não precisa de mais do que isso.
 */
function CamposDeLotacao({
  cargoId,
  unidadeId,
  aoTrocarCargo,
  aoTrocarUnidade,
  prefixo,
}: {
  cargoId: string;
  unidadeId: string;
  aoTrocarCargo: (valor: string) => void;
  aoTrocarUnidade: (valor: string) => void;
  prefixo: string;
}) {
  const cargos = useCargos();
  const unidades = useQuery({
    queryKey: ["unidades", "canonicas"],
    queryFn: listarUnidadesCanonicas,
  });

  const classe =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

  return (
    <>
      <Field label="Cargo" htmlFor={`${prefixo}-cargo`}>
        <select
          id={`${prefixo}-cargo`}
          value={cargoId}
          onChange={(e) => aoTrocarCargo(e.target.value)}
          className={classe}
        >
          <option value="">Sem cargo</option>
          {(cargos.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Unidade" htmlFor={`${prefixo}-unidade`}>
        <select
          id={`${prefixo}-unidade`}
          value={unidadeId}
          onChange={(e) => aoTrocarUnidade(e.target.value)}
          className={classe}
        >
          <option value="">Sem unidade</option>
          {(unidades.data ?? [])
            /* Só as cadastradas: a detectada no acervo não tem `id`, e lotar
               alguém numa unidade que ninguém confirmou seria dar identidade
               por importação — o que o cadastro canônico desfez. */
            .filter((u) => u.id !== null)
            .map((u) => (
              <option key={u.id!} value={u.id!}>
                {u.nome}
              </option>
            ))}
        </select>
      </Field>
    </>
  );
}

/**
 * A senha é escolhida por quem cria e dita à pessoa por fora.
 *
 * Não há e-mail neste produto, então "enviar um convite" seria uma promessa que
 * o servidor não cumpre. O que existe é a troca da própria senha, ao lado —
 * quem recebe uma conta deveria usá-la assim que entrar.
 */
function NewUserCard({ aoFechar }: { aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("OPERADOR");
  const [cargoId, setCargoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      post("/users", {
        name,
        email,
        password,
        role,
        /* Vazio vira `null`: "sem cargo" é uma resposta, e não um campo em
           branco que o servidor teria de interpretar. */
        cargoId: cargoId === "" ? null : cargoId,
        unidadeId: unidadeId === "" ? null : unidadeId,
      }),
    onSuccess: () => {
      setCreated(email.trim().toLowerCase());
      setError(null);
      setName("");
      setEmail("");
      setPassword("");
      setCargoId("");
      setUnidadeId("");
      void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Papel" htmlFor="new-role">
              {/* select nativo de propósito: dois valores, e o navegador acessível
                  de graça vale mais que um componente para isto. */}
              <select
                id="new-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="OPERADOR">Operador — usa o produto</option>
                <option value="ADMIN">Administrador — também gerencia contas</option>
              </select>
            </Field>
            <CamposDeLotacao
              prefixo="new"
              cargoId={cargoId}
              unidadeId={unidadeId}
              aoTrocarCargo={setCargoId}
              aoTrocarUnidade={setUnidadeId}
            />
          </div>

          {error && <Refusal>{error}</Refusal>}
          {created && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Conta criada para <strong>{created}</strong>. Passe a senha para a
              pessoa por um canal seguro.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" className="gap-2" disabled={create.isPending}>
              <UserPlus className="w-4 h-4" />
              {create.isPending ? "Criando…" : "Criar conta"}
            </Button>
            <Button type="button" variant="ghost" onClick={aoFechar}>
              Fechar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** O que a linha está mostrando abaixo dela: nada, os detalhes, ou a edição. */
type Painel = "nenhum" | "detalhes" | "edicao" | "senha" | "desativar";

function UserRow({ user }: { user: ManagedUser }) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel>("nenhum");
  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [role, setRole] = useState(user.role);
  const [cargoId, setCargoId] = useState(user.cargoId ?? "");
  const [unidadeId, setUnidadeId] = useState(user.unidadeId ?? "");

  const disabled = user.disabledAt !== null;
  const isMe = me?.id === user.id;
  const souAdmin = me?.role === "ADMIN";

  const recarregar = () => queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });

  const alternar = (mostrar: Painel) => {
    setDone(null);
    setError(null);
    setPainel((atual) => (atual === mostrar ? "nenhum" : mostrar));
  };

  const act = useMutation({
    mutationFn: (action: "disable" | "enable") => post(`/users/${user.id}/${action}`),
    onSuccess: () => {
      setError(null);
      setPainel("nenhum");
      void recarregar();
    },
    onError: (err: Error) => setError(err.message),
  });

  const reset = useMutation({
    mutationFn: () => post(`/users/${user.id}/password`, { password: newPassword }),
    onSuccess: () => {
      setError(null);
      setPainel("nenhum");
      setNewPassword("");
      setDone("Senha redefinida. As sessões abertas dessa pessoa foram encerradas.");
      void recarregar();
    },
    onError: (err: Error) => setError(err.message),
  });

  /*
    Salvar a edição são duas chamadas, e são duas de propósito: papel é acesso e
    lotação é cadastro (ver `lib/session.ts`). O papel só é mandado quando de
    fato mudou — a rota recusa rebaixar o último administrador, e mandar o mesmo
    valor de sempre transformaria essa recusa legítima num erro que aparece ao
    salvar o cargo de alguém.
  */
  const salvar = useMutation({
    mutationFn: async () => {
      if (role !== user.role) await post(`/users/${user.id}/role`, { role });
      await definirLotacao(user.id, {
        cargoId: cargoId === "" ? null : cargoId,
        unidadeId: unidadeId === "" ? null : unidadeId,
      });
    },
    onSuccess: () => {
      setError(null);
      setPainel("nenhum");
      setDone("Cadastro atualizado.");
      void recarregar();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <span
          aria-hidden
          className="w-9 h-9 shrink-0 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground"
        >
          {iniciais(user.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{user.name}</span>
            {user.unidadeNome && (
              <Badge variant="secondary" className="font-normal">
                {user.unidadeNome}
              </Badge>
            )}
            {isMe && (
              <Badge variant="outline" className="text-muted-foreground">
                você
              </Badge>
            )}
            {user.role === "ADMIN" && (
              <Badge
                variant="outline"
                className="border-blue-300 text-blue-800"
                title="Gerencia contas: cria, desativa, redefine senha e muda papel."
              >
                administrador
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground truncate">{user.email}</div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className={
              disabled
                ? "text-muted-foreground"
                : "border-emerald-300 bg-emerald-50 text-emerald-800"
            }
          >
            {disabled ? "Inativo" : "Ativo"}
          </Badge>

          {/*
            O interruptor é o mesmo ato dos botões antigos "Desativar" e
            "Reativar" — e a distinção entre os dois continua no servidor, em
            duas rotas, pela razão escrita em `routes/users.ts`. O que mudou é
            só o gesto: um clique num estado que se lê, em vez de um botão cujo
            rótulo é a ação oposta ao que está valendo.
          */}
          {souAdmin && (
            <Switch
              checked={!disabled}
              disabled={act.isPending}
              aria-label={disabled ? `Reativar ${user.name}` : `Desativar ${user.name}`}
              title={
                isMe
                  ? "Não dá para desativar a própria conta."
                  : "Tira o acesso e encerra as sessões abertas. O histórico continua no nome dela."
              }
              onCheckedChange={(ligado) => act.mutate(ligado ? "enable" : "disable")}
            />
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Ver detalhes de ${user.name}`}
            onClick={() => alternar("detalhes")}
          >
            <Eye className="w-4 h-4" />
          </Button>

          {souAdmin && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Editar ${user.name}`}
                onClick={() => {
                  setRole(user.role);
                  setCargoId(user.cargoId ?? "");
                  setUnidadeId(user.unidadeId ?? "");
                  alternar("edicao");
                }}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label={`Desativar ${user.name}`}
                disabled={disabled}
                onClick={() => alternar("desativar")}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {painel === "detalhes" && (
        <div className="border-t px-4 py-3 space-y-1">
          <div className="text-xs text-muted-foreground">
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
          <div className="text-xs text-muted-foreground">
            {user.cargoNome ?? "Sem cargo"}
            {user.unidadeNome ? ` · ${user.unidadeNome}` : " · sem unidade"}
            {" · "}
            {user.role === "ADMIN" ? "administrador" : "operador"}
          </div>
          {isMe && <AccountId id={user.id} />}
          {souAdmin && (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => alternar("senha")}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Redefinir senha
              </Button>
            </div>
          )}
        </div>
      )}

      {painel === "edicao" && (
        <form
          className="border-t px-4 py-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Papel" htmlFor={`role-${user.id}`}>
              <select
                id={`role-${user.id}`}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="OPERADOR">Operador — usa o produto</option>
                <option value="ADMIN">Administrador — também gerencia contas</option>
              </select>
            </Field>
            <CamposDeLotacao
              prefixo={user.id}
              cargoId={cargoId}
              unidadeId={unidadeId}
              aoTrocarCargo={setCargoId}
              aoTrocarUnidade={setUnidadeId}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Cargo e unidade dizem o que a pessoa faz e onde; não mudam o que ela
            alcança. O que cada conta alcança está em Permissões, mais abaixo.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPainel("nenhum")}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {painel === "senha" && (
        <form
          className="border-t px-4 py-3 flex items-end gap-3 flex-wrap"
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
              setPainel("nenhum");
              setNewPassword("");
              setError(null);
            }}
          >
            Cancelar
          </Button>
        </form>
      )}

      {/*
        A confirmação diz o que vai acontecer de verdade — e o que não vai.
        Quem clica numa lixeira espera apagar; aqui ela desativa, e a frase
        precisa desfazer essa expectativa antes do clique, não depois.
      */}
      {painel === "desativar" && (
        <div className="border-t px-4 py-3 space-y-2">
          <p className="text-sm">
            Desativar <strong>{user.name}</strong>? O acesso é cortado e as
            sessões abertas caem na hora.
          </p>
          <p className="text-xs text-muted-foreground">
            A conta não é apagada, e não há como apagá-la: cada confirmação de
            curadoria e cada promoção de vigência que essa pessoa fez está
            assinada com este e-mail, e apagar a linha transformaria esse
            histórico num nome órfão. Reativar depois é um clique.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={act.isPending}
              onClick={() => act.mutate("disable")}
            >
              <Ban className="w-3.5 h-3.5 mr-1.5" />
              {act.isPending ? "Desativando…" : "Desativar acesso"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPainel("nenhum")}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {disabled && souAdmin && painel === "nenhum" && (
        <div className="border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 h-7"
            disabled={act.isPending}
            onClick={() => act.mutate("enable")}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reativar acesso
          </Button>
        </div>
      )}

      {error && (
        <div className="border-t px-4 py-3">
          <Refusal>{error}</Refusal>
        </div>
      )}
      {done && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 border-t px-4 py-3">
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
      <code className="text-xs text-muted-foreground/80 font-mono truncate">{id}</code>
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
