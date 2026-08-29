import { useState } from "react";
import { Check, Loader2, Wand2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fraseDoErro } from "@/lib/fluxos";
import {
  useAplicarArrumacao,
  useResponsaveisEmTexto,
  type EscopoDoTexto,
  type ResponsavelEmTexto,
  type TipoDeVinculo,
} from "@/lib/arrumacao";
import { useOpcoesDeResponsavel } from "@/lib/responsaveis";
import type { OpcaoDeCadastro, OpcoesDeResponsavel } from "@/lib/fluxos-analise";

/**
 * ARRUMAR OS RESPONSÁVEIS QUE AINDA SÃO TEXTO — uma decisão, muitas etapas.
 *
 * ---------------------------------------------------------------------------
 * Por que esta tela existe
 * ---------------------------------------------------------------------------
 *
 * A `0079` deu ao responsável um vínculo com o cadastro e **não** converteu o
 * que já estava escrito: `Fat.` não é automaticamente `Faturamento`, e um
 * `UPDATE` que adivinhasse isso teria gravado um palpite que ninguém reviu.
 *
 * O que faltava era o lugar onde uma pessoa toma essa decisão **uma vez** e ela
 * vale para as trinta etapas que dizem a mesma coisa. Sem ele, arrumar um
 * processo levantado ao longo de um ano é abrir etapa por etapa — o custo que
 * faz ninguém arrumar, e que faria o cadastro nunca ganhar.
 *
 * ---------------------------------------------------------------------------
 * O que a tela mostra, e por quê
 * ---------------------------------------------------------------------------
 *
 * **As grafias, e não só o nome canônico.** Uma linha que diz
 * `FATURAMENTO · Faturamento · faturamento` é a prova do problema na cara de
 * quem vai decidir: são as três raias que o fluxograma desenhava. Mostrar só
 * `FATURAMENTO` esconderia justamente o que se está consertando.
 *
 * **A contagem.** É ela que ordena a lista e que diz o tamanho do conserto —
 * "isto arruma 31 etapas de uma vez" é uma frase diferente de "isto arruma 1".
 *
 * **A sugestão vem escolhida, mas nada é aplicado sozinho.** Cada linha tem o
 * seu próprio botão, e o lote é a linha — não a tela inteira. Um "aplicar tudo"
 * transformaria vinte decisões independentes num clique só, e a que estivesse
 * errada entraria junto com as dezenove certas.
 *
 * **O texto não é apagado.** Ele continua sendo o que vale se o vínculo um dia
 * deixar de resolver. Arrumar aqui é acrescentar identidade, não remover
 * história — e é por isso que a linha some da lista sem nada ter sido perdido.
 */

const ROTULO_DO_ESCOPO: Record<EscopoDoTexto, string> = {
  AREA: "Área da etapa",
  RESPONSAVEL: "Responsável da etapa",
  ITEM: "Lista de responsáveis",
};

/**
 * O que cada escopo aceita — o mesmo recorte do servidor, e de propósito.
 *
 * A área de uma etapa é o departamento; o responsável dela é a função ou a
 * pessoa. Repetir a regra aqui não é duplicá-la como autoridade: o servidor
 * recusa de qualquer jeito (`ARRUMACAO_ESCOPO_INVALIDO`). É para a tela não
 * oferecer uma escolha que ela sabe que vai voltar recusada.
 */
const FONTES: Record<EscopoDoTexto, { tipo: TipoDeVinculo; fonte: keyof OpcoesDeResponsavel }[]> = {
  AREA: [{ tipo: "DEPARTAMENTO", fonte: "departamentos" }],
  RESPONSAVEL: [
    { tipo: "CARGO", fonte: "cargos" },
    { tipo: "PESSOA", fonte: "pessoas" },
  ],
  ITEM: [
    { tipo: "DEPARTAMENTO", fonte: "departamentos" },
    { tipo: "CARGO", fonte: "cargos" },
    { tipo: "PESSOA", fonte: "pessoas" },
  ],
};

const NOME_DO_TIPO: Record<TipoDeVinculo, string> = {
  DEPARTAMENTO: "Departamento",
  CARGO: "Cargo",
  PESSOA: "Pessoa",
};

/**
 * O valor do `Select` carrega o tipo junto com o `id`.
 *
 * Um `id` sozinho não diz se é departamento, cargo ou conta, e a aplicação
 * precisa saber em qual das três colunas escrever. Duas caixas — uma de tipo,
 * outra de nome — dariam dois cliques para uma decisão só.
 */
const valorDe = (tipo: TipoDeVinculo, id: string) => `${tipo}:${id}`;

function lerValor(valor: string): { tipo: TipoDeVinculo; id: string } | null {
  const corte = valor.indexOf(":");
  if (corte < 0) return null;
  const tipo = valor.slice(0, corte) as TipoDeVinculo;
  const id = valor.slice(corte + 1);
  return id === "" ? null : { tipo, id };
}

/** A chave da linha — escopo e texto identificam um achado sem ambiguidade. */
const chaveDoAchado = (achado: ResponsavelEmTexto) => `${achado.escopo}:${achado.textoCanonico}`;

