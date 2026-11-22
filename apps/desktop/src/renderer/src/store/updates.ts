/**
 * Auto-update state mirrored from main (`window.splatcraft.updates`).
 * Posts one app message when a downloaded update is ready to install.
 */
import type { UpdateState } from '@shared/api';
import { create } from 'zustand';
import { pushMessage } from './messages';

interface UpdatesState {
  state?: UpdateState;
  /** Wires the bridge listener; returns the unsubscribe. */
  init(): () => void;
  check(): Promise<void>;
  setAuto(auto: boolean): Promise<void>;
  install(): Promise<void>;
}

const api = () => window.splatcraft.updates;
let announced: string | undefined;

export const useUpdates = create<UpdatesState>()((set) => {
  const receive = (state: UpdateState) => {
    set({ state });
    if (state.status === 'ready' && state.available && announced !== state.available) {
      announced = state.available;
      pushMessage({ level: 'info', title: `SplatCraft ${state.available} is ready`, hint: 'Restart from Settings → General, or it installs when you quit.' });
    }
  };
  return {
    init() {
      const off = api().onState(receive);
      void api().state().then(receive).catch(() => {});
      return off;
    },
    async check() {
      try {
        receive(await api().check());
      } catch (e) {
        pushMessage({ level: 'error', title: 'Update check failed', detail: String((e as Error).message ?? e) });
      }
    },
    async setAuto(auto) {
      receive(await api().setAuto(auto));
    },
    async install() {
      await api().install();
    },
  };
});
