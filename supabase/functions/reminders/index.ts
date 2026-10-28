// Lancée chaque minute par une tâche planifiée (voir supabase/cron.sql).
// Envoie "C'est l'heure" pour les rappels du jour dont l'heure est passée, même appli fermée.
import { admin, getMembers, json, pushTo } from "../_shared/push.ts";

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

Deno.serve(async () => {
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
