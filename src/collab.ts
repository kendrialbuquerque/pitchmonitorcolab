import { createClient, RealtimeChannel } from '@supabase/supabase-js';

export type SharedPitch = {
  participantId: string;
  name: string;
  color: string;
  t: number;
  midi: number;
  clarity: number;
  note: string;
};

export type PeerSignal = {
  from: string;
  to: string;
  kind: 'offer' | 'answer' | 'ice';
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
};

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const realtimeEnabled = Boolean(url && anon);
const supabase = realtimeEnabled ? createClient(url!, anon!) : null;

export class CollabRoom {
  private channel: RealtimeChannel | null = null;
  constructor(private roomId: string) {}

  async connect(options: {
    participantId: string;
    name: string;
    color: string;
    onPitch: (data: SharedPitch) => void;
    onSignal: (signal: PeerSignal) => void;
    onPresence: (participants: Record<string, { name: string; color: string }>) => void;
  }) {
    if (!supabase) return;

    this.channel = supabase.channel(`pitch-room:${this.roomId}`, {
      config: { presence: { key: options.participantId }, broadcast: { self: false } },
    });

    this.channel
      .on('broadcast', { event: 'pitch' }, ({ payload }) => options.onPitch(payload as SharedPitch))
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const signal = payload as PeerSignal;
        if (signal.to === options.participantId) options.onSignal(signal);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel?.presenceState() ?? {};
        const participants: Record<string, { name: string; color: string }> = {};
        for (const [id, entries] of Object.entries(state)) {
          const entry = (entries as Array<any>)[0];
          if (entry) participants[id] = { name: entry.name ?? 'Participante', color: entry.color ?? '#38bdf8' };
        }
        options.onPresence(participants);
      });

    await this.channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await this.channel?.track({ name: options.name, color: options.color, joinedAt: Date.now() });
      }
    });
  }

  async sendPitch(data: SharedPitch) {
    await this.channel?.send({ type: 'broadcast', event: 'pitch', payload: data });
  }

  async sendSignal(signal: PeerSignal) {
    await this.channel?.send({ type: 'broadcast', event: 'signal', payload: signal });
  }

  async disconnect() {
    if (this.channel) await supabase?.removeChannel(this.channel);
    this.channel = null;
  }
}
