import { useLocation, useSearch } from "wouter";
import { Briefcase, HardHat, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O SELETOR DE QUADRO — as duas populações do QLP, lado a lado, dentro do mesmo
 * módulo.
 *
 * ---------------------------------------------------------------------------
 * Por que ele existe
 * ---------------------------------------------------------------------------
 * QLP Operacional e QLP Administrativo eram **dois itens** na lateral, um
 * embaixo do outro, e quem lia o quadro de pessoal tinha de voltar ao menu para
 * trocar de população. São a mesma leitura — o quadro de lotação — sobre os dois
 * recortes em que o Freightech o publica, e trocar de recorte é trocar de aba,
 * não de tela.
 *
 * A lateral passou a ter **um** item, `QLP`, e é este seletor que faz a troca
 * dentro dele. O menu ficou com a altura da pergunta ("quero ver o quadro de
 * pessoal") e a escolha da população desceu para onde ela é feita, que é com o
 * quadro já aberto na frente.
 *
 * ---------------------------------------------------------------------------
 * O endereço não mudou, e isso é de propósito
 * ---------------------------------------------------------------------------
 * As duas rotas continuam sendo `/qlp-operacional` e `/qlp-administrativo`.
 * Elas são a chave **por item** em Permissões (`lib/permissoes.ts`), viajam em
 * link salvo e em favorito, e estão escritas no catálogo de escopo
 * (`lib/navegacao-do-escopo.ts`). Unir as duas telas num endereço só apagaria
 * quem tivesse desligado uma das populações e quebraria todo link já mandado —
 * preço alto para uma mudança que é de **menu**, não de conteúdo. Aba aqui é
 * navegação entre duas rotas, e não estado de uma terceira.
 *
 * ---------------------------------------------------------------------------
 * O que viaja na troca, e o que fica
 * ---------------------------------------------------------------------------
 * Viaja o contexto — vigência, escopo, canal e o par comparado —, porque ele é
 * a mesma pergunta nas duas populações: quem está olhando a quinzena de março
 * na unidade X continua nela ao trocar de quadro.
 *
 * Fica para trás o `?aba=`, e tem de ficar: as abas internas dos dois quadros
 * **não são as mesmas**. O administrativo tem Quadro, Evolução, Comparação,
 * Auditoria e Inconsistências; o operacional tem Auditoria e Comparação.
 * Carregar `?aba=evolucao` para o operacional cairia no `?? "auditoria"` dele —
 * silencioso, mas mentiroso: o clique pediu evolução e a tela abriria noutra
 * leitura. Cada quadro abre na leitura de entrada dele.
 */

/** O contexto que sobrevive à troca de quadro — o resto é de cada tela. */
const CONTEXTO = ["period", "scopeHash", "canal", "base", "comparada"] as const;

export type QuadroDoQlp = "OPERACIONAL" | "ADMINISTRATIVO";

const QUADROS: { id: QuadroDoQlp; rotulo: string; href: string; icone: LucideIcon }[] = [
  { id: "OPERACIONAL", rotulo: "Operacional", href: "/qlp-operacional", icone: HardHat },
  { id: "ADMINISTRATIVO", rotulo: "Administrativo", href: "/qlp-administrativo", icone: Briefcase },
];

export function SeletorDeQuadro({ quadro }: { quadro: QuadroDoQlp }) {
  const search = useSearch();
  const [, navigate] = useLocation();

  const contexto = new URLSearchParams();
  const atual = new URLSearchParams(search);
  for (const chave of CONTEXTO) {
    const valor = atual.get(chave);
    if (valor !== null) contexto.set(chave, valor);
  }
  const query = contexto.toString();

  return (
    <div
      role="tablist"
      aria-label="Quadro de pessoal"
      className="flex flex-wrap items-center gap-1 rounded-full border bg-muted/40 p-1"
    >
      {QUADROS.map((item) => {
        const ativo = item.id === quadro;
        const Icone = item.icone;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => navigate(query ? `${item.href}?${query}` : item.href)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              ativo
                ? "bg-background text-brand shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icone className="h-4 w-4" />
            {item.rotulo}
          </button>
        );
      })}
    </div>
  );
}
