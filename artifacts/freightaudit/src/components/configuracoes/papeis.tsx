import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IdCard,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, Refusal } from "@/components/configuracoes/campos";
import { CHAVE_DAS_CONTAS } from "@/components/configuracoes/contas";
import {
  CHAVE_DOS_PAPEIS,
  usePapeis,
  type DetalheDoPapel,
  type EventoDoPapel,
  type Papel,
} from "@/components/configuracoes/papeis-consulta";
import {
  MatrizDeAcesso,
  contarPorNivel,
  rotuloDaChave,
  rotuloDoNivel,
} from "@/components/configuracoes/matriz-de-acesso";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NIVEL_PADRAO, type Nivel } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * Papéis — o acesso cadastrado uma vez, valendo para quem o usa.
 *
 * A tela de Permissões responde "o que **esta pessoa** alcança", uma conta de
 * cada vez. Ela resolve o caso de tirar um módulo de alguém e não resolve o
 * caso comum: a conta nova. Quem cria a décima conta de conferente repetia,
 * módulo a módulo, as mesmas trinta decisões das nove anteriores — e errava uma
 * em silêncio, porque não havia com o que comparar.
 *
 * Aqui a lista de decisões ganha nome. `Conferente` diz o que um conferente
 * alcança; a conta aponta para o papel no cadastro de Usuários; e mexer no
 * papel muda o acesso de todo mundo que o usa, na hora — **é vínculo, não
 * modelo copiado**. Um modelo envelheceria calado: no dia em que a Curadoria
 * saísse do alcance dos conferentes, alguém teria de abrir as dez contas, e a
 * décima primeira nasceria com o acesso antigo.
 *
 * Três coisas que esta tela diz e que nenhuma outra dizia:
 *
 * · **Quantas contas cada papel alcança.** É o número que transforma "mexer num
 *   papel" de edição de cadastro em ato administrativo — e ele aparece antes do
 *   clique, não depois.
 * · **Gerenciar contas é do papel.** Era `role`, dois valores no código; virou
 *   uma chave do papel, e a conta herda. `Operador` e `Administrador` continuam
 *   existindo como papéis do sistema — não se renomeiam nem se apagam, porque
 *   toda conta anterior ao cadastro aponta para um dos dois —, mas as
 *   permissões deles se editam como as de qualquer outro.
 * · **A exceção continua sendo da pessoa.** O que alguém decidiu em Permissões
 *   sobre uma conta vence o papel dela, e continua valendo depois de uma troca
 *   de papel. Esta tela não desfaz decisões tomadas uma a uma; ela mostra o caso
 *   geral, e Permissões mostra as duas camadas.
 */

const CHAVE_DO_DETALHE = (id: string) => ["papeis", id] as const;

