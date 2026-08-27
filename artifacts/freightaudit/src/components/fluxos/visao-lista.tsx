import { useMemo, useState } from "react";
import { ArrowDownUp, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  filtrarLinhas,
  linhasDaLista,
  ordenarLinhas,
  severidadeNoCatalogo,
  valoresDaColuna,
  type ColunaDaLista,
  type FiltrosDaLista,
} from "@/lib/fluxos-analise";
import type { PropsDaVisao } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 5 — A LISTA: o processo como tabela, para auditoria.
 *
 * É a visão de quem está conferindo, não de quem está lendo. As perguntas que
 * ela responde são as de auditoria de processo: quais etapas não têm
 * responsável, quais não têm prazo, quais têm problema registrado, quantas
 * passam pelo Fiscal. Nenhuma delas se responde olhando um fluxograma.
 *
 * "Entrada" e "saída" saem do **grafo** — de onde a etapa recebe e para onde ela
 * entrega —, não de um campo cadastrado à mão. É a mesma verdade do desenho,
 * lida como linha: se alguém criar uma conexão no Fluxo, ela aparece aqui na
 * recarga seguinte, sem nada para sincronizar.
 *
 * ---------------------------------------------------------------------------
 * Processos grandes
 * ---------------------------------------------------------------------------
 *
 * A tabela não corta linha nem pagina: um recorte silencioso numa tela de
 * auditoria é pior do que uma rolagem longa — quem confere precisa saber que
 * está vendo tudo. O custo de renderizar duzentas e cinquenta linhas é
 * controlado por `content-visibility`, que deixa o navegador pular a pintura do
 * que está fora da janela sem que nada saia do DOM: a busca do navegador, a
 * leitura de tela e a contagem continuam certas.
 */

const COLUNAS: { chave: ColunaDaLista; rotulo: string; classe?: string }[] = [
  { chave: "numero", rotulo: "#", classe: "w-[52px]" },
  { chave: "nome", rotulo: "Etapa" },
  { chave: "tipo", rotulo: "Tipo", classe: "hidden lg:table-cell" },
  { chave: "area", rotulo: "Área", classe: "hidden md:table-cell" },
  { chave: "responsavel", rotulo: "Responsável", classe: "hidden lg:table-cell" },
  { chave: "sistema", rotulo: "Sistema", classe: "hidden lg:table-cell" },
  { chave: "sla", rotulo: "Prazo (SLA)", classe: "hidden xl:table-cell" },
];

const RECORTES: { chave: keyof FiltrosDaLista; rotulo: string }[] = [
  { chave: "comProblema", rotulo: "Com problema" },
  { chave: "comRetorno", rotulo: "Com retorno" },
  { chave: "semResponsavel", rotulo: "Sem responsável" },
  { chave: "semSla", rotulo: "Sem SLA" },
];

const SemDado = () => <span className="text-muted-foreground/50">—</span>;

