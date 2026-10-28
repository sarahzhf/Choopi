// Lancée chaque minute par une tâche planifiée (voir supabase/cron.sql).
// Envoie "C'est l'heure" pour les rappels du jour dont l'heure est passée, même appli fermée.
// Version tout-en-un : à coller dans Supabase > Edge Functions > Deploy a new function > Via Editor.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:nous-deux@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

type Member = { user_id: string; display_name: string | null };

async function getMembers(): Promise<Member[]> {
  const { data } = await admin.from("members").select("user_id, display_name").not("user_id", "is", null);
  return (data ?? []) as Member[];
}

type Payload = { title: string; body?: string; tab?: string; tag?: string };

// Envoie une notification à tous les téléphones abonnés d'une personne.
async function pushTo(userId: string, payload: Payload) {
  const { data: subs } = await admin.from("push_subs").select("endpoint, sub").eq("user_id", userId);
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 6 * 3600 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from("push_subs").delete().eq("endpoint", s.endpoint); // abonnement expiré
      } else {
        console.error("push error", code, e);
      }
    }
  }
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// Seuls la base et la tâche planifiée connaissent ce secret.
function allowed(req: Request) {
  const s = Deno.env.get("ND_SECRET");
  return !!s && req.headers.get("x-nd-secret") === s;
}

const TZ = "Europe/Paris";

function parisNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

const REL: Record<string, string> = { lui: "other", moi: "self", nous: "both" };

Deno.serve(async (req) => {
  if (!allowed(req)) return json({ error: "forbidden" }, 403);
  try {
    const { day, hm } = parisNow();
    const { data: rows, error } = await admin.from("docs").select("id, data")
      .eq("coll", "items").eq("data->>type", "rappel").eq("data->>due", day);
    if (error) throw error;

    const due = (rows ?? []).filter((r) => {
      const d = r.data as Record<string, any>;
      return !d.done && !d.alerted && d.time && d.time <= hm;
    });
    if (!due.length) return json({ due: 0 });

    const members = await getMembers();
    for (const r of due) {
      const d = r.data as Record<string, any>;
      const rel = REL[d.for] || d.for || "both";
      const targets = members.filter((m) =>
        rel === "both" || (rel === "self" ? m.user_id === d.by : m.user_id !== d.by)
      );
      for (const m of targets) {
        await pushTo(m.user_id, { title: `C'est l'heure : ${d.text}`, body: `Prévu à ${d.time}`, tab: "home", tag: "r" + r.id });
      }
      await admin.rpc("merge_doc", { p_coll: "items", p_id: r.id, p_patch: { alerted: true } });
    }
    return json({ due: due.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
