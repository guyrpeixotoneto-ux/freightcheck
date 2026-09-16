import { Search, X } from "lucide-react";
import {
  ROTULO_DO_QUADRO,
  SITUACOES_DA_EQUIPE,
  type SituacaoDaLinhaDeEquipe,
} from "@workspace/comparison/monitor-equipe";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AJUDA_DA_SITUACAO_DE_EQUIPE,
  FILTROS_VAZIOS,
  FRASE_DA_SITUACAO_DE_EQUIPE,
  QUADROS_DO_MONITOR,
  escreverModulo,
  type FiltrosDoMonitorDeEquipe,
} from "@/lib/monitor-equipe";
import { cn } from "@/lib/utils";

/**
 * Os filtros globais — **um conjunto, e não um por bloco**.
 *
 * Cartões, visão por módulo e tabela respondem a estes mesmos valores porque
 * respondem à mesma resposta do servidor: o recorte acontece antes do resumo,
 * lá, e não em três lugares aqui. É o que faz o cartão não contradizer a
 * tabela.
 *
 * **Os módulos oferecidos são os que este recorte devolveu**, e não a lista
 * inteira do catálogo. São dezesseis assuntos, e a maioria não se move numa
 * quinzena: uma fileira de dezesseis selos em que doze devolvem zero é uma
 * fileira que ninguém lê. Quem quiser um assunto que não se moveu tem a lateral,
 * onde ele está sempre.
 */
export function FiltrosDoMonitorDeEquipeGlobais({
  filtros,
  modulos,
  onMudar,
  ignorados,
}: {
  filtros: FiltrosDoMonitorDeEquipe;
  /** Os módulos que **este** recorte devolveu — a tela não os inventa. */
  modulos: readonly string[];
  onMudar: (proximos: FiltrosDoMonitorDeEquipe) => void;
  ignorados: readonly string[];
}) {
  const alternar = <T,>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];

  const limpo =
    filtros.modulos.length === 0 &&
    filtros.quadros.length === 0 &&
    filtros.situacoes.length === 0 &&
    filtros.busca.trim() === "";

  return (
    <section className="flex flex-col gap-3" aria-label="Filtros do Monitor Equipe">
      <div className="flex flex-wrap items-end gap-4">
        <Grupo titulo="Quadro">
          {QUADROS_DO_MONITOR.map((q) => (
            <Alternador
              key={q}
              ativo={filtros.quadros.includes(q)}
              onClick={() => onMudar({ ...filtros, quadros: alternar(filtros.quadros, q) })}
            >
              {ROTULO_DO_QUADRO[q].replace("QLP ", "")}
            </Alternador>
          ))}
        </Grupo>

        {modulos.length > 0 && (
          <Grupo titulo="Módulo">
            {modulos.map((m) => (
              <Alternador
                key={m}
                ativo={filtros.modulos.includes(m)}
                onClick={() => onMudar({ ...filtros, modulos: alternar(filtros.modulos, m) })}
              >
                {escreverModulo(m)}
              </Alternador>
            ))}
          </Grupo>
        )}

        <Grupo titulo="Situação">
          {SITUACOES_DA_EQUIPE.map((s: SituacaoDaLinhaDeEquipe) => (
            <Alternador
              key={s}
              ativo={filtros.situacoes.includes(s)}
              titulo={AJUDA_DA_SITUACAO_DE_EQUIPE[s]}
              onClick={() =>
                onMudar({ ...filtros, situacoes: alternar(filtros.situacoes, s) })
              }
            >
              {FRASE_DA_SITUACAO_DE_EQUIPE[s]}
            </Alternador>
          ))}
        </Grupo>

        <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <Label htmlFor="busca-do-monitor-equipe" className="text-xs font-medium">
            Buscar
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="busca-do-monitor-equipe"
              value={filtros.busca}
              onChange={(e) => onMudar({ ...filtros, busca: e.target.value })}
              placeholder="Cargo, unidade, variável ou módulo"
              className="pl-8"
            />
          </div>
        </div>

        {!limpo && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onMudar({
                ...FILTROS_VAZIOS,
                baseOperacional: filtros.baseOperacional,
                comparadaOperacional: filtros.comparadaOperacional,
                baseAdministrativo: filtros.baseAdministrativo,
                comparadaAdministrativo: filtros.comparadaAdministrativo,
              })
            }
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Limpar filtros
          </Button>
        )}
      </div>

      {ignorados.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          O endereço trazia {ignorados.join(", ")}, que não existe. A tela abriu sem
          esse recorte, em vez de abrir vazia.
        </p>
      )}
    </section>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium">{titulo}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Alternador({
  ativo,
  onClick,
  titulo,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      title={titulo}
      className="rounded-full"
    >
      <Badge
        variant={ativo ? "default" : "outline"}
        className={cn("cursor-pointer whitespace-nowrap", !ativo && "text-muted-foreground")}
      >
        {children}
      </Badge>
    </button>
  );
}
