import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Headphones, Mic, MicOff, Radio, Share2, Users, Volume2, VolumeX } from 'lucide-react';
import { CollabRoom, PeerSignal, SharedPitch, realtimeEnabled } from './collab';
import { detectPitch, midiToNote, PitchSample } from './pitch';

type Point = { t: number; midi: number; clarity: number };
type Track = { id: string; name: string; color: string; points: Point[] };

const COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#f59e0b', '#a78bfa', '#84cc16'];
const WINDOW_MS = 18_000;
const MIN_MIDI = 36;
const MAX_MIDI = 84;

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function roomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let room = params.get('room');
  if (!room) {
    room = Math.random().toString(36).slice(2, 8).toUpperCase();
    params.set('room', room);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }
  return room;
}

function PitchCanvas({ tracks }: { tracks: Track[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let width = 0;
    let height = 0;
    const pad = { left: 58, right: 22, top: 18, bottom: 30 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      width = Math.max(320, rect.width);
      height = Math.max(420, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const y = (midi: number) => pad.top + ((MAX_MIDI - midi) / (MAX_MIDI - MIN_MIDI)) * (height - pad.top - pad.bottom);
    const x = (t: number, now: number) => pad.left + ((t - (now - WINDOW_MS)) / WINDOW_MS) * (width - pad.left - pad.right);

    const draw = () => {
      const now = Date.now();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);

      for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
        const yy = y(midi);
        const pc = ((midi % 12) + 12) % 12;
        const isC = pc === 0;
        const natural = [0, 2, 4, 5, 7, 9, 11].includes(pc);
        ctx.strokeStyle = isC ? '#3f3f46' : natural ? '#27272a' : '#171719';
        ctx.lineWidth = isC ? 1.2 : 1;
        ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
        if (natural) {
          ctx.fillStyle = isC ? '#d4d4d8' : '#71717a';
          ctx.font = isC ? '700 10px Inter, sans-serif' : '500 9px Inter, sans-serif';
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(midiToNote(midi), pad.left - 9, yy);
        }
      }

      for (let secondsAgo = 0; secondsAgo <= 18; secondsAgo += 3) {
        const xx = x(now - secondsAgo * 1000, now);
        ctx.strokeStyle = '#18181b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xx, pad.top); ctx.lineTo(xx, height - pad.bottom); ctx.stroke();
        ctx.fillStyle = '#52525b'; ctx.font = '500 9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(secondsAgo === 0 ? 'agora' : `-${secondsAgo}s`, xx, height - pad.bottom + 8);
      }

      for (const track of tracksRef.current) {
        const pts = track.points.filter(p => p.t >= now - WINDOW_MS && p.t <= now + 300);
        if (pts.length < 2) continue;
        ctx.strokeStyle = track.color; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        let previous: Point | undefined;
        for (const p of pts) {
          const xx = x(p.t, now); const yy = y(p.midi);
          if (!previous || p.t - previous.t > 260 || Math.abs(p.midi - previous.midi) > 8) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
          previous = p;
        }
        ctx.stroke();
      }

      ctx.strokeStyle = '#fafafa'; ctx.globalAlpha = .28; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(width - pad.right, pad.top); ctx.lineTo(width - pad.right, height - pad.bottom); ctx.stroke(); ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="pitch-canvas" />;
}

export default function App() {
  const roomId = useMemo(roomFromUrl, []);
  const participantId = useMemo(makeId, []);
  const [name, setName] = useState(() => localStorage.getItem('pitch-name') || 'Kendri');
  const [color] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<PitchSample | null>(null);
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [participants, setParticipants] = useState<Record<string, { name: string; color: string }>>({});
  const [remoteAudio, setRemoteAudio] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState(realtimeEnabled ? 'Sala pronta' : 'Modo local — configure Supabase para colaboração');

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);
  const roomRef = useRef<CollabRoom | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const addPoint = useCallback((id: string, trackName: string, trackColor: string, point: Point) => {
    setTracks(prev => {
      const existing = prev[id] ?? { id, name: trackName, color: trackColor, points: [] };
      const cutoff = Date.now() - WINDOW_MS - 1500;
      return { ...prev, [id]: { ...existing, name: trackName, color: trackColor, points: [...existing.points.filter(p => p.t >= cutoff), point] } };
    });
  }, []);

  const ensurePeer = useCallback((peerId: string) => {
    let pc = peersRef.current.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const localStream = streamRef.current;
    if (localStream) localStream.getAudioTracks().forEach(track => pc!.addTrack(track, localStream));
    pc.onicecandidate = event => {
      if (event.candidate) roomRef.current?.sendSignal({ from: participantId, to: peerId, kind: 'ice', payload: event.candidate.toJSON() });
    };
    pc.ontrack = event => {
      const stream = event.streams[0];
      if (!stream) return;
      let audio = audioElsRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audioElsRef.current.set(peerId, audio);
      }
      audio.srcObject = stream;
      audio.muted = !remoteAudio;
      if (remoteAudio) audio.play().catch(() => undefined);
    };
    peersRef.current.set(peerId, pc);
    return pc;
  }, [participantId, remoteAudio]);

  const callPeer = useCallback(async (peerId: string) => {
    if (!streamRef.current || peerId === participantId) return;
    const pc = ensurePeer(peerId);
    if (pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await roomRef.current?.sendSignal({ from: participantId, to: peerId, kind: 'offer', payload: offer });
  }, [ensurePeer, participantId]);

  const handleSignal = useCallback(async (signal: PeerSignal) => {
    const pc = ensurePeer(signal.from);
    if (signal.kind === 'ice') {
      try { await pc.addIceCandidate(signal.payload as RTCIceCandidateInit); } catch { /* candidate may arrive early */ }
      return;
    }
    const description = signal.payload as RTCSessionDescriptionInit;
    if (signal.kind === 'offer') {
      await pc.setRemoteDescription(description);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await roomRef.current?.sendSignal({ from: participantId, to: signal.from, kind: 'answer', payload: answer });
    } else if (signal.kind === 'answer' && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(description);
    }
  }, [ensurePeer, participantId]);

  useEffect(() => {
    if (!realtimeEnabled) return;
    const room = new CollabRoom(roomId);
    roomRef.current = room;
    room.connect({
      participantId,
      name,
      color,
      onPitch: (data: SharedPitch) => addPoint(data.participantId, data.name, data.color, { t: data.t, midi: data.midi, clarity: data.clarity }),
      onSignal: signal => void handleSignal(signal),
      onPresence: next => {
        setParticipants(next);
        setStatus(`${Object.keys(next).length} participante(s) na sala`);
      },
    });
    return () => { void room.disconnect(); roomRef.current = null; };
  }, [roomId, participantId, name, color, addPoint, handleSignal]);

  useEffect(() => {
    for (const audio of audioElsRef.current.values()) {
      audio.muted = !remoteAudio;
      if (remoteAudio) audio.play().catch(() => undefined);
    }
  }, [remoteAudio]);

  useEffect(() => {
    if (!running || !realtimeEnabled) return;
    for (const peerId of Object.keys(participants)) {
      if (peerId !== participantId && participantId.localeCompare(peerId) < 0) void callPeer(peerId);
    }
  }, [participants, participantId, running, callPeer]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
    setRunning(false);
    setCurrent(null);
  }, []);

  const start = async () => {
    try {
      localStorage.setItem('pitch-name', name.trim() || 'Participante');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const context = new AudioContext({ latencyHint: 'interactive' });
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      context.createMediaStreamSource(stream).connect(analyser);
      streamRef.current = stream;
      audioContextRef.current = context;
      analyserRef.current = analyser;
      setRunning(true);
      setStatus(realtimeEnabled ? 'Microfone conectado' : 'Microfone conectado — modo local');

      const buffer = new Float32Array(analyser.fftSize);
      let lastUi = 0;
      const loop = () => {
        analyser.getFloatTimeDomainData(buffer);
        const pitch = detectPitch(buffer, context.sampleRate);
        const now = Date.now();
        if (pitch) {
          if (now - lastUi > 55) {
            lastUi = now;
            setCurrent(pitch);
            addPoint(participantId, name || 'Você', color, { t: now, midi: pitch.midi, clarity: pitch.clarity });
          }
          if (realtimeEnabled && now - lastSentRef.current > 90) {
            lastSentRef.current = now;
            roomRef.current?.sendPitch({ participantId, name: name || 'Participante', color, t: now, midi: pitch.midi, clarity: pitch.clarity, note: pitch.note });
          }
        } else if (now - lastUi > 120) {
          lastUi = now;
          setCurrent(null);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (error) {
      console.error(error);
      setStatus('Não foi possível acessar o microfone. Use HTTPS e permita o acesso.');
    }
  };

  useEffect(() => stop, [stop]);

  const shareUrl = window.location.href;
  const copyShare = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const visibleTracks = Object.values(tracks);
  const participantCount = realtimeEnabled ? Math.max(1, Object.keys(participants).length) : 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Radio size={19} /></div>
          <div><strong>Pitch Monitor</strong><span>COLLAB</span></div>
        </div>
        <div className="room-pill"><Users size={15} /> Sala <b>{roomId}</b> · {participantCount}</div>
        <button className="button ghost" onClick={copyShare}><Share2 size={16} /> {copied ? 'Link copiado' : 'Compartilhar sala'}</button>
      </header>

      <section className="workspace">
        <aside className="side-panel">
          <div className="panel-section">
            <label className="eyebrow">Participante</label>
            <input className="name-input" value={name} onChange={e => setName(e.target.value)} disabled={running} placeholder="Seu nome" />
          </div>

          <div className="pitch-readout">
            <span className="eyebrow">Afinação atual</span>
            <div className="note">{current?.note ?? '—'}</div>
            <div className="frequency">{current ? `${current.frequency.toFixed(1)} Hz` : 'aguardando voz'}</div>
            <div className={`cents ${current && Math.abs(current.cents) <= 12 ? 'good' : ''}`}>
              {current ? `${current.cents > 0 ? '+' : ''}${current.cents} cents` : '—'}
            </div>
          </div>

          <div className="panel-section">
            <span className="eyebrow">Linhas no gráfico</span>
            <div className="legend">
              {visibleTracks.length === 0 && <span className="muted">Nenhuma voz detectada ainda.</span>}
              {visibleTracks.map(track => <div className="legend-row" key={track.id}><i style={{ background: track.color }} /> <span>{track.id === participantId ? `${track.name} (você)` : track.name}</span></div>)}
            </div>
          </div>

          <div className="panel-section info-box">
            <span className="eyebrow">Status</span>
            <p>{status}</p>
          </div>
        </aside>

        <section className="monitor-card">
          <div className="monitor-head">
            <div><span className="eyebrow">Timeline de afinação</span><h1>Vozes em tempo real</h1></div>
            <div className={`live-badge ${running ? 'on' : ''}`}><span />{running ? 'capturando' : 'parado'}</div>
          </div>
          <PitchCanvas tracks={visibleTracks} />
          <div className="monitor-footer">
            <span>C2</span><span>Faixa exibida: C2–C6</span><span>C6</span>
          </div>
        </section>
      </section>

      <footer className="transport">
        <button className={`mic-button ${running ? 'active' : ''}`} onClick={() => running ? stop() : void start()}>
          {running ? <MicOff size={22} /> : <Mic size={22} />}
          {running ? 'Parar microfone' : 'Conectar microfone'}
        </button>
        <button className={`button ${remoteAudio ? 'active-secondary' : 'ghost'}`} onClick={() => setRemoteAudio(v => !v)} disabled={!realtimeEnabled}>
          {remoteAudio ? <Volume2 size={18} /> : <VolumeX size={18} />}
          {remoteAudio ? 'Áudio remoto ligado' : 'Ouvir participantes'}
        </button>
        <button className="button ghost" onClick={copyShare}><Copy size={17} /> Copiar link</button>
        <div className="transport-note"><Headphones size={15} /> Use fones para evitar microfonia ao ouvir participantes.</div>
      </footer>
    </main>
  );
}