export function PainelDePapeis() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: papeis = [], error, isLoading } = usePapeis();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = me?.role === "ADMIN";

  /*
    A lista abre no primeiro papel em vez de numa tela vazia com um convite: com
    dois papéis semeados em toda instalação, "escolha um papel" seria uma
    pergunta cuja resposta a própria tela já tem.
  */
  useEffect(() => {
    if (escolhido === null && papeis.length > 0) setEscolhido(papeis[0]!.id);
  }, [escolhido, papeis]);

  const papel = papeis.find((p) => p.id === escolhido) ?? null;

  return (
    <div className="space-y-6 max-w-5xl">
      <p className="flex items-start gap-2 text-sm text-muted-foreground max-w-3xl">
        <UserCog className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <span>
          Um papel é uma lista de acesso com nome. A conta aponta para ele em
          Usuários e <strong>acompanha</strong> o que ele muda — mexer aqui vale
          na hora para todas as contas que o usam. O que alguém decidir sobre uma
          conta específica, em Permissões, continua vencendo o papel dela.
        </span>
      </p>

      {error && (
        <ApiErrorNotice
          error={error}
          what="A lista de papéis não pôde ser carregada."
        />
      )}

      {erro && <Refusal>{erro}</Refusal>}

      <div className="flex flex-wrap items-center gap-2">
        {papeis.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setEscolhido(p.id);
              setErro(null);
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left",
              "transition-colors hover:border-primary/40 hover:bg-accent/40",
              p.id === escolhido && "border-primary bg-accent/60",
            )}
          >
            <IdCard className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{p.nome}</span>
              <span className="block text-xs text-muted-foreground">
                {p.contas} conta{p.contas === 1 ? "" : "s"} ·{" "}
                {p.restricoes === 0
                  ? "alcança tudo"
                  : `${p.restricoes} restriçã${p.restricoes === 1 ? "o" : "ões"}`}
              </span>
            </span>
            {p.gerenciaContas && (
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </button>
        ))}

        {podeMexer && (
          <Button variant="outline" size="sm" onClick={() => setCriando(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Novo papel
          </Button>
        )}

        {isLoading && (
          <span className="text-sm text-muted-foreground">Carregando…</span>
        )}
      </div>

      {papel && (
        <PapelEscolhido
          papel={papel}
          podeMexer={podeMexer}
          aoFalhar={setErro}
          aoApagar={() => setEscolhido(null)}
        />
      )}

      <GavetaDoPapel
        aberta={criando}
        aoFechar={() => setCriando(false)}
        aoCriar={(criado) => {
          setCriando(false);
          setEscolhido(criado.id);
          void queryClient.invalidateQueries({ queryKey: CHAVE_DOS_PAPEIS });
        }}
      />

      {/*
        A lista de contas é invalidada por quase toda mutação daqui, e é de
        propósito: mudar `gerencia contas` de um papel reescreve o acesso de
        quem o usa, e a tela de Usuários mostraria o estado anterior até alguém
        recarregar a página.
      */}
      <p className="text-xs text-muted-foreground">
        Quem entra com cada papel está em{" "}
        <a className="underline" href="/configuracoes/usuarios">
          Usuários
        </a>
        ; as exceções de cada conta, em{" "}
        <a className="underline" href="/configuracoes/permissoes">
          Permissões
        </a>
        .
      </p>
    </div>
  );
}

