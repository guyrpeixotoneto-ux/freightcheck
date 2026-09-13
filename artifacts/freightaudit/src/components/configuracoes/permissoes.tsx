import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
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
  CHAVE_DOS_PERFIS,
  usePerfis,
  type DetalheDoPerfil,
  type EventoDoPerfil,
  type Perfil,
} from "@/components/configuracoes/perfis-consulta";
import {
  CHAVE_DOS_MODULOS_UNIVERSAIS,
  useModulosUniversais,
  type ModulosUniversais,
} from "@/components/configuracoes/modulos-universais-consulta";
import {
  BotoesDeNivel,
  Contagem,
  MatrizDeAcesso,
  contarPorNivel,
  rotuloDaChave,
  rotuloDoNivel,
} from "@/components/configuracoes/matriz-de-acesso";
import { ExcecoesPorConta } from "@/components/configuracoes/permissoes-por-conta";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NIVEL_PADRAO, padraoDe, type Nivel } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * Permissões — o único lugar onde se decide quem alcança o quê.
 *
 * Eram três seções no índice de Configurações, e as três respondiam a mesma
 * pergunta sobre sujeitos diferentes: `Papéis` sobre um grupo, `Permissões`
 * sobre uma pessoa, `Módulos Universais` sobre a instalação. Quem precisava
 * fechar o QLP para a operação inteira começava numa e terminava em outra, sem
 * que nada na primeira dissesse que a terceira existia — e a decisão se perdia
 * no caminho entre elas.
 *
 * Hoje é uma seção só, e as três camadas aparecem na mesma linha da matriz:
 *
 *   **Inativar** (a casa) › **exceção da conta** › **perfil** › **piso do perfil**
 *
 * lidas da mais forte para a mais fraca. Inativar tira do ar para todo mundo e
 * nenhuma das outras devolve; a exceção de uma pessoa vence o perfil dela; o
 * perfil vence o próprio piso; e o piso é o que vale onde ninguém decidiu nada.
 *
 * **A palavra é perfil, e o cadastro é o dos três de fábrica.**
 * `Administrador`, `Gestor` e `Leitor` nascem com toda instalação e não se
 * apagam — toda conta aponta para um deles, e um produto sem nenhum perfil que
 * administre contas é a porta trancada por dentro. O que eles alcançam, sim, se
 * edita, o piso inclusive; e quem precisa de outra combinação cadastra a sua.
 *
 * **É vínculo, e não modelo copiado.** A conta aponta para o perfil em Usuários
 * e acompanha o que ele muda, na hora. Um modelo envelheceria calado: no dia em
 * que a Curadoria saísse do alcance dos gestores, alguém teria de abrir as dez
 * contas, e a décima primeira nasceria com o acesso antigo.
 *
 * **A segunda aba é a exceção de uma pessoa**, e continua existindo porque um
 * perfil não descreve tudo — ver `permissoes-por-conta.tsx`. Ela é aba, e não
 * seção: a pergunta é a mesma, e separá-las de novo devolveria o percurso que
 * esta tela nasceu para acabar.
 */

const CHAVE_DO_DETALHE = (id: string) => ["papeis", id] as const;

type Aba = "perfil" | "conta";

