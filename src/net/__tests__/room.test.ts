import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../engine/bot';
import { actorOf } from '../../engine/selectors';
import { MemoryBackend, MemoryStore } from '../memoryBackend';
import {
  GameFeed,
  ROOM_TTL_MS,
  botRunner,
  canStart,
  createRoom,
  hostSetSeat,
  joinRoom,
  leaveGame,
  leaveLobby,
  parseRoom,
  parseState,
  rematch,
  roomPath,
  sanitizeName,
  seatIsBot,
  setTakeover,
  startGame,
  submitAction,
  trackPresence,
  updateMySeat,
  type Room,
} from '../room';

const NOW = 5_000_000;
let seq = 0;
const rand = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);

function setup() {
  const store = new MemoryStore();
  return { store, host: new MemoryBackend(store, 'uid-host'), guest: new MemoryBackend(store, 'uid-guest'), third: new MemoryBackend(store, 'uid-third') };
}
const room = async (be: MemoryBackend, code: string) => parseRoom(code, await be.read(roomPath(code)))!;

async function startedRoom() {
  const t = setup();
  const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
  await joinRoom(t.guest, 'uid-guest', code, 'Budi', NOW);
  await hostSetSeat(t.host, code, 2, 'bot');
  await updateMySeat(t.host, code, 'uid-host', { ready: true });
  await updateMySeat(t.guest, code, 'uid-guest', { ready: true });
  expect(await startGame(t.host, code, 'uid-host', 42)).toBe(true);
  return { ...t, code };
}

