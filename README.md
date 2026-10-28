# Nous Deux : mise en ligne

Ce dossier contient votre appli de couple en version indépendante : elle tourne sur votre propre adresse, s'installe sur l'écran d'accueil, et envoie de vraies notifications, même appli fermée. Aucune trace de Claude.

Compte environ une heure la première fois. Tout est gratuit pour un usage à deux.

## Ce qu'il y a dans le dossier

```
public/                  l'appli elle-même (c'est ce dossier qu'on met en ligne)
  index.html             l'interface
  backend.js             la connexion à Supabase (données, photos, présence, notifications)
  config.js              les 3 valeurs à remplir
  sw.js                  le service worker (hors ligne + notifications)
  manifest.webmanifest   le nom et l'icône de l'appli
  icons/  stk/           l'icône et les stickers
supabase/
  schema.sql             la base de données, à lancer une fois
  cron.sql               les rappels à l'heure, à lancer une fois
  functions/notify       envoie une notification à l'autre à chaque changement
  functions/reminders    envoie "C'est l'heure" pour les rappels
```

## Ce qu'il te faut

- Un ordinateur avec **Node.js** installé (pour deux commandes, étapes 4 et 5).
- Un compte gratuit **Supabase** (supabase.com) et un compte gratuit **Netlify** (netlify.com).
- Les deux adresses e-mail que vous utiliserez pour vous connecter.

---

## Étape 1. Créer le projet Supabase

1. Sur supabase.com, crée un compte puis **New project**.
2. Nom : `nous-deux`. Région : **Europe (Paris)** si elle est proposée, sinon Francfort. Choisis un mot de passe de base de données et garde-le.
3. Attends que le projet soit prêt (une à deux minutes).

## Étape 2. Créer la base de données

1. Ouvre `supabase/schema.sql` dans un éditeur de texte.
2. Tout en bas, remplace les deux adresses par les vôtres, et les prénoms si besoin.
3. Dans Supabase, va dans **SQL Editor**, colle tout le fichier, clique **Run**. Il doit afficher "Success".

Puis récupère tes clés : **Project Settings > API** (ou "Data API").

- **Project URL** : quelque chose comme `https://abcdefgh.supabase.co`
- **anon public key** : une longue clé, publique par nature
- **service_role key** : une autre longue clé, **secrète**, à ne jamais mettre dans l'appli

Ouvre `public/config.js` et colle l'URL et la clé anon à la place de `TON-PROJET` et `TA-CLE-ANON-PUBLIQUE`.

## Étape 3. Régler la connexion par code

On se connecte avec un code à 6 chiffres reçu par mail (un lien ne marcherait pas bien depuis l'icône sur l'iPhone).

1. **Authentication > Sign In / Providers** : vérifie que **Email** est activé.
2. **Authentication > Email Templates > Magic Link** : remplace le contenu par :

   ```
   <h2>Nous Deux</h2>
   <p>Ton code de connexion : <strong>{{ .Token }}</strong></p>
   ```
3. Fais pareil pour le modèle **Confirm signup**, car la toute première connexion de chacun utilise ce modèle.

Bon à savoir : l'envoi de mails intégré à Supabase est très limité (quelques mails par heure). Comme vous ne vous connectez qu'une fois par téléphone, ça suffit. Si un code n'arrive pas, regarde dans les spams et réessaie un peu plus tard.

## Étape 4. Créer les clés de notification

Sur ton ordinateur, dans un terminal :

```
npx web-push generate-vapid-keys
```

Tu obtiens une **Public Key** et une **Private Key**.

- Colle la **Public Key** dans `public/config.js` à la place de `TA-CLE-VAPID-PUBLIQUE`.
- Garde la **Private Key** pour l'étape suivante, elle reste secrète.

## Étape 5. Envoyer les fonctions de notification

Dans un terminal, place-toi dans le dossier `nous-deux-app` (celui qui contient `supabase/`), puis :

