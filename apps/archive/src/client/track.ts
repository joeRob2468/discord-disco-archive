/**
 * A playable set as the player sees it. Pages embed queues of these as JSON in
 * `data-queue` on play buttons; shared by the server views and the client player.
 */
export interface Track {
  /** The set's UUID, for play counting. */
  uuid: string;
  title: string;
  /** The DJ. */
  artist: string;
  /** The session (album). */
  album: string;
  /** Audio URL (MP3 first). */
  src: string;
  /** The set's page. */
  href: string;
  /** Image URL, or undefined to use `gradient`. */
  art: string | undefined;
  /** CSS background for the placeholder artwork. */
  gradient: string;
}
