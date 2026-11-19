import { jammable } from './jam.js';

export const ROOM_MEDIA_LEAD = 0.04;
export const ROOM_MEDIA_STARTUP_HORIZON = 4;

export function roomMediaLead(room, mediaRoute) {
  return room && mediaRoute ? ROOM_MEDIA_LEAD : 0;
}

export function roomMediaTime(time, room, mediaRoute) {
  const lead = roomMediaLead(room, mediaRoute);
  return lead ? time - lead : time;
}

export function createRoomMediaSync(now = Date.now) {
  let startup = false, pendingCold = false, joiningCold = false, jamCapable = false, joined = null, duplicateUntil = 0;
  let priming = false, primedUntil = 0;
  const identity = item => item?.broadcastId && Number.isFinite(item.startsAt)
    ? [item.broadcastId, item.version, item.startsAt, item.by] : null;
  return {
    begin(item, playing, room, mediaRoute) {
      const next = identity(item);
      pendingCold ||= Boolean(mediaRoute && next && !joined && (!playing || !room));
      jamCapable = jammable(item);
    },
    start(room, mediaRoute) {
      joiningCold = Boolean(room && mediaRoute && pendingCold);
      startup = joiningCold && !jamCapable;
      pendingCold = false;
    },
    horizon(normal, room, mediaRoute) {
      const prime = startup && room && mediaRoute;
      startup = false;
      priming = Boolean(prime);
      return prime ? Math.max(normal, ROOM_MEDIA_STARTUP_HORIZON) : normal;
    },
    queued(until, sources = []) {
      if (priming) primedUntil = sources.reduce((end, note) => Math.max(end, note.t), until);
      priming = false;
    },
    cancel(time) {
      const active = time < primedUntil;
      primedUntil = 0;
      priming = false;
      return active;
    },
    remember(item) {
      joined = identity(item);
      if (joiningCold) duplicateUntil = now() + 250;
      joiningCold = false;
    },
    duplicate(item, playing, room, mediaRoute) {
      const next = identity(item);
      return Boolean(now() <= duplicateUntil && playing && room && mediaRoute && item?.state && !item.replay && joined && next
        && next.every((value, i) => value === joined[i]));
    },
  };
}
