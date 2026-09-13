import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
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
  Contagem,
  MatrizDeAcesso,
  contarPorNivel,
  rotuloDaChave,
  rotuloDoNivel,
} from "@/components/configuracoes/matriz-de-acesso";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { padraoDe, type Nivel } from "@/lib/permissoes";

/**
 * A exceção de uma conta — a segunda aba de Permissões.
 *
 * A primeira aba responde "o que um **Gestor** alcança", e é ela que resolve o
 * caso comum: dez conferentes, uma decisão. Esta responde "o que **esta pessoa**
 * alcança", uma conta de cada vez, e existe para o caso que um perfil não
 * descreve — a pessoa que, por um mês, não deve ver o Fechamento AS.
 *
 * **É exceção, e a tela diz isso em cada linha.** O que se decide aqui vence o
 * perfil da conta e continua valendo depois de uma troca de perfil; cada linha
 * diz se o que está valendo vem do perfil ou de uma decisão tomada sobre esta
 * pessoa, e a exceção tem o botão que a desfaz. Sem essa distinção, tirar um
 * módulo de dez conferentes pareceria dez cliques aqui em vez de um na aba ao
 * lado — e cada clique aqui deixaria uma conta fora do perfil dela para sempre,
 * em silêncio.
 *
 * Duas decisões de desenho, e nenhuma é enfeite:
 *
 * · **Cada clique grava.** Não há botão "salvar" segurando um rascunho: mexer
 *   no acesso de alguém é ato administrativo, e o histórico abaixo mostra o
 *   ato, o autor e a hora assim que ele acontece.
 * · **A própria conta fica fora da lista**, e não desabilitada nela: quem
 *   tentasse escolher a si mesmo receberia um 409 do servidor — a regra que
 *   impede alguém de trancar a porta por dentro —, e oferecer uma opção cujo
 *   único destino é a recusa é oferecer trabalho perdido.
 *
 * **Inativar não aparece aqui.** Tirar um módulo do ar é decisão da casa, vale
 * para todo mundo e não cabe numa tela sobre uma pessoa: o gesto mora na aba
 * Por perfil, que é onde ele alcança quem ele alcança.
 */

interface RespostaDePermissoes {
  /** O que vale — as camadas já somadas. É o que o portão faria. */
  permissoes: Record<string, Nivel>;
  /** A camada de baixo: o que o perfil da conta dá, com o piso dele. */
  doPapel: Record<string, Nivel>;
  /** A camada de cima: as exceções decididas sobre esta conta. */
  daPessoa: Record<string, Nivel>;
  /**
   * Acima das duas: o que a instalação inativou para todo mundo. Não é decisão
   * sobre esta conta, e nada aqui a desfaz — a matriz diz isso na linha em vez
   * de chamá-la de exceção.
   */
  universaisDesligadas: string[];
  historico: Array<{
    modulo: string;
    nivelAnterior: string | null;
    nivel: string;
    em: string;
    por: string;
  }>;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export function ExcecoesPorConta() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: pessoas = [], error: erroDasContas } = useContas();
  const [escolhida, setEscolhida] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = me?.role === "ADMIN";
  const elegiveis = pessoas.filter((p) => p.id !== me?.id);
  const alvo = elegiveis.find((p) => p.id === escolhida) ?? null;

  const consulta = useQuery({
    queryKey: ["permissoes", alvo?.id],
    queryFn: () => fetchJson<RespostaDePermissoes>(`/users/${alvo!.id}/permissoes`),
    enabled: alvo !== null,
  });

  const permissoes = consulta.data?.permissoes ?? {};
  const doPapel = consulta.data?.doPapel ?? {};

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

  const resumo = useMemo(
    () => contarPorNivel(permissoes, padraoDe(permissoes)),
    [permissoes],
  );

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 text-sm text-muted-foreground max-w-3xl">
        <UserCog className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <span>
          Cada conta herda o que o <strong>perfil</strong> dela alcança; o que se
          decide aqui é a <strong>exceção</strong> daquela pessoa, que vence o
          perfil e sobrevive a uma troca de perfil. Cada linha diz de onde vem o
          que está valendo, e cada mudança fica registrada com o nome de quem a
          fez.
        </span>
      </p>

      {erroDasContas && (
        <ApiErrorNotice
          error={erroDasContas}
          what="A lista de contas não pôde ser carregada."
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="conta">Conta</Label>
          <Select
            /*
              `undefined`, e não `""`: o Radix reserva a string vazia para "nada
              escolhido" e recusa item com esse valor. Sem escolha, o que aparece
              é o `placeholder` do `SelectValue`.
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
            <Contagem numero={resumo.SEM_ACESSO} rotulo="sem acesso" cor="text-rose-700" />
            <Contagem numero={resumo.VISUALIZAR} rotulo="somente leitura" cor="text-blue-700" />
            <Contagem numero={resumo.EDITAR} rotulo="editam" cor="text-emerald-700" />
          </div>
        )}
      </div>

      {!alvo && (
        <p className="text-sm text-muted-foreground">
          Escolha uma conta para ver o que ela alcança. A sua própria não está na
          lista: ninguém muda o próprio acesso — assim um engano aqui nunca tranca
          a porta por dentro.
        </p>
      )}

      {alvo && !podeMexer && (
        <p className="text-sm text-muted-foreground">
          A sua conta não gerencia contas: esta lista é leitura. Quem muda acesso é
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
            O perfil da conta, dito antes da matriz: é a resposta para "por que
            este módulo está fechado se eu não tirei nada dela?" — e o lugar onde
            se muda isso para todo mundo do mesmo perfil de uma vez.
          */}
          <p className="text-sm text-muted-foreground">
            {alvo.papelNome === null ? (
              <>
                Esta conta não tem perfil (criada pelo terminal, antes do
                cadastro). Ela alcança tudo o que não estiver restrito aqui.
              </>
            ) : (
              <>
                Perfil: <strong>{alvo.papelNome}</strong>
                {alvo.papelGerenciaContas ? " · gerencia contas" : ""}. O que ele
                alcança se muda na aba <strong>Por perfil</strong>, e vale para
                todas as contas que o usam.
              </>
            )}
          </p>

          <MatrizDeAcesso
            niveis={permissoes}
            padrao={padraoDe(permissoes)}
            herdado={doPapel}
            padraoHerdado={padraoDe(doPapel)}
            nomeDaHeranca={alvo.papelNome}
            universaisDesligadas={consulta.data?.universaisDesligadas ?? []}
            desabilitado={!podeMexer || definir.isPending}
            carregando={consulta.isLoading}
            aoEscolher={(niveis) => definir.mutate(niveis)}
          />

          <Historico linhas={consulta.data?.historico ?? []} />
        </>
      )}
    </div>
  );
}

/**
 * O que mudou, quem mudou e quando.
 *
 * A matriz de cima diz o que vale hoje; esta lista é a única que responde "quem
 * tirou isto de mim, e quando" — a pergunta que aparece semanas depois, quando
 * alguém não acha mais uma tela. Ela não é apagada por nenhuma ação da
 * interface.
 */
function Historico({ linhas }: { linhas: RespostaDePermissoes["historico"] }) {
  if (linhas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border-t pt-3">
        Nenhuma exceção tomada sobre esta conta — ela alcança exatamente o que o
        perfil dela alcança, como toda conta nova.
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
