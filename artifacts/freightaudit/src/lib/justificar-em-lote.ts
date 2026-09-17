import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { JustificativaEstruturada } from "@workspace/comparison/justificativa-estruturada";
import {
  alteracoesIguais,
  descreverEscopoDoLote,
  repartirAlvosDoLote,
  resumirConjuntoDoLote,
  type AlteracaoDoLote,
  type EscopoDoLote,
} from "@workspace/comparison/justificativa-em-lote";

import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Justificativa } from "@/lib/justificativas";

/**
 * JUSTIFICAR EM LOTE — a metade que é da página.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e o que ele deliberadamente não é
 * ---------------------------------------------------------------------------
 * É o estado do modo em lote: se ele está ligado, o que está marcado, se a
 * marcação é "estes registros" ou "todos os resultados deste filtro", e a
 * gravação. Nada do que **justificar significa** mora aqui: os campos são os
 * mesmos de `campos.tsx`, o que é obrigatório é decidido pela mesma
 * `faltamNaJustificativa` que a rota usa, e o que fica gravado é uma linha por
 * alteração, como sempre foi. É o irmão de `useJustificarNaTabela`, e as duas
 * convivem na mesma tela de propósito: justificar uma alteração continua sendo
 * um clique na célula dela.
 *
 * ---------------------------------------------------------------------------
 * As duas seleções, e por que elas não são a mesma coisa
 * ---------------------------------------------------------------------------
 * **Os registros visíveis** são uma lista: quem marcou as caixas escolheu, uma
 * a uma, e o POST manda os ids. **Todos os resultados** é um recorte: o POST
 * manda o filtro, e quem reabre o universo é o servidor, com a mesma função que
 * desenhou a tabela. A diferença não é de tamanho — é de *o que ficou
 * registrado*, e é por isso que ela atravessa este arquivo inteiro em vez de
 * virar um `if` no momento de gravar.
 *
 * ---------------------------------------------------------------------------
 * Mexer no filtro desfaz a seleção de "todos os resultados"
 * ---------------------------------------------------------------------------
 * E desfaz em silêncio nenhum: a barra passa a dizer que o recorte mudou. É a
 * regra que impede o pior desfecho possível desta tela — alguém seleciona os
 * 206 resultados de "Alterados", troca a aba para "Conflito" ou digita uma
 * placa na busca, e confirma achando que está gravando o que via antes. Herdar
 * a seleção global para o recorte novo seria aplicar uma decisão a um conjunto
 * que quem decidiu nunca viu.
 *
 * A seleção a dedo sobrevive à troca de filtro **recortada ao que continua no
 * universo**: marcar cinco placas, buscar por uma delas e justificar não pode
 * gravar nas quatro que saíram da tela.
 */

export interface ResultadoDoLote {
  resumo: {
    universo: number;
    aplicadas: number;
    preservadas: number;
    sobrescritas: number;
  };
}

