import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Lock, Power, Search, ToggleLeft } from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AMBIENTES } from "@/lib/ambiente";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MODULOS, chaveDoAmbiente, modulosPorGrupo } from "@/lib/permissoes";
import {
  CHAVE_DOS_MODULOS_UNIVERSAIS,
  useModulosUniversais,
  type ModuloDesligado,
  type ModulosUniversais,
} from "./modulos-universais-consulta";
import { cn } from "@/lib/utils";

/**
 * Módulos universais — o que esta casa usa, e o que ela não usa.
 *
 * As outras duas telas de acesso perguntam sobre gente: Permissões, sobre uma
 * conta; Papéis, sobre um grupo de contas. Esta pergunta sobre a **instalação**
 * — e é a pergunta que faltava. Uma casa que não trabalha com Processos, QLP e
 * Frota tinha de tirar as três de cada papel, uma a uma, e a decisão envelhecia
 * calada: o papel criado na semana seguinte nascia com as três de volta no
 * menu, e ninguém tinha como perceber.
 *
 * **Aqui há dois estados, e não três níveis.** Ligado ou desligado. Desligado
 * quer dizer *para todo mundo*: a chave sai `SEM_ACESSO` na sessão de qualquer
 * conta, nenhum papel a devolve, nenhuma exceção a devolve, e o portão do
 * servidor recusa a escrita dela. Ligado não diz nada — quem decide continua
 * sendo o papel e a exceção, como sempre foi. Dar três níveis a esta camada a
 * faria competir com as outras duas pela mesma resposta; com dois, ela responde
 * uma pergunta que nenhuma delas fazia.
 *
 * **A seção é o botão que se procura, e o módulo é o que se grava.** Quem abre
 * esta tela quer desligar "Processos", e não sete endereços; quem lê o banco
 * precisa das mesmas chaves das outras duas camadas, senão o portão de escrita
 * não sabe o que fazer com elas. Então o botão da seção liga e desliga os
 * módulos dela de uma vez, e a seção some sozinha do menu quando fica sem
 * nenhum item — que é o comportamento que a lateral já tinha para restrição de
 * pessoa (`filtrarGrupos`, em `lib/permissoes.ts`).
 *
 * **A lista é o próprio menu**, montada em `lib/permissoes.ts` a partir das
 * mesmas funções que desenham as laterais — item novo aparece aqui sozinho, e
 * item que sai do menu deixa de ser oferecido.
 *
 * **Cada clique grava**, como em Permissões e pela mesma razão: desligar uma
 * parte do produto para a casa inteira é ato administrativo, e o histórico
 * abaixo mostra o ato, o autor e a hora assim que ele acontece. Um rascunho não
 * gravado seria uma tela mostrando um menu que ninguém tem.
 *
 * **Configurações não se desliga.** É onde esta tela mora, e uma casa que se
 * desligasse a si mesma só voltaria atrás por dentro do banco. O servidor
 * recusa, e aqui o botão nem é oferecido.
 */

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

/** O nome de uma chave na tela — o ambiente por extenso, o módulo pelo rótulo. */
function rotuloDaChave(chave: string): string {
  const ambiente = AMBIENTES.find((a) => chaveDoAmbiente(a.id) === chave);
  if (ambiente) return ambiente.nomeCompleto;
  return MODULOS.find((m) => m.chave === chave)?.rotulo ?? chave;
}

