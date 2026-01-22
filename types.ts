
export interface Meme {
  id: string;
  label: string;
  prompt: string;
  emoji: string;
  color: string;
}

export interface SoundState {
  isPlaying: boolean;
  activeMemeId: string | null;
  rouletteActive: boolean;
  secondsToNext: number;
}
