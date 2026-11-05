import type { Store, Room, Player, Conn, Phase } from '../lambda/types.js';

export class MemStore implements Store {
  rooms = new Map<string, Room>();
  players = new Map<string, Map<string, Player>>();
  conns = new Map<string, Conn>();

  async getRoom(code: string) { return clone(this.rooms.get(code) ?? null); }
  async putRoom(room: Room) { this.rooms.set(room.code, clone(room)); }
  async updateRoom(code: string, patch: Partial<Room>, expect?: { phase: Phase; qIndex: number }) {
    const r = this.rooms.get(code);
    if (!r) return false;
    if (expect && (r.phase !== expect.phase || r.qIndex !== expect.qIndex)) return false;
    Object.assign(r, clone(patch));
    return true;
  }
  async listPlayers(code: string) { return [...(this.players.get(code)?.values() ?? [])].map((p) => clone(p)); }
  async getPlayer(code: string, id: string) { return clone(this.players.get(code)?.get(id) ?? null); }
  async putPlayer(p: Player) {
    if (!this.players.has(p.room)) this.players.set(p.room, new Map());
    this.players.get(p.room)!.set(p.id, clone(p));
  }
  async updatePlayer(code: string, id: string, patch: Partial<Player>) {
    const p = this.players.get(code)?.get(id);
    if (p) Object.assign(p, clone(patch));
  }
  async getConn(id: string) { return clone(this.conns.get(id) ?? null); }
  async putConn(c: Conn) { this.conns.set(c.id, clone(c)); }
  async deleteConn(id: string) { this.conns.delete(id); }
}

const clone = <T>(v: T): T => (v === null ? v : JSON.parse(JSON.stringify(v)));