export function PainelDePermissoes() {
  const [aba, setAba] = useState<Aba>("perfil");

  return (
    <div className="space-y-6 max-w-5xl">
      <nav className="flex items-center gap-1 border-b" aria-label="Permissões">
        {(
          [
            ["perfil", "Por perfil"],
            ["conta", "Exceções por conta"],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            aria-current={aba === id ? "page" : undefined}
            onClick={() => setAba(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              aba === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid={`aba-${id}`}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "perfil" ? <PorPerfil /> : <ExcecoesPorConta />}
    </div>
  );
}

/* =========================================================================
 * A aba do perfil
 * ====================================================================== */

function PorPerfil() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: perfis = [], error, isLoading } = usePerfis();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = me?.role === "ADMIN";

  /*
    A lista abre no primeiro perfil em vez de numa tela vazia com um convite:
    com três perfis semeados em toda instalação, "escolha um perfil" seria uma
    pergunta cuja resposta a própria tela já tem.
  */
  useEffect(() => {
    if (escolhido === null && perfis.length > 0) setEscolhido(perfis[0]!.id);
  }, [escolhido, perfis]);

  const perfil = perfis.find((p) => p.id === escolhido) ?? null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            O perfil de acesso
          </p>
          <h2 className="text-xl font-bold tracking-tight">
            De quem estamos falando
          </h2>
        </div>

        {error && (
          <ApiErrorNotice
            error={error}
            what="A lista de perfis não pôde ser carregada."
          />
        )}
        {erro && <Refusal>{erro}</Refusal>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {perfis.map((p) => (
            <CartaoDoPerfil
              key={p.id}
              perfil={p}
              escolhido={p.id === escolhido}
              aoEscolher={() => {
                setEscolhido(p.id);
                setErro(null);
              }}
            />
          ))}

          {podeMexer && (
            <button
              type="button"
              onClick={() => setCriando(true)}
              className={cn(
                "rounded-xl border border-dashed border-border p-4 text-left",
                "transition-colors hover:border-primary/50 hover:bg-accent/30",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              data-testid="botao-cadastrar-perfil"
            >
              <span className="flex items-center gap-1.5 font-semibold text-primary">
                <Plus className="h-4 w-4" />
                Cadastrar perfil
              </span>
              <span className="mt-1.5 block text-sm text-muted-foreground">
                Quando os três apertam: um perfil seu, com o que ele vê e o que
                ele escreve marcados módulo a módulo aqui embaixo.
              </span>
            </button>
          )}

          {isLoading && (
            <span className="self-center text-sm text-muted-foreground">
              Carregando…
            </span>
          )}
        </div>
      </section>

      {perfil && (
        <PerfilEscolhido
          perfil={perfil}
          podeMexer={podeMexer}
          aoFalhar={setErro}
          aoApagar={() => setEscolhido(null)}
        />
      )}

      <GavetaDoPerfil
        aberta={criando}
        aoFechar={() => setCriando(false)}
        aoCriar={(criado) => {
          setCriando(false);
          setEscolhido(criado.id);
          void queryClient.invalidateQueries({ queryKey: CHAVE_DOS_PERFIS });
        }}
      />

      <p className="text-xs text-muted-foreground">
        Quem entra com cada perfil está em{" "}
        <a className="underline" href="/configuracoes/usuarios">
          Usuários
        </a>
        .
      </p>
    </div>
  );
}

/**
 * O cartão de um perfil — o que ele é, antes do clique.
 *
 * O número de contas é o que transforma "mexer num perfil" de edição de
 * cadastro em ato administrativo, e por isso ele aparece **antes** de a matriz
 * abrir, e não depois. `Administrador` é o único que não se configura de todo:
 * quem administra precisa alcançar a tela onde o acesso se administra, e o
 * servidor recusa o contrário — o cartão diz isso em vez de oferecer um gesto
 * que termina em 409.
 */
function CartaoDoPerfil({
  perfil,
  escolhido,
  aoEscolher,
}: {
  perfil: Perfil;
  escolhido: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-pressed={escolhido}
      className={cn(
        "rounded-xl border bg-card p-4 text-left transition-colors",
        "hover:border-primary/40 hover:bg-accent/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        escolhido && "border-primary ring-1 ring-primary",
      )}
      data-testid={`cartao-perfil-${perfil.nome}`}
    >
      <span className="flex items-center gap-2">
        <span className="font-bold tracking-tight">{perfil.nome}</span>
        {perfil.gerenciaContas && (
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
      </span>
      <span className="mt-1 block text-sm text-muted-foreground">
        {perfil.descricao ?? "Sem descrição."}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" />
          {perfil.contas} conta{perfil.contas === 1 ? "" : "s"}
        </span>
        <span>
          {perfil.restricoes === 0
            ? `piso ${rotuloDoNivel(perfil.nivelPadrao)}, sem exceção`
            : `${perfil.restricoes} exceç${perfil.restricoes === 1 ? "ão" : "ões"} ao piso`}
        </span>
      </span>
    </button>
  );
}

function PerfilEscolhido({
  perfil,
  podeMexer,
  aoFalhar,
  aoApagar,
}: {
  perfil: Perfil;
  podeMexer: boolean;
  aoFalhar: (mensagem: string | null) => void;
  aoApagar: () => void;
}) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(perfil.nome);
  const [descricao, setDescricao] = useState(perfil.descricao ?? "");

  useEffect(() => {
    setNome(perfil.nome);
    setDescricao(perfil.descricao ?? "");
  }, [perfil.id, perfil.nome, perfil.descricao]);

  const detalhe = useQuery<DetalheDoPerfil, Error>({
    queryKey: CHAVE_DO_DETALHE(perfil.id),
    queryFn: () => fetchJson<DetalheDoPerfil>(`/papeis/${perfil.id}`),
  });

  /* A lista das chaves que o servidor recusa inativar — hoje, Configurações. */
  const universais = useModulosUniversais();

  const permissoes = detalhe.data?.permissoes ?? {};
  const piso = detalhe.data ? padraoDe(permissoes) : perfil.nivelPadrao;
  const resumo = useMemo(
    () => contarPorNivel(permissoes, piso),
    [permissoes, piso],
  );

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: CHAVE_DOS_PERFIS });
    void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_CONTAS });
    void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
  };

  const salvarCadastro = useMutation({
    mutationFn: (mudanca: Record<string, unknown>) =>
      fetchJson<unknown>(`/papeis/${perfil.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      }),
    onSuccess: () => {
      aoFalhar(null);
      /* O piso mora no detalhe (na chave `*`) e no cadastro: as duas consultas
         ficam velhas na mesma escrita. */
      void queryClient.invalidateQueries({ queryKey: CHAVE_DO_DETALHE(perfil.id) });
      invalidar();
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  const definir = useMutation({
    /*
      Um escopo, e por isso uma fila: duas mutações do mesmo `scope` não correm
      juntas no React Query.

      Sem ele, cinco cliques em cinco segundos são cinco `PUT` concorrentes, e o
      `onSuccess` de cada um escreve no cache o **mapa inteiro** que o servidor
      devolveu. A resposta que chegasse por último venceria, não a que tivesse
      partido por último — e a resposta mais antiga não conhece a decisão mais
      nova. O efeito na tela é o sintoma que a `f0664f1` documentou nos módulos
      universais: um módulo que acabou de ser fechado reaparece aberto, sem
      ninguém ter tocado nele, com o banco já correto por baixo.

      Enfileirar é a correção certa, e não um desempate por relógio: cada `PUT`
      lê o estado atual antes de decidir o que mudou, então precisa enxergar o
      anterior já gravado para o histórico não inventar uma decisão que ninguém
      tomou.

      O escopo é **por perfil**: duas decisões sobre perfis diferentes não
      disputam cache nenhum, e serializá-las só deixaria a tela mais lenta.
    */
    scope: { id: `papel-${perfil.id}` },
    mutationFn: (niveis: Record<string, Nivel>) =>
      fetchJson<DetalheDoPerfil>(`/papeis/${perfil.id}/permissoes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niveis }),
      }),
    onSuccess: (resposta) => {
      aoFalhar(null);
      queryClient.setQueryData(CHAVE_DO_DETALHE(perfil.id), {
        papel: resposta.papel,
        permissoes: resposta.permissoes,
        universaisDesligadas: resposta.universaisDesligadas,
        historico: resposta.historico,
      });
      invalidar();
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  /**
   * Apagar um perfil — e só um que ninguém use.
   *
   * A recusa quando há gente dentro é do servidor, e ela diz quantas contas
   * são: apagar aqui deixaria cada uma delas apontando para uma linha morta.
   */
  const apagar = useMutation({
    mutationFn: () =>
      fetchJson<unknown>(`/papeis/${perfil.id}`, { method: "DELETE" }),
    onSuccess: () => {
      aoFalhar(null);
      aoApagar();
      invalidar();
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  /**
   * Inativar — a camada da casa, escrita de dentro da matriz do perfil.
   *
   * A rota é a de sempre (`/modulos-universais`), e a resposta reescreve as
   * duas consultas que ela envelhece: a da casa, que a matriz lê para saber o
   * que está fora do ar, e a da sessão, de onde sai o menu desta aba — sem a
   * segunda, quem inativa o QLP continua vendo o QLP na lateral até recarregar
   * a página, e duvidaria, com razão, de que a decisão valeu.
   */
  const inativar = useMutation({
    /* A mesma fila de `definir`, e pela mesma razão — a chave do escopo é a da
       casa, porque a decisão é uma só para a instalação inteira. */
    scope: { id: "modulos-universais" },
    mutationFn: (chaves: Record<string, boolean>) =>
      fetchJson<ModulosUniversais>("/modulos-universais", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaves, motivo: null }),
      }),
    onSuccess: (resposta) => {
      aoFalhar(null);
      queryClient.setQueryData(CHAVE_DOS_MODULOS_UNIVERSAIS, resposta);
      void queryClient.invalidateQueries({ queryKey: CHAVE_DO_DETALHE(perfil.id) });
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
    onError: (err: Error) => aoFalhar(err.message),
  });

  const cadastroMudou =
    nome.trim() !== perfil.nome || descricao.trim() !== (perfil.descricao ?? "");

  const bloqueado =
    !podeMexer || definir.isPending || inativar.isPending || salvarCadastro.isPending;

  /**
   * As duas leituras que a matriz descreve chegaram.
   *
   * São duas porque são duas decisões: o que este perfil alcança (`detalhe`) e
   * o que a casa inativou para todo mundo (`universais`, de onde também sai a
   * lista do que o servidor recusa inativar). Uma sem a outra desenharia metade
   * da verdade com a cara da verdade inteira.
   */
  const lidas = detalhe.data !== undefined && universais.data !== undefined;

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome" htmlFor="perfil-nome">
            <Input
              id="perfil-nome"
              value={nome}
              disabled={!podeMexer || perfil.sistema}
              onChange={(e) => setNome(e.target.value)}
            />
            {perfil.sistema && (
              <p className="text-xs text-muted-foreground">
                Perfil do sistema: o nome não muda, porque toda conta aponta para
                um dos três. O que ele alcança, sim.
              </p>
            )}
          </Field>

          <Field label="Descrição" htmlFor="perfil-descricao">
            <Textarea
              id="perfil-descricao"
              rows={2}
              value={descricao}
              disabled={!podeMexer}
              placeholder="Quem usa este perfil, em uma linha."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="perfil-admin"
              checked={perfil.gerenciaContas}
              disabled={!podeMexer || perfil.sistema || salvarCadastro.isPending}
              onCheckedChange={(valor) =>
                salvarCadastro.mutate({ gerenciaContas: valor })
              }
            />
            <Label htmlFor="perfil-admin" className="text-sm">
              Gerencia contas
            </Label>
            <span className="text-xs text-muted-foreground">
              Cria, desativa, redefine senha e muda o perfil dos outros.
            </span>
          </div>

          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {perfil.contas} conta{perfil.contas === 1 ? "" : "s"} neste perfil
          </span>

          {cadastroMudou && podeMexer && (
            <Button
              size="sm"
              disabled={salvarCadastro.isPending}
              onClick={() =>
                salvarCadastro.mutate({
                  ...(perfil.sistema ? {} : { nome: nome.trim() }),
                  descricao: descricao.trim(),
                })
              }
            >
              Salvar cadastro
            </Button>
          )}

          {podeMexer && !perfil.sistema && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive"
              disabled={apagar.isPending}
              onClick={() => apagar.mutate()}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Apagar perfil
            </Button>
          )}
        </div>

        <PisoDoPerfil
          piso={piso}
          desabilitado={bloqueado}
          aoEscolher={(nivel) => salvarCadastro.mutate({ nivelPadrao: nivel })}
        />

        <div className="flex flex-wrap items-center gap-4 border-t pt-4 text-sm">
          <Contagem numero={resumo.SEM_ACESSO} rotulo="sem acesso" cor="text-rose-700" />
          <Contagem numero={resumo.VISUALIZAR} rotulo="somente leitura" cor="text-blue-700" />
          <Contagem numero={resumo.EDITAR} rotulo="editam" cor="text-emerald-700" />
          {perfil.contas > 0 && (
            <span className="text-xs text-muted-foreground">
              Cada mudança abaixo vale imediatamente para as {perfil.contas} contas
              deste perfil.
            </span>
          )}
        </div>

        {detalhe.error !== null && (
          <ApiErrorNotice
            error={detalhe.error}
            what="As permissões deste perfil não puderam ser carregadas."
          />
        )}

        {!podeMexer && (
          <p className="text-sm text-muted-foreground">
            A sua conta não gerencia contas: esta tela é leitura. Quem cadastra
            perfis é um administrador.
          </p>
        )}

        <div>
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Módulos
          </p>
          <h3 className="text-lg font-bold tracking-tight">
            O que {perfil.nome} vê
          </h3>
        </div>

        {/*
          Sem as duas leituras, a matriz não desenha linha nenhuma.

          `permissoes` e `universaisDesligadas` nascem de `data?.… ?? {}`, e o
          vazio faz **todo** módulo aparecer no piso e nenhum aparecer
          inativado. Com a lista desenhada nesse estado, uma leitura que falhou
          é indistinguível de um perfil que alcança tudo numa casa com tudo no
          ar — a interface afirmaria as duas coisas justamente quando não sabe
          nenhuma delas. O aviso de erro acima continua dizendo o que aconteceu;
          o que sai daqui é o palpite. (É a mesma regra que a `f0664f1` escreveu
          para a tela que esta seção absorveu.)
        */}
        {!lidas && !detalhe.isLoading && !universais.isLoading && (
          <p className="rounded-md border p-6 text-sm text-muted-foreground">
            O que este perfil alcança, e o que esta casa inativou, não puderam
            ser lidos — e por isso nada é mostrado aqui. Um botão marcado nesta
            matriz significaria que a decisão foi lida e é essa; sem a leitura,
            não há o que afirmar.
          </p>
        )}

        {(lidas || detalhe.isLoading || universais.isLoading) && (
          <MatrizDeAcesso
            niveis={permissoes}
            padrao={piso}
            universaisDesligadas={detalhe.data?.universaisDesligadas ?? []}
            universaisProtegidas={universais.data?.protegidas ?? []}
            aoInativar={
              podeMexer
                ? (chave, ligado) => inativar.mutate({ [chave]: ligado })
                : undefined
            }
            desabilitado={bloqueado}
            carregando={!lidas}
            aoEscolher={(niveis) => definir.mutate(niveis)}
          />
        )}

        <HistoricoDoPerfil linhas={detalhe.data?.historico ?? []} />
      </CardContent>
    </Card>
  );
}

