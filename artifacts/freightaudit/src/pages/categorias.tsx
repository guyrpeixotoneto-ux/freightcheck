import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleHelp, FolderTree, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  CLASSES,
  classeAtual,
  consequenciaDe,
  filtrar,
  jaClassificadas,
  motivoDeNaoPoder,
  oQueFalta,
  podeClassificar,
  precisamDeClasse,
  type Categoria,
  type Classe,
} from "@/lib/categorias";
import { cn } from "@/lib/utils";

/**
 * Categorias — de que lado da conta cada uma cai.
 *
 * ---------------------------------------------------------------------------
 * De onde esta tela veio
 * ---------------------------------------------------------------------------
 * A tela de confirmação deixa cadastrar categoria na hora, sem sair do lugar, e
 * a categoria nova nasce sob "Não classificado" de propósito: a classe de custo
 * não se lê no nome. Pedágio é custo variável numa operação e repasse
 * contratual em outra, e chutar um dos dois moveria dinheiro de lado na conta
 * sem que ninguém tivesse decidido.
 *
 * Nascer sem classe é a resposta honesta; **ficar** sem classe não é. Esta tela
 * é o outro lado daquele desenho — o lugar onde a decisão adiada acontece.
 *
 * ---------------------------------------------------------------------------
 * Classificar é mover, e a tela mostra isso
 * ---------------------------------------------------------------------------
 * A classe é declarada nas classes da árvore e herdada por tudo abaixo; é por
 * isso que quem pergunta "por que combustível é variável?" segue de
 * `cv_combustivel` até `custo_variavel` e lê a resposta no caminho. Classificar
 * é mudar de casa, e não carimbar um campo — por isso cada linha mostra o
 * caminho, e não uma etiqueta solta.
 *
 * ---------------------------------------------------------------------------
 * Três coisas que a tela não esconde
 * ---------------------------------------------------------------------------
 * 1. **Quantas colunas dependem da decisão.** É a materialidade, e é o que põe
 *    a categoria certa no topo da fila.
 * 2. **O que a decisão muda, dito antes do clique** — inclusive o que ela *não*
 *    muda: comparação já calculada guarda a classe que tinha quando rodou.
 * 3. **Que a decisão é assinada.** A justificativa é obrigatória pela mesma
 *    régua da confirmação de semântica.
 */

export default function Categorias() {
  const [filtro, setFiltro] = useState("");

  const {
    data: categorias = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["curation", "categorias"],
    queryFn: () => fetchJson<Categoria[]>("/curation/categorias"),
  });

  const visiveis = filtrar(categorias, filtro);
  const pendentes = precisamDeClasse(visiveis);
  const classificadas = jaClassificadas(visiveis);
  const falta = oQueFalta(categorias);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <FolderTree className="h-6 w-6 text-primary" />
          Categorias
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          A classe de uma categoria decide de que lado da conta as colunas dela
          caem — custo fixo, custo variável, ou nada disso. Ela não se lê no
          nome, e por isso é uma decisão sua, assinada.
        </p>

        {falta ? (
          <p className="mt-4 max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {falta}
          </p>
        ) : (
          !isLoading && (
            <p className="mt-4 text-sm text-emerald-700">
              Todas as categorias têm classe.
            </p>
          )
        )}
      </header>

      {error && (
        <div className="px-8 pt-6">
          <ApiErrorNotice
            error={error}
            what="As categorias não puderam ser carregadas."
          />
        </div>
      )}

      <div className="space-y-6 p-8">
        <Input
          placeholder="Filtrar por nome…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="h-9 max-w-sm"
        />

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {/* A fila. Vem primeiro porque é o que a tela existe para resolver. */}
        {pendentes.length > 0 && (
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
              <CircleHelp className="h-4 w-4" />
              Precisam de classe
            </h2>
            {pendentes.map((categoria) => (
              <CartaoDeCategoria key={categoria.id} categoria={categoria} aberto />
            ))}
          </section>
        )}

        {/* As já decididas. Ficam à vista porque reclassificar é legítimo — a
            fonte muda de regra, e a classificação de agosto deixa de valer. */}
        {classificadas.map((grupo) => (
          <section key={grupo.classe} className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {grupo.rotulo}
              <span className="ml-2 font-normal normal-case">
                {grupo.itens.length}{" "}
                {grupo.itens.length === 1 ? "categoria" : "categorias"}
              </span>
            </h2>
            {grupo.itens.map((categoria) => (
              <CartaoDeCategoria key={categoria.id} categoria={categoria} />
            ))}
          </section>
        ))}

        {!isLoading && visiveis.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma categoria com esse filtro.
          </p>
        )}
      </div>
    </Layout>
  );
}

