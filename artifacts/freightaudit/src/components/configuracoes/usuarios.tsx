import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Field, Refusal, post } from "@/components/configuracoes/campos";
import { CHAVE_DAS_CONTAS, useContas, type ManagedUser } from "@/components/configuracoes/contas";
import { usePapeis } from "@/components/configuracoes/papeis-consulta";
import { fetchJson } from "@/lib/api";
import {
  caminhoDoDepartamento,
  definirCadastroDaConta,
  useCargos,
  useDepartamentos,
} from "@/lib/cadastro";
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
 * **A caixa de arquivo tira da lista quem já não tem acesso.** Uma tela que
 * mostra tudo o que já existiu acumula desligados de dois anos atrás no grupo
 * do cargo que já não é de ninguém, e desativar resolve o acesso sem resolver
 * isso. Arquivar é decisão sobre a *lista*, e não sobre a linha: a conta
 * continua inteira, "Ver arquivadas" a traz de volta à vista, e reativar o
 * acesso desarquiva junto. Só se arquiva quem já está desativado — arquivada e
 * ativa seria gente entrando no produto sem aparecer na tela que existe para
 * dizer quem entra.
 *
 * **O olho abre o produto como aquela pessoa.** Era a pergunta que esta tela
 * fazia e não respondia — *o que ela vê quando entra?* —, e a resposta que se
 * dava era redefinir a senha de alguém para entrar com a conta dele, derrubando
 * a pessoa do sistema para satisfazer uma dúvida. Agora é um clique: a sessão
 * continua sendo a de quem clicou, uma faixa laranja no topo diz de quem é a
 * máscara, e o servidor recusa toda escrita enquanto ela durar — o porquê está
 * em `middlewares/visualizacao-como.ts`, e ele é o mesmo do login. Os detalhes
 * da conta, que moravam neste ícone, passaram para a seta ao lado.
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

/**
 * O apelido de um nome — `João da Silva` vira `joao.silva`.
 *
 * É a mesma conta de `apelidoDoNome`, no servidor, e existe aqui por uma razão
 * só: mostrar o login que a pessoa vai receber **antes** de a conta ser criada.
 * Quem gera o endereço de verdade continua sendo o servidor, que é quem sabe
 * quais já estão tomados — por isso a tela mostra o previsto e não promete.
 */