```
npx supabase login
npx supabase init
npx supabase link --project-ref TON-PROJET
npx supabase secrets set VAPID_PUBLIC_KEY="ta-public-key" VAPID_PRIVATE_KEY="ta-private-key" VAPID_SUBJECT="mailto:ton.adresse@exemple.com"
npx supabase functions deploy notify
npx supabase functions deploy reminders
```

- `TON-PROJET` est l'identifiant dans ton URL Supabase (la partie avant `.supabase.co`).
- Si `supabase init` pose des questions, réponds non. S'il dit que le projet existe déjà, continue.

## Étape 6. Brancher les notifications sur la base

**Une notification à chaque changement :**

1. Dans Supabase : **Database > Webhooks** (active-les si c'est demandé), puis **Create a new hook**.
2. Nom : `notify`. Table : `docs`. Événements : **Insert** et **Update**.
3. Type : **Supabase Edge Functions**, fonction **notify**, méthode POST.
4. Ajoute l'en-tête d'autorisation proposé (clé service role), puis enregistre.

**Les rappels qui sonnent à l'heure :**

1. Ouvre `supabase/cron.sql`, remplace `TON-PROJET` et `TA-CLE-SERVICE-ROLE`.
2. Colle-le dans **SQL Editor** et **Run**. Les rappels sont vérifiés chaque minute.

## Étape 7. Mettre l'appli en ligne

Le plus simple, sans aucune commande :

1. Va sur **app.netlify.com/drop** (connecte-toi).
2. Glisse le dossier **public** dans la page.
3. Quelques secondes plus tard, tu as une adresse du type `https://xxxx.netlify.app`.
4. Dans **Site configuration > Change site name**, choisis par exemple `nous-deux-sarah`.

Puis dans Supabase, **Authentication > URL Configuration** : mets ton adresse Netlify dans **Site URL**.

Pour toute mise à jour plus tard : modifie les fichiers, puis glisse à nouveau le dossier `public` dans l'onglet **Deploys** de ton site Netlify.

## Étape 8. Installer sur vos iPhone

Chacun sur son téléphone (iOS 16.4 ou plus récent pour les notifications) :

1. Ouvre ton adresse Netlify dans **Safari**.
2. Bouton **Partager**, puis **Sur l'écran d'accueil**, puis **Ajouter**.
3. Ouvre l'appli **depuis l'icône** (c'est important pour les notifications).
4. Entre ton adresse e-mail, puis le code reçu.
5. Choisis le surnom de ton partenaire.
6. Sur l'accueil, touche **Activer** sur le bandeau des notifications, puis **Autoriser**.

C'est prêt. Testez à deux : un message, une question à swiper, un rappel avec une heure dans deux minutes.

---

## Si quelque chose ne marche pas

| Ce qui se passe | Quoi vérifier |
|---|---|
| "Appli pas encore reliée à Supabase" | `public/config.js` n'est pas rempli, ou l'ancien fichier est encore en ligne : redéploie. |
| "Cette adresse ne fait pas partie de Nous Deux" | L'adresse n'est pas dans `members`. Relance le bas de `schema.sql` avec la bonne adresse. |
| Le code n'arrive pas | Spams, puis attends un peu : la limite de mails par heure est basse. |
| Pas de bandeau "Activer les notifications" | L'appli a été ouverte dans Safari et non depuis l'icône. |
| Pas de notification | Supabase > Edge Functions > notify > **Logs**. Vérifie les secrets VAPID et le webhook. |
| Les rappels ne sonnent pas | Logs de la fonction `reminders`, et la clé dans `cron.sql`. |

## Quelques limites à connaître

- Sur l'offre gratuite, Supabase met un projet en pause après environ une semaine sans aucune utilisation. Il suffit de le relancer depuis le tableau de bord.
- Les données de la version Claude ne sont pas reprises automatiquement : vous repartez d'une appli vide.
- Une photo "à voir une fois" peut toujours être capturée par une capture d'écran.