/**
 * O piso do perfil — a decisão que vale para tudo o que ninguém decidiu.
 *
 * É o que faz `Leitor` existir sem noventa linhas idênticas: `VISUALIZAR` aqui
 * é "vê tudo, escreve nada", **inclusive o módulo que nascer amanhã**. Mexer no
 * piso é o ato mais amplo que há sobre um perfil, e por isso ele está acima da
 * matriz e não dentro dela: um botão perdido entre noventa linhas não avisaria
 * que reescreve todas elas.
 *
 * Os botões da matriz continuam sendo a exceção *dentro* do perfil: um `Leitor`
 * que precise editar um módulo tem esse módulo em `Editar` e continua sendo
 * Leitor no resto.
 */
function PisoDoPerfil({
  piso,
  desabilitado,
  aoEscolher,
}: {
  piso: Nivel;
  desabilitado: boolean;
  aoEscolher: (nivel: Nivel) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Piso do perfil</span>
        <span className="block text-xs text-muted-foreground">
          O que vale para todo módulo sem decisão própria abaixo — inclusive os
          que ainda não existem.
        </span>
      </span>
      <BotoesDeNivel
        nivel={piso}
        desabilitado={desabilitado}
        aoEscolher={aoEscolher}
      />
    </div>
  );
}

/**
 * A gaveta de cadastrar perfil — nome, descrição, administração e piso.
 *
 * O perfil nasce **no piso que concede**, alcançando tudo, e não é preguiça: é
 * a mesma regra do resto do produto — a ausência de decisão concede, e o que se
 * faz na matriz é tirar. Um perfil que nascesse fechado obrigaria a liberar
 * quarenta módulos para descrever um conferente, e a primeira tela nova do
 * produto ficaria invisível para ele sem que ninguém tivesse decidido isso.
 * Quem quer o contrário escolhe o piso aqui, num gesto explícito.
 */