function PapelEscolhido({
  papel,
  podeMexer,
  aoFalhar,
  aoApagar,
}: {
  papel: Papel;
  podeMexer: boolean;
  aoFalhar: (mensagem: string | null) => void;
  aoApagar: () => void;
}) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(papel.nome);
  const [descricao, setDescricao] = useState(papel.descricao ?? "");

  useEffect(() => {
    setNome(papel.nome);
    setDescricao(papel.descricao ?? "");
  }, [papel.id, papel.nome, papel.descricao]);

  const detalhe = useQuery<DetalheDoPapel, Error>({
    queryKey: CHAVE_DO_DETALHE(papel.id),
    queryFn: () => fetchJson<DetalheDoPapel>(`/papeis/${papel.id}`),
  });

  const permissoes = detalhe.data?.permissoes ?? {};
  const resumo = useMemo(() => contarPorNivel(permissoes), [permissoes]);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: CHAVE_DOS_PAPEIS });
    void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });
    void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
  };

  const salvarCadastro = useMutation({
    mutationFn: (mudanca: Record<string, unknown>) =>
      fetchJson<unknown>(`/papeis/${papel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      }),
    onSuccess: () => {
      aoFalhar(null);
      invalidar();
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  const definir = useMutation({
    mutationFn: (niveis: Record<string, Nivel>) =>
      fetchJson<DetalheDoPapel & { permissoes: Record<string, Nivel> }>(
        `/papeis/${papel.id}/permissoes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ niveis }),
        },
      ),
    onSuccess: (resposta) => {
      aoFalhar(null);
      queryClient.setQueryData(CHAVE_DO_DETALHE(papel.id), {
        papel: resposta.papel,
        permissoes: resposta.permissoes,
        universaisDesligadas: resposta.universaisDesligadas,
        historico: resposta.historico,
      });
      invalidar();
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  const apagar = useMutation({
    mutationFn: () =>
      fetchJson<unknown>(`/papeis/${papel.id}`, { method: "DELETE" }),
    onSuccess: () => {
      aoFalhar(null);
      aoApagar();
      invalidar();
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  const cadastroMudou =
    nome.trim() !== papel.nome || descricao.trim() !== (papel.descricao ?? "");

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome" htmlFor="papel-nome">
            <Input
              id="papel-nome"
              value={nome}
              disabled={!podeMexer || papel.sistema}
              onChange={(e) => setNome(e.target.value)}
            />
            {papel.sistema && (
              <p className="text-xs text-muted-foreground">
                Papel do sistema: o nome não muda, porque toda conta criada antes
                do cadastro de papéis aponta para ele. O que ele alcança, sim.
              </p>
            )}
          </Field>

          <Field label="Descrição" htmlFor="papel-descricao">
            <Textarea
              id="papel-descricao"
              rows={2}
              value={descricao}
              disabled={!podeMexer}
              placeholder="Quem usa este papel, em uma linha."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="papel-admin"
              checked={papel.gerenciaContas}
              disabled={!podeMexer || papel.sistema || salvarCadastro.isPending}
              onCheckedChange={(valor) =>
                salvarCadastro.mutate({ gerenciaContas: valor })
              }
            />
            <Label htmlFor="papel-admin" className="text-sm">
              Gerencia contas
            </Label>
            <span className="text-xs text-muted-foreground">
              Cria, desativa, redefine senha e muda o papel dos outros.
            </span>
          </div>

          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {papel.contas} conta{papel.contas === 1 ? "" : "s"} neste papel
          </span>

          {cadastroMudou && podeMexer && (
            <Button
              size="sm"
              disabled={salvarCadastro.isPending}
              onClick={() =>
                salvarCadastro.mutate({
                  ...(papel.sistema ? {} : { nome: nome.trim() }),
                  descricao: descricao.trim(),
                })
              }
            >
              Salvar cadastro
            </Button>
          )}

          {podeMexer && !papel.sistema && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive"
              disabled={apagar.isPending}
              onClick={() => apagar.mutate()}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Apagar papel
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t pt-4 text-sm">
          <Contagem numero={resumo.SEM_ACESSO} rotulo="sem acesso" cor="text-rose-700" />
          <Contagem numero={resumo.VISUALIZAR} rotulo="somente leitura" cor="text-blue-700" />
          <Contagem numero={resumo.EDITAR} rotulo="editam" cor="text-emerald-700" />
          {papel.contas > 0 && (
            <span className="text-xs text-muted-foreground">
              Cada mudança abaixo vale imediatamente para as {papel.contas} contas
              deste papel.
            </span>
          )}
        </div>

        {detalhe.error !== null && (
          <ApiErrorNotice
            error={detalhe.error}
            what="As permissões deste papel não puderam ser carregadas."
          />
        )}

        {!podeMexer && (
          <p className="text-sm text-muted-foreground">
            A sua conta é de operador: esta tela é leitura. Quem cadastra papéis é
            um administrador.
          </p>
        )}

        <MatrizDeAcesso
          niveis={permissoes}
          universaisDesligadas={detalhe.data?.universaisDesligadas ?? []}
          desabilitado={!podeMexer || definir.isPending}
          carregando={detalhe.isLoading}
          aoEscolher={(niveis) => definir.mutate(niveis)}
        />

        <HistoricoDoPapel linhas={detalhe.data?.historico ?? []} />
      </CardContent>
    </Card>
  );
}

function Contagem({
  numero,
  rotulo,
  cor,
}: {
  numero: number;
  rotulo: string;
  cor: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("text-lg font-bold tabular-nums", cor)}>{numero}</span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
    </span>
  );
}

/**
 * A gaveta de criar papel — nome, descrição e se gerencia contas.
 *
 * O papel nasce **sem restrição nenhuma**, alcançando tudo, e não é preguiça: é
 * a mesma regra do resto do produto — a ausência de decisão concede, e o que se
 * faz na matriz é tirar. Um papel que nascesse fechado obrigaria a liberar
 * quarenta módulos para descrever um conferente, e a primeira tela nova do
 * produto ficaria invisível para ele sem que ninguém tivesse decidido isso.
 */
function GavetaDoPapel({
  aberta,
  aoFechar,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoCriar: (papel: Papel) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [gerenciaContas, setGerenciaContas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberta) {
      setNome("");
      setDescricao("");
      setGerenciaContas(false);
      setErro(null);
    }
  }, [aberta]);

  const criar = useMutation({
    mutationFn: () =>
      fetchJson<Papel>("/papeis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          descricao: descricao.trim() === "" ? null : descricao.trim(),
          gerenciaContas,
        }),
      }),
    onSuccess: aoCriar,
    onError: (err: Error) => setErro(err.message),
  });

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <header className="border-b px-6 py-4">
          <SheetTitle>Novo papel</SheetTitle>
          <SheetDescription>
            Ele nasce alcançando tudo. O que ele <strong>não</strong> alcança se
            decide na matriz, depois de criado — como em toda conta.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Field label="Nome" htmlFor="novo-papel-nome">
            <Input
              id="novo-papel-nome"
              value={nome}
              placeholder="Conferente"
              onChange={(e) => setNome(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              É o nome que aparece no seletor de papel de cada conta.
            </p>
          </Field>

          <Field label="Descrição" htmlFor="novo-papel-descricao">
            <Textarea
              id="novo-papel-descricao"
              rows={2}
              value={descricao}
              placeholder="Quem usa este papel, em uma linha."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Switch
              id="novo-papel-admin"
              checked={gerenciaContas}
              onCheckedChange={setGerenciaContas}
            />
            <Label htmlFor="novo-papel-admin" className="text-sm">
              Gerencia contas
            </Label>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Quem tem este papel cria contas, desativa, redefine senha e muda o
            papel dos outros. É o antigo “administrador”, agora dizível por papel.
          </p>

          {erro && <Refusal>{erro}</Refusal>}
        </div>

        <footer className="border-t px-6 py-4 flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={nome.trim() === "" || criar.isPending}
            onClick={() => criar.mutate()}
          >
            Cadastrar papel
          </Button>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

/**
 * O que mudou neste papel, quem mudou e quando.
 *
 * Mexer num papel é o ato mais amplo desta parte do produto — muda o acesso de
 * todo mundo que o usa —, e por isso ele tem histórico próprio, além do de cada
 * conta. As duas listas respondem perguntas diferentes: aqui, "por que este
 * papel mudou"; lá, "por que **eu** perdi esta tela".
 */
function HistoricoDoPapel({ linhas }: { linhas: EventoDoPapel[] }) {
  if (linhas.length === 0) {
    return (
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Nenhuma mudança registrada neste papel.
      </p>
    );
  }

  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Mudanças neste papel
      </p>
      <ul className="space-y-1.5">
        {linhas.slice(0, 12).map((linha, indice) => (
          <li
            key={`${linha.em}|${linha.chave ?? linha.tipo}|${indice}`}
            className="text-xs text-muted-foreground"
          >
            {linha.tipo === "PERMISSAO" && linha.chave !== null ? (
              <>
                <span className="font-medium text-foreground">
                  {rotuloDaChave(linha.chave)}
                </span>{" "}
                {linha.nivelAnterior
                  ? `de ${rotuloDoNivel(linha.nivelAnterior)} `
                  : `de ${rotuloDoNivel(NIVEL_PADRAO)} `}
                para {rotuloDoNivel(linha.nivel ?? NIVEL_PADRAO)}
              </>
            ) : (
              <span className="font-medium text-foreground">
                {linha.detalhe ?? linha.tipo.toLowerCase()}
              </span>
            )}{" "}
            · {linha.por} · {new Date(linha.em).toLocaleString("pt-BR")}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O selo de "gerencia contas" que a lista de Usuários também usa. */
export function SeloDeAdministracao() {
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <ShieldCheck className="h-3 w-3" />
      Gerencia contas
    </Badge>
  );
}
