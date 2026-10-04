// iOS emits partial transcripts; do not wait indefinitely for a final result.
export async function recognizeIOSAddress(plugin, onText, { silenceMs = 2500, timeoutMs = 20000 } = {}) {
  let latest = "";
  let settled = false;
  let pauseTimer;
  let deadline;
  const handles = [];
  let finish;
  const result = new Promise((resolve, reject) => {
    finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(pauseTimer);
      clearTimeout(deadline);
      if (latest) resolve({ matches: [latest] });
      else reject(error || new Error("Não ouvi um endereço. Tente novamente."));
    };
  });
  // Attach a handler before native setup, which itself can take time.
  result.catch(() => {});
  try {
    handles.push(await plugin.addListener("partialResults", (event) => {
      if (settled) return;
      const text = event.matches?.[0]?.trim();
      if (!text || text === latest) return;
      latest = text;
      onText(text);
      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => finish(), silenceMs);
    }));
    handles.push(await plugin.addListener("error", (event) => {
      finish(new Error(event.message || "Não consegui ouvir o endereço."));
    }));
    deadline = setTimeout(() => finish(), timeoutMs);
    // start resolves as soon as capture begins in partial-results mode.
    Promise.resolve(plugin.start({
      language: "pt-BR", maxResults: 1, partialResults: true,
      popup: false, preferLegacyRecognizer: true,
    })).catch(finish);
    return await result;
  } finally {
    settled = true;
    clearTimeout(pauseTimer);
    clearTimeout(deadline);
    // Stop capture before opening the address review screen.
    let stopTimer;
    await Promise.race([
      Promise.resolve().then(() => plugin.forceStop()).catch(() => {}),
      new Promise((resolve) => { stopTimer = setTimeout(resolve, 2000); }),
    ]);
    clearTimeout(stopTimer);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => {})));
  }
}
