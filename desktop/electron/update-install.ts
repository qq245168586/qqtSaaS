export interface UpdateWindow {
  isDestroyed(): boolean;
  webContents: {
    once(event: 'will-prevent-unload', listener: (event: { preventDefault(): void }) => void): void;
  };
  destroy(): void;
}

export interface UpdateInstallOptions {
  windows: () => UpdateWindow[];
  launchInstaller: () => void | Promise<void>;
  exitApp: (code: number) => void;
  schedule?: (callback: () => void, delay: number) => void;
}

/**
 * Launch a detached updater helper, close every renderer immediately and then
 * terminate the Electron process. The helper waits outside this process before
 * opening NSIS, so an active printer/renderer cannot keep the installer hidden.
 */
export async function installWindowsUpdate(options: UpdateInstallOptions): Promise<void> {
  const windows = options.windows();
  for (const current of windows) {
    if (current.isDestroyed()) continue;
    current.webContents.once('will-prevent-unload', (event) => event.preventDefault());
  }

  await options.launchInstaller();

  for (const current of windows) {
    if (!current.isDestroyed()) current.destroy();
  }

  const schedule = options.schedule ?? ((callback, delay) => void setTimeout(callback, delay));
  schedule(() => {
    for (const current of options.windows()) {
      if (!current.isDestroyed()) current.destroy();
    }
    options.exitApp(0);
  }, 100);
}
