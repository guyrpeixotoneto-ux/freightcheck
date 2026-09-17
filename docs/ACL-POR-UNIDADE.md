# ACL por unidade — estrutura, medição e plano de corte

> Estado: **estrutura entregue, enforcement desligado.** Este documento é o que
> a decisão de ligar o bloqueio precisa ter na mão.

---

## 1. O modelo

A fronteira de autorização do FreightCheck é a **unidade**. Não há nível acima
dela: uma camada de empresa foi desenhada, implementada e **removida** por
decisão de produto — o produto organiza o mundo por unidade, e um nível acima só
para pendurar autorização seria uma dimensão que nenhuma tela usa e que toda
consulta teria de atravessar.

```
acesso_a_unidade
  user_id · unidade_id · nivel(VER|EDITAR) · concedido_por · criado_em
  UNIQUE (user_id, unidade_id)
```

Uma conta alcança as unidades que tiver linha aqui. Várias linhas, várias
unidades. **Nenhuma linha, nenhuma unidade.**

### Sem fallback, e por quê

As outras três camadas de permissão deste produto leem a ausência de linha como
concessão. Foi o certo lá — nasceram sobre um produto em uso, e o silêncio lido
como bloqueio teria sido apagão.

Aqui a regra é a inversa, e é deliberada: **ausência de concessão é ausência de
acesso**. Um fallback "sem cadastro, alcança tudo" transformaria falta de
configuração em autorização global; a tabela existiria, pareceria fronteira, e
não seria nenhuma. Quem precisa de todas as unidades — controladoria — recebe
todas explicitamente, com autor e data.

O preço é aritmético e está pago noutro lugar: num banco sem concessões, ligar o
corte deixa todo mundo sem nada. É por isso que o corte **não** acompanha a
migration. A ordem é: estrutura → medição → concessões cadastradas → corte.

### `app_user.unidade_id` não participa

É lotação, e `schema/auth.ts` é explícito: *"misturar as duas coisas faria um
cadastro administrativo virar um portão de acesso silencioso"*. Ela pode
**sugerir** na tela de concessão — oferecer a unidade da pessoa já preenchida.
Sugerir não é conceder.

---

## 2. Como o escopo é calculado

```
escopoEfetivo(userId) → {
  unidadesPermitidas[]      // de acesso_a_unidade, e de mais nada
  scopeHashesPermitidos[]   // via remuneracao_unidade.unidade_id
  hashesSemUnidade[]        // acervo que nenhuma unidade reivindica
}

estreitar(escopo, pedido) → interseção
```

Resolvido uma vez por requisição, em middleware global sobre `/api`, entregue em
`req.escopo`. **O Assistente lê esse mesmo objeto** — não há segundo cálculo, e
é isso que impede a superfície que agrega de ter regra própria.

O `scopeHash` do cliente entra **só** em `estreitar`, e lá é interseção: ele
remove, nunca acrescenta. Pedido ausente devolve o conjunto autorizado, que pode
ser vazio — nunca "tudo o que existe".

### A terceira categoria

`SEM_VINCULO` é o acervo cujo `scope_hash` nenhuma unidade canônica reivindica.
**Não é liberado por conveniência.** Não entra em `scopeHashesPermitidos`, não
passa em `estreitar`, e no corte é recusado como qualquer outro. A categoria
existe para ser medida e resolvida — cada hash precisa ganhar vínculo ou exceção
escrita antes do corte.

---

## 3. Cobertura

**Medição do middleware: todas as rotas autenticadas sob `/api`.** Ele é global,
então nenhuma escapa da observação — inclusive rotas futuras.

**Aplicação do escopo no corte: 9 arquivos de rota**, os que aceitam `scopeHash`
e leem acervo:

| arquivo | |
| --- | --- |
| `changes.ts` · `balance.ts` · `composition.ts` · `coverage.ts` | acervo por recorte |
| `conciliacao-de-chamados.ts` · `frota.ts` · `justificativas.ts` · `remuneracao.ts` | idem |
| `assistant.ts` | a superfície que agrega |

`escopo.ts` também aceita `scopeHash` no sentido inverso — ela **mostra** o
escopo da sessão e não lê acervo nenhum.

**O que ainda escapa:** nenhuma rota escapa da medição; o que não existe ainda é
a **aplicação** — os 9 arquivos acima ainda não recusam nada, porque o corte
está desligado. Rota nova não nasce fora do mecanismo: o guard
`isolamento-cobre-as-rotas` cobra exceção escrita, e ele pegou `escopo.ts`
durante este trabalho.

