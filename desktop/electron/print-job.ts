export type SubmitPrint = (
  paper: { width: number; height: number },
  done: (success: boolean, reason?: string) => void,
) => void;

/** Only an explicit driver failure permits the legacy continuous-paper retry. */
export function submitPrintWithCompatibility(
  submit: SubmitPrint,
  paper: { width: number; height: number },
  custom: boolean,
  timeoutMs = 30000,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let firstCallbackReceived = false;
    const timer = setTimeout(
      () => finish(false, '打印超时，请先检查打印队列，避免重复打印'),
      timeoutMs,
    );
    function finish(success: boolean, reason?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      success ? resolve(true) : reject(new Error(reason || '打印失败'));
    }
    const retryAllowed = !custom && paper.width === 210000 && paper.height === 140000;
    try {
      submit(paper, (success, reason) => {
        if (settled || firstCallbackReceived) return;
        firstCallbackReceived = true;
        if (success || !retryAllowed) {
          finish(success, reason);
          return;
        }
        try {
          submit({ width: 241000, height: 140000 }, finish);
        } catch (error) {
          finish(false, String(error));
        }
      });
    } catch (error) {
      finish(false, String(error));
    }
  });
}