/**
 * Uma categoria, e a decisão sobre ela.
 *
 * `aberto` para as que ainda não têm classe: elas são a fila, e escondê-las
 * atrás de um clique faria a tela pedir duas ações para a que ela existe para
 * pedir uma. As já classificadas abrem fechadas — reclassificar é legítimo e
 * raro, e um formulário aberto em cada uma delas afogaria a fila.
 */
function CartaoDeCategoria({
  categoria,
  aberto = false,
}: {
  categoria: Categoria;
  aberto?: boolean;
}) {
  const queryClient = useQueryClient();
  const assinaCom = useAuth().user?.email ?? "quem está logado";

  const [abertoAgora, setAberto] = useState(aberto);
  const [classe, setClasse] = useState<Classe | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const escolha = { classe, justificativa };
  const atual = classeAtual(categoria);

  const classificar = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/categorias/${categoria.code}/familia`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // `actor` não vai daqui: quem assina é a sessão, como em toda decisão
          // deste produto que mexe em dinheiro.
          body: JSON.stringify({ familia: classe, reason: justificativa }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao classificar");
      return body;
    },
    onSuccess: async () => {
      setErro(null);
      setJustificativa("");
      setClasse(null);
      setAberto(false);
      await queryClient.invalidateQueries({ queryKey: ["curation"] });
    },
    onError: (err: Error) => setErro(err.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">{categoria.name}</CardTitle>
            {/* O caminho, e não uma etiqueta: é ele que explica a classe. */}
            <p className="mt-1 text-xs text-muted-foreground">{categoria.caminho}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="tabular-nums">
              {categoria.atributos}{" "}
              {categoria.atributos === 1 ? "coluna" : "colunas"}
            </Badge>
            {!abertoAgora && (
              <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
                {atual ? "Reclassificar" : "Classificar"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {abertoAgora && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CLASSES.map((opcao) => {
              const eOndeEstá = opcao.classe === atual;
              return (
                <button
                  key={opcao.classe}
                  type="button"
                  onClick={() => setClasse(opcao.classe)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    classe === opcao.classe
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {opcao.rotulo}
                    {/* Onde ela já está fica dito, e não escondido: sem isso a
                        pessoa clica na mesma opção e não entende a recusa. */}
                    {eOndeEstá && (
                      <span className="text-xs font-normal text-muted-foreground">
                        (onde está)
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {opcao.ajuda}
                  </span>
                </button>
              );
            })}
          </div>

          {/* A consequência, antes do clique — inclusive a metade que costuma
              faltar: o que a decisão não muda no que já foi calculado. */}
          {classe && classe !== atual && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {consequenciaDe(categoria, classe)}
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Por que esta é a classe certa?
            </Label>
            <Textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: o contrato de agosto repassa pedágio por viagem realizada — anda com a quilometragem."
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Fica registrado no histórico com a sua assinatura ({assinaCom}).
            </p>
          </div>

          {erro && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {erro}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={() => classificar.mutate()}
              disabled={
                classificar.isPending || !podeClassificar(categoria, escolha)
              }
            >
              {classificar.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {classificar.isPending ? "Movendo…" : "Classificar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAberto(false);
                setClasse(null);
                setJustificativa("");
                setErro(null);
              }}
            >
              Cancelar
            </Button>
            {/* Por que o botão está desligado, para quem não adivinha. */}
            {!podeClassificar(categoria, escolha) && (
              <p className="text-xs text-muted-foreground">
                {motivoDeNaoPoder(categoria, escolha)}
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