export function useJustificarEmLote({
  changeSetId,
  contexto,
  justificadaPor,
  /**
   * As alterações do recorte aberto — **todas**, e não as da página.
   *
   * É o universo que o link "Selecionar todos os N resultados" alcança, e é
   * dele que sai o número escrito no link: um número que contasse a página
   * prometeria 50 e gravaria 206.
   */
  alteracoesDoRecorte,
  /** O recorte de agora, como o servidor o reabriria. */
  escopoDoRecorte,
  /**
   * A assinatura do recorte — muda quando **qualquer** filtro muda.
   *
   * Busca, variável, aba, tipo, negativos, o alternador do que não mudou e o
   * par de vigências. É a única coisa que a página precisa manter em dia para
   * que a regra da seleção global valha; esquecer um filtro aqui é
   * exatamente o defeito que ela existe para impedir, e por isso ela é uma
   * string montada num lugar só.
   */
  assinaturaDoRecorte,
}: {
  changeSetId: string | undefined;
  contexto?: string;
  justificadaPor: ReadonlyMap<number, Justificativa>;
  alteracoesDoRecorte: readonly AlteracaoDoLote[];
  escopoDoRecorte: () => EscopoDoLote | null;
  assinaturaDoRecorte: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [emLote, setEmLote] = useState(false);
  const [marcadas, setMarcadas] = useState<ReadonlySet<number>>(new Set());
  const [todosOsResultados, setTodosOsResultados] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [recorteMudou, setRecorteMudou] = useState(false);

  const gravar = useMutation({
    mutationFn: (input: {
      escopo: EscopoDoLote;
      justificativa: JustificativaEstruturada;
      sobrescrever: boolean;
    }) =>
      fetchJson<ResultadoDoLote>("/justificativas/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId,
          escopo: input.escopo,
          sobrescrever: input.sobrescrever,
          ...input.justificativa,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justificativas", changeSetId] });
    },
  });

  /*
    O recorte mudou: a seleção global cai, e a seleção a dedo é podada.

    A comparação é sobre a assinatura anterior, e não sobre a lista de
    alterações: a lista muda de identidade a cada releitura da consulta, e um
    efeito que dependesse dela limparia a seleção sozinho a cada `refetch` —
    quem estivesse escolhendo veria as caixas se apagarem sem ter tocado em
    nada.
  */
  const assinaturaAnterior = useRef(assinaturaDoRecorte);
  const eraGlobal = useRef(false);
  eraGlobal.current = todosOsResultados;
  useEffect(() => {
    if (assinaturaAnterior.current === assinaturaDoRecorte) return;
    assinaturaAnterior.current = assinaturaDoRecorte;

    /*
      A seleção global **não sobrevive recortada**: cai inteira.

      Guardar a interseção — as 25 linhas que continuaram na tela depois da
      busca — pareceria conservador e seria o contrário: ninguém escolheu
      aquelas 25. Quem clicou escolheu *um recorte*, e o recorte deixou de
      existir; as que sobraram estariam marcadas por acidente de filtro, e é
      justamente isso que a regra existe para não deixar acontecer.

      A seleção a dedo é o caso oposto, e por isso o tratamento é outro: ali
      cada linha foi escolhida uma a uma, e o que ela perde na troca de filtro
      é só o que saiu do universo.
    */
    if (eraGlobal.current) {
      setMarcadas(new Set());
      setTodosOsResultados(false);
      setRecorteMudou(true);
      return;
    }
    setMarcadas((atuais) => {
      if (atuais.size === 0) return atuais;
      const noUniverso = new Set(alteracoesDoRecorte.map((a) => a.id));
      return new Set([...atuais].filter((id) => noUniverso.has(id)));
    });
  }, [assinaturaDoRecorte, alteracoesDoRecorte]);

  const marcar = useCallback((ids: readonly number[], marcarAgora: boolean) => {
    /*
      Mexer numa caixa é abrir mão de "todos os resultados".

      Quem tira uma placa de uma seleção global não quer "todos menos esta" —
      esse conjunto não é dizível por filtro nenhum, e gravá-lo como filtro
      gravaria um universo diferente do escolhido. A seleção vira o que ela de
      fato é a partir daí: uma lista.
    */
    setTodosOsResultados(false);
    setRecorteMudou(false);
    setMarcadas((atuais) => {
      const proximo = new Set(atuais);
      for (const id of ids) {
        if (marcarAgora) proximo.add(id);
        else proximo.delete(id);
      }
      return proximo;
    });
  }, []);

  const selecionarTodosOsResultados = useCallback(() => {
    setMarcadas(new Set(alteracoesDoRecorte.map((a) => a.id)));
    setTodosOsResultados(true);
    setRecorteMudou(false);
  }, [alteracoesDoRecorte]);

  /**
   * As iguais a esta — mesma variável, mesmo tipo, mesmos dois valores.
   *
   * `null` quando a pergunta não tem resposta: nada marcado, ou marcado com
   * mais de um contexto em jogo. Ver `alteracoesIguais`, no núcleo.
   */
  const iguais = useMemo(() => {
    const todas = alteracoesIguais(alteracoesDoRecorte, marcadas);
    if (todas.length === 0 || todas.length <= marcadas.size) return null;
    return todas;
  }, [alteracoesDoRecorte, marcadas]);

  const selecionarIguais = useCallback(() => {
    if (!iguais) return;
    marcar(
      iguais.map((a) => a.id),
      true,
    );
  }, [iguais, marcar]);

  const selecionadas = useMemo(
    () => alteracoesDoRecorte.filter((a) => marcadas.has(a.id)),
    [alteracoesDoRecorte, marcadas],
  );

  const resumo = useMemo(
    () =>
      resumirConjuntoDoLote(
        selecionadas,
        new Set([...justificadaPor.keys()]),
      ),
    [selecionadas, justificadaPor],
  );

  /*
    O que o clique vai de fato gravar, contado **aqui e agora**.

    A rota reparte de novo do lado dela, sobre a leitura do banco, e é a dela
    que vale. Esta serve para a frase que a caixa mostra antes do clique — e as
    duas saem da mesma função justamente para que a frase não possa prometer um
    número que a gravação não entrega.
  */
  const reparticao = useMemo(
    () =>
      repartirAlvosDoLote(
        selecionadas.map((a) => a.id),
        new Set([...justificadaPor.keys()]),
        false,
      ),
    [selecionadas, justificadaPor],
  );

  const cancelar = useCallback(() => {
    setEmLote(false);
    setMarcadas(new Set());
    setTodosOsResultados(false);
    setRecorteMudou(false);
    setAberto(false);
    gravar.reset();
  }, [gravar]);

  const escopo = useCallback((): EscopoDoLote | null => {
    if (todosOsResultados) return escopoDoRecorte();
    return marcadas.size === 0
      ? null
      : { tipo: "SELECAO", changeIds: [...marcadas] };
  }, [todosOsResultados, escopoDoRecorte, marcadas]);

  return {
    /** O modo está ligado? A tabela só mostra caixas quando sim. */
    emLote,
    abrirModo: () => setEmLote(true),
    cancelar,
    /** O que a tabela recebe como `selecao`. */
    selecao: { marcadas, onMarcar: marcar },
    /** O que a barra de ações recebe — espalhe e acabou. */
    propsDaBarra: {
      selecionadas: marcadas.size,
      totalDoRecorte: alteracoesDoRecorte.length,
      todosOsResultados,
      recorteMudou,
      iguais: iguais?.length ?? 0,
      onTodosOsResultados: selecionarTodosOsResultados,
      onIguais: selecionarIguais,
      onCancelar: cancelar,
      onJustificar: () => setAberto(true),
    },
    /** O que o `<JustificarEmLoteDialog />` recebe — espalhe e acabou. */
    propsDoDialogo: {
      aberto,
      contexto,
      resumo,
      aplicaveis: reparticao.aplicar.length,
      /** Quem pode substituir o que já está gravado — ver a rota. */
      podeSobrescrever: user?.role === "ADMIN",
      /** O universo, por extenso, como ele vai ficar registrado. */
      universo: (() => {
        const atual = escopo();
        return atual ? descreverEscopoDoLote(atual) : "";
      })(),
      todosOsResultados,
      pendente: gravar.isPending,
      erro: gravar.error,
      onFechar: () => {
        setAberto(false);
        gravar.reset();
      },
      onConfirmar: async (
        justificativa: JustificativaEstruturada,
        sobrescrever: boolean,
      ) => {
        const atual = escopo();
        if (!atual) return;
        await gravar.mutateAsync({ escopo: atual, justificativa, sobrescrever });
        /* Gravou: o modo sai de cena. Manter as caixas marcadas depois de
           aplicar convidaria a aplicar de novo — o que, sem sobrescrever, não
           faria nada, e com ele empilharia uma segunda justificativa em tudo. */
        cancelar();
      },
    },
  };
}