function apelido(nome: string): string {
  return normalizar(nome)
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/** O rótulo do grupo de quem ainda não tem cargo. */
const SEM_CARGO = "Sem cargo";

/**
 * O valor que representa "nenhum" nas caixas de cargo e unidade.
 *
 * Estado vazio é `""` daqui até a API, mas o `Select` do sistema reserva a
 * string vazia para "sem escolha nenhuma" e recusa uma opção com esse valor —
 * daí o sentinela, que só existe entre o componente e o estado.
 */
const SEM_VINCULO = "__sem_vinculo__";

export function PainelDeUsuarios() {
  const { user: me } = useAuth();
  const { data: users = [], isLoading, error } = useContas();

  const [busca, setBusca] = useState("");
  /*
    Uma gaveta só, e um estado só para ela: `"criar"` ou a conta em edição.
    Dois estados independentes — um para criar, outro para editar — deixariam
    as duas abertas ao mesmo tempo se alguém clicasse no lápis com a de criação
    aberta, e a segunda cobriria a primeira sem cancelá-la.
  */
  const [gaveta, setGaveta] = useState<"criar" | ManagedUser | null>(null);
  const [ajuda, setAjuda] = useState(false);
  /*
    As arquivadas ficam de fora até alguém pedir — é para isso que arquivar
    existe. O botão diz quantas são: uma lista que esconde linhas sem dizer que
    escondeu é uma lista em que não se confia, e esta é a tela que responde
    "quem tem acesso".
  */
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);

  const ativos = users.filter((u) => u.disabledAt === null).length;
  const arquivadas = users.filter((u) => u.archivedAt !== null).length;
  const visiveis = mostrarArquivadas
    ? users
    : users.filter((u) => u.archivedAt === null);

  /*
    Filtrar e agrupar numa passada só, memorizada: a lista inteira é refeita a
    cada tecla da busca, e refazê-la é barato — o que não é barato é fazê-la
    também em cada re-render que a busca não causou.
  */
  const grupos = useMemo(() => {
    const alvo = normalizar(busca.trim());
    const filtrados =
      alvo === ""
        ? visiveis
        : visiveis.filter((u) =>
            normalizar(
              `${u.name} ${u.email} ${u.cargoNome ?? ""} ${
                u.departamentoNome ?? ""
              } ${u.unidadeNome ?? ""}`,
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
  }, [visiveis, busca]);

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
              } · ${ativos} com acesso ativo${
                arquivadas === 0
                  ? ""
                  : ` · ${arquivadas} arquivada${arquivadas === 1 ? "" : "s"}`
              }`}
        </p>
        <div className="flex items-center gap-2">
          {arquivadas > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              aria-pressed={mostrarArquivadas}
              onClick={() => setMostrarArquivadas((v) => !v)}
            >
              <Archive className="w-4 h-4" />
              {mostrarArquivadas
                ? "Ocultar arquivadas"
                : `Ver arquivadas (${arquivadas})`}
            </Button>
          )}
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
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setGaveta((atual) => (atual === null ? "criar" : null))}
            >
              <UserPlus className="w-4 h-4" />
              Criar novo usuário
            </Button>
          )}
        </div>
      </div>

      {ajuda && <ComoPreencher />}

      {me?.role === "ADMIN"
        ? gaveta !== null && (
            <GavetaDeUsuario
              /* A chave troca a identidade do componente entre uma conta e
                 outra: sem ela, abrir o lápis de uma segunda pessoa reusaria a
                 gaveta da primeira, com os campos ainda preenchidos por ela. */
              key={gaveta === "criar" ? "criar" : gaveta.id}
              conta={gaveta === "criar" ? null : gaveta}
              aoFechar={() => setGaveta(null)}
            />
          )
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
          placeholder="Buscar por nome, e-mail, cargo, departamento ou unidade"
          className="pl-9"
          aria-label="Buscar contas"
        />
      </div>

      {!isLoading && visiveis.length > 0 && encontrados === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma conta casa com “{busca}”. A busca olha nome, e-mail, cargo,
          departamento e unidade — e ignora acento e maiúscula.
          {!mostrarArquivadas && arquivadas > 0
            ? ` ${arquivadas} conta${arquivadas === 1 ? " arquivada está" : "s arquivadas estão"} fora da lista.`
            : ""}
        </p>
      )}

      {!isLoading && users.length > 0 && visiveis.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todas as contas estão arquivadas. Use “Ver arquivadas” para
          mostrá-las.
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
              <UserRow key={user.id} user={user} aoEditar={() => setGaveta(user)} />
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
          Os três saem de listas — Configurações → Departamentos, → Cargos e →
          Unidades — e não são digitados. É o que impede a mesma função de virar dois cargos por
          diferença de grafia.
        </p>
        <p>
          <strong className="text-foreground">Reporta a</strong> é o
          organograma, e só ele: quem responde por quem. Não é cargo e não é
          papel — mudar o gestor de alguém não muda nem o que a pessoa faz nem
          o que ela alcança. Em branco é o topo.
        </p>
        <p>
          <strong className="text-foreground">E-mail e senha</strong> são
          gerados pelo sistema quando você não os informa, e aparecem uma única
          vez ao criar a conta: este produto não manda e-mail, e um convite por
          e-mail seria uma promessa que o servidor não cumpre. Passe os dois por
          um canal seguro e peça que a pessoa troque a senha em Meu Perfil.
        </p>
        <p>
          <strong className="text-foreground">Departamento</strong> vem do
          cargo, e não é um dado à parte da pessoa: cada cargo está lotado num
          departamento (Configurações → Departamentos), e escolher um
          departamento na gaveta reduz a lista de cargos aos dele. É o que
          impede alguém “no Comercial” com um cargo da Controladoria.
        </p>
        <p>
          <strong className="text-foreground">Ninguém é apagado.</strong> A
          lixeira desativa: tira o acesso, encerra as sessões abertas e preserva
          o histórico no nome da pessoa.
        </p>
        <p>
          <strong className="text-foreground">Arquivar</strong> é sobre a lista,
          não sobre a conta: quem já está sem acesso pode sair daqui para não se
          ler junto com quem trabalha aqui hoje. A conta continua inteira no
          sistema, “Ver arquivadas” traz todas de volta à vista, e reativar o
          acesso desarquiva junto.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * O departamento que a caixa de cima mostra: o escolhido à mão, ou o do cargo.
 *
 * `filtro` é `null` no estado normal, e isso quer dizer "siga o cargo" — não
 * "nenhum". A distinção é o que faz a gaveta de edição abrir já mostrando o
 * departamento de quem tem cargo, sem ninguém ter tocado na caixa; e é o que
 * faz um filtro escolhido antes do cargo sobreviver até haver cargo.
 */
export function departamentoEmVista(
  filtro: string | null,
  cargoAtual: { departamentoId: string | null } | null,
): string {
  return filtro ?? cargoAtual?.departamentoId ?? "";
}

/**
 * Os cargos que a caixa de baixo oferece — os do departamento escolhido e, sem
 * departamento escolhido, todos.
 *
 * O cargo que **já está na conta** entra sempre, mesmo fora do filtro: um
 * `Select` cujo valor não está entre as opções mostra vazio, e a gaveta de
 * edição diria "sem cargo" para quem tem cargo. Não é hipótese — acontece com
 * todo cargo que ninguém lotou em departamento nenhum, que é o estado inicial
 * de qualquer cadastro.
 */
export function cargosDoDepartamento<
  T extends { id: string; departamentoId: string | null },
>(cargos: T[], departamentoId: string, cargoId: string): T[] {
  if (departamentoId === "") return cargos;
  return cargos.filter(
    (c) => c.departamentoId === departamentoId || c.id === cargoId,
  );
}

/**
 * Os campos de lotação — departamento, cargo e unidade —, os mesmos no
 * formulário de criar e no de editar.
 *
 * `select` nativo, como o de papel logo ao lado e pela mesma razão que está
 * escrita lá: o navegador dá acessibilidade e busca por digitação de graça, e
 * uma caixa de escolha com trinta cargos não precisa de mais do que isso.
 *
 * **O departamento é do cargo, e não uma segunda coluna na conta.** Ele faltava
 * nesta gaveta e a falta era real: quem cadastra alguém sabe em que
 * departamento a pessoa entra, e a tela não perguntava. O que ela não pode
 * fazer é guardar a resposta duas vezes — `cargo.departamento_id` já diz onde
 * cada cargo está lotado (ver `0073`), e um `departamento_id` na conta
 * permitiria alguém no Comercial com um cargo da Controladoria: duas respostas
 * para a mesma pergunta, e nenhuma forma de saber qual vale.
 *
 * Então o campo existe e escolhe **através do cargo**: escolher um departamento
 * reduz a lista de cargos aos dele — que é o gesto de quem cadastra, e que
 * transforma trinta cargos em quatro —, e escolher um cargo mostra o
 * departamento dele, mesmo que ninguém tenha tocado na caixa de cima. Trocar o
 * departamento de alguém é trocar o cargo, e é o que a tela deixa fazer.
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
  const departamentos = useDepartamentos();
  const unidades = useQuery({
    queryKey: ["unidades", "canonicas"],
    queryFn: listarUnidadesCanonicas,
  });

  /*
    O departamento escolhido à mão, quando houve um. `null` é o estado normal, e
    quer dizer "siga o cargo" — não "nenhum". Guardar aqui o valor derivado do
    cargo faria a caixa de cima congelar no que estava quando os cargos ainda
    não tinham chegado da rede, e mostrar em branco o departamento de quem tem
    cargo. Este estado só existe para o caso contrário: filtrar por um
    departamento antes de haver cargo de onde derivá-lo.
  */
  const [filtro, setFiltro] = useState<string | null>(null);

  const listaDeCargos = cargos.data ?? [];
  const cargoAtual = listaDeCargos.find((c) => c.id === cargoId) ?? null;
  const departamentoId = departamentoEmVista(filtro, cargoAtual);
  const cargosVisiveis = cargosDoDepartamento(listaDeCargos, departamentoId, cargoId);

  /* `Administrativo › Controladoria`: o nome sozinho não distingue duas
     `Operações` em ramos diferentes da árvore, e é a mesma frase que a tela de
     Departamentos escreve. */
  const caminho = (id: string) =>
    caminhoDoDepartamento(departamentos.data ?? [], id).join(" › ");

  function trocarDepartamento(valor: string) {
    setFiltro(valor);
    /* O cargo que não pertence ao departamento novo sai junto: deixá-lo
       gravaria a contradição que este campo existe para não permitir — a
       pessoa "no Comercial" com um cargo da Controladoria. */
    if (
      valor !== "" &&
      cargoAtual !== null &&
      cargoAtual.departamentoId !== valor
    ) {
      aoTrocarCargo("");
    }
  }

  function trocarCargo(valor: string) {
    /* Volta a seguir o cargo: o departamento mostrado passa a ser o dele, e não
       o que sobrou de um filtro que quem escolheu já respondeu com o cargo. */
    setFiltro(null);
    aoTrocarCargo(valor);
  }

  return (
    <>
      <Field label="Departamento" htmlFor={`${prefixo}-departamento`}>
        <Select
          value={departamentoId || SEM_VINCULO}
          onValueChange={(v) => trocarDepartamento(v === SEM_VINCULO ? "" : v)}
        >
          <SelectTrigger id={`${prefixo}-departamento`}>
            <SelectValue placeholder="Todos os departamentos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VINCULO}>Todos os departamentos</SelectItem>
            {(departamentos.data ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {caminho(d.id) || d.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          O departamento é do cargo, e não um dado à parte da pessoa: escolher um
          aqui reduz a lista abaixo aos cargos dele, e escolher um cargo mostra o
          departamento em que ele está lotado. Quem monta a árvore é
          Configurações → Departamentos.
        </p>
      </Field>
      <Field label="Cargo" htmlFor={`${prefixo}-cargo`}>
        <Select
          value={cargoId || SEM_VINCULO}
          onValueChange={(v) => trocarCargo(v === SEM_VINCULO ? "" : v)}
        >
          <SelectTrigger id={`${prefixo}-cargo`}>
            <SelectValue placeholder="Sem cargo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VINCULO}>Sem cargo</SelectItem>
            {cargosVisiveis.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {departamentoId !== "" && cargosVisiveis.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum cargo está lotado neste departamento ainda. Crie o cargo em
            Configurações → Cargos, ou escolha outro departamento.
          </p>
        )}
      </Field>
      <Field label="Unidade" htmlFor={`${prefixo}-unidade`}>
        <Select
          value={unidadeId || SEM_VINCULO}
          onValueChange={(v) => aoTrocarUnidade(v === SEM_VINCULO ? "" : v)}
        >
          <SelectTrigger id={`${prefixo}-unidade`}>
            <SelectValue placeholder="Sem unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VINCULO}>Sem unidade</SelectItem>
            {(unidades.data ?? [])
              /* Só as cadastradas: a detectada no acervo não tem `id`, e lotar
                 alguém numa unidade que ninguém confirmou seria dar identidade
                 por importação — o que o cadastro canônico desfez. */
              .filter((u) => u.id !== null)
              .map((u) => (
                <SelectItem key={u.id!} value={u.id!}>
                  {u.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

/**
 * A gaveta de conta — a mesma para criar e para editar.
 *
 * **Por que gaveta, e não um cartão que empurra a lista.** Os dois formulários
 * nasciam dentro da lista: o de criar entre o cabeçalho e a busca, empurrando
 * tudo para baixo; o de editar dentro da própria linha, espremido em três
 * colunas. Quem clicava perdia de vista as contas que estava conferindo. A
 * gaveta abre por cima, pela direita, e a lista continua atrás dela; fechar
 * devolve o leitor exatamente onde ele estava. É a mesma decisão, pela mesma
 * razão, das gavetas de detalhe do resto do produto (ver
 * `components/cobertura/gaveta.tsx`).
 *
 * **Uma gaveta só para os dois atos, e isso é a decisão.** Criar e editar
 * respondem às mesmas perguntas sobre a mesma pessoa — quem é, como se fala
 * com ela, o que faz, onde e a quem reporta —, e dois formulários diferentes
 * para elas foi o que deixou a edição para trás: ela mostrava três campos
 * enquanto a criação pedia sete, e telefone e gestor só existiam no nascimento
 * da conta. Um formulário que mostra menos do que existe ensina que o resto
 * não se muda.
 *
 * **Nome e sobrenome entram separados e são gravados juntos.** O produto guarda
 * o nome com que a pessoa assina — é ele que vai em `actor` de cada
 * confirmação —, e duas colunas no banco só criariam a pergunta de onde pôr o
 * segundo sobrenome. A separação existe por uma razão só, e ela é desta tela: é
 * dela que sai o `joao.silva` do login gerado.
 *
 * **O e-mail é opcional ao criar, e imutável depois.** Em branco, o servidor
 * monta `nome.sobrenome@` no domínio de quem está criando a conta — o domínio
 * da casa —, e a tela mostra o endereço antes de criar, para que ninguém
 * descubra depois qual login recebeu. Na edição ele aparece e não se digita: é
 * quem a pessoa é para o histórico, e trocá-lo faria cada confirmação já
 * assinada apontar para um endereço que não existe mais. Ver `routes/users.ts`.
 *
 * **A senha é sorteada pelo servidor e aparece uma vez.** Não há e-mail neste
 * produto, então "enviar um convite" seria uma promessa que ninguém cumpre: o
 * que existe é a senha inicial, ditada à pessoa por fora e trocada por ela em
 * Meu Perfil. O banco guarda só o hash, e nenhuma rota devolve a senha depois —
 * por isso a tela insiste que aquela é a única vez em que ela aparece.
 * Redefinir a senha de quem já existe continua sendo outro ato, na linha da
 * conta: mexer em credencial não é a mesma coisa que corrigir um telefone.
 */
function GavetaDeUsuario({
  /** A conta a editar, ou `null` para criar uma nova. */
  conta,
  aoFechar,
}: {
  conta: ManagedUser | null;
  aoFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const editando = conta !== null;

  const [nome, setNome] = useState(conta ? primeiroNome(conta.name) : "");
  const [sobrenome, setSobrenome] = useState(conta ? restoDoNome(conta.name) : "");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState(conta?.telefone ?? "");
  /*
    O papel é o do cadastro (`papelId`), e não mais um de dois valores escritos
    aqui. Conta sem papel — criada pelo terminal antes do cadastro existir —
    abre com o campo vazio, e escolher um é o que a põe no cadastro.
  */
  const [papelId, setPapelId] = useState(conta?.papelId ?? "");
  const [cargoId, setCargoId] = useState(conta?.cargoId ?? "");
  const [unidadeId, setUnidadeId] = useState(conta?.unidadeId ?? "");
  const [gestorId, setGestorId] = useState(conta?.gestorId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [credenciais, setCredenciais] = useState<CredenciaisCriadas | null>(null);

  const criar = useMutation({
    mutationFn: () =>
      post("/users", {
        name: nome,
        sobrenome,
        /* Vazio vira `null` em tudo: "não informado" é uma resposta, e não um
           campo em branco que o servidor teria de interpretar. */
        email: email.trim() === "" ? null : email.trim(),
        telefone: telefone.trim() === "" ? null : telefone.trim(),
        papelId: papelId === "" ? null : papelId,
        cargoId: cargoId === "" ? null : cargoId,
        unidadeId: unidadeId === "" ? null : unidadeId,
        gestorId: gestorId === "" ? null : gestorId,
      }) as Promise<CredenciaisCriadas>,
    onSuccess: (criada) => {
      setCredenciais(criada);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });
    },
    onError: (err: Error) => {
      setCredenciais(null);
      setError(err.message);
    },
  });

  /*
    Gravar a edição são duas chamadas, e são duas de propósito: papel é acesso e
    o resto é cadastro (ver `lib/session.ts`). O papel só é mandado quando de
    fato mudou — a rota recusa tirar do último administrador o papel que
    administra, e mandar o mesmo valor de sempre transformaria essa recusa
    legítima num erro que aparece ao corrigir o telefone de alguém.
  */
  const salvar = useMutation({
    mutationFn: async () => {
      if (conta === null) return;
      if (papelId !== "" && papelId !== conta.papelId) {
        await fetchJson<unknown>(`/users/${conta.id}/papel`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ papelId }),
        });
      }
      await definirCadastroDaConta(conta.id, {
        name: nome,
        sobrenome,
        cargoId: cargoId === "" ? null : cargoId,
        unidadeId: unidadeId === "" ? null : unidadeId,
        telefone: telefone.trim() === "" ? null : telefone.trim(),
        gestorId: gestorId === "" ? null : gestorId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });
      aoFechar();
    },
    onError: (err: Error) => setError(err.message),
  });

  const gravando = editando ? salvar : criar;

  function submit(event: FormEvent) {
    event.preventDefault();
    gravando.mutate();
  }

  function outraConta() {
    setCredenciais(null);
    setNome("");
    setSobrenome("");
    setEmail("");
    setTelefone("");
    setCargoId("");
    setUnidadeId("");
    setGestorId("");
  }

  /* O endereço que o servidor vai montar, mostrado antes de ele o montar. A
     conta é a mesma de `apelidoDoNome`, do lado de lá; divergir dela mostraria
     um login que não é o que a pessoa vai receber, e por isso a tela chama o
     que mostra de "algo como" e não de promessa. */
  const dominio = me?.email.split("@")[1] ?? "";
  const previsto =
    apelido(`${nome} ${sobrenome}`) !== "" && dominio !== ""
      ? `${apelido(`${nome} ${sobrenome}`)}@${dominio}`
      : null;

  return (
    <Sheet open onOpenChange={(aberta) => !aberta && aoFechar()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col gap-0"
      >
        <header className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl font-bold tracking-tight pr-8 flex items-center gap-2">
            {editando ? (
              <Pencil className="w-5 h-5 text-primary" />
            ) : (
              <UserPlus className="w-5 h-5 text-primary" />
            )}
            {editando ? "Editar usuário" : "Criar novo usuário"}
          </SheetTitle>
          <SheetDescription className="mt-1">
            {editando
              ? "Nome, contato, lotação e organograma. O e-mail não muda — é por ele que o histórico sabe quem assinou o quê."
              : "Preencha os dados da pessoa. O sistema gera o login e a senha inicial, e mostra os dois aqui quando terminar."}
          </SheetDescription>
        </header>

        {credenciais ? (
          <CredenciaisDaConta
            credenciais={credenciais}
            aoCriarOutra={outraConta}
            aoFechar={aoFechar}
          />
        ) : (
          <form onSubmit={submit} className="flex flex-col min-h-0 flex-1">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nome" htmlFor="conta-nome">
                  <Input
                    id="conta-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: João"
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Sobrenome" htmlFor="conta-sobrenome">
                  <Input
                    id="conta-sobrenome"
                    value={sobrenome}
                    onChange={(e) => setSobrenome(e.target.value)}
                    placeholder="Ex: Silva"
                  />
                </Field>
              </div>

              {conta ? (
                <Field label="E-mail" htmlFor="conta-email">
                  <Input id="conta-email" value={conta.email} disabled readOnly />
                  <p className="text-xs text-muted-foreground">
                    O e-mail é quem a pessoa é para o histórico — cada
                    confirmação já feita está assinada com ele, e por isso não se
                    troca. Um endereço errado se resolve criando a conta certa e
                    desativando esta.
                  </p>
                </Field>
              ) : (
                <Field label="E-mail (opcional)" htmlFor="conta-email">
                  <Input
                    id="conta-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={previsto ?? "pessoa@empresa.com"}
                  />
                  <p className="text-xs text-muted-foreground">
                    {previsto
                      ? `Em branco, o login vira ${previsto} — é por ele que a pessoa entra.`
                      : "Em branco, o sistema gera o login a partir do nome e do domínio da sua conta."}
                  </p>
                </Field>
              )}

              <Field label="Telefone (opcional)" htmlFor="conta-telefone">
                <Input
                  id="conta-telefone"
                  type="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="(11) 99999-9999"
                />
              </Field>

              <CamposDeLotacao
                prefixo="conta"
                cargoId={cargoId}
                unidadeId={unidadeId}
                aoTrocarCargo={setCargoId}
                aoTrocarUnidade={setUnidadeId}
              />

              <EscolhaDoPapel
                papelId={papelId}
                aoTrocar={setPapelId}
                escolherPadrao={!editando}
              />

              <EscolhaDoGestor
                gestorId={gestorId}
                aoTrocar={setGestorId}
                excluir={conta?.id ?? null}
              />

              {error && <Refusal>{error}</Refusal>}
            </div>

            <footer className="border-t px-6 py-4 shrink-0 flex items-center gap-2">
              <Button
                type="submit"
                className="gap-2 flex-1"
                disabled={gravando.isPending}
              >
                {editando ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                {gravando.isPending
                  ? "Salvando…"
                  : editando
                    ? "Salvar alterações"
                    : "Criar usuário e gerar credenciais"}
              </Button>
              <Button type="button" variant="ghost" onClick={aoFechar}>
                Cancelar
              </Button>
            </footer>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * O nome dividido em dois campos, e remontado sem perder nada.
 *
 * `João` de `João da Silva`, e `da Silva` do mesmo. A divisão é no primeiro
 * espaço e não no meio: quem tem três nomes vê os dois últimos juntos, e
 * salvar devolve exatamente a string que estava no banco — que é a propriedade
 * que importa numa tela que abre, mostra e grava de volta.
 */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

function restoDoNome(nome: string): string {
  return nome.trim().split(/\s+/).slice(1).join(" ");
}

/**
 * O que a criação devolve — a conta, e as credenciais que só existem aqui.
 *
 * `senhaInicial` volta uma vez e nunca mais: o banco guarda o hash, e nenhuma
 * rota a devolve depois. `emailGerado` distingue o endereço que o servidor
 * montou do que quem criou digitou, porque só o primeiro é novidade para quem
 * está lendo a tela.
 */
interface CredenciaisCriadas {
  id: string;
  name: string;
  email: string;
  senhaInicial: string;
  senhaGerada: boolean;
  emailGerado: boolean;
}

/**
 * A tela que substitui o formulário depois de criar: as duas credenciais, e o
 * aviso de que a senha não volta.
 *
 * Ela ocupa a gaveta inteira de propósito. Um aviso discreto embaixo de um
 * formulário ainda preenchido convida a fechar sem ler — e fechar sem ler,
 * aqui, custa uma redefinição de senha e um telefonema.
 */
function CredenciaisDaConta({
  credenciais,
  aoCriarOutra,
  aoFechar,
}: {
  credenciais: CredenciaisCriadas;
  aoCriarOutra: () => void;
  aoFechar: () => void;
}) {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <p className="flex items-start gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Conta criada para <strong>{credenciais.name}</strong>.
          </span>
        </p>

        <div className="rounded-lg border bg-muted/40 divide-y">
          <CredencialCopiavel
            rotulo={credenciais.emailGerado ? "Login gerado" : "Login"}
            valor={credenciais.email}
          />
          <CredencialCopiavel
            rotulo="Senha inicial"
            valor={credenciais.senhaInicial}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {credenciais.senhaGerada
            ? "Esta é a única vez que a senha aparece — o sistema guarda só o resumo criptográfico dela. "
            : ""}
          Passe as duas por um canal seguro e peça que a pessoa troque a senha em
          Configurações → Meu Perfil assim que entrar. Se a senha se perder, use
          “Redefinir senha” na linha da conta.
        </p>
      </div>

      <footer className="border-t px-6 py-4 shrink-0 flex items-center gap-2">
        <Button type="button" variant="outline" className="gap-2" onClick={aoCriarOutra}>
          <UserPlus className="w-4 h-4" />
          Criar outro
        </Button>
        <Button type="button" onClick={aoFechar} className="flex-1">
          Concluir
        </Button>
      </footer>
    </div>
  );
}

/** Uma credencial com o botão de copiar — ninguém digita à mão o que pode colar. */
function CredencialCopiavel({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    await navigator.clipboard.writeText(valor);
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-3xs uppercase tracking-wide text-muted-foreground">
          {rotulo}
        </p>
        <code className="text-sm font-mono break-all">{valor}</code>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={copiar}
        aria-label={copiado ? `${rotulo} copiado` : `Copiar ${rotulo.toLowerCase()}`}
      >
        {copiado ? (
          <Check className="w-3.5 h-3.5 text-emerald-600" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        {copiado ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

/**
 * O papel da conta — a lista vem do cadastro, e não do código.
 *
 * Eram duas opções escritas aqui, `Operador` e `Administrador`, e elas
 * respondiam uma pergunta só: quem gerencia contas. O que a pessoa **alcança**
 * ficava inteiramente na tela de Permissões, decidido conta a conta — trinta
 * decisões repetidas a cada conta nova, e uma delas esquecida em silêncio.
 *
 * Agora as opções são as linhas de Configurações → Papéis, cada uma com as
 * permissões que alguém cadastrou, e a conta **acompanha** o papel: mudar o
 * papel muda o acesso de quem o usa. Os dois de sempre continuam na lista, como
 * papéis do sistema.
 *
 * Conta sem papel — a criada pelo terminal antes do cadastro — abre com o campo
 * vazio e a frase que explica; escolher um papel é o que a traz para o cadastro.
 */
function EscolhaDoPapel({
  papelId,
  aoTrocar,
  escolherPadrao,
}: {
  papelId: string;
  aoTrocar: (id: string) => void;
  /**
   * Conta nova abre com um papel escolhido, e não com o campo vazio.
   *
   * O servidor tem um padrão — o papel do sistema que não administra —, e um
   * campo em branco que grava esse padrão é um formulário que decide sem
   * mostrar o que decidiu. Aqui o padrão aparece escolhido, e quem quiser outro
   * troca; na edição não há padrão nenhum a aplicar, e o campo mostra o papel
   * que a conta tem (ou o vazio de quem não tem nenhum).
   */
  escolherPadrao: boolean;
}) {
  const { data: papeis = [], isLoading } = usePapeis();

  useEffect(() => {
    if (!escolherPadrao || papelId !== "" || papeis.length === 0) return;
    const padrao =
      papeis.find((p) => p.sistema && !p.gerenciaContas) ?? papeis[0]!;
    aoTrocar(padrao.id);
  }, [escolherPadrao, papelId, papeis, aoTrocar]);

  return (
    <Field label="Papel" htmlFor="conta-papel">
      <Select
        /* `undefined`, e não `""`: o Radix reserva a string vazia para "nada
           escolhido" e recusa item com esse valor. */
        value={papelId === "" ? undefined : papelId}
        onValueChange={aoTrocar}
      >
        <SelectTrigger id="conta-papel">
          <SelectValue
            placeholder={isLoading ? "Carregando papéis…" : "Escolha um papel…"}
          />
        </SelectTrigger>
        <SelectContent>
          {papeis.map((papel) => (
            <SelectItem key={papel.id} value={papel.id}>
              {papel.nome}
              {papel.gerenciaContas ? " — também gerencia contas" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Papel é acesso, e não hierarquia: quem responde por quem é o campo abaixo.
        O que cada papel alcança se cadastra em Papéis; a exceção de uma conta
        sobre o papel dela, em Permissões.
      </p>
    </Field>
  );
}

/**
 * "Reporta a" — a linha do organograma, escolhida entre as contas ativas.
 *
 * Só contas ativas entram na lista: pendurar alguém em quem já não tem acesso é
 * escrever um organograma que ninguém vai atualizar, e o servidor recusa o
 * mesmo (ver `routes/users.ts`).
 *
 * "Ninguém (topo)" é a primeira opção e o padrão, porque alguém está no topo —
 * é resposta, e não campo por preencher.
 */
function EscolhaDoGestor({
  gestorId,
  aoTrocar,
  /** A própria conta, quando se está editando: ninguém reporta a si mesmo. */
  excluir,
}: {
  gestorId: string;
  aoTrocar: (valor: string) => void;
  excluir: string | null;
}) {
  const { data: contas = [] } = useContas();
  const ativas = contas
    .filter((c) => c.disabledAt === null && c.id !== excluir)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <Field label="Reporta a (opcional)" htmlFor="novo-gestor">
      <Select
        value={gestorId || SEM_VINCULO}
        onValueChange={(v) => aoTrocar(v === SEM_VINCULO ? "" : v)}
      >
        <SelectTrigger id="novo-gestor">
          <SelectValue placeholder="Ninguém (topo)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_VINCULO}>Ninguém (topo)</SelectItem>
          {ativas.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
              {c.cargoNome ? ` — ${c.cargoNome}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Define o organograma: quem responde por esta pessoa. Não tem relação com
        o cargo nem com o papel de acesso, e dá para mudar depois.
      </p>
    </Field>
  );
}

