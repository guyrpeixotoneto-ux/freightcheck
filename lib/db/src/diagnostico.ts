/**
 * O estado do banco, classificado **uma vez só**, para todo mundo.
 *
 * Antes deste módulo havia duas autoridades. O `/api/healthz` derivava o
 * diagnóstico do estado observado — o registro vivo do banco mais o relatório
 * da partida — e sabia distinguir "a fila está atrasada" de "a fila está
 * travada". As rotas de Chamados e do Book carregavam, cada uma, uma frase
 * fixa escrita em tempo de código, que não tinha como saber nada disso.
 *
 * A interface mostrava as duas empilhadas. O resultado, num ambiente real: o
 * parágrafo de cima dizia "rodar as migrations de novo vai falhar igual, use
 * `migrate:adotar`" e a linha logo abaixo dizia "suba o servidor de novo ou
 * rode `migrate`" — as duas ao mesmo tempo, sobre o mesmo erro. Quem lia
 * seguia a de baixo, reiniciava, e voltava ao mesmo lugar.
 *
 * A correção não é reescrever a frase de baixo. É não haver frase de baixo:
 * classificar é trabalho **desta** função, e quem precisa de um texto o pede
 * aqui. Uma recomendação contraditória deixa de ser improvável e passa a ser
 * irrepresentável — não existe segundo lugar no repositório onde escrever uma.
 *
 * `diagnosticar` é pura de propósito: recebe o que foi observado, devolve a
 * classificação, não toca em banco nem em relógio. É o que permite testar os
 * cinco estados sem um Postgres do lado, e é o que garante que a rota, o
 * `/healthz` e a linha de comando cheguem à mesma conclusão a partir dos
 * mesmos fatos.
 *
 * **Este módulo não importa nada.** Não é economia de linhas: é o que o mantém
 * carregável de qualquer lado — servidor, linha de comando, teste sem banco — e
 * o que impede que a autoridade de classificação ganhe um vizinho por
 * conveniência de dependência.
 */

/**
 * SQLSTATEs que dizem "isto que você quer criar já existe".
 *
 * Vocabulário do diagnóstico, e por isso mora aqui. A lista existia em duas
 * cópias literais — uma em `migrate.ts`, que ninguém usava, e outra no
 * `/api/healthz`, que era a viva. Nada garantia que andassem juntas.
 */
export const JA_EXISTE: ReadonlySet<string> = new Set([
  "42710", // duplicate_object — um tipo, uma constraint
  "42P07", // duplicate_table — tabela ou índice
  "42701", // duplicate_column
  "42P06", // duplicate_schema
]);

/**
 * Os cinco estados que importam.
 *
 * `MIGRATIONS_PENDENTES` e `MIGRATION_FALHOU` são deliberadamente distintos.
 * Os dois deixam telas quebradas, mas a pergunta seguinte é outra: no primeiro
 * caso ninguém rodou as migrations ainda, e rodá-las resolve; no segundo elas
 * rodaram e o banco recusou uma, e rodar de novo sem ler o motivo repete o
 * mesmo erro. Colapsá-los mandaria alguém repetir um comando que já falhou.
 */
export type EstadoDoBanco =
  /** Conectado, com todas as migrations deste build aplicadas. */
  | "SAUDAVEL"
  /** Faltam migrations, e ninguém tentou aplicá-las (ou a tentativa não falhou). */
  | "MIGRATIONS_PENDENTES"
  /** O schema existe e o registro dele sumiu: a fila trava na primeira. */
  | "REGISTRO_PERDIDO"
  /** Uma migration rodou e o banco a recusou. */
  | "MIGRATION_FALHOU"
  /**
   * O registro diz que tudo rodou, e um objeto que as migrations criam não
   * está lá.
   *
   * Só é observável de dentro de uma consulta que acabou de falhar — nenhuma
   * contagem de migrations o revela, porque pela contagem está tudo em dia.
   * Apareceu num teste ponta a ponta: com a tabela do Book renomeada por fora,
   * a rota respondia "não tem onde guardar" e o diagnóstico respondia "nenhuma
   * ação é necessária", no mesmo corpo. Um estado que não existia produzia,
   * sozinho, o par contraditório que o resto deste módulo elimina.
   */
  | "SCHEMA_DIVERGENTE"
  /**
   * Um `bridge:down` entrou neste banco e o `bridge:up` correspondente não.
   *
   * É a **causa** mais comum de `SCHEMA_DIVERGENTE`, e é a única que o banco
   * consegue declarar em vez de deixar deduzir: o `down` grava um marcador
   * dentro da própria transação, e o `up` o limpa. Enquanto ele estiver lá,
   * faltam no schema objetos que as migrations criam — e a fila não os repõe,
   * porque o registro já as dá por aplicadas.
   *
   * Separado de `SCHEMA_DIVERGENTE` porque a pergunta seguinte é outra e a
   * resposta é melhor: lá é "compare o schema e descubra o que houve", aqui é
   * "rode `bridge:up`". Colapsá-los mandaria alguém investigar um estado que o
   * banco sabe nomear.
   */
  | "BRIDGE_PENDENTE"
  /** Não dá para saber: a variável não chegou, ou o banco não respondeu. */
  | "INDISPONIVEL";

