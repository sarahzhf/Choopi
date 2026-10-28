// Outils partagés par les fonctions "notify" et "reminders".
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:nous-deux@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

export type Member = { user_id: string; display_name: string | null };

export async function getMembers(): Promise<Member[]> {
  const { data } = await admin.from("members").select("user_id, display_name").not("user_id", "is", null);
  return (data ?? []) as Member[];
}

// Le surnom que "recipient" a choisi pour son partenaire (sinon le prénom).
export async function nickFor(recipient: string, sender: string, members: Member[]): Promise<string> {
  const { data } = await admin.from("docs").select("data")
    .eq("coll", "data/users/" + recipient).eq("id", "settings").maybeSingle();
  const nick = (data?.data as Record<string, unknown> | undefined)?.partnerName as string | undefined;
  return nick || members.find((m) => m.user_id === sender)?.display_name || "Ton cœur";
}

export type Payload = { title: string; body?: string; tab?: string; tag?: string };

// Envoie une notification à tous les téléphones abonnés d'une personne.
export async function pushTo(userId: string, payload: Payload) {
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

export const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