describe('rooms and the lobby', () => {
  it('creates a 4-letter code without I or O, and the creator is host in seat 0', async () => {
    const t = setup();
    const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    const r = await room(t.host, code);
    expect(r.meta.hostId).toBe('uid-host');
    expect(r.seats[0]).toMatchObject({ kind: 'human', playerId: 'uid-host', name: 'Rina' });
    expect(r.meta.status).toBe('lobby');
  });

  it('joining takes the next seat with a free starter and color; rejoining returns the same seat', async () => {
    const t = setup();
    const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
    const j = await joinRoom(t.guest, 'uid-guest', code, 'Budi', NOW);
    expect(j).toMatchObject({ ok: true, seat: 1 });
    const r = await room(t.host, code);
    expect(r.seats[1].starter).not.toBe(r.seats[0].starter);
    expect(r.seats[1].color).not.toBe(r.seats[0].color);
    expect(await joinRoom(t.guest, 'uid-guest', code, 'Budi', NOW)).toMatchObject({ ok: true, seat: 1 });
  });

  it('a starter or color can never be held by two seats, even when claimed at the same moment', async () => {
    const t = setup();
    const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
    await joinRoom(t.guest, 'uid-guest', code, 'Budi', NOW);
    await joinRoom(t.third, 'uid-third', code, 'Ari', NOW);
    const [a, b] = await Promise.all([
      updateMySeat(t.guest, code, 'uid-guest', { starter: 3, color: '#F2A900' }),
      updateMySeat(t.third, code, 'uid-third', { starter: 3, color: '#F2A900' }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const r = await room(t.host, code);
    expect(r.seats.filter((s) => s.starter === 3)).toHaveLength(1);
    expect(r.seats.filter((s) => s.color === '#F2A900')).toHaveLength(1);
    // Taken by someone else → refused.
    expect(await updateMySeat(t.host, code, 'uid-host', { starter: r.seats[1].starter })).toBe(false);
  });

  it('changing anything un-readies you; ready is required to start', async () => {
    const t = setup();
    const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
    await joinRoom(t.guest, 'uid-guest', code, 'Budi', NOW);
    await updateMySeat(t.guest, code, 'uid-guest', { ready: true });
    await updateMySeat(t.guest, code, 'uid-guest', { name: 'Budi2' });
    expect((await room(t.host, code)).seats[1].ready).toBe(false);
    expect(canStart(await room(t.host, code)).ok).toBe(false);
  });

  it('full, started, missing and expired rooms are refused with a reason', async () => {
    const t = setup();
    expect(await joinRoom(t.guest, 'uid-guest', 'ZZZZ', 'X', NOW)).toEqual({ ok: false, reason: 'notFound' });
    const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
    for (const k of [1, 2, 3]) await hostSetSeat(t.host, code, k, 'bot');
    expect(await joinRoom(t.guest, 'uid-guest', code, 'X', NOW)).toEqual({ ok: false, reason: 'full' });
    expect(await joinRoom(t.guest, 'uid-guest', code, 'X', NOW + ROOM_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });

    const s = await startedRoom();
    expect(await joinRoom(s.third, 'uid-third', s.code, 'X', NOW)).toEqual({ ok: false, reason: 'started' });
  });

  it('when the host leaves the lobby the next human becomes host; an empty room is abandoned', async () => {
    const t = setup();
    const code = await createRoom(t.host, 'uid-host', 'Rina', NOW, rand);
    await joinRoom(t.guest, 'uid-guest', code, 'Budi', NOW);
    await leaveLobby(t.host, code, 'uid-host');
    expect((await room(t.guest, code)).meta.hostId).toBe('uid-guest');
    await leaveLobby(t.guest, code, 'uid-guest');
    expect(await t.guest.read(roomPath(code))).toBeNull();
  });

  it('names are plain text, max 12 characters', () => {
    expect(sanitizeName('  <b>Rina</b>\u0007 the very long  ')).toBe('<b>Rina</b> ');
    expect(sanitizeName('A'.repeat(30))).toHaveLength(12);
  });
});

describe('starting and syncing the game', () => {
  it('start packs filled seats, writes version 1, and sets status playing', async () => {
    const s = await startedRoom();
    const r = await room(s.host, s.code);
    expect(r.meta.status).toBe('playing');
    expect(r.game!.version).toBe(1);
    const state = parseState(r.game!.stateJson)!;
    expect(state.players.map((p) => [p.name, p.isBot])).toEqual([
      ['Rina', false],
      ['Budi', false],
      ['Bot 3', true],
    ]);
  });

  it('two clients submitting at the same version → exactly one action applied', async () => {
    const s = await startedRoom();
    const [a, b] = await Promise.all([
      submitAction(s.host, s.code, { type: 'ROLL', by: 0 }),
      submitAction(s.guest, s.code, { type: 'ROLL', by: 0 }),
    ]);
    expect([a, b].sort()).toEqual(['applied', 'rejected']);
    const r = await room(s.host, s.code);
    expect(r.game!.version).toBe(2);
    expect(parseState(r.game!.stateJson)!.rollSeq).toBe(1);
  });

  it('an action for a seat that is not acting is rejected', async () => {
    const s = await startedRoom();
    expect(await submitAction(s.guest, s.code, { type: 'ROLL', by: 1 })).toBe('rejected');
    expect((await room(s.host, s.code)).game!.version).toBe(1);
  });

  it('trade offers go through the same path; only the recipient seat can answer', async () => {
    const s = await startedRoom();
    const offer = { type: 'PROPOSE_TRADE' as const, to: 1, give: { tiles: [], money: 100 }, receive: { tiles: [], money: 10 } };
    expect(await submitAction(s.guest, s.code, { ...offer, by: 1 })).toBe('rejected'); // not their turn
    expect(await submitAction(s.host, s.code, { ...offer, by: 0 })).toBe('applied');
    // While it's pending, nothing else goes through, and the proposer can't answer for the recipient.
    expect(await submitAction(s.host, s.code, { type: 'ROLL', by: 0 })).toBe('rejected');
    expect(await submitAction(s.host, s.code, { type: 'RESPOND_TRADE', accept: true, by: 0 })).toBe('rejected');
    expect(await submitAction(s.guest, s.code, { type: 'RESPOND_TRADE', accept: true, by: 1 })).toBe('applied');
    const state = parseState((await room(s.host, s.code)).game!.stateJson)!;
    expect(state.lastTrade?.outcome).toBe('accepted');
    expect(state.players[1].cash - state.players[0].cash).toBe(180);
    expect(state.phase).toBe('roll');
  });

  it('the feed ignores stale or duplicate versions and survives a bad state', async () => {
    const s = await startedRoom();
    const feed = new GameFeed();
    const v1 = (await room(s.host, s.code)).game!;
    expect(feed.accept(v1)).not.toBeNull();
    await submitAction(s.host, s.code, { type: 'ROLL', by: 0 });
    const v2 = (await room(s.host, s.code)).game!;
    expect(feed.accept(v2)!.rollSeq).toBe(1);
    expect(feed.accept(v1)).toBeNull(); // stale
    expect(feed.accept(v2)).toBeNull(); // duplicate
    expect(feed.accept({ version: 9, stateJson: '{broken' })).toBeNull();
    expect(feed.problem).toBe(true);
    expect(feed.state!.rollSeq).toBe(1); // kept the last good state
  });

  it('bots and a whole game can be driven through submitAction to the end', async () => {
    const s = await startedRoom();
    let r: Room = await room(s.host, s.code);
    for (let k = 0; k < 4000; k++) {
      const state = parseState(r.game!.stateJson)!;
      if (state.phase === 'gameOver') break;
      expect(await submitAction(s.host, s.code, { ...chooseAction(state), by: actorOf(state) })).toBe('applied');
      r = await room(s.host, s.code);
    }
    const final = parseState(r.game!.stateJson)!;
    expect(final.phase).toBe('gameOver');
    // The event log travels packed inside the authoritative state and arrives whole on every device.
    expect(r.game!.stateJson).toContain('"packedEvents"');
    expect(final.events[0].type).toBe('start');
    expect(final.events.at(-1)!.type).toBe('game_over');
    expect(final.events.at(-1)!.cash).toEqual(final.players.map((p) => p.cash));
    expect(final.events.map((e) => e.id)).toEqual(final.events.map((_, k) => k + 1));
  });
});

describe('presence, takeover and rematch', () => {
  it('a dropped device is marked offline; takeover makes its seat a bot until it is back', async () => {
    const s = await startedRoom();
    trackPresence(s.host, s.code, 'uid-host', () => {});
    trackPresence(s.guest, s.code, 'uid-guest', () => {});
    let r = await room(s.host, s.code);
    expect(r.presence['uid-guest'].online).toBe(true);
    expect(seatIsBot(r, 1)).toBe(false);

    s.guest.disconnect();
    await setTakeover(s.host, s.code, 1, true);
    r = await room(s.host, s.code);
    expect(r.presence['uid-guest'].online).toBe(false);
    expect(seatIsBot(r, 1)).toBe(true);

    s.guest.reconnect(); // back online → control returns, no action needed
    r = await room(s.host, s.code);
    expect(seatIsBot(r, 1)).toBe(false);
  });

  it('the host plays bots; if the host is offline, the lowest online human does', async () => {
    const s = await startedRoom();
    trackPresence(s.host, s.code, 'uid-host', () => {});
    trackPresence(s.guest, s.code, 'uid-guest', () => {});
    expect(botRunner(await room(s.host, s.code))).toBe('uid-host');
    s.host.disconnect();
    expect(botRunner(await room(s.guest, s.code))).toBe('uid-guest');
  });

  it('leaving for good turns the seat into a bot; rematch returns to the lobby un-readied', async () => {
    const s = await startedRoom();
    await leaveGame(s.guest, s.code, 'uid-guest');
    let r = await room(s.host, s.code);
    expect(r.seats[1]).toMatchObject({ kind: 'bot', left: true });
    expect(await rematch(s.host, s.code, 'uid-host')).toBe(true);
    r = await room(s.host, s.code);
    expect(r.meta.status).toBe('lobby');
    expect(r.game).toBeNull();
    expect(r.seats[0]).toMatchObject({ name: 'Rina', ready: false });
  });
});
