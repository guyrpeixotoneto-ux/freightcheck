// O CONTRATO DO PAR DO PANORAMA — uma ponta por gesto, fora do DOM.
//
// O que se prende aqui é a regra que o defeito de 17/09/2026 quebrava: **Para**
// é a vigência de referência que se está analisando, **De** é a origem contra a
// qual se quer compará-la, e mexer numa não recalcula a outra. Antes mexia — o
// De reancorava o par inteiro e o Para ia atrás —, e o teste que existia neste
// arquivo prendia justamente o arrasto ("arrasta a outra ponta para a vizinha
// seguinte"). Ele saiu com ele.
//
// O resto é o que o endereço guarda: o par canônico não escreve `?base=` (é a
// mesma chave de cache do Impacto Apurado e do Dashboard), todo o resto escreve,
// e o que está escrito é honrado — inclusive salteado, que era descartado em
// silêncio.
import { describe, expect, it } from "vitest";

import {
  anteriorDe,
  aoEscolherDe,
  aoEscolherPara,
  aoInverter,
  consultaDoPar,
  baseNoEndereco,
  parEmTela,
  posteriorA,
} from "../par-do-panorama";

/* Quatro quinzenas, com o intervalo do defeito relatado no meio. */
const JUN = "2026-06-16";
const JUL = "2026-07-16";
const AGO = "2026-08-16";
const SET = "2026-09-01";
const DATAS = [JUN, JUL, AGO, SET];

/** O par que a tela tem aberto quando se lê setembro do jeito de sempre. */
const EM_SETEMBRO = parEmTela(DATAS, { para: SET, de: null });

describe("as vizinhas de uma vigência", () => {
  it("são a anterior e a posterior da lista, e nada além das bordas", () => {
    expect(anteriorDe(DATAS, AGO)).toBe(JUL);
    expect(posteriorA(DATAS, AGO)).toBe(SET);
    expect(anteriorDe(DATAS, JUN)).toBeNull();
    expect(posteriorA(DATAS, SET)).toBeNull();
  });
});

describe("o par de abertura", () => {
  it("sem `?base=`, é a anterior imediata: a leitura de sempre", () => {
    expect(EM_SETEMBRO).toEqual({
      de: AGO,
      para: SET,
      invertido: false,
      problema: null,
    });
  });

  /*
    A vigência mais antiga não tem anterior, e é a posterior que entra — a mesma
    convenção de `compativelMaisProxima`, que as auditorias de rubrica usam.

    Antes ela abria com o **De vazio** e sem frase nenhuma: era o que via quem
    clicasse na primeira barra do gráfico, ou abrisse um favorito daquela
    vigência. Escolhê-la no seletor Para, por outro caminho, montava o par — duas
    respostas para o mesmo destino.
  */
  it("na vigência mais antiga, a partida é a posterior — e o par se declara invertido", () => {
    expect(parEmTela(DATAS, { para: JUN, de: null })).toEqual({
      de: JUL,
      para: JUN,
      invertido: true,
      problema: null,
    });
  });

  it("na vigência mais recente, é a anterior — sem inversão nenhuma", () => {
    expect(parEmTela(DATAS, { para: SET, de: null }).de).toBe(AGO);
    expect(parEmTela(DATAS, { para: SET, de: null }).invertido).toBe(false);
  });

  it("com uma vigência só, não há par — e a frase diz o que falta", () => {
    const par = parEmTela([AGO], { para: AGO, de: null });
    expect(par.de).toBeNull();
    expect(par.problema?.codigo).toBe("SEM_SEGUNDA_VIGENCIA");
    expect(par.problema?.mensagem).toMatch(/uma vigência só no histórico/);
  });
});