/** O que a linha está mostrando abaixo dela: nada, os detalhes, ou a edição. */
type Painel = "nenhum" | "detalhes" | "senha" | "desativar" | "arquivar";

/**
 * Os painéis que abrem em gaveta, e não dentro da linha.
 *
 * "detalhes" é o único que ficou: é texto sobre a conta que está logo acima
 * dele — último acesso, sessões, quem criou —, e lê-se junto com o nome. Os
 * outros dois pedem um campo e uma confirmação, e cresciam empurrando a lista
 * para baixo — pelo mesmo motivo que levou a edição para a gaveta do painel.
 */
const EM_GAVETA: Painel[] = ["senha", "desativar", "arquivar"];

function UserRow({
  user,
  /* O lápis não abre mais nada dentro da linha: ele pede a gaveta ao painel,
     que é quem sabe que só existe uma. */
  aoEditar,
}: {
  user: ManagedUser;
  aoEditar: () => void;
}) {
  const queryClient = useQueryClient();
  const [, navegar] = useLocation();
  const { user: me, visualizarComo, isSubmitting } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel>("nenhum");
  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const disabled = user.disabledAt !== null;
  const arquivada = user.archivedAt !== null;
  const isMe = me?.id === user.id;
  const souAdmin = me?.role === "ADMIN";

  /*
    O olho abre o produto **como** aquela pessoa — a pergunta que esta tela
    fazia sem conseguir responder: *o que ela vê quando entra?* O menu dela sai
    das permissões dela, e ler a tela de Permissões não é a mesma coisa que
    abrir a tela. Ver `lib/auth.tsx` e `routes/auth.ts`.

    A sessão continua sendo a de quem clicou — nada de senha, nada de login —, e
    o servidor recusa qualquer escrita enquanto a visualização estiver aberta. A
    faixa laranja no topo diz as duas coisas, e é por ela que se volta.

    Duas contas não se visualizam, e a razão é a mesma nos dois casos — não há o
    que ver: a própria (já se está dentro dela) e uma desativada (ela não entra
    no sistema).
  */
  const porQueNaoVisualizar = isMe
    ? "Esta é a sua conta — é o que você já está vendo."
    : disabled
      ? "Conta desativada: ela não entra no sistema, então não há o que visualizar."
      : null;

  const olhar = useMutation({
    mutationFn: () => visualizarComo(user.id),
    /*
      Sai de Configurações ao entrar: a conta visualizada quase nunca alcança
      esta tela, e ficar nela mostraria a recusa de acesso como primeira coisa
      da visualização — o produto respondendo "você não pode" a quem acabou de
      pedir para ver o que a pessoa pode. A home do produto é o que ela vê ao
      entrar, que é justamente o que se foi conferir.
    */
    onSuccess: () => navegar("~/"),
    onError: (err: Error) => setError(err.message),
  });

  const recarregar = () => queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });

  /* Fechar a gaveta da senha limpa o que foi digitado e a recusa que sobrou, e
     devolve quem estava lendo os detalhes aos detalhes. */
  const fecharSenha = () => {
    setPainel("detalhes");
    setNewPassword("");
    setError(null);
  };

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

  /*
    Arquivar e desarquivar são duas rotas, como desativar e reativar, e pela
    mesma razão escrita em `routes/users.ts`: têm consequências opostas.
    Arquivar não mexe em acesso nenhum — o servidor recusa arquivar quem ainda
    entra, e é por isso que o gesto só aparece em conta desativada.
  */
  const arquivar = useMutation({
    mutationFn: (acao: "arquivar" | "desarquivar") =>
      post(`/users/${user.id}/${acao}`),
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

  return (
    <>
      <div className={cn("rounded-lg border bg-card", arquivada && "opacity-70")}>
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

            {arquivada && (
              <Badge
                variant="outline"
                className="gap-1 text-muted-foreground"
                title={`Fora da lista desde ${date(user.archivedAt!)}${
                  user.archivedBy ? `, por ${user.archivedBy}` : ""
                }. A conta continua no sistema, com o histórico assinada por ela.`}
              >
                <Archive className="w-3 h-3" />
                arquivada
              </Badge>
            )}

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

            {/*
              O olho é "ver o produto como esta pessoa"; os detalhes da conta
              passaram para a seta ao lado. A troca é deliberada: o olho é o ícone
              que quem desenhou a tela procura para *ver pelos olhos de alguém*, e
              era o único gesto desta linha que não fazia nada além de abrir um
              parágrafo de texto que a seta abre igual.
            */}
            {souAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Ver o produto como ${user.name}`}
                title={
                  porQueNaoVisualizar ??
                  `Abre o produto como ${user.name} vê. A sessão continua sendo a sua, e nada pode ser alterado enquanto durar.`
                }
                disabled={porQueNaoVisualizar !== null || olhar.isPending || isSubmitting}
                onClick={() => olhar.mutate()}
              >
                <Eye className="w-4 h-4" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Ver detalhes de ${user.name}`}
              title="Último acesso, sessões abertas, quem criou a conta."
              aria-expanded={painel === "detalhes"}
              onClick={() => alternar("detalhes")}
            >
              <ChevronDown
                className={cn(
                  "w-4 h-4 transition-transform",
                  painel === "detalhes" && "rotate-180",
                )}
              />
            </Button>

            {souAdmin && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Editar ${user.name}`}
                  onClick={aoEditar}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                {/*
                  Um ícone, e dois atos que nunca se confundem porque nunca
                  aparecem juntos: a lixeira desativa quem tem acesso, e a caixa
                  de arquivo tira da lista quem já não tem. Antes, numa conta
                  desativada, a lixeira ficava apagada e sem nada a oferecer — e
                  quem clicava nela numa conta inativa estava pedindo justamente
                  isto: sumir com ela da lista, sem apagar ninguém.
                */}
                {disabled ? (
                  arquivada ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Devolver ${user.name} à lista`}
                      title="Devolve a conta à lista. O acesso continua desativado — reativar é o interruptor ao lado."
                      disabled={arquivar.isPending}
                      onClick={() => arquivar.mutate("desarquivar")}
                    >
                      <ArchiveRestore className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Arquivar ${user.name}`}
                      title="Tira a conta da lista sem apagar nada. Ninguém é apagado deste produto — o histórico continua assinado por ela."
                      disabled={isMe || arquivar.isPending}
                      onClick={() => alternar("arquivar")}
                    >
                      <Archive className="w-4 h-4" />
                    </Button>
                  )
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    aria-label={`Desativar ${user.name}`}
                    onClick={() => alternar("desativar")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
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
              {user.departamentoNome ? ` · ${user.departamentoNome}` : ""}
              {user.unidadeNome ? ` · ${user.unidadeNome}` : " · sem unidade"}
              {" · "}
              {/* O papel pelo nome do cadastro; `role` só quando a conta é
                  anterior a ele e não tem papel nenhum. */}
              {user.papelNome ?? (user.role === "ADMIN" ? "administrador" : "operador")}
            </div>
            {arquivada && (
              <div className="text-xs text-muted-foreground">
                Arquivada em {date(user.archivedAt!)}
                {user.archivedBy ? ` por ${user.archivedBy}` : ""} — fora da
                lista, e inteira no sistema.
              </div>
            )}
            {/* Telefone e gestor só aparecem quando existem: uma linha que diz
                "sem telefone · sem gestor" ocupa espaço para não informar nada —
                e as duas são opcionais por desenho, não lacunas a cobrar. */}
            {(user.telefone || user.gestorNome) && (
              <div className="text-xs text-muted-foreground">
                {user.telefone}
                {user.telefone && user.gestorNome ? " · " : ""}
                {user.gestorNome ? `reporta a ${user.gestorNome}` : ""}
              </div>
            )}
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

        {disabled && souAdmin && painel === "nenhum" && (
          <div className="border-t px-4 py-2 flex items-center gap-1 flex-wrap">
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
            {/* Reativar desarquiva junto — o servidor faz as duas coisas (ver
                `setUserDisabled`), porque voltar a entrar no produto e
                continuar fora da lista de quem entra seriam as duas metades da
                mesma contradição. */}
            {arquivada ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 h-7"
                disabled={arquivar.isPending}
                onClick={() => arquivar.mutate("desarquivar")}
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
                Devolver à lista
              </Button>
            ) : (
              !isMe && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 h-7 text-muted-foreground"
                  disabled={arquivar.isPending}
                  onClick={() => alternar("arquivar")}
                >
                  <Archive className="w-3.5 h-3.5" />
                  Arquivar
                </Button>
              )
            )}
          </div>
        )}

        {/* A recusa aparece dentro da gaveta que a provocou, onde estão o campo
            e o botão que falharam: no pé da linha, ela ficaria atrás do painel
            aberto, sem ser lida por quem acabou de tentar. Aqui resta a recusa
            dos gestos que são da própria linha — reativar acesso e o olho de
            visualizar como. */}
        {error && !EM_GAVETA.includes(painel) && (
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

      {/*
        Redefinir senha sai dos detalhes, e volta para eles: foi de lá que ela
        foi pedida, e fechar a gaveta em "nenhum" recolheria o painel que quem
        redefiniu tinha aberto para ler último acesso e sessões abertas.
      */}
      <Sheet
        open={painel === "senha"}
        onOpenChange={(aberta) => !aberta && fecharSenha()}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col gap-0"
        >
          <header className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle className="text-xl font-bold tracking-tight pr-8 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              Redefinir a senha de {user.name}
            </SheetTitle>
            <SheetDescription className="mt-1">
              A senha vale na hora e as sessões abertas dessa pessoa caem. Este
              produto não manda e-mail: passe a senha por um canal seguro e peça
              a troca em Meu Perfil.
            </SheetDescription>
          </header>

          <form
            className="flex flex-col min-h-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate();
            }}
          >
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <Field label="Senha nova" htmlFor={`reset-${user.id}`}>
                <Input
                  id={`reset-${user.id}`}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="mínimo 10 caracteres"
                  required
                />
              </Field>

              {error && <Refusal>{error}</Refusal>}
            </div>

            <footer className="border-t px-6 py-4 shrink-0 flex items-center gap-2">
              <Button type="submit" className="flex-1" disabled={reset.isPending}>
                {reset.isPending ? "Redefinindo…" : "Confirmar"}
              </Button>
              <Button type="button" variant="ghost" onClick={fecharSenha}>
                Cancelar
              </Button>
            </footer>
          </form>
        </SheetContent>
      </Sheet>

      {/*
        Arquivar tem gaveta pela mesma razão que desativar: é um gesto que some
        com uma linha da tela, e quem clica precisa ler o que ele faz — e o que
        ele não faz — antes de o clique acontecer, não depois de a conta sumir
        da lista.
      */}
      <Sheet
        open={painel === "arquivar"}
        onOpenChange={(aberta) => !aberta && setPainel("nenhum")}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col gap-0"
        >
          <header className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle className="text-xl font-bold tracking-tight pr-8 flex items-center gap-2">
              <Archive className="w-5 h-5 text-muted-foreground" />
              Arquivar {user.name}?
            </SheetTitle>
            <SheetDescription className="mt-1">
              A conta sai desta lista. Nada mais muda.
            </SheetDescription>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              Arquivar não apaga e não tira acesso — o acesso desta conta já
              está desativado, e é por isso que arquivar é oferecido aqui. O que
              muda é a lista: contas de quem saiu da empresa param de aparecer
              entre as de quem trabalha aqui, e o botão “Ver arquivadas”, no
              topo, traz todas de volta à vista quando você precisar.
            </p>
            <p className="text-sm text-muted-foreground">
              A linha continua inteira no sistema, e continua assinando o que
              assinou: cada confirmação de curadoria e cada promoção de vigência
              feita por {user.name} segue com o nome dela. Reativar o acesso
              devolve a conta à lista junto.
            </p>

            {error && <Refusal>{error}</Refusal>}
          </div>

          <footer className="border-t px-6 py-4 shrink-0 flex items-center gap-2">
            <Button
              className="flex-1"
              disabled={arquivar.isPending}
              onClick={() => arquivar.mutate("arquivar")}
            >
              <Archive className="w-4 h-4 mr-1.5" />
              {arquivar.isPending ? "Arquivando…" : "Arquivar conta"}
            </Button>
            <Button variant="ghost" onClick={() => setPainel("nenhum")}>
              Cancelar
            </Button>
          </footer>
        </SheetContent>
      </Sheet>

      {/*
        A confirmação diz o que vai acontecer de verdade — e o que não vai.
        Quem clica numa lixeira espera apagar; aqui ela desativa, e a frase
        precisa desfazer essa expectativa antes do clique, não depois. Na
        gaveta ela ganha o que uma confirmação pede e a linha não dava: o texto
        inteiro à vista, sem a lista continuando por baixo dele.
      */}
      <Sheet
        open={painel === "desativar"}
        onOpenChange={(aberta) => !aberta && setPainel("nenhum")}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col gap-0"
        >
          <header className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle className="text-xl font-bold tracking-tight pr-8 flex items-center gap-2">
              <Ban className="w-5 h-5 text-destructive" />
              Desativar {user.name}?
            </SheetTitle>
            <SheetDescription className="mt-1">
              O acesso é cortado e as sessões abertas caem na hora.
            </SheetDescription>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              A conta não é apagada, e não há como apagá-la: cada confirmação de
              curadoria e cada promoção de vigência que essa pessoa fez está
              assinada com este e-mail, e apagar a linha transformaria esse
              histórico num nome órfão. Reativar depois é um clique.
            </p>

            {error && <Refusal>{error}</Refusal>}
          </div>

          <footer className="border-t px-6 py-4 shrink-0 flex items-center gap-2">
            <Button
              variant="destructive"
              className="flex-1"
              disabled={act.isPending}
              onClick={() => act.mutate("disable")}
            >
              <Ban className="w-4 h-4 mr-1.5" />
              {act.isPending ? "Desativando…" : "Desativar acesso"}
            </Button>
            <Button variant="ghost" onClick={() => setPainel("nenhum")}>
              Cancelar
            </Button>
          </footer>
        </SheetContent>
      </Sheet>
    </>
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
      <span className="text-3xs uppercase tracking-wide text-muted-foreground/70">
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