function GavetaDoPerfil({
  aberta,
  aoFechar,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoCriar: (perfil: Perfil) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [gerenciaContas, setGerenciaContas] = useState(false);
  const [nivelPadrao, setNivelPadrao] = useState<Nivel>(NIVEL_PADRAO);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberta) {
      setNome("");
      setDescricao("");
      setGerenciaContas(false);
      setNivelPadrao(NIVEL_PADRAO);
      setErro(null);
    }
  }, [aberta]);

  const criar = useMutation({
    mutationFn: () =>
      fetchJson<Perfil>("/papeis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          descricao: descricao.trim() === "" ? null : descricao.trim(),
          gerenciaContas,
          nivelPadrao,
        }),
      }),
    onSuccess: aoCriar,
    onError: (err: Error) => setErro(err.message),
  });

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <header className="border-b px-6 py-4">
          <SheetTitle>Cadastrar perfil</SheetTitle>
          <SheetDescription>
            O piso diz o que ele alcança onde ninguém decidiu nada; as exceções se
            marcam na matriz, módulo a módulo, depois de criado.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Field label="Nome" htmlFor="novo-perfil-nome">
            <Input
              id="novo-perfil-nome"
              value={nome}
              placeholder="Conferente"
              onChange={(e) => setNome(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              É o nome que aparece no seletor de perfil de cada conta.
            </p>
          </Field>

          <Field label="Descrição" htmlFor="novo-perfil-descricao">
            <Textarea
              id="novo-perfil-descricao"
              rows={2}
              value={descricao}
              placeholder="Quem usa este perfil, em uma linha."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Field>

          <Field label="Piso" htmlFor="novo-perfil-piso">
            <span id="novo-perfil-piso" className="block">
              <BotoesDeNivel
                nivel={nivelPadrao}
                desabilitado={false}
                aoEscolher={setNivelPadrao}
              />
            </span>
            <p className="text-xs text-muted-foreground">
              O que ele alcança em todo módulo sem decisão própria — inclusive os
              que ainda não existem.
            </p>
          </Field>

          <div className="flex items-center gap-2">
            <Switch
              id="novo-perfil-admin"
              checked={gerenciaContas}
              onCheckedChange={setGerenciaContas}
            />
            <Label htmlFor="novo-perfil-admin" className="text-sm">
              Gerencia contas
            </Label>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Quem tem este perfil cria contas, desativa, redefine senha e muda o
            perfil dos outros.
          </p>

          {erro && <Refusal>{erro}</Refusal>}
        </div>

        <footer className="border-t px-6 py-4 flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={nome.trim() === "" || criar.isPending}
            onClick={() => criar.mutate()}
          >
            Cadastrar perfil
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
 * O que mudou neste perfil, quem mudou e quando.
 *
 * Mexer num perfil é o ato mais amplo desta tela — muda o acesso de todo mundo
 * que o usa —, e por isso ele tem histórico próprio, além do de cada conta. As
 * duas listas respondem perguntas diferentes: aqui, "por que este perfil
 * mudou"; na outra aba, "por que **eu** perdi esta tela".
 */
function HistoricoDoPerfil({ linhas }: { linhas: EventoDoPerfil[] }) {
  if (linhas.length === 0) {
    return (
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Nenhuma mudança registrada neste perfil.
      </p>
    );
  }

  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Mudanças neste perfil
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