describe("escolher no De", () => {
  /*
    O caso relatado, e o motivo deste arquivo existir: com setembro fixado no
    Para, escolher agosto no De punha **agosto** no Para.
  */
  it("Para setembro + De agosto mantém setembro no Para", () => {
    expect(aoEscolherDe(DATAS, EM_SETEMBRO, AGO)).toEqual({ period: SET, base: null });
  });

  /* E o mesmo vale salteado, que é o par que a trava do servidor recusava. */
  it("Para setembro + De junho mantém setembro no Para", () => {
    expect(aoEscolherDe(DATAS, EM_SETEMBRO, JUN)).toEqual({ period: SET, base: JUN });
  });

  it("Para setembro + De julho mantém setembro no Para", () => {
    expect(aoEscolherDe(DATAS, EM_SETEMBRO, JUL)).toEqual({ period: SET, base: JUL });
  });

  /*
    Escolher no De a vigência **mais recente que o Para** é montar a volta à mão,
    e ela é montada: o produto tem um botão que faz exatamente isso, e o seletor
    das auditorias de rubrica também a aceita. O que não acontece é o Para mudar
    de lugar para "consertar" a direção.
  */
  it("uma partida posterior à chegada monta a volta, sem mexer no Para", () => {
    const emAgosto = parEmTela(DATAS, { para: AGO, de: null });
    expect(aoEscolherDe(DATAS, emAgosto, SET)).toEqual({ period: AGO, base: SET });
    expect(parEmTela(DATAS, { para: AGO, de: SET }).invertido).toBe(true);
  });

  /*
    Escolher no De a mesma vigência do Para é a única escolha que não produz
    leitura — e ainda assim ela **fica**: o endereço a guarda e a tela diz por
    que não dá. Trocá-la por uma vizinha aqui seria repetir, num caso menor,
    exatamente o defeito que este arquivo fecha.
  */
  it("a mesma vigência dos dois lados fica onde foi posta, com a recusa escrita", () => {
    expect(aoEscolherDe(DATAS, EM_SETEMBRO, SET)).toEqual({ period: SET, base: SET });

    const par = parEmTela(DATAS, { para: SET, de: SET });
    expect(par).toMatchObject({ de: SET, para: SET, invertido: false });
    expect(par.problema?.codigo).toBe("MESMA_VIGENCIA");
    expect(par.problema?.mensagem).toMatch(/não se compara consigo mesma/);
  });
});

describe("escolher no Para", () => {
  it("trocar só o Para preserva o De escolhido", () => {
    const emSetembroDesdeJunho = parEmTela(DATAS, { para: SET, de: JUN });
    expect(aoEscolherPara(DATAS, emSetembroDesdeJunho, AGO)).toEqual({
      period: AGO,
      base: JUN,
    });
  });

  /*
    Quando o novo Para deixa o par canônico, `?base=` sai do endereço: é a mesma
    resposta da rota de sempre, e escrevê-lo seria uma segunda chave de cache
    para ela. O par em tela não muda — continua sendo julho→agosto.
  */
  it("quando o par vira o canônico, o endereço para de escrever `?base=`", () => {
    const emSetembroDesdeJulho = parEmTela(DATAS, { para: SET, de: JUL });
    expect(aoEscolherPara(DATAS, emSetembroDesdeJulho, AGO)).toEqual({
      period: AGO,
      base: null,
    });
    expect(parEmTela(DATAS, { para: AGO, de: null }).de).toBe(JUL);
  });

  it("escolher no Para a vigência que está no De deixa as duas, com a recusa escrita", () => {
    const emSetembroDesdeJunho = parEmTela(DATAS, { para: SET, de: JUN });
    expect(aoEscolherPara(DATAS, emSetembroDesdeJunho, JUN)).toEqual({
      period: JUN,
      base: JUN,
    });
    expect(parEmTela(DATAS, { para: JUN, de: JUN }).problema?.codigo).toBe(
      "MESMA_VIGENCIA",
    );
  });
});

describe("inverter", () => {
  it("troca as duas pontas de lado, e nada mais", () => {
    expect(aoInverter(DATAS, EM_SETEMBRO)).toEqual({ period: AGO, base: SET });
  });

  /* Inverter um par salteado continua sendo o par salteado, ao contrário. */
  it("inverte também o par salteado", () => {
    const salteado = parEmTela(DATAS, { para: SET, de: JUN });
    expect(aoInverter(DATAS, salteado)).toEqual({ period: JUN, base: SET });
  });

  /* Ir e voltar devolve exatamente o endereço de partida — inclusive o `?base=`
     que não estava lá. */
  it("inverter duas vezes volta ao endereço de origem", () => {
    const ida = aoInverter(DATAS, EM_SETEMBRO)!;
    const volta = parEmTela(DATAS, { para: ida.period, de: ida.base });
    expect(aoInverter(DATAS, volta)).toEqual({ period: SET, base: null });
  });

  it("sem par montado, não faz nada", () => {
    expect(aoInverter(DATAS, parEmTela([AGO], { para: AGO, de: null }))).toBeNull();
  });
});

