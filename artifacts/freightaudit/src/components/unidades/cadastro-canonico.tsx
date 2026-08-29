import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apresentar } from "@/lib/apresentar-erro";
import { fetchJson } from "@/lib/api";
import {
  editarUnidadeCanonica,
  identidadeVisivel,
  listarUnidadesCanonicas,
  type UnidadeCanonica,
} from "@/lib/fechamento";
import { cn } from "@/lib/utils";

/**
 * O CADASTRO MESTRE DE UNIDADES — e os três estados que ele precisa distinguir.
 *
 * **Existência da unidade e existência de dados dela são coisas diferentes**, e
 * a tela antiga só sabia falar da segunda: ela lia `/contexts`, que agrupa os
 * snapshots vivos, e por isso *unidade* ali era "unidade que entregou vigência".
 * Quem nunca mandou export não existia em tela nenhuma — e a unidade existe no
 * mundo antes do primeiro arquivo.
 *
 * `/contexts` continua servindo Parâmetros, Comparar, Alterações e o Resumo
 * executivo, intacto. Esta lista responde outra pergunta: **quais unidades este
 * produto conhece.**
 *
 * **`DETECTADA` não é unidade canônica, e é o ponto.** Um snapshot que declarou
 * um CNPJ é evidência determinística — sai da coluna `Unidade - CNPJ`,
 * normalizada por função pura e protegida por `check` no banco — e evidência
 * não é cadastro. Se aparecer num arquivo bastasse para criar identidade, a
 * autoridade voltaria a ser a importação, que é exatamente o desenho que este
 * cadastro desfaz. A linha oferece o cadastro com o CNPJ já preenchido; quem
 * confirma é gente.
 *
 * **A identidade tem duas formas, e o formulário pede uma das duas.** O CNPJ
 * era obrigatório aqui, e a recusa que a tela mostrava — *"o CNPJ é a
 * identidade da unidade, sem ele não há o que cadastrar"* — não tinha saída
 * para quem opera uma unidade que ainda não tem CNPJ próprio, que fatura sob o
 * de outra, ou que o negócio inteiro chama por um código. Essas unidades não
 * eram cadastradas: continuavam vivendo como texto livre nas quatro
 * representações que este cadastro veio substituir, ou entravam com um
 * documento inventado para vencer a validação — identidade errada, que é pior
 * do que identidade faltando.
 *
 * O que **não** mudou é a regra que importava: uma unidade, uma identidade. Os
 * dois campos são únicos, ao menos um é obrigatório, e a frase debaixo deles
 * muda conforme o que está preenchido — porque quem informa o CNPJ ganha o
 * encontro com o acervo e quem informa só o código precisa saber que esse
 * encontro não acontece.
 */

/**
 * A linha desta tela é a `UnidadeCanonica` de `lib/fechamento.ts`, e não uma
 * cópia dela.
 *
 * Era uma cópia — os mesmos seis campos, escritos de novo —, e vinha com uma
 * `queryFn` própria para a mesma chave `["unidades","canonicas"]` que Realizar
 * Fechamento e Registrar Unidade já usavam. As duas coisas juntas são
 * exatamente o defeito que este PR corrige em `/contexts`: no React Query há
 * **uma** `Query` por chave, com uma `queryFn` só, e quem dispara a busca dita
 * o comportamento para todos os observadores. Hoje as duas versões fazem a
 * mesma chamada e nada quebra; bastaria uma delas ganhar um `.catch(() => [])`
 * ou um `retry: false` para as outras duas telas herdarem em silêncio.
 *
 * Foi `lib/__tests__/chave-compartilhada.test.ts` que apontou isto, sobre a
 * árvore já mesclada — que é o trabalho dele.
 */
type LinhaDaAdministracao = UnidadeCanonica;

const ROTULO: Record<
  LinhaDaAdministracao["estado"],
  { texto: string; classe: string }