---

## 4. A medição, no ambiente semeado

Colhida contra o servidor de pé, 11 requisições reais:

```
resumo: { nada: 0, recusaria: 1, reduziria: 10, indecidivel: 0,
          contasSemConcessao: 1 }
```

| rota | total | recusaria | reduziria |
| --- | ---: | ---: | ---: |
| `POST /assistant/ask` | 2 | **1** | 1 |
| `GET /changes` · `/contexts` · `/overview` · `/imports` · `/coverage` · `/parametros` · `/unidades/canonicas` | 1 cada | 0 | 1 cada |

O único `RECUSARIA` é a requisição em que mandei um `scopeHash` inventado — o
veredito correto. Todo o resto é `REDUZIRIA`, e por um motivo que é **o achado
principal desta medição**:

### MEDIÇÃO INCONCLUSIVA — por ausência de unidades canônicas

Rodando o procedimento somente-leitura (`scripts/diagnostico/escopo-em-producao.sql`)
contra o ambiente semeado:

| | |
| --- | ---: |
| unidades canônicas cadastradas | **0** |
| `scope_hash` distintos no acervo | 1 |
| hashes com vínculo a uma unidade | **0** |
| hashes sem vínculo | **1** (18 snapshots, vigência até 2026-08-01) |
| contas ativas | 1 |
| contas sem nenhuma concessão | **1** |

**O `SEM_VINCULO: 0` que o relatório HTTP devolveu não é evidência de
cobertura.** Ele vem de `remuneracao_unidade`, que é o *cadastro* — e o cadastro
está vazio. O acervo, lido de `snapshot`, tem um hash, e ele **não** está
vinculado a unidade nenhuma. Os dois números medem coisas diferentes, e ler o
primeiro como cobertura foi um erro de leitura que este parágrafo existe para
não deixar repetir.

Registre-se, então, com o nome certo: **medição inconclusiva por ausência de
unidades canônicas.** Nada neste ambiente permite afirmar qualquer cobertura da
ponte acervo → fronteira.

A consequência é dura e precisa estar escrita: **enquanto não houver unidade
canônica cadastrada, ligar o corte bloqueia 100% das leituras de acervo, para
todo mundo.** Não é defeito do desenho — é o estado da curadoria, e é exatamente
o que a observação existe para revelar antes, e não depois.

**O número que decide é o de produção**, e colhê-lo é a primeira pré-condição
do corte. Ver §6.

---

## 5. Matriz de acessos proposta

Proposta de partida, a ser preenchida com o cadastro real antes do corte:

| perfil | unidades | como |
| --- | --- | --- |
| Analista de unidade | a dele | 1 linha, sugerida pela lotação |
| Analista multi-unidade | as que audita | N linhas, uma por unidade |
| Controladoria | todas | N linhas explícitas — **nunca** por ausência de cadastro |
| Administrador | todas | idem; `role: ADMIN` governa Administração, não acervo |
| Conta nova | nenhuma | até alguém conceder |

A controladoria é o caso que tenta puxar um atalho, e o teste
`controladoria consolida duas unidades — porque tem as duas concessões` existe
para travar isso: consolidar é a soma de concessões, não um privilégio.

**Nesta fase não existe atalho para a controladoria**: são N concessões
explícitas em `acesso_a_unidade`, uma por unidade. Nenhuma abstração
administrativa nova, nenhum acesso global implícito.

**Unidade nova não entra sozinha no acesso de ninguém — nem da controladoria.**
Cadastrar uma unidade e conceder acesso a ela são dois atos, e o segundo passa
por fluxo administrativo com autor e data, como qualquer concessão. Uma unidade
que se auto-concedesse a quem "vê tudo" faria o alcance crescer sem que ninguém
tivesse decidido, que é a forma silenciosa do mesmo problema que o fallback
global teria criado.

---

## 6. Medir em produção — procedimento somente leitura

`scripts/diagnostico/escopo-em-producao.sql`, rodado assim:

```bash
psql "$DATABASE_URL" -f scripts/diagnostico/escopo-em-producao.sql
```

**Riscos, por extenso.** Escrita é impossível: a sessão abre em
`SET TRANSACTION READ ONLY` e fecha em `ROLLBACK`, então o Postgres recusa
qualquer `INSERT`, `UPDATE`, `DELETE` ou DDL dentro dela. A carga é de
agregações sobre tabelas de cadastro — `unidade`, `app_user`,
`acesso_a_unidade`, `remuneracao_unidade`, `snapshot` —, nenhuma varre `fact`
nem `change`. Leitura não pega lock que atrapalhe escrita concorrente. A saída
traz e-mail de conta e nome de unidade: é material de administração, e não vai
para canal aberto.

