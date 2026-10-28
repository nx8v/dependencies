async function read(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "bad_gateway", hint: "balasan bukan JSON" };
  }
}

export async function upload(file) {
  const body = new FormData();
  body.append("file", file);
  return read(await fetch("/api/upload", { method: "POST", body }));
}

export async function list(folder) {
  const url = folder ? "/api/upload?folder=" + encodeURIComponent(folder) : "/api/upload";
  return read(await fetch(url));
}

export async function remove(folder, name) {
  const url = "/api/upload?folder=" + encodeURIComponent(folder) + "&name=" + encodeURIComponent(name);
  return read(await fetch(url, { method: "DELETE" }));
}
