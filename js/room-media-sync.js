export const ROOM_MEDIA_LEAD = 0.04;
export const ROOM_MEDIA_STARTUP_HORIZON = 2;

export function roomMediaLead(room, mediaRoute) {
  return room && mediaRoute ? ROOM_MEDIA_LEAD : 0;
}

export function roomMediaTime(time, room, mediaRoute) {
  const lead = roomMediaLead(room, mediaRoute);
  return lead ? time - lead : time;
}

export function createRoomMediaSync() {
  let startup = false, joined = null;
  const identity = item => item?.broadcastId && Number.isFinite(item.startsAt)
    ? [item.broadcastId, item.version, item.startsAt, item.by] : null;
  return {
    start(room, mediaRoute) { startup = Boolean(room && mediaRoute); },
    horizon(normal, room, mediaRoute) {
      const prime = startup && room && mediaRoute;
      startup = false;
      return prime ? Math.max(normal, ROOM_MEDIA_STARTUP_HORIZON) : normal;
    },
    remember(item) { joined = identity(item); },
    duplicate(item, playing, room, mediaRoute) {
      const next = identity(item);
      return Boolean(playing && room && mediaRoute && item?.state && !item.replay && joined && next
        && next.every((value, i) => value === joined[i]));
    },
  };
}
