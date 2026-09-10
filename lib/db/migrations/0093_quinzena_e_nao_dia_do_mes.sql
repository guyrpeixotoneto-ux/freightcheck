-- ---------------------------------------------------------------------------
-- A VIGÊNCIA É QUINZENA, E A 2ª COMEÇA NO DIA 16 — NÃO NO DIA 2
-- ---------------------------------------------------------------------------
--
-- O rótulo da fonte é `<CANAL>_<QUINZENA>_<MÊS>_<ANO>`. `lib/ingest` o lia como
-- `<CANAL>_<DIA>_<MÊS>_<ANO>` desde que existe, e a leitura errada sobreviveu
-- porque é indistinguível da certa nos dois únicos valores que o campo toma:
-- `EMPURRADA_1_8_2026` virava `2026-08-01`, que está certo por acidente, e
-- `EMPURRADA_2_8_2026` virava `2026-08-02`, que está errado por quinze dias.
--
-- Nada quebrou. As duas vigências de um mês continuaram com duas datas
-- distintas, na ordem certa, e o produto inteiro funcionou em cima disso. O
-- erro só aparecia no que as telas **diziam**: o seletor escrevia
-- "agosto/2026 · dia 02" para uma quinzena que começa no dia 16, e
-- `rotuloDaVigencia` nunca alcançava o ramo `1ª/2ª quinzena` — as duas datas
-- caíam na primeira metade do mês, e a ordinal teria escrito "1ª quinzena"
-- duas vezes.
--
-- O parser foi corrigido: quinzena 1 → dia 01, quinzena 2 → dia 16. Esta
-- migration move o que já foi importado para a mesma régua, porque as duas
-- coisas não podem discordar: `effective_date` é componente da chave de
-- negócio do snapshot, e uma reimportação da mesma vigência passaria a
-- calcular uma chave que não encontra a linha que já existe — o produto
-- gravaria a vigência duas vezes, em duas datas, sem que nada acusasse.
--
-- ---------------------------------------------------------------------------
-- De onde sai o "de → para"
-- ---------------------------------------------------------------------------
--
-- Do **rótulo**, e não do dia gravado. `snapshot.source_label` é a string da
-- fonte, guardada literal justamente para casos assim: é ela que diz qual
-- quinzena a vigência é, sem depender da leitura que estava errada. Um dia 02
-- que não venha de um rótulo de 2ª quinzena não é movido.
--
-- As demais tabelas não têm rótulo — só a data. Elas se movem pelo mapa que o
-- snapshot produz: uma data só muda se for exatamente a data de uma vigência
-- que está mudando. É o que impede um `2026-08-02` de outra natureza de ser
-- arrastado junto.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Por que tudo isto é UM comando só
-- ---------------------------------------------------------------------------
--
-- O runner desta casa aplica cada migration numa transação, mas ele não é o
-- único a executá-las: várias provas replicam a fila disparando `statements`
-- um a um, em autocommit e por um pool — conexões possivelmente diferentes a
-- cada comando. Um mapa em tabela temporária evapora entre dois comandos assim,
-- e a suspensão do gatilho de imutabilidade não sobrevive ao fim do primeiro
-- deles — pior: em autocommit, um `ALTER TABLE … DISABLE TRIGGER` solto comita
-- sozinho, e um erro no comando seguinte deixaria a tabela **sem** a proteção.
-- A correção rodaria pela metade, ou esbarraria no gatilho, ou o desligaria em
-- definitivo, conforme quem a executasse.
--
-- Um bloco `DO` é um comando. Ele carrega o próprio escopo transacional em
-- qualquer um dos dois modos, e é o que torna esta migration a mesma coisa
-- para todos os caminhos que a executam.
-- ---------------------------------------------------------------------------

DO $migracao$
DECLARE
  fora           int;
  ambiguas       int;
  colisoes       int;
  tocadas        int;
  tinha_gatilho  boolean;
