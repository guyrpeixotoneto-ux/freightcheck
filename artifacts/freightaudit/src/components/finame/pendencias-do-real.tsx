import { useState, type ReactElement } from "react";
import { CircleHelp, Copy } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { fetchJson, getApiUrl } from "@/lib/api";
import { ACERVOS } from "@workspace/ingest/tipos";

/**
 * O QUE ESTE NÚMERO AINDA NÃO INCLUI.
 *
 * ---------------------------------------------------------------------------
 * Por que fica ao lado do confronto, e não escondido numa tela de importação
 * ---------------------------------------------------------------------------
 * Porque quem lê o confronto é quem precisa saber. Um realizado de R$ 1,19
 * milhão com cinco lançamentos retidos e oito placas sem tipo não é o mesmo
 * número que R$ 1,19 milhão sem pendência nenhuma — e a diferença não pode
 * depender de alguém lembrar de abrir outra tela.
 *
 * As duas filas nascem na importação do extrato: a **linha repetida**, idêntica
 * em todas as colunas, que não entrou na soma e não foi descartada; e a **placa
 * cujo tipo o cadastro não resolveu**, cujo dinheiro fica fora da comparação até
 * alguém dizer de que ativo se trata.
 *
 * ---------------------------------------------------------------------------
 * A decisão é aplicada no clique — e o que isso quer dizer
 * ---------------------------------------------------------------------------
 * Responder aqui muda o número. O servidor grava a decisão, relê o extrato do
 * RAW já guardado — sem arquivo novo, sem reimportação manual — e publica a
 * revisão da vigência que passa a contar aquele valor. A resposta diz o que
 * aconteceu, com as competências e as revisões pelo nome, e é ela que a tela
 * mostra: "decisão registrada" era a frase de quando nada mudava.
 *
 * Aplicar é abrir **revisão nova**, nunca editar a vigência de pé: os fatos de
 * uma vigência ativa são imutáveis por gatilho, e correção neste produto entra
 * como revisão, com autor e motivo. A anterior continua legível no histórico.
 *
 * Clicar duas vezes não cobra duas vezes, e não por trava: a segunda leitura
 * produz o mesmo conteúdo normalizado e o pipeline reconhece que nada mudou.
 */

interface Duplicata {
  competencia: string;
  placa: string;
  numdoc: string;
  valor: number;
  linhaRepetida: number;
  /** `null` num lançamento lido antes de a coluna do endereço existir. */
  impressaoHash: string | null;
}

interface PlacaSemTipo {
  placa: string;
  competencias: string[];
  lancamentos: number;
  valor: number;
  contas: string[];
}

interface Pendencias {
  duplicatas: Duplicata[];
  semClassificacao: PlacaSemTipo[];
  valorRetido: number;
  valorSemClassificacao: number;
}

/*
  Os tipos que o acervo Real aceita — a lista mora no domínio, e a tela a lê.
  Uma segunda lista aqui concordaria no dia em que fosse escrita e discordaria no
  dia do sexto equipamento.
*/
const TIPOS_DE_ATIVO = ACERVOS.find((a) => a.code === "REAL")?.tipos ?? [];

const emReais = (valor: number): string =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O que o servidor devolve de uma aplicação. Ver `aplicarDecisaoDoReal`. */
interface ResultadoDaAplicacao {
  aplicada: boolean;
  efeito: string;
  competencias: string[];
  valor: number;
  revisoes: { label: string; revisao: number }[];
}

/**
 * Classificar e aplicar — um pedido só.
 *
 * O `invalidateQueries` não é higiene: é a outra metade do botão. Aplicar muda
 * o confronto, os cartões e os totais da tela em que a pessoa está, e sem a
 * invalidação ela veria a pendência sumir com os números velhos ao lado — o
 * mesmo desencontro que a versão anterior produzia, só que mais rápido.
 *
 * As três chaves porque são três leituras diferentes do que acabou de mudar: a
 * fila (`financiamento-real`), tudo o que a auditoria de FINAME lê (`finame`:
 * competências, confronto, comparação, totais) e a lista de vigências
 * (`snapshots`), que ganhou uma revisão nova.
 */
