import {
  FileText,
  Gauge,
  PieChart,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import type { MedidaDoPlacar } from "@/lib/panorama";
import type { Tom } from "@/lib/visao-geral";

/**
 * Andar 2 — o placar. *"E os outros números?"*
 *
 * Cinco medidas na mesma régua: o superconjunto dos quatro cartões do Impacto
 * Líquido e dos cinco do Resumo executivo, publicado uma vez só.
 *
 * **Cinco cartões do mesmo tamanho, e um deles em destaque.** O destaque é o
 * líquido, e existe porque ele é o número que o andar de cima acabou de
 * anunciar: sem ele, a régua igual faria "impacto líquido" e "veículos
 * afetados" parecerem duas medidas do mesmo peso, quando uma é o resultado e a
 * outra é contexto dele.
 *
 * **Medida sem dado não aparece.** `valor === null` faz o cartão sumir e a
 * grade fechar — nada aqui mostra "0" para preencher lugar. É a mesma recusa
 * que o Resumo executivo já declarava, e a razão pela qual a Visão Geral não
 * desenha um cartão vazio onde a soma não sustenta resposta.
 *
 * **A definição de cada número vive no ⓘ, e não numa legenda.** Foi o que
 * permitiu, no andar de baixo, separar as duas coberturas que o produto tinha
 * com nomes parecidos: quem passa o mouse aqui lê que esta é a da **apuração**,
 * e que a auditada — percentual de célula de planilha — mora na procedência, no
 * fim da tela.
 *
 * **O desenho do cartão saiu daqui** e virou `CartaoDeIndicador`: era o quarto
 * KPI do produto desenhado à mão, e o quarto com um corpo de número diferente
 * dos outros três. O que sobra neste arquivo é o que é do placar — quais são as
 * cinco medidas, qual ícone abre cada uma e como a severidade vira cor.
 */
export function Placar({ medidas }: { medidas: MedidaDoPlacar[] }) {
  const visiveis = medidas.filter((m) => m.valor !== null);
  if (visiveis.length === 0) return null;

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      aria-label="O placar da vigência"
      role="group"
    >
      {visiveis.map((medida) => (
        <CartaoDeIndicador
          key={medida.chave}
          rotulo={medida.rotulo}
          valor={medida.valor}
          nota={medida.nota}
          ajuda={medida.ajuda}
          icone={ICONE_DA_MEDIDA[medida.chave]}
          corDoIcone={medida.tom ? MEDALHAO_DO_TOM[medida.tom] : "bg-brand/10 text-brand"}
          corDoValor={medida.tom ? COR_DO_TOM[medida.tom] : undefined}
          destaque={medida.destaque}
          href={medida.href}
        />
      ))}
    </div>
  );
}

/**
 * O ícone de cada medida — **desenho, e não dado**, e por isso ele mora aqui e
 * não em `lib/panorama.ts`.
 *
 * A camada de leitura publica cinco medidas com chave estável; o que cada uma
 * *parece* é decisão desta tela. Pôr o ícone lá dentro faria a aritmética da
 * vigência carregar um `LucideIcon` para ser testada.
 *
 * Chave sem ícone cai em `undefined`, e o cartão simplesmente não desenha o
 * medalhão — uma medida nova aparece sem enfeite em vez de aparecer com o
 * enfeite errado.
 */
const ICONE_DA_MEDIDA: Record<string, LucideIcon | undefined> = {
  liquido: Gauge,
  alteracoes: FileText,
  veiculos: Truck,
  "sem-preco": PieChart,
  cobertura: ShieldCheck,
};

/*
  A mesma paleta de tom que `OndeAgirAgora` usa, e pelo mesmo motivo: os dois
  andares publicam severidade lida da mesma régua (`qualidadeDaCobertura`,
  `Tom`), e duas escalas de cor para a mesma severidade fariam o placar e a fila
  discordarem sobre a gravidade do mesmo fato.
*/
const COR_DO_TOM: Record<Tom, string> = {
  grave: "text-red-700",
  atencao: "text-amber-700",
  ok: "text-emerald-700",
};

/*
  O medalhão repete o tom do número em fundo esmaecido, e é o que permite ler a
  severidade da fileira inteira de relance, antes de ler número nenhum. Ele é a
  **mesma** régua da linha acima — nunca uma segunda opinião sobre a gravidade
  do mesmo fato.
*/
const MEDALHAO_DO_TOM: Record<Tom, string> = {
  grave: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  atencao: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};
