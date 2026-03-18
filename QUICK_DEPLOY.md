# ⚡ Quick Deploy to Render - 5 Minutes

## Copy-Paste Quick Start

### 1️⃣ Go to Render
Visit: https://render.com

### 2️⃣ Sign In with GitHub
- Click "Sign up" or "Sign in"
- Choose "Continue with GitHub"
- Authorize Render to access GitHub

### 3️⃣ Create Blueprint Service
- Click **"New +"** in dashboard
- Select **"Blueprint"**
- Search and select: `whatsapp-crm`
- Click **"Connect"**

### 4️⃣ Deploy
- Render reads `render.yaml` automatically
- Click **"Create Resources"**
- Wait 2-5 minutes for deployment

### 5️⃣ Add Environment Variables

Once deployed, click on the **API Service**:
1. Go to **"Environment"** tab
2. Click **"Add Environment Variable"**
3. Add each variable:

```
NODE_ENV = production
WHATSAPP_TOKEN = [your token]
SUPABASE_URL = [your URL]
SUPABASE_ANON_KEY = [your key]
VERIFY_TOKEN = [random secure string]
```

### 6️⃣ Get Your API URL
- Copy the URL shown in service details
- Example: `https://whatsapp-crm-api.onrender.com`

### 7️⃣ Configure WhatsApp
In WhatsApp Business settings:
- Webhook URL: `https://whatsapp-crm-api.onrender.com/webhook`
- Verify Token: (same as `VERIFY_TOKEN` you set)

---

## 📋 What's Deployed

| Service | What | URL |
|---------|------|-----|
| **API** | Node.js backend | `https://whatsapp-crm-api.onrender.com` |
| **Frontend** | React web app | `https://whatsapp-crm-frontend.onrender.com` |
| **DB** | Supabase (external) | Your Supabase project |

---

## 🔗 Important URLs

**Frontend**: `https://whatsapp-crm-frontend.onrender.com`  
**API Health**: `https://whatsapp-crm-api.onrender.com/health`  
**Webhook**: `https://whatsapp-crm-api.onrender.com/webhook`  

---

## 🛑 Stop Here If You Don't Have:

Before deploying, make sure you have:
- [ ] WhatsApp Business Account
- [ ] WhatsApp API Token
- [ ] Supabase Project
- [ ] Supabase tables created
- [ ] GitHub account connected to Render

---

## ✅ Done!

Your app is now live! 🎉

**Frontend**: Users can access the dashboard  
**API**: WhatsApp messages are processed  
**Database**: Leads are saved to Supabase  

---

## 🆘 Troubleshooting

**Still not working?**
1. Check Render dashboard logs
2. Verify environment variables are set
3. Test webhook URL manually
4. Check Supabase is accessible

**Need help?**
- See `RENDER_DEPLOYMENT.md` for detailed guide
- Visit render.com/docs

---

**That's it!** Your WhatsApp CRM is deployed to Render 🚀
