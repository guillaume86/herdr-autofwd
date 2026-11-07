// The popup draws these in place of a port's process name, keyed by the name autofwd reports
// (the remote program, or its systemd unit). Add a line to give a process its icon.
//
// A path is in herdr-app's home folder, like `icon` in its programs.json: herdr's own icons are
// in `icons/` (node, python, redis-cli, nginx, …), a mod's in `mods/<name>/`. The icon is drawn
// in one color, as a glyph, so a full-color picture shows as its silhouette.

export const PROCESS_ICONS: Record<string, string> = {
  "docker-proxy": "icons/docker.svg", // a port Docker publishes: the container says the rest
};

/** The icon that stands for `process`, or null to show its name. */
export const processIcon = (process: string): string | null => (Object.hasOwn(PROCESS_ICONS, process) && PROCESS_ICONS[process]) || null;