/**
 * O que resolve, como dado e não como frase.
 *
 * O `codigo` existe para que a interface possa decidir sem interpretar texto —
 * destacar um comando, oferecer um botão, agrupar ocorrências. O `texto` é para
 * ler. Depender só da frase foi o que permitiu que duas frases diferentes
 * convivessem: comparar strings ninguém faz, comparar códigos o compilador faz.
 */
export type CodigoDeAcao =
  | "APLICAR_MIGRATIONS"
  | "ADOTAR_MIGRATIONS"
  | "INVESTIGAR_FALHA"
  | "CONFERIR_SCHEMA"
  | "CONCLUIR_BRIDGE"
  | "CONFIGURAR_DATABASE_URL"
  | "RESTABELECER_BANCO";

export interface Acao {
  codigo: CodigoDeAcao;
  /** A frase imperativa, para quem vai agir. */
  texto: string;
  /**
   * O comando exato, quando existe um que resolve.
   *
   * Ausente não é esquecimento: em `INVESTIGAR_FALHA` não há comando porque
   * repetir a migration antes de saber por que o banco a recusou é justamente
   * o que não funciona.
   */
  comando?: string;
  /**
   * De quem é a ação.
   *
   * `plataforma` é o que responde "nenhuma ação sua é necessária" sem mentir:
   * há o que fazer, mas não por quem está olhando a tela.
   */
  quem: "operador" | "plataforma";
}

/** Os dados correm risco? Respondido sempre, nunca deixado para dedução. */
export interface RiscoAosDados {
  emRisco: boolean;
  texto: string;
}

export interface Diagnostico {
  estado: EstadoDoBanco;
  /** O que aconteceu, em uma ou duas frases. */
  resumo: string;
  risco: RiscoAosDados;
  /** O que resolve. `null` quando não há nada a fazer — ver `SAUDAVEL`. */
  acao: Acao | null;
  /**
   * O detalhe verificável: quais migrations faltam, onde parou, qual SQLSTATE.
   *
   * Sai separado do `resumo` porque tem público diferente — quem opera lê o
   * resumo, quem investiga lê isto — e porque nunca carrega mensagem de driver,
   * que traz host e usuário e vaza por um endpoint público.
   */
  evidencia?: string;
}

/**
 * O diagnóstico como uma frase só.
 *
 * Existe para que a composição também tenha um dono: enquanto cada consumidor
 * montava o seu texto, o `/healthz` respondia uma coisa, a rota outra, e as
 * duas apareciam juntas na tela. Quem quer o texto corrido — a linha de
 * comando, o corpo de um 503 lido por `curl`, o log — chama isto. Quem quer
 * montar a própria apresentação usa os campos e continua dizendo o mesmo,
 * porque a autoridade sobre o conteúdo continua sendo `diagnosticar`.
 */
export function textoDoDiagnostico(diagnostico: Diagnostico): string {
  const acao = diagnostico.acao;
  return [
    diagnostico.resumo,
    diagnostico.risco.texto,
    acao === null
      ? "Nenhuma ação é necessária."
      : acao.comando
        ? `${acao.texto} Comando: \`${acao.comando}\`.`
        : acao.texto,
  ].join(" ");
}