> = {
  CADASTRADA: {
    texto: "Cadastrada, sem importação",
    classe: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  },
  CADASTRADA_E_IMPORTADA: {
    texto: "Cadastrada e importada",
    classe:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
  DETECTADA: {
    texto: "Detectada no acervo, não cadastrada",
    classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
};

export function CadastroCanonicoDeUnidades() {
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  /*
    A outra identidade. Vazio é o normal — quem tem o CNPJ informa o CNPJ, e é
    o que a maioria dos cadastros faz —, e é por isso que o campo não pede
    nada: ele existe para a unidade cujo documento ninguém tem para digitar.
  */
  const [codigoGerencial, setCodigoGerencial] = useState("");
  /* `null` é cadastrar do zero; um `id` é editar a unidade que já tem esse `id`. */
  const [emEdicao, setEmEdicao] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["unidades", "canonicas"],
    // A mesma busca das outras duas telas que usam esta chave. Ver o tipo acima.
    queryFn: listarUnidadesCanonicas,
  });

  const cadastrar = useMutation({
    /*
      O `Content-Type` não é decoração: sem ele o cadastro **não cadastrava**.

      `fetch` só declara `application/json` quando alguém o declara — com um
      corpo de texto e nenhum cabeçalho, o navegador manda
      `text/plain;charset=UTF-8`. O `express.json()` do servidor lê pelo tipo:
      o que não é JSON declarado ele não desserializa, e a rota recebia
      `req.body` vazio. Daí o desfecho que quem cadastrava via — nome e CNPJ
      preenchidos na tela e "O nome da unidade é o que a lista mostra… sem ele
      a unidade existe e ninguém a acha" de volta —, que é a recusa correta de
      `cadastrarUnidade` para o pedido que de fato chegou lá: um sem nome.

      Todas as outras escritas desta interface já declaravam o cabeçalho; esta
      era a única que não, e `lib/__tests__/corpo-json.test.ts` passa a impedir
      que a próxima nasça assim.
    */
    mutationFn: (pedido: { nome: string; cnpj: string; codigoGerencial: string }) =>
      fetchJson("/unidades/canonicas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedido),
      }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["unidades", "canonicas"] });
      setAberto(false);
      setNome("");
      setCnpj("");
      setCodigoGerencial("");
    },
  });

  const editar = useMutation({
    mutationFn: (pedido: {
      id: string;
      nome: string;
      cnpj: string;
      codigoGerencial: string;
    }) =>
      editarUnidadeCanonica(pedido.id, {
        nome: pedido.nome,
        cnpj: pedido.cnpj,
        codigoGerencial: pedido.codigoGerencial,
      }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["unidades", "canonicas"] });
      setAberto(false);
      setEmEdicao(null);
      setNome("");
      setCnpj("");
      setCodigoGerencial("");
    },
  });

  const linhas = lista.data ?? [];
  const cadastradas = linhas.filter((l) => l.id !== null).length;

  /* Abrir o formulário do zero, pelo botão "Cadastrar unidade" do cabeçalho. */
  const abrirParaCadastrar = () => {
    cadastrar.reset();
    editar.reset();
    setEmEdicao(null);
    setNome("");
    setCnpj("");
    setCodigoGerencial("");
    setAberto(true);
  };

  /* Abrir o formulário a partir de uma detectada: o CNPJ já vem preenchido. */
  const cadastrarDetectada = (linha: LinhaDaAdministracao) => {
    setEmEdicao(null);
    setNome(linha.nome);
    setCnpj(linha.cnpjFormatado);
    setCodigoGerencial("");
    setAberto(true);
  };

  /* Abrir o formulário para editar uma unidade já cadastrada. */
  const editarCadastrada = (linha: LinhaDaAdministracao) => {
    cadastrar.reset();
    editar.reset();
    setEmEdicao(linha.id);
    setNome(linha.nome);
    setCnpj(linha.cnpjFormatado);
    setCodigoGerencial(linha.codigoGerencial ?? "");
    setAberto(true);
  };

  const fecharFormulario = () => {
    setAberto(false);
    setEmEdicao(null);
    setNome("");
    setCnpj("");
    setCodigoGerencial("");
  };

  const salvando = cadastrar.isPending || editar.isPending;
  const erroDoFormulario = emEdicao === null ? cadastrar.error : editar.error;

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Cadastro de unidades
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            A autoridade sobre <strong>qual unidade é esta</strong>. A
            identidade é o CNPJ — ou um código gerencial, quando não há CNPJ a
            informar —, dita uma vez aqui: Fechamento e Remuneração passam a
            escolher desta lista em vez de digitar código. {cadastradas}{" "}
            cadastrada
            {cadastradas === 1 ? "" : "s"}.
          </p>
        </div>
        <Button size="sm" onClick={() => (aberto ? fecharFormulario() : abrirParaCadastrar())}>
          <Plus className="w-4 h-4 mr-1" />
          Cadastrar unidade
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {aberto && (
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-medium">
              {emEdicao === null ? "Cadastrar unidade" : "Editar cadastro"}
            </p>
            {erroDoFormulario !== null && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  {(() => {
                    /* A mesma leitura de `informar-codigo.tsx`: orientação quando
                       o servidor a tipou, a mensagem crua quando não. */
                    const aviso = apresentar(erroDoFormulario);
                    return (
                      aviso.principal ??
                      aviso.mensagemCrua ??
                      (emEdicao === null
                        ? "Não foi possível cadastrar a unidade."
                        : "Não foi possível salvar a edição.")
                    );
                  })()}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="unidade-canonica-nome">Unidade (CDD)</Label>
                <Input
                  id="unidade-canonica-nome"
                  value={nome}
                  placeholder="CDD BELÉM"
                  onChange={(e) => setNome(e.target.value)}
                  className="uppercase"
                />
              </div>
              {/*
                Os dois campos de identidade, lado a lado e nesta ordem: o CNPJ
                primeiro porque é ele que os arquivos trazem — é por ele que a
                unidade digitada e a importada se encontram —, e o código
                gerencial ao lado para a unidade que não tem documento a
                digitar. Um ou outro basta; os dois juntos é o melhor caso.
              */}
              <div className="space-y-1.5">
                <Label htmlFor="unidade-canonica-cnpj">
                  CNPJ da unidade{" "}
                  <span className="font-normal text-muted-foreground">
                    (ou o código)
                  </span>
                </Label>
                <Input
                  id="unidade-canonica-cnpj"
                  value={cnpj}
                  placeholder="12.345.678/0001-99"
                  onChange={(e) => setCnpj(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unidade-canonica-codigo">
                  Código gerencial{" "}
                  <span className="font-normal text-muted-foreground">
                    (ou o CNPJ)
                  </span>
                </Label>
                <Input
                  id="unidade-canonica-codigo"
                  value={codigoGerencial}
                  placeholder="081-0443"
                  onChange={(e) => setCodigoGerencial(e.target.value)}
                  className="uppercase"
                />
              </div>
            </div>
            {/*
              A frase muda com o que está preenchido porque as três situações
              têm consequências diferentes, e um texto único estaria errado em
              duas delas: quem informou o CNPJ ganha o encontro com o acervo,
              quem informou só o código precisa saber que esse encontro não
              acontece, e quem não informou nada precisa saber que **um dos
              dois** resolve — que é justamente o que a versão anterior desta
              tela não dizia, porque ali só havia um caminho.
            */}
            <p className="text-xs text-muted-foreground">
              {cnpj.trim() !== "" ? (
                <>
                  O CNPJ é a identidade da unidade em todo o FreightCheck —
                  aceita máscara e é guardado só com os dígitos. É por ele que o
                  export, quando chegar, cai <strong>nesta</strong> unidade.
                </>
              ) : codigoGerencial.trim() !== "" ? (
                <>
                  Sem CNPJ, quem identifica a unidade é o código gerencial — ele
                  é único e vale em todo o FreightCheck.{" "}
                  <strong>
                    O que ele não faz é encontrar o acervo por documento
                  </strong>
                  : o export declara CNPJ, então a unidade importada abriria ao
                  lado desta. Informe o CNPJ assim que tiver — dá para
                  acrescentá-lo depois, por “Editar”.
                </>
              ) : (
                <>
                  Informe <strong>o CNPJ ou um código gerencial</strong> — um dos
                  dois basta, e os dois juntos é o melhor caso. O CNPJ é o que os
                  arquivos trazem; o código atende a unidade cujo documento
                  ninguém tem para digitar.
                </>
              )}{" "}
              O nome é descrição: é o que a lista mostra e o que quem opera
              procura, e nunca funciona como código.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={fecharFormulario}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={salvando}
                onClick={() =>
                  emEdicao === null
                    ? cadastrar.mutate({ nome, cnpj, codigoGerencial })
                    : editar.mutate({ id: emEdicao, nome, cnpj, codigoGerencial })
                }
              >
                {emEdicao === null
                  ? cadastrar.isPending
                    ? "Cadastrando…"
                    : "Cadastrar unidade"
                  : editar.isPending
                    ? "Salvando…"
                    : "Salvar alterações"}
              </Button>
            </div>
          </div>
        )}

        {lista.isPending && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}

        {!lista.isPending && linhas.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade cadastrada e nenhuma detectada no acervo. A primeira
            nasce aqui, com nome e CNPJ — ou com um código gerencial, quando o
            CNPJ ainda não existe —, e não de um arquivo.
          </p>
        )}

        {linhas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="text-left py-2 font-medium">Unidade</th>
                  <th className="text-left py-2 font-medium">Identidade</th>
                  <th className="text-left py-2 font-medium">
                    Situação de dados
                  </th>
                  <th className="text-right py-2 font-medium">Vigências</th>
                  <th className="text-right py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  /*
                    A chave era o CNPJ, e ele deixou de existir em toda linha —
                    duas unidades sem documento colidiriam em `undefined` e o
                    React remontaria a lista errada. O `id` é a identidade de
                    verdade; a linha detectada não tem um, e aí o CNPJ que a
                    detectou é único por construção.
                  */
                  <tr key={linha.id ?? linha.cnpj} className="border-b last:border-0">
                    <td className="py-2 font-medium">{linha.nome || "—"}</td>
                    <td className="py-2 font-mono text-xs">
                      {identidadeVisivel(linha) || "—"}
                    </td>
                    <td className="py-2">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "font-normal",
                          ROTULO[linha.estado].classe,
                        )}
                      >
                        {ROTULO[linha.estado].texto}
                      </Badge>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {linha.vigencias}
                    </td>
                    <td className="py-2 text-right">
                      {linha.estado === "DETECTADA" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cadastrarDetectada(linha)}
                        >
                          Cadastrar unidade
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editarCadastrada(linha)}
                        >
                          Editar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
