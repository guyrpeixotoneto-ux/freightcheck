import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  KeyRound,
  Loader2,
  Plug,
  Power,
  ShieldOff,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, getApiUrl } from "@/lib/api";
import {
  EXPLICACAO_DO_ESTADO,
  chavesVivas,
  estadoDa,
  quando,
  type ChamadaDaIntegracao,
  type DescricaoDeEscopo,
  type Integracao,
  type PainelDeIntegracoes,
} from "@/lib/integracoes";
import { cn } from "@/lib/utils";

/**
 * INTEGRAÇÕES — a porta de API deste produto, vista por quem responde por ela.
 *
 * A tela existe porque uma porta de API sem tela é uma afirmação sem prova.
 * "O Freightec atualiza o sistema sozinho" só é verificável se alguém puder
 * abrir uma página e ver **quem** tem chave, **o que** cada chave alcança e
 * **o que ela fez** — de preferência antes de a integração parar, e não no dia
 * em que alguém repara que o acervo está uma semana atrasado.
 *
 * É a mesma regra das outras telas daqui: nenhum número sem origem ao lado.
 * O que se lê nesta é o registro real das chamadas, gravado pelo portão que as
 * atendeu (`middlewares/chave-de-integracao.ts`, no servidor) — não uma
 * estimativa, não um estado declarado por quem configurou.
 *
 * ---------------------------------------------------------------------------
 * As três coisas que esta tela deixa claras de propósito
 * ---------------------------------------------------------------------------
 *
 * **1. A chave aparece uma vez.** Ao emitir, o segredo é mostrado num bloco que
 * diz isso com todas as letras. Não há como relê-lo: o banco guarda só o hash.
 * Escondê-lo atrás de um "copiar" discreto faria alguém fechar a página antes
 * de guardar a chave, e a recuperação não existe.
 *
 * **2. Nenhuma chave promove importação.** A frase está na tela, e não só na
 * documentação, porque é a pergunta que quem integra faz primeiro: "então o
 * arquivo entra sozinho?". Entra, e para no preview — a aprovação continua
 * sendo de uma pessoa, em Importações.
 *
 * **3. Revogar é para sempre.** O botão diz isso antes de ser clicado.
 */
