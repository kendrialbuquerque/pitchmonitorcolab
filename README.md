# Pitch Monitor Collab

Monitor de afinação vocal em tempo real, pensado para aulas de canto remotas. Cada participante detecta o próprio pitch no navegador e envia apenas dados leves de afinação para a sala; as linhas aparecem sobrepostas na mesma timeline. O áudio remoto usa WebRTC.

## O que já funciona

- acesso ao microfone pelo navegador;
- detecção de frequência, nota e cents;
- timeline contínua de aproximadamente 18 segundos;
- uma linha de cor diferente por participante;
- salas compartilháveis pela URL `?room=CODIGO`;
- presença e pitch remoto via Supabase Realtime;
- sinalização de áudio P2P via WebRTC;
- modo local quando Supabase não está configurado;
- interface responsiva para desktop e celular.

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse o endereço informado pelo Vite. `localhost` pode solicitar microfone normalmente. Em produção, o navegador exige HTTPS para `getUserMedia`.

## Ativar colaboração remota

1. Crie um projeto no Supabase.
2. Copie `.env.example` para `.env.local`.
3. Preencha:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON
```

O MVP usa canais Realtime Broadcast + Presence; nenhuma tabela SQL é necessária para a timeline ao vivo.

## Como usar

1. Abra a página e clique em **Conectar microfone**.
2. Clique em **Compartilhar sala**.
3. Envie a URL para o aluno ou outro participante.
4. A outra pessoa abre o link, informa o nome e conecta o microfone.
5. Cada voz aparece como uma linha no mesmo gráfico.
6. Para escutar o áudio remoto, use **Ouvir participantes** e prefira fones de ouvido.

## Arquitetura

- `src/pitch.ts`: detecção local do pitch por autocorrelação normalizada.
- `src/collab.ts`: sala Supabase Realtime, Presence, Broadcast e sinalização WebRTC.
- `src/App.tsx`: captura do microfone, timeline, presença e peers WebRTC.
- `src/styles.css`: interface.

A detecção de pitch ocorre localmente. Isso evita enviar áudio ao servidor apenas para desenhar a curva e reduz banda e latência. Para até poucos participantes, o áudio P2P em malha WebRTC é suficiente para protótipo. Para turmas maiores, o caminho correto é migrar áudio para um SFU como LiveKit, Daily ou mediasoup.

## Limitações atuais do MVP

- algoritmo monofônico: funciona melhor com uma voz por microfone e pouco acompanhamento musical;
- o pitch pode saltar de oitava em ruído, vibrato intenso ou sinal muito fraco;
- WebRTC P2P tende a escalar mal acima de poucos participantes;
- apenas STUN público está configurado; redes corporativas/restritas podem exigir TURN;
- ainda não há gravação, login, histórico de aulas ou controle professor/aluno;
- sincronização visual usa relógio local dos dispositivos; uma etapa futura deve estimar offset entre clientes para comparação temporal mais precisa.

## Próximos passos recomendados

1. adicionar suavização de pitch e filtro de saltos de oitava;
2. criar modo **Professor**, com solo/mute das linhas dos alunos;
3. adicionar zoom vertical por tessitura e zoom horizontal da timeline;
4. registrar sessões para revisão pós-aula;
5. usar servidor TURN e, depois, SFU para áudio robusto;
6. adicionar metrônomo/nota de referência e regiões-alvo de afinação.

## Privacidade

O navegador sempre deve pedir autorização antes de usar o microfone. A aplicação não deve iniciar captura de áudio de forma oculta. Para uso real com alunos, inclua aviso claro de quando áudio estiver sendo transmitido ou gravado e obtenha consentimento adequado.