/** O que se observou do banco, que é tudo de que a classificação precisa. */
export interface EstadoObservado {
  /** A `DATABASE_URL` chegou ao processo. Nunca dizemos o que tem dentro. */
  configurada: boolean;
  /** Deu para conectar com ela. */
  alcancavel: boolean;
  /** O código do erro de conexão, quando não deu. */
  codigoDeConexao?: string;
  /** As migrations que este build carrega e o banco não tem, na ordem. */
  pendentes: string[];
  /** Quantas o banco tem registradas. */
  aplicadas: number;
  /**
   * O schema existe neste banco — há objeto das migrations lá dentro.
   *
   * Junto com `aplicadas === 0`, é a evidência **mais forte e mais cedo** do
   * registro perdido: um banco genuinamente novo não tem schema nenhum, então
   * "tem schema e não tem registro" já é conclusivo, sem precisar esperar uma
   * migration falhar para provar.
   *
   * A diferença aparece numa janela real: registro apagado, servidor recém
   * subido, nenhuma tentativa de migrar ainda. Sem isto, o diagnóstico
   * recomendava `migrate` — que naquele banco falha por duplicata, que é
   * exatamente o conselho inútil que este módulo existe para não dar.
   */
  temSchema?: boolean;
  /** Onde a última tentativa deste processo parou, se parou. */
  falha?: { tag: string; code?: string };
  /**
   * Uma consulta acabou de falhar por objeto de schema inexistente.
   *
   * É observação, e não conclusão: quem preenche isto é a rota que levou o
   * erro do banco na mão, e ela não decide o que ele significa. Com migrations
   * pendentes, elas explicam a ausência e nada muda; sem nenhuma pendente, é a
   * única evidência possível de que o registro e o banco divergiram.
   */
  objetoAusenteAgora?: boolean;
  /**
   * O banco declara um `bridge:down` sem o `up` correspondente.
   *
   * É o único sinal desta lista que não é dedução nem sintoma: quem o escreve é
   * o próprio `bridgeDown`, dentro da transação dele, e quem o apaga é o
   * `bridgeUp`. Por isso ele decide antes de todos os outros — quando existe,
   * não há o que inferir.
   */
  bridgePendente?: { desde?: string };
}

/**
 * A assinatura do registro perdido.
 *
 * É inconfundível, e cada uma das três condições exclui um caso vizinho:
 *
 * - **nada aplicado** — o registro está vazio. Um banco a que só faltam as
 *   últimas migrations tem as anteriores registradas.
 * - **parou na primeira que falta** — a fila nem saiu do lugar. Ter parado no
 *   meio é outra história, com outra causa.
 * - **parou por duplicata** — o banco recusou porque o objeto já existe. Um
 *   banco genuinamente novo não tem objeto nenhum, e a `0000` entra limpa.
 *
 * As três juntas só acontecem quando o schema está lá e o registro dele não —
 * dump restaurado sem o schema `drizzle`, banco recriado à mão, `DATABASE_URL`
 * apontada para outro lugar.
 */
function registroPerdido(estado: EstadoObservado): boolean {
  const { aplicadas, falha, pendentes, temSchema } = estado;
  if (aplicadas !== 0) return false;

  /*
    O caminho direto: o banco tem schema e o registro está vazio. Não precisa
    de mais nada — um banco novo não tem objeto nenhum, e a `0000` entraria
    limpa nele. Quem observa o banco (o servidor) consegue responder isto; quem
    só tem o relatório de uma execução (a linha de comando) não, e cai no
    caminho de baixo.
  */
  if (temSchema === true) return true;

  return (
    falha !== undefined &&
    falha.tag === pendentes[0] &&
    JA_EXISTE.has(falha.code ?? "")
  );
}

/** `0013_a, 0014_b e 0015_c` — a lista como se lê em voz alta. */
function listar(tags: string[]): string {
  if (tags.length <= 1) return tags.join("");
  return `${tags.slice(0, -1).join(", ")} e ${tags[tags.length - 1]}`;
}

function conexao(codigo: string | undefined): string {
  switch (codigo) {
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "A DATABASE_URL chegou ao processo, mas o banco não respondeu no endereço que ela aponta.";
    case "28P01":
    case "28000":
      return "O banco recusou as credenciais da DATABASE_URL que este processo recebeu.";
    case "3D000":
      return "A DATABASE_URL aponta para um banco que não existe.";
    default:
      return "A DATABASE_URL chegou ao processo, mas a conexão falhou.";
  }
}

/** Onde a tentativa parou, quando parou — sem a mensagem do driver. */
function ondeParou(falha: { tag: string; code?: string }): string {
  return (
    `A tentativa parou em ${falha.tag}` +
    (falha.code ? ` (SQLSTATE ${falha.code})` : "") +
    ". O log do servidor tem a mensagem inteira."
  );
}