export function VisaoLista({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
}: PropsDaVisao) {
  const [filtros, setFiltros] = useState<FiltrosDaLista>({});
  const [coluna, setColuna] = useState<ColunaDaLista>("numero");
  const [crescente, setCrescente] = useState(true);

  const linhas = useMemo(() => linhasDaLista(completo), [completo]);
  const visiveis = useMemo(
    () => ordenarLinhas(filtrarLinhas(linhas, filtros), coluna, crescente),
    [linhas, filtros, coluna, crescente],
  );

  const trocarOrdem = (nova: ColunaDaLista) => {
    if (nova === coluna) setCrescente((v) => !v);
    else {
      setColuna(nova);
      setCrescente(true);
    }
  };

  const alternarRecorte = (chave: keyof FiltrosDaLista) =>
    setFiltros((f) => ({ ...f, [chave]: f[chave] ? undefined : true }));

  const filtrando =
    Object.values(filtros).some((v) => v !== undefined && v !== null && v !== "") ;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtros.busca ?? ""}
            onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
            placeholder="Buscar etapa…"
            aria-label="Buscar etapa"
            className="h-8 pl-8"
          />
        </div>

        <FiltroDeColuna
          rotulo="Área"
          valor={filtros.area ?? null}
          opcoes={valoresDaColuna(linhas, "area")}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, area: v }))}
        />
        <FiltroDeColuna
          rotulo="Responsável"
          valor={filtros.responsavel ?? null}
          opcoes={valoresDaColuna(linhas, "responsavel")}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, responsavel: v }))}
        />
        <FiltroDeColuna
          rotulo="Sistema"
          valor={filtros.sistema ?? null}
          opcoes={valoresDaColuna(linhas, "sistema")}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, sistema: v }))}
        />
        <FiltroDeColuna
          rotulo="Tipo"
          valor={filtros.tipo ?? null}
          opcoes={valoresDaColuna(linhas, "tipo")}
          rotuloDe={(v) => catalogo?.tiposDeEtapa.find((t) => t.valor === v)?.rotulo ?? v}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, tipo: v }))}
        />

        {RECORTES.map((r) => (
          <Button
            key={r.chave}
            variant={filtros[r.chave] ? "default" : "outline"}
            size="sm"
            className="h-8"
            aria-pressed={Boolean(filtros[r.chave])}
            onClick={() => alternarRecorte(r.chave)}
          >
            {r.rotulo}
          </Button>
        ))}

        {filtrando && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setFiltros({})}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Limpar
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {visiveis.length} de {linhas.length} {linhas.length === 1 ? "etapa" : "etapas"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {COLUNAS.map((c) => (
                <TableHead key={c.chave} className={c.classe}>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => trocarOrdem(c.chave)}
                    aria-label={`Ordenar por ${c.rotulo}`}
                  >
                    {c.rotulo}
                    {coluna === c.chave && (
                      <ArrowDownUp className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                </TableHead>
              ))}
              <TableHead className="hidden xl:table-cell">Entrada</TableHead>
              <TableHead className="hidden xl:table-cell">Saída</TableHead>
              <TableHead className="w-[110px]">Sinais</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((linha) => {
              const severidade = severidadeNoCatalogo(linha.diagnostico.severidade);
              const tipo = catalogo?.tiposDeEtapa.find((t) => t.valor === linha.etapa.tipo);
              return (
                <TableRow
                  key={linha.etapa.id}
                  onClick={() => onSelecionarEtapa(linha.etapa.id)}
                  className={cn(
                    "cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_44px]",
                    etapaSelecionada === linha.etapa.id && "bg-muted",
                  )}
                  data-testid={`linha-${linha.etapa.nome}`}
                >
                  <TableCell className="tabular-nums text-muted-foreground">
                    {String(linha.numero).padStart(2, "0")}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{linha.etapa.nome}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {tipo?.rotulo ?? linha.etapa.tipo}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{linha.area ?? <SemDado />}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {linha.responsavel ?? <SemDado />}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {linha.sistema ?? <SemDado />}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {linha.sla ?? (
                      <span className="text-xs text-muted-foreground/60">sem prazo definido</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate xl:table-cell text-muted-foreground">
                    {linha.entradas.join(", ") || <SemDado />}
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate xl:table-cell text-muted-foreground">
                    {linha.saidas.join(", ") || <SemDado />}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", severidade.ponto)} />
                      <span className="text-xs text-muted-foreground">
                        {linha.diagnostico.sinais.length > 0
                          ? linha.diagnostico.sinais.length
                          : severidade.valor === "sem-avaliacao"
                            ? "sem dados"
                            : "—"}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {visiveis.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Nenhuma etapa atende a este recorte.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Um filtro de coluna — e o motivo de "Todas" ser um valor e não um vazio.
 *
 * O `Select` do Radix recusa `value=""` (é o valor reservado do estado limpo),
 * e a saída de todo mundo é uma sentinela. Ela fica **aqui**, num componente
 * só, em vez de repetida em cada filtro: quatro sentinelas escritas à mão é
 * como uma delas acaba diferente e o filtro correspondente para de limpar.
 */
function FiltroDeColuna({
  rotulo,
  valor,
  opcoes,
  rotuloDe,
  aoTrocar,
}: {
  rotulo: string;
  valor: string | null;
  opcoes: string[];
  rotuloDe?: (valor: string) => string;
  aoTrocar: (valor: string | null) => void;
}) {
  const TODAS = "__todas__";
  if (opcoes.length === 0) return null;
  return (
    <Select value={valor ?? TODAS} onValueChange={(v) => aoTrocar(v === TODAS ? null : v)}>
      <SelectTrigger className="h-8 w-auto min-w-[130px]" aria-label={`Filtrar por ${rotulo}`}>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODAS}>{rotulo}: todas</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o} value={o}>
            {rotuloDe ? rotuloDe(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A etiqueta de severidade, para quem precisar dela fora da tabela. */
export function EtiquetaDeSeveridade({ severidade }: { severidade: string }) {
  const entrada = severidadeNoCatalogo(severidade as never);
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("h-2 w-2 rounded-full", entrada.ponto)} />
      {entrada.rotulo}
    </Badge>
  );
}