**Evidências esperadas**, as seis que você pediu:

| # | pergunta | de onde sai |
| --- | --- | --- |
| 1 | total de unidades canônicas | consulta 1 |
| 2 | `scopeHash` distintos no acervo | consulta 2, de `snapshot` |
| 3 | hashes vinculados | consulta 3 |
| 4 | hashes sem vínculo, um a um | consulta 4, com canal e vigência |
| 5 | usuários e concessões atuais | consulta 5 |
| 6 | rotas e consultas que seriam bloqueadas | **não é pergunta de banco** — sai de `GET /api/escopo/observacao`, que mede tráfego real |

A ordem certa é cadastro primeiro, tráfego depois: sem saber quantas unidades
existem, o relatório de tráfego não tem como ser interpretado.

---

## 6b. Plano de corte

**Pré-condições, todas obrigatórias:**

1. Procedimento acima rodado **em produção**, com as seis evidências colhidas.
2. Unidades canônicas cadastradas — hoje o número medido é 0, e com ele o corte
   é apagão.
3. Hashes `SEM_VINCULO` = 0, ou cada um restante com exceção escrita, nomeada e
   auditável. Nenhum é liberado por conveniência.
4. `contasSemConcessao` = 0: toda conta ativa com a matriz da §5 preenchida.
5. Matriz revisada por quem responde pela operação.

**Ordem do corte**, rota a rota, nunca de uma vez:

1. `assistant.ts` — a que mais custa se vazar e a que menos telas quebra.
2. `changes.ts` e `coverage.ts` — o núcleo, com a medição na mão.
3. As demais, por volume crescente de `REDUZIRIA`.

Cada etapa vira `expect(403)` no caso-marcador de
`isolamento-por-unidade.test.ts`, que hoje é `expect(200)` e diz isso em voz
alta — a mudança de fase é uma linha visível num diff.

**Rollback:** o corte é uma condição no middleware, não uma migration. Desligar
é variável de ambiente, valendo no pedido seguinte, sem deploy e sem perda de
dado — as concessões continuam cadastradas. A estrutura nunca precisa ser
desfeita; o que se liga e desliga é a recusa.

---

## 7. Testes

**23 casos** em `routes/__tests__/isolamento-por-unidade.test.ts`, contra duas
unidades reais, dois hashes vinculados, um hash órfão e quatro contas:

| o que prova | |
| --- | --- |
| Unidade A não consulta Unidade B | ✔ nos dois sentidos |
| hash forjado | ✔ devolve vazio, não o pedido |
| hash omitido | ✔ entrega o autorizado, nunca fora dele |
| hash inventado | ✔ `FORA`, nem por acaso `DENTRO` |
| hash em lista | ✔ o legítimo não carrega o alheio |
| chamada direta à API | ✔ o parâmetro não entra no cálculo |
| o Assistente | ✔ mesmo objeto, e pedido no corpo não amplia |
| sem concessão, no corte | ✔ 403 |
| controladoria | ✔ só com concessões explícitas |
| `SEM_VINCULO` no corte | ✔ recusado para todas as contas |
| a fase atual | ✔ marcador que vira `expect(403)` no corte |

**Suítes completas:** `lib/db` 257/257 (bridge incluído), `lib/assistant`
735/735, permissões e isolamentos da API 139/139, typecheck limpo.

---

## 8. O bridge

A `0102` cria uma tabela e nenhuma coluna em tabela existente — foi o que
dissolveu o bloqueio da versão anterior, em que `app_user.empresa_id NOT NULL`
não cabia em `COLUNAS_REMOVIDAS` (todas aditivas e nulas).

O que foi ensinado ao bridge:

- `acesso_a_unidade` entra em `TABELAS_REMOVIDAS` **antes** de `unidade` — o
  `down` derruba com `RESTRICT`, e a mãe só sai depois da filha;
- o guard de dependências passa a esperá-la em `unidade`;
- o `up` a repõe **vazia**, com o DDL levantado da própria migration, e o bloco
  fica **depois** do de `unidade` — na subida, a mãe vem antes da filha;
- `papeis-deploy` ganha a tabela no conjunto de adições esperadas e o prefixo
  `acesso_a_unidade_` no filtro de constraints, porque nenhuma delas cai sobre
  tabela existente.
