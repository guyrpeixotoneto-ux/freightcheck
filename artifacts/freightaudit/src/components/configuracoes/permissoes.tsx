import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Lock, PencilLine, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiErrorNotice } from "@/components/api-error";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  EXPLICACAO_DO_NIVEL,
  MODULOS,
  NIVEL_PADRAO,
  modulosPorGrupo,
  type Nivel,
} from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * Permissões — o que cada pessoa alcança, módulo a módulo.
 *
 * A lista de módulos **não está escrita aqui**: ela é o próprio menu, montado
 * em `lib/permissoes.ts` a partir das mesmas funções que desenham as laterais.
 * É o que impede esta tela de prometer controle sobre um módulo que não existe
 * mais, ou de esquecer um que nasceu ontem.
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
 * · **O padrão é edição, e a tela diz isso.** Conta nova alcança tudo, como
 *   sempre alcançou; o que esta tela faz é *tirar*. Por isso o resumo conta
 *   "restrições", e não "permissões concedidas": zero restrições é o estado
 *   normal, não o estado vazio.
 */

interface RespostaDePermissoes {
  permissoes: Record<string, Nivel>;
  historico: Array<{
    modulo: string;
    nivelAnterior: string | null;
    nivel: string;
    em: string;
    por: string;
  }>;
}

export interface PessoaComAcesso {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: string | null;
}

