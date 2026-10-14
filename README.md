# ✨ Neverland – Mini App Telegram

Mini application pour commander **chocolats** et **fleurs**.  
Paiement **uniquement en espèces**, fidélité (5 pts → 30 pts = article offert),  
notifications Telegram, thème monde imaginaire nocturne, **panneau admin**.

---

## Ce qui est inclus

- Catalogue magnifique (chocolats + fleurs) avec ciel étoilé animé
- Prix au gramme possible (ex: `€ / 100g`)
- Photos (URL) ou emojis
- Panier + quantités
- Fidélité : +5 points / commande → 30 points = 1 article offert
- Livraison (pseudo Telegram + adresse) ou retrait sur place
- Notification automatique sur ton Telegram à chaque commande
- **Panneau admin** (`/admin.html`) pour modifier prix, photos, produits, voir les commandes
- Sécurité : validation cryptographique Telegram + mot de passe admin

---

# Guide complet – du zéro à la Mini App en ligne

## 1. C’est quoi un VPS ?

Un **VPS** (Virtual Private Server) = un petit ordinateur dans un datacenter, accessible 24h/24 via internet.  
Tu le loues, tu y installes ce que tu veux, et ton site tourne dessus.

**Pourquoi hors France ?**  
Parce que tu voulais moins de contrôle. Les meilleurs choix privacy :
- **Islande** → 1984.is, FlokiNET, OrangeWebsite
- **Suisse** → Infomaniak, Exoscale

Prix typique : 5 à 15 € / mois pour commencer.

---

## 2. Créer le bot Telegram (5 minutes)

1. Ouvre Telegram → cherche **@BotFather**
2. Envoie `/newbot`
3. Choisis un **nom** (ex: Neverland Shop)
4. Choisis un **username** qui finit par `bot` (ex: `NeverlandShop_bot`)
5. **Copie le token** (ressemble à `7123456789:AAHxxxx...`) → tu en auras besoin
6. Envoie `/newapp`
7. Sélectionne ton bot → donne un titre « Neverland » → une courte description
8. Pour l’instant laisse l’URL vide, on la mettra plus tard

**Trouver ton Chat ID** (pour recevoir les commandes) :
1. Envoie n’importe quel message à **@userinfobot**
2. Il te répond avec ton **Id** (ex: `123456789`)
3. Note-le

---

## 3. Louer et préparer le VPS

### A. Choisir et payer
- Va sur 1984.is ou FlokiNET (Islande) ou Infomaniak (Suisse)
- Prends le plus petit plan (1-2 Go de RAM suffisent)
- Tu reçois une **IP**, un **utilisateur** (souvent `root`) et un **mot de passe** (ou clé SSH)

### B. Se connecter au VPS (depuis ton ordinateur)

