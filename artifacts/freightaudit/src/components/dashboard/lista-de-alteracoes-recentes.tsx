import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { COR_DA_LINHA, ICONE_DA_LINHA } from "@/components/inicio/detalhe-da-alteracao";
import type { LinhaDeAlteracao } from "@/lib/visao-geral";

/**
 * As alterações em destaque, como lista de links — a mesma leitura de
 * `ultimasAlteracoes` (`lib/visao-geral.ts`), compartilhada entre o Dashboard e
 * a Gestão à Vista.
 *
 * Difere da lista do Resumo executivo só no destino do clique: lá a linha abre
 * uma gaveta (`DetalheDaAlteracao`) porque a tela já está sobre uma vigência; aqui
 * cada linha já carrega o recorte que a produziu (`LinhaDeAlteracao.href`), então
 * o clique sai direto para Alterações, filtrado na população exata da linha.
 */
export function ListaDeAlteracoesRecentes({
  linhas,
  vazio = "O cliente não mexeu em nada nesta vigência.",
}: {
  linhas: LinhaDeAlteracao[];
  vazio?: string;
}) {
  if (linhas.length === 0) {
    return <p className="text-sm text-muted-foreground">{vazio}</p>;
  }

  return (
    <ol className="divide-y">
      {linhas.map((linha, indice) => {
        const Icone = ICONE_DA_LINHA[linha.tipo];
        return (
          <li key={linha.chave}>
            <Link
              href={linha.href}
              title={`Ver as linhas de ${linha.titulo}`}
              className="w-full text-left group flex items-start gap-3 py-3.5 -mx-2 px-2 rounded-lg hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors"
            >
              <span
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  COR_DA_LINHA[linha.tipo],
                )}
              >
                <Icone className="w-4 h-4" />
              </span>
              <span className="text-sm font-bold text-muted-foreground tabular-nums shrink-0 pt-1">
                {indice + 1}.
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug group-hover:text-brand transition-colors">
                  {linha.titulo}
                </span>
                <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                  {linha.detalhe}
                </span>
              </span>
              <span className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground tabular-nums">
                {linha.direita}
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 mt-1.5 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
