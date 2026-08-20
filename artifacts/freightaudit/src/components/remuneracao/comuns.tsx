import { Link } from "wouter";
import { ArrowRight, PencilLine, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  escreverDivergencia,
  escreverValor,
  NOME_DO_PREENCHIMENTO,
  type Ausencia,
  type Conferencia,
  type Medida,
  type Preenchimento,
  type ValorDeclarado,
} from "@/lib/remuneracao";

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
          {/*
            A terceira entrada não é da planilha: é deste produto. Ela fica na
            mesma legenda porque é lida junto com as outras duas, e porque a
            diferença que ela marca — medido contra digitado — é maior do que a
            que separa azul de cinza.
          */}
          <span className="flex items-center gap-2">
            <PencilLine className="w-3 h-3 text-sky-600 dark:text-sky-400" aria-hidden />
            Informado — alguém digitou este número da aba, e o acervo não o mede
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
  linhasInformadas?: number;
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
  /*
    As linhas informadas entram na mesma frase, e depois das duas do acervo: a
    pergunta é "de onde vem o que está nesta tela", e a resposta tem duas
    metades. Numa frase separada, quem lê a primeira e para de ler concluiria
    que a tela inteira sai dos arquivos.
  */
  const informadas =
    material.linhasInformadas && material.linhasInformadas > 0
      ? `, mais ${material.linhasInformadas} ${
          material.linhasInformadas === 1 ? "linha informada" : "linhas informadas"
        } à mão`
      : "";
  return `${cavalos} e ${trechos}${informadas}${ressalva}`;
}

/**
 * A marca de um número que veio da planilha, e não do acervo.
 *
 * Sempre visível, e nunca só uma cor: quem confere precisa poder dizer, olhando
 * a tela impressa em preto e branco, quais números o produto mediu e quais
 * alguém digitou. É a distinção que sustenta todas as outras deste módulo.
 */
export function MarcaDeInformado({ declarado }: { declarado: ValorDeclarado | null }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-sky-500/40 text-sky-700 dark:text-sky-300 font-normal"
      title={
        declarado
          ? `Informado por ${declarado.autor ?? "uma conta não identificada"} em ` +
            `${new Date(declarado.informadoEm).toLocaleDateString("pt-BR")}. Não é medida do acervo.`
          : "Informado no cadastro da planilha. Não é medida do acervo."
      }
    >
      <PencilLine className="w-3 h-3" />
      informado
    </Badge>
  );
}

/**
 * O que a planilha diz, ao lado do que o cadastro apurou.
 *
 * Só aparece quando os dois respondem — é a conferência, e ela é o motivo pelo
 * qual o número digitado não sobrescreve o medido. Quando batem, uma marca
 * discreta; quando não, a diferença por extenso, com sinal, do ponto de vista
 * da planilha.
 */
export function Conferido({
  conferencia,
  medida,
  declarado,
}: {
  conferencia: Conferencia;
  medida: Medida;
  declarado?: ValorDeclarado | null;
}) {
  const autor = declarado?.autor ? ` por ${declarado.autor}` : "";
  return conferencia.bate ? (
    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
      <Scale className="w-3 h-3" />
      a planilha informada{autor} concorda
    </Badge>
  ) : (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant="destructive" className="tabular-nums">
        {escreverDivergencia(conferencia, medida)}
      </Badge>
      <span className="text-xs text-muted-foreground">
        A planilha informada{autor} diz{" "}
        <strong className="tabular-nums">{escreverValor(conferencia.planilha, medida)}</strong>, e o
        cadastro apura{" "}
        <strong className="tabular-nums">{escreverValor(conferencia.cadastro, medida)}</strong>.
        Nenhum dos dois corrige o outro.
      </span>
    </span>
  );
}