BEGIN
  CREATE TEMP TABLE quinzena_remapeada ON COMMIT DROP AS
  SELECT DISTINCT
    s.effective_date AS de,
    make_date(
      split_part(s.source_label, '_', array_length(string_to_array(s.source_label, '_'), 1))::int,
      split_part(s.source_label, '_', array_length(string_to_array(s.source_label, '_'), 1) - 1)::int,
      16
    ) AS para
  FROM snapshot s
  WHERE s.source_label ~ '_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$'
    -- A quinzena é o antepenúltimo grupo. `02` e `2` são a mesma quinzena: a
    -- fonte já escreveu das duas formas, e a comparação é numérica por isso.
    AND split_part(
          s.source_label, '_',
          array_length(string_to_array(s.source_label, '_'), 1) - 2
        )::int = 2
    -- Só o que está no dia 2 se move. Uma 2ª quinzena já gravada no dia 16 fica
    -- de fora e a migration segue: assim ela é reexecutável, e um banco em que
    -- ela já rodou não é reescrito nem tratado como erro.
    AND extract(day FROM s.effective_date) = 2;

  -- Uma vigência de 2ª quinzena num dia que não é nem o 2 (o erro) nem o 16 (a
  -- correção) não é deste caso, e mover uma data que está em outro lugar seria
  -- inventar um segundo bug em cima do primeiro. A migration para, em vez de
  -- adivinhar.
  SELECT count(*) INTO fora
  FROM snapshot s
  WHERE s.source_label ~ '_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$'
    AND split_part(
          s.source_label, '_',
          array_length(string_to_array(s.source_label, '_'), 1) - 2
        )::int = 2
    AND extract(day FROM s.effective_date) NOT IN (2, 16);

  IF fora > 0 THEN
    RAISE EXCEPTION
      'Há % vigências de 2ª quinzena cuja data gravada não é nem o dia 2 nem o dia 16; a correção não vai adivinhar qual delas é qual.',
      fora;
  END IF;

  -- O mês e o ano do destino saem do rótulo; o dia de origem sai da coluna. Se
  -- os dois discordassem, uma mesma data de origem apontaria para dois destinos
  -- e o UPDATE escolheria um deles ao acaso.
  SELECT count(*) INTO ambiguas
  FROM (SELECT de FROM quinzena_remapeada GROUP BY de HAVING count(*) > 1) x;

  IF ambiguas > 0 THEN
    RAISE EXCEPTION
      '% data(s) de origem apontam para mais de um destino — o rótulo e a coluna discordam sobre o mês ou o ano da vigência.',
      ambiguas;
  END IF;

  -- Mover a data mudaria a chave de negócio para uma que já existe apenas se
  -- alguém já tivesse gravado a mesma vigência no dia 16 — o que nenhuma versão
  -- deste código sabia fazer. A conferência fica porque é barata e porque o
  -- índice único falharia no meio do UPDATE, sem dizer o motivo.
  SELECT count(*) INTO colisoes
  FROM snapshot s
  JOIN quinzena_remapeada m ON m.de = s.effective_date
  JOIN snapshot outro
    ON outro.source_system   = s.source_system
   AND outro.dataset_family  = s.dataset_family
   AND outro.canal           IS NOT DISTINCT FROM s.canal
   AND outro.canonical_scope = s.canonical_scope
   AND outro.effective_date  = m.para
   AND outro.id <> s.id;

  IF colisoes > 0 THEN
    RAISE EXCEPTION
      'Mover a 2ª quinzena para o dia 16 colidiria com % snapshot(s) que já ocupam essa data no mesmo escopo.',
      colisoes;
  END IF;

  -- O gatilho de imutabilidade recusa qualquer alteração num snapshot CLOSED, e
  -- é ele que garante que uma vigência fechada não seja reescrita por engano.
  -- Aqui a reescrita é o objetivo, e o gatilho é suspenso só em volta do UPDATE
  -- que precisa dele suspenso.
  --
  -- **Por que não `session_replication_role`.** Era assim que esta migration
  -- fazia, e foi por isso que ela foi recusada em produção: o parâmetro exige
  -- superusuário, e o papel com que este produto abre conexão não é um. A fila
  -- parou aqui com `SQLSTATE 42501` — permission denied to set parameter
  -- "session_replication_role" — e as telas que dependem da 0093 passaram a
  -- responder erro. As 92 migrations anteriores nunca esbarraram nisso porque
  -- nenhuma delas usou o parâmetro: quem precisou reescrever linha protegida
  -- (`0009`, `0015`, `0016`, `0055`, `0061`, `0063`) desligou o gatilho pelo
  -- nome, que é direito de dono de tabela e não de superusuário.
  --
  -- O caminho estreito também é o mais correto pelo que **não** desliga.
  -- `session_replication_role = 'replica'` suspende todos os gatilhos da sessão,
  -- e junto com eles as checagens de integridade referencial. Nenhuma delas
  -- atrapalhava esta migration — não há chave estrangeira sobre `effective_date`
  -- em tabela nenhuma —, então elas estavam sendo desligadas à toa.
  --
  -- O par é seguro sem `EXCEPTION`: o bloco é um comando só, então qualquer erro
  -- entre as duas linhas desfaz a transação inteira, e o gatilho volta com ela.
  --
  -- A guarda por existência é a mesma da `0063`, e pela mesma razão: este
  -- comando roda em bancos de qualquer procedência, inclusive um que o bridge
  -- tenha deixado sem o gatilho. Desligar o que não está lá é `42704` — outra
  -- migration recusada, pela outra ponta do mesmo descuido.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'snapshot' AND t.tgname = 'snapshot_immutable'
  ) INTO tinha_gatilho;

  IF tinha_gatilho THEN
    ALTER TABLE "snapshot" DISABLE TRIGGER "snapshot_immutable";
  END IF;

  UPDATE snapshot s
  SET effective_date = m.para
  FROM quinzena_remapeada m
  WHERE s.effective_date = m.de
    AND s.source_label ~ '_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$'
    AND split_part(
          s.source_label, '_',
          array_length(string_to_array(s.source_label, '_'), 1) - 2
        )::int = 2;

  IF tinha_gatilho THEN
    ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable";
  END IF;

  -- `entity_identifier.effective_from` é a data da vigência em que o
  -- identificador passou a valer — a promoção a copia de `effective_date`. Sem
  -- mover, uma placa passaria a existir no dia 2 de uma quinzena que começa no
  -- dia 16, e a janela de validade responderia por catorze dias que a vigência
  -- não cobre.
  UPDATE entity_identifier i
  SET effective_from = m.para
  FROM quinzena_remapeada m
  WHERE i.effective_from = m.de;

  UPDATE entity_identifier i
  SET effective_until = m.para
  FROM quinzena_remapeada m
  WHERE i.effective_until = m.de;

  -- A planilha de remuneração é preenchida **por vigência**: `effective_date` é
  -- a chave que a liga ao snapshot que ela remunera. Se as duas discordarem, a
  -- planilha da 2ª quinzena deixa de ser encontrada pela vigência que a pediu, e
  -- a tela abre vazia como se ninguém a tivesse preenchido.
  --
  -- O `EXISTS` confere contra o snapshot **já movido**: uma data igual à de uma
  -- vigência que mudou, na mesma unidade, é aquela vigência.
  UPDATE remuneracao_planilha p
  SET effective_date = m.para
  FROM quinzena_remapeada m
  WHERE p.effective_date = m.de
    AND EXISTS (
      SELECT 1 FROM snapshot s
      WHERE s.effective_date = m.para
        AND s.scope_hash = p.scope_hash
    );

  -- `vigencia_inicial` é a quinzena a partir da qual a unidade passou a ser
  -- preenchida — escolhida no mesmo seletor, e por isso com a mesma data errada.
  UPDATE remuneracao_unidade u
  SET vigencia_inicial = m.para
  FROM quinzena_remapeada m
  WHERE u.vigencia_inicial = m.de;

  -- `import_decision` **não** é movido, e isso é uma decisão, não um
  -- esquecimento. Ele é o log do que foi decidido em cada importação, e cada
  -- linha carrega, além da data, o `canonical_snapshot_key` calculado naquele
  -- momento — um hash que esta migration não tem como recalcular em SQL. Mover
  -- só a data deixaria a linha discordando de si mesma: uma data de 2ª quinzena
  -- ao lado de uma chave que fala do dia 2. Um log coerente sobre o que se
  -- acreditava é mais útil que um log meio corrigido — e quem responde pela
  -- verdade da vigência é `snapshot`, que acabou de ser acertado. O log guarda
  -- `source_label`, e é por ele que uma linha antiga se liga à vigência de hoje.

  -- As janelas de semântica são abertas por curadoria, e não pela importação: a
  -- data delas é decisão de quem curou, não derivação do rótulo. Não são movidas
  -- — mas uma janela que **termine** exatamente na data antiga passaria a
  -- excluir a vigência que cobria, então o caso é dito em voz alta em vez de
  -- descoberto depois.
  SELECT count(*) INTO tocadas
  FROM attribute_semantics a
  JOIN quinzena_remapeada m
    ON a.effective_from = m.de OR a.effective_until = m.de;

  IF tocadas > 0 THEN
    RAISE NOTICE
      'Atenção: % janela(s) de attribute_semantics começam ou terminam numa data de 2ª quinzena que acabou de mudar. Elas não foram movidas — confira se ainda cobrem a vigência que deviam cobrir.',
      tocadas;
  END IF;

  -- Em autocommit a transação implícita acaba aqui e a temporária vai junto; em
  -- transação, ela cai no COMMIT. O DROP explícito é o que torna o bloco
  -- reexecutável na **mesma** transação, onde o `ON COMMIT DROP` ainda não
  -- chegou a valer e um segundo CREATE esbarraria na tabela do primeiro.
  DROP TABLE quinzena_remapeada;
END
$migracao$;
