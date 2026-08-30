import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiErrorNotice } from "@/components/api-error";
import { useContas } from "@/components/configuracoes/contas";
import {
  MatrizDeAcesso,
  contarPorNivel,
  rotuloDaChave,
  rotuloDoNivel,
} from "@/components/configuracoes/matriz-de-acesso";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Nivel } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * Permissões — o que cada pessoa alcança, módulo a módulo.
 *
 * A lista de módulos **não está escrita aqui**: ela é o próprio menu, montado
 * em `lib/permissoes.ts` a partir das mesmas funções que desenham as laterais.
 * É o que impede esta tela de prometer controle sobre um módulo que não existe
 * mais, ou de esquecer um que nasceu ontem.
 *
 * **São dois eixos, e a tela mostra os dois.** Em cima, os oito ambientes de
 * trabalho — as quatro auditorias e os quatro fechamentos —, porque "esta
 * pessoa só trabalha na empurrada" é uma frase que o eixo dos módulos não sabia
 * dizer: `/alteracoes` é a mesma tela nas quatro auditorias, e é o acervo
 * embaixo dela que muda. Embaixo, os módulos de sempre. O que vale numa tela é
 * o **mais restritivo dos dois** — tirar o Fechamento AS de alguém não pede
 * revisar módulo nenhum, e devolver um módulo não devolve um ambiente.
 *
 * **Desde a `0082`, esta tela decide a segunda camada, e não a única.** O caso
 * geral é o papel da conta (Configurações → Papéis), cadastrado uma vez e
 * valendo para todo mundo que o usa; o que se faz aqui é a **exceção** daquela
 * pessoa, que vence o papel. Cada linha diz de onde vem o que está valendo — do
 * papel ou de uma exceção —, e a exceção tem o botão que a desfaz, devolvendo a
 * linha à herança. Sem essa distinção, tirar um módulo de dez conferentes
 * pareceria dez cliques aqui em vez de um clique no papel, e o clique aqui
 * deixaria cada conta de fora do papel dela para sempre, em silêncio.
 *
 * Três decisões de desenho, e nenhuma é enfeite:
 *
 * · **Três níveis, e só três.** Edita, vê, ou não entra. Uma matriz de verbos
 *   por tela (criar, aprovar, exportar…) seria uma promessa que o servidor não
 *   cumpre: o que ele sabe recusar é escrita por módulo, e é isso que os três
 *   níveis descrevem — nada além.
 * · **Cada clique grava.** Não há botão "salvar" segurando um rascunho: mexer
 *   no acesso de alguém é ato administrativo, e o histórico abaixo mostra o
 *   ato, o autor e a hora assim que ele acontece. Um rascunho não gravado seria
 *   uma tela que mostra um acesso que ninguém tem.
 * · **O padrão é edição, e a tela diz isso.** Conta nova alcança o que o papel
 *   dela alcança, e um papel sem restrição alcança tudo — como sempre foi. O que
 *   esta tela faz é *tirar*: zero exceções é o estado normal, não o estado
 *   vazio.
 *
 * **É seção da casa, e não um cartão no rodapé de Usuários.** Era o segundo
 * bloco daquela tela, abaixo do cadastro de contas e da lista — a pergunta "o
 * que esta pessoa alcança" só se respondia rolando por um formulário de criar
 * conta que não tem nada com ela. Como seção, tem endereço próprio
 * (`/configuracoes/permissoes`), abre direto no que interessa e é
 * compartilhável; a lista de contas continua sendo a de Usuários, buscada pela
 * mesma consulta (`contas.ts`), então escolher aqui uma pessoa que se acabou de
 * criar lá não pede recarga.
 */