function useAplicarDecisao() {
  const cliente = useQueryClient();
  return useMutation<
    ResultadoDaAplicacao,
    Error,
    { tipo: string; chave: string; motivo: string; valor?: string }
  >({
    mutationFn: async (decisao) => {
      const resposta = await fetch(getApiUrl("/financiamento-real/decisoes/aplicar"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decisao),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível aplicar.");
      return corpo;
    },
    onSuccess: () => {
      for (const chave of [["financiamento-real"], ["finame"], ["snapshots"]]) {
        void cliente.invalidateQueries({ queryKey: chave });
      }
    },
  });
}

export function PendenciasDoReal(): ReactElement | null {
  const pendencias = useQuery<Pendencias>({
    queryKey: ["financiamento-real", "pendencias"],
    queryFn: () => fetchJson("/financiamento-real/pendencias"),
  });

  const dados = pendencias.data;
  if (!dados) return null;
  if (dados.duplicatas.length === 0 && dados.semClassificacao.length === 0) return null;

  return (
    <section className="grid gap-3 sm:grid-cols-2" data-testid="pendencias-do-real">
      {dados.duplicatas.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-amber-600" />
            <p className="font-medium">
              {dados.duplicatas.length} lançamentos repetidos, retidos
            </p>
            <Badge variant="secondary">{emReais(dados.valorRetido)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Linhas idênticas em todas as colunas, inclusive na data de escrituração.
            Não entraram na soma e não foram descartadas: somá-las cobraria duas vezes
            o mesmo pagamento; descartá-las perderia um pagamento que talvez exista.
            Responder vale no mesmo clique — e a resposta fica no histórico com o motivo.
          </p>
          <ul className="mt-3 space-y-2 text-xs">
            {dados.duplicatas.slice(0, 5).map((d) => (
              <DuplicataPendente
                key={`${d.competencia}-${d.numdoc}-${d.linhaRepetida}`}
                duplicata={d}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {dados.semClassificacao.length > 0 ? (
        <div className="rounded-lg border border-slate-500/40 bg-slate-500/5 p-4">
          <div className="flex items-center gap-2">
            <CircleHelp className="h-4 w-4 text-slate-600" />
            <p className="font-medium">
              {dados.semClassificacao.length} placas sem tipo de ativo
            </p>
            <Badge variant="secondary">{emReais(dados.valorSemClassificacao)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Não estão no cadastro, e o tipo não é deduzido da conta contábil —
            &ldquo;C.D.C. - VP&rdquo; vale para cavalo, caminhão e carreta igualmente.
            Os lançamentos estão preservados e ficam fora do confronto até alguém
            classificá-las — e entram assim que alguém classificar: a resposta vale
            no mesmo clique.
          </p>
          <ul className="mt-3 space-y-2 text-xs">
            {dados.semClassificacao.slice(0, 5).map((placa) => (
              <PlacaPendente key={placa.placa} placa={placa} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Uma duplicata provável, com as duas saídas que ela tem.
 *
 * As duas, e não uma: "é o export repetindo" e "são dois pagamentos" são
 * respostas opostas para a mesma pergunta, e oferecer só uma delas empurraria
 * quem decide para o lado que o software achou mais provável. O motivo é
 * obrigatório — o servidor recusa sem ele — porque o histórico precisa dizer
 * **por que**, e não só o quê.
 */
function DuplicataPendente({ duplicata }: { duplicata: Duplicata }): ReactElement {
  const [motivo, setMotivo] = useState("");
  const aplicar = useAplicarDecisao();

  return (
    <li className="rounded border bg-background/60 p-2" data-testid="duplicata-pendente">
      <p className="text-muted-foreground">
        {duplicata.placa} · {duplicata.competencia} · doc {duplicata.numdoc} ·{" "}
        {emReais(duplicata.valor)} · linha {duplicata.linhaRepetida}
      </p>
      {duplicata.impressaoHash === null ? (
        /*
          A pendência existe e continua à vista; o que falta é endereço. Ela foi
          lida antes de a coluna da impressão digital existir, e decidir sobre ela
          exigiria gravar uma chave que não aponta para grupo nenhum.
        */
        <p className="mt-1 text-muted-foreground">
          Esta pendência foi lida antes de o endereço dela existir. Reimporte esta
          competência para poder decidir sobre ela.
        </p>
      ) : aplicar.isSuccess ? (
        <p className="mt-1 text-emerald-700 dark:text-emerald-300">
          {aplicar.data.efeito}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por quê?"
            className="h-7 w-48 text-xs"
            data-testid="motivo-da-decisao"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={motivo.trim() === "" || aplicar.isPending}
            onClick={() =>
              aplicar.mutate({
                tipo: "DUPLICATA_CONFIRMADA",
                chave: duplicata.impressaoHash as string,
                motivo,
              })
            }
          >
            {aplicar.isPending ? "Aplicando…" : "É repetição do export"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={motivo.trim() === "" || aplicar.isPending}
            onClick={() =>
              aplicar.mutate({
                tipo: "LANCAMENTOS_DISTINTOS",
                chave: duplicata.impressaoHash as string,
                motivo,
              })
            }
          >
            {aplicar.isPending ? "Aplicando…" : "São dois pagamentos"}
          </Button>
          {aplicar.isError ? (
            <span className="text-rose-600">{aplicar.error.message}</span>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Uma placa que o cadastro não resolveu, com a classificação declarada.
 *
 * A conta contábil aparece como evidência ao lado — e continua não decidindo
 * nada: quem escolhe o tipo é quem está olhando.
 */
function PlacaPendente({ placa }: { placa: PlacaSemTipo }): ReactElement {
  const [tipo, setTipo] = useState("");
  const [motivo, setMotivo] = useState("");
  const aplicar = useAplicarDecisao();

  return (
    <li className="rounded border bg-background/60 p-2" data-testid="placa-sem-tipo">
      <p className="text-muted-foreground">
        {placa.placa} · {placa.lancamentos} lançamentos · {emReais(placa.valor)} ·{" "}
        {placa.contas.join(", ")}
      </p>
      {aplicar.isSuccess ? (
        <p className="mt-1 text-emerald-700 dark:text-emerald-300">
          {aplicar.data.efeito}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-7 w-36 text-xs" data-testid="tipo-do-ativo">
              <SelectValue placeholder="Tipo do ativo" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_DE_ATIVO.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Como se sabe?"
            className="h-7 w-44 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={tipo === "" || motivo.trim() === "" || aplicar.isPending}
            data-testid="classificar-e-aplicar"
            onClick={() =>
              aplicar.mutate({
                tipo: "CLASSIFICAR_ATIVO",
                chave: placa.placa,
                valor: tipo,
                motivo,
              })
            }
          >
            {aplicar.isPending ? "Aplicando…" : "Classificar e aplicar"}
          </Button>
          {aplicar.isError ? (
            <span className="text-rose-600">{aplicar.error.message}</span>
          ) : null}
        </div>
      )}
    </li>
  );
}