const NIVEIS_NA_TELA: Array<{
  nivel: Nivel;
  rotulo: string;
  icone: typeof Eye;
  ativo: string;
}> = [
  {
    nivel: "EDITAR",
    rotulo: "Editar",
    icone: PencilLine,
    ativo: "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-600",
  },
  {
    nivel: "VISUALIZAR",
    rotulo: "Visualizar",
    icone: Eye,
    ativo: "bg-blue-600 text-white border-blue-600 hover:bg-blue-600",
  },
  {
    nivel: "SEM_ACESSO",
    rotulo: "Sem acesso",
    icone: Lock,
    ativo: "bg-rose-600 text-white border-rose-600 hover:bg-rose-600",
  },
];

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export function PermissoesCard({ pessoas }: { pessoas: PessoaComAcesso[] }) {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [escolhida, setEscolhida] = useState<string>("");
  const [busca, setBusca] = useState("");
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

  const resumo = useMemo(() => {
    const contagem = { EDITAR: 0, VISUALIZAR: 0, SEM_ACESSO: 0 } as Record<Nivel, number>;
    for (const modulo of MODULOS) {
      contagem[permissoes[modulo.chave] ?? NIVEL_PADRAO] += 1;
    }
    return contagem;
  }, [permissoes]);

  const secoes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return modulosPorGrupo()
      .map((secao) => ({
        ...secao,
        itens: secao.itens.filter(
          (m) =>
            termo === "" ||
            m.rotulo.toLowerCase().includes(termo) ||
            m.chave.toLowerCase().includes(termo) ||
            secao.grupo.toLowerCase().includes(termo),
        ),
      }))
      .filter((secao) => secao.itens.length > 0);
  }, [busca]);

  const visiveis = secoes.flatMap((s) => s.itens.map((m) => m.chave));

  function aplicarEmTodos(nivel: Nivel) {
    const niveis: Record<string, Nivel> = {};
    for (const chave of visiveis) niveis[chave] = nivel;
    definir.mutate(niveis);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Permissões
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          O que cada pessoa alcança, módulo a módulo. A lista é o próprio menu do
          produto. Quem não tem uma decisão tomada edita tudo, que é o que toda
          conta sempre pôde — aqui se <strong>tira</strong> acesso, e cada
          mudança fica registrada com o nome de quem a fez.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-muted-foreground mb-1">
              Conta
            </span>
            {/* select nativo, como no cadastro acima: uma lista, e o navegador
                acessível de graça. */}
            <select
              value={escolhida}
              onChange={(e) => {
                setEscolhida(e.target.value);
                setErro(null);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-64"
            >
              <option value="">Escolha uma pessoa…</option>
              {elegiveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.email}
                  {p.disabledAt ? " (desativada)" : ""}
                </option>
              ))}
            </select>
          </label>

          {alvo && (
            <div className="flex items-center gap-4 text-sm">
              <Contagem
                numero={resumo.EDITAR}
                rotulo="editam"
                cor="text-emerald-700"
              />
              <Contagem
                numero={resumo.VISUALIZAR}
                rotulo="somente leitura"
                cor="text-blue-700"
              />
              <Contagem
                numero={resumo.SEM_ACESSO}
                rotulo="sem acesso"
                cor="text-rose-700"
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
            <div className="flex flex-wrap items-center gap-2">
              {podeMexer &&
                NIVEIS_NA_TELA.map(({ nivel, rotulo, icone: Icone }) => (
                  <Button
                    key={nivel}
                    variant="outline"
                    size="sm"
                    disabled={definir.isPending}
                    onClick={() => aplicarEmTodos(nivel)}
                  >
                    <Icone className="w-3.5 h-3.5 mr-1.5" />
                    {nivel === "EDITAR"
                      ? "Liberar tudo"
                      : nivel === "VISUALIZAR"
                        ? "Só visualizar"
                        : "Bloquear tudo"}
                  </Button>
                ))}
              <span className="relative ml-auto">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar módulo…"
                  className="h-9 w-56 pl-8"
                />
              </span>
            </div>

            {podeMexer && busca.trim() !== "" && (
              <p className="text-xs text-muted-foreground -mt-2">
                Os três botões acima valem para os {visiveis.length} módulos que a
                busca deixou na lista — não para o menu inteiro.
              </p>
            )}

            <div className="rounded-md border divide-y">
              {consulta.isLoading && (
                <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
              )}

              {!consulta.isLoading &&
                secoes.map((secao) => (
                  <div key={`${secao.ambiente}|${secao.grupo}`}>
                    <div className="flex items-center gap-2 bg-muted/50 px-4 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {secao.grupo}
                      </span>
                      <Badge variant="outline" className="font-normal text-[0.6875rem]">
                        {secao.ambiente}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {secao.itens.length} módulo(s)
                      </span>
                    </div>
                    {secao.itens.map((modulo) => {
                      const nivel = permissoes[modulo.chave] ?? NIVEL_PADRAO;
                      return (
                        <div
                          key={modulo.chave}
                          className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t first:border-t-0"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">
                              {modulo.rotulo}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {modulo.chave} · {EXPLICACAO_DO_NIVEL[nivel]}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            {NIVEIS_NA_TELA.map(({ nivel: opcao, rotulo, icone: Icone, ativo }) => (
                              <Button
                                key={opcao}
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-pressed={nivel === opcao}
                                disabled={!podeMexer || definir.isPending}
                                className={cn("h-8", nivel === opcao && ativo)}
                                onClick={() => definir.mutate({ [modulo.chave]: opcao })}
                              >
                                <Icone className="w-3.5 h-3.5 mr-1.5" />
                                {rotulo}
                              </Button>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}

              {!consulta.isLoading && secoes.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">
                  Nenhum módulo com “{busca}” no nome.
                </p>
              )}
            </div>

            <Historico linhas={consulta.data?.historico ?? []} />
          </>
        )}
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
        Nenhuma decisão tomada sobre esta conta ainda — ela alcança o menu
        inteiro, como toda conta nova.
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
            <span className="font-medium text-foreground">{linha.modulo}</span>{" "}
            {linha.nivelAnterior ? `de ${rotuloDoNivel(linha.nivelAnterior)} ` : ""}
            para {rotuloDoNivel(linha.nivel)} · {linha.por} · {dateTime(linha.em)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function rotuloDoNivel(nivel: string): string {
  return (
    NIVEIS_NA_TELA.find((n) => n.nivel === nivel)?.rotulo.toLowerCase() ?? nivel
  );
}