export default function Integracoes() {
  const queryClient = useQueryClient();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [sistema, setSistema] = useState("");
  const [descricao, setDescricao] = useState("");
  /** A chave recém-emitida, mostrada uma vez e descartada ao sair da tela. */
  const [segredo, setSegredo] = useState<{ chave: string; integracao: string } | null>(
    null,
  );
  const [erro, setErro] = useState<string | null>(null);

  const painel = useQuery<PainelDeIntegracoes>({
    queryKey: ["integracoes"],
    queryFn: () => fetchJson<PainelDeIntegracoes>(getApiUrl("/integracoes")),
  });

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ["integracoes"] });
  };

  const criar = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string }>(getApiUrl("/integracoes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, sistema, descricao }),
      }),
    onSuccess: () => {
      setNome("");
      setSistema("");
      setDescricao("");
      setCriando(false);
      setErro(null);
      recarregar();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const escopos = painel.data?.escopos ?? [];

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Plug className="h-6 w-6 text-primary" />
          Integrações
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Os sistemas que falam com o FreightCheck por API: com que chave, o que
          cada uma alcança e o que já fez. Uma chave de integração{" "}
          <strong>nunca aprova importação</strong> — o arquivo que chega por API
          é lido e conferido, e para aguardando a aprovação de uma pessoa em
          Importações.
        </p>
      </header>

      <div className="space-y-6 p-8">
        {painel.isError ? (
          <ApiErrorNotice error={painel.error} what="as integrações" />
        ) : null}
        {erro ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {erro}
          </div>
        ) : null}

        {segredo ? <ChaveEmitida segredo={segredo} aoFechar={() => setSegredo(null)} /> : null}

        <ComoChamar escopos={escopos} />

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {painel.data ? `${painel.data.integracoes.length} integrações` : "Integrações"}
          </h2>
          <Button onClick={() => setCriando((v) => !v)} variant={criando ? "outline" : "default"}>
            {criando ? "Cancelar" : "Nova integração"}
          </Button>
        </div>

        {criando ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nova integração</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome</Label>
                  <Input
                    id="nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Freightec da Ambev"
                  />
                  <p className="text-xs text-muted-foreground">
                    É o nome que aparece no log de chamadas e no cartão da
                    importação que entrar por aqui.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sistema">Sistema do outro lado</Label>
                  <Input
                    id="sistema"
                    value={sistema}
                    onChange={(e) => setSistema(e.target.value)}
                    placeholder="Freightec, SAP, um script da operação"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="descricao">Para que serve (opcional)</Label>
                <Textarea
                  id="descricao"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Envia o export de vigência todo dia às 6h."
                />
              </div>
              <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
                {criar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Criar integração
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {painel.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : null}

        {painel.data?.integracoes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <Plug className="mx-auto mb-3 h-8 w-8 opacity-40" />
              <p className="font-medium text-foreground">
                Nenhum sistema conversa com este por API ainda.
              </p>
              <p className="mx-auto mt-1 max-w-xl text-sm">
                Crie uma integração, emita uma chave com o escopo que ela precisa
                e configure o outro lado. A primeira chamada aparece aqui.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {painel.data?.integracoes.map((integracao) => (
          <CartaoDaIntegracao
            key={integracao.id}
            integracao={integracao}
            escopos={escopos}
            aoEmitir={(chave) => setSegredo({ chave, integracao: integracao.nome })}
            aoMudar={recarregar}
            aoFalhar={setErro}
          />
        ))}
      </div>
    </Layout>
  );
}

/**
 * O segredo, mostrado uma vez.
 *
 * O bloco é grande, amarelo e não fecha sozinho — e cada uma dessas três coisas
 * é deliberada. Uma chave que aparece num toast de três segundos é uma chave
 * perdida, e perdê-la custa emitir outra e reconfigurar o sistema do outro lado.
 */
function ChaveEmitida({
  segredo,
  aoFechar,
}: {
  segredo: { chave: string; integracao: string };
  aoFechar: () => void;
}) {
  return (
    <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          A chave de {segredo.integracao} — copie agora
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Esta é a única vez que ela aparece. O sistema guarda apenas o resumo
          criptográfico dela, então nem esta tela consegue mostrá-la de novo —
          quem a perder emite outra e revoga esta.
        </p>
        <code className="block break-all rounded bg-background px-3 py-2 font-mono text-sm">
          {segredo.chave}
        </code>
        <Button variant="outline" onClick={aoFechar}>
          Já guardei
        </Button>
      </CardContent>
    </Card>
  );
}

/** Como chamar, com os escopos que o servidor declara — nunca uma cópia local. */
function ComoChamar({ escopos }: { escopos: DescricaoDeEscopo[] }) {
  const [aberto, setAberto] = useState(false);

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setAberto((v) => !v)}>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Como um sistema chama esta API</span>
          <span className="text-sm font-normal text-muted-foreground">
            {aberto ? "esconder" : "mostrar"}
          </span>
        </CardTitle>
      </CardHeader>
      {aberto ? (
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            A chave vai no cabeçalho, e nunca na URL — endereço entra no log de
            todo servidor do caminho, e credencial em log de terceiro é
            credencial vazada que ninguém sabe que vazou.
          </p>
          <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
{`curl -H "Authorization: Bearer fck_…" \\
     https://<este-servidor>/api/v1/ping`}
          </pre>
          <div className="space-y-3">
            {escopos.map((e) => (
              <div key={e.escopo} className="rounded border p-3">
                <div className="flex items-center gap-2">
                  {e.direcao === "ENTRADA" ? (
                    <ArrowDownToLine className="h-4 w-4 text-primary" />
                  ) : (
                    <ArrowUpFromLine className="h-4 w-4 text-primary" />
                  )}
                  <code className="font-mono text-xs">{e.escopo}</code>
                  <span className="font-medium">{e.titulo}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{e.permite}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {e.rotas.join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

const COR_DO_ESTADO: Record<string, string> = {
  DESATIVADA: "bg-muted text-muted-foreground",
  SEM_CHAVE: "bg-amber-100 text-amber-900",
  NUNCA_CHAMOU: "bg-sky-100 text-sky-900",
  RECUSANDO: "bg-destructive/10 text-destructive",
  ATIVA: "bg-emerald-100 text-emerald-900",
};

function CartaoDaIntegracao({
  integracao,
  escopos,
  aoEmitir,
  aoMudar,
  aoFalhar,
}: {
  integracao: Integracao;
  escopos: DescricaoDeEscopo[];
  aoEmitir: (chave: string) => void;
  aoMudar: () => void;
  aoFalhar: (mensagem: string) => void;
}) {
  const [emitindo, setEmitindo] = useState(false);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [apelido, setApelido] = useState("");
  const [verChamadas, setVerChamadas] = useState(false);

  const estado = estadoDa(integracao);
  const vivas = chavesVivas(integracao);

  const emitir = useMutation({
    mutationFn: () =>
      fetchJson<{ segredo: string }>(
        getApiUrl(`/integracoes/${integracao.id}/chaves`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ escopos: escolhidos, apelido }),
        },
      ),
    onSuccess: (r) => {
      aoEmitir(r.segredo);
      setEmitindo(false);
      setEscolhidos([]);
      setApelido("");
      aoMudar();
    },
    onError: (e: Error) => aoFalhar(e.message),
  });

  const revogar = useMutation({
    mutationFn: (chaveId: string) =>
      fetchJson<void>(getApiUrl(`/integracoes/chaves/${chaveId}/revogacao`), {
        method: "POST",
      }),
    onSuccess: aoMudar,
    onError: (e: Error) => aoFalhar(e.message),
  });

  const ativacao = useMutation({
    mutationFn: (ativa: boolean) =>
      fetchJson<void>(getApiUrl(`/integracoes/${integracao.id}/ativacao`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativa }),
      }),
    onSuccess: aoMudar,
    onError: (e: Error) => aoFalhar(e.message),
  });

  return (
    <Card className={cn(integracao.desativadaEm !== null && "opacity-70")}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {integracao.nome}
              <Badge className={cn("font-normal", COR_DO_ESTADO[estado])}>
                {estado.replace("_", " ").toLowerCase()}
              </Badge>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {integracao.sistema}
              {integracao.descricao ? ` — ${integracao.descricao}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {EXPLICACAO_DO_ESTADO[estado]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => ativacao.mutate(integracao.desativadaEm !== null)}
              disabled={ativacao.isPending}
            >
              <Power className="mr-1 h-3.5 w-3.5" />
              {integracao.desativadaEm !== null ? "Reativar" : "Desativar"}
            </Button>
            <Button size="sm" onClick={() => setEmitindo((v) => !v)}>
              <KeyRound className="mr-1 h-3.5 w-3.5" />
              Emitir chave
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Numero rotulo="Atendidas (24h)" valor={integracao.ultimas24h.ok} />
          <Numero rotulo="Recusadas (24h)" valor={integracao.ultimas24h.recusadas} />
          <Numero rotulo="Falhas (24h)" valor={integracao.ultimas24h.falhas} />
          <div>
            <p className="text-xs text-muted-foreground">Última chamada</p>
            <p className="font-medium">{quando(integracao.ultimaChamadaEm)}</p>
          </div>
        </div>

        {emitindo ? (
          <div className="space-y-3 rounded border p-4">
            <p className="text-sm font-medium">O que esta chave vai poder fazer</p>
            <div className="space-y-2">
              {escopos.map((e) => (
                <label key={e.escopo} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={escolhidos.includes(e.escopo)}
                    onChange={(ev) =>
                      setEscolhidos((atual) =>
                        ev.target.checked
                          ? [...atual, e.escopo]
                          : atual.filter((x) => x !== e.escopo),
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">{e.titulo}</span>{" "}
                    <code className="font-mono text-xs text-muted-foreground">
                      {e.escopo}
                    </code>
                    <span className="block text-muted-foreground">{e.permite}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`apelido-${integracao.id}`}>Apelido (opcional)</Label>
              <Input
                id={`apelido-${integracao.id}`}
                value={apelido}
                onChange={(e) => setApelido(e.target.value)}
                placeholder="produção, homologação"
              />
            </div>
            <Button
              onClick={() => emitir.mutate()}
              disabled={escolhidos.length === 0 || emitir.isPending}
            >
              {emitir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Emitir
            </Button>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium">
            {vivas.length} chave{vivas.length === 1 ? "" : "s"} válida
            {vivas.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-2">
            {integracao.chaves.map((chave) => (
              <div
                key={chave.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm",
                  chave.revogadaEm !== null && "opacity-60",
                )}
              >
                <div>
                  <code className="font-mono text-xs">{chave.prefixo}…</code>
                  {chave.apelido ? (
                    <span className="ml-2 text-muted-foreground">{chave.apelido}</span>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chave.escopos.map((e) => (
                      <Badge key={e} variant="outline" className="font-mono text-[10px]">
                        {e}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Emitida em {quando(chave.criadaEm)} por {chave.criadaPor} · última
                    chamada {quando(chave.ultimaChamadaEm)}
                    {chave.revogadaEm !== null
                      ? ` · revogada em ${quando(chave.revogadaEm)} por ${chave.revogadaPor ?? "—"}`
                      : ""}
                  </p>
                </div>
                {chave.revogadaEm === null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={revogar.isPending}
                    onClick={() => revogar.mutate(chave.id)}
                    title="Revogar é definitivo: a chave não volta a valer."
                  >
                    <ShieldOff className="mr-1 h-3.5 w-3.5" />
                    Revogar
                  </Button>
                ) : null}
              </div>
            ))}
            {integracao.chaves.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma chave emitida — o outro lado ainda não tem como chamar.
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <Button variant="outline" size="sm" onClick={() => setVerChamadas((v) => !v)}>
            {verChamadas ? "Esconder chamadas" : "Ver últimas chamadas"}
          </Button>
          {verChamadas ? <Chamadas integracaoId={integracao.id} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

/**
 * O log — a parte da tela que responde "está funcionando?" sem depender de
 * ninguém dizer que sim.
 *
 * Carregado sob demanda: é a tabela que mais cresce deste schema, e trazê-la
 * junto da lista faria toda abertura da tela pagar por um detalhe que quase
 * sempre não é aberto.
 */
function Chamadas({ integracaoId }: { integracaoId: string }) {
  const chamadas = useQuery<ChamadaDaIntegracao[]>({
    queryKey: ["integracoes", integracaoId, "chamadas"],
    queryFn: () =>
      fetchJson<ChamadaDaIntegracao[]>(
        getApiUrl(`/integracoes/${integracaoId}/chamadas`),
      ),
  });

  if (chamadas.isLoading) {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o log…
      </p>
    );
  }
  if (chamadas.isError) {
    return <ApiErrorNotice error={chamadas.error} what="o log de chamadas" />;
  }
  if (!chamadas.data || chamadas.data.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Esta integração ainda não fez nenhuma chamada.
      </p>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Quando</th>
            <th className="py-2 pr-4 font-medium">Chamada</th>
            <th className="py-2 pr-4 font-medium">Chave</th>
            <th className="py-2 pr-4 font-medium">Resposta</th>
            <th className="py-2 pr-4 font-medium">Tempo</th>
            <th className="py-2 font-medium">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {chamadas.data.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="py-2 pr-4 whitespace-nowrap">{quando(c.em)}</td>
              <td className="py-2 pr-4 font-mono text-xs">
                {c.metodo} {c.caminho}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{c.prefixo ?? "—"}</td>
              <td className="py-2 pr-4">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-medium",
                    c.resultado === "OK"
                      ? "bg-emerald-100 text-emerald-900"
                      : c.resultado === "RECUSADA"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-destructive/10 text-destructive",
                  )}
                >
                  {c.status}
                </span>
              </td>
              <td className="py-2 pr-4 tabular-nums">{c.duracaoMs} ms</td>
              <td className="py-2 text-muted-foreground">{c.motivo ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
