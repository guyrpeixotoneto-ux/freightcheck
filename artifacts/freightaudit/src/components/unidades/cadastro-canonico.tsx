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
    mutationFn: (pedido: { nome: string; cnpj: string }) =>
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
    },
  });

  const editar = useMutation({
    mutationFn: (pedido: { id: string; nome: string; cnpj: string }) =>
      editarUnidadeCanonica(pedido.id, { nome: pedido.nome, cnpj: pedido.cnpj }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["unidades", "canonicas"] });
      setAberto(false);
      setEmEdicao(null);
      setNome("");
      setCnpj("");
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
    setAberto(true);
  };

  /* Abrir o formulário a partir de uma detectada: o CNPJ já vem preenchido. */
  const cadastrarDetectada = (linha: LinhaDaAdministracao) => {
    setEmEdicao(null);
    setNome(linha.nome);
    setCnpj(linha.cnpjFormatado);
    setAberto(true);
  };

  /* Abrir o formulário para editar uma unidade já cadastrada. */
  const editarCadastrada = (linha: LinhaDaAdministracao) => {
    cadastrar.reset();
    editar.reset();
    setEmEdicao(linha.id);
    setNome(linha.nome);
    setCnpj(linha.cnpjFormatado);
    setAberto(true);
  };

  const fecharFormulario = () => {
    setAberto(false);
    setEmEdicao(null);
    setNome("");
    setCnpj("");
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
            A autoridade sobre <strong>qual unidade é esta</strong>. O CNPJ é a
            identidade, informado uma vez aqui — Fechamento e Remuneração passam
            a escolher desta lista em vez de digitar código. {cadastradas}{" "}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="space-y-1.5">
                <Label htmlFor="unidade-canonica-cnpj">CNPJ da unidade</Label>
                <Input
                  id="unidade-canonica-cnpj"
                  value={cnpj}
                  placeholder="12.345.678/0001-99"
                  onChange={(e) => setCnpj(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              O CNPJ é a identidade da unidade em todo o FreightCheck — aceita
              máscara e é guardado só com os dígitos. O nome é descrição: é o
              que a lista mostra e o que quem opera procura, e nunca funciona
              como código.
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
                    ? cadastrar.mutate({ nome, cnpj })
                    : editar.mutate({ id: emEdicao, nome, cnpj })
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
            nasce aqui, com nome e CNPJ — não de um arquivo.
          </p>
        )}

        {linhas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="text-left py-2 font-medium">Unidade</th>
                  <th className="text-left py-2 font-medium">CNPJ</th>
                  <th className="text-left py-2 font-medium">
                    Situação de dados
                  </th>
                  <th className="text-right py-2 font-medium">Vigências</th>
                  <th className="text-right py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.cnpj} className="border-b last:border-0">
                    <td className="py-2 font-medium">{linha.nome || "—"}</td>
                    <td className="py-2 font-mono text-xs">
                      {linha.cnpjFormatado}
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