export function PainelDeModulosUniversais() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = me?.role === "ADMIN";

  const consulta = useModulosUniversais();

  const desligadas = useMemo(
    () => new Set((consulta.data?.desligadas ?? []).map((d) => d.chave)),
    [consulta.data],
  );
  const protegidas = useMemo(
    () => new Set(consulta.data?.protegidas ?? []),
    [consulta.data],
  );

  const definir = useMutation({
    mutationFn: (chaves: Record<string, boolean>) =>
      fetchJson<ModulosUniversais>("/modulos-universais", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chaves,
          motivo: motivo.trim() === "" ? null : motivo.trim(),
        }),
      }),
    onSuccess: (resposta) => {
      setErro(null);
      queryClient.setQueryData(CHAVE_DOS_MODULOS_UNIVERSAIS, resposta);
      /*
        O menu desta aba vem da sessão, e a sessão acabou de mudar de sentido:
        sem esta invalidação, quem desliga o QLP continua vendo o QLP na lateral
        até recarregar a página — e duvidaria, com razão, de que a decisão valeu.
      */
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
    onError: (err: Error) => setErro(err.message),
  });

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

  const ambientesNaTela = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo === "") return AMBIENTES;
    return AMBIENTES.filter(
      (a) =>
        a.nomeCompleto.toLowerCase().includes(termo) ||
        a.nome.toLowerCase().includes(termo) ||
        a.id.includes(termo),
    );
  }, [busca]);

  const desligadasNoMenu = MODULOS.filter((m) => desligadas.has(m.chave)).length;
  const ambientesDesligados = AMBIENTES.filter((a) =>
    desligadas.has(chaveDoAmbiente(a.id)),
  ).length;

  const bloqueado = !podeMexer || definir.isPending;

  return (
    <div className="space-y-6 max-w-5xl">
      <p className="flex items-start gap-2 text-sm text-muted-foreground max-w-3xl">
        <Power className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <span>
          Esta é a decisão da <strong>casa</strong>, e não a de uma pessoa: o que
          for desligado aqui não aparece no menu de <strong>ninguém</strong> —
          nem de quem administra — e nenhuma permissão o devolve. O que fica
          ligado continua sendo decidido em Papéis e Permissões, como sempre.
          Desligar uma seção inteira desliga os módulos dela, e a seção some da
          lateral.
        </span>
      </p>

      {consulta.error !== null && (
        <ApiErrorNotice
          error={consulta.error}
          what="A lista de módulos da instalação não pôde ser carregada."
        />
      )}

      {erro && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          {erro}
        </p>
      )}

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-4 text-sm">
              <Contagem
                numero={desligadasNoMenu}
                rotulo="módulos desligados"
                cor={desligadasNoMenu > 0 ? "text-rose-700" : "text-muted-foreground"}
              />
              <Contagem
                numero={MODULOS.length - desligadasNoMenu}
                rotulo="ligados"
                cor="text-emerald-700"
              />
              <Contagem
                numero={ambientesDesligados}
                rotulo="ambientes desligados"
                cor={
                  ambientesDesligados > 0 ? "text-rose-700" : "text-muted-foreground"
                }
              />
            </div>

            <span className="relative ml-auto">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar seção ou módulo…"
                className="h-9 w-56 pl-8"
              />
            </span>
          </div>

          {!podeMexer && (
            <p className="text-sm text-muted-foreground">
              A sua conta é de operador: esta lista é leitura. Quem liga e desliga
              partes do produto é um administrador.
            </p>
          )}

          {podeMexer && (
            /*
              O motivo acompanha o desligamento, e não a chave: quem desliga
              Processos, QLP e Frota na mesma sessão está dizendo a mesma coisa
              sobre as três. Ele é opcional porque a decisão vale sem ele — e
              existe porque a pergunta de meses depois ("por que esta tela
              sumiu?") é respondida por esta linha, e não pelo carimbo.
            */
            <div className="space-y-1.5 max-w-xl">
              <Label htmlFor="motivo">Motivo (opcional)</Label>
              <Input
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: esta operação não usa QLP nem Frota."
              />
              <p className="text-xs text-muted-foreground">
                Fica gravado com cada desligamento feito daqui em diante, no
                histórico do fim da página.
              </p>
            </div>
          )}

          {consulta.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}

          {!consulta.isLoading && ambientesNaTela.length > 0 && (
            <div className="rounded-md border">
              <div className="flex items-center gap-2 bg-muted/50 px-4 py-2">
                <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ambientes de trabalho
                </span>
                <span className="text-xs text-muted-foreground">
                  {ambientesNaTela.length} de {AMBIENTES.length}
                </span>
              </div>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Um ambiente desligado sai do seletor do topo para todo mundo, e
                nenhuma tela dele abre — é para a casa que não opera aquele
                processo.
              </p>
              {ambientesNaTela.map((ambiente) => {
                const chave = chaveDoAmbiente(ambiente.id);
                return (
                  <Linha
                    key={ambiente.id}
                    titulo={ambiente.nomeCompleto}
                    subtitulo={ambiente.descricao}
                    chave={chave}
                    ligado={!desligadas.has(chave)}
                    protegida={protegidas.has(chave)}
                    desabilitado={bloqueado}
                    desligamento={
                      consulta.data?.desligadas.find((d) => d.chave === chave) ??
                      null
                    }
                    aoAlternar={(ligado) => definir.mutate({ [chave]: ligado })}
                  />
                );
              })}
            </div>
          )}

          {!consulta.isLoading &&
            secoes.map((secao) => {
              const chaves = secao.itens.map((m) => m.chave);
              const ligados = chaves.filter((c) => !desligadas.has(c));
              /*
                A seção protegida é a Administração, que tem `/configuracoes`
                dentro: o botão da seção inteira desligaria uma chave que o
                servidor recusa, e o pedido voltaria com 409 sem ter desligado
                nada. Ele só oferece o que dá para fazer.
              */
              const alternaveis = chaves.filter((c) => !protegidas.has(c));
              return (
                <div key={`${secao.ambiente}|${secao.grupo}`} className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {secao.grupo}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {secao.ambiente} · {ligados.length} de {chaves.length} ligados
                    </span>
                    {alternaveis.length > 0 && (
                      <span className="ml-auto flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={bloqueado}
                          onClick={() => {
                            const ligar = ligados.length === 0;
                            definir.mutate(
                              Object.fromEntries(
                                alternaveis.map((c) => [c, ligar]),
                              ),
                            );
                          }}
                        >
                          <ToggleLeft className="w-3.5 h-3.5 mr-1.5" />
                          {ligados.length === 0
                            ? "Ligar a seção"
                            : "Desligar a seção"}
                        </Button>
                      </span>
                    )}
                  </div>
                  {secao.itens.map((modulo) => (
                    <Linha
                      key={modulo.chave}
                      titulo={modulo.rotulo}
                      subtitulo={modulo.chave}
                      chave={modulo.chave}
                      ligado={!desligadas.has(modulo.chave)}
                      protegida={protegidas.has(modulo.chave)}
                      desabilitado={bloqueado}
                      desligamento={
                        consulta.data?.desligadas.find(
                          (d) => d.chave === modulo.chave,
                        ) ?? null
                      }
                      aoAlternar={(ligado) =>
                        definir.mutate({ [modulo.chave]: ligado })
                      }
                    />
                  ))}
                </div>
              );
            })}

          {!consulta.isLoading && secoes.length === 0 && ambientesNaTela.length === 0 && (
            <p className="rounded-md border p-6 text-sm text-muted-foreground">
              Nenhuma seção ou módulo com esse nome.
            </p>
          )}

          <Historico linhas={consulta.data?.historico ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

function Linha({
  titulo,
  subtitulo,
  chave,
  ligado,
  protegida,
  desabilitado,
  desligamento,
  aoAlternar,
}: {
  titulo: string;
  subtitulo: string;
  chave: string;
  ligado: boolean;
  protegida: boolean;
  desabilitado: boolean;
  desligamento: ModuloDesligado | null;
  aoAlternar: (ligado: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              !ligado && "text-muted-foreground line-through",
            )}
          >
            {titulo}
          </span>
          {protegida && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
              <Lock className="h-2.5 w-2.5" />
              Sempre ligado
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{subtitulo}</span>
        {protegida && (
          <span className="block text-xs text-muted-foreground/80">
            É onde esta tela mora: desligá-lo tiraria de todo mundo a porta de
            voltar atrás.
          </span>
        )}
        {!ligado && desligamento && (
          <span className="block text-xs text-rose-700">
            Desligado para todo mundo · {desligamento.desligadoPor} ·{" "}
            {dateTime(desligamento.desligadoEm)}
            {desligamento.motivo ? ` · ${desligamento.motivo}` : ""}
          </span>
        )}
      </span>
      <Switch
        checked={ligado}
        disabled={desabilitado || protegida}
        aria-label={`${ligado ? "Desligar" : "Ligar"} ${titulo} para todos os usuários`}
        onCheckedChange={(valor) => aoAlternar(valor)}
        data-testid={`switch-universal-${chave}`}
      />
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
 * O que a casa ligou e desligou, com autor e hora.
 *
 * É a única resposta para "quem tirou o QLP do menu, e quando" — a pergunta que
 * aparece semanas depois, quando alguém não acha mais uma tela e ninguém lembra
 * de ter mexido. Não é apagado por nenhuma ação da interface.
 */
function Historico({
  linhas,
}: {
  linhas: ModulosUniversais["historico"];
}) {
  if (linhas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border-t pt-3">
        Nada foi desligado nesta instalação — o produto inteiro está no ar, e
        quem alcança o quê é decidido em Papéis e Permissões.
      </p>
    );
  }

  return (
    <div className="border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        O que a casa ligou e desligou
      </p>
      <ul className="space-y-1.5">
        {linhas.slice(0, 12).map((linha, indice) => (
          <li
            key={`${linha.em}|${linha.chave}|${indice}`}
            className="text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              {rotuloDaChave(linha.chave)}
            </span>{" "}
            {linha.ligado ? "ligado" : "desligado para todo mundo"} · {linha.por}{" "}
            · {dateTime(linha.em)}
            {linha.motivo ? ` · ${linha.motivo}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
