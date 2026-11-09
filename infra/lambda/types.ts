export type Phase = 'lobby' | 'question' | 'reveal' | 'final';

export interface Room {
  code: string;
  phase: Phase;
  qIndex: number;          // -1 in the lobby
  endsAt: number | null;   // epoch ms the current question closes
  hostConn: string | null;
  hostToken: string;
  results: Results | null; // for the question being revealed
  createdAt: number;
}

export interface Player {
  room: string;
  id: string;
  name: string;
  tag: string;     // 1–2 graphemes shown on the disc
  color: string;   // hex from shared/avatar.js COLORS
  score: number;
  conn: string | null;
  x: number | null;
  y: number | null;
  placedQ: number | null;  // which question the position belongs to
  placedAt: number | null; // server time of the last move
  powers: Record<string, { round: number; q: number }>; // last use of each power-up
}

export interface Conn {
  id: string;
  room: string;
  role: 'host' | 'player';
  playerId?: string;
}

export interface PlayerResult {
  x: number;
  y: number;
  value: unknown;
  delta: number;
  correct: boolean;
  powers: string[];  // power-ups active on this question
  fastest?: boolean; // earned the speed bonus
}

export interface Results {
  qIndex: number;
  reveal: Record<string, unknown>;
  perPlayer: Record<string, PlayerResult | null>;
}

export interface Store {
  getRoom(code: string): Promise<Room | null>;
  putRoom(room: Room): Promise<void>;
  // Returns false if `expect` no longer matches (someone else moved the room on).
  updateRoom(code: string, patch: Partial<Room>, expect?: { phase: Phase; qIndex: number }): Promise<boolean>;
  listPlayers(code: string): Promise<Player[]>;
  getPlayer(code: string, id: string): Promise<Player | null>;
  putPlayer(p: Player): Promise<void>;
  updatePlayer(code: string, id: string, patch: Partial<Player>): Promise<void>;
  getConn(id: string): Promise<Conn | null>;
  putConn(c: Conn): Promise<void>;
  deleteConn(id: string): Promise<void>;
}

export interface Transport {
  // Resolves false when the connection is gone.
  send(connId: string, msg: object): Promise<boolean>;
  scheduleFinalize(code: string, qIndex: number, fireAt: number): Promise<void>;
}
