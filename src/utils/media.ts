/** A link to a sound file: shown as a player instead of an image. Shared with the editor page. */
export const isAudio = (src: string | null | undefined) => !!src && /\.(m4a|mp3|aac|wav|caf|ogg|opus|flac)(?:[?#].*)?$/i.test(src);
