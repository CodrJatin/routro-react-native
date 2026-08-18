import { create } from 'zustand';

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

/** What the card's top rule is painted in. Not decoration: it is the one part
 * of the dialog the eye reaches before reading anything, so it carries whether
 * this is a failure, a success, or simply information. */
export type DialogTone = 'neutral' | 'danger' | 'success';

export interface DialogButton<T = unknown> {
  text: string;
  style?: DialogButtonStyle;
  /** Resolved by `showDialog` when this button is the one pressed. */
  value?: T;
  onPress?: () => void;
}

export interface DialogOptions<T = unknown> {
  title: string;
  message?: string;
  /** Defaults to a single dismissing "OK", matching `Alert.alert(title, msg)`. */
  buttons?: DialogButton<T>[];
  tone?: DialogTone;
  /** What a back-press or scrim tap resolves to. `showDialog` resolves
   * `undefined` when this is omitted. */
  dismissValue?: T;
  /** False for dialogs that must be answered rather than escaped. The Android
   * back button still closes them -- there is no honest way to refuse it -- so
   * `dismissValue` should still make sense. */
  dismissable?: boolean;
}

interface PendingDialog {
  id: number;
  options: DialogOptions<unknown>;
  resolve: (value: unknown) => void;
}

interface DialogState {
  /** A queue, not a single slot. Two things can want the screen at once -- a
   * journey ending as a broadcast notice lands -- and the second one arriving
   * must not silently replace the first. */
  queue: PendingDialog[];
  push: (dialog: PendingDialog) => void;
  /** Settles the front dialog and moves the queue on. */
  resolveFront: (id: number, value: unknown) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  push: (dialog) => set((state) => ({ queue: [...state.queue, dialog] })),
  resolveFront: (id, value) =>
    set((state) => {
      const front = state.queue[0];
      // Guarded by id so a late callback from a dialog that has already closed
      // (a double tap landing either side of the exit animation) can't settle
      // whatever happens to be next in the queue.
      if (!front || front.id !== id) return state;
      front.resolve(value);
      return { queue: state.queue.slice(1) };
    }),
}));

let nextId = 1;

/**
 * The app's own replacement for `Alert.alert`, and the only dialog API.
 *
 * Deliberately imperative and callable from outside React: journeys, meet
 * requests and permission flows all raise these from plain async functions, and
 * routing every one of them through component state would mean every caller
 * growing a piece of UI it otherwise has no reason to know about.
 *
 * Resolves with the pressed button's `value` (or `dismissValue` when the user
 * escapes instead), so a caller can `await` a decision rather than thread a
 * callback through it.
 */
export function showDialog<T = void>(options: DialogOptions<T>): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    useDialogStore.getState().push({
      id: nextId++,
      options: options as DialogOptions<unknown>,
      resolve: resolve as (value: unknown) => void,
    });
  });
}

/** The two-button yes/no case, which is most of them. */
export function confirmDialog(options: {
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;
  tone?: DialogTone;
  destructive?: boolean;
}): Promise<boolean> {
  return showDialog<boolean>({
    title: options.title,
    message: options.message,
    tone: options.tone,
    dismissValue: false,
    buttons: [
      { text: options.cancelText ?? 'Not now', style: 'cancel', value: false },
      {
        text: options.confirmText,
        style: options.destructive ? 'destructive' : 'default',
        value: true,
      },
    ],
  }).then((value) => value === true);
}