/**
 * A única autoridade de classificação do repositório.
 *
 * A ordem dos ramos é o próprio critério, e não uma conveniência: não dá para
 * falar de migrations sem ter conseguido perguntar ao banco, e "faltam
 * migrations" só é dizível depois de saber que **faltam**. Cada `return` é um
 * estado, e nenhum estado tem dois textos possíveis.
 */
export function diagnosticar(estado: EstadoObservado): Diagnostico {
  if (!estado.configurada) {
    return {
      estado: "INDISPONIVEL",
      resumo:
        "Este processo não recebeu a DATABASE_URL. Toda tela que lê o banco " +
        "responde erro enquanto isso — e o banco pode estar perfeitamente " +
        "saudável: o que falta é a variável chegar até aqui.",
      risco: {
        emRisco: false,
        texto:
          "Nada foi gravado e nada se perdeu: sem a variável, este processo " +
          "não chegou a escrever no banco.",
      },
      acao: {
        codigo: "CONFIGURAR_DATABASE_URL",
        texto:
          "Entregar a DATABASE_URL ao processo publicado. Não é algo que se " +
          "resolva pela tela.",
        quem: "plataforma",
      },
    };
  }

  if (!estado.alcancavel) {
    return {
      estado: "INDISPONIVEL",
      resumo: conexao(estado.codigoDeConexao),
      risco: {
        emRisco: false,
        texto:
          "Nada foi gravado e nada se perdeu: a conexão não chegou a ser " +
          "estabelecida.",
      },
      acao: {
        codigo: "RESTABELECER_BANCO",
        texto:
          "Restabelecer o banco ou corrigir o endereço da DATABASE_URL. Não é " +
          "algo que se resolva pela tela.",
        quem: "plataforma",
      },
      ...(estado.codigoDeConexao
        ? { evidencia: `Código da falha de conexão: ${estado.codigoDeConexao}.` }
        : {}),
    };
  }

  /*
    O bridge decide antes de todo o resto, e não por gravidade: por ser o único
    sinal desta função que **não** é dedução. Os outros leem sintomas — uma
    contagem que não fecha, uma consulta que morreu — e concluem. Este é uma
    declaração que o `bridgeDown` deixou no banco, dentro da própria transação,
    e que só o `bridgeUp` apaga.

    Quando ele existe, a explicação de um objeto ausente já está dada, e mandar
    conferir o schema (ou pior, rodar migrations, que não repõem nada do que o
    bridge tirou) seria mandar investigar o que o banco acabou de dizer.
  */
  if (estado.bridgePendente) {
    return {
      estado: "BRIDGE_PENDENTE",
      resumo:
        "Este banco está no meio de um bridge de deploy: o `bridge:down` " +
        "entrou e o `bridge:up` correspondente não. Enquanto isso, faltam " +
        "objetos que as migrations criam — e rodar as migrations não os repõe, " +
        "porque o registro já as dá por aplicadas.",
      risco: {
        emRisco: false,
        texto:
          "Nenhum dado foi perdido: o bridge remove estrutura, nunca linha de " +
          "fato, e o que ele tira está inteiro nas migrations que o devolvem.",
      },
      acao: {
        codigo: "CONCLUIR_BRIDGE",
        texto:
          "Concluir o bridge, que é o que devolve os objetos removidos e " +
          "limpa este estado.",
        comando: "pnpm --filter @workspace/db run bridge:up",
        quem: "operador",
      },
      ...(estado.bridgePendente.desde
        ? { evidencia: `O bridge desceu em ${estado.bridgePendente.desde}.` }
        : {}),
    };
  }

  if (estado.pendentes.length === 0) {
    /*
      Nada pendente e, ainda assim, um objeto que as migrations criam não está
      lá. Pela contagem o banco está em dia — e é justamente por isso que este
      ramo precisa vir antes: sem ele, a resposta seria "nenhuma ação é
      necessária" ao lado de uma consulta que acabou de falhar por schema.
    */
    if (estado.objetoAusenteAgora) {
      return {
        estado: "SCHEMA_DIVERGENTE",
        resumo:
          "O registro diz que todas as migrations deste build rodaram, mas um " +
          "objeto que elas criam não existe neste banco. Ou o schema foi " +
          "alterado por fora das migrations, ou o registro foi preenchido sem " +
          "que elas rodassem.",
        risco: {
          emRisco: false,
          texto:
            "O que você enviou não chegou a ser gravado, e nada se perdeu. Os " +
            "dados já gravados não foram tocados — o que está inconsistente é " +
            "a estrutura.",
        },
        acao: {
          codigo: "CONFERIR_SCHEMA",
          texto:
            "Comparar o schema deste banco com o que as migrations criam. " +
            "Rodar as migrations não resolve: o registro já as dá por " +
            "aplicadas, e elas não serão tentadas de novo.",
          quem: "operador",
        },
        evidencia: `${estado.aplicadas} migrations registradas, e mesmo assim um objeto de schema falta.`,
      };
    }

    return {
      estado: "SAUDAVEL",
      resumo:
        "Conectado, com todas as migrations deste build aplicadas neste banco.",
      risco: { emRisco: false, texto: "Nada a conferir." },
      acao: null,
      evidencia: `${estado.aplicadas} migrations registradas.`,
    };
  }

  const quantas =
    estado.pendentes.length === 1
      ? "1 migration deste build não está aplicada"
      : `${estado.pendentes.length} migrations deste build não estão aplicadas`;
  const faltando = `${quantas} neste banco: ${listar(estado.pendentes)}.`;

  if (registroPerdido(estado)) {
    return {
      estado: "REGISTRO_PERDIDO",
      resumo:
        "Este banco tem o schema e não tem o registro dele. Por isso a fila " +
        "recomeça da primeira migration e esbarra em algo que já existe — e " +
        "vai parar no mesmo lugar a cada partida do servidor. Rodar as " +
        "migrations de novo falha igual.",
      risco: {
        emRisco: false,
        texto:
          "Nada se perdeu, e o que está gravado está íntegro: o schema está " +
          "inteiro. O que sumiu foi o registro de quais migrations já rodaram.",
      },
      acao: {
        codigo: "ADOTAR_MIGRATIONS",
        texto:
          "Declarar o que o banco já tem, para a fila voltar a andar. Reiniciar " +
          "o servidor não resolve.",
        comando: "pnpm --filter @workspace/db run migrate:adotar",
        quem: "operador",
      },
      /*
        A evidência muda conforme o que se sabe. Quando alguma tentativa já
        falhou, ela é a prova mais concreta e vai nomeada. Quando ainda não
        houve nenhuma — registro apagado, processo recém subido — o que
        sustenta a conclusão é o schema existir com o registro zerado, e é isso
        que precisa estar escrito, em vez de uma frase sobre uma tentativa que
        não aconteceu.
      */
      evidencia: estado.falha
        ? `${faltando} ${ondeParou(estado.falha)}`
        : `${faltando} O banco tem objetos das migrations e o registro delas está vazio.`,
    };
  }

  if (estado.falha) {
    return {
      estado: "MIGRATION_FALHOU",
      resumo:
        `A migration ${estado.falha.tag} foi recusada pelo banco. As ` +
        "anteriores ficaram aplicadas; as seguintes não chegaram a ser " +
        "tentadas, porque quase sempre dependem dela.",
      risco: {
        emRisco: false,
        texto:
          "Cada migration é uma transação: a que falhou não entrou pela " +
          "metade. O que já estava gravado continua íntegro.",
      },
      acao: {
        codigo: "INVESTIGAR_FALHA",
        texto:
          "Ler no log do servidor a mensagem que o banco devolveu. Repetir a " +
          "migration antes de saber por que ela foi recusada dá no mesmo erro.",
        quem: "operador",
      },
      evidencia: `${faltando} ${ondeParou(estado.falha)}`,
    };
  }

  return {
    estado: "MIGRATIONS_PENDENTES",
    resumo:
      `Conectado, mas ${faltando} As telas que dependem ` +
      `${estado.pendentes.length === 1 ? "dela respondem erro até que ela rode" : "delas respondem erro até que rodem"}.`,
    risco: {
      emRisco: false,
      texto:
        "Nada se perdeu: o que falta é estrutura, e o que já está gravado " +
        "continua íntegro.",
    },
    acao: {
      codigo: "APLICAR_MIGRATIONS",
      texto: "Aplicar as migrations que faltam.",
      comando: "pnpm --filter @workspace/db run migrate",
      quem: "operador",
    },
    evidencia: faltando,
  };
}