export function ArrumarResponsaveis({
  aberto,
  empresaId,
  aoFechar,
}: {
  aberto: boolean;
  empresaId: string | null;
  aoFechar: () => void;
}) {
  const consulta = useResponsaveisEmTexto(empresaId, aberto);
  const opcoes = useOpcoesDeResponsavel();
  const aplicar = useAplicarArrumacao(empresaId);

  /* A escolha de cada linha, por chave — o que não foi tocado usa a sugestão. */
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  /* O que já foi arrumado nesta sessão do diálogo, para a frase do resultado. */
  const [feitos, setFeitos] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aplicando, setAplicando] = useState<string | null>(null);

  const achados = consulta.data?.achados ?? [];

  const escolhaDe = (achado: ResponsavelEmTexto): string => {
    const chave = chaveDoAchado(achado);
    if (chave in escolhas) return escolhas[chave];
    return achado.sugestao ? valorDe(achado.sugestao.tipo, achado.sugestao.id) : "";
  };

  const aoAplicar = (achado: ResponsavelEmTexto) => {
    const chave = chaveDoAchado(achado);
    const lido = lerValor(escolhaDe(achado));
    if (!lido) return;
    setAplicando(chave);
    setErros((atuais) => ({ ...atuais, [chave]: "" }));
    aplicar
      .mutateAsync({
        escopo: achado.escopo,
        textoCanonico: achado.textoCanonico,
        departamentoId: lido.tipo === "DEPARTAMENTO" ? lido.id : null,
        cargoId: lido.tipo === "CARGO" ? lido.id : null,
        pessoaId: lido.tipo === "PESSOA" ? lido.id : null,
      })
      .then((resultado) => {
        setFeitos((atuais) => ({
          ...atuais,
          [chave]:
            resultado.alteradas === 0
              ? `Nada mudou — estas linhas já tinham vínculo.`
              : `${resultado.alteradas} ${resultado.alteradas === 1 ? "linha passou" : "linhas passaram"} a apontar para ${resultado.nome}.`,
        }));
      })
      .catch((falha: unknown) =>
        setErros((atuais) => ({ ...atuais, [chave]: fraseDoErro(falha) })),
      )
      .finally(() => setAplicando(null));
  };

  const semCadastro =
    opcoes === undefined ||
    (opcoes.departamentos.length === 0 &&
      opcoes.cargos.length === 0 &&
      opcoes.pessoas.length === 0);

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => !v && aoFechar()}
      className="max-h-[90vh] max-w-3xl overflow-y-auto"
    >
      <DialogHeader>
        <DialogTitle>Arrumar responsáveis em texto</DialogTitle>
        <DialogDescription>
          O que ainda foi digitado à mão nas etapas desta empresa, agrupado pelo nome. Escolher
          o cadastro aqui vale para todas as etapas que dizem a mesma coisa — e o texto
          continua gravado, como estava.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        {consulta.isLoading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Procurando o que ainda é texto…
          </p>
        )}

        {consulta.isError && (
          <Alert variant="destructive">
            <AlertDescription>{fraseDoErro(consulta.error)}</AlertDescription>
          </Alert>
        )}

        {/*
          Sem cadastro não há o que escolher, e a frase diz o caminho em vez de
          mostrar uma lista de caixas vazias.
        */}
        {!consulta.isLoading && semCadastro && achados.length > 0 && (
          <Alert>
            <AlertDescription>
              Nenhum departamento, cargo ou pessoa cadastrado ainda — não há o que escolher.
              Cadastre em Configurações → Cadastro da casa e volte aqui.
            </AlertDescription>
          </Alert>
        )}

        {!consulta.isLoading && !consulta.isError && achados.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nada a arrumar: todo responsável desta empresa já vem do cadastro.
          </p>
        )}

        {achados.map((achado) => {
          const chave = chaveDoAchado(achado);
          const feito = feitos[chave];
          const erro = erros[chave];
          const escolha = escolhaDe(achado);
          return (
            <div key={chave} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{achado.grafias.join(" · ")}</span>
                <Badge variant="outline" className="font-normal">
                  {ROTULO_DO_ESCOPO[achado.escopo]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {achado.ocorrencias === 1
                    ? "em 1 etapa"
                    : `em ${achado.ocorrencias} etapas`}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  value={escolha}
                  disabled={semCadastro || aplicando !== null}
                  onValueChange={(v) => setEscolhas((atuais) => ({ ...atuais, [chave]: v }))}
                >
                  <SelectTrigger
                    className="h-9 w-[280px]"
                    aria-label={`Cadastro para ${achado.grafias[0] ?? achado.textoCanonico}`}
                  >
                    <SelectValue placeholder="Escolha o cadastro…" />
                  </SelectTrigger>
                  <SelectContent>
                    {FONTES[achado.escopo].map(({ tipo, fonte }) =>
                      (opcoes?.[fonte] ?? []).map((o: OpcaoDeCadastro) => (
                        <SelectItem key={valorDe(tipo, o.id)} value={valorDe(tipo, o.id)}>
                          {o.nome}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {NOME_DO_TIPO[tipo]}
                          </span>
                        </SelectItem>
                      )),
                    )}
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  className="h-9"
                  disabled={escolha === "" || aplicando !== null}
                  onClick={() => aoAplicar(achado)}
                >
                  {aplicando === chave ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Aplicar
                </Button>

                {/*
                  A sugestão é dita, e não só pré-selecionada: quem lê precisa
                  saber que o valor na caixa foi proposto pela máquina — por
                  casamento exato de nome — e não escolhido por alguém.
                */}
                {achado.sugestao && !(chave in escolhas) && (
                  <span className="text-xs text-muted-foreground">
                    sugerido pelo nome igual
                  </span>
                )}
              </div>

              {feito && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5" />
                  {feito}
                </p>
              )}
              {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