interface RespostaDePermissoes {
  /** O que vale — as duas camadas já somadas. É o que o portão faria. */
  permissoes: Record<string, Nivel>;
  /** A camada de baixo: o que o papel da conta dá. */
  doPapel: Record<string, Nivel>;
  /** A camada de cima: as exceções decididas sobre esta conta. */
  daPessoa: Record<string, Nivel>;
  historico: Array<{
    modulo: string;
    nivelAnterior: string | null;
    nivel: string;
    em: string;
    por: string;
  }>;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export function PainelDePermissoes() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: pessoas = [], error: erroDasContas } = useContas();
  const [escolhida, setEscolhida] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = me?.role === "ADMIN";
  /*
    A própria conta fica fora da lista, e não desabilitada nela: quem tentasse
    escolher a si mesmo receberia um 409 do servidor — a regra que impede
    alguém de trancar a porta por dentro —, e oferecer uma opção cujo único
    destino é a recusa é oferecer trabalho perdido.
  */
  const elegiveis = pessoas.filter((p) => p.id !== me?.id);
  const alvo = elegiveis.find((p) => p.id === escolhida) ?? null;

  const consulta = useQuery({
    queryKey: ["permissoes", alvo?.id],
    queryFn: () => fetchJson<RespostaDePermissoes>(`/users/${alvo!.id}/permissoes`),
    enabled: alvo !== null,
  });

  const permissoes = consulta.data?.permissoes ?? {};

  const definir = useMutation({
    mutationFn: (niveis: Record<string, Nivel>) =>
      fetchJson<RespostaDePermissoes>(`/users/${alvo!.id}/permissoes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niveis }),
      }),
    onSuccess: (resposta) => {
      setErro(null);
      queryClient.setQueryData(["permissoes", alvo?.id], resposta);
      /*
        Se quem mudou foi a própria sessão que está aberta em outra aba, o menu
        de lá só muda no próximo `/auth/session`. Aqui invalidamos o que está
        nesta aba, que é o que dá para garantir.
      */
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
    onError: (err: Error) => setErro(err.message),
  });

  const resumo = useMemo(() => contarPorNivel(permissoes), [permissoes]);

  return (
    <div className="space-y-6 max-w-5xl">
      {/*
        O cabeçalho da seção já diz o nome e o que ela resolve; o que fica aqui
        é a regra que muda a leitura de tudo abaixo — o padrão é edição, e esta
        tela tira acesso em vez de conceder.
      */}
      <p className="flex items-start gap-2 text-sm text-muted-foreground max-w-3xl">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <span>
          A lista de módulos é o próprio menu do produto. Cada conta herda o que
          o <strong>papel</strong> dela alcança (Configurações → Papéis); o que se
          decide aqui é a <strong>exceção</strong> daquela pessoa, que vence o
          papel. Cada linha diz de onde vem o que está valendo, e cada mudança
          fica registrada com o nome de quem a fez.
        </span>
      </p>

      {erroDasContas && (
        <ApiErrorNotice
          error={erroDasContas}
          what="A lista de contas não pôde ser carregada."
        />
      )}

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            {/*
              O mesmo campo de escolha que o resto do produto usa — e é por isso
              que ele deixou de ser um `select` nativo.

              Um `select` do sistema operacional desenha a própria lista: fonte,
              altura da linha, o realce em azul do sistema, a marca de conferido
              à esquerda. Nada disso é ajustável, e nada disso se parece com a
              lista que a mesma pergunta abre em Fechamento, em Frota ou no
              cadastro da casa. Este campo é a porta desta tela — é o primeiro
              controle que se toca aqui, e era o único do produto com aparência
              de outro produto.

              O que se perde ao trocar é a acessibilidade de graça do navegador,
              e o Radix a devolve: papel `combobox`, navegação por setas, busca
              por digitação e o foco preso na lista aberta. É a mesma troca que
              todas as outras telas já tinham feito.
            */}
            <div className="space-y-1.5">
              <Label htmlFor="conta">Conta</Label>
              <Select
                /*
                  `undefined`, e não `""`: o Radix reserva a string vazia para
                  "nada escolhido" e recusa item com esse valor — é o mesmo
                  sentinela que `cadastro-da-casa.tsx` documenta. Sem escolha, o
                  que aparece é o `placeholder` do `SelectValue`.
                */
                value={escolhida === "" ? undefined : escolhida}
                onValueChange={(valor) => {
                  setEscolhida(valor);
                  setErro(null);
                }}
              >
                <SelectTrigger id="conta" className="min-w-72">
                  <SelectValue placeholder="Escolha uma pessoa…" />
                </SelectTrigger>
                <SelectContent>
                  {elegiveis.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.email}
                      {p.disabledAt ? " (desativada)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {alvo && (
              <div className="flex items-center gap-4 text-sm">
                {/* Na mesma ordem dos botões: do fechado para o aberto. */}
                <Contagem
                  numero={resumo.SEM_ACESSO}
                  rotulo="sem acesso"
                  cor="text-rose-700"
                />
                <Contagem
                  numero={resumo.VISUALIZAR}
                  rotulo="somente leitura"
                  cor="text-blue-700"
                />
                <Contagem
                  numero={resumo.EDITAR}
                  rotulo="editam"
                  cor="text-emerald-700"
                />
              </div>
            )}
          </div>

          {!alvo && (
            <p className="text-sm text-muted-foreground">
              Escolha uma conta para ver o que ela alcança. A sua própria não está
              na lista: ninguém muda o próprio acesso — assim um engano aqui nunca
              tranca a porta por dentro.
            </p>
          )}

          {alvo && !podeMexer && (
            <p className="text-sm text-muted-foreground">
              A sua conta é de operador: esta lista é leitura. Quem muda acesso é
              um administrador.
            </p>
          )}

          {alvo && consulta.error !== null && (
            <ApiErrorNotice
              error={consulta.error}
              what="As permissões desta conta não puderam ser carregadas."
            />
          )}

          {erro && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
              {erro}
            </p>
          )}

          {alvo && (
            <>
              {/*
                O papel da conta, dito antes da matriz: é a resposta para "por que
                este módulo está fechado se eu não tirei nada dela?" — e o lugar
                onde se muda isso para todo mundo do mesmo papel de uma vez.
              */}
              <p className="text-sm text-muted-foreground">
                {alvo.papelNome === null ? (
                  <>
                    Esta conta não tem papel (criada pelo terminal, antes do
                    cadastro). Ela alcança tudo o que não estiver restrito aqui.
                  </>
                ) : (
                  <>
                    Papel: <strong>{alvo.papelNome}</strong>
                    {alvo.papelGerenciaContas ? " · gerencia contas" : ""}. O que
                    ele alcança se muda em Papéis, e vale para todas as contas que
                    o usam.
                  </>
                )}
              </p>

              <MatrizDeAcesso
                niveis={permissoes}
                herdado={consulta.data?.doPapel ?? {}}
                nomeDaHeranca={alvo.papelNome}
                desabilitado={!podeMexer || definir.isPending}
                carregando={consulta.isLoading}
                aoEscolher={(niveis) => definir.mutate(niveis)}
              />

              <Historico linhas={consulta.data?.historico ?? []} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
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
 * O que mudou, quem mudou e quando.
 *
 * A tabela de cima diz o que vale hoje; esta lista é a única que responde "quem
 * tirou isto de mim, e quando" — a pergunta que aparece semanas depois, quando
 * alguém não acha mais uma tela. Ela não é apagada por nenhuma ação da
 * interface.
 */
function Historico({
  linhas,
}: {
  linhas: RespostaDePermissoes["historico"];
}) {
  if (linhas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border-t pt-3">
        Nenhuma exceção tomada sobre esta conta — ela alcança exatamente o que o
        papel dela alcança, como toda conta nova.
      </p>
    );
  }

  return (
    <div className="border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Mudanças de acesso
      </p>
      <ul className="space-y-1.5">
        {linhas.slice(0, 12).map((linha, indice) => (
          <li key={`${linha.em}|${linha.modulo}|${indice}`} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {rotuloDaChave(linha.modulo)}
            </span>{" "}
            {linha.nivelAnterior ? `de ${rotuloDoNivel(linha.nivelAnterior)} ` : ""}
            para {rotuloDoNivel(linha.nivel)} · {linha.por} · {dateTime(linha.em)}
          </li>
        ))}
      </ul>
    </div>
  );
}
