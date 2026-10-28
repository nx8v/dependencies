async function read(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "bad_gateway", hint: "balasan bukan JSON" };
  }
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return read(res);
}

export function signup(name, password) {
  return post("/api/oauth/signup", { name, password });
}

export function signin(name, password) {
  return post("/api/oauth/signin", { name, password });
}

export function logout() {
  return post("/api/oauth/logout");
}

export async function me() {
  return read(await fetch("/api/oauth/me"));
}
