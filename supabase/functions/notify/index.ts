// Appelée par le webhook de la base à chaque ajout ou modification dans "docs".
// Elle prévient l'autre personne par une notification push.
import { admin, getMembers, json, nickFor, pushTo, type Payload } from "../_shared/push.ts";

type Row = { coll: string; id: string; data: Record<string, any>; created_by: string | null; updated_by: string | null };
type Hook = { type: "INSERT" | "UPDATE" | "DELETE"; record: Row | null; old_record: Row | null };

const CAT: Record<string, string> = { resto: "Resto", activite: "Activité", voyage: "Voyage", autre: "Autre" };
const fmtDate = (d?: string) =>
  d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
const qTitle = (q: any) => q.kind === "aime" ? `Est-ce que tu aimes ${q.text} ?` : `${q.a} ou ${q.b} ?`;
const qLabel = (q: any, c: string) => q.kind === "aime" ? (c === "b" ? "Oui" : "Non") : (c === "b" ? q.b : q.a);

function forLabel(d: any) {
  const rel = ({ lui: "other", moi: "self", nous: "both" } as Record<string, string>)[d.for] || d.for || "both";
  return rel === "both" ? "pour vous deux" : rel === "self" ? "pour lui-même" : "pour toi";
}

// Construit le texte de la notification. "n" = le surnom de l'auteur, vu par le destinataire.
function build(h: Hook, n: string, extra: { question?: any }): Payload | null {
  const r = h.record!, o = h.old_record, d = r.data ?? {}, od = o?.data ?? {};
  const isNew = h.type === "INSERT";

  if (r.coll === "messages") {
    if (!isNew) return null;
    return { title: `${n} t'a écrit`, body: d.once ? "Une photo à voir une fois" : d.photo ? "Une photo" : d.text, tab: "chat", tag: "msg" };
  }
  if (r.coll === "questions") {
    if (isNew) return { title: `${n} te pose une question`, body: qTitle(d), tab: "us", tag: "q" };
    const c = d.comments ?? [], oc = od.comments ?? [];
    if (c.length > oc.length) return { title: `${n} a commenté`, body: c[c.length - 1]?.t, tab: "us", tag: "c" + r.id };
    return null;
  }
  if (r.coll === "answers") {
    const q = extra.question;
    if (!q) return null;
    return { title: `${n} a répondu`, body: `${qTitle(q)} ${qLabel(q, d.choice)}`, tab: "us", tag: "a" + r.id };
  }
  if (r.coll === "seen") {
    const prev = Number(od.at || 0), now = Number(d.at || 0);
    if (now - prev < 30 * 60 * 1000) return null; // pas plus d'une fois par demi-heure
    return { title: `${n} vient d'ouvrir l'appli`, body: "Tout est à jour de son côté aussi.", tag: "seen" };
  }
  if (r.coll !== "items") return null;

  if (isNew) {
    const M: Record<string, [string, string, string]> = {
      rappel: ["Nouveau rappel", `${d.text} (${forLabel(d)})`, "home"],
      liste: [`Ajout à la liste ${d.list || ""}`.trim(), d.text, "home"],
      aime: [`${n} aime`, d.text, "us"],
      aimepas: [`${n} aimerait en parler`, d.text, "us"],
      souvenir: ["Nouveau souvenir", d.text, "mem"],
      moment: [`${n} a noté votre moment`, `${d.note}/10, le ${fmtDate(d.date)}`, "cal"],
      demande: [`${n} te propose une sortie`, `${d.text}, ${fmtDate(d.date)}${d.time ? " à " + d.time : ""}`, "home"],
      envie: [`${n} a une envie`, `${CAT[d.cat] || ""} : ${d.text}`, "cal"],
    };
    const x = M[d.type];
    return x ? { title: x[0], body: x[1], tab: x[2], tag: "i" + r.id } : null;
  }
  // Modification : seulement si c'est une vraie action de l'autre (pas un marquage automatique)
  if (!d.edited || d.edited === od.edited) return null;
  if (d.type === "demande" && d.status !== od.status)
    return { title: d.status === "accepte" ? `${n} a dit oui` : `${n} n'est pas dispo`, body: `${d.text}, ${fmtDate(d.date)}`, tab: "cal", tag: "i" + r.id };
  if (d.type === "rappel" && d.done && !od.done) return { title: `${n} a fait un rappel`, body: d.text, tab: "home", tag: "i" + r.id };
  if (d.type === "moment") return { title: `${n} a modifié son avis`, body: `${fmtDate(d.date)} : ${d.note}/10`, tab: "cal", tag: "i" + r.id };
  if (d.type === "aimepas" && d.done && !od.done) return { title: `${n} a noté que vous en avez parlé`, body: d.text, tab: "us", tag: "i" + r.id };
  if (d.type === "envie")
    return { title: d.lastAct === "also" ? `${n} en a envie aussi` : d.done ? `${n} a coché une envie` : `${n} a remis une envie`, body: d.text, tab: "cal", tag: "i" + r.id };
  if (d.type === "liste" && d.done && !od.done) return { title: `${n} a coché`, body: d.text, tab: "home", tag: "i" + r.id };
  return null;
}

Deno.serve(async (req) => {
  try {
    const h = (await req.json()) as Hook;
    if (h.type === "DELETE" || !h.record) return json({ skipped: "delete" });
    const r = h.record;
    if (r.coll.startsWith("data/users/")) return json({ skipped: "private" });

    const actor = h.type === "INSERT" ? (r.created_by ?? r.data?.by) : (r.updated_by ?? r.data?.editedBy);
    if (!actor) return json({ skipped: "system" }); // ex : rappel marqué par la tâche automatique

    let question: any = null;
    if (r.coll === "answers") {
      const { data } = await admin.from("docs").select("data").eq("coll", "questions").eq("id", r.data?.q).maybeSingle();
      question = data?.data ?? null;
    }

    const members = await getMembers();
    let sent = 0;
    for (const m of members) {
      if (m.user_id === actor) continue;
      if (r.coll === "answers" && question?.by !== m.user_id) continue; // seul l'auteur de la question
      const n = await nickFor(m.user_id, actor, members);
      const p = build(h, n, { question });
      if (p) { await pushTo(m.user_id, p); sent++; }
    }
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
