/* Nous Deux : branchement sur Supabase.
   Expose window.claude.use(name) avec les mêmes fonctions que la version précédente
   (user, db, assets, room), plus la connexion par code et les notifications push. */
(function () {
  const CFG = window.ND_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  let sb = null, me = null, member = null;
  const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("TON-PROJET");

  // ---------- Connexion par e-mail + mot de passe ----------
  const here = () => location.origin + location.pathname;
  function loginFlow() {
    return new Promise((resolve) => {
      const box = $("#login"), msg = $("#lg-msg");
      box.hidden = false; $("#lg-step1").hidden = false; $("#lg-step2").hidden = true; msg.textContent = "";
      const say = (t) => { msg.textContent = t; };
      $("#lg-form1").onsubmit = async (e) => {
        e.preventDefault();
        const email = $("#lg-email").value.trim().toLowerCase(), password = $("#lg-pass").value;
        if (!email || password.length < 6) { say("Le mot de passe doit faire au moins 6 caractères."); return; }
        say("Vérification...");
        const { data: ok, error: e1 } = await sb.rpc("can_login", { p_email: email });
        if (e1) { say("Impossible de joindre le serveur. Vérifie ta connexion."); return; }
        if (!ok) { say("Cette adresse ne fait pas partie de Nous Deux."); return; }
        let { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (!error && data.session) { box.hidden = true; say(""); resolve(data.session); return; }
        const m = String((error && error.message) || "").toLowerCase();
        if (m.includes("not confirmed")) { say("Confirme d'abord ton adresse : touche le lien dans le mail reçu (regarde les spams), puis reviens ici et touche Entrer."); return; }
        // Pas encore de compte : on le crée avec ce mot de passe.
        const r = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
        if (r.error) {
          const em = String(r.error.message || "").toLowerCase();
          say(em.includes("registered") ? "Mot de passe incorrect." : "Connexion impossible : " + r.error.message); return;
        }
        if (r.data.session) { box.hidden = true; say(""); resolve(r.data.session); return; }
        if (r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0) { say("Mot de passe incorrect."); return; }
        say("Compte créé ! Un mail de confirmation vient de t'être envoyé. Touche le lien dedans, puis reviens ici et touche Entrer.");
      };
      $("#lg-forgot").onclick = async () => {
        const email = $("#lg-email").value.trim().toLowerCase();
        if (!email) { say("Écris d'abord ton adresse e-mail, puis touche « Mot de passe oublié ? »."); return; }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
        say(error ? "Envoi impossible : " + error.message : "Mail envoyé : touche le lien dedans pour choisir un nouveau mot de passe.");
      };
    });
  }
  // Après le lien "mot de passe oublié" : choisir le nouveau mot de passe.
  function newPasswordFlow() {
    return new Promise((resolve) => {
      const box = $("#login"), msg = $("#lg-msg");
      box.hidden = false; $("#lg-step1").hidden = true; $("#lg-step2").hidden = false; msg.textContent = "";
      $("#lg-form2").onsubmit = async (e) => {
        e.preventDefault();
        const password = $("#lg-new").value;
        if (password.length < 6) { msg.textContent = "6 caractères minimum."; return; }
        const { error } = await sb.auth.updateUser({ password });
        if (error) { msg.textContent = "Impossible : " + error.message; return; }
        box.hidden = true; history.replaceState(null, "", here()); resolve();
      };
    });
  }

  const ready = (async () => {
    if (!configured) throw new Error("not_configured");
    const recovering = /type=recovery/.test(location.hash);
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "nd-auth" },
    });
    let { data: { session } } = await sb.auth.getSession();
    if (recovering && session) await newPasswordFlow();
    else if (/access_token|type=signup/.test(location.hash)) history.replaceState(null, "", here());
    for (;;) {
      if (!session) session = await loginFlow();
      me = session.user.id;
      const { data, error } = await sb.rpc("claim_member");
      if (!error) { member = data; break; }
      await sb.auth.signOut();
      session = null;
      setTimeout(() => { const m = $("#lg-msg"); if (m) m.textContent = "Cette adresse ne fait pas partie de Nous Deux."; }, 60);
    }
    window.ndMembers = async () => { const { data } = await sb.from("members").select("email, user_id"); return data || []; };
    window.ndInvite = async (email) => {
      const { error } = await sb.rpc("invite_partner", { p_email: email });
      if (!error) return true;
      const m = String(error.message || "");
      return m.includes("bad_email") ? "bad_email" : m.includes("couple_full") ? "couple_full" : "error";
    };
    window.ndLogout = async () => { await sb.auth.signOut(); try { localStorage.removeItem("nd-cache"); } catch (e) {} location.reload(); };
    initPush();
    return sb;
  })();
  ready.catch((e) => console.warn("Nous Deux backend:", e.message));

  // ---------- Base de données (même forme que l'ancienne : collections + documents) ----------
  const stores = new Map(); // coll -> { map, listeners, channel }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 20);
  const snapOf = (map) => ({ docs: [...map.entries()].map(([id, data]) => ({ id, data: () => data })) });

  function emit(coll) {
    const st = stores.get(coll);
    if (!st) return;
    const s = snapOf(st.map);
    st.listeners.forEach((l) => { try { l.cb(s); } catch (e) { console.error(e); } });
  }
  async function refetch(coll) {
    const st = stores.get(coll);
    const { data, error } = await sb.from("docs").select("id, data").eq("coll", coll);
    if (error) { st.listeners.forEach((l) => l.err && l.err(error)); return; }
    st.map = new Map(data.map((r) => [r.id, r.data]));
    st.loaded = true;
    emit(coll);
  }
  function localSet(coll, id, data) { const st = stores.get(coll); if (st) { st.map.set(id, data); emit(coll); } }
  function localDel(coll, id) { const st = stores.get(coll); if (st && st.map.delete(id)) emit(coll); }

  function subscribe(coll, cb, err) {
    let st = stores.get(coll);
    if (!st) {
      st = { map: new Map(), listeners: new Set(), channel: null, loaded: false };
      stores.set(coll, st);
      const filter = /^[A-Za-z0-9_-]+$/.test(coll) ? `coll=eq.${coll}` : undefined;
      st.channel = sb.channel("docs:" + coll)
        .on("postgres_changes", { event: "*", schema: "public", table: "docs", ...(filter ? { filter } : {}) }, (p) => {
          const row = p.eventType === "DELETE" ? p.old : p.new;
          if (!row || row.coll !== coll) return;
          if (p.eventType === "DELETE") localDel(coll, row.id); else localSet(coll, row.id, row.data);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") refetch(coll);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") st.listeners.forEach((l) => l.err && l.err(new Error(status)));
        });
    }
    const l = { cb, err };
    st.listeners.add(l);
    if (st.loaded) cb(snapOf(st.map));
    return () => st.listeners.delete(l);
  }
  // iOS coupe les connexions en arrière-plan : au retour, on recharge tout.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && sb) stores.forEach((_, coll) => refetch(coll));
  });

  const db = {
    collection(coll) {
      return {
        onSnapshot(cb, err) { return subscribe(coll, cb, err); },
        async add(data) {
          const id = newId();
          const { error } = await sb.from("docs").insert({ coll, id, data });
          if (error) throw Object.assign(new Error(error.message), { code: error.code || "write_failed" });
          localSet(coll, id, data);
          return { id };
        },
        doc(id) {
          return {
            id,
            async get() {
              const { data, error } = await sb.from("docs").select("data").eq("coll", coll).eq("id", id).maybeSingle();
              if (error) throw error;
              return { id, exists: !!data, data: () => (data ? data.data : undefined) };
            },
            async set(data) {
              const { error } = await sb.from("docs").upsert({ coll, id, data }, { onConflict: "coll,id" });
              if (error) throw Object.assign(new Error(error.message), { code: error.code || "write_failed" });
              localSet(coll, id, data);
            },
            async update(patch) {
              const { data, error } = await sb.rpc("merge_doc", { p_coll: coll, p_id: id, p_patch: patch });
              if (error) throw Object.assign(new Error(error.message), { code: error.code || "write_failed" });
              localSet(coll, id, data);
            },
            async delete() {
              const { error } = await sb.from("docs").delete().eq("coll", coll).eq("id", id);
              if (error) throw Object.assign(new Error(error.message), { code: error.code || "write_failed" });
              localDel(coll, id);
            },
          };
        },
      };
    },
  };

  // ---------- Profils ----------
  const user = {
    id: async () => me,
    me: async () => ({ id: me, name: (member && member.display_name) || "" }),
    async profiles(ids) {
      const { data } = await sb.from("members").select("user_id, display_name");
      const out = {};
      ids.forEach((id) => { const m = (data || []).find((x) => x.user_id === id); out[id] = { id, name: (m && m.display_name) || "" }; });
      return out;
    },
  };

  // ---------- Photos (stockage privé + liens temporaires) ----------
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const urls = new Map(), queue = new Set();
  let qTimer = null;
  window.ndBlob = (path) => {
    if (!path) return PIXEL;
    const u = urls.get(path);
    if (u && u.exp > Date.now()) return u.url;
    queue.add(path);
    clearTimeout(qTimer);
    qTimer = setTimeout(flushUrls, 30);
    return PIXEL;
  };
  async function flushUrls() {
    await ready;
    const paths = [...queue]; queue.clear();
    if (!paths.length) return;
    const { data } = await sb.storage.from("photos").createSignedUrls(paths, 7 * 24 * 3600);
    (data || []).forEach((r) => { if (r.signedUrl) urls.set(r.path, { url: r.signedUrl, exp: Date.now() + 6 * 24 * 3600 * 1000 }); });
    document.querySelectorAll("img[data-blob]").forEach((img) => {
      const u = urls.get(img.dataset.blob);
      if (u && img.src !== u.url) img.src = u.url;
    });
  }
  const assets = {
    async upload(blob) {
      const ext = ((blob.type || "image/jpeg").split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "");
      const path = `${me}/${newId()}.${ext}`;
      const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
      if (error) throw Object.assign(new Error(error.message), { code: "upload_failed" });
      return { id: path, url: window.ndBlob(path) };
    },
    async delete(path) { await sb.storage.from("photos").remove([path]); urls.delete(path); },
  };

  // ---------- Présence en direct (qui a l'appli ouverte, qui écrit) ----------
  function makeRoom() {
    let mine = {}, handler = null, channel = null;
    const peersOf = () => Object.entries(channel.presenceState()).map(([k, arr]) => ({
      by: k, isMe: k === me, kind: "viewer", guest: false, presence: (arr && arr[arr.length - 1]) || {},
    }));
    channel = sb.channel("couple-presence", { config: { presence: { key: me } } });
    channel
      .on("presence", { event: "sync" }, () => handler && handler({ peers: peersOf(), joined: [], left: [], updated: [] }))
      .on("presence", { event: "join" }, ({ key }) => handler && key !== me &&
        handler({ peers: peersOf(), joined: [{ by: key, isMe: false, kind: "viewer" }], left: [], updated: [] }))
      .subscribe((s) => { if (s === "SUBSCRIBED") channel.track(mine); });
    return {
      onPeers(fn) { handler = fn; },
      async presence(patch) { mine = { ...mine, ...patch }; try { await channel.track(mine); } catch (e) {} },
    };
  }

  // ---------- Notifications push ----------
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  function b64ToBytes(b64) {
    const p = "=".repeat((4 - (b64.length % 4)) % 4), s = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  }
  async function saveSub(sub) {
    const j = sub.toJSON();
    await sb.from("push_subs").upsert({ endpoint: j.endpoint, sub: j, user_id: me }, { onConflict: "endpoint" });
  }
  async function initPush() {
    if (!pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") await saveSub(sub);
    } catch (e) {}
  }
  window.ndPush = {
    state() {
      if (!pushSupported()) return isStandalone() ? "unsupported" : "install";
      if (Notification.permission === "granted") return "on";
      if (Notification.permission === "denied") return "denied";
      return "off";
    },
    async enable() {
      await ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return false;
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.VAPID_PUBLIC_KEY) });
      await saveSub(sub);
      return true;
    },
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.tab && typeof window.show === "function") window.show(e.data.tab);
    });
  }

  // ---------- Point d'entrée utilisé par l'appli ----------
  let roomObj = null;
  window.claude = {
    async use(name) {
      try { await ready; } catch (e) { return null; }
      if (name === "user") return user;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "room") return roomObj || (roomObj = makeRoom());
      return null;
    },
  };
})();
