import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NOME_DO_PREENCHIMENTO, type Ausencia, type Preenchimento } from "@/lib/remuneracao";

/**
 * O que as duas vistas do cadastro compartilham.
 *
 * Uma quinzena e duas quinzenas lado a lado desenham a mesma planilha com
 * densidades diferentes, e três coisas têm de ser idênticas nas duas para que
 * alguém possa trocar de vista sem reaprender a ler: a marca azul/cinza da
 * legenda, a forma dos números do topo e o bloco que explica uma ausência.
 * Duplicá-las seria garantir que um dia divergissem.
 */

/**
 * A marca da legenda do Excel: azul se preenche, cinza se calcula.
 *
 * `title` e não texto visível porque a marca aparece trinta vezes por tela e a
 * legenda inteira, uma vez no rodapé. Repetir "Preenchimento automático" em
 * cada linha afogaria os rótulos, que é o que a pessoa está lendo.
 */
export function MarcaDoPreenchimento({ preenchimento }: { preenchimento: Preenchimento }) {
  return (
    <span
      aria-hidden
      title={NOME_DO_PREENCHIMENTO[preenchimento]}
      className={cn(
        "w-2 h-2 rounded-sm shrink-0",
        preenchimento === "INFORMADO" ? "bg-sky-300" : "bg-muted-foreground/30",
      )}
    />
  );
}

export function Numero({
  titulo,
  valor,
  destaque = false,
  alerta = false,
}: {
  titulo: string;
  valor: number;
  /** Acende quando há o que comemorar: linhas com lastro. */
  destaque?: boolean;
  /** Acende quando há o que investigar: lastro que se perdeu. */
  alerta?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums mt-0.5",
          destaque && valor > 0 && "text-nav-fechamento",
          alerta && valor > 0 && "text-destructive",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

/**
 * Por que a linha não tem número — o motivo, a destrava e onde olhar hoje.
 *
 * É o contrato das telas em preparo (`pages/em-preparo.tsx`) aplicado a uma
 * linha em vez de a uma tela inteira: quem abriu quer saber por que está vazio,
 * e "falta a coluna `icmsIss` classificada" responde isso — "em breve" não
 * responde.
 */
export function ExplicacaoDaAusencia({ ausencia }: { ausencia: Ausencia }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{ausencia.motivo}</p>
      <p className="text-xs text-muted-foreground/80">
        <span className="font-semibold">Destrava:</span> {ausencia.destrava}
      </p>
      {ausencia.hoje && (
        <Link
          href={ausencia.hoje.href}
          className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
        >
          {ausencia.hoje.label}
          <ArrowRight className="w-3 h-3" />
          <span className="font-normal text-muted-foreground">{ausencia.hoje.porque}</span>
        </Link>
      )}
    </div>
  );
}

/**
 * A legenda da planilha, mantida.
 *
 * Ela existe no Excel e diz o que a cor de cada célula significa. Reproduzi-la
 * aqui não é enfeite: é o que permite ler esta tela ao lado da planilha sem
 * traduzir nada — e é a informação que decide o que este módulo pode aspirar a
 * substituir. Cinza é conta, e conta nós refazemos; azul é decisão, e decisão
 * continua sendo de quem assina.
 */
export function Legenda() {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Legenda
        </p>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span aria-hidden className="w-2 h-2 rounded-sm bg-sky-300" />
            Preencher informações — a planilha pede a uma pessoa
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="w-2 h-2 rounded-sm bg-muted-foreground/30" />
            Preenchimento automático — a planilha deriva de outras células
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** O texto de "esta vigência entregou N cavalos e M trechos". */
export function frasedoMaterial(material: {
  cavalos: number;
  trechos: number;
  trechosEntregues: boolean;
}): string {
  const cavalos = `${material.cavalos.toLocaleString("pt-BR")} ${
    material.cavalos === 1 ? "cavalo" : "cavalos"
  }`;
  const trechos = `${material.trechos.toLocaleString("pt-BR")} ${
    material.trechos === 1 ? "trecho" : "trechos"
  }`;
  const ressalva = material.trechosEntregues
    ? ""
    : " — a série de trechos não foi entregue, e é dela que saem as alíquotas e as proporções";
  return `${cavalos} e ${trechos}${ressalva}`;
}