**Sur Windows** : installe [PuTTY](https://www.putty.org/) ou utilise le terminal Windows 11  
**Sur Mac / Linux** : ouvre le Terminal

```bash
ssh root@TON_IP_ICI
```

Exemple : `ssh root@198.51.100.23`  
Entre le mot de passe quand on te le demande.

### C. Installer tout ce qu’il faut (copie-colle ces commandes une par une)

```bash
# Mettre à jour le système
apt update && apt upgrade -y

# Installer Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Vérifier
node -v
npm -v

# Installer Nginx (pour le domaine + HTTPS) et outils
apt install -y nginx certbot python3-certbot-nginx unzip git

# Installer PM2 (pour que l’app tourne en permanence)
npm install -g pm2
```

---

## 4. Mettre le code sur le VPS

### Option simple : avec le fichier zip

1. Sur ton ordinateur, tu as le fichier `neverland-miniapp.zip`
2. Sur le VPS, crée un dossier :

```bash
mkdir -p /var/www
cd /var/www
```

3. Upload le zip (plusieurs façons) :
   - Avec **FileZilla** (SFTP) → facile et graphique
   - Ou avec la commande `scp` depuis ton ordinateur :

```bash
# Depuis ton ordinateur (pas sur le VPS)
scp neverland-miniapp.zip root@TON_IP:/var/www/
```

4. Sur le VPS, décompresse :

```bash
cd /var/www
unzip neverland-miniapp.zip
cd neverland-miniapp
```

### Configurer le .env

```bash
cp .env.example .env
nano .env
```

Remplis comme ça (avec **tes** vraies valeurs) :

```
BOT_TOKEN=7123456789:AAHton_vrai_token
ADMIN_CHAT_ID=123456789
ADMIN_PASSWORD=UnMotDePasseTresLongEtComplique!
PORT=3000
```

Sauvegarde : `Ctrl + O` puis Entrée, quitte : `Ctrl + X`

### Installer les dépendances et lancer

```bash
npm install
pm2 start src/server.js --name neverland
pm2 save
pm2 startup
```

(La dernière commande te donne une ligne à copier-coller, fais-le.)

Vérifie que ça tourne :

```bash
pm2 status
```

---

## 5. Domaine + HTTPS (obligatoire pour Telegram)

1. Achète un domaine (Namecheap, Porkbun, Njalla…)
2. Dans les DNS du domaine, crée un enregistrement **A** qui pointe vers l’IP de ton VPS
3. Sur le VPS, configure Nginx :

```bash
nano /etc/nginx/sites-available/neverland
```

Colle ceci (remplace `ton-domaine.com`) :

```nginx
server {
    listen 80;
    server_name ton-domaine.com www.ton-domaine.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Active le site :

```bash
ln -s /etc/nginx/sites-available/neverland /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

4. Active HTTPS gratuit (Let’s Encrypt) :

```bash
certbot --nginx -d ton-domaine.com -d www.ton-domaine.com
```

Suis les questions (email, accepter les conditions).

---

## 6. Finaliser dans BotFather

1. Retourne sur @BotFather
2. `/myapps` → sélectionne Neverland
3. **Edit Web App URL** → mets `https://ton-domaine.com`
4. (Optionnel) Ajoute un Menu Button : Bot Settings → Menu Button → Configure → URL de la Mini App

Teste : ouvre ton bot et clique sur le bouton menu, ou va sur `https://t.me/ton_bot/ton_app`

---

## 7. Le panneau Admin

Va sur : **https://ton-domaine.com/admin.html**

Entre le mot de passe que tu as mis dans `ADMIN_PASSWORD`.

Tu peux :
- Voir tous les produits
- Modifier prix, unité (€ / 100g, etc.), description, emoji, **URL de photo**
- Ajouter / supprimer des produits
- Voir les commandes reçues

**Astuce photo** : héberge tes images sur Imgur, Cloudinary, ou directement sur ton VPS (dossier public), et colle l’URL.

---

## 8. Sécurité & VPN (ce que tu as demandé)

### A. Sécuriser l’accès SSH
```bash
# Désactiver la connexion par mot de passe (recommandé après avoir mis une clé SSH)
# nano /etc/ssh/sshd_config
# PasswordAuthentication no
# puis : systemctl restart ssh
```

### B. Firewall simple
```bash
apt install -y ufw
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

### C. VPN pour toi (recommandé)

Tu n’as **pas besoin** d’un VPN sur le serveur pour que les clients utilisent la Mini App.  
Par contre, **pour toi** (quand tu te connectes en admin ou en SSH), c’est une très bonne idée :

- **Mullvad**, **ProtonVPN**, ou **IVPN** → tu te connectes depuis ton téléphone / ordi
- Ensuite tu ouvres `https://ton-domaine.com/admin.html` en étant sous VPN
- Comme ça ton IP réelle n’apparaît jamais dans les logs du serveur

Tu peux aussi installer WireGuard sur le VPS pour y accéder uniquement via VPN, mais c’est plus avancé.

### D. Autres bonnes pratiques
- Change régulièrement le `ADMIN_PASSWORD`
- Ne partage jamais le token du bot
- Fais des sauvegardes de la base : le fichier est dans `data/neverland.db`

---

## Commandes utiles plus tard

```bash
pm2 restart neverland     # redémarrer l’app
pm2 logs neverland        # voir les logs
pm2 status                # état
```

---

## Structure du projet

```
neverland-miniapp/
├── public/
│   ├── index.html      ← Mini App client
│   ├── admin.html      ← Panneau admin
│   ├── styles.css
│   └── app.js
├── src/
│   ├── server.js
│   ├── db.js
│   └── telegram.js
├── data/               ← base SQLite (créée auto)
├── .env.example
├── package.json
└── README.md
```

---

Tu as maintenant **tout**.  
Suis les étapes dans l’ordre, et si tu bloques à un endroit précis (connexion SSH, Nginx, etc.), dis-moi exactement où et je t’aide ligne par ligne.

Profite de Neverland ✨