describe("o endereço, e o que ele restaura", () => {
  /*
    O par salteado era **descartado**: `?base=` que não fosse vizinho do
    `?period=` caía no par natural, sem uma palavra. Quem recebia o link lia
    outro par do que quem o mandou.
  */
  it("restaura o par salteado exatamente como o link o descreve", () => {
    expect(parEmTela(DATAS, { para: SET, de: JUN })).toEqual({
      de: JUN,
      para: SET,
      invertido: false,
      problema: null,
    });
  });

  it("restaura a volta, e a declara", () => {
    expect(parEmTela(DATAS, { para: JUL, de: SET })).toEqual({
      de: SET,
      para: JUL,
      invertido: true,
      problema: null,
    });
  });

  /*
    Uma ponta que não é desta unidade — um link de outra unidade, ou de uma
    importação que saiu do ar. A escolha fica em tela com a frase ao lado; antes
    ela era trocada pela vizinha, e a tela respondia por um par que o link não
    pedia.
  */
  it("uma ponta fora do histórico da unidade é nomeada, não trocada", () => {
    const par = parEmTela(DATAS, { para: SET, de: "2025-01-01" });
    expect(par.de).toBe("2025-01-01");
    expect(par.para).toBe(SET);
    expect(par.problema?.codigo).toBe("FORA_DA_UNIDADE");
  });

  it("o par canônico não escreve `?base=`; todo o resto escreve", () => {
    expect(baseNoEndereco(DATAS, { para: SET, de: AGO })).toBeNull();
    expect(baseNoEndereco(DATAS, { para: SET, de: JUN })).toBe(JUN);
    expect(baseNoEndereco(DATAS, { para: JUL, de: SET })).toBe(SET);
  });

  it("a consulta do par leva o recorte da unidade, e não a vigência aberta", () => {
    const recorte = new URLSearchParams({
      period: AGO,
      scopeHash: "hash-pe",
      canal: "EMPURRADA",
    });
    const consulta = consultaDoPar(recorte, { de: JUN, para: SET });
    expect(consulta.get("scopeHash")).toBe("hash-pe");
    expect(consulta.get("canal")).toBe("EMPURRADA");
    expect(consulta.get("base")).toBe(JUN);
    expect(consulta.get("comparada")).toBe(SET);
    /* E nunca `de`/`para`: `?de=` é o recorte de janela do contexto do outro
       lado, e mandá-lo aqui recortaria a unidade em vez de nomear a ponta. */
    expect(consulta.get("de")).toBeNull();
    /* `period` não viaja: quem nomeia a chegada aqui é `para`, e mandar os dois
       deixaria o servidor com duas fontes para a mesma ponta. */
    expect(consulta.get("period")).toBeNull();
  });
});

/**
 * NENHUMA ALTERAÇÃO SILENCIOSA — a régua deste módulo, varrida.
 *
 * Cada gesto escreve **uma** ponta. Este bloco não olha para um caso: ele
 * percorre todos os pares possíveis do histórico e prende a invariante nos dois
 * sentidos, que é a única forma de um arrasto novo não entrar por uma borda que
 * ninguém lembrou de testar.
 */
describe("nenhuma ponta se mexe sozinha", () => {
  it("escolher no De nunca muda o Para — em nenhum par do histórico", () => {
    for (const para of DATAS) {
      for (const deAtual of [null, ...DATAS]) {
        const par = parEmTela(DATAS, { para, de: deAtual });
        if (par.para === null) continue;
        for (const escolhida of DATAS) {
          const destino = aoEscolherDe(DATAS, par, escolhida);
          expect(destino?.period).toBe(para);
          /* E a ponta que a pessoa clicou é a que fica no De. */
          expect(parEmTela(DATAS, { para: destino!.period, de: destino!.base }).de).toBe(
            escolhida,
          );
        }
      }
    }
  });

  it("escolher no Para nunca muda o De — em nenhum par do histórico", () => {
    for (const para of DATAS) {
      for (const deAtual of DATAS) {
        const par = parEmTela(DATAS, { para, de: deAtual });
        for (const escolhida of DATAS) {
          const destino = aoEscolherPara(DATAS, par, escolhida);
          expect(destino?.period).toBe(escolhida);
          expect(parEmTela(DATAS, { para: destino!.period, de: destino!.base }).de).toBe(
            deAtual,
          );
        }
      }
    }
  });
});
