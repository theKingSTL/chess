import { chooseMove } from './ai.js';

self.onmessage = ({ data }) => {
  const { id, fen, level } = data;
  try {
    self.postMessage({ id, move: chooseMove(fen, level) });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
